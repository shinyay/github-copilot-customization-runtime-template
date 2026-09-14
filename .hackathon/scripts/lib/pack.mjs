import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONTRACT_LIMITS,
  SHA256_PATTERN,
  assertAllowedKeys,
  assertExactKeys,
  assertIdentifier,
  assertNoPathCollisions,
  assertNonEmptyString,
  assertOrdinaryDirectory,
  assertRegularFile,
  assertSafeRelativePosixPath,
  comparePosixPaths,
  readJsonFile,
  resolveInside,
  sha256,
  walkRegularFiles
} from './common.mjs';
import { compilePathPattern, matchPathPattern, validatePathPattern } from './glob.mjs';
import { classifyActiveCustomization } from './neutral.mjs';

const CONDITION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const CHALLENGE_PATTERN = /^HC-[0-9]{3}$/;
const RESERVED_MUTATIONS = new Set(['.gitignore', '.github/workflows/verify.yml']);
const ACTIVE_REPRESENTATIVES = [
  '.github/copilot-instructions.md',
  '.github/instructions/example.instructions.md',
  '.github/agents/example.agent.md',
  '.github/prompts/example.prompt.md',
  '.github/skills/example/SKILL.md',
  '.vscode/mcp.json',
  '.github/hooks/hooks.json',
  '.github/plugins/example/plugin.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/settings.json',
  '.cursor/rules/example.mdc'
];

