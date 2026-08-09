import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  assessMinimumAgentSeedVersion,
  ensureAgentSeedGitignore,
  getKnowledgeDistillationState,
  migrateAgentSeedConfig,
  readAgentSeedFiles,
  refreshAgentSeedBaseline,
  resolveKnowledgeAssetWriteMode,
  resolveAgentSeedConfig,
  shouldStartKnowledgeDistillation,
  splitLegacyAgentSeedConfig,
  writeKnowledgeDistillationState,
  writeLocalAgentSeedState,
} from "../skill/scripts/agent-seed-config.mjs";

const execFileAsync = promisify(execFile);

test("effective config combines shared policy with local state without local policy override", () => {
  const effective = resolveAgentSeedConfig({
    shared: {
      schema_version: 2,
      minimum_agent_seed_version: "v0.3.8",
      knowledge_asset_write_mode: "agent-approve",
      knowledge_distillation: {
        status: "complete",
        completed_at: "2026-08-05T10:00:00.000Z",
      },
      self_update: { check_on_start: true, update_mode: "notify" },
    },
    local: {
      schema_version: 1,
      installation: { skill_root: "C:/agent-seed" },
      self_update: {
        check_on_start: false,
        proxy: { https_proxy: "http://proxy.example:8080" },
        last_check: { status: "current" },
      },
    },
  });

  assert.equal(effective.minimum_agent_seed_version, "v0.3.8");
  assert.equal(effective.knowledge_asset_write_mode, "agent-approve");
  assert.deepEqual(effective.knowledge_distillation, {
    status: "complete",
    completed_at: "2026-08-05T10:00:00.000Z",
  });
  assert.equal(effective.self_update.check_on_start, true);
  assert.equal(effective.self_update.update_mode, "notify");
  assert.equal(effective.self_update.proxy.https_proxy, "http://proxy.example:8080");
  assert.equal(effective.self_update.last_check.status, "current");
});

test("knowledge asset write mode requires first-run selection when unconfigured", () => {
  assert.deepEqual(resolveKnowledgeAssetWriteMode({}), {
    status: "requires-selection",
    recommended_mode: "full-access",
    supported_modes: ["full-access", "agent-approve", "ask-each-change"],
  });
  assert.deepEqual(resolveKnowledgeAssetWriteMode({ shared: { knowledge_asset_write_mode: "agent-approve" } }), {
    status: "resolved",
    mode: "agent-approve",
    source: "shared-config",
  });
  assert.deepEqual(resolveKnowledgeAssetWriteMode({ requestedMode: "ask-each-change", shared: { knowledge_asset_write_mode: "full-access" } }), {
    status: "resolved",
    mode: "ask-each-change",
    source: "current-request",
  });
});

test("legacy config is split into shared policy and local state", () => {
  const result = splitLegacyAgentSeedConfig({
    knowledge_asset_write_mode: "full-access",
    self_update: {
      check_on_start: true,
      proxy: { https_proxy: "http://proxy.example:8080" },
      last_check: { status: "updated" },
    },
    installation: { skill_root: "C:/Users/example/.codex/skills/agent-seed" },
    install_prompt_history: [{ integration: "opencli", decision: "declined" }],
    future_field: { keep: true },
  }, "v0.3.7");

  assert.deepEqual(result.shared, {
    schema_version: 2,
    minimum_agent_seed_version: "v0.3.7",
    knowledge_asset_write_mode: "full-access",
    self_update: { check_on_start: true },
  });
  assert.deepEqual(result.local.self_update, {
    proxy: { https_proxy: "http://proxy.example:8080" },
    last_check: { status: "updated" },
  });
  assert.deepEqual(result.local.installation, { skill_root: "C:/Users/example/.codex/skills/agent-seed" });
  assert.deepEqual(result.local.install_prompt_history, [{ integration: "opencli", decision: "declined" }]);
  assert.deepEqual(result.local.legacy_unclassified, { future_field: { keep: true } });
});

test("legacy split preserves an approved baseline newer than the installed version", () => {
  const result = splitLegacyAgentSeedConfig({
    minimum_agent_seed_version: "v0.4.0",
    knowledge_asset_write_mode: "full-access",
  }, "v0.3.8");

  assert.equal(result.shared.minimum_agent_seed_version, "v0.4.0");
});

test("legacy split preserves knowledge distillation state in shared policy", () => {
  const result = splitLegacyAgentSeedConfig({
    knowledge_distillation: {
      status: "complete",
      completed_at: "2026-08-05T10:00:00.000Z",
    },
  }, "v0.3.8");

  assert.deepEqual(result.shared.knowledge_distillation, {
    status: "complete",
    completed_at: "2026-08-05T10:00:00.000Z",
  });
});

