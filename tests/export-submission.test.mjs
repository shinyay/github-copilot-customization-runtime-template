import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyChallengePack } from '../.hackathon/scripts/lib/apply.mjs';
import {
  assertSafeRelativePosixPath,
  comparePosixPaths,
  sha256
} from '../.hackathon/scripts/lib/common.mjs';
import { assertCollectibleSubmissionPath } from '../.hackathon/scripts/lib/submission-format.mjs';
import {
  exportSubmission,
  inertBundlePath,
  redactSubmissionText
} from '../.hackathon/scripts/lib/submission.mjs';
import { verifyChallengeRun } from '../.hackathon/scripts/lib/verify-run.mjs';
import {
  copyGenericPack,
  createTemplateFixture,
  destroyFixture,
  mutatePack,
  readJson,
  writeText
} from './helpers/runtime-fixture.mjs';

function prepareSubmittedFiles(fixture, pack, files) {
  applyChallengePack({
    repoRoot: fixture.repo,
    packDirectory: pack,
    teamId: 'team-01',
    condition: 'customized',
    runId: 'run-01',
    now: '2026-09-14T00:00:00Z'
  });
  for (const file of files) {
    writeText(path.join(fixture.repo, ...file.source.split('/')), file.text);
  }
  writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
    '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
  verifyChallengeRun({
    repoRoot: fixture.repo,
    packDirectory: pack,
    requestedStage: 'submitted',
    now: '2026-09-14T00:01:00Z'
  });
}

function prepareSubmitted(fixture, pack, activePath = '.github/copilot-instructions.md', activeText = '# Active\n') {
  prepareSubmittedFiles(fixture, pack, [{ source: activePath, text: activeText }]);
}

function selectParticipantSubmission(pack, sourcePaths) {
  mutatePack(pack, manifest => {
    manifest.allowedAdditions = sourcePaths.map(pattern => ({
      pattern,
      conditions: ['customized']
    }));
    manifest.submissionFiles = sourcePaths.map(pattern => ({
      pattern,
      conditions: ['customized']
    }));
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

test('verify-after-export requires every eligible source matched by a submission pattern', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.allowedAdditions = [{
        pattern: '.github/prompts/*',
        conditions: ['customized']
      }];
      manifest.submissionFiles = [{
        pattern: '.github/prompts/*',
        conditions: ['customized']
      }];
    });
    applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'run-01',
      now: '2026-09-14T00:00:00Z'
    });
    writeText(path.join(fixture.repo, '.github', 'prompts', 'first.prompt.md'), '# First\n');
    writeText(path.join(fixture.repo, '.github', 'prompts', 'second.prompt.md'), '# Second\n');
    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
      '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
    verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:01:00Z'
    });
    exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });

    const submissionPath = path.join(fixture.repo, 'submission', 'submission.json');
    const submission = readJson(submissionPath);
    assert.equal(submission.artifacts.length, 2);
    const removed = submission.artifacts.pop();
    rmSync(path.join(fixture.repo, 'submission', ...removed.bundlePath.split('/')));
    writeText(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);

    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      /must exactly match the complete eligible source set/);
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
    selectParticipantSubmission(pack, [activePath]);
    prepareSubmitted(fixture, pack, activePath, '# Prompt\n');
    assert.throws(() => exportSubmission({ repoRoot: fixture.repo, packDirectory: pack }),
      /never collected/);
  } finally {
    destroyFixture(fixture);
  }
});

