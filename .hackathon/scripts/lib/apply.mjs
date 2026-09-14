import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import {
  REPOSITORY_ROOT,
  assertGitCleanWhenAvailable,
  assertIdentifier,
  assertNoSymlinkPath,
  comparePosixPaths,
  isIgnoredRepositoryPath,
  readGitMetadata,
  readJsonFile,
  removeEmptyParents,
  resolveInside,
  resolveUtcTimestamp,
  sha256,
  walkRegularFiles,
  writeJsonAtomic
} from './common.mjs';
import {
  baselineRecordForPath,
  loadBaselineOverrides,
  loadTemplateBaseline,
  loadTemplateConfiguration,
  verifyBaseline
} from './baseline.mjs';
import { verifySupportedContracts } from './contracts.mjs';
import { compilePathPattern } from './glob.mjs';
import { verifyPristineTemplate } from './ownership.mjs';
import { loadChallengePack, rulesForCondition } from './pack.mjs';
import { validateRunState } from './run-state.mjs';
import { loadTemplateManifest } from './template-manifest.mjs';

function ensureDestinationParents(repoRoot, destination, createdDirectories) {
  const parts = destination.split('/').slice(0, -1);
  let current = repoRoot;
  for (const part of parts) {
    current = path.join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(),
        `Overlay destination parent must be an ordinary directory: ${destination}`);
    } else {
      mkdirSync(current);
      createdDirectories.push(current);
    }
  }
}

function validatePackForTemplate(repoRoot, pack, condition) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const contracts = verifySupportedContracts(repoRoot);
  assert.ok(contracts.acceptedPackSchemaVersions.includes(pack.manifest.schemaVersion),
    `Unsupported Challenge Pack schema: ${pack.manifest.schemaVersion}`);
  assert.ok(pack.manifest.minimumTemplateVersion <= configuration.templateVersion,
    `Challenge Pack requires template version ${pack.manifest.minimumTemplateVersion}`);
  const rules = rulesForCondition(pack.manifest, condition);
  const baseline = loadTemplateBaseline(repoRoot);
  const template = loadTemplateManifest(repoRoot);
  const baselinePaths = new Set(baseline.files.map(record => record.path));
  const templatePaths = new Set(template.files.map(record => record.path));
  const overrides = new Set(loadBaselineOverrides(repoRoot).document.overrides.map(record => record.path));

  for (const mutation of rules.allowedMutations) {
    assert.ok(baselinePaths.has(mutation.path), `Allowed mutation is not a baseline path: ${mutation.path}`);
    assert.ok(!overrides.has(mutation.path), `Operational override cannot be mutated: ${mutation.path}`);
    baselineRecordForPath(repoRoot, mutation.path);
  }

  for (const addition of rules.allowedAdditions) {
    const expression = compilePathPattern(addition.pattern);
    const collision = [...baselinePaths, ...templatePaths].find(repositoryPath => expression.test(repositoryPath));
    assert.equal(collision, undefined,
      `Allowed addition pattern overlaps an existing baseline/template path: ${addition.pattern} -> ${collision}`);
  }

  for (const overlay of rules.overlay) {
    assert.ok(overlay.destination.startsWith(`${configuration.challengeRoot}/`),
      `Overlay destination is outside the challenge root: ${overlay.destination}`);
    assert.ok(!existsSync(resolveInside(repoRoot, overlay.destination, 'Overlay destination')),
      `Overlay destination already exists: ${overlay.destination}`);
  }
  return rules;
}

