import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain, replaceJsonAtomic } from './lib/common.mjs';
import { loadTemplateConfiguration } from './lib/baseline.mjs';
import { buildTemplateManifest } from './lib/template-manifest.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    assert.equal(process.argv.length, 2,
      'Usage: node .hackathon/scripts/build-template-manifest.mjs');
    const configuration = loadTemplateConfiguration(REPOSITORY_ROOT);
    const file = path.join(REPOSITORY_ROOT, ...configuration.templateManifest.split('/'));
    if (!existsSync(file)) {
      writeFileSync(file, '{"schemaVersion":1}\n', { flag: 'wx', mode: 0o644 });
    }
    const manifest = buildTemplateManifest(REPOSITORY_ROOT);
    replaceJsonAtomic(file, manifest);
    process.stdout.write(`${JSON.stringify({ status: 'pass', files: manifest.files.length }, null, 2)}\n`);
  });
}
