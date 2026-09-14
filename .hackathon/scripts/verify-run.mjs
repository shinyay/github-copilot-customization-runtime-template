import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain, parseCommandLine } from './lib/common.mjs';
import { verifyChallengeRun } from './lib/verify-run.mjs';

export { verifyChallengeRun } from './lib/verify-run.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const { positionals, options, flags } = parseCommandLine(process.argv.slice(2));
    assert.equal(flags.size, 0, 'verify-run does not accept flags');
    const allowedOptions = new Set(['stage', 'now']);
    for (const option of options.keys()) assert.ok(allowedOptions.has(option), `Unknown option: --${option}`);
    assert.equal(positionals.length, 1,
      'Usage: node .hackathon/scripts/verify-run.mjs <pack-directory> [--stage applied|in-progress|submitted] [--now <rfc3339>]');
    const result = verifyChallengeRun({
      repoRoot: REPOSITORY_ROOT,
      packDirectory: positionals[0],
      requestedStage: options.get('stage'),
      now: options.get('now')
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}
