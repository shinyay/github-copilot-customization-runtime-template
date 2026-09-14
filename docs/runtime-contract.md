# Runtime contract v1

## Purpose and limits

The repository is a neutral runtime, not a challenge pack. Its repository
files can prove deterministic bytes, declared path ownership, and submission
packaging. They cannot observe a user's home/profile configuration,
organization settings, effective Copilot model, customization discovery,
runtime behavior, or educational improvement.

Challenge-specific packs and answer material belong in
`shinyay/github-copilot-customization-hackathon`.

## Baseline identity

The source is
`https://github.com/shinyay/code-to-doc-workshop-260910` at commit
`398d7d1982a1402bcdba00d6c3ded67d8d338787`. The vendored source manifest is
[`baseline-manifest.json`](../baseline-manifest.json).

`baseline-tree-v1` hashes the byte-wise path-sorted records:

```text
path NUL mode NUL gitBlob NUL decimalByteLength NUL sha256 LF
```

The source tree has 515 files and SHA-256
`c3cd74e0d65b1ae88a29a4392eb42f9d51ba2c671d111796aacc69fd9cc5b111`.
The root `README.md` remains the source README byte-for-byte.

Two operational overrides are declared in
[`.hackathon/baseline-overrides.json`](../.hackathon/baseline-overrides.json):

1. `.github/workflows/verify.yml` is `workflow_dispatch`-only so a generated
   repository does not automatically run the expensive legacy application
   workflow on each push or pull request.
2. `.gitignore` uses `.vscode/*` plus `!.vscode/mcp.json`, allowing a declared
   HC-011 participant artifact without exposing other editor state.

Each override records source and template mode, Git blob, byte length, and
SHA-256. The resulting 515-path template tree SHA-256 is
`de428054126dc5fbfde6a7d24372d6c7ca8082ecc2a516d948b1575855ec4cf2`.
No other baseline differences are accepted.

## Path ownership

Every non-ignored regular file has exactly one owner:

| Owner | Meaning |
|---|---|
| `baseline-owned` | One of the 515 exact application paths |
| `template-owned` | Listed in `.hackathon/template-manifest.json` |
| `run-state` | `.hackathon/run.json` or any `.hackathon/evidence/**` file |
| `pack-applied` | Current-condition inert files recorded in `run.json` |
| `participant-addition` | Matches one or more current-condition allowed-addition patterns |
| `submission-bundle` | A validated `submission/submission.json` plus exactly its declared inert artifacts |
| `ignored` | `.git/`, any `target/` or `node_modules/`, root `.runtime/`, or root `.tools/` |
| `violation` | Anything else |

The two operational override paths remain `baseline-owned`; they are not a
separate ownership class because they are still part of the fixed 515-path
template baseline.

Paths are repository-relative POSIX strings. Validation rejects absolute paths,
drive paths, backslashes, NUL, dot/dotdot or empty segments, Windows-reserved
segments, Windows-invalid characters, trailing dot/space, symlinks, junctions,
special files, real-path escape, and NFC plus case-insensitive collisions.

## Challenge Pack manifest

The byte-identical shared schema is
[`.hackathon/schemas/challenge-pack.schema.json`](../.hackathon/schemas/challenge-pack.schema.json),
SHA-256
`d9f963a809d814272c52b0fa986109540f91b3e49130925275f537eb34021a38`.

Key v1 shapes are:

```json
{
  "schemaVersion": 1,
  "challengeId": "HC-001",
  "challengeVersion": 1,
  "minimumTemplateVersion": 1,
  "conditions": ["baseline", "customized"],
  "overlay": [{
    "source": "payload/starter.md.template",
    "destination": ".hackathon/challenge/starter.md.template",
    "conditions": ["customized"],
    "allowOverwrite": false
  }],
  "allowedMutations": [{
    "path": "exact/baseline/path",
    "conditions": ["customized"],
    "expectedSha256": "optional-post-image-64-lowercase-hex"
  }],
  "allowedAdditions": [{
    "pattern": ".github/copilot-instructions.md",
    "conditions": ["customized"]
  }],
  "evidenceRequirements": [{
    "path": ".hackathon/evidence/summary.md",
    "conditions": ["customized"],
    "stage": "submitted",
    "requiredHeadings": ["Summary", "Validation"],
    "templateSha256": "optional-64-lowercase-hex"
  }],
  "submissionFiles": [{
    "pattern": ".github/copilot-instructions.md",
    "conditions": ["customized"]
  }]
}
```

