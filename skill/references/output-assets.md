# Output Assets

Use this reference before generating new onboarding files.

## Contents

- Asset Selection
- AGENTS.md
- agents.d
- CLAUDE.md
- Project-Specific Skill
- Recommended External Plugin Installation
- Bundled Direct Skill Installation
- Bundled Package Installation

## Asset Selection

Always generate or update `AGENTS.md` unless the user explicitly asks for another file only.

After an approved project-local `agent-seed-updater` install, add this portable
startup rule to `AGENTS.md`:

> Before the first user task in each new agent conversation, invoke the
> installed `agent-seed-updater` exactly once. Let it run only Agent Seed's
> cached self-update check and the local managed-skill manifest check; do not
> let it invoke Agent Seed onboarding or scan the repository. Report actionable
> results without blocking the requested task. Do not invoke it again in the
> same conversation unless an approved synchronous Agent Seed update requires
> one immediate recheck.
>
> After `agent-seed-updater` returns, inspect the shared
> `knowledge_distillation` state and `AGENTS.md`. If the state is missing,
> invalid, `in_progress`, or `failed`, or if `AGENTS.md` is absent, invoke
> Agent Seed onboarding before the first user task so its Activation Preflight
> installs and verifies the applicable defaults before scanning. A `complete`
> state with `AGENTS.md` present skips automatic onboarding. An owner request
> for a full refresh bypasses that marker and invokes Agent Seed again.

Codex and OpenCode read the canonical startup rule from `AGENTS.md`. For Claude
Code and codeagent-cli (cac), add or preserve a root `CLAUDE.md` import of
`@AGENTS.md`. In `full-access`, declared updater installation and instruction
edits may run automatically; approval-gated modes require owner approval. Do
not add a recurring hash scan, automatic Agent Seed self-upgrade, lifecycle
hook, or external-plugin directory replacement.

Verify the updater target and startup-rule visibility independently. When a
pre-existing or partial installation verifies but has a missing startup rule,
offer an approval-gated repair of only `AGENTS.md` or the required `CLAUDE.md`
import. If the instruction edit fails after the skill copy, keep the harmless
skill files and report the exact missing instruction surface.

Existing projects may contain an old direct `manage-managed-skills.mjs check`
preflight. After the approved `agent-seed-updater` install succeeds, replace
only that obsolete direct manager preflight and preserve unrelated project
instructions. Do not use this migration to scan the repository, interview the
owner, or repeat knowledge distillation.

## Managed Skill Synchronization

The installed `agent-seed-updater` resolves the effective
`knowledge_asset_write_mode` before its combined preflight. In `full-access`,
the root `activation_policy.managed_target_policy` enables automatic managed
synchronization of declared project-local bundled skills and packages:

```bash
node <agent-seed-root>/scripts/manage-managed-skills.mjs apply <project-root> --all --platform <platform> --skill-root <agent-seed-root> --approved --json
```

The batch selects `update-available`, `install-available`, `missing`,
`unverified`, and `legacy-unmanaged` in manifest order, while skipping
`current`, `declined-current-version`, and `baseline-unavailable`. An
exact-version decline remains suppressed until a higher manifest version
appears.
Each entry has its own backup and rollback; when an entry has failed, report the
failed rollback and continue with later entries. In approval-gated modes,
retain approval-gated per-entry prompts and use the existing `--name` apply or
`--confirmed` decline command.

Apply returned `post_install` actions within their declared scope, then rerun
the combined preflight. External integrations remain platform-native and
platform-owned: Agent Seed reports them but never copies, deletes, or replaces
an external plugin directory.

After an approved project-local `knowledge-updater` install, add this concise
portable completion rule to `AGENTS.md` and keep the detailed workflow in the
skill. Codex and OpenCode read the canonical rule from `AGENTS.md`. For Claude
Code and codeagent-cli (cac), add or preserve a root `CLAUDE.md` import of
`@AGENTS.md` so both Claude-compatible hosts see the same rule:

