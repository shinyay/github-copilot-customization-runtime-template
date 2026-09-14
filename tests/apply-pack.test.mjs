import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyChallengePack } from '../.hackathon/scripts/lib/apply.mjs';
import {
  calculatePackSha256,
  buildPack,
  loadChallengePack,
  validatePackManifest
} from '../.hackathon/scripts/lib/pack.mjs';
import { assertNoPathCollisions, sha256 } from '../.hackathon/scripts/lib/common.mjs';
import { matchPathPattern, validatePathPattern } from '../.hackathon/scripts/lib/glob.mjs';
import {
  copyGenericPack,
  createTemplateFixture,
  destroyFixture,
  mutatePack,
  REPOSITORY_ROOT,
  readJson,
  run,
  writeJson,
  writeText
} from './helpers/runtime-fixture.mjs';

const PINNED_GENERIC_PACK_SHA256 = '4471f88d8d94e253a5ba210b5c7180f83025fae51240e4c9f2446ba5feebff44';

test('vendors the canonical schema and executes every shared glob conformance case', () => {
  const schemaBytes = readFileSync(path.join(REPOSITORY_ROOT,
    '.hackathon', 'schemas', 'challenge-pack.schema.json'));
  const fixtureBytes = readFileSync(path.join(REPOSITORY_ROOT,
    '.hackathon', 'fixtures', 'glob-conformance-v1.json'));
  const packHashBytes = readFileSync(path.join(REPOSITORY_ROOT,
    '.hackathon', 'fixtures', 'pack-hash-v1.json'));
  assert.equal(schemaBytes.length, 9457);
  assert.equal(sha256(schemaBytes), 'd92c88534e4615dce5fbd35b5e41e983d50549929a2bd902b18d04ad16c178a3');
  assert.equal(fixtureBytes.length, 1410);
  assert.equal(sha256(fixtureBytes), '2a1d6a53e3e63cf6f6346112fe41d1ab8a5cd7f921575ec5e854f9264e88a388');
  assert.equal(packHashBytes.length, 446);
  assert.equal(sha256(packHashBytes), '108c4dfe54d97caa3d789f31505c131813195fd0a8dfc6d07c72c24190ee47bd');
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  assert.equal(schema.properties.allowedAdditions.items.$ref, '#/$defs/allowedAddition');
  assert.equal(schema.$defs.repositoryPattern.allOf[1].pattern,
    '^(?:(?:[^/*]+|\\*)/)*(?:[^/*]+|\\*|\\*\\*)$');
  assert.equal(schema.$defs.allowedAddition.properties.pattern.allOf[1].not.pattern,
    '^(?:\\.hackathon(?:/|$)|submission(?:/|$))');
  assert.equal(schema.$defs.evidenceRequirement.properties.path.allOf[1].pattern,
    '^\\.hackathon/evidence/.+');
  for (const record of fixture.cases) {
    assert.equal(matchPathPattern(record.pattern, record.path), record.matches,
      `${record.pattern} against ${record.path}`);
  }
  const packHashFixture = JSON.parse(packHashBytes.toString('utf8'));
  const records = [...packHashFixture.files]
    .sort((left, right) => Buffer.from(left.relativePath, 'utf8').compare(Buffer.from(right.relativePath, 'utf8')))
    .map(record => {
      const bytes = Buffer.from(record.contentBase64, 'base64');
      return `${record.relativePath}\0${packHashFixture.mode}\0${bytes.length}\0${sha256(bytes)}\n`;
    });
  assert.equal(sha256(Buffer.from(records.join(''), 'utf8')),
    '0b5d5efa3b236407194114cf3067b42f4353a321d631bc6c433abde3d0f32a7d');
  for (const pattern of ['foo/?', 'foo/[ab]', 'foo/{a,b}', '!foo/bar', 'foo/**/bar', 'foo/bar*', 'foo/a*b']) {
    assert.throws(() => validatePathPattern(pattern), /unsupported glob|trailing|only permits|permits \*/);
  }
  assert.throws(() => assertNoPathCollisions(
    ['payload/\u00e9.template', 'payload/e\u0301.template'],
    'Pack paths'
  ), /NFC\/case-insensitive collision/);

  const genericManifest = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT,
    '.hackathon', 'fixtures', 'generic-pack', 'manifest.json'), 'utf8'));
  assert.doesNotThrow(() => validatePackManifest(genericManifest));
  const managedAddition = structuredClone(genericManifest);
  managedAddition.allowedAdditions[0].pattern = '.hackathon/evidence/*';
  assert.throws(() => validatePackManifest(managedAddition),
    /cannot target runtime-owned .hackathon paths/);
  const submissionAddition = structuredClone(genericManifest);
  submissionAddition.allowedAdditions[0].pattern = 'submission/*';
  assert.throws(() => validatePackManifest(submissionAddition),
    /cannot target the submission bundle/);
  const externalEvidence = structuredClone(genericManifest);
  externalEvidence.evidenceRequirements[0].path = 'evidence/summary.md';
  assert.throws(() => validatePackManifest(externalEvidence),
    /must stay below .hackathon\/evidence/);
});