`forbiddenActiveCustomizations` is an unconditional array of additional deny
patterns. `cleanup` is advisory metadata only; the runtime never reports those
manual actions as completed.

Overlay is deliberately unable to create participant deliverables. Every
destination stays below `.hackathon/challenge/`, ends in `.template`, and must
not exist. Participants create active `.github` or `.vscode` files themselves
only when the selected condition allows them. The `baseline` condition may not
permit active customization.

## Glob semantics

`path-glob-v1` is case-sensitive:

- literal path segments match literally;
- a complete `*` segment matches zero or more characters within that segment,
  including a leading dot;
- a trailing `/**` matches one or more descendant segments;
- `?`, character classes, braces, negation, and all other `**` placements are
  invalid.

The shared cases are
[`.hackathon/fixtures/glob-conformance-v1.json`](../.hackathon/fixtures/glob-conformance-v1.json),
SHA-256
`2a1d6a53e3e63cf6f6346112fe41d1ab8a5cd7f921575ec5e854f9264e88a388`.

## Pack hash and application

`pack-hash-v1` includes `manifest.json` and every regular payload file. All
files are non-executable logical mode `100644`. Byte-wise UTF-8 path sorting is
used, never locale sorting:

```text
relativePath NUL 100644 NUL decimalByteLength NUL fileSha256 LF
```

The shared byte fixture is
[`.hackathon/fixtures/pack-hash-v1.json`](../.hackathon/fixtures/pack-hash-v1.json),
file SHA-256
`108c4dfe54d97caa3d789f31505c131813195fd0a8dfc6d07c72c24190ee47bd`.
Its expected `pack-hash-v1` aggregate is
`0b5d5efa3b236407194114cf3067b42f4353a321d631bc6c433abde3d0f32a7d`.

`build-pack.mjs` performs only byte copies. It never interpolates or templates
content, and the manifest never contains its own pack hash.

`apply-pack.mjs` validates the complete pack and repository before writing. It
installs only current-condition inert overlays, then writes `.hackathon/run.json`
as the final success marker. A failure rolls back created files and directories
in reverse order and leaves no run state. Existing runs require explicit
`--reset`; a condition change is refused when either run is not branch-safe.
In-place condition changes additionally require
`conditionStrategy: "single-workspace"`; separate-workspace and
separate-repository strategies always require a new isolation boundary.

Run stages are `applied`, `in-progress`, and `submitted`. Timestamps are UTC
seconds plus `Z`; `--now` and `SOURCE_DATE_EPOCH` support deterministic tests.
Git commit, branch, and dirty state are recorded when available and are `null`
for non-Git fixtures. They describe the clean pre-apply repository used as the
run base; participant changes after apply do not rewrite the recorded
`git.dirty` value.

Run and submission records carry `sourceTreeSha256` for upstream provenance and
`templateTreeSha256` for the two-override runtime bytes.
`baselineTreeSha256` is retained as a compatibility field and is required to
equal `templateTreeSha256`.

The machine-readable run-state shape is
[`.hackathon/schemas/run-state.schema.json`](../.hackathon/schemas/run-state.schema.json),
SHA-256
`316e0f5449acaffe55636082c2be065ff30f8e4479e28ec0c01058204d6f36c7`.

## Active customization and evidence

Active customization is default-deny, including GitHub Copilot instructions,
agents, prompts, skills, MCP, hooks, plugins, `AGENTS.md`, `CLAUDE.md`,
`.claude/**`, and `.cursor/**`. Only `.hackathon/**` and files ending in
`.template` are excluded from neutral-state scanning; an arbitrary directory
named `payload` elsewhere in the repository is not an exclusion boundary.

Only files matching a current-condition `allowedAdditions` pattern may be
active. `forbiddenActiveCustomizations` adds deny rules; it never grants access.
Evidence completeness is checked only when transitioning to `submitted` and
during export.

## Submission

Export matches current-condition `submissionFiles` only against verified
participant additions, changed declared baseline mutations, and required
evidence. Active customization artifacts must be participant additions.
Artifact names are flattened as:

```text
artifacts/<sha256-of-source-path>-<basename>.template
```

Name collisions fail. The exporter caps file count, per-file bytes, total
bytes, and path length; denies `.env`, logs, `.git`, `target`, and
`node_modules`; and redacts recognized credentials and home/profile paths.
It never scans undeclared workspace files.

Verification values are `pass`, `fail`, `blocked`, or `not-observed`.
Submission output contains only checks computed by that export invocation.
Static checks leave runtime behavior and educational effect as `not-observed`.
