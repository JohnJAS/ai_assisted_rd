---
name: agent-seed
description: Use when the user asks to distill repository evidence and owner knowledge into agent runbooks, make a repository AI-agent ready, generate or comprehensively refresh AGENTS.md/agents.d/CLAUDE.md, prepare Codex/Claude/codeagent-cli/OpenCode to work in an existing codebase, identify common or private framework conventions during repository scans, capture project setup/build/test/debug/tooling knowledge from a knowledgeable developer, define human review checkpoints for agent self-directed development loops, recommend configured external agent plugins, or install or document bundled packages or platform skills.
---

# Agent Seed

Distill repository evidence and owner knowledge into executable agent runbooks, review checkpoints, and project-local guidance that let coding agents develop in safe self-directed loops.

Default to senior-developer knowledge distillation. The normal output is `AGENTS.md` plus `agents.d/`; add platform-specific files only for platforms the owner uses, and generate or propose a project-specific skill when repeated workflows should trigger automatically.

This skill can also distribute bundled direct skills listed in `bundled-skills.json` and bundled packages listed in `bundled-packages.json`. A bundled direct skill is a simple skill directory copied into supported project-local platform paths. A bundled package may contain one or more platform-specific skills and may be configured as a default project-local install candidate. Every onboarding run for Codex, Claude Code, OpenCode, codeagent-cli (cac), or another supported agent must inspect these manifests. Apply each manifest's mode-aware activation policy: `full-access` installs and verifies applicable defaults autonomously, while `ask-each-change` and `agent-approve` retain approval-gated install prompts.

## Version And Self Update

Released packages include `VERSION.json` with the packaged skill version, repository, commit, primary release asset, and release manifest name. On every Agent Seed activation, complete this self-update preflight before onboarding conclusions in this order: read `VERSION.json` from this skill root when present, resolve shared `.agents/agent-seed.json` policy with local `.agents/agent-seed.local.json` state, then run `node scripts/update-agent-seed.mjs --json` unless the owner explicitly asks to skip the check or shared policy sets `self_update.check_on_start` to `false`.

The updater checks the GitHub latest release API for the configured repository and compares the local version with the latest tag:

```bash
node scripts/update-agent-seed.mjs --json
```

The shared `minimum_agent_seed_version` is the team's compatibility baseline.
An installed version below it requires an approved update. An equal version is
current. A newer installed version is accepted without downgrade and may be
used to propose a baseline refresh; startup never edits the shared baseline.

After owner approval, refresh the shared baseline with:

```bash
node scripts/update-agent-seed.mjs --refresh-baseline --approved
```

By default, `self_update.check_interval_hours` is 24. A successful `current` or `available` result inside that window is returned from local state without a network request; malformed, deferred, queued, failed, or expired state always triggers a fresh check. Use `node scripts/update-agent-seed.mjs --json --force-check` to bypass the cache. Invoking `/agent-seed` authorizes this GitHub latest-release check and recording the resulting local check state. If the check cannot run because the owner withdraws authorization or network execution fails, do not treat Agent Seed as current or checked. When local-state writes are authorized, record an owner-declined check as `self_update.last_check.status: "deferred"` with `reason: "network-denied"`, then continue the rest of the Activation Preflight and report that update status is unknown.

`self_update.update_mode` defaults to `notify`: report an available update once and await approval before applying it. `manual` reports the state without recommending an update. Neither mode authorizes replacement; `--apply` remains the separate owner-approval boundary.

The updater only applies changes when `--apply` is passed:

```bash
node scripts/update-agent-seed.mjs --apply
```

Never run `--apply` without owner approval. If `VERSION.json` is missing because the skill is running from source instead of a release package, pass `--repository owner/repo` or explain that update metadata is only injected into tagged release artifacts.

When `--apply` is approved, the updater downloads `agent-seed.zip`, expands it, moves the current skill root to a temporary backup, and copies the expanded package into the original target path. This is a replacement update, not a merge: files that existed only in the old skill directory are removed. If copying the new package fails, the updater restores the backup before reporting the error.

On Windows, the current agent host may lock the installed skill directory. If an approved replacement hits that lock, the updater stages the verified package in the current user's local application-data directory, records `status: "queued"` with `reason: "windows-directory-locked"`, and starts an external helper. The update automatically completes after the agent host exits and releases the directory lock. Do not run another update command while it is queued. After it verifies the installed version, the helper records `updated` and sends a best-effort Windows desktop notification that the new version is ready for the next session; failure to show that notification does not change update status. Only a terminal `failed` state requires another `--apply` command.