test("legacy split rejects malformed knowledge distillation timestamps", () => {
  assert.throws(
    () => splitLegacyAgentSeedConfig({
      knowledge_distillation: { status: "complete", completed_at: "not-a-date" },
    }, "v0.3.8"),
    /Invalid legacy Agent Seed field: knowledge_distillation/,
  );
});

test("minimum version assessment distinguishes incompatible, current, and newer installs", () => {
  assert.equal(assessMinimumAgentSeedVersion({ installedVersion: "v0.3.7", minimumVersion: "v0.3.8" }).state, "version-incompatible");
  assert.equal(assessMinimumAgentSeedVersion({ installedVersion: "v0.3.8", minimumVersion: "v0.3.8" }).state, "version-current");
  assert.equal(assessMinimumAgentSeedVersion({ installedVersion: "v0.3.9", minimumVersion: "v0.3.8" }).state, "baseline-refresh-available");
  assert.equal(assessMinimumAgentSeedVersion({ installedVersion: "v0.3.8", minimumVersion: "" }).state, "unconfigured");
});

test("knowledge distillation defaults to missing and starts when the marker is absent or invalid", () => {
  assert.deepEqual(getKnowledgeDistillationState({}), { status: "missing" });
  assert.equal(shouldStartKnowledgeDistillation({ shared: {}, hasAgentsFile: false }), true);
  assert.deepEqual(
    getKnowledgeDistillationState({ knowledge_distillation: { status: "unknown" } }),
    { status: "missing", reason: "invalid-status" },
  );
  assert.deepEqual(
    getKnowledgeDistillationState({ knowledge_distillation: { status: "complete" } }),
    { status: "missing", reason: "invalid-complete" },
  );
  assert.deepEqual(
    getKnowledgeDistillationState({ knowledge_distillation: { status: "complete", completed_at: "not-a-date" } }),
    { status: "missing", reason: "invalid-complete" },
  );
  assert.equal(
    shouldStartKnowledgeDistillation({
      shared: { knowledge_distillation: { status: "unknown" } },
      hasAgentsFile: true,
    }),
    true,
  );
});

test("completed knowledge distillation skips automatic onboarding only when AGENTS.md exists", () => {
  const shared = {
    knowledge_distillation: {
      status: "complete",
      completed_at: "2026-08-05T10:00:00.000Z",
    },
  };

  assert.deepEqual(getKnowledgeDistillationState(shared), shared.knowledge_distillation);
  assert.equal(shouldStartKnowledgeDistillation({ shared, hasAgentsFile: true }), false);
  assert.equal(shouldStartKnowledgeDistillation({ shared, hasAgentsFile: false }), true);
  assert.equal(shouldStartKnowledgeDistillation({ shared, hasAgentsFile: true, forceFullRefresh: true }), true);
});

