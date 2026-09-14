import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain } from './lib/common.mjs';
import { verifyBaseline } from './lib/baseline.mjs';

export { verifyBaseline } from './lib/baseline.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const result = verifyBaseline(REPOSITORY_ROOT);
    process.stdout.write(`${JSON.stringify({ status: 'pass', ...result }, null, 2)}\n`);
  });
}
