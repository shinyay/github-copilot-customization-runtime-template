import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPOSITORY_ROOT,
  SHA256_PATTERN,
  assertExactKeys,
  assertNoPathCollisions,
  assertSafeRelativePosixPath,
  comparePosixPaths,
  gitBlob,
  readJsonFile,
  resolveInside,
  sha256
} from './common.mjs';

export const EXPECTED_BASELINE_FILES = 515;
export const SOURCE_TREE_SHA256 = 'c3cd74e0d65b1ae88a29a4392eb42f9d51ba2c671d111796aacc69fd9cc5b111';
export const TEMPLATE_TREE_SHA256 = 'de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2';
export const SOURCE_COMMIT = '398d7d1982a1402bcdba00d6c3ded67d8d338787';
export const SOURCE_REPOSITORY = 'https://github.com/shinyay/code-to-doc-workshop-260910';

export function baselineTreeSha256(files) {
  const records = files.map(file =>
    `${file.path}\0${file.mode}\0${file.gitBlob}\0${file.bytes}\0${file.sha256}\n`);
  return sha256(Buffer.from(records.join(''), 'utf8'));
}

export function loadTemplateConfiguration(repoRoot = REPOSITORY_ROOT) {
  const file = path.join(repoRoot, '.hackathon', 'template.json');
  const configuration = readJsonFile(file, 'Template configuration');
  assertExactKeys(configuration, [
    'schemaVersion',
    'templateVersion',
    'source',
    'baselineManifest',
    'baselineOverrides',
    'sourceTreeSha256',
    'templateTreeSha256',
    'templateManifest',
    'challengePackSchema',
    'challengePackSchemaSha256',
    'supportedContracts',
    'runState',
    'evidenceRoot',
    'challengeRoot',
    'submissionDirectory'
  ], 'template configuration');
  assert.equal(configuration.schemaVersion, 1, 'Unsupported template configuration schema');
  assert.equal(configuration.templateVersion, 1, 'Unsupported template version');
  assertExactKeys(configuration.source, ['repository', 'commit', 'path'], 'template source');
  assert.equal(configuration.source.repository, SOURCE_REPOSITORY, 'Unexpected source repository');
  assert.equal(configuration.source.commit, SOURCE_COMMIT, 'Unexpected source commit');
  assert.equal(configuration.source.path, '.', 'Version 1 source path must be repository root');
  assert.equal(configuration.sourceTreeSha256, SOURCE_TREE_SHA256, 'Unexpected source tree SHA-256');
  assert.equal(configuration.templateTreeSha256, TEMPLATE_TREE_SHA256, 'Unexpected template tree SHA-256');
  assert.match(configuration.challengePackSchemaSha256, SHA256_PATTERN, 'Invalid Challenge Pack schema SHA-256');
  for (const field of [
    'baselineManifest',
    'baselineOverrides',
    'templateManifest',
    'challengePackSchema',
    'supportedContracts',
    'runState',
    'evidenceRoot',
    'challengeRoot',
    'submissionDirectory'
  ]) {
    assertSafeRelativePosixPath(configuration[field], `Template ${field}`);
  }
  return configuration;
}

