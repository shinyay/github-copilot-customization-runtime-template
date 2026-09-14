import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTRACT_LIMITS,
  REPOSITORY_ROOT,
  SOURCE_OWNERSHIP,
  VERIFICATION_RESULTS,
  assertExactKeys,
  readJsonFile,
  resolveInside,
  sha256
} from './common.mjs';
import { loadTemplateConfiguration } from './baseline.mjs';
import { loadChallengePack } from './pack.mjs';

export function verifySupportedContracts(repoRoot = REPOSITORY_ROOT) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const file = resolveInside(repoRoot, configuration.supportedContracts, 'Supported contracts path');
  const contracts = readJsonFile(file, 'Supported contracts');
  assertExactKeys(contracts, [
    'schemaVersion',
    'templateVersion',
    'acceptedPackSchemaVersions',
    'algorithms',
    'challengePackSchema',
    'runStateSchema',
    'globConformance',
    'packHashConformance',
    'genericPack',
    'sourceOwnership',
    'verificationResults',
    'limits'
  ], 'supported contracts');
  assert.equal(contracts.schemaVersion, 1);
  assert.equal(contracts.templateVersion, configuration.templateVersion);
  assert.deepEqual(contracts.acceptedPackSchemaVersions, [1]);
  assert.deepEqual(contracts.algorithms, {
    baselineTree: 'baseline-tree-v1',
    packHash: 'pack-hash-v1',
    pathGlob: 'path-glob-v1'
  });
  assert.deepEqual(contracts.sourceOwnership, SOURCE_OWNERSHIP);
  assert.deepEqual(contracts.verificationResults, VERIFICATION_RESULTS);
  assert.deepEqual(contracts.limits, CONTRACT_LIMITS);
  assert.equal(contracts.challengePackSchema.path, configuration.challengePackSchema);
  assert.equal(contracts.challengePackSchema.sha256, configuration.challengePackSchemaSha256);
  const schemaBytes = readFileSync(resolveInside(repoRoot, contracts.challengePackSchema.path,
    'Challenge Pack schema path'));
  assert.equal(sha256(schemaBytes), contracts.challengePackSchema.sha256,
    'Vendored Challenge Pack schema SHA-256 mismatch');
  const runStateSchemaBytes = readFileSync(resolveInside(repoRoot, contracts.runStateSchema.path,
    'Run-state schema path'));
  assert.equal(sha256(runStateSchemaBytes), contracts.runStateSchema.sha256,
    'Run-state schema SHA-256 mismatch');
  JSON.parse(runStateSchemaBytes.toString('utf8'));
  const globBytes = readFileSync(resolveInside(repoRoot, contracts.globConformance.path,
    'Glob conformance fixture path'));
  assert.equal(sha256(globBytes), contracts.globConformance.sha256,
    'Glob conformance fixture SHA-256 mismatch');
  const packHashBytes = readFileSync(resolveInside(repoRoot, contracts.packHashConformance.path,
    'Pack hash conformance fixture path'));
  assert.equal(sha256(packHashBytes), contracts.packHashConformance.sha256,
    'Pack hash conformance fixture file SHA-256 mismatch');
  const packHashFixture = JSON.parse(packHashBytes.toString('utf8'));
  const records = [...packHashFixture.files]
    .sort((left, right) => Buffer.from(left.relativePath, 'utf8').compare(Buffer.from(right.relativePath, 'utf8')))
    .map(record => {
      const bytes = Buffer.from(record.contentBase64, 'base64');
      return `${record.relativePath}\0${packHashFixture.mode}\0${bytes.length}\0${sha256(bytes)}\n`;
    });
  assert.equal(sha256(Buffer.from(records.join(''), 'utf8')), contracts.packHashConformance.expectedPackSha256,
    'Pack hash conformance aggregate SHA-256 mismatch');
  const genericPack = loadChallengePack(resolveInside(repoRoot, contracts.genericPack.path,
    'Generic Pack path'));
  assert.equal(genericPack.sha256, contracts.genericPack.sha256,
    'Generic Challenge Pack SHA-256 mismatch');
  return contracts;
}