> After completing and verifying every task, invoke the installed
> `knowledge-updater` skill immediately before the final response. Let it use
> only current-conversation knowledge plus existing `AGENTS.md` and relevant
> `agents.d/` files; do not let it scan the repository. Append exactly one
> status returned by the skill, such as `Knowledge assets: updated (...)` or
> `Knowledge assets: no new reusable knowledge`. If the skill is unavailable
> or cannot be invoked, append `Knowledge assets: update failed (skill
> unavailable)` and finish the main task normally.

In `full-access`, declared skill installation and its declared `AGENTS.md` or
`CLAUDE.md` post-install edits can run without another prompt; approval-gated
modes require owner approval. Verify the selected platform's skill target and
host-visible completion rule independently. If the skill is installed but the
completion rule or import is missing, offer a mode-appropriate repair even
though the skill itself already verifies. Treat a copied skill followed by a
failed instruction edit as a recoverable partial installation: keep the skill
and report the exact missing rule or import for repair. Do not generate
lifecycle or SessionEnd hooks.

Generate `agents.d/` by default for knowledge distillation, but do not create an
empty directory during lightweight initialization. If it is absent, the
`knowledge-updater` may create one focused file on demand and add its link to
`AGENTS.md`. Skip it entirely when the project is small and the owner explicitly
wants everything in a concise `AGENTS.md`.

Generate platform-specific files only for platforms the owner uses or explicitly requests, such as `CLAUDE.md`, `GEMINI.md`, `.cac/`, or `.opencode/`. If platforms are unknown, ask before generating platform-specific files.

Generate or propose a project-specific skill when repeated workflows should trigger automatically, when the project will be onboarded repeatedly, or when distilled knowledge should be reused across future agents and checkouts.

## Knowledge Asset Write Mode

Resolve the write mode before creating or editing `AGENTS.md`, `agents.d/`, `CLAUDE.md`, `.cac/`, `.opencode/`, generated project skills, or shared `.agents/agent-seed.json`.

Persist shared Agent Seed policy, including the target project's write mode, in `.agents/agent-seed.json`:

```json
{
  "schema_version": 2,
  "minimum_agent_seed_version": "v0.3.8",
  "knowledge_asset_write_mode": "full-access"
}
```

Supported values:

- `ask-each-change`: Ask before each knowledge asset file creation or edit. State the target file, reason, and intended change.
- `agent-approve`: After the owner confirms the onboarding/update scope, create and edit in-scope knowledge assets autonomously. Still ask before conflicts, deletes, broad rewrites, install commands, hook changes, external network access, or personal/global directory writes.
- `full-access`: Create, update, and reorganize knowledge assets and run applicable default installs and verification without approval. Install authorization includes required network access, personal or global writes, and every manifest-declared side effect, including hooks. Report the diff and verification. Standalone hook changes, secrets, production actions, destructive actions, and unresolved replacement or merge conflicts still require approval.

The current user request wins over the shared project config. If the user does not specify a mode, read `.agents/agent-seed.json`. If the shared config is missing during first-run onboarding, return to the Agent Seed Activation Preflight: ask the owner to choose one mode, recommend `full-access`, persist the selected mode in `.agents/agent-seed.json`, and then resume asset writes. Downstream bundled skills and installers must use that resolved mode instead of choosing their own fallback.

`.agents/agent-seed.local.json` is local operator state and may contain machine-specific proxy settings or update permission history. When creating it, ensure `.gitignore` contains `.agents/agent-seed.local.json`; keep `.agents/agent-seed.json` trackable. Do not document reusable project knowledge only in either config file; put shared instructions in `AGENTS.md` or `agents.d/`.

## Knowledge Distillation Completion

Record the shared onboarding lifecycle in `.agents/agent-seed.json`:

