# Runtime troubleshooting

## Baseline hash mismatch

Run:

```powershell
npm run verify:baseline
```

Only `.gitignore` and `.github/workflows/verify.yml` may differ from the source
manifest, and only with the exact hashes in
`.hackathon/baseline-overrides.json`. Restore any other changed or missing
application file from a fresh template repository.

## Template ownership violation

`npm run verify:template` reports any non-ignored file that is not baseline,
template, run state/evidence, selected pack overlay, a current-condition
participant addition, or a validated submission bundle. Remove accidental
caches or declare the intended contract in the Hub pack. Never add local source
clones, answer keys, raw logs, or credentials to the template.

## Unsafe path or file type

Use repository-relative POSIX paths. Do not use absolute paths, drive prefixes,
backslashes, empty/dot/dotdot segments, Windows-reserved names, invalid
characters, symlinks, junctions, sockets, devices, or FIFOs. A parent that
resolves outside the expected root is rejected.

## Overlay destination exists

Challenge Pack v1 never overwrites. Overlay destinations are inert `.template`
files under `.hackathon/challenge/`. Start from a fresh repository or use
`--reset` only while the existing run is still at `applied` and no starter,
participant file, mutation, or evidence has changed.

## Condition change refused

A reset may change condition in place only when both the existing run and
incoming pack declare `branchSafe: true` and
`conditionStrategy: "single-workspace"`. A `separate-workspace` or
`separate-repository` strategy always requires that separate isolation
boundary. A `branchSafe: false` Git run must remain on its recorded named
branch; detached HEAD is rejected.

## Evidence incomplete

Evidence is not required at `applied` or `in-progress`. Before `submitted`,
create every declared evidence path, include each exact required heading, and
replace any unchanged template content.

## Submission refused

Export requires a `submitted` run. It refuses undeclared files, inactive source
paths, `.env`, repository internals, build/dependency output, `.log`, `.dmp`,
and `.dump` files, raw collection names or directories (`debug`, `trace`,
`diagnostic`, `console`, `transcript`, `chat`, and `prompt-log`), binary
content, size/count limits, and flattened-name collisions.

An otherwise eligible authored document such as `diagnostic-policy.md` is
collectible because its basename ends exactly in `-policy.md`
case-insensitively. Near misses such as `diagnostic-policy.md.bak`,
`diagnostic-policy.md-raw`, a `diagnostic/` directory, or a policy-like file
under `.git`, `target`, `node_modules`, or `.env` remain forbidden. This
authored-policy distinction changes only the raw-topic classification;
path-safety, containment, exact eligible-set, size, redaction, hashes, and
post-export verification still apply. Recognized secrets and home/profile
paths are redacted in the bundle, never in the working file.

## Scope limitation

Repository-static checks cannot inspect user/home profiles, editor trust,
organization policy, secrets, webhooks, effective models, or Copilot runtime
behavior. A static pass must not be reported as runtime or educational success.
