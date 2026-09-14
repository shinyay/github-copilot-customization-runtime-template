# Local Challenge Pack run

## Prerequisites

- A fresh repository created from this template
- Node.js 20 or later
- A Challenge Pack directory obtained separately from the private Hub
- A fresh editor profile and conversation when required by the pack

Repository checks cannot inspect or reset home, user, or organization settings.
Prepare those isolation boundaries outside this repository.

## Start

From the repository root:

```powershell
npm run verify

node .hackathon\scripts\apply-pack.mjs C:\packs\HC-001 `
  --team team-01 `
  --condition customized
```

Apply refuses a dirty or contaminated template, validates the source and
template hashes, and writes `.hackathon/run.json` only after every selected
inert starter is installed.

The `baseline` condition must remain free of active customizations. For other
conditions, create only files allowed by the selected condition. Do not rename
`.template` files in place under `.hackathon`; copy the relevant content to the
declared participant destination and author the result there.

## Verify progress

```powershell
node .hackathon\scripts\verify-run.mjs C:\packs\HC-001 `
  --stage in-progress
```

The verifier checks all non-ignored paths against source ownership. Build output
under `target/`, dependency content under `node_modules/`, Git internals, and
root `.runtime/` or `.tools/` are ignored; they are never submission inputs.

## Submit

Complete each current-condition evidence file and its required Markdown
headings, then run:

```powershell
node .hackathon\scripts\verify-run.mjs C:\packs\HC-001 `
  --stage submitted

node .hackathon\scripts\export-submission.mjs C:\packs\HC-001
```

The bundle is written to `submission/`. Only current-condition
`submissionFiles` selected from verified participant additions, changed
declared mutations, and required evidence are included, under inert flattened
names. Inspect the bundle before moving it to any external system.

Cleanup fields in the pack are a manual checklist. The scripts do not stop
processes, archive repositories, or claim those actions completed.
