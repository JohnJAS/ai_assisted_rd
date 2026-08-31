# HarmonyOS Framework Knowledge

Use this built-in knowledge pack when repository evidence, owner input, or project-local framework knowledge suggests a HarmonyOS, OpenHarmony, ArkUI, ArkTS, DevEco Studio, or DevEco CLI project. Every item in this file starts as `Preset` and must not be written as a target-project fact until repository evidence or the owner confirms it.

## Source Rules

- Label this file's guidance as `Preset`.
- Label exact files, commands, dependencies, manifests, generated directories, or annotations found in the target project as `Repo-confirmed`.
- Label project workflow, safe tool usage, edit boundaries, and recovery steps explained by the owner as `Owner-confirmed`.
- Label naming-pattern guesses as `Inferred`.
- Keep unresolved platform or toolchain behavior under `Unknown` or `Missing Context`.

## Fingerprint Search

Search inside the target project root only. Combine owner-provided names with these terms:

```bash
rg -n -i "harmonyos|openharmony|harmony|arkui|arkts|devecocli|deveco-toolbox|deveco-mcp-server|DevEco CLI|DevEco Studio|@deveco/deveco-cli|@deveco-codegenie/mcp|oh-package|build-profile|hvigor|ohpm|hdc|hilog|emulator|ability|module\.json5|app\.json5" <target-project-root>
rg --files <target-project-root> | rg -i "devecocli|deveco-toolbox|deveco-mcp-server|deveco|oh-package\.json5|build-profile\.json5|hvigorfile|module\.json5|app\.json5|abilities?"
```

Do not inspect installed SDKs, personal/global skill directories, plugin caches, or external framework source trees unless the user explicitly asks.

## Evidence To Inspect

- HarmonyOS manifests and build metadata such as `oh-package.json5`, `build-profile.json5`, `hvigorfile.*`, `module.json5`, `app.json5`, package files, lockfiles, and custom CLI wrappers.
- App, module, ability, page, component, route, service, resource, native bridge, or plugin manifests.
- Entry modules, lifecycle hooks, decorators, annotations, dependency injection setup, ArkTS and ArkUI conventions, and resource folders.
- Generated directories and files that should not be edited by hand.
- Scripts for install, build, package, run, device/emulator management, log inspection, syntax checks, validation, lint, and clean.
- Debug surfaces such as `.hap`, `.hsp`, `.har`, `.app` artifacts, device state, emulator state, `hilog` output, build caches, and repeated framework error messages.

## DevEco CLI Tooling Preset

Use this section as `Preset` guidance when a project appears to be HarmonyOS/OpenHarmony/ArkUI/ArkTS-related or owner input names DevEco tooling. Do not write these commands as project facts until the repository or owner confirms them.

DevEco CLI is a HarmonyOS application development CLI that wraps DevEco Studio tooling and integrates `ohpm`, `hvigor`, `hdc`, `emulator`, `hilog`, project scaffolding, local HarmonyOS docs, skill installation, and an MCP server. Known prerequisites from the public documentation are macOS or Windows, Node.js >= 18 with 22+ recommended, and DevEco Studio >= 6.1.0. The package install command is:

```bash
npm install -g @deveco/deveco-cli@latest
```

Apply the resolved Agent Seed mode after DevEco CLI applicability is established. In `full-access`, install the applicable CLI and perform manifest-declared agent or MCP initialization without separate approval. In `ask-each-change` and `agent-approve`, require approval for the same install and declared side effects. Tool updates, device or emulator runs, log tailing, project creation, and other standalone environment actions still require owner approval.

Useful commands to capture or ask about:

- `devecocli update`: update the CLI.
- `devecocli create --app-name MyApp`: create a HarmonyOS project.
- `devecocli build`: build and produce `.hap`, `.hsp`, `.har`, or `.app` artifacts.
- `devecocli run`: build, install, and run on a connected device or emulator.
- `devecocli device list`: list connected devices.
- `devecocli emulator list`: list local emulator instances.
- `devecocli log --level E`: inspect error-level `hilog` output; also capture owner-approved filters such as bundle name, keyword, follow, and tail windows.
- `devecocli docs search <query>` and `devecocli docs read <path>`: prefer local HarmonyOS documentation lookup before guessing ArkTS, ArkUI, lifecycle, ability, or build behavior.
- `devecocli init --agent <agent>`: install DevEco CLI skills for an agent platform.
- `devecocli init --mcp --agent <agent> --project <path>`: configure the local MCP integration for a project.
- `devecocli serve mcp`: start the local MCP server so an agent can call ArkTS or C++ syntax checks through MCP.
- `devecocli skills list`, `devecocli skills find <keyword>`, and `devecocli skills add ...`: inspect or install HarmonyOS skills.

