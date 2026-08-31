# Agent Seed

This repository contains the source and release tooling for the `agent-seed` skill.

Agent Seed bootstraps an existing repository with a small set of project-local coding-agent capabilities. It is an installer and orchestrator; repository scanning and owner interviews live in the separate `project-distiller` child skill.

## Component Model

Three components form the required core:

- `agent-seed-updater` runs one bounded version and managed-component check at the beginning of each new agent conversation.
- `project-distiller` performs initial or explicit full repository knowledge distillation, owner interviews, `AGENTS.md`/`agents.d/` generation, and fresh-agent validation.
- `knowledge-updater` preserves durable knowledge established by each completed task without rescanning the repository.

Other bundled components are optional:

- `gitpush`, `gitsync`, and `gittag` support specific Git workflows.
- `ticket-lookup` retrieves configured SR/AR tickets through OpenCLI.
- `git-code-tracker` is a bundled package with repository hooks and tracking state.
- Superpowers, OpenCLI, DevEco CLI, and similar tools remain platform-native recommendations.

Optional components are not installed merely because a platform is detected. They require an explicit request or a confirmed applicable workflow. External-tool failures never block core setup or project distillation.

## Quick Start

Install a tagged `agent-seed.zip` release through the normal skill installation flow for Codex, Claude Code, codeagent-cli, or OpenCode. Invoke `/agent-seed` from the project to initialize.

Agent Seed will:

1. Resolve the shared `knowledge_asset_write_mode`.
2. Run its cached release update check.
3. Detect the selected project agent platform.
4. Install and verify the three required project-local components.
5. Invoke `project-distiller` when project knowledge is uninitialized, incomplete, failed, or explicitly requested for a full refresh.

Do not run onboarding from this source repository unless this repository is the intended target. When maintaining Agent Seed itself, pass the actual target project path to the installed skill.

## Permission Modes

Store the team mode in `.agents/agent-seed.json`:

| Mode | Behavior |
| --- | --- |
| `full-access` | Applies declared project-local core installs, updates, instruction edits, and confirmed knowledge-asset writes without a separate prompt. Managed local modifications are still preserved for owner review. |
| `agent-approve` | Writes within a confirmed knowledge scope; asks before installs, conflicts, deletion, broad rewrites, hooks, network access, and personal/global writes. |
| `ask-each-change` | Asks before every project file change or install. |

The current request overrides shared config. A first run without either asks the owner to choose and recommends `full-access`.

## Managed Components

Inspect one platform:

```sh
node scripts/manage-managed-skills.mjs check <target-project> --platform <platform> --json
```

Synchronize required/default components in `full-access`:

```sh
node scripts/manage-managed-skills.mjs apply <target-project> --all --platform <platform> --approved --json
```

Apply one owner-approved component in an approval-gated mode:

```sh
node scripts/manage-managed-skills.mjs apply <target-project> --name <component> --platform <platform> --approved --json
```

The manager:

- copies direct skills through staging;
- backs up and rolls back each independent component;
- records a content SHA-256 in `.agent-seed-managed.json`;
- reports locally edited managed content as `modified` and never batch-overwrites it;
- executes and verifies known `AGENTS.md`/`CLAUDE.md` post-install rules inside the install transaction;
- treats required core components as deferrable but not persistently declineable;
- permits exact-version decline suppression only for optional offers.

The most important states are `current`, `install-available`, `missing`, `update-available`, `partial`, `modified`, `unverified`, and `baseline-unavailable`.

## Knowledge Lifecycle

Shared `.agents/agent-seed.json` contains the distillation marker:

```json
{
  "schema_version": 2,
  "knowledge_asset_write_mode": "full-access",
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "2026-08-29T10:00:00.000Z",
    "agent_seed_version": "v1.0.0"
  }
}
```

`project-distiller` owns state transitions:

- missing, invalid, `in_progress`, or `failed` starts distillation;
- `complete` plus `AGENTS.md` skips automatic distillation;
- missing `AGENTS.md` repairs even with a complete marker;
- an explicit full refresh always bypasses the marker.

`knowledge-updater` is a separate bounded completion path. It uses only the current conversation and initialized knowledge assets; it does not scan the repository or mark initial distillation complete.

## Project State

| Path | Ownership |
| --- | --- |
| `.agents/agent-seed.json` | Shared team policy, minimum Agent Seed version, and distillation state; commit it. |
| `.agents/agent-seed.local.json` | Local install root, proxy, update cache, and optional-offer decisions; ignore it. |
| `.agents/managed-skills.json` | Shared desired managed-component baselines where used; commit it. |
| `.agent-seed-managed.json` | Installed component provenance and content digest inside each managed target. |
| `AGENTS.md` and `agents.d/` | Project knowledge maintained by Project Distiller and Knowledge Updater. |

## Agent Seed Self Update

Released packages contain `VERSION.json` and `scripts/update-agent-seed.mjs`.

Check the cached latest release state:

```sh
node scripts/update-agent-seed.mjs --json
```

Apply only after explicit owner approval:

```sh
node scripts/update-agent-seed.mjs --apply
```

On Windows, a locked skill directory can queue the verified replacement for completion after the agent host exits. The helper records terminal success or failure in local state.

## Repository Maintenance

Run checks and build release artifacts:

```sh
make check
make release VERSION=v1.2.3
```

The release package is built from `skill/`. Maintainer tests and release scripts remain at repository root. Tagged releases contain `agent-seed.zip`, the expanded artifact, `VERSION.json`, bundled component archives, and `agent-seed-release.json` with SHA-256 digests.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)