function validateConditions(values, knownConditions, label) {
  assert.ok(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
  for (const condition of values) {
    assert.equal(typeof condition, 'string', `${label} entries must be strings`);
    assert.match(condition, CONDITION_PATTERN, `Invalid ${label} entry: ${condition}`);
    assert.ok(knownConditions.has(condition), `${label} references an unknown condition: ${condition}`);
  }
  return values;
}

function validateConditionalPattern(record, knownConditions, label) {
  assertExactKeys(record, ['pattern', 'conditions'], label);
  validatePathPattern(record.pattern, `${label} pattern`);
  validateConditions(record.conditions, knownConditions, `${label} conditions`);
  return record;
}

function assertPatternDoesNotTargetManagedOrIgnoredPath(pattern, label) {
  const segments = pattern.split('/');
  assert.ok(!['.git', '.runtime', '.tools'].includes(segments[0]),
    `${label} cannot target an ignored repository root: ${pattern}`);
  assert.ok(!segments.includes('target') && !segments.includes('node_modules'),
    `${label} cannot target ignored build or dependency output: ${pattern}`);
}

function validateEvidenceRequirement(record, knownConditions) {
  assertAllowedKeys(record, ['path', 'conditions', 'stage', 'requiredHeadings'], ['templateSha256'],
    'evidence requirement');
  assertSafeRelativePosixPath(record.path, 'Evidence path');
  assert.ok(record.path.startsWith('.hackathon/evidence/'),
    `Evidence path must stay below .hackathon/evidence/: ${record.path}`);
  validateConditions(record.conditions, knownConditions, 'Evidence conditions');
  assert.equal(record.stage, 'submitted', 'Challenge Pack v1 evidence stage must be submitted');
  assert.ok(Array.isArray(record.requiredHeadings) && record.requiredHeadings.length > 0,
    `Evidence requiredHeadings must be non-empty: ${record.path}`);
  assert.equal(new Set(record.requiredHeadings).size, record.requiredHeadings.length,
    `Evidence requiredHeadings must be unique: ${record.path}`);
  for (const heading of record.requiredHeadings) {
    assertNonEmptyString(heading, `Evidence heading for ${record.path}`, 128);
    assert.ok(!heading.startsWith('#'), `Evidence headings omit Markdown # prefixes: ${heading}`);
  }
  if (record.templateSha256 !== undefined) {
    assert.match(record.templateSha256, SHA256_PATTERN, `Invalid evidence templateSha256: ${record.path}`);
  }
  return record;
}

function patternTargetsActiveCustomization(pattern) {
  return ACTIVE_REPRESENTATIVES.some(candidate => matchPathPattern(pattern, candidate));
}

export function validateIsolation(isolation) {
  assertExactKeys(isolation, [
    'tier',
    'freshWorkspace',
    'freshConversation',
    'freshProfile',
    'freshRepository',
    'conditionStrategy',
    'branchSafe'
  ], 'pack isolation');
  assert.ok(['workspace', 'repository', 'organization'].includes(isolation.tier),
    `Unsupported isolation tier: ${isolation.tier}`);
  assert.ok(['single-workspace', 'separate-workspace', 'separate-repository'].includes(isolation.conditionStrategy),
    `Unsupported conditionStrategy: ${isolation.conditionStrategy}`);
  for (const field of ['freshWorkspace', 'freshConversation', 'freshProfile', 'freshRepository', 'branchSafe']) {
    assert.equal(typeof isolation[field], 'boolean', `isolation.${field} must be boolean`);
  }
  if (isolation.branchSafe) {
    assert.equal(isolation.conditionStrategy, 'single-workspace',
      'branchSafe=true is valid only with conditionStrategy=single-workspace');
  }
  return isolation;
}

export function validatePackManifest(manifest) {
  assertExactKeys(manifest, [
    'schemaVersion',
    'challengeId',
    'challengeVersion',
    'minimumTemplateVersion',
    'conditions',
    'isolation',
    'overlay',
    'allowedMutations',
    'allowedAdditions',
    'forbiddenActiveCustomizations',
    'evidenceRequirements',
    'submissionFiles',
    'cleanup'
  ], 'pack manifest');
  assert.equal(manifest.schemaVersion, 1, 'Unsupported Challenge Pack schema version');
  assert.match(manifest.challengeId, CHALLENGE_PATTERN, 'challengeId must use HC-000 form');
  assert.ok(Number.isInteger(manifest.challengeVersion) && manifest.challengeVersion >= 1,
    'challengeVersion must be a positive integer');
  assert.ok(Number.isInteger(manifest.minimumTemplateVersion) && manifest.minimumTemplateVersion >= 1,
    'minimumTemplateVersion must be a positive integer');
  assert.ok(Array.isArray(manifest.conditions) && manifest.conditions.length > 0,
    'conditions must be a non-empty array');
  assert.equal(new Set(manifest.conditions).size, manifest.conditions.length, 'conditions must be unique');
  for (const condition of manifest.conditions) {
    assert.equal(typeof condition, 'string', 'conditions entries must be strings');
    assert.match(condition, CONDITION_PATTERN, `Invalid condition: ${condition}`);
  }
  assert.ok(manifest.conditions.includes('baseline'), 'Challenge Pack v1 must define a baseline condition');
  const knownConditions = new Set(manifest.conditions);
  validateIsolation(manifest.isolation);

  assert.ok(Array.isArray(manifest.overlay) && manifest.overlay.length > 0, 'overlay must be non-empty');
  assert.ok(manifest.overlay.length <= CONTRACT_LIMITS.maxOverlayFiles,
    `overlay exceeds ${CONTRACT_LIMITS.maxOverlayFiles} files`);
  const overlaySources = [];
  const overlayDestinations = [];
  for (const entry of manifest.overlay) {
    assertExactKeys(entry, ['source', 'destination', 'conditions', 'allowOverwrite'], 'overlay entry');
    assertSafeRelativePosixPath(entry.source, 'Overlay source');
    assertSafeRelativePosixPath(entry.destination, 'Overlay destination');
    assert.ok(entry.source.startsWith('payload/') && entry.source.endsWith('.template'),
      `Overlay source must be an inert payload .template file: ${entry.source}`);
    assert.ok(entry.destination.startsWith('.hackathon/challenge/') && entry.destination.endsWith('.template'),
      `Overlay destination must remain inert below .hackathon/challenge/: ${entry.destination}`);
    validateConditions(entry.conditions, knownConditions, 'Overlay conditions');
    assert.equal(entry.allowOverwrite, false, 'Challenge Pack v1 overlay allowOverwrite must be false');
    overlaySources.push(entry.source);
    overlayDestinations.push(entry.destination);
  }
  assertNoPathCollisions(overlaySources, 'Overlay sources');
  assertNoPathCollisions(overlayDestinations, 'Overlay destinations');

  assert.ok(Array.isArray(manifest.allowedMutations), 'allowedMutations must be an array');
  const mutationPaths = [];
  for (const record of manifest.allowedMutations) {
    assertAllowedKeys(record, ['path', 'conditions'], ['expectedSha256'], 'allowed mutation');
    assertSafeRelativePosixPath(record.path, 'Allowed mutation path');
    assert.ok(!record.path.includes('*'), `Allowed mutation paths are exact and cannot contain globs: ${record.path}`);
    assert.ok(!RESERVED_MUTATIONS.has(record.path),
      `Operational override cannot be an allowed mutation: ${record.path}`);
    validateConditions(record.conditions, knownConditions, 'Allowed mutation conditions');
    if (record.expectedSha256 !== undefined) {
      assert.match(record.expectedSha256, SHA256_PATTERN, `Invalid expectedSha256: ${record.path}`);
    }
    mutationPaths.push(record.path);
  }
  assertNoPathCollisions(mutationPaths, 'Allowed mutation paths');

  assert.ok(Array.isArray(manifest.allowedAdditions), 'allowedAdditions must be an array');
  const additionPatterns = [];
  for (const record of manifest.allowedAdditions) {
    validateConditionalPattern(record, knownConditions, 'allowed addition');
    assertPatternDoesNotTargetManagedOrIgnoredPath(record.pattern, 'Allowed addition');
    assert.ok(record.pattern !== '.hackathon' && !record.pattern.startsWith('.hackathon/'),
      `Participant additions cannot target runtime-owned .hackathon paths: ${record.pattern}`);
    assert.ok(record.pattern !== 'submission' && !record.pattern.startsWith('submission/'),
      `Participant additions cannot target the submission bundle: ${record.pattern}`);
    additionPatterns.push(record.pattern);
  }
  assertNoPathCollisions(additionPatterns, 'Allowed addition patterns');

  assert.ok(Array.isArray(manifest.forbiddenActiveCustomizations),
    'forbiddenActiveCustomizations must be an array');
  assert.equal(new Set(manifest.forbiddenActiveCustomizations).size,
    manifest.forbiddenActiveCustomizations.length,
    'forbiddenActiveCustomizations must be unique');
  for (const pattern of manifest.forbiddenActiveCustomizations) {
    validatePathPattern(pattern, 'Forbidden active customization pattern');
  }
  assertNoPathCollisions(manifest.forbiddenActiveCustomizations, 'Forbidden active customization patterns');

  assert.ok(Array.isArray(manifest.evidenceRequirements), 'evidenceRequirements must be an array');
  assert.ok(manifest.evidenceRequirements.length <= CONTRACT_LIMITS.maxEvidenceFiles,
    `evidenceRequirements exceeds ${CONTRACT_LIMITS.maxEvidenceFiles}`);
  const evidencePaths = [];
  for (const record of manifest.evidenceRequirements) {
    validateEvidenceRequirement(record, knownConditions);
    evidencePaths.push(record.path);
  }
  assertNoPathCollisions(evidencePaths, 'Evidence paths');

  assert.ok(Array.isArray(manifest.submissionFiles), 'submissionFiles must be an array');
  const submissionPatterns = [];
  for (const record of manifest.submissionFiles) {
    validateConditionalPattern(record, knownConditions, 'submission file');
    assertPatternDoesNotTargetManagedOrIgnoredPath(record.pattern, 'Submission file');
    submissionPatterns.push(record.pattern);
  }
  assertNoPathCollisions(submissionPatterns, 'Submission patterns');

  assertExactKeys(manifest.cleanup,
    ['advisory', 'verifyBaseline', 'exportSubmission', 'stopProcesses', 'archiveRepository'], 'pack cleanup');
  assert.equal(manifest.cleanup.advisory, true, 'cleanup.advisory must be true');
  for (const field of ['verifyBaseline', 'exportSubmission', 'stopProcesses', 'archiveRepository']) {
    assert.equal(typeof manifest.cleanup[field], 'boolean', `cleanup.${field} must be boolean`);
  }

  for (const addition of manifest.allowedAdditions.filter(record => record.conditions.includes('baseline'))) {
    assert.ok(!patternTargetsActiveCustomization(addition.pattern),
      `Baseline condition cannot allow an active customization: ${addition.pattern}`);
  }
  return manifest;
}

export function rulesForCondition(manifest, condition) {
  assertIdentifier(condition, 'condition');
  assert.ok(manifest.conditions.includes(condition), `Condition is not declared by the pack: ${condition}`);
  return {
    overlay: manifest.overlay.filter(record => record.conditions.includes(condition)),
    allowedMutations: manifest.allowedMutations.filter(record => record.conditions.includes(condition)),
    allowedAdditions: manifest.allowedAdditions.filter(record => record.conditions.includes(condition)),
    evidenceRequirements: manifest.evidenceRequirements.filter(record => record.conditions.includes(condition)),
    submissionFiles: manifest.submissionFiles.filter(record => record.conditions.includes(condition))
  };
}

export function calculatePackSha256(packRoot, files = walkRegularFiles(packRoot)) {
  let totalBytes = 0;
  const fileRecords = [];
  assert.ok(files.length <= CONTRACT_LIMITS.maxPackFiles,
    `Challenge Pack exceeds ${CONTRACT_LIMITS.maxPackFiles} files`);
  for (const relativePath of [...files].sort(comparePosixPaths)) {
    const file = resolveInside(packRoot, relativePath, 'Pack file path');
    const stat = assertRegularFile(file, `Pack file ${relativePath}`);
    assert.equal(stat.mode & 0o111, 0, `Pack files must be non-executable (100644): ${relativePath}`);
    totalBytes += stat.size;
    assert.ok(totalBytes <= CONTRACT_LIMITS.maxPackBytes,
      `Challenge Pack exceeds ${CONTRACT_LIMITS.maxPackBytes} bytes`);
    fileRecords.push({ relativePath, file, size: stat.size });
  }
  const records = [];
  for (const { relativePath, file, size } of fileRecords) {
    const bytes = readFileSync(file);
    assert.equal(bytes.length, size, `Pack file size changed during hashing: ${relativePath}`);
    records.push(`${relativePath}\0${'100644'}\0${bytes.length}\0${sha256(bytes)}\n`);
  }
  return sha256(Buffer.from(records.join(''), 'utf8'));
}

export function loadChallengePack(packDirectory) {
  const packRoot = path.resolve(packDirectory);
  assertOrdinaryDirectory(packRoot, 'Challenge Pack directory');
  const files = walkRegularFiles(packRoot, { maxFiles: CONTRACT_LIMITS.maxPackFiles });
  assert.ok(files.includes('manifest.json'), 'Challenge Pack is missing manifest.json');
  for (const file of files) {
    assert.ok(file === 'manifest.json' || file.startsWith('payload/'),
      `Challenge Pack contains a file outside manifest.json and payload/: ${file}`);
    if (file.startsWith('payload/')) {
      assert.ok(file.endsWith('.template'), `Challenge Pack payload must remain inert: ${file}`);
    }
  }
  const packSha256 = calculatePackSha256(packRoot, files);
  const manifest = validatePackManifest(readJsonFile(path.join(packRoot, 'manifest.json'), 'Challenge Pack manifest'));
  const overlay = manifest.overlay.map(entry => {
    const sourcePath = resolveInside(packRoot, entry.source, 'Overlay source');
    assert.ok(existsSync(sourcePath), `Overlay source does not exist: ${entry.source}`);
    const stat = lstatSync(sourcePath);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(),
      `Overlay source must be an ordinary regular file: ${entry.source}`);
    assert.equal(stat.mode & 0o111, 0, `Overlay source must be non-executable (100644): ${entry.source}`);
    const bytes = readFileSync(sourcePath);
    return { ...entry, sourcePath, bytes, sha256: sha256(bytes) };
  });
  return {
    root: packRoot,
    files,
    manifest,
    overlay,
    sha256: packSha256
  };
}

export function buildPack({ sourceDirectory, outputDirectory }) {
  const source = loadChallengePack(sourceDirectory);
  const output = path.resolve(outputDirectory);
  assert.ok(!existsSync(output), `Pack output already exists: ${output}`);
  mkdirSync(output, { recursive: false });
  try {
    for (const relativePath of source.files) {
      const destination = resolveInside(output, relativePath, 'Pack output path');
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(resolveInside(source.root, relativePath, 'Pack source path')),
        { flag: 'wx', mode: 0o644 });
      chmodSync(destination, 0o644);
    }
    const built = loadChallengePack(output);
    assert.equal(built.sha256, source.sha256, 'Pure byte-copy build changed the Challenge Pack hash');
    return built;
  } catch (error) {
    try {
      if (existsSync(output)) rmSync(output, { recursive: true, force: true });
    } catch {
      // Preserve the original build error.
    }
    throw error;
  }
}

export function matchesAnyPattern(repositoryPath, records) {
  return records.some(record => compilePathPattern(record.pattern).test(repositoryPath));
}
