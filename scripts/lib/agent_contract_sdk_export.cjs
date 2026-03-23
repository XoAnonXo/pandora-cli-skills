const fs = require('fs');
const path = require('path');

const {
  SDK_CONTRACT_ARTIFACT_VERSION,
  buildSdkContractComponents,
  buildSdkContractArtifact,
  buildPublishedSdkSurfaceMetadata,
} = require('../../cli/lib/sdk_contract_service.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GENERATED_DIR = path.join(REPO_ROOT, 'sdk', 'generated');
const GENERATED_RELATIVE_DIR = 'sdk/generated';
const TYPESCRIPT_GENERATED_DIR = path.join(REPO_ROOT, 'sdk', 'typescript', 'generated');
const TYPESCRIPT_GENERATED_RELATIVE_DIR = 'sdk/typescript/generated';
const PYTHON_GENERATED_DIR = path.join(REPO_ROOT, 'sdk', 'python', 'pandora_agent', 'generated');
const PYTHON_GENERATED_RELATIVE_DIR = 'sdk/python/pandora_agent/generated';
const GENERATOR_RELATIVE_PATH = 'scripts/generate_agent_contract_sdk.cjs';
const SOURCE_RELATIVE_PATH = 'cli/lib/sdk_contract_service.cjs';
const LEGACY_GENERATED_FILES = Object.freeze([
  {
    relativePath: `${GENERATED_RELATIVE_DIR}/index.cjs`,
    absolutePath: path.join(GENERATED_DIR, 'index.cjs'),
  },
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortDeep(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort(compareStableStrings)) {
    sorted[key] = sortDeep(value[key]);
  }
  return sorted;
}

function sortByName(left, right) {
  return compareStableStrings(left && left.name, right && right.name);
}

function serializeJson(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function normalizeJsonForComparison(value) {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((entry) => normalizeJsonForComparison(entry));
    const allPrimitive = normalizedItems.every(
      (entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry),
    );
    if (allPrimitive) {
      return normalizedItems.slice().sort(compareStableStrings);
    }
    const allObjects = normalizedItems.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    if (allObjects) {
      return normalizedItems
        .slice()
        .sort((left, right) => compareStableStrings(JSON.stringify(left), JSON.stringify(right)));
    }
    return normalizedItems;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort(compareStableStrings)) {
    sorted[key] = normalizeJsonForComparison(value[key]);
  }
  return sorted;
}

function jsonContentsSemanticallyEqual(currentContent, nextContent) {
  try {
    return JSON.stringify(normalizeJsonForComparison(JSON.parse(currentContent)))
      === JSON.stringify(normalizeJsonForComparison(JSON.parse(nextContent)));
  } catch {
    return false;
  }
}

function buildPublishedSurfaceManifestMetadata(contractRegistry, versions = {}) {
  const capabilities = isPlainObject(contractRegistry) && isPlainObject(contractRegistry.capabilities)
    ? contractRegistry.capabilities
    : {};
  const surfaces = buildPublishedSdkSurfaceMetadata(capabilities);
  const clone = isPlainObject(surfaces) ? JSON.parse(JSON.stringify(surfaces)) : {};
  if (isPlainObject(clone.root) && normalizeString(versions.root)) {
    clone.root.version = normalizeString(versions.root);
  }
  if (isPlainObject(clone.typescript) && normalizeString(versions.typescript)) {
    clone.typescript.version = normalizeString(versions.typescript);
  }
  if (isPlainObject(clone.python) && normalizeString(versions.python)) {
    clone.python.version = normalizeString(versions.python);
  }
  return sortDeep(clone);
}

function buildGeneratedPackageMetadata() {
  return {
    main: './index.js',
    type: 'commonjs',
    types: './index.d.ts',
  };
}

function pickSurfaceMetadata(publishedSurfaces, surfaceName) {
  if (!isPlainObject(publishedSurfaces)) return null;
  const surface = publishedSurfaces[surfaceName];
  return isPlainObject(surface) ? sortDeep(surface) : null;
}

function buildManifestArtifact(
  contractRegistry,
  mcpToolDefinitions,
  packageVersion,
  packageMetadata,
  publishedSurfaces,
  options = {},
) {
  const commandDescriptors = isPlainObject(contractRegistry && contractRegistry.commandDescriptors)
    ? contractRegistry.commandDescriptors
    : {};
  const manifest = {
    artifactVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    packageVersion,
    contractVersion:
      contractRegistry && typeof contractRegistry.schemaVersion === 'string'
        ? contractRegistry.schemaVersion
        : SDK_CONTRACT_ARTIFACT_VERSION,
    contractPackageVersion:
      normalizeString(options.contractPackageVersion)
        || (contractRegistry && typeof contractRegistry.packageVersion === 'string'
          ? contractRegistry.packageVersion
          : null),
    contractCommandDescriptorVersion:
      contractRegistry && typeof contractRegistry.commandDescriptorVersion === 'string'
        ? contractRegistry.commandDescriptorVersion
        : null,
    generatedFrom: SOURCE_RELATIVE_PATH,
    generator: GENERATOR_RELATIVE_PATH,
    commandDescriptorVersion:
      contractRegistry && typeof contractRegistry.commandDescriptorVersion === 'string'
        ? contractRegistry.commandDescriptorVersion
        : null,
    commandCount: Object.keys(commandDescriptors).length,
    mcpToolCount: mcpToolDefinitions.length,
    registryDigest:
      contractRegistry
      && isPlainObject(contractRegistry.registryDigest)
        ? contractRegistry.registryDigest
        : {},
    catalogSummary:
      contractRegistry && isPlainObject(contractRegistry.summary)
        ? contractRegistry.summary
        : {},
    backends:
      contractRegistry && isPlainObject(contractRegistry.backends)
        ? contractRegistry.backends
        : {},
    artifacts: {
      bundle: 'contract-registry.json',
      commandDescriptors: 'command-descriptors.json',
      mcpToolDefinitions: 'mcp-tool-definitions.json',
      entrypoint: 'index.js',
      types: 'index.d.ts',
    },
  };
  if (isPlainObject(packageMetadata)) {
    manifest.package = sortDeep(packageMetadata);
  }
  if (isPlainObject(publishedSurfaces)) {
    manifest.publishedSurfaces = sortDeep(publishedSurfaces);
  }
  return sortDeep(manifest);
}

function buildTypescriptManifestArtifact(contractRegistry, mcpToolDefinitions, packageVersion, publishedSurfaces) {
  const manifest = buildManifestArtifact(
    contractRegistry,
    mcpToolDefinitions,
    packageVersion,
    pickSurfaceMetadata(publishedSurfaces, 'typescript'),
    publishedSurfaces,
    {
      contractPackageVersion: publishedSurfaces && publishedSurfaces.root && publishedSurfaces.root.version,
    },
  );
  if (manifest.backends && manifest.backends.packagedClients) {
    manifest.backends.packagedClients = sortDeep({
      ...manifest.backends.packagedClients,
      notes: [
        'This generated manifest describes the standalone TypeScript SDK alpha package surface.',
        'The standalone TypeScript SDK package ships its own generated contract artifacts and client entrypoints only.',
      ],
    });
  }
  return manifest;
}

function buildPythonManifestArtifact(contractRegistry, mcpToolDefinitions, packageVersion) {
  const commandDescriptors = isPlainObject(contractRegistry && contractRegistry.commandDescriptors)
    ? contractRegistry.commandDescriptors
    : {};
  const publishedSurfaces = buildPublishedSurfaceManifestMetadata(contractRegistry, {
    python: packageVersion,
  });
  return sortDeep({
    artifactVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    schemaVersion: SDK_CONTRACT_ARTIFACT_VERSION,
    packageVersion,
    contractVersion:
      contractRegistry && typeof contractRegistry.schemaVersion === 'string'
        ? contractRegistry.schemaVersion
        : SDK_CONTRACT_ARTIFACT_VERSION,
    contractPackageVersion:
      normalizeString(publishedSurfaces && publishedSurfaces.root && publishedSurfaces.root.version)
        || (contractRegistry && typeof contractRegistry.packageVersion === 'string'
          ? contractRegistry.packageVersion
          : null),
    contractCommandDescriptorVersion:
      contractRegistry && typeof contractRegistry.commandDescriptorVersion === 'string'
        ? contractRegistry.commandDescriptorVersion
        : null,
    generatedFrom: SOURCE_RELATIVE_PATH,
    generator: GENERATOR_RELATIVE_PATH,
    commandDescriptorVersion:
      contractRegistry && typeof contractRegistry.commandDescriptorVersion === 'string'
        ? contractRegistry.commandDescriptorVersion
        : null,
    commandCount: Object.keys(commandDescriptors).length,
    mcpToolCount: mcpToolDefinitions.length,
    registryDigest:
      contractRegistry
      && isPlainObject(contractRegistry.registryDigest)
        ? contractRegistry.registryDigest
        : {},
    catalogSummary:
      contractRegistry && isPlainObject(contractRegistry.summary)
        ? contractRegistry.summary
        : {},
    backends:
      contractRegistry && isPlainObject(contractRegistry.backends)
        ? sortDeep({
          ...contractRegistry.backends,
          packagedClients: contractRegistry.backends.packagedClients
            ? {
              ...contractRegistry.backends.packagedClients,
              notes: [
                'This generated manifest describes the standalone Python SDK alpha package surface.',
                'The standalone Python SDK package ships its own generated contract artifacts and client modules only.',
              ],
            }
            : undefined,
        })
        : {},
    artifacts: {
      bundle: 'contract-registry.json',
      commandDescriptors: 'command-descriptors.json',
      mcpToolDefinitions: 'mcp-tool-definitions.json',
    },
    package: pickSurfaceMetadata(publishedSurfaces, 'python'),
    publishedSurfaces,
  });
}

function withPackagedClientMetadata(contractRegistry, options = {}) {
  const clone = JSON.parse(JSON.stringify(contractRegistry));
  const packageVersion = normalizeString(options.packageVersion);
  if (packageVersion) {
    clone.packageVersion = packageVersion;
  }
  if (clone && clone.backends && clone.backends.packagedClients) {
    clone.backends.packagedClients.notes = Array.isArray(options.notes) ? options.notes.slice() : [];
  }
  return sortDeep(clone);
}

function buildIndexModuleSource(options = {}) {
  const fallbackDir = typeof options.fallbackDir === 'string' && options.fallbackDir.trim()
    ? options.fallbackDir.trim()
    : null;
  const fallbackPrelude = fallbackDir
    ? `\nfunction loadJson(name) {\n  try {\n    return require(\`./\${name}\`);\n  } catch (error) {\n    if (error && error.code !== 'MODULE_NOT_FOUND') {\n      throw error;\n    }\n    return require('${fallbackDir}/' + name);\n  }\n}\n\nconst manifest = loadJson('manifest.json');\nconst commandDescriptors = loadJson('command-descriptors.json');\nconst mcpToolDefinitions = loadJson('mcp-tool-definitions.json');\nconst contractRegistry = loadJson('contract-registry.json');\n`
    : `\nconst manifest = require('./manifest.json');\nconst commandDescriptors = require('./command-descriptors.json');\nconst mcpToolDefinitions = require('./mcp-tool-definitions.json');\nconst contractRegistry = require('./contract-registry.json');\n`;
  return `'use strict';${fallbackPrelude}\nfunction loadGeneratedManifest() {\n  return manifest;\n}\n\nfunction loadGeneratedCommandDescriptors() {\n  return commandDescriptors;\n}\n\nfunction loadGeneratedMcpToolDefinitions() {\n  return mcpToolDefinitions;\n}\n\nfunction loadGeneratedContractRegistry() {\n  return contractRegistry;\n}\n\nfunction loadGeneratedCapabilities() {\n  return contractRegistry && contractRegistry.capabilities ? contractRegistry.capabilities : {};\n}\n\nfunction loadGeneratedToolCatalog() {\n  return contractRegistry && contractRegistry.tools ? contractRegistry.tools : {};\n}\n\nmodule.exports = Object.freeze({\n  manifest,\n  commandDescriptors,\n  mcpToolDefinitions,\n  contractRegistry,\n  loadGeneratedManifest,\n  loadGeneratedCommandDescriptors,\n  loadGeneratedMcpToolDefinitions,\n  loadGeneratedContractRegistry,\n  loadGeneratedCapabilities,\n  loadGeneratedToolCatalog,\n});\n`;
}

function buildTypescriptGeneratedIndexModuleSource() {
  return `'use strict';
const manifest = require('./manifest.json');

function loadRootArtifact(name) {
  return require('../../generated/' + name);
}

function loadLocalArtifact(name) {
  try {
    return require('./' + name);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return loadRootArtifact(name);
  }
}

const commandDescriptors = loadLocalArtifact('command-descriptors.json');
const mcpToolDefinitions = loadLocalArtifact('mcp-tool-definitions.json');
const contractRegistry = loadLocalArtifact('contract-registry.json');

function loadGeneratedManifest() {
  return manifest;
}

function loadGeneratedCommandDescriptors() {
  return commandDescriptors;
}

function loadGeneratedMcpToolDefinitions() {
  return mcpToolDefinitions;
}

function loadGeneratedContractRegistry() {
  return contractRegistry;
}

function loadGeneratedCapabilities() {
  return contractRegistry && contractRegistry.capabilities ? contractRegistry.capabilities : {};
}

function loadGeneratedToolCatalog() {
  return contractRegistry && contractRegistry.tools ? contractRegistry.tools : {};
}

module.exports = Object.freeze({
  manifest,
  commandDescriptors,
  mcpToolDefinitions,
  contractRegistry,
  loadGeneratedManifest,
  loadGeneratedCommandDescriptors,
  loadGeneratedMcpToolDefinitions,
  loadGeneratedContractRegistry,
  loadGeneratedCapabilities,
  loadGeneratedToolCatalog,
});
`;
}

function buildIndexTypesSource(typeImportPath) {
  return `import type {\n  PandoraCommandDescriptor,\n  PandoraContractRegistry,\n  PandoraGeneratedManifest,\n  PandoraGeneratedMcpToolDefinition,\n} from '${typeImportPath}';\n\ndeclare const sdk: {\n  manifest: PandoraGeneratedManifest;\n  commandDescriptors: Record<string, PandoraCommandDescriptor>;\n  mcpToolDefinitions: PandoraGeneratedMcpToolDefinition[];\n  contractRegistry: PandoraContractRegistry;\n  loadGeneratedManifest(): PandoraGeneratedManifest;\n  loadGeneratedCommandDescriptors(): Record<string, PandoraCommandDescriptor>;\n  loadGeneratedMcpToolDefinitions(): PandoraGeneratedMcpToolDefinition[];\n  loadGeneratedContractRegistry(): PandoraContractRegistry;\n  loadGeneratedCapabilities(): PandoraContractRegistry['capabilities'];\n  loadGeneratedToolCatalog(): PandoraContractRegistry['tools'];\n};\n\nexport = sdk;\n`;
}

function buildGeneratedArtifactFiles(options = {}) {
  const packageVersion = typeof options.packageVersion === 'string' && options.packageVersion.trim()
    ? options.packageVersion.trim()
    : '0.0.0';
  const typescriptPackageVersion =
    typeof options.typescriptPackageVersion === 'string' && options.typescriptPackageVersion.trim()
      ? options.typescriptPackageVersion.trim()
      : packageVersion;
  const pythonPackageVersion =
    typeof options.pythonPackageVersion === 'string' && options.pythonPackageVersion.trim()
      ? options.pythonPackageVersion.trim()
      : packageVersion;
  const components = buildSdkContractComponents({ packageVersion });
  const commandDescriptors = sortDeep(components.commandDescriptors);
  const mcpToolDefinitions = components.mcpToolDefinitions
    .slice()
    .sort(sortByName)
    .map((definition) => sortDeep(definition));
  const contractRegistry = sortDeep(buildSdkContractArtifact({ packageVersion }));
  const typescriptContractRegistry = withPackagedClientMetadata(contractRegistry, {
    packageVersion: typescriptPackageVersion,
    notes: [
      'Generated TypeScript SDK alpha package is shipped in this build under sdk/typescript.',
    ],
  });
  const pythonContractRegistry = withPackagedClientMetadata(contractRegistry, {
    packageVersion: pythonPackageVersion,
    notes: [
      'Generated Python SDK alpha package is shipped in this build under sdk/python.',
    ],
  });
  const publishedSurfaces = buildPublishedSurfaceManifestMetadata(contractRegistry, {
    root: packageVersion,
    typescript: typescriptPackageVersion,
    python: pythonPackageVersion,
  });
  const manifest = buildManifestArtifact(
    contractRegistry,
    mcpToolDefinitions,
    packageVersion,
    pickSurfaceMetadata(publishedSurfaces, 'root'),
    publishedSurfaces,
  );
  const typescriptManifest = buildTypescriptManifestArtifact(
    typescriptContractRegistry,
    mcpToolDefinitions,
    typescriptPackageVersion,
    publishedSurfaces,
  );
  const pythonManifest = buildPythonManifestArtifact(
    pythonContractRegistry,
    mcpToolDefinitions,
    pythonPackageVersion,
  );

  return [
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/package.json`,
      absolutePath: path.join(GENERATED_DIR, 'package.json'),
      content: serializeJson(buildGeneratedPackageMetadata()),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/manifest.json`,
      absolutePath: path.join(GENERATED_DIR, 'manifest.json'),
      content: serializeJson(manifest),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/command-descriptors.json`,
      absolutePath: path.join(GENERATED_DIR, 'command-descriptors.json'),
      content: serializeJson(commandDescriptors),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/mcp-tool-definitions.json`,
      absolutePath: path.join(GENERATED_DIR, 'mcp-tool-definitions.json'),
      content: serializeJson(mcpToolDefinitions),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/contract-registry.json`,
      absolutePath: path.join(GENERATED_DIR, 'contract-registry.json'),
      content: serializeJson(contractRegistry),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/index.js`,
      absolutePath: path.join(GENERATED_DIR, 'index.js'),
      content: buildIndexModuleSource(),
    },
    {
      relativePath: `${GENERATED_RELATIVE_DIR}/index.d.ts`,
      absolutePath: path.join(GENERATED_DIR, 'index.d.ts'),
      content: buildIndexTypesSource('../typescript'),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/manifest.json`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'manifest.json'),
      content: serializeJson(typescriptManifest),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/command-descriptors.json`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'command-descriptors.json'),
      content: serializeJson(commandDescriptors),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/mcp-tool-definitions.json`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'mcp-tool-definitions.json'),
      content: serializeJson(mcpToolDefinitions),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/contract-registry.json`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'contract-registry.json'),
      content: serializeJson(typescriptContractRegistry),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/index.js`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'index.js'),
      content: buildTypescriptGeneratedIndexModuleSource(),
    },
    {
      relativePath: `${TYPESCRIPT_GENERATED_RELATIVE_DIR}/index.d.ts`,
      absolutePath: path.join(TYPESCRIPT_GENERATED_DIR, 'index.d.ts'),
      content: buildIndexTypesSource('../index'),
    },
    {
      relativePath: `${PYTHON_GENERATED_RELATIVE_DIR}/manifest.json`,
      absolutePath: path.join(PYTHON_GENERATED_DIR, 'manifest.json'),
      content: serializeJson(pythonManifest),
    },
    {
      relativePath: `${PYTHON_GENERATED_RELATIVE_DIR}/command-descriptors.json`,
      absolutePath: path.join(PYTHON_GENERATED_DIR, 'command-descriptors.json'),
      content: serializeJson(commandDescriptors),
    },
    {
      relativePath: `${PYTHON_GENERATED_RELATIVE_DIR}/mcp-tool-definitions.json`,
      absolutePath: path.join(PYTHON_GENERATED_DIR, 'mcp-tool-definitions.json'),
      content: serializeJson(mcpToolDefinitions),
    },
    {
      relativePath: `${PYTHON_GENERATED_RELATIVE_DIR}/contract-registry.json`,
      absolutePath: path.join(PYTHON_GENERATED_DIR, 'contract-registry.json'),
      content: serializeJson(pythonContractRegistry),
    },
  ];
}

function cleanupLegacyGeneratedFiles() {
  for (const file of LEGACY_GENERATED_FILES) {
    try {
      fs.rmSync(file.absolutePath, { force: true });
    } catch {
      // best effort
    }
  }
}

module.exports = {
  GENERATED_DIR,
  GENERATED_RELATIVE_DIR,
  GENERATOR_RELATIVE_PATH,
  LEGACY_GENERATED_FILES,
  SOURCE_RELATIVE_PATH,
  buildGeneratedArtifactFiles,
  cleanupLegacyGeneratedFiles,
  jsonContentsSemanticallyEqual,
};
