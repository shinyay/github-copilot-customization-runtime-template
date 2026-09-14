import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT, commandLineMain } from './lib/common.mjs';
import { verifyBaseline } from './lib/baseline.mjs';
import { verifySupportedContracts } from './lib/contracts.mjs';
import { verifyNeutralState } from './lib/neutral.mjs';
import { verifyPristineTemplate } from './lib/ownership.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  commandLineMain(() => {
    const baseline = verifyBaseline(REPOSITORY_ROOT);
    const contracts = verifySupportedContracts(REPOSITORY_ROOT);
    const neutral = verifyNeutralState(REPOSITORY_ROOT);
    const ownership = verifyPristineTemplate(REPOSITORY_ROOT);
    process.stdout.write(`${JSON.stringify({
      status: 'pass',
      sourceTreeSha256: baseline.sourceTreeSha256,
      templateTreeSha256: baseline.templateTreeSha256,
      overrideCount: baseline.overrideCount,
      templateOwnedFiles: ownership.template.files.length,
      packSchemas: contracts.acceptedPackSchemaVersions,
      neutralScope: neutral.scope
    }, null, 2)}\n`);
  });
}
