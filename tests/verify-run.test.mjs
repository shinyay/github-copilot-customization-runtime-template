import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyChallengePack } from '../.hackathon/scripts/lib/apply.mjs';
import { sha256 } from '../.hackathon/scripts/lib/common.mjs';
import { verifyChallengeRun } from '../.hackathon/scripts/lib/verify-run.mjs';
import {
  copyGenericPack,
  createTemplateFixture,
  destroyFixture,
  mutatePack,
  readJson,
  run,
  writeJson,
  writeText
} from './helpers/runtime-fixture.mjs';

function applyCustomized(fixture, pack) {
  return applyChallengePack({
    repoRoot: fixture.repo,
    packDirectory: pack,
    teamId: 'team-01',
    condition: 'customized',
    runId: 'run-01',
    now: '2026-09-14T00:00:00Z'
  });
}

test('allows declared participant additions and enforces evidence only at submitted', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    applyCustomized(fixture, pack);
    const active = path.join(fixture.repo, '.github', 'copilot-instructions.md');
    writeText(active, '# Participant customization\n');
    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'notes.txt'), 'supplemental evidence\n');
    const inProgress = verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'in-progress',
      now: '2026-09-14T00:01:00Z'
    });
    assert.equal(inProgress.stage, 'in-progress');
    assert.deepEqual(inProgress.declaredChanges.participantAdditions,
      ['.github/copilot-instructions.md']);
    assert.throws(() => verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:02:00Z'
    }), /Required evidence is missing/);

    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'), '# Summary\n\nIncomplete.\n');
    assert.throws(() => verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:02:00Z'
    }), /missing heading "Validation"/);

    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
      '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
    assert.throws(() => verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:00:30Z'
    }), /updatedAt cannot move backwards/);
    assert.equal(readJson(path.join(fixture.repo, '.hackathon', 'run.json')).stage, 'in-progress');
    const submitted = verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:02:00Z'
    });
    assert.equal(submitted.stage, 'submitted');
    assert.equal(submitted.evidence.length, 1);
    const state = readJson(path.join(fixture.repo, '.hackathon', 'run.json'));
    assert.equal(state.updatedAt, '2026-09-14T00:02:00Z');
  } finally {
    destroyFixture(fixture);
  }
});

test('rejects undeclared mutations, additions, and active customizations', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    applyCustomized(fixture, pack);
    const runtimeDoc = path.join(fixture.repo, 'docs', 'runtime-contract.md');
    writeFileSync(runtimeDoc, `${readFileSync(runtimeDoc, 'utf8')}\nmutation\n`);
    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      error => error.message.includes('Template-owned')
        && error.message.includes('docs/runtime-contract.md')
        && (error.message.includes('byte length changed') || error.message.includes('SHA-256 changed')));
  } finally {
    destroyFixture(fixture);
  }

  const activeFixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(activeFixture);
    applyCustomized(activeFixture, pack);
    writeText(path.join(activeFixture.repo, '.vscode', 'mcp.json'), '{}\n');
    assert.throws(() => verifyChallengeRun({ repoRoot: activeFixture.repo, packDirectory: pack }),
      /Repository ownership violations/);
  } finally {
    destroyFixture(activeFixture);
  }
});

test('allows only exact declared baseline mutations with an optional expected hash', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const baselinePath = 'database/001-common.sql';
    const original = readFileSync(path.join(fixture.repo, ...baselinePath.split('/')));
    const postImage = Buffer.concat([original, Buffer.from('\n-- participant mutation\n')]);
    mutatePack(pack, manifest => {
      manifest.allowedMutations.push({
        path: baselinePath,
        conditions: ['customized'],
        expectedSha256: sha256(postImage)
      });
    });
    applyCustomized(fixture, pack);
    writeFileSync(path.join(fixture.repo, ...baselinePath.split('/')), postImage);
    const result = verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack });
    assert.deepEqual(result.declaredChanges.baselineMutations, [baselinePath]);
  } finally {
    destroyFixture(fixture);
  }
});

test('wrong expected mutation post-image cannot leave a submitted success-shaped state', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const baselinePath = 'database/001-common.sql';
    mutatePack(pack, manifest => {
      manifest.allowedMutations.push({
        path: baselinePath,
        conditions: ['customized'],
        expectedSha256: sha256(Buffer.from('required post-image\n'))
      });
    });
    applyCustomized(fixture, pack);
    writeText(path.join(fixture.repo, ...baselinePath.split('/')), 'wrong post-image\n');
    writeText(path.join(fixture.repo, '.github', 'copilot-instructions.md'), '# Participant customization\n');
    writeText(path.join(fixture.repo, '.hackathon', 'evidence', 'summary.md'),
      '# Summary\n\nParticipant authored.\n\n## Validation\n\nStatic checks only.\n');
    assert.throws(() => verifyChallengeRun({
      repoRoot: fixture.repo,
      packDirectory: pack,
      requestedStage: 'submitted',
      now: '2026-09-14T00:02:00Z'
    }), /does not match expected post-image SHA-256/);
    assert.equal(readJson(path.join(fixture.repo, '.hackathon', 'run.json')).stage, 'applied');
  } finally {
    destroyFixture(fixture);
  }
});