```json
{
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "2026-08-05T10:00:00.000Z",
    "agent_seed_version": "v0.3.8"
  }
}
```

Missing or invalid state, `in_progress`, and `failed` mean onboarding is not
complete. `complete` is valid only when `AGENTS.md` exists and the initial or
explicit full run finished its scan, interview, asset generation, fresh-agent
dry run, and self-review. A full refresh explicitly requested by the owner
always bypasses `complete`; preserve existing assets and leave the state
non-complete if the refresh fails. Routine `knowledge-updater` work must not set
or clear this state.

Recommend external platform plugins when a mature cross-project tool should be installed through Codex, Claude Code, OpenCode, or another platform's normal network-backed plugin flow instead of being bundled into the generated project assets.

If `bundled-skills.json` exists in this skill, inspect it before proposing bundled direct skills. Use it as the source of truth for direct skill source paths, supported platforms, target paths, overlays, activation policy, default-offer rules, verification, and the root `activation_policy.managed_target_policy`.

If `bundled-packages.json` exists in this skill, inspect it before proposing bundled packages or platform skills. Use it as the source of truth for vendored package versions, source commits, package paths, nested platform skill paths, activation policy, install commands, and the root `activation_policy.managed_target_policy`. Resolve `<package-dir>` from the configured package path before showing or running an installer.

## AGENTS.md

`AGENTS.md` is the portable, platform-agnostic entry point. Both OpenAI Codex and OpenCode CLI read this file as project rules.

Use this structure:

```markdown
# AGENTS.md

## Project Snapshot
## Tech Stack
## Commands
## Environment Setup
## Automation Runbook
## Approved Skills And Tools
## agents.d Index
## Repository Map
## Development Rules
## Testing and Verification
## Debugging Playbook
## Change Recipes
## Agent Workflow
## Human Review Handoff
## Risk Areas
## Do Not
## Missing Context
```

Write in short imperative prose.

Section guidance:

- `Project Snapshot`: State what the project does using confirmed files, owner input, and the project description from Step 0.
- `Tech Stack`: List languages, frameworks, runtimes, package managers, and major tools.
- `Commands`: Include only commands found in project files or confirmed by the owner.
- `Environment Setup`: List prerequisites, runtime versions, package manager setup, local services, required files, and environment variables. Do not include secret values.
- `Automation Runbook`: Provide the shortest confirmed path from fresh checkout to running, building, and testing. Include expected success signals.
- `Approved Skills And Tools`: List approved skill invocations, recommended external plugins, project scripts, and internal tools, or point to `agents.d/tooling.md`.
- `agents.d Index`: Link to split-out knowledge files when generated. Omit this section when no `agents.d/` files are generated.
- `Repository Map`: Describe important directories and boundaries.
- `Development Rules`: Capture project-specific style, architecture, dependency, and review rules.
- `Testing and Verification`: State exactly what agents must run before claiming completion.
- `Debugging Playbook`: Capture common failure symptoms, diagnostic commands, logs to inspect, and owner-confirmed recovery steps.
- `Change Recipes`: List common change workflows and the files/checks they involve, or point to `agents.d/change-recipes.md`.
- `Agent Workflow`: Tell agents to read context, make focused edits, preserve conventions, verify, and report changes.
- `Human Review Handoff`: State what evidence the agent must provide before human review, including commands run, outputs observed, skipped checks, and remaining risks.
- `Risk Areas`: List modules, files, workflows, or data paths needing extra care.
- `Do Not`: List hard constraints and forbidden actions.
- `Missing Context`: Keep unresolved questions that affect safe agent work.

Do not include platform-specific visible sections in `AGENTS.md`. If the owner works with Codex, Codex-specific tips may be added as an HTML comment at the end:

```markdown
<!-- Codex: prefer rg over find; read nearby code before editing; keep changes scoped -->
```

## agents.d

Generate `agents.d/` as the default home for detailed distilled knowledge. Keep each file focused and directly actionable.