Use `.agents/agent-seed.json` for shared Agent Seed policy and
`.agents/agent-seed.local.json` for machine-local state. Proxy settings for the
updater live under the local file; for example:

```json
{
  "schema_version": 2,
  "minimum_agent_seed_version": "v0.3.8",
  "knowledge_asset_write_mode": "full-access",
  "self_update": {
    "check_on_start": true,
    "check_interval_hours": 24,
    "update_mode": "notify"
  }
}
```

```json
{
  "schema_version": 1,
  "installation": {
    "skill_root": "C:/Users/example/.codex/skills/agent-seed",
    "recorded_at": "2026-08-03T10:00:00.000Z"
  },
  "self_update": {
    "proxy": {
      "https_proxy": "http://proxy.example:8080",
      "no_proxy": "localhost,127.0.0.1"
    },
    "last_check": {
      "status": "deferred",
      "reason": "network-denied"
    }
  },
  "install_prompt_history": [
    {
      "at": "2026-07-22T08:00:00.000Z",
      "platform": "codex",
      "integration": "opencli",
      "decision": "declined",
      "reason": "Browser automation is out of scope for this project."
    }
  ]
}
```

The shared file is committed and contains no proxy, installation path, update
cache, or personal history. The local file is ignored by Git. When creating a
new project configuration, add `.agents/agent-seed.local.json` to `.gitignore`
and keep `.agents/agent-seed.json` trackable. To persist proxy settings through
the updater, use `node scripts/update-agent-seed.mjs --set-https-proxy <url>`
and optionally `--set-no-proxy <hosts>`. If no updater or environment proxy is
configured, the updater may reuse Git's `http.proxy`/`https.proxy` settings or,
on Windows, the current user's explicit system proxy settings for the GitHub
release check. In an interactive terminal, if the update check fails with a
proxy-like network error and no proxy is configured, the updater may ask for an
HTTPS proxy URL, save it to the local file, and retry once.

`install_prompt_history` is best-effort local audit history. On a declined recurring integration, append the activation time, platform, integration, decision, and owner-provided reason. Never interpret this history as an opt-out or skip marker. If the local state cannot be written, report that limitation and continue after capturing the reason in the current result.

The first split-capable Agent Seed release migrates a legacy unified
`.agents/agent-seed.json` into shared and local files, preserves unknown legacy
fields in local state, and repairs the project's Git ignore rules. New Agent
Seed releases read legacy configuration; old releases are not expected to
write the new split format safely.

## Knowledge Distillation Lifecycle

Agent Seed uses the shared `knowledge_distillation` object in
`.agents/agent-seed.json` to distinguish first-run onboarding from routine task
work:

```json
{
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "2026-08-05T10:00:00.000Z",
    "agent_seed_version": "v0.3.8"
  }
}
```

At the start of a conversation, after the target root is known and before a
detailed repository scan, inspect this state and `AGENTS.md`. Treat a missing,
invalid, `in_progress`, or `failed` state as not initialized. A `complete`
state skips automatic onboarding only when `AGENTS.md` also exists. Do not use
the presence of `agents.d/` as the completion signal; it may be absent and is
created on demand by `knowledge-updater` when detailed knowledge needs a file.

When onboarding starts, record `in_progress`. Record `complete` only after the
scan, owner interviews, asset writes, fresh-agent dry run, and self-review all
finish successfully. Keep an interrupted or failed run non-complete and retain
only a concise last step or error for the next activation.

An explicit request for a full refresh, such as
`重新进行全量知识蒸馏和访谈`, always starts Agent Seed and bypasses the
`complete` marker. Read `references/update-existing-assets.md`, preserve existing
assets, and apply the resolved write mode; a failed refresh keeps the state
non-complete so the next activation can retry it.

## Agent Seed Updater

Agent Seed's own activation continues to run the cached self-update check in
`Version And Self Update`. That self-update preflight must never run
`update-agent-seed.mjs --apply` automatically. Routine new-conversation checks
belong to the bundled project-local `agent-seed-updater` skill instead of this
onboarding skill.

