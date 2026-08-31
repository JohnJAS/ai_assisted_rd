---
name: project-distiller
description: "Use for initial or explicit full project knowledge distillation: scan a repository, interview its knowledgeable owner, and create or comprehensively refresh AGENTS.md and focused agents.d runbooks with fresh-agent validation. Do not use for routine end-of-task knowledge updates or skill installation."
---

# Project Distiller

Turn repository evidence and owner knowledge into executable project guidance for coding agents. The normal result is a concise `AGENTS.md` plus focused files under `agents.d/` only where detailed knowledge is useful.

This skill owns initial and full-refresh knowledge distillation. It does not install or update skills, packages, plugins, hooks, or Agent Seed itself. Return optional tooling recommendations to the caller instead of performing installations.

## Start Decision And State

Establish the target project root before scanning. Never treat the installed Agent Seed directory, a personal/global skill directory, or a plugin cache as the target project unless the owner explicitly names it.

Read `.agents/agent-seed.json` and check `AGENTS.md`:

- Missing, invalid, `in_progress`, or `failed` `knowledge_distillation` state starts initial distillation.
- `complete` with `AGENTS.md` present skips automatic distillation.
- `complete` with `AGENTS.md` absent starts repair distillation.
- An explicit request for full distillation or a full owner interview always starts and preserves existing assets.

Before scanning, write `knowledge_distillation.status: "in_progress"` while preserving unrelated shared config fields. Record `complete` only after scanning, interviews, asset writes, fresh-agent validation, and self-review succeed. On interruption or failure, retain `in_progress` or write `failed` with only a concise last step or error; never store a transcript or sensitive detail in state.

Use the current request's `knowledge_asset_write_mode` when supplied, otherwise read it from `.agents/agent-seed.json`. If neither exists, stop and ask the owner to run Agent Seed setup; this skill does not choose or persist installation policy.

## Boundaries

- Keep repository scans and evidence reads inside the target root.
- Read existing `AGENTS.md`, `CLAUDE.md`, and relevant `agents.d/` files before proposing changes.
- Preserve existing guidance and make the smallest coherent update during a refresh.
- Do not store secrets, personal identifiers, machine-specific paths, temporary debugging attempts, or unsupported inference.
- Do not run build, test, migration, deploy, service-start, or other potentially costly commands without owner confirmation that they are safe in the current environment.
- Do not install recommended tooling. Report each recommendation with its trigger and reason to Agent Seed or the owner.

## Progressive Disclosure

Read only the references required for the current phase:

- For evidence classes, interview categories, source labels, automation breakpoints, and tooling inventory, read [references/knowledge-distillation.md](references/knowledge-distillation.md).
- For uncommon, private, vendor, or preset-supported frameworks, read [references/framework-fingerprints.md](references/framework-fingerprints.md). Load only a matching entry from [framework-knowledge.json](framework-knowledge.json) and its referenced framework file.
- Before creating new project guidance, read [references/output-assets.md](references/output-assets.md).
- For a full refresh of existing guidance, also read [references/update-existing-assets.md](references/update-existing-assets.md).
- Before claiming the result is agent-ready, read [references/fresh-agent-dry-run.md](references/fresh-agent-dry-run.md).

## Workflow

### 1. Establish Goal And Knowledge Holder

Use the owner-provided project description and path when available. Otherwise ask briefly what the project does, which workflows should become agent-runnable, which areas still require human judgment, and what a new agent should be able to accomplish after distillation.

### 2. Inspect Existing Guidance

Find project instruction surfaces before the broad scan:

```bash
rg --files <target-root> -g 'AGENTS.md' -g 'CLAUDE.md' -g 'GEMINI.md' -g 'agents.d/**' -g '.agents/agent-seed.json'
```

Read existing files before editing them. A full refresh preserves confirmed knowledge, custom organization, and unrelated platform instructions.

### 3. Scan Repository Evidence

Use `rg --files <target-root>` first. Inspect top-level and second-level structure, then read only relevant evidence such as project docs, package metadata, build/runtime configuration, CI, automation scripts, tests, linters, and agent configuration. Skip generated and dependency directories.

Run a framework fingerprint pass. Treat repository evidence as confirmed, common-framework knowledge as a scan aid, and unfamiliar/private framework assumptions as questions rather than facts.

### 4. Present Evidence Gaps

Before writing, present a compact summary under:

```text
Confirmed
Inferred
Missing
Knowledge to distill
Questions
```

Never promote inferred commands or framework behavior into confirmed instructions.

### 5. Interview In Rounds

Ask 3–8 targeted questions per round, preferring fewer when evidence is strong. Prioritize executable knowledge:

- exact setup, run, build, test, lint, and debug commands;
- required inputs and expected success signals;
- common failure symptoms and owner-approved recovery;
- architecture boundaries and representative change paths;
- safe autonomous actions, ask-first actions, and hard stops;
- verification evidence and human review handoff;
- repeated workflows that deserve a project-specific skill;
- optional tools or external plugins worth recommending.

Continue only while new answers expose important missing operational knowledge.

### 6. Write Project Guidance

Keep `AGENTS.md` portable and concise. Put detailed bootstrap, tooling, development loops, architecture, debugging, change recipes, review handoff, and risk guidance in focused `agents.d/` files. Do not create `agents.d/` merely as a completion marker.

Generate platform-specific bridges only for platforms the owner uses. When repeated workflows merit a project-specific skill, create or propose it without turning project-specific preferences into universal rules.

Apply the resolved write mode to knowledge assets:

- `full-access`: write the confirmed distillation scope directly.
- `agent-approve`: write within the confirmed scope; ask before conflicts, deletes, broad rewrites, or scope expansion.
- `ask-each-change`: ask before each file creation or edit.

### 7. Validate And Review

Perform the fresh-agent dry run across bootstrap, tool selection, run/build/test, debug, one representative change path where applicable, and review handoff. Fix unclear success signals, unsupported commands, duplicated guidance, missing escalation rules, and overly long entry files.

After validation succeeds, write:

```json
{
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "<ISO-8601 timestamp>",
    "agent_seed_version": "<installed Agent Seed version when available>"
  }
}
```

Preserve all unrelated `.agents/agent-seed.json` fields.

## Finish

Report files created or updated, unresolved context, validation performed, platforms covered, optional tooling recommendations, and whether a project-specific skill was created, proposed, or unnecessary.
