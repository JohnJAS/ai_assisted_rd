# Project Knowledge Assets

Use this reference when generating or refreshing project-local guidance. Keep the entry point small and disclose detail progressively.

## Asset Selection

- Always create or update `AGENTS.md` unless the owner requested another file only.
- Create `agents.d/` files only when detailed reusable knowledge needs them.
- Create `CLAUDE.md` or another platform bridge only for platforms the owner uses.
- Create a project-specific skill only when a repeated workflow benefits from automatic discovery, reusable resources, or deterministic scripts.
- Return optional plugin or tool recommendations; do not install them from Project Distiller.

## AGENTS.md

`AGENTS.md` is the concise portable entry point. Prefer short rules and links over copied detail.

Useful sections include only those supported by evidence:

```markdown
# Project Agent Guide

## Project Snapshot
## Read First
## Bootstrap
## Canonical Commands
## Repository Map
## Development Rules
## Testing And Verification
## Approved Tools
## agents.d Index
## Human Review Handoff
## Risk Boundaries
## Missing Context
```

For every canonical command, include its working directory, prerequisites, success signal, and safe failure response when those are non-obvious.

Keep cross-cutting invariants and routing in `AGENTS.md`; move walkthroughs, recipes, and playbooks into `agents.d/`.

## agents.d

Use focused files rather than a single large handbook:

| File | Durable content |
| --- | --- |
| `bootstrap.md` | prerequisites, environment setup, first successful run |
| `tooling.md` | approved scripts, skills, CLIs, generators, selection rules |
| `development-loop.md` | run, build, lint, test, and iteration loop |
| `architecture-map.md` | boundaries, entry points, ownership, data flow |
| `debug-playbook.md` | symptoms, evidence, recovery, escalation |
| `change-recipes.md` | repeated change paths and required verification |
| `review-handoff.md` | evidence, review checkpoints, done criteria |
| `risk-areas.md` | hazards, invariants, ask-first and human-only actions |

Create only files with meaningful project-specific content, then link them from `AGENTS.md`.

## Source-Aware Instructions

Use provenance labels where confidence or ownership matters:

```markdown
- Run `npm test` before handoff. Success is a zero exit code with no failed suites. `[Repo-confirmed]`
- Ask before regenerating production schemas. `[Owner-confirmed] [Risk judgment]`
```

Do not label every sentence mechanically. Labels are most useful for owner preferences, risk judgments, framework presets, and commands that were not executed.

## Platform Bridges

Avoid duplicating full guidance across platforms.

- Codex and OpenCode should read the canonical `AGENTS.md` directly where supported.
- For Claude Code and compatible hosts, prefer a minimal root `CLAUDE.md` containing `@AGENTS.md` plus only truly platform-specific notes.
- Preserve existing platform configuration and imports.

## Project-Specific Skills

A repeated workflow is a good skill candidate when future agents need one or more of:

- a precise trigger and bounded workflow;
- deterministic scripts that should not be rewritten each time;
- substantial references loaded only for that workflow;
- templates or assets copied into results.

Keep the skill self-contained and project-scoped. Its description should distinguish it from generic coding tasks. Do not create placeholder directories or duplicate guidance already maintained in `AGENTS.md`.

When the relevant platform provides a skill initializer or validator, use it. Otherwise create the minimal required `SKILL.md` and only the resources with concrete value.

## Tool Recommendations

Record optional tools separately from approved tools:

```markdown
### Recommended, not installed

- `<tool>` — use when `<confirmed trigger>`; expected benefit: `<benefit>`;
  proposed verification: `<safe smoke check>`.
```

Do not imply that a recommendation is installed, authorized, or required for project onboarding.

## Refresh Rules

For an existing asset set:

- preserve confirmed knowledge and custom organization;
- update the smallest coherent section;
- resolve equivalent wording as duplication, not conflict;
- ask before choosing between contradictory owner-approved rules;
- remove obsolete content only when evidence or the owner confirms it;
- never replace detailed guidance with a generic template.

## Completion State

The existence of `agents.d/` is not a completion signal. Mark distillation complete only when:

- the evidence scan and required owner interview are complete;
- written assets match the resolved scope and write mode;
- commands are sourced and carry usable success signals;
- unresolved context is visible rather than guessed;
- the fresh-agent dry run and self-review pass.

Preserve unrelated fields when updating `.agents/agent-seed.json`.

## Quality Check

Reject output containing:

- generic advice that could apply to any repository;
- inferred commands presented as confirmed facts;
- setup or verification steps without success signals;
- debugging symptoms without a next action;
- unclear authority boundaries;
- duplicated or contradictory guidance;
- raw interview transcript;
- placeholders such as `TODO` or `TBD` unless they represent explicit missing context.
