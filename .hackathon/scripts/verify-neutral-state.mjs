import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain } from './lib/common.mjs';
import { verifyNeutralState } from './lib/neutral.mjs';

export { verifyNeutralState } from './lib/neutral.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const result = verifyNeutralState(REPOSITORY_ROOT);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}
