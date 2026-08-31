# Knowledge Distillation Guide

Use this reference during repository evidence collection and owner interviews. Distill operational knowledge into future-facing instructions rather than recording conversation text.

## Source Labels

Label durable knowledge when provenance affects confidence:

- `Repo-confirmed`: directly supported by files in the target repository.
- `Owner-confirmed`: explicitly supplied or approved by the knowledgeable owner.
- `Observed during run`: verified by a command or behavior in the current session.
- `Preset`: supplied by a matching framework knowledge pack and still awaiting project confirmation.
- `Inferred`: plausible from structure or naming but not safe to encode as fact.
- `Missing`: required operational knowledge not yet established.
- `Preference`: owner choice rather than a repository invariant.
- `Risk judgment`: owner-approved safety or escalation boundary.

Only the first four may become positive instructions without qualification. Keep `Inferred` and `Missing` visible as questions or missing context.

## Evidence Inventory

Build a compact inventory from relevant files:

| Area | Evidence to seek | Distilled outcome |
| --- | --- | --- |
| Purpose | README, product docs, owner description | project snapshot and goals |
| Bootstrap | package metadata, env examples, setup scripts | prerequisites, exact steps, success signal |
| Development | Makefile, scripts, task runners | canonical run/build/lint/test loop |
| Architecture | source roots, module boundaries, configs | entry points, ownership, data flow |
| Changes | repeated patterns, generators, tests | representative change recipes |
| Debugging | logs, diagnostics, known failures | symptom → evidence → recovery |
| Verification | CI, tests, review rules | required checks and proof |
| Safety | deploy scripts, credentials, destructive tools | autonomous, ask-first, prohibited actions |
| Tooling | project scripts, skills, CLIs | preferred tools and trigger conditions |

Do not read every file. Use the project goal and emerging gaps to select evidence.

## Owner Interview Map

Interview in short rounds. Cover only categories that repository evidence did not settle.

### Bootstrap And Environment

- What prerequisites are easy to miss?
- Which setup command is canonical, and what proves it succeeded?
- Which credentials, VPNs, devices, emulators, or services require human setup?

### Run, Build, Test, And Lint

- Which commands are safe for an agent to run locally?
- Which commands are slow, expensive, destructive, or production-affecting?
- What output or artifact is the success signal?
- Which failure is expected and what recovery is approved?

### Architecture And Change Paths

- Where does a new developer usually start reading?
- Which boundaries or invariants must not be crossed?
- For a representative feature or bug fix, which files change and which checks follow?
- Which generated files must be produced by a tool rather than edited manually?

### Debugging

- What symptoms recur?
- Which logs, commands, or state should be inspected first?
- What recovery sequence is safe?
- At what point should the agent stop and ask an owner?

### Review And Handoff

- What evidence must accompany a completed change?
- Which changes require a human review checkpoint before continuation?
- What is the project's practical definition of done?

### Tools And Reusable Workflows

- Which existing scripts, skills, or CLIs should agents prefer?
- Which repeated workflow deserves a project-specific skill?
- Which optional external tool would materially improve a confirmed workflow?

Tool recommendations are outputs of distillation, not authorization to install. Record the trigger, expected benefit, platform, and verification suggestion; let Agent Seed or the owner decide installation.

## Executable Knowledge Shape

Prefer entries with this structure:

```text
Trigger: when this guidance applies
Action: exact command, file, skill, or sequence
Inputs: required values or environment
Success: observable completion signal
Failure: symptom and safe next action
Authority: autonomous | ask first | human only
Source: Repo-confirmed | Owner-confirmed | Observed during run | Preference | Risk judgment
```

Not every instruction needs every label, but commands without success signals and recovery guidance are usually incomplete.

## Automation Breakpoints

Classify important actions explicitly:

- `Autonomous`: reversible, project-local, and owner-approved.
- `Ask first`: destructive, expensive, external, credentialed, ambiguous, or broad in scope.
- `Human only`: production approvals, private-account actions, irreversible business decisions, or unavailable physical access.

Document the breakpoint close to the relevant command or recipe. Avoid one generic safety paragraph that future agents cannot map to an action.

## Exclusions

Do not preserve secrets, raw transcripts, personal paths, private account identifiers, temporary debugging attempts, one-off task details, generic engineering advice, or unsupported framework assumptions. Convert useful broad context into concise rules, recipes, playbooks, or escalation triggers.