Offer `agent-seed-updater` for every detected, requested, or owner-confirmed
platform according to `bundled-skills.json`. In `full-access`, install it and
apply its declared project-instruction edits without a separate prompt. In the
two approval-gated modes, installation and those edits require owner approval.
The normal self-update command records the installed root under
`.agents/agent-seed.local.json.installation` so the project-local updater can
locate the packaged scripts and manifests without searching personal or global
skill directories.

After an authorized install, add one canonical startup rule to `AGENTS.md`:
before the first user task in each new agent conversation, invoke the installed
`agent-seed-updater` exactly once. Let it run only Agent Seed's cached
self-update check and the local managed-skill manifest check; do not let it
invoke Agent Seed onboarding or scan the repository. Report actionable results
without blocking the requested task. Codex and OpenCode read the rule directly.
For Claude Code and codeagent-cli, ensure the root `CLAUDE.md` imports
`@AGENTS.md`.

The manager uses schema version 2 in shared `.agents/managed-skills.json` for
desired managed skills, packages, and selected external integrations. Managed
target directories use `.agent-seed-managed.json` as installed-version
evidence; a directory without valid metadata is `unverified`, and a desired
version or entry unavailable from the installed Agent Seed is
`baseline-unavailable`, including when its target is also missing. Never apply
a managed version below the shared desired version or a verified newer
installed marker. After an approved higher version is installed, preserve the
higher value in `managed-skills.json` and tell the owner to review and commit
that shared baseline change. Reject unsupported managed state fields and future
schemas without rewriting the shared file.

Bundled manifests declare one root `activation_policy.managed_target_policy`.
In `full-access`, `full_access: "replace-and-verify"` authorizes replacement
inside declared project-local managed targets. In `ask-each-change` and
`agent-approve`, the `approval_gated: "ask-before-write"` policy requires owner
approval before each managed write. A missing root policy falls back to the
conservative approval-gated behavior for existing targets, and
`personal_or_global_target_requires_explicit_request` remains true.
External integration availability and actual versions stay in local
`.agents/agent-seed.local.json`. The manager reports `install-available` for
new applicable default offers and retains `declined-current-version` only as a
quiet diagnostic. Record a decline only
after the owner explicitly rejects that exact manifest version. The same
version stays suppressed; a higher manifest version is offered again. In
`full-access`, invoke the sequential managed batch for actionable bundled
entries and report failures while continuing later entries. In approval-gated
modes, run one managed `apply` or `decline` command only after the
corresponding explicit owner response.

Verify updater availability and startup-rule visibility independently. A
pre-existing or partial installation with a missing startup rule must receive
an approval-gated repair offer without replacing a verified skill directory.

For an existing project, identify the old direct
`manage-managed-skills.mjs check` preflight as obsolete. After the
`agent-seed-updater` install succeeds, remove or replace only that direct
manager preflight and preserve unrelated project instructions. Do not use this
migration to scan the repository, interview the owner, or repeat knowledge
distillation.

Use shared `.agents/managed-skills.json` for Agent Seed-managed bundled skills,
packages, and team-selected `external-packages.json` integrations. Keep actual
external availability and installed versions local, and use the platform-native
update action only after separate owner approval. Preserve the higher shared or
observed external version; never lower the team baseline. Never copy, delete,
or replace an external plugin directory.

## Incremental Knowledge Updater

Agent Seed performs initial repository scanning and owner interviews. Routine
incremental maintenance belongs to the bundled `knowledge-updater` skill.

Offer its project-local installation for every detected, requested, or
owner-confirmed platform according to `bundled-skills.json`. In `full-access`,
install it and apply its declared project-instruction edits without a separate
prompt. In the two approval-gated modes, installation and those edits require
owner approval. After an authorized install, add a concise canonical rule to
`AGENTS.md` for Codex and OpenCode. For Claude Code and codeagent-cli, ensure
the root `CLAUDE.md` imports `@AGENTS.md` so the same rule is visible without
duplication. The rule requires the main agent to invoke `knowledge-updater`
after completing and verifying every task, immediately before its final
response, and to append exactly one returned knowledge-asset status.

Verify skill availability and completion-rule visibility independently. An
installed skill with a missing or stale instruction bridge is not complete;
offer an approval-gated repair even when the skill target already verifies.
Treat a copied skill whose instruction edit failed as a recoverable partial
installation: report the missing instruction surface, leave the harmless skill
files in place, and offer to repair only the missing rule or import.

Do not run Agent Seed, scan the repository, interview the owner, start a child
agent, or configure a lifecycle hook for routine updates.

