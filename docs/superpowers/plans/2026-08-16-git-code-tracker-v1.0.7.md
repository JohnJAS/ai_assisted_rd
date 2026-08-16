# git-code-tracker v1.0.7 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle `git-code-tracker v1.0.7`, update Agent Seed's installer and documentation, and verify the new AI-source tracking hooks.

**Architecture:** Keep `skill/bundled-packages.json` as the package metadata source of truth. The existing installer reads that manifest and extracts the selected platform directory, so the implementation remains a focused version/asset update plus regression coverage for v1.0.7's four hook integrations.

**Tech Stack:** Node.js ESM, Node built-in test runner, PowerShell ZIP tooling, Make.

---

### Task 1: Lock the v1.0.7 expectations in tests

**Files:**
- Modify: `tools/git-code-tracker-release.test.mjs`
- Modify: `tools/release.test.mjs` only if its package assertions expose version-specific values

- [ ] **Step 1: Update the focused test fixture to use `ai-commit-statistic-skill-v1.0.7.zip`, expect installed version `1.0.7`, and expect the v1.0.7 download URL.**
- [ ] **Step 2: Add a focused assertion that a Claude installation contains the four v1.0.7 hook entries: `pre-commit`, `post-commit`, `pre-push`, and `post-rewrite`.**
- [ ] **Step 3: Run `node --test tools/git-code-tracker-release.test.mjs` and verify it fails because the repository still points at v1.0.6.**

### Task 2: Update the bundled package and installer metadata

**Files:**
- Modify: `skill/bundled-packages.json`
- Modify: `skill/scripts/install-git-code-tracker.mjs`
- Replace: `skill/packages/git-code-tracker/ai-commit-statistic-skill-v1.0.6.zip` with `skill/packages/git-code-tracker/ai-commit-statistic-skill-v1.0.7.zip`

- [ ] **Step 1: Download the upstream v1.0.7 asset and verify SHA-256 equals `6345d1b0ffee9750a71f526c41af83be6b620cfcf992bd3f206224c82d365041`.**
- [ ] **Step 2: Update the manifest version, tag ref, commit, asset name, and asset path to v1.0.7.**
- [ ] **Step 3: Update the installer's default archive path to the v1.0.7 asset filename.**
- [ ] **Step 4: Run the focused tests and verify they pass, including the new hook assertions.**

### Task 3: Update release documentation and package metadata checks

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `skill/references/output-assets.md`
- Modify: `tools/release.test.mjs` if required by the package metadata assertions

- [ ] **Step 1: Update every user-facing v1.0.6 package reference to v1.0.7, including asset filename, tag, commit, and bundled path.**
- [ ] **Step 2: Document that the bundled tracker installs four Git hooks and records AI modification sources.**
- [ ] **Step 3: Run `rg -n "v1\\.0\\.6|ai-commit-statistic-skill-v1\\.0\\.6|871267c9" README.md README.zh-CN.md skill tools` and verify no active v1.0.6 references remain.**

### Task 4: Run repository verification and rebuild release artifacts

**Files:**
- Generated: `outputs/` from the release command only

- [ ] **Step 1: Run `make check` and verify all test files exit successfully.**
- [ ] **Step 2: Run `make release` and verify the release package is rebuilt successfully.**
- [ ] **Step 3: Inspect `git diff --stat`, the package manifest, and the vendored asset hash; confirm no unrelated files changed.**