test('forbiddenActiveCustomizations adds a deny even when addition is otherwise allowed', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.allowedAdditions = [{
        pattern: '.vscode/mcp.json',
        conditions: ['customized']
      }];
      manifest.submissionFiles = [{
        pattern: '.vscode/mcp.json',
        conditions: ['customized']
      }];
    });
    applyCustomized(fixture, pack);
    writeText(path.join(fixture.repo, '.vscode', 'mcp.json'), '{}\n');
    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      /explicitly forbidden by the pack/);
  } finally {
    destroyFixture(fixture);
  }
});

test('overlapping allowed-addition patterns retain participant ownership', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.allowedAdditions.push({
        pattern: '.github/*',
        conditions: ['customized']
      });
    });
    applyCustomized(fixture, pack);
    writeText(path.join(fixture.repo, '.github', 'copilot-instructions.md'), '# Participant customization\n');
    const result = verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack });
    assert.deepEqual(result.declaredChanges.participantAdditions,
      ['.github/copilot-instructions.md']);
  } finally {
    destroyFixture(fixture);
  }
});

test('safe reset refuses branch-unsafe condition changes and modified starters', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.isolation.branchSafe = false;
    });
    applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'baseline',
      runId: 'baseline-run',
      now: '2026-09-14T00:00:00Z'
    });
    assert.throws(() => applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'customized-run',
      reset: true,
      now: '2026-09-14T00:01:00Z'
    }), /conditionStrategy=single-workspace and branchSafe=true/);
    assert.equal(readJson(path.join(fixture.repo, '.hackathon', 'run.json')).condition, 'baseline');
  } finally {
    destroyFixture(fixture);
  }

  const modified = createTemplateFixture();
  try {
    const pack = copyGenericPack(modified);
    applyCustomized(modified, pack);
    const starter = path.join(modified.repo, '.hackathon', 'challenge', 'copilot-instructions.md.template');
    writeText(starter, 'changed\n');
    assert.throws(() => applyChallengePack({
      repoRoot: modified.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'run-02',
      reset: true,
      now: '2026-09-14T00:01:00Z'
    }), /modified starter file/);
    assert.ok(existsSync(path.join(modified.repo, '.hackathon', 'run.json')));
  } finally {
    destroyFixture(modified);
  }
});

test('allows untouched in-place condition reset only for coherent single-workspace branch safety', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    mutatePack(pack, manifest => {
      manifest.isolation.conditionStrategy = 'single-workspace';
      manifest.isolation.branchSafe = true;
    });
    applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'baseline',
      runId: 'baseline-run',
      now: '2026-09-14T00:00:00Z'
    });
    const reset = applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'customized-run',
      reset: true,
      now: '2026-09-14T00:01:00Z'
    });
    assert.equal(reset.state.condition, 'customized');
    assert.equal(reset.state.runId, 'customized-run');
  } finally {
    destroyFixture(fixture);
  }
});

test('pins the Git branch when branchSafe is false', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    applyCustomized(fixture, pack);
    const checkout = run('git', ['checkout', '-q', '--detach'], { cwd: fixture.repo });
    assert.equal(checkout.status, 0, checkout.stderr);
    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      /Current Git HEAD is detached/);
    assert.throws(() => applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'replacement-run',
      reset: true,
      now: '2026-09-14T00:01:00Z'
    }), /Current Git HEAD is detached/);
  } finally {
    destroyFixture(fixture);
  }
});

test('rejects branchSafe=false apply from detached HEAD', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const checkout = run('git', ['checkout', '-q', '--detach'], { cwd: fixture.repo });
    assert.equal(checkout.status, 0, checkout.stderr);
    assert.throws(() => applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'baseline',
      runId: 'detached-run',
      now: '2026-09-14T00:00:00Z'
    }), /requires a named Git branch/);
    assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'run.json')));
  } finally {
    destroyFixture(fixture);
  }
});

test('rejects a recorded detached run after returning to a named branch', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    applyCustomized(fixture, pack);
    const runStatePath = path.join(fixture.repo, '.hackathon', 'run.json');
    const state = readJson(runStatePath);
    state.git.branch = null;
    writeJson(runStatePath, state);
    assert.throws(() => verifyChallengeRun({ repoRoot: fixture.repo, packDirectory: pack }),
      /Recorded branchSafe=false run has a detached Git HEAD/);
    assert.throws(() => applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'replacement-run',
      reset: true,
      now: '2026-09-14T00:01:00Z'
    }), /Recorded branchSafe=false run has a detached Git HEAD/);
  } finally {
    destroyFixture(fixture);
  }
});
