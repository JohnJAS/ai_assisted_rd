# Nuwa Framework Knowledge

Use this built-in knowledge pack when repository evidence, owner input, or project-local framework knowledge suggests a Nuwa-style framework. Public information may be incomplete, so every item in this file starts as `Preset` and must not be written as a target-project fact until repository evidence or the owner confirms it.

## Source Rules

- Label this file's guidance as `Preset`.
- Label exact files, commands, dependencies, manifests, generated directories, or annotations found in the target project as `Repo-confirmed`.
- Label framework semantics, safe generator usage, edit boundaries, and recovery steps explained by the owner as `Owner-confirmed`.
- Label naming-pattern guesses as `Inferred`.
- Keep unresolved framework behavior under `Unknown` or `Missing Context`.

## Fingerprint Search

Search inside the target project root only. Combine owner-provided names with these terms:

```bash
rg -n -i "nuwa|nuw|huawei|huaweicloud|generator|generated|schema|dsl|lifecycle|route|router|page|component|service" <target-project-root>
rg --files <target-project-root> | rg -i "nuwa|nuw|schema|generated|generator|routes?|routers?|pages?|components?|services?"
```

Do not inspect installed SDKs, personal/global skill directories, plugin caches, or external framework source trees unless the user explicitly asks.

## Evidence To Inspect

- Package and build metadata such as `package.json`, Gradle/Maven files, lockfiles, and custom CLI wrappers.
- App, module, route, page, service, schema, DSL, generator, or plugin manifests.
- Entry modules, lifecycle hooks, decorators, annotations, dependency injection setup, bridge/native integration, and resource folders.
- Generated directories and files that should not be edited by hand.
- Scripts for scaffold, generate, update, preview, simulator/device runs, build variants, validation, lint, and clean.
- Debug surfaces such as logs, generated artifacts, devtools, simulator or device output, build caches, and repeated framework error messages.

## Owner Questions

Ask only questions that repository evidence and project-local framework knowledge cannot answer:

- What is Nuwa responsible for in this repo: UI, routing, code generation, build packaging, runtime services, device integration, backend integration, or another layer?
- Which files are Nuwa-owned or generated, and which files should agents edit by hand?
- What commands are the confirmed golden path for install, generate, run or preview, build, test, lint, and clean?
- What output, artifact, device state, port, log line, or test result proves the Nuwa workflow is healthy?
- Which Nuwa errors are common, and what recovery steps are approved?
- Which conventions are easy for agents to miss: naming, folder placement, lifecycle order, registration files, generated artifacts, or files that must change together?
- Are vendor tools, VPN/internal registries, SDK versions, IDE plugins, devices, simulators, or credentials required?
- May agents run Nuwa generators autonomously, ask first, or never run them?

## Distillation Targets

- `agents.d/bootstrap.md`: SDKs, internal registries, vendor tools, devices, simulators, environment variables, and setup blockers.
- `agents.d/tooling.md`: Nuwa CLIs, generators, validators, safety levels, inputs, outputs, and failure recovery.
- `agents.d/architecture-map.md`: Nuwa entry points, module boundaries, generated-code boundaries, lifecycle flow, routing, and files that change together.
- `agents.d/change-recipes.md`: Adding or changing pages, components, services, modules, schemas, routes, generated artifacts, or platform bridges.
- `agents.d/debug-playbook.md`: Nuwa symptoms, logs, caches, diagnostics, and owner-approved recovery.
- `agents.d/risk-areas.md`: Generated files, compatibility constraints, SDK or device requirements, release packaging, internal APIs, and escalation triggers.

## Do Not Guess

- Do not assume Nuwa is ArkUI, HarmonyOS, OpenHarmony, or a generic web framework.
- If repository evidence points only to HarmonyOS, OpenHarmony, ArkUI, ArkTS, or DevEco tooling, use the HarmonyOS framework knowledge pack instead of this Nuwa pack.
- Do not write framework-specific commands as facts unless they appear in repository files or the owner confirms them.
- Do not treat preset generated-file boundaries as confirmed. Ask the owner or cite repo evidence.
- Do not turn temporary troubleshooting notes, secrets, personal paths, internal account names, or one-off incident chatter into reusable runbook content.

