# Agent Seed

本仓库包含 `agent-seed` skill 的源码、测试和发布工具。

Agent Seed 负责给已有项目安装和编排一组精简的项目级 Agent 能力。它本身是安装器，不再承担仓库扫描和负责人访谈；这些工作已经拆到独立的 `project-distiller` 子 skill。

## 组件分层

三个核心组件默认安装：

- `agent-seed-updater`：每个新对话开始时运行一次，只检查 Agent Seed 版本和项目级 managed components。
- `project-distiller`：执行首次或显式全量项目知识蒸馏、负责人访谈、`AGENTS.md`/`agents.d/` 生成和 fresh-agent 验证。
- `knowledge-updater`：每个任务完成后，仅使用当前对话中已经建立的持久知识做增量维护。

其余组件均为可选：

- `gitpush`、`gitsync`、`gittag`：特定 Git 工作流。
- `ticket-lookup`：通过 OpenCLI 读取已配置的 SR/AR。
- `git-code-tracker`：带 Git hooks 和跟踪状态的 bundled package。
- Superpowers、OpenCLI、DevEco CLI 等仍由各平台原生管理，只作为按场景推荐项。

可选组件不会因为检测到了平台就自动安装。必须由负责人明确请求，或者项目中已经确认存在适用工作流。外部工具安装失败不会阻塞核心安装和项目蒸馏。

## 快速开始

从 GitHub Release 下载 `agent-seed.zip`，使用 Codex、Claude Code、codeagent-cli 或 OpenCode 的正常 skill 安装流程安装，然后在目标项目中调用 `/agent-seed`。

Agent Seed 会：

1. 解析共享 `knowledge_asset_write_mode`。
2. 运行带缓存的 Agent Seed 更新检查。
3. 识别目标项目使用的 Agent 平台。
4. 安装并验证三个核心项目级组件。
5. 在项目知识未初始化、未完成、失败或显式要求全量刷新时调用 `project-distiller`。

维护本源码仓库时，不要把它误当成待蒸馏项目；应把真正的目标项目路径传给已安装的 Agent Seed。

## 权限模式

团队模式保存在 `.agents/agent-seed.json`：

| 模式 | 行为 |
| --- | --- |
| `full-access` | 自动执行 manifest 声明的项目级核心安装、更新、instruction edits 和已确认的知识资产写入；检测到本地修改时仍会保留并交给负责人决定。 |
| `agent-approve` | 可在已确认的知识范围内写入；安装、冲突、删除、大范围重写、hook、网络和个人/全局写入需要批准。 |
| `ask-each-change` | 每次项目文件修改或安装前都请求批准。 |

当前请求优先于共享配置。首次运行两者都未指定时，会请负责人选择并推荐 `full-access`。

## Managed Components

检查指定平台：

```sh
node scripts/manage-managed-skills.mjs check <target-project> --platform <platform> --json
```

在 `full-access` 下同步核心组件：

```sh
node scripts/manage-managed-skills.mjs apply <target-project> --all --platform <platform> --approved --json
```

在需要批准的模式下应用单个组件：

```sh
node scripts/manage-managed-skills.mjs apply <target-project> --name <component> --platform <platform> --approved --json
```

管理器会：

- 通过 staging 复制 direct skills；
- 对每个独立组件做备份和 rollback；
- 在 `.agent-seed-managed.json` 中记录内容 SHA-256；
- 把用户修改过的 managed 内容报告为 `modified`，批量同步不会覆盖；
- 在同一安装事务中执行并验证已知的 `AGENTS.md`/`CLAUDE.md` 规则；
- 允许本次暂缓核心组件，但不允许永久 decline；
- 只有可选组件才支持按精确版本静默拒绝。

主要状态包括：`current`、`install-available`、`missing`、`update-available`、`partial`、`modified`、`unverified` 和 `baseline-unavailable`。

## 知识生命周期

共享配置示例：

```json
{
  "schema_version": 2,
  "knowledge_asset_write_mode": "full-access",
  "knowledge_distillation": {
    "status": "complete",
    "completed_at": "2026-08-29T10:00:00.000Z",
    "agent_seed_version": "v1.0.0"
  }
}
```

`project-distiller` 负责状态转换：

- 状态缺失、无效、`in_progress` 或 `failed`：启动项目蒸馏；
- `complete` 且 `AGENTS.md` 存在：跳过自动蒸馏；
- `complete` 但 `AGENTS.md` 缺失：执行修复蒸馏；
- 显式全量刷新：始终绕过完成标记。

`knowledge-updater` 是独立的任务结束增量路径。它不会扫描仓库，也不会把首次蒸馏标记为完成。

## 项目状态文件

| 路径 | 用途 |
| --- | --- |
| `.agents/agent-seed.json` | 团队共享策略、最低 Agent Seed 版本和蒸馏状态；提交到 Git。 |
| `.agents/agent-seed.local.json` | 本机安装路径、代理、更新缓存和可选项决策；加入 Git ignore。 |
| `.agents/managed-skills.json` | 可选的团队 managed component 目标基线；提交到 Git。 |
| `.agent-seed-managed.json` | 每个 managed target 内的来源、版本和内容摘要。 |
| `AGENTS.md`、`agents.d/` | 由 Project Distiller 和 Knowledge Updater 维护的项目知识。 |

## 自更新

检查带缓存的最新版本状态：

```sh
node scripts/update-agent-seed.mjs --json
```

只有负责人明确批准后才应用更新：

```sh
node scripts/update-agent-seed.mjs --apply
```

Windows 下如果 skill 目录被当前 Agent 进程锁定，更新器会排队，在宿主退出后完成替换并记录最终状态。

## 维护与发布

```sh
make check
make release VERSION=v1.2.3
```

发布包只从 `skill/` 构建。发布产物包含 Agent Seed 主包、各 bundled skill 产物、`VERSION.json` 和带 SHA-256 的 `agent-seed-release.json`。

English documentation: [README.md](README.md)
