import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const COMPILE_TIMEOUT_MS = 90_000;
const TYPE_DEFINITION_PREFIX = "\nAdd-Type -TypeDefinition @'\n";
const TYPE_DEFINITION_SUFFIX = "\n'@\n";

let interopDirectory = null;
let interopAssemblyPath = null;
let cleanupRegistered = false;

function quotePowerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function runPowerShell(script, timeout) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: false,
      timeout
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'PowerShell command failed').trim());
  }
}

function extractTypeDefinition(nativeApiSource) {
  if (!nativeApiSource.startsWith(TYPE_DEFINITION_PREFIX) || !nativeApiSource.endsWith(TYPE_DEFINITION_SUFFIX)) {
    throw new Error('Windows native API source no longer matches the expected Add-Type definition wrapper.');
  }
  return nativeApiSource.slice(TYPE_DEFINITION_PREFIX.length, -TYPE_DEFINITION_SUFFIX.length);
}

function cleanupInteropArtifacts() {
  if (!interopDirectory) return;
  rmSync(interopDirectory, { recursive: true, force: true });
  interopDirectory = null;
  interopAssemblyPath = null;
}

export function prepareNativeWindowInterop(nativeApiSource) {
  if (process.platform !== 'win32') {
    throw new Error('Windows native window automation requires win32.');
  }
  if (interopAssemblyPath) return interopAssemblyPath;

  const source = extractTypeDefinition(nativeApiSource);
  const directory = mkdtempSync(join(tmpdir(), 'markdown-editor-native-window-'));
  const sourcePath = join(directory, 'MarkdownEditorWindowAutomation.cs');
  const assemblyPath = join(directory, 'MarkdownEditorWindowAutomation.dll');
  writeFileSync(sourcePath, source, 'utf8');

  try {
    const sourceLiteral = quotePowerShellLiteral(sourcePath);
    const assemblyLiteral = quotePowerShellLiteral(assemblyPath);
    const startedAt = Date.now();
    runPowerShell(
      `Add-Type -LiteralPath '${sourceLiteral}' -OutputAssembly '${assemblyLiteral}' -OutputType Library`,
      COMPILE_TIMEOUT_MS
    );
    interopDirectory = directory;
    interopAssemblyPath = assemblyPath;
    console.log(`[windows-native] prepared Win32 interop assembly in ${Date.now() - startedAt}ms`);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.once('exit', cleanupInteropArtifacts);
  }

  return interopAssemblyPath;
}

export function replaceNativeApiCompilation(script, nativeApiSource) {
  if (!script.includes(nativeApiSource)) return script;
  const assemblyPath = prepareNativeWindowInterop(nativeApiSource);
  const assemblyLiteral = quotePowerShellLiteral(assemblyPath);
  return script.replace(nativeApiSource, `Add-Type -LiteralPath '${assemblyLiteral}'`);
}
