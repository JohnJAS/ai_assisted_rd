# Framework Fingerprints

Use this reference when a project appears to use an uncommon, private, vendor, or internally named framework, or when the owner names a framework the model may not know reliably.

Do not pretend to know private framework behavior. Treat repository evidence as confirmed, model memory as tentative, and owner answers as the source of truth for framework-specific workflows.

## Framework Knowledge Registry

When `skill/framework-knowledge.json` exists, use it as the built-in framework knowledge registry. Read only matching entries. Match entries by owner-mentioned names, aliases, fingerprint terms, file patterns, dependencies, manifests, generated directories, or project-local framework knowledge.

For each matching entry:

- Load `knowledge_path` from the skill only when the framework is relevant.
- Search only inside the target project root.
- Check the entry's `project_local.registry_paths` and `project_local.knowledge_paths` inside the target root.
- Treat built-in and project-local guidance as `Preset` until repository evidence or the owner confirms a target-project fact.
- If project-local knowledge conflicts with repository evidence or owner answers, ask which source wins.

Project-local knowledge can supplement or override built-in presets only after the conflict is made explicit. It still needs a source label and cannot turn a command, generated-file boundary, or lifecycle rule into a confirmed project fact by itself.

## Fingerprint Pass

Search for framework evidence before asking detailed questions:

```bash
rg -n -i "<framework>|<alias>|<vendor>|plugin|generator|lifecycle|route|router|manifest|schema|dsl|annotation|decorator|bootstrap|entry|module|page|component|service|ability|hvigor|arkui|arkts|oh-package|build-profile" <target-project-root>
rg --files <target-project-root> | rg -i "<framework>|<alias>|manifest|schema|routes?|pages?|components?|modules?|services?|abilities?|generated|gen|build|config|plugin|dsl"
```

Replace `<framework>`, `<alias>`, and `<vendor>` with the owner-provided name, matching registry aliases, project-local framework knowledge terms, and likely spellings. For Nuwa, prefer the aliases and fingerprint terms from `framework-knowledge.json` and load `references/frameworks/nuwa.md` only when relevant.

Stay inside `<target-project-root>` unless the user explicitly asks to inspect an external SDK, installed framework, personal/global skill directory, or plugin cache.

Inspect, when present:

- Package and build metadata: `package.json`, `oh-package.json5`, `build-profile.json5`, `hvigorfile.*`, Gradle/Maven files, custom CLI wrappers, lockfiles, and internal package scopes.
- Framework manifests: app, module, page, route, ability, service, schema, DSL, generator, or plugin config files.
- Source conventions: entry modules, generated code boundaries, lifecycle hooks, decorators/annotations, route registration, state/store setup, dependency injection, bridge/native integration, and resource folders.
- Tooling scripts: scaffold/generate/update commands, codegen outputs, build variants, local preview/dev server commands, simulator/device commands, and validation commands.
- Debug surfaces: logs, generated artifacts, devtools, simulator/device output, build cache directories, and common framework error messages.

## Classification Rules

- `Repo-confirmed`: Exact files, commands, dependencies, annotations, generators, or manifests found in the repo.
- `Preset`: Built-in or project-local framework knowledge used as scan guidance or interview prompts.
- `Inferred`: A framework candidate suggested by naming patterns or dependencies, but not enough evidence to describe behavior.
- `Owner-confirmed`: Framework semantics, required tools, generator safety, or recovery steps explained by the project owner.
- `Unknown`: Anything not proven by repo evidence or owner answers.

Do not write framework-specific commands as confirmed unless they are found in project files or the owner confirms them.

## Owner Questions

Ask only the questions that repository evidence cannot answer:

- What is this framework responsible for in this repo: UI, routing, code generation, build packaging, runtime services, device integration, or backend integration?
- Which files are framework-owned or generated, and which files should agents edit by hand?
- What commands are the golden path for install, generate, run/preview, build, test, lint, and clean?
- What success signal proves the framework build or preview is healthy?
- What common framework errors should an agent recognize, and what recovery steps are approved?
- Which framework conventions are non-obvious: naming, folder placement, lifecycle order, registration files, generated artifacts, or files that must change together?
- Are there vendor tools, VPN/internal registries, SDK versions, IDE plugins, devices, simulators, or credentials that agents must have or must ask about?
- May agents run framework generators autonomously, ask first, or never run them?

## Distillation Targets

Place framework knowledge where future agents will look:

- `agents.d/bootstrap.md`: SDKs, internal registries, vendor tools, environment variables, devices/simulators, and setup blockers.
- `agents.d/tooling.md`: Framework CLIs, generators, validators, package managers, internal tools, safety levels, and success signals.
- `agents.d/architecture-map.md`: Framework entry points, module boundaries, generated-code boundaries, lifecycle flow, routing, and files that change together.
- `agents.d/change-recipes.md`: Common edits such as adding a page/component/service/module, updating a route, changing generated schemas, or bridging platform APIs.
- `agents.d/debug-playbook.md`: Framework-specific symptoms, logs, caches, diagnostics, and owner-approved recovery.
- `agents.d/risk-areas.md`: Generated files, compatibility constraints, SDK/device requirements, release packaging, internal APIs, and places where agents must stop.

## Preset-Supported Framework Handling

Public information about private, vendor, internally named, or preset-supported frameworks may be incomplete or unavailable. When a matching registry entry is relevant:

- Treat the framework as private/vendor-specific until repository files or the owner prove otherwise.
- Use registry aliases and the matching knowledge pack for targeted scans, not for confirmed facts.
- Capture the owner's explanation of the framework's role, generated files, command flow, and edit boundaries before writing onboarding instructions.
- Record unresolved framework semantics under `Missing Context` rather than filling gaps from guesswork.