During onboarding, inspect only project-local `.claude/settings.json` and
`.cac/settings.json` files already in the target-root evidence set for legacy
commands that reference `session-end-knowledge-update.mjs`. Parse each settings
file as JSON, report the exact project file and exact matching command, and
offer to remove only that matching hook array element. Removal requires
explicit approval; preserve unrelated SessionEnd entries and all other
settings. You must not silently edit hook settings and must not inspect
personal or global settings without separate authorization. Existing legacy
local data is left untouched.

## Activation Preflight

Resolve `knowledge_asset_write_mode` before the Activation Preflight. The current user request wins over shared `.agents/agent-seed.json`; if neither selects a mode during first-run onboarding, ask the owner to choose before installing integrations or scanning, recommend `full-access`, and persist the selected mode to shared `.agents/agent-seed.json`. Downstream bundled skills and package installers use that resolved mode instead of asking independently. Before scanning, interviewing, generating files, or answering onboarding conclusions, inspect `external-packages.json`, `bundled-skills.json`, and `bundled-packages.json`. Treat each manifest's `activation_policy.on_agent_seed_start: "must_check"` as a hard gate, including in Claude Code and other environments that may not load platform-specific prompts.

After the target root is known, perform a minimal platform-evidence scan inside that root before deciding which manifest entries apply. Identify the current agent platform from the active environment, user request, and platform evidence such as `.codex/`, `skills/`, `.claude/`, `CLAUDE.md`, `.cac/`, `.opencode/`, `opencode.json`, or `.opencode.yaml`. Treat `.cac/` as codeagent-cli (cac), a Claude-compatible layout whose project-local files mirror `.claude/` under a different directory name. Do not treat `AGENTS.md` by itself as proof that Codex project-local skills should be installed. If target-root platform evidence is absent or ambiguous, inspect current agent runtime evidence next, such as the platform that loaded this skill, visible skills, platform-specific prompt metadata, tool names, or explicit user invocation. Ask the owner before inspecting user-level agent configuration, `$CODEX_HOME`, personal/global directories, plugin caches, session history, or installed global skills; use those locations only to identify candidate platforms, not as target-project facts. If runtime or approved user-level evidence reveals multiple platform candidates, ask the owner to choose which agent platform or platforms this project should support before installing or generating platform-specific assets.

Check the configured detection evidence and verification before taking any install action. Do not reinstall an integration whose configured verification passes. External recommendations remain subject to their `use_when` and evidence rules; bundled entries remain subject to `default_install.offer_by_default` and detected-or-requested platform gating. A conditional tool is not applicable merely because the resolved mode is `full-access`.

In `full-access`, install and verify every missing applicable default without owner approval. Permit the install's required network access and personal or global directory writes without approval. Authorization covers all manifest-declared side effects, including hooks, project instruction edits, and package write roots. Superpowers and OpenCLI are required preflight integrations when they apply to the selected platform. An install or verification failure must block onboarding: report the integration, platform, attempted action, observed failure, and concrete recovery step. If an interactive marketplace or manual platform action prevents completion, stop onboarding, report the exact action, and rerun verification after the owner completes it. Do not record these failures as declines or continue onboarding around them.

In `ask-each-change` and `agent-approve`, ask for approval before installing an applicable default. For `git-code-tracker`, OpenCLI, and any other integration named by `activation_policy.recurring_install_prompt`, `ask-each-change` and `agent-approve` must ask on every activation while the integration remains missing. If the owner declines, ask for a reason, append it to local `install_prompt_history`, and continue onboarding; a previous decline must not suppress a future prompt. Do not prompt for an installed integration whose configured verification has passed.

Do not continue with onboarding until every applicable item is installed and verified, already available, platform-inapplicable, or resolved under the applicable approval-gated policy. Standalone hook changes outside an authorized install, secrets, production actions, destructive actions, and unresolved replacement or merge conflicts still require owner approval in every mode.

Persist the target project's shared Agent Seed policy in `.agents/agent-seed.json`:

```json
{
  "schema_version": 2,
  "minimum_agent_seed_version": "v0.3.8",
  "knowledge_asset_write_mode": "full-access"
}
```

Supported modes are `ask-each-change`, `agent-approve`, and `full-access`. The current user request wins over shared `.agents/agent-seed.json`. If the shared config is missing during onboarding and the current request does not select a mode, ask the owner to choose one mode, recommend `full-access`, write the selected value to `.agents/agent-seed.json`, and only then apply that mode to writes under `AGENTS.md`, `agents.d/`, `CLAUDE.md`, `.cac/`, `.opencode/`, and generated project skill guidance.