test("knowledge distillation state persists in shared config without changing policy", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-distillation-state-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "agent-seed.json"), `${JSON.stringify({
      schema_version: 2,
      minimum_agent_seed_version: "v0.3.8",
      knowledge_asset_write_mode: "full-access",
    })}\n`);

    const running = await writeKnowledgeDistillationState({
      targetDir,
      state: { status: "in_progress", started_at: "2026-08-05T09:00:00.000Z" },
    });
    assert.deepEqual(running, { status: "in_progress", started_at: "2026-08-05T09:00:00.000Z" });

    const complete = await writeKnowledgeDistillationState({
      targetDir,
      state: {
        status: "complete",
        completed_at: "2026-08-05T10:00:00.000Z",
        agent_seed_version: "v0.3.8",
      },
    });
    assert.equal(complete.status, "complete");

    const files = await readAgentSeedFiles(targetDir);
    assert.equal(files.shared.minimum_agent_seed_version, "v0.3.8");
    assert.equal(files.shared.knowledge_asset_write_mode, "full-access");
    assert.deepEqual(files.shared.knowledge_distillation, complete);

    const failed = await writeKnowledgeDistillationState({
      targetDir,
      state: { status: "failed", last_step: "owner interview" },
    });
    assert.deepEqual(failed, { status: "failed", last_step: "owner interview" });
    assert.equal(shouldStartKnowledgeDistillation({ shared: { knowledge_distillation: failed }, hasAgentsFile: true }), true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("knowledge distillation state rejects unsupported statuses and incomplete completion metadata", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-distillation-invalid-"));
  try {
    await assert.rejects(
      writeKnowledgeDistillationState({ targetDir, state: { status: "unknown" } }),
      /Unsupported knowledge distillation status: unknown/,
    );
    await assert.rejects(
      writeKnowledgeDistillationState({ targetDir, state: { status: "complete" } }),
      /completed_at is required/,
    );
    await assert.rejects(
      writeKnowledgeDistillationState({ targetDir, state: { status: "complete", completed_at: "not-a-date" } }),
      /completed_at is required/,
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration keeps a newer existing local value and is idempotent", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-config-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "agent-seed.json"), `${JSON.stringify({
      knowledge_asset_write_mode: "full-access",
      self_update: { check_on_start: true, last_check: { status: "old" } },
      install_prompt_history: [{ integration: "opencli", decision: "declined" }],
    })}\n`);
    await writeFile(path.join(agentsDir, "agent-seed.local.json"), `${JSON.stringify({
      schema_version: 1,
      self_update: { last_check: { status: "newer" } },
      install_prompt_history: [{ integration: "opencli", decision: "declined" }],
    })}\n`);
    await writeFile(path.join(targetDir, ".gitignore"), ".agents/agent-seed.json\n.agents/managed-skills.json\nkeep.txt\n");

    const first = await migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" });
    assert.equal(first.status, "migrated");

    const files = await readAgentSeedFiles(targetDir);
    assert.equal(files.shared.minimum_agent_seed_version, "v0.3.8");
    assert.equal(files.local.self_update.last_check.status, "newer");
    assert.equal(files.local.install_prompt_history.length, 1);
    const gitignore = await readFile(path.join(targetDir, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.agents\/agent-seed\.local\.json$/m);
    assert.doesNotMatch(gitignore, /^\.agents\/agent-seed\.json$/m);
    assert.doesNotMatch(gitignore, /^\.agents\/managed-skills\.json$/m);
    assert.match(gitignore, /^keep\.txt$/m);

    const second = await migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" });
    assert.equal(second.status, "current");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration adds parent negations for broad Agent config ignores", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-broad-ignore-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "agent-seed.json"), `${JSON.stringify({ knowledge_asset_write_mode: "full-access" })}\n`);
    await writeFile(path.join(targetDir, ".gitignore"), ".agents/\nother.txt\n");
    await execFileAsync("git", ["init", "--quiet"], { cwd: targetDir });
    await migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" });

    const gitignore = await readFile(path.join(targetDir, ".gitignore"), "utf8");
    assert.match(gitignore, /^!\.agents\/$/m);
    assert.match(gitignore, /^\.agents\/agent-seed\.local\.json$/m);
    assert.match(gitignore, /^!\.agents\/agent-seed\.json$/m);
    assert.match(gitignore, /^!\.agents\/managed-skills\.json$/m);
    assert.match(gitignore, /^other\.txt$/m);

    await assert.rejects(
      execFileAsync("git", ["check-ignore", "--no-index", ".agents/agent-seed.json"], { cwd: targetDir }),
      { code: 1 },
    );
    await assert.rejects(
      execFileAsync("git", ["check-ignore", "--no-index", ".agents/managed-skills.json"], { cwd: targetDir }),
      { code: 1 },
    );
    const localIgnore = await execFileAsync(
      "git",
      ["check-ignore", "--no-index", ".agents/agent-seed.local.json"],
      { cwd: targetDir },
    );
    assert.match(localIgnore.stdout, /agent-seed\.local\.json/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("Git ignore repair works without a legacy Agent Seed config", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-ignore-only-"));
  try {
    await mkdir(path.join(targetDir, ".agents"), { recursive: true });
    await writeFile(path.join(targetDir, ".gitignore"), ".agents/agent-seed.json\n.agents/managed-skills.json\n");

    const changed = await ensureAgentSeedGitignore(targetDir);
    assert.equal(changed, true);
    const gitignore = await readFile(path.join(targetDir, ".gitignore"), "utf8");
    assert.doesNotMatch(gitignore, /^\.agents\/agent-seed\.json$/m);
    assert.doesNotMatch(gitignore, /^\.agents\/managed-skills\.json$/m);
    assert.match(gitignore, /^\.agents\/agent-seed\.local\.json$/m);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration refuses to downgrade a future shared config schema", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-future-schema-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    const sharedPath = path.join(agentsDir, "agent-seed.json");
    const future = `${JSON.stringify({ schema_version: 3, future_policy: true })}\n`;
    await mkdir(agentsDir, { recursive: true });
    await writeFile(sharedPath, future);

    await assert.rejects(
      migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" }),
      /Unsupported future Agent Seed config schema: 3/,
    );
    assert.equal(await readFile(sharedPath, "utf8"), future);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("local state writer refuses to overwrite a future local schema", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-future-local-schema-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    const localPath = path.join(agentsDir, "agent-seed.local.json");
    const future = `${JSON.stringify({ schema_version: 2, future_local_state: true })}\n`;
    await mkdir(agentsDir, { recursive: true });
    await writeFile(localPath, future);

    await assert.rejects(
      writeLocalAgentSeedState({ targetDir, patch: { self_update: { last_check: { status: "current" } } } }),
      /Unsupported future Agent Seed local schema: 2/,
    );
    assert.equal(await readFile(localPath, "utf8"), future);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("local state writer does not modify shared policy", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-local-write-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "agent-seed.json"), `${JSON.stringify({
      schema_version: 2,
      minimum_agent_seed_version: "v0.3.8",
      knowledge_asset_write_mode: "agent-approve",
      self_update: { check_on_start: true },
    })}\n`);
    await writeLocalAgentSeedState({ targetDir, patch: { self_update: { last_check: { status: "current" } } } });

    const shared = JSON.parse(await readFile(path.join(agentsDir, "agent-seed.json"), "utf8"));
    const local = JSON.parse(await readFile(path.join(agentsDir, "agent-seed.local.json"), "utf8"));
    assert.deepEqual(shared.self_update, { check_on_start: true });
    assert.deepEqual(local.self_update.last_check, { status: "current" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration leaves a malformed legacy file unchanged", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-invalid-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    const sharedPath = path.join(agentsDir, "agent-seed.json");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(sharedPath, "{ invalid json\n");

    await assert.rejects(migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" }), SyntaxError);
    assert.equal(await readFile(sharedPath, "utf8"), "{ invalid json\n");
    await assert.rejects(readFile(path.join(agentsDir, "agent-seed.local.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration rejects malformed known legacy fields without rewriting", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-invalid-shape-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    const sharedPath = path.join(agentsDir, "agent-seed.json");
    const legacy = `${JSON.stringify({
      knowledge_asset_write_mode: "full-access",
      self_update: "invalid",
      install_prompt_history: { decision: "approved" },
    })}\n`;
    await mkdir(agentsDir, { recursive: true });
    await writeFile(sharedPath, legacy);

    await assert.rejects(
      migrateAgentSeedConfig({ targetDir, installedVersion: "v0.3.8" }),
      /Invalid legacy Agent Seed field: self_update/,
    );
    assert.equal(await readFile(sharedPath, "utf8"), legacy);
    await assert.rejects(readFile(path.join(agentsDir, "agent-seed.local.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("migration requires a valid split-capable installed version before writing", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-no-version-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    const sharedPath = path.join(agentsDir, "agent-seed.json");
    const legacy = `${JSON.stringify({ knowledge_asset_write_mode: "full-access" })}\n`;
    await mkdir(agentsDir, { recursive: true });
    await writeFile(sharedPath, legacy);

    await assert.rejects(
      migrateAgentSeedConfig({ targetDir, installedVersion: "" }),
      /valid installed Agent Seed version/,
    );
    assert.equal(await readFile(sharedPath, "utf8"), legacy);
    await assert.rejects(readFile(path.join(agentsDir, "agent-seed.local.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("approved baseline refresh changes only the shared version and never downgrades", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-baseline-"));
  try {
    const agentsDir = path.join(targetDir, ".agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(agentsDir, "agent-seed.json"), `${JSON.stringify({
      schema_version: 2,
      minimum_agent_seed_version: "v0.3.8",
      knowledge_asset_write_mode: "full-access",
      self_update: { check_on_start: true },
    })}\n`);

    await assert.rejects(
      refreshAgentSeedBaseline({ targetDir, installedVersion: "v0.3.9" }),
      /Owner approval/,
    );
    const refreshed = await refreshAgentSeedBaseline({ targetDir, installedVersion: "v0.3.9", approved: true });
    assert.deepEqual(refreshed, { status: "refreshed", minimum_agent_seed_version: "v0.3.9" });
    const shared = JSON.parse(await readFile(path.join(agentsDir, "agent-seed.json"), "utf8"));
    assert.equal(shared.minimum_agent_seed_version, "v0.3.9");
    assert.equal(shared.knowledge_asset_write_mode, "full-access");
    assert.deepEqual(shared.self_update, { check_on_start: true });

    const unchanged = await refreshAgentSeedBaseline({ targetDir, installedVersion: "v0.3.7", approved: true });
    assert.deepEqual(unchanged, { status: "unchanged", minimum_agent_seed_version: "v0.3.9" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
