import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain, parseCommandLine } from './lib/common.mjs';
import { exportSubmission } from './lib/submission.mjs';

export { exportSubmission } from './lib/submission.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const { positionals, options, flags } = parseCommandLine(process.argv.slice(2));
    assert.equal(flags.size, 0, 'export-submission does not accept flags');
    const allowedOptions = new Set(['now']);
    for (const option of options.keys()) assert.ok(allowedOptions.has(option), `Unknown option: --${option}`);
    assert.equal(positionals.length, 1,
      'Usage: node .hackathon/scripts/export-submission.mjs <pack-directory> [--now <rfc3339>]');
    const result = exportSubmission({
      repoRoot: REPOSITORY_ROOT,
      packDirectory: positionals[0],
      now: options.get('now')
    });
    process.stdout.write(`${JSON.stringify({
      status: 'pass',
      directory: result.directory,
      artifacts: result.artifacts,
      verification: result.verification
    }, null, 2)}\n`);
  });
}