Treat external agent workflow suites listed in `external-packages.json` as recommended platform plugins, not bundled packages, unless the user explicitly asks to vendor them. If a configured plugin applies to the owner's platform and is not visible in the current agent environment or project platform config, recommend installing it through the platform's normal network-backed plugin flow instead of copying its internals into the project.

When Superpowers is visible in the current agent environment, use it as the default SDD workflow suite for agent-runnable development loops. Require `superpowers:brainstorming` for feature or behavior design, `superpowers:writing-plans` for implementation planning, `superpowers:subagent-driven-development` or `superpowers:executing-plans` for plan execution, `superpowers:test-driven-development` for feature and bugfix implementation, `superpowers:systematic-debugging` for bugs or unexpected behavior, `superpowers:verification-before-completion` before completion claims, and `superpowers:requesting-code-review` or `superpowers:receiving-code-review` around review handoffs. When Superpowers is missing but applies to the selected platform, in `full-access` install and verify it as a required preflight integration. In `ask-each-change` or `agent-approve`, recommend installing it from `external-packages.json` and proceed only after approval; if the owner declines or the platform cannot load it, document the same SDD stages as expected workflow guidance without claiming the skills are available.

The output files are internal engineering guides and automation runbooks, not consulting reports.

## Core Rules

- Treat the user as the knowledgeable project owner, senior developer, architect, tech lead, or operator unless they explicitly say otherwise.
- Scan before asking detailed questions.
- Separate confirmed facts, inferred details, and missing context.
- Ask targeted interview questions before generating files; use multiple rounds when major knowledge categories remain missing.
- Do not write guessed commands or conventions as facts.
- Preserve the source of knowledge: repository evidence, owner-confirmed fact, operational preference, risk judgment, observed run result, or unknown.
- Treat built-in and project-local framework knowledge as scan guidance and interview prompts, not as confirmed target-project facts.
- Label framework knowledge sources explicitly: `Preset`, `Repo-confirmed`, `Owner-confirmed`, `Inferred`, or `Unknown`.
- Capture automation blockers as explicit breakpoints with owner-confirmed fixes or escalation rules.
- Capture approved skills, recommended external plugins, project scripts, and internal tools with trigger conditions, required inputs, success signals, and safety levels.
- Capture bundled direct skills with source path, supported platforms, target paths, trigger conditions, default-offer rules, verification, and the root `activation_policy.managed_target_policy`.
- Capture bundled packages and their platform skills with version, source, install target, trigger conditions, required inputs, verification, and the root `activation_policy.managed_target_policy`.
- Route routine knowledge discovered during later agent work to the installed `knowledge-updater` skill.
- Distill tacit knowledge into executable instructions, recipes, playbooks, and handoff criteria, not background explanation.
- Preserve existing instruction files unless the user confirms replacement.
- Resolve `knowledge_asset_write_mode` before the Activation Preflight and before writing onboarding assets. In `ask-each-change`, ask before each file creation or edit and before installation. In `agent-approve`, write within the confirmed onboarding/update scope but ask before conflicts, deletes, broad rewrites, installs, hooks, external network use, or personal/global directory writes. In `full-access`, write onboarding assets and run applicable manifest installs directly; a root `managed_target_policy.full_access: replace-and-verify` also authorizes declared project-local managed target replacement. Missing root policy, personal/global targets, standalone hook changes, secrets, production actions, destructive actions, and unresolved replacement or merge conflicts still require owner approval.
- Establish the target project root before scanning. Treat that root as the scan boundary and do not scan the agent-seed skill source directory, personal/global skill directories, Codex plugin caches, or `$CODEX_HOME` as repository evidence unless the user explicitly names one of them as the target project. When target-root evidence cannot identify the platform, ask before a narrow user-level fallback scan and confirm any platform inferred from that scan with the owner.
- Complete Activation Preflight before scan summaries, owner interviews, generated guidance, or claims that no installs are needed; the preflight may include the minimal target-root platform-evidence scan described above.
- Do not run build, test, migration, deploy, or service-start commands unless the user confirms they are safe in the current environment; installation authorization is controlled by the resolved manifest mode policy.
- Install bundled direct skills according to `bundled-skills.json` only for platforms the owner explicitly uses or repository evidence detects. In `full-access`, install and verify every missing applicable default without a separate prompt. In `ask-each-change` and `agent-approve`, ask for approval before installing or applying declared post-install instruction edits.
- Install bundled packages according to `bundled-packages.json` only when their applicability and platform gates pass. In `full-access`, run and verify applicable default installers with all declared write roots and side effects authorized. In the two approval-gated modes, disclose those effects and get approval first.
- A selected personal/global managed target requires an explicit owner request in every mode; in the two approval-gated modes it also requires the corresponding approval before writing.
- Do not store secrets, personal machine paths, private account identifiers, one-off incident chatter, or temporary knowledge in onboarding assets.

