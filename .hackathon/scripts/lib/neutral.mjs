import assert from 'node:assert/strict';
import { REPOSITORY_ROOT, isIgnoredRepositoryPath, walkRegularFiles } from './common.mjs';

const ACTIVE_RULES = [
  ['repository Copilot instructions', path => path === '.github/copilot-instructions.md'],
  ['scoped Copilot instructions', path => /^\.github\/instructions\/.+\.instructions\.md$/.test(path)],
  ['custom agents', path => /^\.github\/agents\/.+\.agent\.md$/.test(path)],
  ['prompt files', path => /^\.github\/prompts\/.+\.prompt\.md$/.test(path)],
  ['agent skills', path => /^\.github\/skills\/[^/]+\/SKILL\.md$/.test(path)],
  ['MCP configuration', path => path === '.vscode/mcp.json'],
  ['hook configuration', path => /^\.github\/hooks\/.+/.test(path)
    || /^\.copilot\/hooks(?:\/|\.json$)/.test(path)],
  ['plugin configuration', path => path === '.github/plugin.json'
    || path === '.github/plugins.json'
    || path === '.github/copilot/plugins.json'
    || path === '.github/copilot/plugin-settings.json'
    || path === '.copilot/plugin.json'
    || path === '.copilot/plugins.json'
    || path === '.copilot/plugin-settings.json'
    || /^\.github\/plugins\/.+/.test(path)
    || /^\.github\/plugin\/.+/.test(path)
    || /^\.copilot\/plugins\/.+/.test(path)],
  ['AGENTS instructions', path => /(?:^|\/)AGENTS\.md$/.test(path)],
  ['CLAUDE instructions', path => /(?:^|\/)CLAUDE\.md$/.test(path)],
  ['Claude customization', path => /^\.claude\/.+/.test(path)],
  ['Cursor customization', path => /^\.cursor\/.+/.test(path)]
];

export function isNeutralScanExcluded(repositoryPath) {
  return isIgnoredRepositoryPath(repositoryPath)
    || repositoryPath.startsWith('.hackathon/')
    || repositoryPath === '.hackathon'
    || repositoryPath.endsWith('.template');
}

export function classifyActiveCustomization(repositoryPath) {
  if (isNeutralScanExcluded(repositoryPath)) return undefined;
  for (const [category, predicate] of ACTIVE_RULES) {
    if (predicate(repositoryPath)) return category;
  }
  return undefined;
}

export function findForbiddenNeutralStateFiles(repoRoot = REPOSITORY_ROOT) {
  const files = walkRegularFiles(repoRoot, {
    exclude: repositoryPath => isIgnoredRepositoryPath(repositoryPath)
  });
  const forbidden = [];
  for (const repositoryPath of files) {
    if (repositoryPath === '.hackathon/run.json'
      || repositoryPath.startsWith('.hackathon/evidence/')
      || repositoryPath.startsWith('.hackathon/submission/')
      || repositoryPath.startsWith('.hackathon/submissions/')
      || repositoryPath.startsWith('evidence/')
      || repositoryPath.startsWith('participant-evidence/')
      || repositoryPath.startsWith('submission/')
      || repositoryPath.startsWith('submissions/')) {
      forbidden.push({ path: repositoryPath, category: 'participant state or evidence' });
      continue;
    }
    if (/(?:^|\/)(?:answer-key|answer-keys|solutions?)(?:[./-]|$)/i.test(repositoryPath)) {
      forbidden.push({ path: repositoryPath, category: 'answer key' });
      continue;
    }
    const category = classifyActiveCustomization(repositoryPath);
    if (category) forbidden.push({ path: repositoryPath, category });
  }
  return forbidden;
}

export function verifyNeutralState(repoRoot = REPOSITORY_ROOT) {
  const forbidden = findForbiddenNeutralStateFiles(repoRoot);
  assert.deepEqual(forbidden, [],
    `Template contains active customization or participant evidence: ${JSON.stringify(forbidden)}`);
  return {
    status: 'pass',
    forbiddenCount: 0,
    scope: 'repository-static-only'
  };
}
