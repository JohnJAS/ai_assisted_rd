# Agent Seed

本仓库是 `agent-seed` Codex skill 的源码和发布工具。

`agent-seed` 会把仓库证据和项目负责人的经验蒸馏成可执行的 Agent 运行手册、评审检查点和项目级指导，让 Agent 能在明确的安全边界内工作，也让人只需要处理审批和必须由项目负责人决定的问题。

语言： [English](README.md) | [简体中文](README.zh-CN.md)

## 快速入门

在要交给 Agent 使用的项目目录中安装发布版 `agent-seed` skill，然后在该项目中调用 `/agent-seed`。可以从 [GitHub Releases](https://github.com/InnovationTea/agent-seed/releases) 下载 `agent-seed.zip`，再使用当前 Agent 平台提供的标准 skill 安装流程；解压后的 skill 根目录必须直接包含 `SKILL.md`。如果当前目录是 Agent Seed 源码仓库，请把目标项目路径传给 skill，不要把 Agent Seed 自身当成待蒸馏项目。

### 初次使用流程

1. Agent Seed 先解析 `knowledge_asset_write_mode`，检查已安装的 Agent Seed 版本，并读取 bundled skills、bundled packages 和 external plugins 的清单。
2. 它根据目标项目或当前运行环境识别 Agent 平台，在知识蒸馏前安装并验证适用的默认集成。`full-access` 会自动执行；`agent-approve` 和 `ask-each-change` 会按权限策略请求批准。
3. 它检查 `.agents/agent-seed.json` 和 `AGENTS.md`。如果蒸馏状态缺失、无效、仍在进行或失败，或者 `AGENTS.md` 不存在，就进入首次知识蒸馏：扫描项目、访谈负责人、生成 `AGENTS.md`，并按需生成 `agents.d/` 下的详细手册。扫描、资产写入、新 Agent 演练和自检都成功后，才记录完成状态。
4. 之后按正常方式开发。每个任务完成并验证通过后，在最终回复前运行项目级 `knowledge-updater`，只保存当前对话中新增且可复用的项目知识。

首次使用前不需要创建 `agents.d/`。只有在确实需要拆出详细知识时，`knowledge-updater` 才会按需创建它。首次蒸馏是否完成由有效的 `knowledge_distillation` 状态和 `AGENTS.md` 共同判断，而不是由目录是否存在判断。

## 权限模式

权限可以写入项目共享配置 `.agents/agent-seed.json`，也可以在当前请求中临时指定。优先级是：当前请求、共享配置。若首次初始化时两者都没有设置，Agent Seed 必须先让负责人选择模式，并推荐 `full-access`；选择后写入共享配置，后续子 skill 和安装器只读取这个结果，不各自重复询问。

| 模式 | 行为 |
| --- | --- |
| `full-access` | 适用的默认 skill、package 和 plugin 会自动安装并验证，清单声明的网络访问、项目指令编辑和其他安装副作用也在授权范围内；个人或全局 managed target 仍需负责人明确请求。密钥、生产操作、破坏性操作、独立 hook 和未解决的冲突仍必须单独批准。 |
| `agent-approve` | 在已经确认的蒸馏或更新范围内可以写入项目知识，但安装、安装时网络访问、hook、个人或全局写入、较大范围重写、冲突和范围外修改都要先批准。 |
| `ask-each-change` | 每次创建或修改知识文件、每次安装都要询问；安装时网络访问及个人或全局写入同样要批准。 |

示例：

```json
{
  "schema_version": 2,
  "minimum_agent_seed_version": "v0.3.8",
  "knowledge_asset_write_mode": "full-access"
}
```

## Skill、Package 和 Plugin 安装

安装决策以以下清单为准：

- `skill/bundled-skills.json`：可复制到项目平台目录的直接 skill。
- `skill/bundled-packages.json`：带安装器或多个平台 skill 的项目级 package。
- `skill/external-packages.json`：由平台自己管理、通过网络安装的外部 plugin。

Agent Seed 只为负责人使用或项目证据识别出的平台安装文件，不会把其他平台的目录无条件复制进项目。

### Bundled skills

- `agent-seed-updater`：每个新对话开始时运行一次，只检查 Agent Seed 自更新和已管理 skill，不做知识蒸馏或仓库扫描。
- `knowledge-updater`：每个任务完成并验证后运行一次，维护 `AGENTS.md` 和 `agents.d/`。
- `gitpush`、`gitsync`、`gittag`：在对应 Git 工作流需要时使用。
- `ticket-lookup`：在项目已配置需求管理站点并且需要读取 SR/AR 时使用，它依赖 OpenCLI。

这些直接 skill 默认安装到项目级平台目录，例如 Codex 的 `skills/<name>/`、Claude 的 `.claude/skills/<name>/`、codeagent-cli 的 `.cac/skills/<name>/` 或 OpenCode 的 `.opencode/skills/<name>/`。已有目标目录需要先决定是否替换；个人或全局目录只有在明确请求时才安装。

### Managed skill updates / 已管理 skill 同步

根级 `activation_policy.managed_target_policy` 定义替换边界。`full-access`
会在适用性确认后执行 automatic managed synchronization，自动安装、更新和
修复 bundled skills 与 packages：

```sh
node scripts/manage-managed-skills.mjs apply <target-project> --all --platform <platform> --approved --json
```

批量操作会重新检查状态，保留 exact-version decline，跳过
`current`、`declined-current-version` 和 `baseline-unavailable`。每个条目独立
备份和 rollback；某个条目 failed 后恢复其内容并 continue with later entries。
`ask-each-change` 和 `agent-approve` 保留 approval-gated per-entry 流程，先逐条
批准再使用 `--name <managed-name>`。`post_install` 动作完成后会再次运行 preflight。
External integrations 仍由平台维护，Agent Seed 只报告状态，不复制、删除或替换；
它们保持 platform-native ownership。更高的 manifest 版本会重新触发提示，精确版本
拒绝不会被 full-access 绕过。

### Bundled package

当前 bundled package 是 `git-code-tracker`。在安装版 Agent Seed 根目录执行：

```sh
node scripts/install-git-code-tracker.mjs <target-project> [--platform <platform>]
```

它会按平台复制 tracker skill 并运行其安装器，可能写入平台 skill、commands、`AGENTS.md`、`.ai-tracking/`、`.gitignore` 和 Git hooks。审批模式下请先确认这些清单声明的写入；`full-access` 只会在适用的平台门控通过后自动执行。

### External plugins

外部 plugin 不会被复制到项目，也不会被 Agent Seed 自己替换；它们通过当前 Agent 平台的标准网络安装流程维护。

- **Superpowers**：提供规划、TDD、调试、代码评审和分支收尾流程；适用时是 Agent Seed 推荐的开发工作流。
- **OpenCLI**：提供浏览器自动化和结构化网页提取，也是 `ticket-lookup` 的外部依赖。常见安装命令为 `npm install -g @jackwener/opencli`，然后执行 `npx skills add jackwener/opencli`。
- **DevEco CLI**：只有识别到 HarmonyOS/OpenHarmony/ArkUI/ArkTS 项目时才推荐；安装命令为 `npm install -g @deveco/deveco-cli@latest`。

`ask-each-change` 和 `agent-approve` 下每次适用的默认 plugin 缺失时都要请求批准；`full-access` 下才可以在无额外提示的情况下安装并验证适用默认项。浏览器扩展、密钥和生产环境操作不会被自动安装或执行。

## Lazy 知识蒸馏

安装 Agent Seed 后，首次对话不会因为 skill 存在就立即做完整仓库扫描，而是先读取轻量状态：

```json
{
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "2026-08-05T10:00:00.000Z",
    "agent_seed_version": "v0.3.8"
  }
}
```

判断规则如下：

- 状态缺失、格式无效、`in_progress` 或 `failed`：视为尚未完成，启动首次知识蒸馏。
- `complete` 且 `AGENTS.md` 存在：跳过自动蒸馏，直接进入用户任务。
- `complete` 但 `AGENTS.md` 缺失：仍然触发蒸馏，以修复入口文件。
- `agents.d/` 缺失不代表失败；需要详细资产时由 `knowledge-updater` 按需创建。

首次蒸馏开始时写入 `in_progress`，只有仓库扫描、负责人访谈、资产写入、fresh-agent 演练和自检全部成功后才写入 `complete`。

### 重新进行全量蒸馏和访谈

如果要重新检查整个项目、补充负责人访谈，直接在对话中明确请求，例如：

```text
重新进行全量知识蒸馏和访谈
```

也可以用英文请求 `run a full knowledge distillation and owner interview for this project`。显式请求会绕过 `complete` 标记，保留现有资产并执行完整刷新；刷新失败时状态保持为未完成，下一次可以继续重试。

## 增量知识维护

`knowledge-updater` 和首次知识蒸馏是两条不同的路径：

- 首次蒸馏负责扫描仓库、访谈负责人并建立基础资产。
- `knowledge-updater` 只读取当前对话中已经确认的持久事实，以及现有 `AGENTS.md` 和相关 `agents.d/` 文件。
- 它不扫描仓库、不重新访谈、不读取历史 transcript、不访问网络、不启动子 Agent，也不把 `knowledge_distillation` 标记为完成。
- 它只做最小一致编辑，并返回一个状态：`updated`、`no new reusable knowledge`、`not initialized`、`conflict` 或 `update failed`。

项目级启动规则应保证：任务完成且验证通过后，主 Agent 在最终回复前调用一次 `knowledge-updater`，并把返回状态附在最终结果中。

## 项目文件

| 文件或目录 | 用途 |
| --- | --- |
| `.agents/agent-seed.json` | 团队共享的最低版本、权限模式和知识蒸馏状态；应提交到 Git。 |
| `.agents/agent-seed.local.json` | 本机安装路径、代理和更新缓存；不应提交。 |
| `.agents/managed-skills.json` | 团队希望安装的 skill、package 和外部集成版本；应提交。 |
| `AGENTS.md` | Agent 进入项目时读取的简明入口和规则。 |
| `agents.d/` | 按主题拆分的 bootstrap、开发、调试、风险和评审手册；按需创建。 |
| `CLAUDE.md`、`.cac/`、`.opencode/` | 仅在对应平台被使用或明确请求时生成。 |

## 常用命令

维护本仓库时：

```sh
make check
make release
make release VERSION=v1.2.3
```

直接运行等价于：

```sh
node --test tools/release.test.mjs
node tools/release.mjs
node tools/release.mjs --version v1.2.3
```

发布包、目录结构、Agent Seed 自更新和完整清单说明请参阅 [英文 README](README.md) 的 Release Artifacts、Skill Self Update、Managed Skill Updates 和 Bundled Packages 章节。