export function loadSourceBaselineManifest(repoRoot = REPOSITORY_ROOT, configuration = loadTemplateConfiguration(repoRoot)) {
  const file = resolveInside(repoRoot, configuration.baselineManifest, 'Baseline manifest path');
  const manifest = readJsonFile(file, 'Source baseline manifest');
  assertExactKeys(manifest, [
    'schemaVersion',
    'sourceRepository',
    'sourceCommit',
    'snapshotPath',
    'fileCount',
    'treeSha256',
    'files'
  ], 'source baseline manifest');
  assert.equal(manifest.schemaVersion, 1, 'Unsupported source baseline schema');
  assert.equal(manifest.sourceRepository, SOURCE_REPOSITORY, 'Unexpected source baseline repository');
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT, 'Unexpected source baseline commit');
  assert.equal(manifest.snapshotPath, '.', 'Source baseline snapshotPath must be the upstream repository root');
  assert.equal(manifest.fileCount, EXPECTED_BASELINE_FILES, 'Unexpected source baseline file count');
  assert.equal(manifest.treeSha256, SOURCE_TREE_SHA256, 'Unexpected source baseline tree SHA-256');
  assert.ok(Array.isArray(manifest.files), 'Source baseline files must be an array');
  assert.equal(manifest.files.length, EXPECTED_BASELINE_FILES, 'Source baseline file records do not reconcile');

  const paths = [];
  for (const record of manifest.files) {
    assertExactKeys(record, ['path', 'mode', 'gitBlob', 'bytes', 'sha256'], `source baseline record ${record.path}`);
    assertSafeRelativePosixPath(record.path, 'Source baseline path');
    paths.push(record.path);
    assert.equal(record.mode, '100644', `Unsupported source mode: ${record.path}`);
    assert.match(record.gitBlob, /^[0-9a-f]{40}$/, `Invalid source Git blob: ${record.path}`);
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `Invalid source byte length: ${record.path}`);
    assert.match(record.sha256, SHA256_PATTERN, `Invalid source SHA-256: ${record.path}`);
  }
  assertNoPathCollisions(paths, 'Source baseline paths');
  assert.deepEqual(paths, [...paths].sort(comparePosixPaths), 'Source baseline paths must be bytewise sorted');
  assert.equal(baselineTreeSha256(manifest.files), SOURCE_TREE_SHA256,
    'Source baseline tree hash does not reconcile');
  return manifest;
}

export function loadBaselineOverrides(repoRoot = REPOSITORY_ROOT, configuration = loadTemplateConfiguration(repoRoot),
  sourceManifest = loadSourceBaselineManifest(repoRoot, configuration)) {
  const file = resolveInside(repoRoot, configuration.baselineOverrides, 'Baseline overrides path');
  const overrides = readJsonFile(file, 'Baseline overrides');
  assertExactKeys(overrides,
    ['schemaVersion', 'algorithm', 'sourceTreeSha256', 'templateTreeSha256', 'overrides'],
    'baseline overrides');
  assert.equal(overrides.schemaVersion, 1);
  assert.equal(overrides.algorithm, 'baseline-tree-v1');
  assert.equal(overrides.sourceTreeSha256, SOURCE_TREE_SHA256);
  assert.equal(overrides.templateTreeSha256, TEMPLATE_TREE_SHA256);
  assert.ok(Array.isArray(overrides.overrides), 'baseline overrides must be an array');
  assert.equal(overrides.overrides.length, 2, 'Version 1 requires exactly two operational overrides');

  const sourceByPath = new Map(sourceManifest.files.map(record => [record.path, record]));
  const result = new Map();
  for (const override of overrides.overrides) {
    assertExactKeys(override, ['path', 'reason', 'source', 'template'], 'baseline override');
    assertSafeRelativePosixPath(override.path, 'Baseline override path');
    assert.equal(typeof override.reason, 'string');
    assertExactKeys(override.source, ['mode', 'gitBlob', 'bytes', 'sha256'], 'baseline override source');
    assertExactKeys(override.template, ['mode', 'gitBlob', 'bytes', 'sha256'], 'baseline override template');
    assert.deepEqual(override.source, {
      mode: sourceByPath.get(override.path)?.mode,
      gitBlob: sourceByPath.get(override.path)?.gitBlob,
      bytes: sourceByPath.get(override.path)?.bytes,
      sha256: sourceByPath.get(override.path)?.sha256
    }, `Override source does not match baseline manifest: ${override.path}`);
    assert.equal(override.template.mode, '100644');
    assert.match(override.template.gitBlob, /^[0-9a-f]{40}$/);
    assert.match(override.template.sha256, SHA256_PATTERN);
    assert.ok(Number.isSafeInteger(override.template.bytes) && override.template.bytes >= 0);
    assert.ok(!result.has(override.path), `Duplicate baseline override: ${override.path}`);
    result.set(override.path, override);
  }
  assert.deepEqual([...result.keys()].sort(comparePosixPaths),
    ['.github/workflows/verify.yml', '.gitignore'], 'Unexpected operational override paths');
  return { document: overrides, byPath: result };
}

