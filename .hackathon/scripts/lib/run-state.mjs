import assert from 'node:assert/strict';
import {
  IDENTIFIER_PATTERN,
  SHA256_PATTERN,
  assertExactKeys,
  assertNonEmptyString,
  assertSafeRelativePosixPath,
  comparePosixPaths
} from './common.mjs';
import { validateIsolation } from './pack.mjs';

const STAGES = ['applied', 'in-progress', 'submitted'];

export function stageRank(stage) {
  return STAGES.indexOf(stage);
}

export function validateRunState(state) {
  assertExactKeys(state, [
    'schemaVersion',
    'stage',
    'challengeId',
    'challengeVersion',
    'runId',
    'teamId',
    'condition',
    'packSha256',
    'templateVersion',
    'sourceTreeSha256',
    'templateTreeSha256',
    'baselineTreeSha256',
    'isolation',
    'appliedFiles',
    'git',
    'createdAt',
    'updatedAt'
  ], 'run state');
  assert.equal(state.schemaVersion, 1, 'Unsupported run-state schema version');
  assert.ok(STAGES.includes(state.stage), `Unsupported run stage: ${state.stage}`);
  assert.match(state.challengeId, /^HC-[0-9]{3}$/, 'Invalid run challengeId');
  assert.ok(Number.isInteger(state.challengeVersion) && state.challengeVersion >= 1,
    'Invalid run challengeVersion');
  for (const field of ['runId', 'teamId', 'condition']) {
    assertNonEmptyString(state[field], `run ${field}`, 128);
    assert.match(state[field], IDENTIFIER_PATTERN, `run ${field} has invalid characters`);
  }
  assert.match(state.condition, /^[a-z][a-z0-9-]{0,31}$/, 'Invalid run condition');
  assert.match(state.packSha256, SHA256_PATTERN, 'Invalid run packSha256');
  assert.equal(state.templateVersion, 1, 'Unsupported run templateVersion');
  assert.match(state.sourceTreeSha256, SHA256_PATTERN, 'Invalid run sourceTreeSha256');
  assert.match(state.templateTreeSha256, SHA256_PATTERN, 'Invalid run templateTreeSha256');
  assert.match(state.baselineTreeSha256, SHA256_PATTERN, 'Invalid run baselineTreeSha256');
  assert.equal(state.baselineTreeSha256, state.templateTreeSha256,
    'run baselineTreeSha256 must equal the actual template tree SHA-256');
  validateIsolation(state.isolation);

  assert.ok(Array.isArray(state.appliedFiles), 'run appliedFiles must be an array');
  const paths = [];
  for (const record of state.appliedFiles) {
    assertExactKeys(record, ['destination', 'sha256'], 'run applied-file record');
    assertSafeRelativePosixPath(record.destination, 'Applied destination');
    assert.ok(record.destination.startsWith('.hackathon/challenge/') && record.destination.endsWith('.template'),
      `Run applied destination must remain inert: ${record.destination}`);
    assert.match(record.sha256, SHA256_PATTERN, `Invalid applied-file SHA-256: ${record.destination}`);
    paths.push(record.destination);
  }
  assert.equal(new Set(paths.map(value => value.normalize('NFC').toLowerCase())).size, paths.length,
    'run appliedFiles contain an NFC/case-insensitive collision');
  assert.deepEqual(paths, [...paths].sort(comparePosixPaths), 'run appliedFiles must be bytewise sorted');

  assertExactKeys(state.git, ['commit', 'branch', 'dirty'], 'run git metadata');
  assert.ok(state.git.commit === null || /^[0-9a-f]{40}$/.test(state.git.commit), 'Invalid run git.commit');
  assert.ok(state.git.branch === null
    || (typeof state.git.branch === 'string' && state.git.branch.length > 0 && state.git.branch.length <= 255),
  'Invalid run git.branch');
  assert.ok(state.git.dirty === null || typeof state.git.dirty === 'boolean', 'Invalid run git.dirty');

  for (const field of ['createdAt', 'updatedAt']) {
    assert.match(state[field], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      `run ${field} must be UTC seconds plus Z`);
    assert.equal(new Date(state[field]).toISOString().replace(/\.\d{3}Z$/, 'Z'), state[field],
      `run ${field} is not a real timestamp`);
  }
  assert.ok(new Date(state.updatedAt) >= new Date(state.createdAt), 'run updatedAt precedes createdAt');
  return state;
}