function resetExistingRun({ repoRoot, configuration, pack, condition }) {
  const runStatePath = resolveInside(repoRoot, configuration.runState, 'Run-state path');
  const state = validateRunState(readJsonFile(runStatePath, 'Existing run state'));
  assert.equal(state.stage, 'applied', 'Safe reset is allowed only before a run enters in-progress');
  if (!state.isolation.branchSafe) {
    const currentGit = readGitMetadata(repoRoot);
    if (state.git.branch !== null && currentGit.branch !== null) {
      assert.equal(currentGit.branch, state.git.branch,
        `Run branch changed while branchSafe is false: ${state.git.branch} -> ${currentGit.branch}`);
    }
  }
  if (state.condition !== condition) {
    assert.ok(state.isolation.conditionStrategy === 'single-workspace'
      && pack.manifest.isolation.conditionStrategy === 'single-workspace'
      && state.isolation.branchSafe
      && pack.manifest.isolation.branchSafe,
    'In-place condition changes require conditionStrategy=single-workspace and branchSafe=true');
  }

  verifyBaseline(repoRoot);
  const baseline = loadTemplateBaseline(repoRoot);
  const template = loadTemplateManifest(repoRoot);
  const allowed = new Set([
    ...baseline.files.map(record => record.path),
    ...template.files.map(record => record.path),
    configuration.runState,
    ...state.appliedFiles.map(record => record.destination)
  ]);
  const actual = walkRegularFiles(repoRoot, {
    exclude: repositoryPath => isIgnoredRepositoryPath(repositoryPath)
  });
  const unexpected = actual.filter(repositoryPath => !allowed.has(repositoryPath));
  assert.deepEqual(unexpected, [], `Safe reset refuses participant changes or evidence: ${unexpected.join(', ')}`);
  for (const record of state.appliedFiles) {
    assert.ok(record.destination.startsWith(`${configuration.challengeRoot}/`),
      `Existing run has an unsafe applied destination: ${record.destination}`);
    const file = resolveInside(repoRoot, record.destination, 'Existing applied destination');
    assert.ok(existsSync(file), `Existing applied destination is missing: ${record.destination}`);
    assert.equal(sha256(readFileSync(file)), record.sha256,
      `Safe reset refuses a modified starter file: ${record.destination}`);
  }

  const transaction = mkdtempSync(path.join(repoRoot, '.hackathon', '.reset-'));
  const moved = [];
  try {
    for (const record of [...state.appliedFiles].reverse()) {
      const source = resolveInside(repoRoot, record.destination, 'Existing applied destination');
      const backup = path.join(transaction, String(moved.length));
      renameSync(source, backup);
      moved.push({ source, backup });
    }
    const runBackup = path.join(transaction, 'run.json');
    renameSync(runStatePath, runBackup);
    moved.push({ source: runStatePath, backup: runBackup });
    rmSync(transaction, { recursive: true, force: true });
    for (const record of [...state.appliedFiles].reverse()) {
      try {
        removeEmptyParents(path.dirname(resolveInside(repoRoot, record.destination, 'Existing applied destination')),
          path.join(repoRoot, '.hackathon'));
      } catch {
        // Empty parent cleanup is advisory after the reset has committed.
      }
    }
    return state;
  } catch (error) {
    for (const record of [...moved].reverse()) {
      try {
        if (existsSync(record.backup)) {
          mkdirSync(path.dirname(record.source), { recursive: true });
          renameSync(record.backup, record.source);
        }
      } catch {
        // Preserve the original reset error.
      }
    }
    try {
      if (existsSync(transaction)) rmSync(transaction, { recursive: true, force: true });
    } catch {
      // Preserve the original reset error.
    }
    throw error;
  }
}