Prefer generated MCP configuration from `devecocli init --mcp` over hand-written JSON. If a project has hand-written MCP configuration, verify spelling and paths with the owner before relying on it.

## DevEco Toolbox Legacy Preset

Use this section as `Preset` guidance only when repository evidence or owner input explicitly mentions DevEco Toolbox, `deveco-toolbox`, `deveco-mcp-server`, or `@deveco-codegenie/mcp`. Do not recommend DevEco Toolbox by default for new HarmonyOS projects. If DevEco Toolbox is already installed or configured and DevEco CLI is not available, recommend DevEco CLI as the official successor tooling after explaining that existing Toolbox/MCP workflows should be preserved unless the owner approves migration.

The open-source DevEco Toolbox project is archived and its README says official DevEco CLI covers most of its capabilities after HDC 2026. Treat it as legacy or fallback MCP tooling for existing project configurations, not as the primary install path.

Known legacy install and MCP command examples:

```bash
npm install -g @deveco-codegenie/mcp@beta
deveco-mcp-server --stdio --harmonySdkPath <HarmonyOS-SDK-path> --nodePath <node-path>
```

Common configuration evidence may include `deveco-mcp-server`, `@deveco-codegenie/mcp`, `DEVECO_PATH`, `HARMONY_SDK_HOME`, or `COMMANDLINE_TOOL_DIR`.

Apply the resolved mode to an explicitly selected legacy install. In `full-access`, the install itself may run without a separate prompt; in the approval-gated modes, disclose its network and global writes and ask first. Updates, standalone MCP configuration, SDK path discovery outside the target root, and server startup retain their own approval boundaries. Prefer DevEco CLI and `devecocli init --mcp` for fresh setup unless the owner confirms an existing DevEco Toolbox workflow must be preserved.

## Owner Questions

Ask only questions that repository evidence and project-local framework knowledge cannot answer:

- Which HarmonyOS/OpenHarmony version, SDK, DevEco Studio version, Node.js version, and device or emulator target are approved?
- Which files are generated or tool-owned, and which files should agents edit by hand?
- What commands are the confirmed golden path for install, build, package, run, test, lint, log inspection, and clean?
- Which `devecocli` commands beyond the mode-authorized install and declared initialization may agents run autonomously versus `ask first`?
- Should agents use `devecocli docs search` / `devecocli docs read` and `devecocli serve mcp` as the preferred HarmonyOS documentation and syntax-check surfaces?
- Is there existing DevEco Toolbox or `@deveco-codegenie/mcp` configuration that must be preserved instead of migrating to DevEco CLI MCP setup?
- What output, artifact, device state, log line, or test result proves the workflow is healthy?
- Which errors are common, and what recovery steps are approved?
- Which conventions are easy for agents to miss: ability registration, module metadata, ArkTS syntax, resource placement, lifecycle order, generated artifacts, or files that must change together?

## Distillation Targets

- `agents.d/bootstrap.md`: SDKs, DevEco Studio, Node.js, DevEco CLI, internal registries, devices, emulators, environment variables, and setup blockers.
- `agents.d/tooling.md`: DevEco CLI, ohpm, hvigor, hdc, hilog, MCP, validators, safety levels, inputs, outputs, and failure recovery.
- `agents.d/architecture-map.md`: app and module boundaries, ability entry points, lifecycle flow, routing, resources, native bridges, and files that change together.
- `agents.d/change-recipes.md`: Adding or changing abilities, pages, components, services, modules, resources, ArkTS code, generated artifacts, or platform bridges.
- `agents.d/debug-playbook.md`: build symptoms, device/emulator symptoms, hilog capture, caches, diagnostics, and owner-approved recovery.
- `agents.d/risk-areas.md`: generated files, compatibility constraints, SDK or device requirements, release packaging, permissions, signing, internal APIs, and escalation triggers.

## Do Not Guess

- Do not assume a HarmonyOS/ArkTS project uses Nuwa unless repository evidence or the owner confirms Nuwa.
- Do not write framework-specific commands as facts unless they appear in repository files or the owner confirms them.
- Apply the resolved mode to installs and manifest-declared initialization. Do not run updates, devices or emulators, tail logs, create projects, or perform standalone environment changes without owner approval.
- Do not treat preset generated-file boundaries as confirmed. Ask the owner or cite repo evidence.
- Do not turn temporary troubleshooting notes, secrets, personal paths, internal account names, or one-off incident chatter into reusable runbook content.