## Progressive Disclosure

Read only the reference file needed for the current phase:

- For interview categories, source labels, tooling inventory, recommended external plugins, bundled direct skills, bundled packages, platform skills, version pins, and automation breakpoint capture, read `references/knowledge-distillation.md`; when external plugins are relevant, also inspect `external-packages.json`.
- For uncommon, private, vendor, internally named, or preset-supported frameworks, or when the user mentions a framework the model may not know well, read `references/framework-fingerprints.md`. If `framework-knowledge.json` contains a matching framework entry or the target project provides project-local framework knowledge, load only the matching framework knowledge files before interviewing the owner.
- For `AGENTS.md`, `agents.d/`, `CLAUDE.md`, project-specific skill structures, resource directories, bundled direct skills, bundled packages, platform skills, and default project-local installation, read `references/output-assets.md` before generating files.
- When the user adds knowledge after initial onboarding or asks to update existing instructions, read `references/update-existing-assets.md`.
- Before claiming the project is agent-ready or automation-ready, read `references/fresh-agent-dry-run.md`.

Do not duplicate reference content in generated files. Put the concise entry point in `AGENTS.md` and route detailed runbooks into focused `agents.d/` files.

## Workflow

### 0. Identify The Knowledge Holder, Goal, And Target Root

If the user invoked the skill with a project description or arguments, use that directly. Otherwise ask:

> Briefly describe what this project does, which areas or workflows you know best, and what a new agent or developer should be able to do after this onboarding.

Determine the target project root before scanning:

- If the user provides a project path, use that path as the target root.
- If the current working directory is the project to onboard, use the current working directory as the target root.
- If the current working directory is this `agent-seed` skill, another skill source directory, `$CODEX_HOME`, or a Codex plugin/cache directory, do not scan it as the target project. Ask for the target project path.
- Keep all repository scans, instruction-file checks, and evidence reads inside the target root unless the user explicitly asks to inspect an external dependency, installed skill, or package source.

Ask early which workflows should become agent-runnable, which parts usually require a familiar human, which skills/scripts/tools agents should use, whether any external plugins should be recommended, whether any bundled packages or platform skills should be created or installed, which agent platforms matter, whether to generate a reusable project skill now or only propose its shape, and which `knowledge_asset_write_mode` to use when shared `.agents/agent-seed.json` is absent.

### 1. Inspect Existing Agent Instructions

Check whether instruction files already exist:

```bash
rg --files <target-project-root> -g 'AGENTS.md' -g 'CLAUDE.md' -g 'GEMINI.md' -g '.cac/*' -g '.opencode/*' -g 'opencode.json' -g '.opencode.yaml' -g '.agents/agent-seed.json' -g '.agents/agent-seed.local.json'
```

If any instruction file exists, read it before doing anything else. Ask whether to update it, replace it, or create a draft alongside it. Do not overwrite without confirmation.

If the user is adding new knowledge to existing onboarding assets, prefer a minimal update over regeneration and read `references/update-existing-assets.md`.

### 2. Scan Repository Evidence

Use `rg --files <target-project-root>` first. Use `rg --files --hidden <target-project-root>` when inspecting bundled packages that keep platform assets under hidden directories such as `.claude/` or `.opencode/`. Inspect top-level and second-level structure inside the target root, skipping large generated or dependency folders such as `.git`, `node_modules`, `dist`, `build`, `target`, `.venv`, and `vendor`.

Do not broaden scans above the target root. If a discovered file references an external skill, package, or dependency outside the target root, record that reference and ask before inspecting the external location.

Read existing files from this evidence set when present:

