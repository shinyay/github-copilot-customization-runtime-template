import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyChallengePack } from '../.hackathon/scripts/lib/apply.mjs';
import { sha256 } from '../.hackathon/scripts/lib/common.mjs';
import { exportSubmission, inertBundlePath } from '../.hackathon/scripts/lib/submission.mjs';
import { verifyChallengeRun } from '../.hackathon/scripts/lib/verify-run.mjs';
import {
  copyGenericPack,
  createTemplateFixture,
  destroyFixture,
  mutatePack,
  readJson,
  writeText
} from './helpers/runtime-fixture.mjs';

function prepareSubmitted(fixture, pack, activePath = '.github/copilot-instructions.md', activeText = '# Active\n') {
  applyChallengePack({
    repoRoot: fixture.repo,
    packDirectory: pack,
    teamId: 'team-01',
    condition: 'customized',
    runId: 'run-01',
    now: '2026-09-14T00:00:00Z'
  });
  writeText(path.join(fixture.repo, ...activePath.split('/')), activeText);
  writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
    '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
  verifyChallengeRun({
    repoRoot: fixture.repo,
    packDirectory: pack,
    requestedStage: 'submitted',
    now: '2026-09-14T00:01:00Z'
  });
}

test('exports only declared active files under flattened inert names with redaction', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const token = `ghp_${'A'.repeat(24)}`;
    const sourceText = [
      '# Participant customization',
      `token=${token}`,
      'password: super-secret',
      '"client_secret": "quoted secret phrase",',
      'Authorization: Basic dXNlcjpwYXNz',
      'profile=C:\\Users\\alice\\.copilot',
      ''
    ].join('\n');
    prepareSubmitted(fixture, pack, '.github/copilot-instructions.md', sourceText);
    const result = exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });
    assert.equal(result.artifacts.length, 1);
    const artifact = result.artifacts[0];
    assert.equal(artifact.bundlePath, inertBundlePath('.github/copilot-instructions.md'));
    assert.match(artifact.bundlePath, /^artifacts\/[0-9a-f]{64}-copilot-instructions\.md\.template$/);
    const bundled = readFileSync(path.join(fixture.repo, 'submission', ...artifact.bundlePath.split('/')), 'utf8');
    assert.ok(!bundled.includes(token));
    assert.ok(!bundled.includes('alice'));
    assert.ok(!bundled.includes('quoted secret phrase'));
    assert.ok(!bundled.includes('dXNlcjpwYXNz'));
    assert.ok(bundled.includes('[REDACTED]'));
    assert.ok(bundled.includes('%USERPROFILE%'));
    assert.ok(readFileSync(path.join(fixture.repo, '.github', 'copilot-instructions.md'), 'utf8').includes(token),
      'redaction must not alter the participant source');
    const submission = readJson(path.join(fixture.repo, 'submission', 'submission.json'));
    assert.deepEqual(submission.verification, {
      baseline: 'pass',
      declaredChanges: 'pass',
      runtimeBehavior: 'not-observed',
      educationalEffect: 'not-observed'
    });
    assert.equal(submission.sourceTreeSha256,
      'c3cd74e0d65b1ae88a29a4392eb42f9d51ba2c671d111796aacc69fd9cc5b111');
    assert.equal(submission.templateTreeSha256,
      'de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2');
    assert.equal(submission.baselineTreeSha256,
      'de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2');
    assert.equal(verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }).status, 'pass',
      'a validated submission bundle must remain a recognized ownership class');
  } finally {
    destroyFixture(fixture);
  }
});

test('verify-after-export rejects a tampered submission document', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    prepareSubmitted(fixture, pack);
    exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });
    const submissionPath = path.join(fixture.repo, 'submission', 'submission.json');
    const submission = readJson(submissionPath);
    submission.artifacts[0].kind = 'evidence';
    writeText(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      /not eligible for its declared artifact kind/);
  } finally {
    destroyFixture(fixture);
  }
});

test('can export selected additions, declared mutations, and required evidence together', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const mutationPath = 'database/001-common.sql';
    const mutationBytes = Buffer.from('declared post-image\n');
    mutatePack(pack, manifest => {
      manifest.allowedMutations.push({
        path: mutationPath,
        conditions: ['customized'],
        expectedSha256: sha256(mutationBytes)
      });
      manifest.submissionFiles.push(
        { pattern: mutationPath, conditions: ['customized'] },
        { pattern: '.hackathon/evidence/summary.md', conditions: ['customized'] }
      );
    });
    applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'run-01',
      now: '2026-09-14T00:00:00Z'
    });
    writeText(path.join(fixture.repo, '.github', 'copilot-instructions.md'), '# Active\n');
    writeText(path.join(fixture.repo, ...mutationPath.split('/')), mutationBytes.toString('utf8'));
    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
      '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
    verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:01:00Z'
    });
    const result = exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });
    assert.deepEqual(new Set(result.artifacts.map(artifact => artifact.kind)),
      new Set(['participant-addition', 'baseline-mutation', 'evidence']));
    assert.equal(result.artifacts.length, 3);
  } finally {
    destroyFixture(fixture);
  }
});

test('never auto-collects undeclared workspace files', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    prepareSubmitted(fixture, pack);
    writeText(path.join(fixture.repo, 'notes.txt'), 'undeclared\n');
    assert.throws(() => exportSubmission({ repoRoot: fixture.repo, packDirectory: pack }),
      /Repository ownership violations/);
  } finally {
    destroyFixture(fixture);
  }
});

test('hard-fails raw log-like submission paths', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const activePath = '.github/prompts/debug.log.prompt.md';
    mutatePack(pack, manifest => {
      manifest.allowedAdditions = [{ pattern: activePath, conditions: ['customized'] }];
      manifest.submissionFiles = [{ pattern: activePath, conditions: ['customized'] }];
    });
    prepareSubmitted(fixture, pack, activePath, '# Prompt\n');
    assert.throws(() => exportSubmission({ repoRoot: fixture.repo, packDirectory: pack }),
      /never collected/);
  } finally {
    destroyFixture(fixture);
  }
});
