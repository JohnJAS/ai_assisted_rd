---
name: agent-seed-updater
description: Use exactly once before the first project task in each new conversation to run Agent Seed's cached self-update check and verify or synchronize required project-local managed components. Do not scan the repository or start knowledge distillation.
---

# Agent Seed Updater

Run one bounded preflight before the first user task in a new conversation. Continue the requested task after reporting or safely handling actionable results.

## Boundaries

Read only:

- `.agents/agent-seed.json` and `.agents/agent-seed.local.json`;
- `.agents/managed-skills.json` when present;
- configured managed component targets and their metadata;
- root `AGENTS.md` and the applicable `CLAUDE.md` import;
- the recorded Agent Seed installation, manifests, and updater scripts.

Do not scan repository source, interview the owner, invoke `project-distiller`, update project knowledge, inspect personal/global skill directories, configure hooks, or install optional/external tools without an explicit request.

## Locate And Resolve

Read `.agents/agent-seed.local.json.installation.skill_root` and verify it contains `VERSION.json`, both bundled manifests, and the update scripts. If unavailable, use only an Agent Seed root already exposed by the active runtime; never search personal directories. Report `agent-seed-unavailable` and continue when no valid root exists.

Resolve `knowledge_asset_write_mode` from the current request and then shared config before the preflight. If absent, report `mode-selection-required` and ask the owner to run Agent Seed setup. Do not choose a fallback here.

## Check

Run:

```bash
node <agent-seed-root>/scripts/check-agent-seed-updates.mjs <project-root> --platform <platform> --skill-root <agent-seed-root> --json
```

Pass `--skip-self-update` only for an explicit one-conversation skip. A persistent `self_update.check_on_start: false` skips only the remote release check; local managed verification still runs.

Keep `current` and declined optional versions silent. Report one concise notice for:

- Agent Seed `version-incompatible`, `baseline-refresh-available`, `update-available`, or `unknown`;
- component `install-available`, `missing`, `update-available`, `partial`, `modified`, `unverified`, `legacy-unmanaged`, or `baseline-unavailable`;
- returned errors.

`modified` means installed managed content differs from its recorded digest. Never overwrite it automatically, including in `full-access`; ask the owner whether to keep, merge, or explicitly replace it.

## Managed Actions

In `full-access`, synchronize actionable required/default components:

```bash
node <agent-seed-root>/scripts/manage-managed-skills.mjs apply <project-root> --all --platform <platform> --skill-root <agent-seed-root> --approved --json
```

The batch rechecks state, skips modified content, optional exact-version declines, and unavailable baselines, applies known instruction edits transactionally, and continues after independent component failures.

In approval-gated modes, disclose the target and instruction edits, then apply only the approved component:

```bash
node <agent-seed-root>/scripts/manage-managed-skills.mjs apply <project-root> --name <component> --platform <platform> --skill-root <agent-seed-root> --approved --json
```

Required core components may be deferred but cannot be persistently declined. Record an exact-version decline only for an optional offer:

```bash
node <agent-seed-root>/scripts/manage-managed-skills.mjs decline <project-root> --name <optional-component> --platform <platform> --skill-root <agent-seed-root> --confirmed --json
```

An Agent Seed replacement always requires explicit owner approval:

```bash
node <agent-seed-root>/scripts/update-agent-seed.mjs --apply --target <agent-seed-root> --config <project-root>/.agents/agent-seed.json
```

If replacement completes synchronously, rerun the combined check against the new manifests. If Windows queues the replacement, wait until the next conversation; do not inspect staged content or start another update.

## Verification And Finish

After a managed batch, rerun the combined check. A component is complete only when its content digest and declared instruction rule verify. Report remaining `partial`, `modified`, failed, or unavailable entries.

Continue the original user task. This updater never decides whether project knowledge needs distillation; the canonical startup rule routes that separately through Agent Seed or `project-distiller`.
