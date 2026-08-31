---
name: agent-seed
description: "Use to bootstrap or repair a project's coding-agent setup: resolve Agent Seed policy, detect supported agent platforms, install and synchronize the core project-local skills, optionally install explicitly selected extras, and route initial or full project knowledge distillation to project-distiller. Do not use for routine repository scanning or end-of-task knowledge updates."
---

# Agent Seed

Bootstrap a project with a small, managed set of agent capabilities. Agent Seed is the installer and orchestrator; it does not perform repository knowledge distillation itself.

The core project-local components are:

- `project-distiller`: initial or explicit full repository and owner-knowledge distillation;
- `knowledge-updater`: bounded end-of-task maintenance of initialized knowledge assets;
- `agent-seed-updater`: one lightweight managed-component and Agent Seed check per new conversation.

Git helpers, ticket lookup, code tracking, and external plugins are optional. Install them only after an explicit request or a confirmed project workflow makes them relevant.

## Target And Policy

Establish the target project root before reading or writing project state. If the current directory is the Agent Seed source/installation, a personal skill directory, or a plugin cache, ask for the target project path instead of treating the current directory as project evidence.

Resolve `knowledge_asset_write_mode` in this order:

1. the current owner request;
2. shared `.agents/agent-seed.json`;
3. first-run owner choice, recommending `full-access`.

Supported modes are:

- `full-access`: apply declared project-local core installs, updates, instruction edits, and knowledge-asset writes autonomously;
- `agent-approve`: write within a confirmed knowledge scope, but ask before installs, conflicts, deletion, broad rewrites, hooks, network access, or personal/global writes;
- `ask-each-change`: ask before every project file change or install.

Persist the selected mode in shared `.agents/agent-seed.json`. Keep machine-local installation paths, proxy settings, update cache, and personal offer decisions in `.agents/agent-seed.local.json`; ensure that local file is ignored by Git.

## Self-Update Preflight

When running from a release package, read `VERSION.json`, resolve the shared minimum version, and run the cached update check before installation conclusions unless the owner explicitly skips it or shared policy disables startup checks:

```bash
node scripts/update-agent-seed.mjs --json --target <agent-seed-root> --config <project-root>/.agents/agent-seed.json
```

Report `current`, `update-available`, `version-incompatible`, `baseline-refresh-available`, or `unknown` accurately. A failed or declined network check remains unknown; it is not evidence that the installation is current.

Never apply an Agent Seed replacement without explicit owner approval:

```bash
node scripts/update-agent-seed.mjs --apply --target <agent-seed-root> --config <project-root>/.agents/agent-seed.json
```

On Windows, a locked installation may queue a verified replacement for completion after the agent host exits. Do not start another replacement while one is queued.

## Platform Detection

Perform only the minimal scan needed to select project-local skill targets. Use the current runtime, the owner request, and evidence such as:

- Codex: `.codex/` or project `skills/`;
- Claude Code: `.claude/` or `CLAUDE.md`;
- codeagent-cli: `.cac/`;
- OpenCode: `.opencode/`, `opencode.json`, or `.opencode.yaml`.

`AGENTS.md` alone is not Codex platform evidence. If project and runtime evidence conflict or reveal multiple candidates, ask which platforms the project should support. Do not inspect personal/global skill directories or plugin caches without separate authorization.

## Component Synchronization

Read `bundled-skills.json` and `bundled-packages.json` as the installer source of truth. The manager distinguishes required core components from optional entries, records installed provenance, verifies content digests, and performs declared post-install instruction edits transactionally.

Inspect the selected platform:

```bash
node scripts/manage-managed-skills.mjs check <project-root> --platform <platform> --skill-root <agent-seed-root> --json
```

Use these states:

- `current`: installed content and required instruction rule verify;
- `install-available`, `missing`, `update-available`: an install or synchronization action is available;
- `partial`: the component exists but its required instruction surface is incomplete;
- `modified`: managed content changed locally; never overwrite it automatically;
- `unverified` or `legacy-unmanaged`: provenance is incomplete;
- `baseline-unavailable`: shared desired state requires a version the installed Agent Seed cannot supply.

In `full-access`, synchronize all actionable required/default project-local entries in one sequential batch:

```bash
node scripts/manage-managed-skills.mjs apply <project-root> --all --platform <platform> --skill-root <agent-seed-root> --approved --json
```

The `--approved` flag is the manager's write latch; in `full-access`, authorization comes from the persisted mode rather than a new prompt. The batch skips `modified`, declined optional offers, and unavailable baselines. Each component has its own backup and rollback boundary, and a failed component does not prevent later independent entries from being attempted.

In `agent-approve` and `ask-each-change`, disclose the component target and declared instruction edits, then apply one approved entry:

```bash
node scripts/manage-managed-skills.mjs apply <project-root> --name <component> --platform <platform> --skill-root <agent-seed-root> --approved --json
```

Required core components may be deferred for the current run but cannot be persistently declined. An explicitly offered optional component may suppress the same version after an explicit owner decline:

```bash
node scripts/manage-managed-skills.mjs decline <project-root> --name <component> --platform <platform> --skill-root <agent-seed-root> --confirmed --json
```

A higher optional component version may be offered again. Do not maintain a second recurring-prompt history with different semantics.

After writes, rerun `check`. Do not claim installation complete until component content and any declared `AGENTS.md`/`CLAUDE.md` rule verify.

## Optional And External Tools

Treat `external-packages.json` as a recommendation catalog, not as managed project content. Recommend an external tool only when a confirmed workflow matches its `use_when`. Installation remains platform-native and requires the authorization appropriate to its network, account, and personal/global side effects.

An optional external tool failure must not block installation of the core local components or project knowledge distillation. Never copy, delete, or replace an external plugin directory.

Optional bundled components follow the same rule: do not install Git helpers, `ticket-lookup`, or `git-code-tracker` merely because the platform is supported. Require an explicit request or a confirmed applicable workflow.

## Distillation Routing

After core installation verifies, inspect shared `knowledge_distillation` state and `AGENTS.md`:

- missing, invalid, `in_progress`, or `failed` state invokes `project-distiller`;
- `complete` with missing `AGENTS.md` invokes `project-distiller` for repair;
- `complete` with `AGENTS.md` present skips automatic distillation;
- an explicit full-refresh request always invokes `project-distiller`.

Invoke the installed skill through the active platform. If the current host cannot rediscover a skill installed during the same conversation, read the installed `project-distiller/SKILL.md` directly and follow it for this run; normal discovery applies in the next conversation.

Project Distiller owns repository scanning, owner interviews, knowledge-asset generation, fresh-agent validation, and `knowledge_distillation` state transitions. Do not duplicate those workflows in Agent Seed.

## Finish

Report:

- selected project root, platforms, and policy source;
- Agent Seed update status;
- core components installed, updated, current, partial, modified, or deferred;
- optional components or external tools explicitly installed or only recommended;
- whether Project Distiller ran, skipped due to completed state, or could not run;
- shared files changed and local state written.