Recommended structure:

```text
agents.d/
  bootstrap.md
  tooling.md
  development-loop.md
  architecture-map.md
  debug-playbook.md
  change-recipes.md
  review-handoff.md
  risk-areas.md
```

File guidance:

- `bootstrap.md`: Fresh checkout, prerequisites, environment files, local services, seed data, and success signals.
- `tooling.md`: Approved skills, recommended external plugins, scripts, CLIs, code generators, validators, safety levels, inputs, outputs, and failure recovery.
- `development-loop.md`: Daily run/build/test/lint commands, fast checks, slow checks, and when each is required.
- `architecture-map.md`: Entry points, module boundaries, data flow, generated code, and files that change together.
- `debug-playbook.md`: Symptom -> diagnosis -> recovery tables with logs and commands.
- `change-recipes.md`: Common tasks, likely files, required tests, and review notes.
- `review-handoff.md`: What the agent must report before human review and what evidence to include.
- `risk-areas.md`: Dangerous workflows, invariants, migration rules, security/cost/data risks, and escalation triggers.

In `AGENTS.md`, point agents to the relevant `agents.d/` file instead of duplicating detailed content.

## CLAUDE.md

Generate a concise `CLAUDE.md` only when Claude Code is used or requested.

Target 80-120 lines maximum with this structure:

```markdown
# CLAUDE.md

## Project Overview
## Tech Stack
## Critical Commands
## Code Style & Conventions
## Workflow Preferences
## Architecture Notes
```

Guidance:

- `Project Overview`: 2-3 sentences on what the project does and its purpose, drawn from Step 0 and confirmed evidence.
- `Tech Stack`: Concise list of languages, frameworks, and key tools with versions when known.
- `Critical Commands`: Exact commands for install, build, test, lint, and format. One command per line. Only confirmed commands.
- `Code Style & Conventions`: Naming conventions, file organization, import ordering, and formatting rules not already enforced by tooling.
- `Workflow Preferences`: Branch strategy, commit message format, PR process, and review expectations when project-specific.
- `Architecture Notes`: Key decisions, module boundaries, and data flow patterns that help safe changes.

If the project is too large for 80-120 lines, use imports such as `@AGENTS.md` or `@docs/architecture.md`. Keep the file focused on Claude Code needs. Do not include generic best practices, personality instructions, or duplicated content already available through `AGENTS.md`.

## Project-Specific Skill

Generate or propose a project-specific skill when repeated workflows should trigger automatically.

The project skill should:

- Live in the location the user wants for installation or sharing. If unspecified, propose repository-local `skills/<project>-onboard/`.
- Include concise trigger metadata for working in this exact project.
- Point agents to `AGENTS.md` and `agents.d/` for stable rules instead of duplicating all content.
- Reserve official skill resource directories when useful: `scripts/` for executable helpers, `references/` for load-on-demand docs, and `assets/` for templates or resources used in outputs.
- Use an additional `packages/` directory for versioned bundled packages that may contain multiple platform skills, scripts, commands, plugins, hooks, or assets.
- Use an additional `skills/` directory only for direct repository-local skills whose folder is itself the skill root.
- Use an additional `bundled-skills/` directory only for copy-only direct skills shipped inside the onboarding skill. Keep `packages/` for installer-backed or version-pinned distribution units.
- Track direct bundled skills in `bundled-skills.json`; enumerate source paths, supported platforms, target paths, overlays, default-offer rules, verification, and safety policy.
- Track external bundled package versions in `bundled-packages.json`; pin tags to immutable commits and enumerate nested platform skills.
- If the owner explicitly wants reserved empty directories, create them only in the generated project skill package and use the repository's existing placeholder convention, such as `.gitkeep`, when empty directories must be tracked.
- Include only durable setup, run, build, test, debug, change, review, and handoff procedures.
- Avoid secrets, personal machine paths, one-off troubleshooting logs, and broad AI behavior advice.
- Include `agents/openai.yaml` when creating a Codex-discoverable skill.

