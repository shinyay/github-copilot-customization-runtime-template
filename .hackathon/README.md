# Runtime onboarding

This repository is a neutral, immutable Java runtime for isolated GitHub
Copilot customization challenges. The application at repository root is the
fixed 515-file source baseline. Challenge-specific content is supplied only by
a validated Challenge Pack.

The template state contains no active Copilot instructions, agents, prompts,
skills, hooks, plugins, MCP configuration, participant evidence, or answer
keys. Pack payloads and applied starter files remain inert because their names
end in `.template`.

## Static verification

Node.js 20 or later is required. There are no runtime package dependencies.

```powershell
npm test
npm run verify
```

The checks distinguish:

- source baseline tree:
  `c3cd74e0d65b1ae88a29a4392eb42f9d51ba2c671d111796aacc69fd9cc5b111`
- actual template baseline tree after two declared operational overrides:
  `de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2`

Static verification does not claim Copilot runtime use or educational effect.

## Run sequence

```powershell
node .hackathon\scripts\apply-pack.mjs C:\packs\HC-001 `
  --team team-01 `
  --condition customized

# Participant work happens here.

node .hackathon\scripts\verify-run.mjs C:\packs\HC-001 `
  --stage in-progress

# Complete declared evidence, then:
node .hackathon\scripts\verify-run.mjs C:\packs\HC-001 `
  --stage submitted

node .hackathon\scripts\export-submission.mjs C:\packs\HC-001
```

See [the runtime contract](../docs/runtime-contract.md),
[local execution](../docs/local-run.md),
[GitHub.com provisioning](../docs/github-com-run.md), and
[troubleshooting](../docs/troubleshooting.md).