test('applies only inert current-condition starters and writes the final success marker', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const result = applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'run-01',
      now: '2026-09-14T00:00:00Z'
    });
    assert.equal(result.state.stage, 'applied');
    assert.equal(result.state.createdAt, '2026-09-14T00:00:00Z');
    assert.equal(result.state.updatedAt, '2026-09-14T00:00:00Z');
    assert.equal(result.state.packSha256, PINNED_GENERIC_PACK_SHA256);
    assert.equal(result.state.baselineTreeSha256,
      'de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2');
    assert.equal(result.state.git.dirty, false);
    assert.deepEqual(result.state.appliedFiles.map(record => record.destination),
      ['.hackathon/challenge/copilot-instructions.md.template']);
    assert.ok(existsSync(path.join(fixture.repo, '.hackathon', 'challenge', 'copilot-instructions.md.template')));
    assert.ok(!existsSync(path.join(fixture.repo, '.github', 'copilot-instructions.md')),
      'overlay must not pre-create a participant deliverable');
    assert.ok(existsSync(path.join(fixture.repo, '.hackathon', 'run.json')));
    assert.deepEqual(
      readdirSync(path.join(fixture.repo, '.hackathon')).filter(name => name.startsWith('.apply-')),
      []);
  } finally {
    destroyFixture(fixture);
  }
});

test('baseline condition applies no active customization or customized starter', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const result = applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'baseline',
      runId: 'baseline-01',
      now: '2026-09-14T00:00:00Z'
    });
    assert.deepEqual(result.state.appliedFiles, []);
    assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'challenge')));
    assert.ok(!existsSync(path.join(fixture.repo, '.github', 'copilot-instructions.md')));
  } finally {
    destroyFixture(fixture);
  }
});

test('pack-hash-v1 uses bytewise paths, logical 100644 mode, lengths, and file hashes', () => {
  const fixture = createTemplateFixture({ git: false });
  try {
    const pack = copyGenericPack(fixture);
    const loaded = loadChallengePack(pack);
    assert.equal(loaded.sha256, PINNED_GENERIC_PACK_SHA256);
    const records = loaded.files.map(relativePath => {
      const bytes = readFileSync(path.join(pack, ...relativePath.split('/')));
      return `${relativePath}\0${'100644'}\0${bytes.length}\0${sha256(bytes)}\n`;
    });
    assert.equal(sha256(Buffer.from(records.join(''), 'utf8')), loaded.sha256);
    assert.equal(calculatePackSha256(pack), loaded.sha256);

    const built = path.join(fixture.root, 'built-pack');
    assert.equal(buildPack({ sourceDirectory: pack, outputDirectory: built }).sha256, loaded.sha256);
    for (const relativePath of loaded.files) {
      assert.deepEqual(
        readFileSync(path.join(pack, ...relativePath.split('/'))),
        readFileSync(path.join(built, ...relativePath.split('/'))));
    }
  } finally {
    destroyFixture(fixture);
  }
});

