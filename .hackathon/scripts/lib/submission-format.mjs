import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONTRACT_LIMITS,
  SHA256_PATTERN,
  VERIFICATION_RESULTS,
  assertExactKeys,
  assertNoPathCollisions,
  assertSafeRelativePosixPath,
  comparePosixPaths,
  readJsonFile,
  resolveInside,
  sha256,
  walkRegularFiles
} from './common.mjs';
import { compilePathPattern } from './glob.mjs';
import { classifyActiveCustomization } from './neutral.mjs';

const ALWAYS_FORBIDDEN_COLLECTION_PATH = /(?:^|\/)(?:\.git|target|node_modules)(?:\/|$)|(?:^|\/)\.env(?:[./]|$)|\.(?:log|dmp|dump)$/i;
const RAW_COLLECTION_PATH = /(?:^|\/)(?:debug|trace|diagnostic|console|transcript|chat|prompt-log)(?:[._\/-]|$)/i;
const AUTHORED_POLICY_DOCUMENT_BASENAME = /^[^/]+-policy\.md$/i;

const SECRET_PATTERNS = [
  {
    name: 'private-key',
    pattern: /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,
    replacement: '[REDACTED PRIVATE KEY]'
  },
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: '[REDACTED]'
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED]'
  },
  {
    name: 'authorization',
    pattern: /(authorization\s*:\s*)[^\r\n]+/gi,
    replacement: '$1[REDACTED]'
  },
  {
    name: 'credential-assignment-quoted',
    pattern: /((?:"|')?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)(?:"|')?\s*[:=]\s*)(["'])(?!\[REDACTED\]\2)([^\r\n]*?)\2/gi,
    replacement: '$1$2[REDACTED]$2'
  },
  {
    name: 'credential-assignment',
    pattern: /((?:"|')?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)(?:"|')?\s*[:=]\s*)(?!\[REDACTED\])([^\s,"'\r\n}]+)/gi,
    replacement: '$1[REDACTED]'
  },
  {
    name: 'windows-home',
    pattern: /\b[A-Za-z]:\\\\Users\\\\[^\\\r\n"']+?(?=\\\\|["'\r\n]|$)/gi,
    replacement: '%USERPROFILE%'
  },
  {
    name: 'windows-home',
    pattern: /\b[A-Za-z]:\\Users\\[^\\\r\n"']+?(?=\\|["'\r\n]|$)/gi,
    replacement: '%USERPROFILE%'
  },
  {
    name: 'unix-home',
    pattern: /(?:\/home|\/Users)\/[^/\s"'`]+/g,
    replacement: '$HOME'
  }
];

export function redactSubmissionText(text) {
  let output = text;
  const redactions = {};
  for (const rule of SECRET_PATTERNS) {
    let count = 0;
    output = output.replace(rule.pattern, (...args) => {
      count += 1;
      return rule.replacement.replace(/\$(\d+)/g, (_, index) => args[Number(index)] ?? '');
    });
    if (count > 0) redactions[rule.name] = (redactions[rule.name] ?? 0) + count;
  }
  return { text: output, redactions };
}

export function assertNoSensitiveText(text, source) {
  assert.doesNotMatch(text, /-----BEGIN [^-\r\n]*PRIVATE KEY-----/,
    `Private key material remained after redaction: ${source}`);
  assert.doesNotMatch(text, /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    `GitHub credential remained after redaction: ${source}`);
  assert.doesNotMatch(text, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    `Cloud credential remained after redaction: ${source}`);
  assert.doesNotMatch(text,
    /\b[A-Za-z]:\\\\Users\\\\[^\\\r\n"']+?(?=\\\\|["'\r\n]|$)|\b[A-Za-z]:\\Users\\[^\\\r\n"']+?(?=\\|["'\r\n]|$)|(?:\/home|\/Users)\/[^/\s"'`]+/i,
    `Home/profile path remained after redaction: ${source}`);
  const assignments = text.matchAll(
    /(?:"|')?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)(?:"|')?\s*[:=]\s*([^\r\n]*)/gi
  );
  for (const assignment of assignments) {
    assert.match(assignment[1].trim(), /^(?:\[REDACTED\]|"\[REDACTED\]"|'\[REDACTED\]')(?:\s*,)?$/,
      `Credential assignment remained after redaction: ${source}`);
  }
  const authorizations = text.matchAll(/authorization\s*:\s*([^\r\n]*)/gi);
  for (const authorization of authorizations) {
    assert.equal(authorization[1].trim(), '[REDACTED]',
      `Authorization value remained after redaction: ${source}`);
  }
}

export function assertCollectibleSubmissionPath(source) {
  const dirname = path.posix.dirname(source);
  const basename = path.posix.basename(source);
  const rawParentDirectory = dirname !== '.' && RAW_COLLECTION_PATH.test(dirname);
  const rawBasename = RAW_COLLECTION_PATH.test(basename);
  const collectible = !ALWAYS_FORBIDDEN_COLLECTION_PATH.test(source)
    && !rawParentDirectory
    && (!rawBasename
      || AUTHORED_POLICY_DOCUMENT_BASENAME.test(basename));
  assert.ok(collectible,
    `Credentials, raw logs, build output, and repository internals are never collected: ${source}`);
}

export function inertBundlePath(source) {
  const digest = sha256(Buffer.from(source, 'utf8'));
  const basename = path.posix.basename(source);
  const bundlePath = `artifacts/${digest}-${basename}.template`;
  assert.ok(bundlePath.length <= CONTRACT_LIMITS.maxRepositoryPathLength,
    `Flattened submission path is too long: ${source}`);
  return bundlePath;
}

export function submissionTextBytes(bytes, source) {
  assert.ok(!bytes.includes(0), `Submission source must be UTF-8 text, not binary: ${source}`);
  const text = bytes.toString('utf8');
  assert.deepEqual(Buffer.from(text, 'utf8'), bytes, `Submission source must be valid UTF-8: ${source}`);
  return text;
}

export function validateSubmissionDocument(document, state) {
  assertExactKeys(document, [
    'schemaVersion',
    'challengeId',
    'challengeVersion',
    'runId',
    'teamId',
    'condition',
    'templateVersion',
    'sourceTreeSha256',
    'templateTreeSha256',
    'baselineTreeSha256',
    'packSha256',
    'artifacts',
    'verification',
    'createdAt'
  ], 'submission document');
  assert.equal(document.schemaVersion, 1);
  for (const field of [
    'challengeId',
    'challengeVersion',
    'runId',
    'teamId',
    'condition',
    'templateVersion',
    'sourceTreeSha256',
    'templateTreeSha256',
    'baselineTreeSha256',
    'packSha256'
  ]) {
    assert.equal(document[field], state[field], `Submission ${field} does not match run state`);
  }
  assert.equal(document.baselineTreeSha256, document.templateTreeSha256,
    'Submission baselineTreeSha256 must equal templateTreeSha256');
  assert.ok(Array.isArray(document.artifacts), 'Submission artifacts must be an array');
  assert.ok(document.artifacts.length <= CONTRACT_LIMITS.maxSubmissionFiles,
    `Submission exceeds ${CONTRACT_LIMITS.maxSubmissionFiles} files`);
  const sources = [];
  const bundles = [];
  let totalBytes = 0;
  for (const artifact of document.artifacts) {
    assertExactKeys(artifact,
      ['source', 'kind', 'bundlePath', 'sourceSha256', 'sha256', 'bytes', 'redactions'],
      'submission artifact');
    assertSafeRelativePosixPath(artifact.source, 'Submission artifact source');
    assertSafeRelativePosixPath(artifact.bundlePath, 'Submission artifact bundle path');
    assert.equal(artifact.bundlePath, inertBundlePath(artifact.source),
      `Submission artifact path is not the deterministic flattened name: ${artifact.source}`);
    assert.ok(['baseline-mutation', 'participant-addition', 'evidence'].includes(artifact.kind),
      `Unsupported submission artifact kind: ${artifact.kind}`);
    assert.match(artifact.sourceSha256, SHA256_PATTERN);
    assert.match(artifact.sha256, SHA256_PATTERN);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0
      && artifact.bytes <= CONTRACT_LIMITS.maxSubmissionFileBytes,
    `Invalid submission artifact byte length: ${artifact.source}`);
    totalBytes += artifact.bytes;
    assert.ok(totalBytes <= CONTRACT_LIMITS.maxSubmissionTotalBytes,
      `Submission exceeds ${CONTRACT_LIMITS.maxSubmissionTotalBytes} bytes`);
    assert.ok(artifact.redactions && typeof artifact.redactions === 'object'
      && !Array.isArray(artifact.redactions), 'Artifact redactions must be an object');
    for (const value of Object.values(artifact.redactions)) {
      assert.ok(Number.isSafeInteger(value) && value > 0, 'Redaction counts must be positive integers');
    }
    sources.push(artifact.source);
    bundles.push(artifact.bundlePath);
  }
  assertNoPathCollisions(sources, 'Submission sources');
  assertNoPathCollisions(bundles, 'Submission bundle paths');
  assert.deepEqual(sources, [...sources].sort(comparePosixPaths), 'Submission artifacts must be source-sorted');

  assert.deepEqual(document.verification, {
    baseline: 'pass',
    declaredChanges: 'pass',
    runtimeBehavior: 'not-observed',
    educationalEffect: 'not-observed'
  }, 'Submission verification must contain only checks computed by export');
  for (const value of Object.values(document.verification)) {
    assert.ok(VERIFICATION_RESULTS.includes(value), `Unsupported submission verification value: ${value}`);
  }
  assert.match(document.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(new Date(document.createdAt).toISOString().replace(/\.\d{3}Z$/, 'Z'), document.createdAt,
    'Submission createdAt is not a real timestamp');
  assert.ok(new Date(document.createdAt) >= new Date(state.updatedAt),
    'Submission createdAt precedes the submitted run state');
  return document;
}

export function verifySubmissionBundle(repoRoot, configuration, state, { rules, ownership, baseline }) {
  const root = resolveInside(repoRoot, configuration.submissionDirectory, 'Submission directory');
  const document = validateSubmissionDocument(
    readJsonFile(path.join(root, 'submission.json'), 'Submission document'),
    state
  );
  const evidencePaths = new Set(rules.evidenceRequirements.map(record => record.path));
  const submissionPatterns = rules.submissionFiles.map(record => ({
    pattern: record.pattern,
    expression: compilePathPattern(record.pattern),
    matches: 0
  }));
  const eligibleKinds = new Map();
  for (const record of ownership) {
    if (record.owner === 'participant-addition') {
      eligibleKinds.set(record.path, 'participant-addition');
    }
  }
  for (const mutation of rules.allowedMutations) {
    const baselineRecord = baseline.files.find(record => record.path === mutation.path);
    assert.ok(baselineRecord, `Submission mutation is not a baseline path: ${mutation.path}`);
    const sourceBytes = readFileSync(resolveInside(repoRoot, mutation.path, 'Submission mutation source'));
    const sourceSha256 = sha256(sourceBytes);
    if (sourceSha256 !== baselineRecord.sha256) {
      if (mutation.expectedSha256 !== undefined) {
        assert.equal(sourceSha256, mutation.expectedSha256,
          `Submission mutation does not match expected post-image: ${mutation.path}`);
      }
      eligibleKinds.set(mutation.path, 'baseline-mutation');
    }
  }
  for (const evidencePath of evidencePaths) {
    eligibleKinds.set(evidencePath, 'evidence');
  }
  const expectedSources = [...eligibleKinds.keys()]
    .filter(source => submissionPatterns.some(selection => selection.expression.test(source)))
    .sort(comparePosixPaths);
  assert.deepEqual(document.artifacts.map(artifact => artifact.source), expectedSources,
    'Submission artifacts must exactly match the complete eligible source set');
  const expected = ['submission.json'];
  for (const artifact of document.artifacts) {
    assertCollectibleSubmissionPath(artifact.source);
    const sourceFile = resolveInside(repoRoot, artifact.source, 'Submission artifact source');
    const sourceBytes = readFileSync(sourceFile);
    assert.equal(sha256(sourceBytes), artifact.sourceSha256,
      `Submission source changed after export: ${artifact.source}`);

    const expectedKind = eligibleKinds.get(artifact.source);
    assert.equal(artifact.kind, expectedKind,
      `Submission source is not eligible for its declared artifact kind: ${artifact.source}`);
    if (classifyActiveCustomization(artifact.source)) {
      assert.equal(artifact.kind, 'participant-addition',
        `Active customization must be a participant addition: ${artifact.source}`);
    }

    let matched = false;
    for (const selection of submissionPatterns) {
      if (selection.expression.test(artifact.source)) {
        selection.matches += 1;
        matched = true;
      }
    }
    assert.ok(matched, `Submission source does not match a current-condition submission pattern: ${artifact.source}`);

    const redacted = redactSubmissionText(submissionTextBytes(sourceBytes, artifact.source));
    assertNoSensitiveText(redacted.text, artifact.source);
    assert.deepEqual(artifact.redactions, redacted.redactions,
      `Submission redaction metadata changed: ${artifact.source}`);
    const expectedBundleBytes = Buffer.from(redacted.text, 'utf8');
    assert.equal(artifact.bytes, expectedBundleBytes.length,
      `Submission artifact byte length does not match redacted source: ${artifact.source}`);
    assert.equal(artifact.sha256, sha256(expectedBundleBytes),
      `Submission artifact SHA-256 does not match redacted source: ${artifact.source}`);

    const file = resolveInside(root, artifact.bundlePath, 'Submission artifact bundle path');
    const bytes = readFileSync(file);
    assert.deepEqual(bytes, expectedBundleBytes,
      `Submission artifact bytes do not match the deterministic redacted source: ${artifact.bundlePath}`);
    expected.push(artifact.bundlePath);
  }
  for (const selection of submissionPatterns) {
    assert.ok(selection.matches > 0,
      `Submission pattern matched no verified artifact: ${selection.pattern}`);
  }
  const actual = walkRegularFiles(root, { maxFiles: CONTRACT_LIMITS.maxSubmissionFiles + 1 });
  expected.sort(comparePosixPaths);
  assert.deepEqual(actual, expected, 'Submission bundle contains undeclared or missing files');
  return document;
}