export function loadTemplateBaseline(repoRoot = REPOSITORY_ROOT) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const sourceManifest = loadSourceBaselineManifest(repoRoot, configuration);
  const overrideSet = loadBaselineOverrides(repoRoot, configuration, sourceManifest);
  const files = sourceManifest.files.map(source => {
    const override = overrideSet.byPath.get(source.path);
    return override ? { path: source.path, ...override.template } : source;
  });
  assert.equal(baselineTreeSha256(files), TEMPLATE_TREE_SHA256,
    'Template baseline tree hash does not reconcile declared overrides');
  return { configuration, sourceManifest, overrides: overrideSet.document, files };
}

function assertOperationalOverridePostImages(repoRoot) {
  const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.vscode/*\n!.vscode/mcp.json\n'),
    '.gitignore override must expose only .vscode/mcp.json');
  assert.ok(!gitignore.includes('\n.vscode/\n'), '.gitignore override must remove the blanket .vscode/ rule');
  const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'verify.yml'), 'utf8');
  assert.ok(workflow.includes('on:\n  workflow_dispatch:\n'), 'Legacy workflow must be workflow_dispatch-only');
  assert.ok(!workflow.includes('on:\n  push:\n') && !workflow.includes('\n  pull_request:\n'),
    'Legacy workflow must not run on push or pull_request');
}

export function inspectBaseline(repoRoot = REPOSITORY_ROOT, { allowedMutations = [] } = {}) {
  const baseline = loadTemplateBaseline(repoRoot);
  const allowed = new Set(allowedMutations);
  const missing = [];
  const changed = [];
  let present = 0;
  for (const record of baseline.files) {
    const file = resolveInside(repoRoot, record.path, 'Baseline path');
    if (!existsSync(file)) {
      missing.push(record.path);
      continue;
    }
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      changed.push({ path: record.path, differences: ['fileType'] });
      continue;
    }
    present += 1;
    if (allowed.has(record.path)) continue;
    const bytes = readFileSync(file);
    const differences = [];
    if (bytes.length !== record.bytes) differences.push('bytes');
    if (sha256(bytes) !== record.sha256) differences.push('sha256');
    if (gitBlob(bytes) !== record.gitBlob) differences.push('gitBlob');
    if (differences.length) changed.push({ path: record.path, differences });
  }
  return {
    expected: baseline.files.length,
    present,
    missing,
    changed,
    sourceTreeSha256: SOURCE_TREE_SHA256,
    templateTreeSha256: TEMPLATE_TREE_SHA256,
    overrideCount: baseline.overrides.overrides.length
  };
}

export function verifyBaseline(repoRoot = REPOSITORY_ROOT, options = {}) {
  const result = inspectBaseline(repoRoot, options);
  assert.equal(result.present, result.expected,
    `Baseline file reconciliation failed: expected ${result.expected}, found ${result.present}`);
  assert.deepEqual(result.missing, [], `Baseline has missing files: ${result.missing.join(', ')}`);
  assert.deepEqual(result.changed, [], `Baseline has changed files: ${JSON.stringify(result.changed)}`);
  if ((options.allowedMutations ?? []).length === 0) assertOperationalOverridePostImages(repoRoot);
  return result;
}

export function baselineRecordForPath(repoRoot, repositoryPath) {
  return loadTemplateBaseline(repoRoot).files.find(record => record.path === repositoryPath);
}