- Project docs: `README*`, docs indexes, architecture docs.
- Language/package metadata: `package.json`, lockfiles, `pyproject.toml`, `requirements*.txt`, `Pipfile`, `poetry.lock`, `pom.xml`, Gradle files, `go.mod`, `Cargo.toml`.
- Build and runtime config: `Makefile`, `justfile`, `Taskfile.yml`, `Dockerfile`, `docker-compose*.yml`.
- CI/CD: `.github/workflows/*`, `.gitlab-ci.yml`, `Jenkinsfile`.
- Agent/tool config: `.agents/agent-seed.json`, `.agents/agent-seed.local.json`, `opencode.json`, `.opencode.yaml`, `.opencode/`, `.claude/settings.json`, `.cac/settings.json`.
- Automation folders: `scripts/**`, `tools/**`, `bin/**`, `tasks/**`.
- Project-bundled packages and skills: `bundled-skills.json`, `bundled-skills/**/SKILL.md`, `bundled-skills/**/agents/openai.yaml`, `bundled-packages.json`, `packages/**/SKILL.md`, `packages/**/skills/**/SKILL.md`, `packages/**/.claude/skills/**/SKILL.md`, `packages/**/.cac/skills/**/SKILL.md`, `packages/**/.opencode/skills/**/SKILL.md`, `skills/*/SKILL.md`, `skills/**/agents/openai.yaml`, and directly related `scripts/`, `references/`, or `assets/`.
- Linter, formatter, type-checker, and test configuration.

Use the project description and knowledge-holder role from Step 0 to decide which files need deeper reading.

Run a framework fingerprint pass before presenting the scan summary:

- Identify framework candidates from dependency names, build plugins, package managers, manifest files, generated directories, source file extensions, decorators, annotations, route/config files, and CLI wrappers.
- Inspect `framework-knowledge.json` before framework fingerprinting and merge matching aliases, fingerprint terms, and knowledge paths with owner-mentioned names.
- Check project-local framework knowledge candidates from the matching registry entry, staying inside the target root.
- Load matching built-in or project-local framework knowledge only after a name, alias, fingerprint, or owner mention makes it relevant.
- Search for owner-mentioned or vendor/private framework names case-insensitively, including aliases and translated names when provided.
- Keep the target root boundary: do not inspect installed SDKs, personal/global skill directories, plugin caches, or external framework sources unless the user explicitly asks.
- If a framework candidate is not well-known from repository evidence, classify it as `Inferred` or `Unknown` and ask targeted owner questions instead of mapping it onto a familiar framework.
- If repository files show framework-specific generators, build tools, DSLs, manifests, or lifecycle hooks, capture them as tooling, architecture, change recipes, and debug breakpoints.
- Keep preset framework knowledge out of `Confirmed`; use it for `Preset`, `Missing`, owner questions, and targeted scan terms.

### 3. Present A Scan Summary

Before generating files, present a compact summary:

```markdown
## Confirmed
- Facts directly found in repository files.

## Inferred
- Likely facts based on filenames, dependencies, or structure.

## Missing
- Information that could not be determined safely.

## Knowledge To Distill
- Tacit project knowledge that likely needs owner confirmation.

## Questions
- Questions for the project owner.
```

Keep `Inferred` conservative. If a command is not found in project files, list it as missing instead of guessing.

### 4. Set The Distillation Scope

Default to knowledge distillation, not a template fill-in.

Normal scope:

- `AGENTS.md` as the concise portable entry point.
- `agents.d/` as the default home for split runbooks, maps, recipes, playbooks, risks, and handoff rules. Do not pre-create it just to mark onboarding complete; create focused files when detailed knowledge requires them.
- Platform-specific files such as `CLAUDE.md`, `GEMINI.md`, or `.opencode/` only when the owner uses or requests those agents.
- A project-specific skill recommendation, and the skill itself when repeated workflows should be shared across future agents or checkouts.
- Recommended external plugins when a mature platform plugin should be installed through the owner's normal network-backed plugin flow instead of vendored into the generated assets.
- Bundled direct skills when simple reusable workflows should be copied into project-local Codex, Claude Code, codeagent-cli, or OpenCode skill directories.
- Bundled packages or bundled platform skills when reusable sub-workflows should be distributed with the onboarding package.

Use a lightweight `AGENTS.md`-only flow only when the user explicitly asks for a small instruction file or template and does not want a knowledge-distillation session.

### 5. Distill Project Knowledge

Read `references/knowledge-distillation.md`.

