function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function isWithinRoot(path, rootPath) {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

export function normalizeRegionManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.regions) || manifest.regions.length === 0) {
    throw new TypeError('A non-empty DOM region manifest is required.');
  }
  const regionIds = new Set();
  const rootPaths = new Set();
  for (const region of manifest.regions) {
    if (!region.id || regionIds.has(region.id)) throw new Error(`Duplicate or missing DOM region id: ${region.id}`);
    regionIds.add(region.id);
    if (!Array.isArray(region.rootPaths) || region.rootPaths.length === 0) {
      throw new Error(`DOM region ${region.id} has no root paths.`);
    }
    for (const rootPath of region.rootPaths) {
      if (rootPaths.has(rootPath)) throw new Error(`DOM root path is assigned twice: ${rootPath}`);
      rootPaths.add(rootPath);
    }
  }
  return manifest;
}

export function assignNodesToRegions(nodes, manifest) {
  const normalized = normalizeRegionManifest(manifest);
  const assignments = [];
  const regionCounts = Object.fromEntries(normalized.regions.map(region => [region.id, 0]));
  const unassigned = [];
  const ambiguous = [];

  for (const node of nodes) {
    const candidates = [];
    for (const region of normalized.regions) {
      for (const rootPath of region.rootPaths) {
        if (isWithinRoot(node.path, rootPath)) candidates.push({ region, rootPath });
      }
    }
    candidates.sort((left, right) => right.rootPath.length - left.rootPath.length || left.region.id.localeCompare(right.region.id));
    if (candidates.length === 0) {
      unassigned.push(node.path);
      continue;
    }
    const longestLength = candidates[0].rootPath.length;
    const longest = candidates.filter(candidate => candidate.rootPath.length === longestLength);
    const distinctRegions = uniqueSorted(longest.map(candidate => candidate.region.id));
    if (distinctRegions.length !== 1) {
      ambiguous.push({ path: node.path, regionIds: distinctRegions });
      continue;
    }
    const selected = longest[0].region;
    regionCounts[selected.id] += 1;
    assignments.push({
      path: node.path,
      line: node.startLine,
      tag: node.tag,
      id: node.id,
      regionId: selected.id,
      targetOwner: selected.targetOwner,
      targetTask: selected.targetTask,
      disposition: selected.disposition
    });
  }

  return {
    assignments,
    regionCounts,
    coverage: {
      nodeCount: nodes.length,
      assignedNodeCount: assignments.length,
      unassignedNodeCount: unassigned.length,
      ambiguousNodeCount: ambiguous.length,
      unassigned,
      ambiguous
    }
  };
}

function matchesTokens(node, tokens) {
  if (tokens.ids.length > 0 && !tokens.ids.includes(node.id)) return false;
  if (tokens.classes.length > 0 && !tokens.classes.every(name => node.classes.includes(name))) return false;
  if (tokens.dataAttributes.length > 0 && !tokens.dataAttributes.every(({ name, value }) => (
    Object.hasOwn(node.dataAttributes, name) && (value === null || node.dataAttributes[name] === value)
  ))) return false;
  return tokens.ids.length + tokens.classes.length + tokens.dataAttributes.length > 0;
}

function mapSelectorReferences(references, nodes, assignmentByPath, fallbackScope) {
  return references.map(reference => {
    const matchedNodes = nodes.filter(node => matchesTokens(node, reference.tokens));
    const matchedNodePaths = matchedNodes.map(node => node.path);
    const regionIds = uniqueSorted(matchedNodePaths.map(path => assignmentByPath.get(path)?.regionId));
    return {
      ...reference,
      matchedNodePaths,
      regionIds,
      scope: matchedNodePaths.length > 0 ? 'static-index-dom' : fallbackScope
    };
  });
}

