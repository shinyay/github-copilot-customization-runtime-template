# GitHub.com provisioning and run boundary

Creating a repository from this GitHub template copies repository files into a
new repository. It does not reproduce all source repository settings, secrets,
webhooks, branch protections, environments, rulesets, or Git history. An
administrator must apply those controls during post-provisioning.

GitHub App provisioning is deferred. This foundation PR does not install an
App, create credentials, grant organization access, configure webhooks, or
assert that a server-side Copilot customization was discovered.

## Provisioning sequence

1. Create a private repository from the template.
2. Apply the required visibility, collaborators, rulesets, branch protection,
   Actions policy, and retention settings outside the template copy.
3. Confirm no secrets or organization credentials were copied into repository
   files.
4. Obtain the condition-specific Challenge Pack from the private Hub.
5. Run `npm run verify` before applying the pack.
6. Run `apply-pack.mjs` with the assigned team and condition.
7. Keep each condition in the isolation boundary declared by the pack.

The original application workflow is retained only for manual
`workflow_dispatch`. The lightweight runtime workflow validates pushes and pull
requests only in the source
`shinyay/github-copilot-customization-runtime-template` repository, without
running the legacy database, WAR, or container acceptance suite. Its job is
skipped in repositories generated from the template, where participant changes
are checked with the assigned Pack and `verify-run.mjs` instead.

## What static verification means

A passing workflow proves only repository bytes and contract behavior. It does
not prove that Copilot loaded a file, invoked a hook, connected to MCP, used a
plugin, improved an answer, or produced an educational effect. Capture those
observations separately under an approved challenge procedure.
