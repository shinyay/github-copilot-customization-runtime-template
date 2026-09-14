import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONTRACT_LIMITS,
  REPOSITORY_ROOT,
  comparePosixPaths,
  readGitMetadata,
  readJsonFile,
  replaceJsonAtomic,
  resolveInside,
  resolveUtcTimestamp,
  sha256
} from './common.mjs';
import { loadTemplateBaseline, loadTemplateConfiguration } from './baseline.mjs';
import { compilePathPattern } from './glob.mjs';
import { classifyActiveCustomization } from './neutral.mjs';
import { verifyRunOwnership } from './ownership.mjs';
import { loadChallengePack, rulesForCondition } from './pack.mjs';
import { stageRank, validateRunState } from './run-state.mjs';

function escapeRegularExpression(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function verifyEvidence(repoRoot, requirements) {
  const evidence = [];
  for (const requirement of requirements) {
    const file = resolveInside(repoRoot, requirement.path, 'Evidence path');
    assert.ok(existsSync(file), `Required evidence is missing: ${requirement.path}`);
    const bytes = readFileSync(file);
    assert.ok(bytes.length <= CONTRACT_LIMITS.maxEvidenceFileBytes,
      `Evidence exceeds ${CONTRACT_LIMITS.maxEvidenceFileBytes} bytes: ${requirement.path}`);
    assert.ok(!bytes.includes(0), `Evidence must be UTF-8 text: ${requirement.path}`);
    const text = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(text, 'utf8'), bytes, `Evidence must be valid UTF-8: ${requirement.path}`);
    for (const heading of requirement.requiredHeadings) {
      const expression = new RegExp(`^#{1,6}\\s+${escapeRegularExpression(heading)}\\s*$`, 'm');
      assert.match(text, expression, `Evidence is missing heading "${heading}": ${requirement.path}`);
    }
    const fileSha256 = sha256(bytes);
    if (requirement.templateSha256 !== undefined) {
      assert.notEqual(fileSha256, requirement.templateSha256,
        `Evidence still has the unmodified template SHA-256: ${requirement.path}`);
    }
    evidence.push({ path: requirement.path, sha256: fileSha256, bytes: bytes.length });
  }
  return evidence;
}

