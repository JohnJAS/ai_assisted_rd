# Update Existing Assets

Use this reference when the user adds reusable project knowledge after initial onboarding.

Trigger phrases include "remember this", "add this to AGENTS.md", "update agents.d", "we found another debug step", "this script should be used for X", "install this project skill", "add this bundled skill", "add this bundled package", "add this platform skill", or any request to preserve newly discovered setup/build/test/debug/tooling knowledge.

## Knowledge Asset Write Mode

Resolve `knowledge_asset_write_mode` before editing existing assets. The current user request wins over shared project config. If the user does not specify a mode, read `.agents/agent-seed.json`. If it is missing, stop and ask the owner to choose one mode through the Agent Seed Activation Preflight, recommend `full-access`, persist the selected mode in `.agents/agent-seed.json`, and then resume the update. Do not let a downstream update flow choose its own fallback.

Persist shared Agent Seed policy, including the write mode, as:

```json
{
  "schema_version": 2,
  "minimum_agent_seed_version": "v0.3.8",
  "knowledge_asset_write_mode": "full-access"
}
```

Supported values:

- `ask-each-change`: Ask before each edit to `AGENTS.md`, `agents.d/`, `CLAUDE.md`, `.opencode/`, generated project skills, bundled manifests, or `.agents/agent-seed.json`.
- `agent-approve`: After the owner confirms the update scope, make minimal in-scope edits autonomously. Still ask before conflicts, deletes, broad rewrites, install commands, hook changes, external network access, or personal/global directory writes.
- `full-access`: Make in-scope knowledge asset edits directly and run applicable default installs and verification without approval. Install authorization includes required network access, personal or global writes, and all manifest-declared side effects, including hooks. Report the diff and fresh-agent dry-run result. Standalone hook changes, secrets, production actions, destructive actions, and unresolved replacement or merge conflicts still require approval.

`.agents/agent-seed.local.json` is local operator state and may contain proxy settings or update permission history. When creating it, ensure `.gitignore` contains `.agents/agent-seed.local.json`; keep `.agents/agent-seed.json` trackable. Do not store reusable project knowledge only in either config file; update `AGENTS.md` or `agents.d/` for shared guidance.

## Update Flow

1. Resolve `knowledge_asset_write_mode` from the current request or `.agents/agent-seed.json`.
2. Read existing `AGENTS.md`, relevant `agents.d/` files, platform files, and any project-specific skill before editing.
3. Classify the knowledge into the right home.
4. Preserve or add source labels.
5. Convert raw anecdotes into executable instructions, recipes, playbooks, or escalation triggers.
6. Apply the resolved mode before each file creation, edit, or install action.
7. Use the smallest coherent edit; do not rewrite entire onboarding files unless the structure is already broken.
8. Exclude secrets, private account identifiers, one-off personal machine paths, and temporary incident chatter.
9. If new knowledge contradicts existing assets, call out the conflict and ask the owner which rule wins before editing.
10. After updating, run the relevant fresh-agent dry-run slice for the affected path.

## Classification

Place knowledge according to where a future agent will look first:

- Entry rules, high-level workflow, and links: `AGENTS.md`.
- Fresh checkout, prerequisites, environment files, local services, seed data: `agents.d/bootstrap.md`.
- Approved skills, scripts, CLIs, code generators, validators, safety levels: `agents.d/tooling.md`.
- Bundled direct skills, supported platforms, target paths, trigger conditions, copy behavior, conflict handling, and verification: `agents.d/tooling.md`, `bundled-skills.json`, and the project-specific skill's `bundled-skills/` directory or bundled-skill reference.
- Bundled packages, platform skills, versions, installation targets, trigger conditions, written files, and verification: `agents.d/tooling.md`, `bundled-packages.json`, and the project-specific skill's `packages/` directory or bundled-package reference.
- Daily run/build/test/lint commands, fast checks, slow checks: `agents.d/development-loop.md`.
- Entry points, module boundaries, data flow, generated code, files that change together: `agents.d/architecture-map.md`.
- Failure symptoms, diagnostics, logs, recovery steps: `agents.d/debug-playbook.md`.
- Common tasks, likely files, required tests, review notes: `agents.d/change-recipes.md`.
- Handoff evidence, reviewer expectations, "done" criteria: `agents.d/review-handoff.md`.
- Dangerous workflows, invariants, migrations, security/cost/data risks, escalation triggers: `agents.d/risk-areas.md`.
- Repeated triggerable workflows: the project-specific skill, a direct repository-local skill under `skills/`, or a platform skill inside a bundled package.
- Platform-specific behavior: `CLAUDE.md`, `GEMINI.md`, `.opencode/`, or other platform file.

If a piece of knowledge fits multiple files, keep the detailed rule in one file and link to it from the entry point. Avoid duplication.

## Source Labels

Preserve labels such as:

- `Repo-confirmed`
- `Owner-confirmed`
- `Observed during run`
- `Preference`
- `Risk judgment`
- `Unknown`

If the source matters but is missing, ask. If asking would block a minor edit, mark it `Unknown` and include the unresolved question in `Missing Context`.

## Distill New Knowledge

Convert:

- "I usually fix this by..." into a symptom -> diagnosis -> recovery playbook.
- "Always be careful with..." into a risk invariant or escalation rule.
- "Use this script for..." into a tooling entry with trigger, command, inputs, output, success signal, and safety level.
- "Use/install this simple skill for..." into a bundled direct skill entry with source path, supported platforms, target paths, default-offer rule, conflict behavior, verification, and safety level.
- "Use/install this package for..." into a bundled package entry plus platform skill entries with version, package path, platform source paths, trigger, install target, written files, verification, and safety level.
- "This failed because..." into a debug entry only if the failure is likely reusable.
- "Before review I check..." into review-handoff evidence or senior-review heuristics.

Do not append chat transcript. Write the future-facing instruction.

## Conflict Handling

When new knowledge conflicts with existing instructions:

1. Identify the exact files and rules in conflict.
2. Ask which one is current.
3. Update the losing rule or move it to historical context only if that history prevents future mistakes.
4. Verify there is not a second stale copy elsewhere.

Never silently pick a rule when the conflict could affect setup, tests, data, security, releases, or review.

## Minimal Diff Guidelines

- Keep headings stable when possible.
- Add one focused subsection or table row rather than reformatting a whole file.
- Preserve existing tone and structure.
- Remove stale duplicated guidance only when needed to avoid contradiction.
- Update `AGENTS.md` index links when a new `agents.d/` file is added.
- Update the project-specific skill only when the knowledge affects triggerable workflows or required read order.
- Add or update bundled direct skills only when reusable workflows can be distributed as copy-only project-local skills for detected or requested platforms.
- Add or update bundled packages only when reusable workflows need installer-backed distributed files or nested platform skills; otherwise document the workflow as an approved tool or recipe.
- Update `bundled-skills.json` whenever a direct bundled skill is added, removed, renamed, or changes supported platforms, target paths, overlay paths, default-offer rules, verification, or safety policy.
- Update `bundled-packages.json` whenever a vendored package or nested platform skill is added, removed, upgraded, or re-pinned.

