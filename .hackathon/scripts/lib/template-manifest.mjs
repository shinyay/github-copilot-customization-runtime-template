import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPOSITORY_ROOT,
  assertAllowedKeys,
  assertExactKeys,
  assertNoPathCollisions,
  assertSafeRelativePosixPath,
  comparePosixPaths,
  readJsonFile,
  resolveInside,
  sha256,
  walkOwnedRepositoryFiles
} from './common.mjs';
import { loadTemplateBaseline, loadTemplateConfiguration } from './baseline.mjs';

export function loadTemplateManifest(repoRoot = REPOSITORY_ROOT, { verifyFiles = true } = {}) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const manifestPath = resolveInside(repoRoot, configuration.templateManifest, 'Template manifest path');
  const manifest = readJsonFile(manifestPath, 'Template-owned manifest');
  assertExactKeys(manifest,
    ['schemaVersion', 'templateVersion', 'sourceTreeSha256', 'templateTreeSha256', 'ownership', 'files'],
    'template-owned manifest');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.templateVersion, 1);
  assert.equal(manifest.sourceTreeSha256, configuration.sourceTreeSha256);
  assert.equal(manifest.templateTreeSha256, configuration.templateTreeSha256);
  assert.deepEqual(manifest.ownership,
    ['baseline-owned', 'template-owned', 'run-state', 'pack-applied', 'participant-addition',
      'submission-bundle', 'ignored', 'violation']);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'Template-owned files must be non-empty');

  const baselinePaths = new Set(loadTemplateBaseline(repoRoot).files.map(record => record.path));
  const paths = [];
  let selfRecords = 0;
  for (const record of manifest.files) {
    assertAllowedKeys(record, ['path'], ['mode', 'bytes', 'sha256', 'integrity'], 'template-owned file');
    assertSafeRelativePosixPath(record.path, 'Template-owned path');
    assert.ok(!/^\.tmp-(?:source|upstream)(?:\/|$)/.test(record.path)
      && !/^\.source-cache(?:\/|$)/.test(record.path),
    `Source clone/cache paths cannot be template-owned: ${record.path}`);
    assert.ok(!baselinePaths.has(record.path), `Baseline path cannot also be template-owned: ${record.path}`);
    paths.push(record.path);
    if (record.integrity === 'self') {
      selfRecords += 1;
      assert.deepEqual(record, { path: configuration.templateManifest, integrity: 'self' },
        'Only template-manifest.json may use self integrity');
      continue;
    }
    assertExactKeys(record, ['path', 'mode', 'bytes', 'sha256'], 'template-owned file record');
    assert.equal(record.mode, '100644');
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    if (verifyFiles) {
      const file = resolveInside(repoRoot, record.path, 'Template-owned path');
      assert.ok(existsSync(file), `Template-owned file is missing: ${record.path}`);
      const bytes = readFileSync(file);
      assert.equal(bytes.length, record.bytes, `Template-owned byte length changed: ${record.path}`);
      assert.equal(sha256(bytes), record.sha256, `Template-owned SHA-256 changed: ${record.path}`);
    }
  }
  assert.equal(selfRecords, 1, 'Template-owned manifest must contain exactly one self record');
  assertNoPathCollisions(paths, 'Template-owned paths');
  assert.deepEqual(paths, [...paths].sort(comparePosixPaths), 'Template-owned paths must be bytewise sorted');
  return manifest;
}

export function buildTemplateManifest(repoRoot = REPOSITORY_ROOT) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const baselinePaths = new Set(loadTemplateBaseline(repoRoot).files.map(record => record.path));
  const repositoryFiles = walkOwnedRepositoryFiles(repoRoot)
  const prohibitedState = repositoryFiles.filter(repositoryPath =>
    repositoryPath === configuration.runState
    || repositoryPath.startsWith(`${configuration.evidenceRoot}/`)
    || repositoryPath.startsWith(`${configuration.challengeRoot}/`)
    || repositoryPath.startsWith(`${configuration.submissionDirectory}/`)
    || /^\.tmp-(?:source|upstream)(?:\/|$)/.test(repositoryPath)
    || /^\.source-cache(?:\/|$)/.test(repositoryPath));
  assert.deepEqual(prohibitedState, [],
    `Refusing to build a template manifest with run/output/source-cache paths: ${prohibitedState.join(', ')}`);
  const files = repositoryFiles
    .filter(repositoryPath => !baselinePaths.has(repositoryPath))
    .map(repositoryPath => {
      if (repositoryPath === configuration.templateManifest) {
        return { path: repositoryPath, integrity: 'self' };
      }
      const bytes = readFileSync(resolveInside(repoRoot, repositoryPath, 'Template-owned path'));
      return { path: repositoryPath, mode: '100644', bytes: bytes.length, sha256: sha256(bytes) };
    })
    .sort((left, right) => comparePosixPaths(left.path, right.path));
  assert.ok(files.some(record => record.path === configuration.templateManifest && record.integrity === 'self'),
    'Template manifest file must exist before rebuilding');
  return {
    schemaVersion: 1,
    templateVersion: 1,
    sourceTreeSha256: configuration.sourceTreeSha256,
    templateTreeSha256: configuration.templateTreeSha256,
    ownership: [
      'baseline-owned',
      'template-owned',
      'run-state',
      'pack-applied',
      'participant-addition',
      'submission-bundle',
      'ignored',
      'violation'
    ],
    files
  };
}
