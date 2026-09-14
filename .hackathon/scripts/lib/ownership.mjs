import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPOSITORY_ROOT,
  isIgnoredRepositoryPath,
  resolveInside,
  sha256,
  walkRegularFiles
} from './common.mjs';
import { loadTemplateBaseline, loadTemplateConfiguration, verifyBaseline } from './baseline.mjs';
import { compilePathPattern } from './glob.mjs';
import { loadTemplateManifest } from './template-manifest.mjs';
import { verifyNeutralState } from './neutral.mjs';
import { verifySubmissionBundle } from './submission-format.mjs';

function compiledPatterns(records) {
  return records.map(record => ({ record, expression: compilePathPattern(record.pattern) }));
}

export function verifyPristineTemplate(repoRoot = REPOSITORY_ROOT) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const baseline = loadTemplateBaseline(repoRoot);
  const template = loadTemplateManifest(repoRoot);
  verifyBaseline(repoRoot);
  verifyNeutralState(repoRoot);
  const expected = new Set([
    ...baseline.files.map(record => record.path),
    ...template.files.map(record => record.path)
  ]);
  const actual = walkRegularFiles(repoRoot, {
    exclude: repositoryPath => isIgnoredRepositoryPath(repositoryPath)
  });
  const extra = actual.filter(repositoryPath => !expected.has(repositoryPath));
  const missing = [...expected].filter(repositoryPath => !actual.includes(repositoryPath));
  assert.deepEqual(extra, [], `Pristine template has unowned files: ${extra.join(', ')}`);
  assert.deepEqual(missing, [], `Pristine template has missing owned files: ${missing.join(', ')}`);
  assert.ok(!actual.includes(configuration.runState), 'Pristine template must not contain run state');
  return { baseline, template, fileCount: actual.length };
}

export function classifySourceOwnership(repositoryPath, context) {
  if (isIgnoredRepositoryPath(repositoryPath)) return 'ignored';
  if (context.baselinePaths.has(repositoryPath)) return 'baseline-owned';
  if (context.templatePaths.has(repositoryPath)) return 'template-owned';
  if (repositoryPath === context.runState
    || repositoryPath.startsWith(`${context.evidenceRoot}/`)) return 'run-state';
  if (context.appliedPaths.has(repositoryPath)) return 'pack-applied';
  if (repositoryPath === `${context.submissionRoot}/submission.json`
    || repositoryPath.startsWith(`${context.submissionRoot}/artifacts/`)) return 'submission-bundle';
  const matches = context.additionPatterns.filter(candidate => candidate.expression.test(repositoryPath));
  if (matches.length > 0) return 'participant-addition';
  return 'violation';
}

export function verifyRunOwnership({
  repoRoot = REPOSITORY_ROOT,
  state,
  rules
}) {
  const configuration = loadTemplateConfiguration(repoRoot);
  const baseline = loadTemplateBaseline(repoRoot);
  const template = loadTemplateManifest(repoRoot);
  const mutationPaths = rules.allowedMutations.map(record => record.path);
  verifyBaseline(repoRoot, { allowedMutations: mutationPaths });
  const baselinePaths = new Set(baseline.files.map(record => record.path));
  const templatePaths = new Set(template.files.map(record => record.path));
  const appliedPaths = new Set(state.appliedFiles.map(record => record.destination));
  const additionPatterns = compiledPatterns(rules.allowedAdditions);
  const context = {
    baselinePaths,
    templatePaths,
    runState: configuration.runState,
    evidenceRoot: configuration.evidenceRoot,
    submissionRoot: configuration.submissionDirectory,
    appliedPaths,
    additionPatterns
  };
  const files = walkRegularFiles(repoRoot, {
    exclude: repositoryPath => isIgnoredRepositoryPath(repositoryPath)
  });
  const ownership = [];
  const violations = [];
  let hasSubmissionBundle = false;
  for (const repositoryPath of files) {
    const owner = classifySourceOwnership(repositoryPath, context);
    if (owner === 'submission-bundle') hasSubmissionBundle = true;
    if (owner === 'violation') {
      violations.push({ path: repositoryPath, reason: 'unowned path' });
    }
    ownership.push({ path: repositoryPath, owner });
  }
  assert.deepEqual(violations, [], `Repository ownership violations: ${JSON.stringify(violations)}`);
  if (hasSubmissionBundle) {
    verifySubmissionBundle(repoRoot, configuration, state, {
      rules,
      ownership,
      baseline
    });
  }

  for (const record of state.appliedFiles) {
    const bytes = readFileSync(resolveInside(repoRoot, record.destination, 'Pack-applied path'));
    assert.equal(sha256(bytes), record.sha256, `Pack-applied starter changed: ${record.destination}`);
  }
  return { ownership, baseline, template };
}