export function verifyChallengeRun({
  repoRoot = REPOSITORY_ROOT,
  packDirectory,
  requestedStage,
  now
}) {
  const resolvedRepo = path.resolve(repoRoot);
  const configuration = loadTemplateConfiguration(resolvedRepo);
  const baseline = loadTemplateBaseline(resolvedRepo);
  const pack = loadChallengePack(packDirectory);
  const runStatePath = resolveInside(resolvedRepo, configuration.runState, 'Run-state path');
  assert.ok(existsSync(runStatePath), `Run state is missing: ${configuration.runState}`);
  let state = validateRunState(readJsonFile(runStatePath, 'Run state'));
  const rules = rulesForCondition(pack.manifest, state.condition);

  assert.equal(state.challengeId, pack.manifest.challengeId, 'Run challengeId does not match the pack');
  assert.equal(state.challengeVersion, pack.manifest.challengeVersion, 'Run challengeVersion does not match the pack');
  assert.equal(state.packSha256, pack.sha256, 'Run packSha256 does not match the pack bytes');
  assert.equal(state.templateVersion, configuration.templateVersion, 'Run templateVersion does not match the template');
  assert.equal(state.sourceTreeSha256, configuration.sourceTreeSha256,
    'Run sourceTreeSha256 does not match the template');
  assert.equal(state.templateTreeSha256, configuration.templateTreeSha256,
    'Run templateTreeSha256 does not match the template');
  assert.equal(state.baselineTreeSha256, configuration.templateTreeSha256,
    'Run baselineTreeSha256 does not match the actual template baseline');
  assert.deepEqual(state.isolation, pack.manifest.isolation, 'Run isolation does not match the pack');
  if (!state.isolation.branchSafe) {
    const currentGit = readGitMetadata(resolvedRepo);
    if (state.git.commit !== null) {
      assert.notEqual(state.git.branch, null,
        'Recorded branchSafe=false run has a detached Git HEAD');
      assert.notEqual(currentGit.commit, null,
        'Current Git metadata is unavailable for a branchSafe=false run');
      assert.notEqual(currentGit.branch, null,
        'Current Git HEAD is detached for a branchSafe=false run');
      assert.equal(currentGit.branch, state.git.branch,
        `Run branch changed while branchSafe is false: ${state.git.branch} -> ${currentGit.branch}`);
    }
  }

  const expectedApplied = pack.overlay
    .filter(entry => entry.conditions.includes(state.condition))
    .map(entry => ({ destination: entry.destination, sha256: entry.sha256 }))
    .sort((left, right) => comparePosixPaths(left.destination, right.destination));
  assert.deepEqual(state.appliedFiles, expectedApplied, 'Run appliedFiles do not match the selected pack overlay');

  const ownership = verifyRunOwnership({ repoRoot: resolvedRepo, state, rules });
  const evidenceRootFiles = ownership.ownership
    .filter(record => record.owner === 'run-state'
      && record.path !== configuration.runState)
    .map(record => record.path);
  assert.ok(evidenceRootFiles.length <= CONTRACT_LIMITS.maxEvidenceFiles,
    `Evidence root exceeds ${CONTRACT_LIMITS.maxEvidenceFiles} files`);
  for (const evidencePath of evidenceRootFiles) {
    const bytes = readFileSync(resolveInside(resolvedRepo, evidencePath, 'Evidence path'));
    assert.ok(bytes.length <= CONTRACT_LIMITS.maxEvidenceFileBytes,
      `Evidence exceeds ${CONTRACT_LIMITS.maxEvidenceFileBytes} bytes: ${evidencePath}`);
  }
  const forbiddenExpressions = pack.manifest.forbiddenActiveCustomizations.map(compilePathPattern);
  const activeFiles = ownership.ownership.filter(record => classifyActiveCustomization(record.path));
  for (const record of activeFiles) {
    assert.equal(record.owner, 'participant-addition',
      `Active customization is not a current-condition participant addition: ${record.path}`);
    assert.ok(!forbiddenExpressions.some(expression => expression.test(record.path)),
      `Active customization is explicitly forbidden by the pack: ${record.path}`);
  }
  if (state.condition === 'baseline') {
    assert.deepEqual(activeFiles, [], 'Baseline condition must contain no active customization');
  }

  let targetStage = state.stage;
  if (requestedStage !== undefined) {
    assert.ok(['applied', 'in-progress', 'submitted'].includes(requestedStage),
      `Unsupported requested stage: ${requestedStage}`);
    assert.ok(stageRank(requestedStage) >= stageRank(state.stage), 'Run stage cannot move backwards');
    targetStage = requestedStage;
  }
  const evidence = targetStage === 'submitted' ? verifyEvidence(resolvedRepo, rules.evidenceRequirements) : [];

  const changedBaseline = rules.allowedMutations.filter(record => {
    const expected = baseline.files.find(candidate => candidate.path === record.path);
    const bytes = readFileSync(resolveInside(resolvedRepo, record.path, 'Allowed mutation path'));
    const actualSha256 = sha256(bytes);
    if (record.expectedSha256 !== undefined) {
      assert.equal(actualSha256, record.expectedSha256,
        `Allowed mutation does not match expected post-image SHA-256: ${record.path}`);
    }
    return actualSha256 !== expected.sha256;
  }).map(record => record.path);
  const participantAdditions = ownership.ownership
    .filter(record => record.owner === 'participant-addition')
    .map(record => record.path)
    .sort(comparePosixPaths);

  if (targetStage !== state.stage) {
    const updatedAt = resolveUtcTimestamp(now);
    assert.ok(new Date(updatedAt) >= new Date(state.updatedAt),
      'Run updatedAt cannot move backwards');
    state = validateRunState({
      ...state,
      stage: targetStage,
      updatedAt
    });
    replaceJsonAtomic(runStatePath, state);
  }

  return {
    status: 'pass',
    stage: state.stage,
    challengeId: state.challengeId,
    runId: state.runId,
    condition: state.condition,
    sourceTreeSha256: state.sourceTreeSha256,
    templateTreeSha256: state.templateTreeSha256,
    baselineTreeSha256: state.baselineTreeSha256,
    packSha256: state.packSha256,
    declaredChanges: {
      baselineMutations: changedBaseline.sort(comparePosixPaths),
      participantAdditions
    },
    evidence
  };
}
