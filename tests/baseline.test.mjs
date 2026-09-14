import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  SOURCE_TREE_SHA256,
  TEMPLATE_TREE_SHA256,
  loadTemplateBaseline,
  verifyBaseline
} from '../.hackathon/scripts/lib/baseline.mjs';
import { sha256 } from '../.hackathon/scripts/lib/common.mjs';
import { verifyPristineTemplate } from '../.hackathon/scripts/lib/ownership.mjs';
import {
  REPOSITORY_ROOT,
  createTemplateFixture,
  destroyFixture
} from './helpers/runtime-fixture.mjs';

test('reconciles exactly 515 source paths and two operational overrides', () => {
  const result = verifyBaseline(REPOSITORY_ROOT);
  assert.equal(result.expected, 515);
  assert.equal(result.present, 515);
  assert.equal(result.overrideCount, 2);
  assert.equal(result.sourceTreeSha256, SOURCE_TREE_SHA256);
  assert.equal(result.templateTreeSha256, TEMPLATE_TREE_SHA256);

  const baseline = loadTemplateBaseline(REPOSITORY_ROOT);
  assert.equal(baseline.sourceManifest.snapshotPath, '.');
  const readme = baseline.sourceManifest.files.find(record => record.path === 'README.md');
  const rootReadme = readFileSync(path.join(REPOSITORY_ROOT, 'README.md'));
  assert.equal(rootReadme.length, readme.bytes);
  assert.equal(sha256(rootReadme), readme.sha256);

  const overrides = new Map(baseline.overrides.overrides.map(record => [record.path, record]));
  assert.deepEqual([...overrides.keys()].sort(), ['.github/workflows/verify.yml', '.gitignore']);
  assert.equal(overrides.get('.gitignore').template.sha256,
    'd496c60e81091a7879b630092f340f57c585cc48853acff4cae02ec82058539b');
  assert.equal(overrides.get('.github/workflows/verify.yml').template.sha256,
    '4310718263f763afec9f19c42eca39a6f06f21ef7caf7f392246f3010feb0056');
});

test('mutation guards fail for the intended baseline path and post-image shape', () => {
  const fixture = createTemplateFixture({ git: false });
  try {
    const sourceFile = path.join(fixture.repo, 'database', '001-common.sql');
    const original = readFileSync(sourceFile);
    writeFileSync(sourceFile, Buffer.concat([original, Buffer.from('\n-- mutation\n')]));
    assert.throws(() => verifyBaseline(fixture.repo),
      error => error.message.includes('Baseline has changed files')
        && error.message.includes('database/001-common.sql')
        && error.message.includes('sha256'));
    writeFileSync(sourceFile, original);

    const gitignore = path.join(fixture.repo, '.gitignore');
    const override = readFileSync(gitignore, 'utf8');
    writeFileSync(gitignore, override.replace('!.vscode/mcp.json\n', ''));
    assert.throws(() => verifyBaseline(fixture.repo),
      error => error.message.includes('Baseline has changed files')
        && error.message.includes('.gitignore')
        && error.message.includes('bytes'));
  } finally {
    destroyFixture(fixture);
  }
});

test('template ownership lists every non-baseline file and excludes source caches', () => {
  const fixture = createTemplateFixture({ git: false });
  try {
    const result = verifyPristineTemplate(fixture.repo);
    assert.equal(result.baseline.files.length, 515);
    assert.ok(result.template.files.length > 0);
    assert.ok(!result.template.files.some(record =>
      record.path.startsWith('.tmp-source/') || record.path.startsWith('.tmp-upstream/')));
    assert.equal(result.fileCount, result.baseline.files.length + result.template.files.length);
  } finally {
    destroyFixture(fixture);
  }
});
