import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildPack } from './lib/pack.mjs';
import { commandLineMain, parseCommandLine } from './lib/common.mjs';

export { buildPack } from './lib/pack.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const { positionals, options, flags } = parseCommandLine(process.argv.slice(2));
    assert.equal(options.size, 0, 'build-pack does not accept options');
    assert.equal(flags.size, 0, 'build-pack does not accept flags');
    assert.equal(positionals.length, 2,
      'Usage: node .hackathon/scripts/build-pack.mjs <source-pack> <output-pack>');
    const result = buildPack({ sourceDirectory: positionals[0], outputDirectory: positionals[1] });
    process.stdout.write(`${JSON.stringify({
      status: 'pass',
      files: result.files.length,
      packSha256: result.sha256
    }, null, 2)}\n`);
  });
}
