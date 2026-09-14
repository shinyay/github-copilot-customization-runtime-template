import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain, parseCommandLine } from './lib/common.mjs';
import { applyChallengePack } from './lib/apply.mjs';

export { applyChallengePack } from './lib/apply.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const { positionals, options, flags } = parseCommandLine(process.argv.slice(2), {
      booleanFlags: ['reset']
    });
    assert.equal(positionals.length, 1,
      'Usage: node .hackathon/scripts/apply-pack.mjs <pack-directory> --team <team-id> --condition <condition> [--run-id <run-id>] [--now <rfc3339>] [--reset]');
    const allowedOptions = new Set(['team', 'condition', 'run-id', 'now']);
    const allowedFlags = new Set(['reset']);
    for (const option of options.keys()) assert.ok(allowedOptions.has(option), `Unknown option: --${option}`);
    for (const flag of flags) assert.ok(allowedFlags.has(flag), `Unknown flag: --${flag}`);
    assert.ok(options.has('team'), 'Missing required option: --team');
    assert.ok(options.has('condition'), 'Missing required option: --condition');
    const result = applyChallengePack({
      repoRoot: REPOSITORY_ROOT,
      packDirectory: positionals[0],
      teamId: options.get('team'),
      condition: options.get('condition'),
      runId: options.get('run-id'),
      now: options.get('now'),
      reset: flags.has('reset')
    });
    process.stdout.write(`${JSON.stringify({ status: 'pass', run: result.state }, null, 2)}\n`);
  });
}
