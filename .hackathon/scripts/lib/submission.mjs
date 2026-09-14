import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONTRACT_LIMITS,
  REPOSITORY_ROOT,
  comparePosixPaths,
  readJsonFile,
  renameWithRetry,
  resolveInside,
  resolveUtcTimestamp,
  sha256
} from './common.mjs';
import { loadTemplateConfiguration } from './baseline.mjs';
import { compilePathPattern } from './glob.mjs';
import { classifyActiveCustomization } from './neutral.mjs';
import { loadChallengePack, rulesForCondition } from './pack.mjs';
import { validateRunState } from './run-state.mjs';
import {
  assertCollectibleSubmissionPath,
  assertNoSensitiveText,
  inertBundlePath,
  redactSubmissionText,
  submissionTextBytes
} from './submission-format.mjs';
import { verifyChallengeRun } from './verify-run.mjs';

export { inertBundlePath, redactSubmissionText } from './submission-format.mjs';

export function exportSubmission({
  repoRoot = REPOSITORY_ROOT,
  packDirectory,
  now
}) {
  const resolvedRepo = path.resolve(repoRoot);
  const configuration = loadTemplateConfiguration(resolvedRepo);
  const runStatePath = resolveInside(resolvedRepo, configuration.runState, 'Run-state path');
  const state = validateRunState(readJsonFile(runStatePath, 'Run state'));
  assert.equal(state.stage, 'submitted', 'Run must be verified at stage submitted before export');
  const runVerification = verifyChallengeRun({ repoRoot: resolvedRepo, packDirectory });
  const pack = loadChallengePack(packDirectory);
  const rules = rulesForCondition(pack.manifest, state.condition);
  const outputPath = resolveInside(resolvedRepo, configuration.submissionDirectory, 'Submission directory');
  assert.ok(!existsSync(outputPath), `Submission directory already exists: ${configuration.submissionDirectory}`);

  const additionExpressions = rules.allowedAdditions.map(record => compilePathPattern(record.pattern));
  const submissionExpressions = rules.submissionFiles.map(record => ({
    record,
    expression: compilePathPattern(record.pattern),
    matches: []
  }));
  const candidateKinds = new Map();
  for (const source of runVerification.declaredChanges.participantAdditions) {
    candidateKinds.set(source, 'participant-addition');
  }
  for (const source of runVerification.declaredChanges.baselineMutations) {
    candidateKinds.set(source, 'baseline-mutation');
  }
  for (const record of runVerification.evidence) {
    candidateKinds.set(record.path, 'evidence');
  }
  const candidates = [...candidateKinds.keys()].sort(comparePosixPaths);
  for (const source of candidates) {
    for (const selection of submissionExpressions) {
      if (selection.expression.test(source)) selection.matches.push(source);
    }
  }
  for (const selection of submissionExpressions) {
    assert.ok(selection.matches.length > 0,
      `Submission pattern matched no participant file: ${selection.record.pattern}`);
  }
  const sources = [...new Set(submissionExpressions.flatMap(selection => selection.matches))]
    .sort(comparePosixPaths);
  assert.ok(sources.length <= CONTRACT_LIMITS.maxSubmissionFiles,
    `Submission exceeds ${CONTRACT_LIMITS.maxSubmissionFiles} files`);

  const staged = path.join(resolvedRepo, `.submission-${randomUUID()}`);
  mkdirSync(staged);
  let published = false;
  const artifacts = [];
  const bundlePaths = new Set();
  let totalBytes = 0;
  try {
    for (const source of sources) {
      const kind = candidateKinds.get(source);
      if (kind === 'participant-addition') {
        assert.ok(additionExpressions.some(expression => expression.test(source)),
          `Submission source is not a current-condition allowed addition: ${source}`);
      }
      if (classifyActiveCustomization(source)) {
        assert.equal(kind, 'participant-addition',
          `Active customization must be a participant addition: ${source}`);
      }
      assertCollectibleSubmissionPath(source);
      const sourceBytes = readFileSync(resolveInside(resolvedRepo, source, 'Submission source'));
      assert.ok(sourceBytes.length <= CONTRACT_LIMITS.maxSubmissionFileBytes,
        `Submission file exceeds ${CONTRACT_LIMITS.maxSubmissionFileBytes} bytes: ${source}`);
      const redacted = redactSubmissionText(submissionTextBytes(sourceBytes, source));
      assertNoSensitiveText(redacted.text, source);
      const bundleBytes = Buffer.from(redacted.text, 'utf8');
      totalBytes += bundleBytes.length;
      assert.ok(totalBytes <= CONTRACT_LIMITS.maxSubmissionTotalBytes,
        `Submission exceeds ${CONTRACT_LIMITS.maxSubmissionTotalBytes} bytes`);
      const bundlePath = inertBundlePath(source);
      assert.ok(!bundlePaths.has(bundlePath), `Flattened submission name collision: ${bundlePath}`);
      bundlePaths.add(bundlePath);
      const bundleFile = resolveInside(staged, bundlePath, 'Submission bundle path');
      mkdirSync(path.dirname(bundleFile), { recursive: true });
      writeFileSync(bundleFile, bundleBytes, { flag: 'wx', mode: 0o600 });
      artifacts.push({
        source,
        kind,
        bundlePath,
        sourceSha256: sha256(sourceBytes),
        sha256: sha256(bundleBytes),
        bytes: bundleBytes.length,
        redactions: redacted.redactions
      });
    }

    const submission = {
      schemaVersion: 1,
      challengeId: state.challengeId,
      challengeVersion: state.challengeVersion,
      runId: state.runId,
      teamId: state.teamId,
      condition: state.condition,
      templateVersion: state.templateVersion,
      sourceTreeSha256: state.sourceTreeSha256,
      templateTreeSha256: state.templateTreeSha256,
      baselineTreeSha256: state.baselineTreeSha256,
      packSha256: state.packSha256,
      artifacts,
      verification: {
        baseline: 'pass',
        declaredChanges: 'pass',
        runtimeBehavior: 'not-observed',
        educationalEffect: 'not-observed'
      },
      createdAt: resolveUtcTimestamp(now)
    };
    writeFileSync(path.join(staged, 'submission.json'), `${JSON.stringify(submission, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 });
    renameWithRetry(staged, outputPath);
    published = true;
    verifyChallengeRun({ repoRoot: resolvedRepo, packDirectory });
    return { ...submission, directory: configuration.submissionDirectory };
  } catch (error) {
    try {
      if (existsSync(staged)) rmSync(staged, { recursive: true, force: true });
      if (published && existsSync(outputPath)) rmSync(outputPath, { recursive: true, force: true });
    } catch {
      // Preserve the original export error.
    }
    throw error;
  }
}
