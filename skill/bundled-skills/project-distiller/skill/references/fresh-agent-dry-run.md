# Fresh-Agent Dry Run

Use this reference before claiming generated or updated onboarding assets are ready for agents.

## Goal

Simulate how a fresh agent would proceed using only the repository, `AGENTS.md`, `agents.d/`, platform files, and any project-specific skill.

The dry run is a reasoning and file-inspection pass unless the resolved mode authorizes the relevant commands in the current environment. Build, test, migration, deployment, and service commands retain their own safety boundaries.

## Dry-Run Slices

Run the slices relevant to the change:

- **Bootstrap**: Can a fresh agent install prerequisites, configure required files, start local services, and reach a known-ready signal?
- **Tool selection**: Can it choose approved skills, recommended external plugins, bundled packages, platform skills, scripts, CLIs, generators, or validators without improvising?
- **External plugin recommendation**: Can it resolve the mode, detect whether a recommended plugin is already available, use the platform-native network-backed install action, install and verify in `full-access`, ask in the approval-gated modes, and avoid treating the plugin as a vendored bundled asset?
- **Bundled direct skill installation**: Can it resolve the mode, discover required direct skills from `bundled-skills.json`, select only explicitly used or repository-detected platforms, apply source and overlays with declared side effects, handle existing targets, and verify availability?
- **Bundled package installation**: Can it resolve the mode, discover required packages and nested platform skills, read version pins and declared writes from `bundled-packages.json`, follow the installer under the selected mode, and verify availability?
- **Development loop**: Can it run, build, test, lint, and format with expected success signals?
- **Debugging**: For common failures, does it know which logs or commands to inspect and what recovery step is allowed?
- **Change recipe**: For a representative task, does it know likely files, boundaries, coupled edits, and required checks?
- **Risk and escalation**: Does it know when to stop for human input?
- **Human review handoff**: Does it know what evidence to report before review?

For an incremental update, run only the slice affected by the new knowledge, plus any linked handoff or risk checks.

## Checklist

Ask these questions as the fresh agent:

- What is the first file to read?
- What exact command or action comes next?
- What working directory and inputs are required?
- What output proves success?
- If a bundled direct skill is required, where is its source path, which platform target paths apply, what repository evidence or owner answer selected each platform, how are overlays applied, and how is installation verified?
- If a bundled package or platform skill is required, where is the package located, what version is pinned, which nested platform skill applies, and how is it installed or referenced?
- If an external plugin is recommended, what detection evidence shows it is missing, which platform-native install action applies, what network or config writes are expected, and how is installation verified?
- Does the resolved mode require autonomous installation or an approval prompt?
- A `full-access` install or verification failure must block onboarding and report an exact recovery step; does this path do so?
- Is each hook or privileged write a declared install side effect or a standalone action?
- If the command fails with a known symptom, what is the next diagnostic step?
- Is the action autonomous, ask-first, or forbidden?
- What context must be reported to the human reviewer?
- What unknowns remain, and where are they recorded?

If any answer is "ask someone who knows" without an escalation rule, mark it as a remaining breakpoint.

## Automation-Ready Standard

Do not claim the project is automation-ready unless:

- Confirmed setup, run, build, and test paths have success signals.
- Known blockers have owner-approved recovery or escalation.
- Required secrets, services, accounts, VPNs, paid systems, or production access are documented as requirements without exposing sensitive values.
- Approved tools and scripts have triggers, inputs, outputs, failure recovery, and safety levels.
- Recommended external plugins have detection evidence, platform-native install actions, network and mode-aware approval requirements, verification steps, declared side effects, failure behavior, and an explicit note that they are not vendored.
- Bundled direct skills have source paths, selected platform targets, trigger conditions, copy behavior, overlay rules, existing-target conflict handling, verification steps, default-offer rules, declared side effects, and mode-aware approval rules.
- Bundled packages and nested platform skills have version pins, package paths, platform source paths, trigger conditions, install targets, written-file lists, verification steps, default-offer rules, declared side effects, and mode-aware approval rules.
- The dry run covers already-installed, successful autonomous `full-access`, failure-blocking, interactive/manual, approval, decline/re-prompt, conditionally inapplicable, and workflow-specific browser-extension prerequisite paths.
- Risk areas and forbidden actions are explicit.
- Human review handoff says what evidence the agent must provide.

If a command could not be run, say that the assets document the confirmed command but current-environment execution was not verified.

## Self-Review

Before finishing, scan for:

- Inference written as fact.
- Commands without evidence or owner confirmation.
- Missing success signals.
- Generic advice not specific to the repository.
- Missing source labels where they affect trust.
- Duplicate or contradictory rules.
- Platform-specific content in portable `AGENTS.md`.
- `CLAUDE.md` longer than 120 lines without imports.
- Project skill duplicating detailed `AGENTS.md` or `agents.d/` content instead of routing to it.
- Recommended external plugins written into `bundled-skills.json`, `bundled-packages.json`, or project-local skill folders without an explicit owner request to vendor them.
- Bundled direct skills without source paths, selected platform targets, copy/overlay instructions, existing-target conflict handling, verification, or detected/requested platform gating.
- Bundled packages or nested platform skills without version pins, install/verification instructions, written-file disclosure, or with duplicated guidance that should stay in `AGENTS.md` or `agents.d/`.
- Secrets, private identifiers, personal paths, or one-off incident chatter.
- Placeholder text such as `TODO`, `TBD`, or vague filler.

Fix issues or record unresolved context before finalizing.