function mapClassMutations(mutations, nodes, assignmentByPath) {
  return mutations.map(mutation => {
    const matchedNodes = mutation.literals.length === 0
      ? []
      : nodes.filter(node => mutation.literals.some(name => node.classes.includes(name)));
    const matchedNodePaths = matchedNodes.map(node => node.path);
    return {
      ...mutation,
      matchedNodePaths,
      regionIds: uniqueSorted(matchedNodePaths.map(path => assignmentByPath.get(path)?.regionId)),
      scope: matchedNodePaths.length > 0 ? 'static-index-dom' : 'dynamic-runtime-dom'
    };
  });
}

function summarizeRegion(region, nodes, selectorReferences, testReferences, classMutations, count) {
  const regionNodes = nodes.filter(node => node.regionId === region.id);
  return {
    ...region,
    nodeCount: count,
    ids: uniqueSorted(regionNodes.map(node => node.id)),
    classes: uniqueSorted(regionNodes.flatMap(node => node.classes)),
    ariaNodeCount: regionNodes.filter(node => Object.keys(node.aria).length > 0).length,
    inlineEventCount: regionNodes.reduce((sum, node) => sum + Object.keys(node.inlineEvents).length, 0),
    inlineStyleCount: regionNodes.filter(node => node.inlineStyle).length,
    runtimeSelectorReferenceIds: selectorReferences.filter(reference => reference.regionIds.includes(region.id)).map(reference => reference.id),
    testSelectorReferenceIds: testReferences.filter(reference => reference.regionIds.includes(region.id)).map(reference => reference.id),
    classMutationReferenceIds: classMutations.filter(reference => reference.regionIds.includes(region.id)).map(reference => reference.id)
  };
}

export function buildMigrationMap({ htmlInventory, references, manifest }) {
  const assignmentResult = assignNodesToRegions(htmlInventory.nodes, manifest);
  if (assignmentResult.coverage.unassignedNodeCount > 0 || assignmentResult.coverage.ambiguousNodeCount > 0) {
    throw new Error(`DOM migration ownership is incomplete: ${JSON.stringify(assignmentResult.coverage)}`);
  }
  const assignmentByPath = new Map(assignmentResult.assignments.map(assignment => [assignment.path, assignment]));
  const nodes = htmlInventory.nodes.map(node => ({ ...node, regionId: assignmentByPath.get(node.path).regionId }));
  const runtimeSelectors = mapSelectorReferences(
    references.runtimeSelectors,
    htmlInventory.nodes,
    assignmentByPath,
    'dynamic-runtime-dom'
  );
  const testSelectors = mapSelectorReferences(
    references.testSelectors,
    htmlInventory.nodes,
    assignmentByPath,
    'dynamic-test-dom'
  );
  const classMutations = mapClassMutations(references.classMutations, htmlInventory.nodes, assignmentByPath);
  const regions = manifest.regions.map(region => summarizeRegion(
    region,
    nodes,
    runtimeSelectors,
    testSelectors,
    classMutations,
    assignmentResult.regionCounts[region.id]
  ));
  for (const region of regions) {
    if (region.expectedNodeCount !== region.nodeCount) {
      throw new Error(`DOM region ${region.id} expected ${region.expectedNodeCount} nodes but found ${region.nodeCount}.`);
    }
  }
  return {
    schemaVersion: 1,
    baseline: manifest.baseline,
    source: htmlInventory.source,
    coverage: assignmentResult.coverage,
    regions,
    nodeAssignments: assignmentResult.assignments,
    references: {
      runtimeSelectors,
      testSelectors,
      classMutations,
      dynamicClassNames: references.dynamicClassNames
    },
    referenceCoverage: {
      runtimeStaticCount: runtimeSelectors.filter(reference => reference.scope === 'static-index-dom').length,
      runtimeDynamicCount: runtimeSelectors.filter(reference => reference.scope === 'dynamic-runtime-dom').length,
      testStaticCount: testSelectors.filter(reference => reference.scope === 'static-index-dom').length,
      testDynamicCount: testSelectors.filter(reference => reference.scope === 'dynamic-test-dom').length,
      classMutationStaticCount: classMutations.filter(reference => reference.scope === 'static-index-dom').length,
      classMutationDynamicCount: classMutations.filter(reference => reference.scope === 'dynamic-runtime-dom').length
    }
  };
}