test('exports eligible authored policy documents through redaction and post-export verification', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const token = `ghp_${'P'.repeat(24)}`;
    const sourceText = [
      '# Diagnostic policy',
      `token=${token}`,
      'password: synthetic-secret-value',
      'profile=C:\\Users\\policy-author\\.copilot',
      ''
    ].join('\n');
    const files = [
      {
        source: 'participant/hc-042/diagnostic-policy.md',
        text: sourceText
      },
      {
        source: 'participant/hc-042/route-map.md',
        text: '# Route map\n'
      },
      {
        source: 'participant/hc-042/decisions.md',
        text: '# Decisions\n'
      },
      {
        source: 'participant/hc-042/cases/Diagnostic-Policy.MD',
        text: '# Upper-case diagnostic policy\n'
      },
      {
        source: 'participant/hc-042/cases/PrOmPt-LoG-PoLiCy.mD',
        text: '# Mixed-case prompt-log policy\n'
      }
    ];
    const sourcePaths = files.map(file => file.source);
    selectParticipantSubmission(pack, sourcePaths);
    prepareSubmittedFiles(fixture, pack, files);

    const result = exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });

    assert.deepEqual(
      result.artifacts.map(artifact => artifact.source),
      [...sourcePaths].sort(comparePosixPaths)
    );
    const policyArtifact = result.artifacts.find(
      artifact => artifact.source === 'participant/hc-042/diagnostic-policy.md'
    );
    assert.ok(policyArtifact);
    assert.equal(policyArtifact.sourceSha256, sha256(Buffer.from(sourceText, 'utf8')));
    assert.equal(policyArtifact.bundlePath, inertBundlePath(policyArtifact.source));
    const bundled = readFileSync(path.join(
      fixture.repo,
      'submission',
      ...policyArtifact.bundlePath.split('/')
    ), 'utf8');
    assert.ok(!bundled.includes(token));
    assert.ok(!bundled.includes('synthetic-secret-value'));
    assert.ok(!bundled.includes('policy-author'));
    assert.ok(bundled.includes('[REDACTED]'));
    assert.ok(bundled.includes('%USERPROFILE%'));
    assert.equal(
      readFileSync(path.join(
        fixture.repo,
        'participant',
        'hc-042',
        'diagnostic-policy.md'
      ), 'utf8'),
      sourceText,
      'redaction must not alter the authored policy source'
    );
    assert.equal(
      verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }).status,
      'pass'
    );
  } finally {
    destroyFixture(fixture);
  }
});

test('rejects raw collection names and directories through the supported export flow', () => {
  const sourcePaths = [
    'participant/hc-042/diagnostic-output.json',
    'participant/hc-042/diagnostic/packet.json',
    'diagnostic/packet.json'
  ];
  for (const sourcePath of sourcePaths) {
    const fixture = createTemplateFixture();
    try {
      const pack = copyGenericPack(fixture);
      selectParticipantSubmission(pack, [sourcePath]);
      prepareSubmitted(fixture, pack, sourcePath, 'SYNTHETIC_TEST_ONLY\n');
      assert.throws(
        () => exportSubmission({ repoRoot: fixture.repo, packDirectory: pack }),
        /never collected/,
        sourcePath
      );
      assert.equal(
        existsSync(path.join(fixture.repo, 'submission')),
        false,
        `rejected export must not publish a submission directory: ${sourcePath}`
      );
    } finally {
      destroyFixture(fixture);
    }
  }
});

