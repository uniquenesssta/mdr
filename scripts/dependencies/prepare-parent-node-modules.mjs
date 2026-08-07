import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const dependencyRoot = resolve(repositoryRoot, '..');
const externalNodeModules = join(dependencyRoot, 'node_modules');
const markerPath = join(dependencyRoot, '.markdown-editor-dependencies.json');
const repositoryPackageJsonPath = join(repositoryRoot, 'package.json');
const repositoryLockPath = join(repositoryRoot, 'package-lock.json');
const transientPackages = parseTransientPackages(process.argv.slice(2));

await ensureParentDependencies();

async function ensureParentDependencies() {
  const rootNodeModules = join(repositoryRoot, 'node_modules');
  if (await pathExists(rootNodeModules)) {
    throw new Error(
      `Refusing to use project-local dependencies: ${rootNodeModules}. ` +
      `Remove that directory; dependencies must live at ${externalNodeModules}.`
    );
  }

  const [packageJsonText, packageLockText] = await Promise.all([
    readFile(repositoryPackageJsonPath, 'utf8'),
    readFile(repositoryLockPath, 'utf8')
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const packageLock = JSON.parse(packageLockText);
  const lockHash = createHash('sha256').update(packageLockText).digest('hex');
  const requestedExtras = [...new Set(transientPackages)].sort();

  const marker = await readMarker();
  const baseDependenciesMatch = await declaredDependenciesMatch(packageJson, packageLock);
  const requestedExtrasMatch = await transientDependenciesMatch(requestedExtras);

  if (
    marker?.lockHash === lockHash &&
    sameStringArray(marker.transientPackages, requestedExtras) &&
    baseDependenciesMatch &&
    requestedExtrasMatch
  ) {
    console.log(`[dependencies] using ${externalNodeModules}`);
    return;
  }

  const externalNodeModulesExists = await pathExists(externalNodeModules);
  if (externalNodeModulesExists && marker === null && !baseDependenciesMatch) {
    throw new Error(
      `The parent dependency directory already exists but is not owned by this project: ${externalNodeModules}. ` +
      'Refusing to overwrite dependencies that may belong to another workspace.'
    );
  }

  await assertParentManifestsAreFree();
  await mkdir(dependencyRoot, { recursive: true });

  const parentPackageJsonPath = join(dependencyRoot, 'package.json');
  const parentLockPath = join(dependencyRoot, 'package-lock.json');

  try {
    await Promise.all([
      copyFile(repositoryPackageJsonPath, parentPackageJsonPath),
      copyFile(repositoryLockPath, parentLockPath)
    ]);

    if (!baseDependenciesMatch || marker?.lockHash !== lockHash) {
      runNpm(['ci', '--prefix', dependencyRoot]);
    }

    if (requestedExtras.length > 0 && !(await transientDependenciesMatch(requestedExtras))) {
      runNpm([
        'install',
        '--prefix',
        dependencyRoot,
        '--no-save',
        '--no-package-lock',
        ...requestedExtras
      ]);
    }
  } finally {
    await Promise.all([
      rm(parentPackageJsonPath, { force: true }),
      rm(parentLockPath, { force: true })
    ]);
  }

  if (!(await declaredDependenciesMatch(packageJson, packageLock))) {
    throw new Error('Parent dependency installation completed, but declared dependency versions do not match package-lock.json.');
  }
  if (!(await transientDependenciesMatch(requestedExtras))) {
    throw new Error('Parent dependency installation completed, but one or more requested transient dependencies are missing.');
  }

  await writeFile(
    markerPath,
    `${JSON.stringify({
      project: packageJson.name ?? 'markdown-editor',
      lockHash,
      transientPackages: requestedExtras
    }, null, 2)}\n`,
    'utf8'
  );
  console.log(`[dependencies] prepared ${externalNodeModules}`);
}

function parseTransientPackages(args) {
  const packages = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--add') {
      const packageSpec = args[index + 1];
      if (!packageSpec || packageSpec.startsWith('--')) {
        throw new Error('--add requires a package specifier.');
      }
      packages.push(packageSpec);
      index += 1;
      continue;
    }
    if (argument.startsWith('--add=')) {
      const packageSpec = argument.slice('--add='.length);
      if (!packageSpec) {
        throw new Error('--add requires a package specifier.');
      }
      packages.push(packageSpec);
      continue;
    }
    throw new Error(`Unknown dependency preparation argument: ${argument}`);
  }
  return packages;
}

async function declaredDependenciesMatch(packageJson, packageLock) {
  const declared = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  for (const name of Object.keys(declared)) {
    const expectedVersion = packageLock.packages?.[`node_modules/${name}`]?.version;
    if (!expectedVersion) {
      return false;
    }
    const installedPackagePath = join(externalNodeModules, ...name.split('/'), 'package.json');
    try {
      const installedPackage = JSON.parse(await readFile(installedPackagePath, 'utf8'));
      if (installedPackage.version !== expectedVersion) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function transientDependenciesMatch(packageSpecs) {
  for (const packageSpec of packageSpecs) {
    const { name, version } = splitPackageSpec(packageSpec);
    if (!version) {
      return false;
    }
    try {
      const installedPackagePath = join(externalNodeModules, ...name.split('/'), 'package.json');
      const installedPackage = JSON.parse(await readFile(installedPackagePath, 'utf8'));
      if (installedPackage.version !== version) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function splitPackageSpec(packageSpec) {
  if (packageSpec.startsWith('@')) {
    const separatorIndex = packageSpec.indexOf('@', packageSpec.indexOf('/') + 1);
    if (separatorIndex === -1) {
      return { name: packageSpec, version: '' };
    }
    return {
      name: packageSpec.slice(0, separatorIndex),
      version: packageSpec.slice(separatorIndex + 1)
    };
  }
  const separatorIndex = packageSpec.lastIndexOf('@');
  if (separatorIndex <= 0) {
    return { name: packageSpec, version: '' };
  }
  return {
    name: packageSpec.slice(0, separatorIndex),
    version: packageSpec.slice(separatorIndex + 1)
  };
}

async function assertParentManifestsAreFree() {
  const collisions = [];
  for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    if (await pathExists(join(dependencyRoot, name))) {
      collisions.push(name);
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot prepare parent dependencies because ${dependencyRoot} already contains ${collisions.join(', ')}. ` +
      'The installer will not overwrite parent workspace manifests.'
    );
  }
}

async function readMarker() {
  try {
    return JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    return null;
  }
}

function runNpm(args) {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmExecutable, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