export function applyChallengePack({
  repoRoot = REPOSITORY_ROOT,
  packDirectory,
  teamId,
  condition,
  runId = randomUUID(),
  reset = false,
  now,
  hooks = {}
}) {
  const resolvedRepo = path.resolve(repoRoot);
  assertIdentifier(teamId, 'teamId');
  assertIdentifier(runId, 'runId');
  const configuration = loadTemplateConfiguration(resolvedRepo);
  const pack = loadChallengePack(packDirectory);
  const rules = rulesForCondition(pack.manifest, condition);
  const runStatePath = resolveInside(resolvedRepo, configuration.runState, 'Run-state path');

  if (existsSync(runStatePath)) {
    assert.ok(reset, 'Run state already exists; use --reset only for an untouched applied run');
    resetExistingRun({ repoRoot: resolvedRepo, configuration, pack, condition });
  } else {
    assert.equal(reset, false, '--reset requires an existing run state');
  }

  const validatedRules = validatePackForTemplate(resolvedRepo, pack, condition);
  verifyPristineTemplate(resolvedRepo);
  const git = assertGitCleanWhenAvailable(resolvedRepo);

  const selectedOverlay = pack.overlay
    .filter(entry => entry.conditions.includes(condition))
    .sort((left, right) => comparePosixPaths(left.destination, right.destination));
  const actions = selectedOverlay.map(entry => {
    const destinationPath = resolveInside(resolvedRepo, entry.destination, 'Overlay destination');
    assertNoSymlinkPath(resolvedRepo, path.dirname(destinationPath), { allowMissingTail: true });
    assert.ok(!existsSync(destinationPath), `Overlay destination already exists: ${entry.destination}`);
    return { ...entry, destinationPath };
  });

  const transactionRoot = mkdtempSync(path.join(resolvedRepo, '.hackathon', '.apply-'));
  const stagedRoot = path.join(transactionRoot, 'staged');
  mkdirSync(stagedRoot);
  const installed = [];
  const createdDirectories = [];
  let wroteRunState = false;

  try {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const staged = path.join(stagedRoot, String(index));
      const bytes = readFileSync(action.sourcePath);
      mkdirSync(path.dirname(staged), { recursive: true });
      writeFileSync(staged, bytes, { flag: 'wx', mode: 0o644 });
      chmodSync(staged, 0o644);
      assert.equal(sha256(readFileSync(staged)), action.sha256,
        `Staged overlay bytes changed unexpectedly: ${action.destination}`);
      action.stagedPath = staged;
    }

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      ensureDestinationParents(resolvedRepo, action.destination, createdDirectories);
      renameSync(action.stagedPath, action.destinationPath);
      installed.push(action);
      hooks.afterApplied?.({ index, destination: action.destination });
    }

    const timestamp = resolveUtcTimestamp(now);
    const state = validateRunState({
      schemaVersion: 1,
      stage: 'applied',
      challengeId: pack.manifest.challengeId,
      challengeVersion: pack.manifest.challengeVersion,
      runId,
      teamId,
      condition,
      packSha256: pack.sha256,
      templateVersion: configuration.templateVersion,
      sourceTreeSha256: configuration.sourceTreeSha256,
      templateTreeSha256: configuration.templateTreeSha256,
      baselineTreeSha256: configuration.templateTreeSha256,
      isolation: pack.manifest.isolation,
      appliedFiles: actions.map(action => ({
        destination: action.destination,
        sha256: action.sha256
      })),
      git: git ?? readGitMetadata(resolvedRepo),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    hooks.beforeRunState?.(state);
    writeJsonAtomic(runStatePath, state);
    wroteRunState = true;
    rmSync(transactionRoot, { recursive: true, force: true });
    return { state, rules: validatedRules };
  } catch (error) {
    try {
      if (wroteRunState && existsSync(runStatePath)) rmSync(runStatePath, { force: true });
      for (const action of [...installed].reverse()) {
        if (existsSync(action.destinationPath)) rmSync(action.destinationPath, { force: true });
      }
      if (existsSync(transactionRoot)) rmSync(transactionRoot, { recursive: true, force: true });
      for (const action of [...installed].reverse()) {
        removeEmptyParents(path.dirname(action.destinationPath), path.join(resolvedRepo, '.hackathon'));
      }
      for (const directory of [...createdDirectories].reverse()) {
        removeEmptyParents(directory, path.join(resolvedRepo, '.hackathon'));
      }
    } catch {
      // Preserve the original apply error.
    }
    throw error;
  }
}