test('authored policy classification preserves raw, hard, near-miss, case, and path-safety boundaries', () => {
  const rawTopics = [
    'debug',
    'trace',
    'diagnostic',
    'console',
    'transcript',
    'chat',
    'prompt-log'
  ];
  const allowedPaths = [
    'participant/hc-042/diagnostic-policy.md',
    'participant/hc-042/route-map.md',
    'participant/hc-042/decisions.md',
    ...rawTopics.map(topic => `participant/hc-042/${topic}-policy.md`),
    'participant/hc-042/Diagnostic-Policy.MD',
    'participant/hc-042/PrOmPt-LoG-PoLiCy.mD'
  ];
  for (const sourcePath of allowedPaths) {
    assert.doesNotThrow(() => {
      assertSafeRelativePosixPath(sourcePath, 'Submission source');
      assertCollectibleSubmissionPath(sourcePath);
    }, sourcePath);
  }

  const rawPaths = rawTopics.flatMap(topic => [
    `participant/hc-042/${topic}`,
    `participant/hc-042/${topic}.json`,
    `participant/hc-042/${topic}_output.json`,
    `participant/hc-042/${topic}-output.json`,
    `participant/hc-042/${topic}/packet.json`
  ]);
  const collectiblePathRejects = [
    ...rawPaths,
    '.github/prompts/debug.log.prompt.md',
    'participant/hc-042/diagnostic.log',
    'participant/hc-042/trace.dump',
    'participant/hc-042/session.log',
    'participant/hc-042/session.DMP',
    'participant/hc-042/session.dump',
    'participant/hc-042/prompt-log.json',
    'participant/hc-042/diagnostic-output.json',
    'participant/hc-042/diagnostic/packet.json',
    'diagnostic/packet.json',
    'participant/hc-042/DIAGNOSTIC-OUTPUT.JSON',
    'participant/hc-042/PROMPT-LOG.JSON',
    'participant/hc-042/diagnostic-policy.md.bak',
    'participant/hc-042/diagnostic-policy.md/child',
    'participant/hc-042/diagnostic-policy.md-raw',
    'participant/hc-042/diagnostic-policy.md.log',
    '.git/diagnostic-policy.md',
    'target/diagnostic-policy.md',
    'node_modules/diagnostic-policy.md',
    '.env/diagnostic-policy.md'
  ];
  for (const sourcePath of collectiblePathRejects) {
    assert.throws(() => {
      assertSafeRelativePosixPath(sourcePath, 'Submission source');
      assertCollectibleSubmissionPath(sourcePath);
    }, /never collected/, sourcePath);
  }

  const unsafePaths = [
    'participant/hc-042/diagnostic-policy.md.',
    'participant/hc-042/diagnostic-policy.md ',
    'participant\\hc-042\\diagnostic-policy.md',
    'participant//hc-042/diagnostic-policy.md',
    '../participant/hc-042/diagnostic-policy.md',
    '/participant/hc-042/diagnostic-policy.md',
    'C:/repo/participant/hc-042/diagnostic-policy.md'
  ];
  for (const sourcePath of unsafePaths) {
    assert.throws(
      () => assertSafeRelativePosixPath(sourcePath, 'Submission source'),
      undefined,
      sourcePath
    );
  }
});

test('redacts raw and JSON-escaped Windows profile paths from MCP submissions', () => {
  const rawPaths = [
    String.raw`C:\Users\alice\repo`,
    String.raw`c:\users\alice\repo`,
    String.raw`C:\Users\Alice Smith\repo`
  ].join('\n');
  const rawRedacted = redactSubmissionText(rawPaths).text;
  assert.ok(!/alice/i.test(rawRedacted));
  assert.equal((rawRedacted.match(/%USERPROFILE%/g) ?? []).length, 3);

  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.allowedAdditions = [{
        pattern: '.vscode/mcp.json',
        conditions: ['customized']
      }];
      manifest.forbiddenActiveCustomizations =
        manifest.forbiddenActiveCustomizations.filter(pattern => pattern !== '.vscode/mcp.json');
      manifest.submissionFiles = [{
        pattern: '.vscode/mcp.json',
        conditions: ['customized']
      }];
    });
    const sourceText = [
      '{',
      '  "escaped": "C:\\\\Users\\\\alice\\\\repo",',
      '  "lower": "c:\\\\users\\\\alice\\\\repo",',
      '  "spaced": "C:\\\\Users\\\\Alice Smith\\\\repo"',
      '}',
      ''
    ].join('\n');
    prepareSubmitted(fixture, pack, '.vscode/mcp.json', sourceText);
    const result = exportSubmission({
      repoRoot: fixture.repo,
      packDirectory: pack,
      now: '2026-09-14T00:02:00Z'
    });
    const bundled = readFileSync(path.join(
      fixture.repo,
      'submission',
      ...result.artifacts[0].bundlePath.split('/')
    ), 'utf8');
    assert.ok(!/users|alice/i.test(bundled));
    assert.equal((bundled.match(/%USERPROFILE%/g) ?? []).length, 3);
  } finally {
    destroyFixture(fixture);
  }
});
