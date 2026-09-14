import assert from 'node:assert/strict';
import path from 'node:path';
import {
  MAX_REPOSITORY_PATH_LENGTH,
  assertSafePathSegment
} from './common.mjs';

function escapeRegularExpression(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function validatePathPattern(pattern, label = 'Path pattern') {
  assert.equal(typeof pattern, 'string', `${label} must be a string`);
  assert.ok(pattern.length > 0 && pattern.length <= MAX_REPOSITORY_PATH_LENGTH,
    `${label} must contain 1-${MAX_REPOSITORY_PATH_LENGTH} characters: ${pattern}`);
  assert.ok(!pattern.includes('\0') && !pattern.includes('\\'), `${label} must be NUL-free POSIX: ${pattern}`);
  assert.ok(!pattern.startsWith('/') && !path.posix.isAbsolute(pattern) && !/^[A-Za-z]:/.test(pattern),
    `${label} must be repository-relative: ${pattern}`);
  assert.ok(!/[?[\]{}!]/.test(pattern), `${label} uses an unsupported glob operator: ${pattern}`);
  const segments = pattern.split('/');
  let recursive = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === '**') {
      assert.equal(index, segments.length - 1, `${label} only permits trailing /**: ${pattern}`);
      assert.ok(index > 0, `${label} cannot be only **: ${pattern}`);
      recursive = true;
      continue;
    }
    assert.ok(!segment.includes('**'), `${label} only permits ** as the final complete segment: ${pattern}`);
    assert.ok(segment === '*' || !segment.includes('*'),
      `${label} permits * only as a complete path segment: ${pattern}`);
    assertSafePathSegment(segment, pattern, label, { allowGlob: true });
  }
  return { pattern, segments, recursive };
}

export function compilePathPattern(pattern) {
  const validated = validatePathPattern(pattern);
  const ordinarySegments = validated.recursive ? validated.segments.slice(0, -1) : validated.segments;
  const segmentExpressions = ordinarySegments.map(segment =>
    escapeRegularExpression(segment).replaceAll('\\*', '[^/]*'));
  const suffix = validated.recursive ? '(?:/[^/]+)+' : '';
  return new RegExp(`^${segmentExpressions.join('/')}${suffix}$`);
}

export function matchPathPattern(pattern, repositoryPath) {
  return compilePathPattern(pattern).test(repositoryPath);
}
