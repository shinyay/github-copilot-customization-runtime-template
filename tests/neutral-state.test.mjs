import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyNeutralState } from '../.hackathon/scripts/lib/neutral.mjs';
import { REPOSITORY_ROOT } from './helpers/runtime-fixture.mjs';

function temporaryDirectory() {
  return mkdtempSync(path.join(os.tmpdir(), 'neutral-state-test-'));
}

function write(root, relative, content = 'test\n') {
  const file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test('template state is neutral and inert sources are excluded', () => {
  assert.equal(verifyNeutralState(REPOSITORY_ROOT).status, 'pass');
  const root = temporaryDirectory();
  try {
    write(root, '.hackathon/fixtures/payload/AGENTS.md.template');
    write(root, 'examples/example.agent.md.template');
    assert.equal(verifyNeutralState(root).status, 'pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('default-denies every active customization family and participant state', async t => {
  const paths = [
    '.github/copilot-instructions.md',
    '.github/instructions/example.instructions.md',
    '.github/agents/example.agent.md',
    '.github/prompts/example.prompt.md',
    '.github/skills/example/SKILL.md',
    '.vscode/mcp.json',
    '.github/hooks/hooks.json',
    '.github/plugins/example/plugin.json',
    '.github/copilot/plugin-settings.json',
    'AGENTS.md',
    'nested/CLAUDE.md',
    '.claude/settings.json',
    '.cursor/rules/example.mdc',
    '.github/payload/AGENTS.md',
    '.hackathon/run.json',
    '.hackathon/evidence/result.md',
    'submission/submission.json',
    'participant-evidence/notes.md',
    'docs/answer-key.md'
  ];
  for (const repositoryPath of paths) {
    await t.test(repositoryPath, () => {
      const root = temporaryDirectory();
      try {
        write(root, repositoryPath);
        assert.throws(() => verifyNeutralState(root),
          error => error.message.includes(repositoryPath));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test('rejects symlinks and junctions instead of scanning through them', () => {
  const root = temporaryDirectory();
  const target = temporaryDirectory();
  try {
    write(target, 'file.txt');
    const link = path.join(root, 'linked');
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => verifyNeutralState(root),
      /Symbolic links and junctions are not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
