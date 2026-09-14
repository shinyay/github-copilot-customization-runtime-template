import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..', '..');
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MAX_REPOSITORY_PATH_LENGTH = 320;

export const CONTRACT_LIMITS = Object.freeze({
  maxPackFiles: 256,
  maxPackBytes: 10 * 1024 * 1024,
  maxOverlayFiles: 128,
  maxEvidenceFiles: 32,
  maxEvidenceFileBytes: 1024 * 1024,
  maxSubmissionFiles: 64,
  maxSubmissionFileBytes: 1024 * 1024,
  maxSubmissionTotalBytes: 8 * 1024 * 1024,
  maxRepositoryPathLength: MAX_REPOSITORY_PATH_LENGTH
});

export const VERIFICATION_RESULTS = Object.freeze(['pass', 'fail', 'blocked', 'not-observed']);
export const SOURCE_OWNERSHIP = Object.freeze([
  'baseline-owned',
  'template-owned',
  'run-state',
  'pack-applied',
  'participant-addition',
  'submission-bundle',
  'ignored',
  'violation'
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const WINDOWS_INVALID_WITHOUT_GLOB = /[:*?"<>|]/;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function comparePosixPaths(left, right) {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'));
}

export function collisionKey(value) {
  return value.normalize('NFC').toLowerCase();
}

export function assertNoPathCollisions(values, label = 'Paths') {
  const seen = new Map();
  for (const value of values) {
    const key = collisionKey(value);
    assert.ok(!seen.has(key), `${label} contain an NFC/case-insensitive collision: ${seen.get(key)} and ${value}`);
    seen.set(key, value);
  }
}

export function assertExactKeys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `Unexpected ${label} fields`);
}

export function assertAllowedKeys(value, required, optional, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value);
  for (const field of required) assert.ok(actual.includes(field), `${label} is missing ${field}`);
  const allowed = new Set([...required, ...optional]);
  assert.deepEqual(actual.filter(field => !allowed.has(field)), [], `Unexpected ${label} fields`);
}

export function assertNonEmptyString(value, label, maximum = 256) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0 && value.length <= maximum, `${label} must contain 1-${maximum} characters`);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains control characters`);
  return value;
}

export function assertIdentifier(value, label) {
  assertNonEmptyString(value, label, 128);
  assert.match(value, IDENTIFIER_PATTERN, `${label} must use letters, numbers, dot, underscore, or hyphen`);
  return value;
}

export function assertSafePathSegment(part, value, label, { allowGlob = false } = {}) {
  assert.ok(part && part !== '.' && part !== '..', `${label} contains an unsafe segment: ${value}`);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(part), `${label} contains control characters: ${value}`);
  const invalid = allowGlob ? /[:"<>|]/ : WINDOWS_INVALID_WITHOUT_GLOB;
  assert.ok(!invalid.test(part), `${label} contains a Windows-invalid character: ${value}`);
  assert.ok(!/[. ]$/.test(part), `${label} contains a Windows-unsafe trailing character: ${value}`);
  assert.ok(!WINDOWS_RESERVED.test(part), `${label} contains a Windows-reserved segment: ${value}`);
}

export function assertSafeRelativePosixPath(value, label = 'Path') {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0 && value.length <= MAX_REPOSITORY_PATH_LENGTH,
    `${label} must contain 1-${MAX_REPOSITORY_PATH_LENGTH} characters: ${value}`);
  assert.ok(!value.includes('\0'), `${label} contains NUL: ${value}`);
  assert.ok(!value.includes('\\'), `${label} must use POSIX separators: ${value}`);
  assert.ok(!value.startsWith('/') && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value),
    `${label} must be repository-relative: ${value}`);
  const parts = value.split('/');
  for (const part of parts) assertSafePathSegment(part, value, label);
  assert.equal(path.posix.normalize(value), value, `${label} is not normalized: ${value}`);
  return parts;
}

function assertNearestExistingRealPath(root, target, label) {
  const rootReal = realpathSync.native(root);
  let nearest = target;
  while (!existsSync(nearest)) {
    const parent = path.dirname(nearest);
    assert.notEqual(parent, nearest, `${label} has no existing parent: ${target}`);
    nearest = parent;
  }
  const nearestReal = realpathSync.native(nearest);
  const relation = path.relative(rootReal, nearestReal);
  assert.ok(relation === '' || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation)),
    `${label} escapes its root through an existing real path: ${target}`);
}

export function resolveInside(root, relative, label = 'Path') {
  const parts = assertSafeRelativePosixPath(relative, label);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  const relation = path.relative(resolvedRoot, resolved);
  assert.ok(relation && !relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation),
    `${label} escapes its root: ${relative}`);
  assertNearestExistingRealPath(resolvedRoot, resolved, label);
  return resolved;
}

export function assertOrdinaryDirectory(directory, label = 'Directory') {
  const stat = lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be an ordinary directory: ${directory}`);
}

export function assertNoSymlinkPath(root, target, { allowMissingTail = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  assertOrdinaryDirectory(resolvedRoot, 'Root directory');
  const relation = path.relative(resolvedRoot, resolvedTarget);
  assert.ok(relation === '' || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation)),
    `Path escapes root: ${resolvedTarget}`);
  let current = resolvedRoot;
  for (const segment of relation.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      assert.ok(allowMissingTail, `Path does not exist: ${current}`);
      break;
    }
    const stat = lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), `Symbolic links and junctions are not allowed: ${current}`);
    if (current !== resolvedTarget) assert.ok(stat.isDirectory(), `Path parent must be a directory: ${current}`);
  }
  assertNearestExistingRealPath(resolvedRoot, resolvedTarget, 'Path');
}