Use this structure when the project skill needs reusable resources, bundled direct skills, or bundled packages:

```text
<project>-onboard/
  SKILL.md
  agents/
    openai.yaml
  scripts/
  references/
  assets/
  bundled-skills/
    <skill>/
      skill/
        SKILL.md
      overlays/
        codex/
          agents/
            openai.yaml
  packages/
    <package>/
      README.md
      .claude/skills/<skill>/SKILL.md
      .cac/skills/<skill>/SKILL.md
      .opencode/skills/<skill>/SKILL.md
```

Use `scripts/`, `references/`, and `assets/` according to the official skill resource convention. Treat `packages/` and direct `skills/` as additional distribution directories, not required official resource directories.

Use this `SKILL.md` structure:

```markdown
---
name: <project>-onboard
description: Use when working in <project>, especially for setup, running, building, testing, debugging, or preparing changes for review.
---

# <Project> Onboard

## Read First
## Bootstrap
## Approved Skills And Tools
## Development Loop
## Change Recipes
## Debugging
## Verification
## Handoff
## Escalate To Human
## Bundled Direct Skills
## Bundled Packages
```

## Recommended External Plugin Installation

External plugin recommendations are guidance, not bundled assets. Do not add them to `bundled-skills.json` or `bundled-packages.json` unless the owner explicitly changes the requirement to vendoring.

Use `external-packages.json` as the source of truth for known external plugin recommendations. Its `activation_policy` requires checking applicable external plugins before onboarding work continues and recording a reason when an applicable install is skipped. For each configured plugin that matches the owner's platform and is not already available, copy the relevant configured fields into the generated guidance instead of writing plugin-specific prose by hand.

When recommending external plugins in `AGENTS.md`, `agents.d/tooling.md`, or a generated project skill, include:

- Plugin name and purpose.
- Platforms it applies to.
- How to detect whether it is already available.
- The platform-native install action.
- Required network access, approval by mode, and declared install side effects.
- Verification after installation.
- A clear note that the plugin is recommended externally and is not vendored into `bundled-skills.json`, `bundled-packages.json`, or project-local skill folders.

Use the configured `install_action`, `detection_evidence`, `verification`, `default_recommendation`, and root `activation_policy.mode_policy` fields for platform-native instructions. In `full-access`, run applicable default installs and verification without a separate prompt, including required network, personal/global writes, and declared install side effects. In `ask-each-change` and `agent-approve`, present the action and side effects before asking. Network access is not an independent approval gate when it is a declared part of a `full-access` install.

## Bundled Direct Skill Installation

When generating a project-specific skill that contains copy-only bundled skills, include installation guidance either in the project skill's `SKILL.md` or in `references/bundled-skills.md`.

For each bundled direct skill, document:

- Skill name, version, purpose, source path, and supported platforms.
- Default install mode, whether to offer by default, and approval behavior by mode.
- Platform target paths, overlay paths, and detection evidence for Codex, Claude Code, codeagent-cli (cac), OpenCode, or other supported tools.
- Exact copy behavior: copy the `source_path` directory into each selected platform target path, then apply the platform overlay if one is configured.
- Existing target behavior: apply the root `managed_target_policy`; `full-access` may replace and verify a declared project-local target, while approval-gated modes ask before each existing-target write.
- Verification step after install for each selected platform.
- Root managed-target policy and any entry-specific declared write scope; do not recreate removed per-entry safety blocks.

Install direct bundled skills only for platforms the owner explicitly uses or repository evidence detects. Detection evidence includes owner answers and platform-specific project files such as `.codex`, `skills/`, `.claude`, `CLAUDE.md`, `.cac`, `.opencode`, `opencode.json`, or `.opencode.yaml`. Treat `.cac/` as codeagent-cli (cac), a Claude-compatible directory layout. Do not treat `AGENTS.md` by itself as proof that Codex project-local skills should be installed. Do not create platform directories for unknown or unused platforms by default.