Interview in rounds. Ask 3-8 questions per round. Prefer fewer questions when repository evidence is strong, but continue when answers reveal missing bootstrap, architecture, change, debug, review, tooling, or risk knowledge.

Prioritize executable answers: exact commands, required inputs, expected success signals, known failure symptoms, owner-approved recovery steps, when agents may act autonomously, and when they must stop for human input.

### 6. Generate Or Update Agent Knowledge Assets

For new onboarding assets, read `references/output-assets.md`.

Always generate or update `AGENTS.md` unless the user explicitly asks for another file only. Generate `agents.d/` by default for distilled knowledge. Generate platform-specific files only for requested or owner-used platforms. Before creating or editing any of these assets, apply the resolved `knowledge_asset_write_mode` from the current request or shared `.agents/agent-seed.json`.

When the user explicitly requests an Agent Seed comprehensive refresh of existing assets, read `references/update-existing-assets.md`, classify the confirmed knowledge into the right file, and use the smallest coherent edit. Routine task-completion updates belong to the installed `knowledge-updater` skill instead.

### 7. Validate With A Fresh-Agent Dry Run

Read `references/fresh-agent-dry-run.md`.

Before finishing, simulate how a fresh agent would use the generated or updated assets. Walk through bootstrap, approved tool selection, run/build/test, debug, at least one representative change path when applicable, and human-review handoff.

Do not claim the assets are automation-ready unless each known failure has a clear next action or an explicit escalation rule.

### 8. Self-Review Before Finishing

Check generated or updated files for:

- Inferred details written as confirmed facts.
- Commands not found in project files or owner answers.
- Generic advice that could apply to any repository.
- Setup, run, build, or test steps without expected success signals.
- Debugging advice that names symptoms but not next actions.
- Unclear automation permissions: autonomous, ask first, or never run.
- Missing source labels where repo evidence and owner judgment differ.
- Tacit knowledge left as explanation instead of executable instructions.
- Approved skills or scripts without trigger conditions, inputs, expected output, and safety level.
- Recommended external plugins documented as vendored assets or automatic installs instead of ask-first network-backed platform installs.
- Bundled direct skills without platform target paths, default-offer rules, existing-target conflict handling, verification, or detected/requested platform gating.
- Manual workflow prose that should point to an approved script or tool.
- `AGENTS.md` becoming too long when content belongs in `agents.d/`.
- Missing testing, verification, human-review handoff, change recipes, tooling inventory, or risk areas.
- New knowledge appended as chat transcript instead of distilled instructions.
- Duplicated or contradictory guidance across `AGENTS.md`, `agents.d/`, platform files, or a project skill.
- Placeholder text such as `TODO`, `TBD`, or vague filler.

Fix issues before presenting the result.

After this self-review succeeds for an initial onboarding or explicit full
refresh, write `knowledge_distillation.status: "complete"` and its
`completed_at` timestamp to the shared Agent Seed config. Do not write
`complete` for a partial, interrupted, declined, or failed run.

## Edge Cases

- If the repository is too large, sample top-level structure and the most important config files first.
- If no metadata files exist, generate minimal files with prominent `Missing Context` sections.
- If the owner cannot answer a question, keep it in `Missing Context`.
- If commands are discovered but may be unsafe, destructive, expensive, or slow, ask before running them.
- If automation commands cannot be run in the current environment, record them as confirmed instructions only when the owner confirms them, and note they were not executed.
- If a breakpoint requires secrets, credentials, private accounts, VPNs, hardware, paid services, or production access, document the requirement and safe escalation path without exposing the secret or attempting access.
- If the owner gives broad background context, convert it into rules, recipes, playbooks, or escalation triggers before writing files.
- If new knowledge is temporary, personal, secret-bearing, or not reusable by future agents, do not write it into onboarding assets; summarize why and ask whether a safe generalized rule exists.
- If the user only asks for a template, provide the structure without scanning or writing repository-specific facts.
- If the user only wants one specific file, generate only that file.
- If a platform file already exists and is well-maintained, offer to update it rather than replacing it.

## Final Response

Summarize:

- Files generated or updated and their paths.
- Whether existing files were updated or new files were created.
- Where owner-confirmed knowledge, newly supplied knowledge, and unresolved missing context were placed.
- Verification performed, including self-review and fresh-agent dry run results.
- Platforms covered by the generated files.
- Whether knowledge distillation, automation runbooks, breakpoints, `agents.d/`, and a project-specific skill were generated, updated, proposed, or intentionally skipped.
