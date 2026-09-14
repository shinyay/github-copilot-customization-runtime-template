import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTemplateManifest } from '../../.hackathon/scripts/lib/template-manifest.mjs';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function copyFilter(source) {
  const relative = path.relative(REPOSITORY_ROOT, source);
  if (!relative) return true;
  const normalized = relative.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments[0] === '.git'
    || segments[0] === '.runtime'
    || segments[0] === '.tools'
    || segments[0] === 'submission'
    || segments.includes('node_modules')
    || segments.includes('target')) return false;
  if (normalized === '.hackathon/run.json'
    || normalized.startsWith('.hackathon/evidence/')
    || normalized.startsWith('.hackathon/challenge/')) return false;
  return true;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  assert.ok(Number.isInteger(result.status),
    `${command} did not start: ${result.error?.message ?? 'unknown error'}`);
  return result;
}

export function createTemplateFixture({ git = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'runtime-template-test-'));
  const repo = path.join(root, 'repo');
  cpSync(REPOSITORY_ROOT, repo, { recursive: true, filter: copyFilter });
  const templateManifest = buildTemplateManifest(repo);
  writeFileSync(path.join(repo, '.hackathon', 'template-manifest.json'),
    `${JSON.stringify(templateManifest, null, 2)}\n`);
  if (git) {
    for (const args of [
      ['init', '--quiet'],
      ['config', 'user.name', 'Runtime Test'],
      ['config', 'user.email', 'runtime-test@example.invalid'],
      ['add', '-A'],
      ['commit', '--quiet', '-m', 'fixture']
    ]) {
      const result = run('git', args, { cwd: repo });
      assert.equal(result.status, 0, result.stderr);
    }
  }
  return { root, repo };
}

export function destroyFixture(fixture) {
  if (fixture?.root && existsSync(fixture.root)) {
    rmSync(fixture.root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
}

export function copyGenericPack(fixture) {
  const pack = path.join(fixture.root, 'pack');
  cpSync(path.join(fixture.repo, '.hackathon', 'fixtures', 'generic-pack'), pack, { recursive: true });
  return pack;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

export function mutatePack(pack, mutate) {
  const manifestFile = path.join(pack, 'manifest.json');
  const manifest = readJson(manifestFile);
  mutate(manifest, pack);
  writeJson(manifestFile, manifest);
  return manifest;
}