When `bundled-skills.json` marks `default_install.offer_by_default`, apply the resolved mode after selecting the project platforms. In `full-access`, copy and verify the applicable default without a separate prompt when the root policy authorizes it. In `ask-each-change` and `agent-approve`, proactively offer it and run the copy only after approval. A personal/global target requires an explicit owner request in every mode.

After an authorized `knowledge-updater` install succeeds, also add the recurring
task-completion rule from Asset Selection to `AGENTS.md`. This is the only
bundled direct skill whose successful installation adds that completion rule.
For Claude Code and codeagent-cli, also ensure `CLAUDE.md` imports
`@AGENTS.md`. These instruction edits are declared post-install side effects and
share the install authorization. Check the skill target and instruction surface
separately on every onboarding run so a pre-existing or partial installation
can repair its missing completion rule without replacing the skill. Undeclared
standalone hooks or other harness configuration remain separate actions.

After an authorized `agent-seed-updater` install succeeds, add the startup rule
from Asset Selection. This is the only bundled direct skill whose successful
installation adds the once-per-conversation startup rule. Check the skill
target and instruction surface independently so partial installations can be
repaired without replacing an already verified updater.

## Bundled Package Installation

When generating a project-specific skill that contains bundled packages, include installation guidance either in the project skill's `SKILL.md` or in `references/bundled-packages.md`.

For each bundled package, document:

- Package name, package path, and package README or install guide.
- Version, source repository, tag/ref, and pinned commit when externally sourced.
- What workflow should trigger the package or its nested platform skills.
- Whether it is required, recommended, or optional.
- Supported platforms and nested platform skill names/source paths.
- Project-local install destination.
- Exact package installation step or manual copy instruction.
- Files or directories the installer may write.
- Verification step after install for each platform skill.
- Root managed-target policy and declared package write roots; do not duplicate shared safety policy on each entry.

When `bundled-packages.json` marks `default_install.offer_by_default`, apply the resolved mode after its applicability and platform gates pass. In `full-access`, run and verify the installer without a separate prompt; authorization includes every path and side effect declared by the manifest. In `ask-each-change` and `agent-approve`, disclose those effects and run only after approval. A personal/global target requires an explicit owner request in every mode.

If the platform supports direct repository-local skill loading, document that path instead of copying files.

The bundled `git-code-tracker` entry is pinned to `v1.0.7` / `d882fc8ba66b5aadf32e0c445389e51eaa17ae7f`. Its release asset is `packages/git-code-tracker/ai-commit-statistic-skill-v1.0.7.zip`; it contains `.opencode/skills/ai-code-tracker`, `.claude/skills/ai-code-tracker`, and `.cac/skills/ai-code-tracker`. Prefer `node scripts/install-git-code-tracker.mjs <target-project>` over duplicating manual copy details. The installer detects one platform from explicit request, runtime evidence, or target-project markers, copies only that asset entry, runs the copied skill's `install.js`, applies the Agent Seed default `uploadUrl` of `http://7.213.196.158:8088/v1/records` when the project has no non-empty URL, then runs `--check`. The v1.0.7 tracker records AI modification sources through its `pre-commit`, `post-commit`, `pre-push`, and `post-rewrite` hooks, sends records on future `git push` operations, and queues failed batches in `.ai-tracking/upload-outbox.json`. The manifest declares this network effect and its hook writes: `full-access` authorizes them with the install, while the two approval-gated modes must disclose and approve them first. Use `--platform all` only when the owner explicitly wants all supported agent integrations. The copied skill's initializer is project-local and may write the selected platform skill directory, selected platform commands/plugins/hooks/settings, `.ai-tracking`, `.gitignore`, and `AGENTS.md`.