test('rejects unsafe paths, non-regular sources, and symlinked payloads', async t => {
  const invalidDestinations = [
    'C:/absolute.template',
    '../escape.template',
    '.hackathon/challenge/../escape.template',
    '.hackathon/challenge/con/file.template',
    '.hackathon/challenge/bad:name.template',
    `.hackathon/challenge/nul\u0000.template`
  ];
  for (const destination of invalidDestinations) {
    await t.test(JSON.stringify(destination), () => {
      const fixture = createTemplateFixture({ git: false });
      try {
        const pack = copyGenericPack(fixture);
        mutatePack(pack, manifest => {
          manifest.overlay[0].destination = destination;
        });
        assert.throws(() => loadChallengePack(pack), /Overlay destination|unsafe|Windows|NUL|relative/);
      } finally {
        destroyFixture(fixture);
      }
    });
  }

  await t.test('directory source', () => {
    const fixture = createTemplateFixture({ git: false });
    try {
      const pack = copyGenericPack(fixture);
      mkdirSync(path.join(pack, 'payload', 'directory.template'));
      mutatePack(pack, manifest => {
        manifest.overlay[0].source = 'payload/directory.template';
      });
      assert.throws(() => loadChallengePack(pack), /ordinary regular file/);
    } finally {
      destroyFixture(fixture);
    }
  });

  await t.test('junction payload', () => {
    const fixture = createTemplateFixture({ git: false });
    try {
      const pack = copyGenericPack(fixture);
      const target = path.join(fixture.root, 'payload-target');
      mkdirSync(target);
      writeText(path.join(target, 'starter.template'), 'starter\n');
      symlinkSync(target, path.join(pack, 'payload', 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => loadChallengePack(pack), /Symbolic links and junctions are not allowed/);
    } finally {
      destroyFixture(fixture);
    }
  });

  await t.test('destination realpath escape', () => {
    const fixture = createTemplateFixture();
    try {
      const pack = copyGenericPack(fixture);
      const outside = path.join(fixture.root, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, path.join(fixture.repo, '.hackathon', 'challenge'),
        process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => applyChallengePack({
        repoRoot: fixture.repo,
        packDirectory: pack,
        teamId: 'team-01',
        condition: 'customized',
        runId: 'escape-run',
        now: '2026-09-14T00:00:00Z'
      }), /escapes its root through an existing real path|Symbolic links and junctions/);
      assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'run.json')));
    } finally {
      destroyFixture(fixture);
    }
  });

  await t.test('incoherent branch safety', () => {
    const fixture = createTemplateFixture({ git: false });
    try {
      const pack = copyGenericPack(fixture);
      mutatePack(pack, manifest => {
        manifest.isolation.branchSafe = true;
      });
      assert.throws(() => loadChallengePack(pack),
        /branchSafe=true is valid only with conditionStrategy=single-workspace/);
    } finally {
      destroyFixture(fixture);
    }
  });

  await t.test('allowOverwrite cannot bypass version 1 default-deny', () => {
    const fixture = createTemplateFixture({ git: false });
    try {
      const pack = copyGenericPack(fixture);
      mutatePack(pack, manifest => {
        manifest.overlay[0].allowOverwrite = true;
      });
      assert.throws(() => loadChallengePack(pack),
        /allowOverwrite must be false/);
    } finally {
      destroyFixture(fixture);
    }
  });
});

test('transaction faults roll back created files, directories, and run state', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    assert.throws(() => applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'customized',
      runId: 'run-fault',
      now: '2026-09-14T00:00:00Z',
      hooks: {
        afterApplied() {
          throw new Error('injected transaction fault');
        }
      }
    }), /injected transaction fault/);
    assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'run.json')));
    assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'challenge')));
    assert.deepEqual(
      readdirSync(path.join(fixture.repo, '.hackathon')).filter(name => name.startsWith('.apply-')),
      []);
  } finally {
    destroyFixture(fixture);
  }
});

test('CLI failure proves the process ran and leaves no success-shaped state', () => {
  const fixture = createTemplateFixture();
  try {
    const pack = copyGenericPack(fixture);
    const destination = path.join(fixture.repo, '.hackathon', 'challenge', 'copilot-instructions.md.template');
    writeText(destination, 'collision\n');
    const result = run(process.execPath, [
      path.join(fixture.repo, '.hackathon', 'scripts', 'apply-pack.mjs'),
      pack,
      '--team', 'team-01',
      '--condition', 'customized'
    ], { cwd: fixture.repo });
    assert.ok(Number.isInteger(result.status), 'child process status must prove Node started');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Overlay destination already exists/);
    assert.ok(!existsSync(path.join(fixture.repo, '.hackathon', 'run.json')));
    assert.equal(readFileSync(destination, 'utf8'), 'collision\n');
  } finally {
    destroyFixture(fixture);
  }
});

test('uses SOURCE_DATE_EPOCH and permits null Git metadata in a non-Git fixture', () => {
  const fixture = createTemplateFixture({ git: false });
  const previous = process.env.SOURCE_DATE_EPOCH;
  try {
    process.env.SOURCE_DATE_EPOCH = '0';
    const pack = copyGenericPack(fixture);
    const result = applyChallengePack({
      repoRoot: fixture.repo,
      packDirectory: pack,
      teamId: 'team-01',
      condition: 'baseline',
      runId: 'epoch-run'
    });
    assert.equal(result.state.createdAt, '1970-01-01T00:00:00Z');
    assert.deepEqual(result.state.git, { commit: null, branch: null, dirty: null });
  } finally {
    if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previous;
    destroyFixture(fixture);
  }
});

test('rejects a pack over the byte limit before parsing its manifest', () => {
  const fixture = createTemplateFixture({ git: false });
  try {
    const pack = copyGenericPack(fixture);
    writeText(path.join(pack, 'payload', 'oversized.template'),
      'x'.repeat((10 * 1024 * 1024) + 1));
    assert.throws(() => loadChallengePack(pack),
      /Challenge Pack exceeds 10485760 bytes/);
  } finally {
    destroyFixture(fixture);
  }
});