export function assertRegularFile(file, label = 'File') {
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${label} must be an ordinary regular file: ${file}`);
  return stat;
}

export function isIgnoredRepositoryPath(repositoryPath) {
  const segments = repositoryPath.split('/');
  return segments[0] === '.git'
    || segments[0] === '.runtime'
    || segments[0] === '.tools'
    || segments.includes('target')
    || segments.includes('node_modules');
}

export function walkRegularFiles(root, { exclude = () => false, maxFiles } = {}) {
  assertOrdinaryDirectory(root);
  const result = [];

  function walk(directory, prefix = '') {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePosixPaths(left.name, right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSafeRelativePosixPath(relative, 'Repository path');
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), `Symbolic links and junctions are not allowed: ${relative}`);
      if (exclude(relative, stat)) continue;
      if (stat.isDirectory()) {
        walk(absolute, relative);
      } else {
        assert.ok(stat.isFile(), `Special files are not allowed: ${relative}`);
        result.push(relative);
        if (maxFiles !== undefined) {
          assert.ok(result.length <= maxFiles, `File count exceeds ${maxFiles}: ${root}`);
        }
      }
    }
  }

  walk(root);
  const sorted = result.sort(comparePosixPaths);
  assertNoPathCollisions(sorted, 'Repository paths');
  return sorted;
}

export function walkOwnedRepositoryFiles(root) {
  return walkRegularFiles(root, {
    exclude: repositoryPath => isIgnoredRepositoryPath(repositoryPath)
  });
}

export function readJsonFile(file, label = 'JSON file') {
  assertRegularFile(file, label);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${file}`, { cause: error });
  }
  return parsed;
}

export function writeFileAtomic(file, bytes) {
  assert.ok(!existsSync(file), `Refusing to overwrite existing file: ${file}`);
  const parent = path.dirname(file);
  mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(file)}.tmp-${randomUUID()}`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function replaceFileAtomic(file, bytes) {
  assert.ok(existsSync(file), `Cannot replace missing file: ${file}`);
  const parent = path.dirname(file);
  const temporary = path.join(parent, `.${path.basename(file)}.tmp-${randomUUID()}`);
  const backup = path.join(parent, `.${path.basename(file)}.backup-${randomUUID()}`);
  let movedOriginal = false;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(file, backup);
    movedOriginal = true;
    renameSync(temporary, file);
    rmSync(backup, { force: true });
  } catch (error) {
    try {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
      if (movedOriginal && existsSync(backup)) {
        if (existsSync(file)) rmSync(file, { force: true });
        renameSync(backup, file);
      }
    } catch {
      // Preserve the original replacement error.
    }
    throw error;
  }
}

export function renameWithRetry(source, destination, { attempts = 10, delayMilliseconds = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const retryable = process.platform === 'win32'
        && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
        && attempt + 1 < attempts;
      if (!retryable) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMilliseconds * (attempt + 1));
    }
  }
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function replaceJsonAtomic(file, value) {
  replaceFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGit(repoRoot, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  assert.ok(Number.isInteger(result.status), `git ${args.join(' ')} did not start: ${result.error?.message ?? 'unknown error'}`);
  if (!allowFailure && result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${stderr.trim()}`);
  }
  return result;
}

export function readGitMetadata(repoRoot) {
  const inside = runGit(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return { commit: null, branch: null, dirty: null };
  }
  const commitResult = runGit(repoRoot, ['rev-parse', 'HEAD'], { allowFailure: true });
  const branchResult = runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  const statusResult = runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], { allowFailure: true });
  return {
    commit: commitResult.status === 0 ? commitResult.stdout.trim() : null,
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : null,
    dirty: statusResult.status === 0 ? statusResult.stdout.length > 0 : null
  };
}

export function assertGitCleanWhenAvailable(repoRoot) {
  const metadata = readGitMetadata(repoRoot);
  if (metadata.dirty !== null) assert.equal(metadata.dirty, false, 'Challenge repository is dirty before apply');
  return metadata;
}

export function removeEmptyParents(start, stop) {
  const boundary = path.resolve(stop);
  let current = path.resolve(start);
  while (current !== boundary && current.startsWith(`${boundary}${path.sep}`)) {
    if (!existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || readdirSync(current).length > 0) break;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

export function resolveUtcTimestamp(nowValue, environment = process.env) {
  let date;
  if (nowValue !== undefined) {
    assertNonEmptyString(nowValue, 'now', 64);
    date = new Date(nowValue);
  } else if (environment.SOURCE_DATE_EPOCH !== undefined) {
    assert.match(environment.SOURCE_DATE_EPOCH, /^\d+$/, 'SOURCE_DATE_EPOCH must be decimal seconds');
    date = new Date(Number(environment.SOURCE_DATE_EPOCH) * 1000);
  } else {
    date = new Date();
  }
  assert.ok(Number.isFinite(date.getTime()), 'Timestamp is invalid');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseCommandLine(args, { booleanFlags = [] } = {}) {
  const positionals = [];
  const options = new Map();
  const flags = new Set();
  const booleanNames = new Set(booleanFlags);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    assert.ok(name, 'Empty command-line option');
    assert.ok(!options.has(name) && !flags.has(name), `Duplicate command-line option: --${name}`);
    if (booleanNames.has(name)) {
      flags.add(name);
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(name);
    } else {
      options.set(name, next);
      index += 1;
    }
  }
  return { positionals, options, flags };
}

export function commandLineMain(main) {
  Promise.resolve()
    .then(main)
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
