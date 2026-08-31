import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runAgentSeedPreflight } from "../skill/scripts/check-agent-seed-updates.mjs";

const execFileAsync = promisify(execFile);

test("preflight combines the existing self-update and managed checks", async () => {
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    runSelfUpdate: async () => ({ hasUpdate: true, currentVersion: "v1.0.0", latestVersion: "v1.1.0", cached: true }),
    inspectManaged: async () => ({ managed: [{ name: "gitpush", state: "update-available" }], external: [] }),
  });

  assert.deepEqual(result.agent_seed, {
    state: "update-available",
    current_version: "v1.0.0",
    available_version: "v1.1.0",
    cached: true,
  });
  assert.equal(result.managed[0].name, "gitpush");
  assert.deepEqual(result.errors, []);
});

test("preflight continues managed inspection when self-update check fails", async () => {
  let managedCalled = false;
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    runSelfUpdate: async () => { throw new Error("network unavailable"); },
    inspectManaged: async () => { managedCalled = true; return { managed: [], external: [] }; },
  });

  assert.equal(managedCalled, true);
  assert.equal(result.agent_seed.state, "unknown");
  assert.deepEqual(result.errors, [{ source: "agent-seed", message: "network unavailable" }]);
});

test("preflight reports an incompatible Agent Seed baseline even without a remote update", async () => {
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    runSelfUpdate: async () => ({
      hasUpdate: false,
      currentVersion: "v0.3.7",
      latestVersion: "v0.3.7",
      baseline: {
        state: "version-incompatible",
        installed_version: "v0.3.7",
        minimum_version: "v0.3.8",
      },
    }),
    inspectManaged: async () => ({ managed: [], external: [] }),
  });

  assert.deepEqual(result.agent_seed, {
    state: "version-incompatible",
    current_version: "v0.3.7",
    available_version: "v0.3.7",
    minimum_version: "v0.3.8",
    cached: false,
  });
});

test("preflight reports unknown when Agent Seed version or baseline evidence is unconfigured", async () => {
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    runSelfUpdate: async () => ({
      hasUpdate: false,
      currentVersion: "invalid",
      latestVersion: "invalid",
      baseline: {
        state: "unconfigured",
        installed_version: null,
        minimum_version: null,
      },
    }),
    inspectManaged: async () => ({ managed: [], external: [] }),
  });

  assert.equal(result.agent_seed.state, "unknown");
});

test("preflight honors the persistent self-update opt-out and still inspects managed skills", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-preflight-disabled-"));
  let selfUpdateCalled = false;
  let managedCalled = false;

  try {
    await mkdir(path.join(targetDir, ".agents"), { recursive: true });
    await writeFile(
      path.join(targetDir, ".agents", "agent-seed.json"),
      `${JSON.stringify({ self_update: { check_on_start: false } })}\n`,
    );
    const result = await runAgentSeedPreflight({
      skillRoot: "C:/agent-seed",
      targetDir,
      platform: "codex",
      runSelfUpdate: async () => { selfUpdateCalled = true; return {}; },
      inspectManaged: async () => { managedCalled = true; return { managed: [], external: [] }; },
    });

    assert.equal(selfUpdateCalled, false);
    assert.equal(managedCalled, true);
    assert.deepEqual(result.agent_seed, { state: "skipped", reason: "check-on-start-disabled" });
    assert.deepEqual(result.errors, []);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("preflight honors a one-conversation self-update skip", async () => {
  let selfUpdateCalled = false;
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    skipSelfUpdate: true,
    runSelfUpdate: async () => { selfUpdateCalled = true; return {}; },
    inspectManaged: async () => ({ managed: [], external: [] }),
  });

  assert.equal(selfUpdateCalled, false);
  assert.deepEqual(result.agent_seed, { state: "skipped", reason: "conversation-skip" });
});

test("preflight returns managed errors without failing the caller", async () => {
  const result = await runAgentSeedPreflight({
    skillRoot: "C:/agent-seed",
    targetDir: "C:/project",
    platform: "codex",
    runSelfUpdate: async () => ({ hasUpdate: false, currentVersion: "v1.1.0", latestVersion: "v1.1.0" }),
    inspectManaged: async () => { throw new Error("invalid bundled-skills.json"); },
  });

  assert.deepEqual(result.managed, []);
  assert.deepEqual(result.errors, [{ source: "managed-skills", message: "invalid bundled-skills.json" }]);
});

test("updater instructions make full-access managed synchronization mode-aware", async () => {
  const updaterPath = path.join(process.cwd(), "skill", "bundled-skills", "agent-seed-updater", "skill", "SKILL.md");
  const corePath = path.join(process.cwd(), "skill", "SKILL.md");
  const updater = await readFile(updaterPath, "utf8");
  const core = await readFile(corePath, "utf8");

  assert.match(updater, /resolve.*knowledge_asset_write_mode.*before.*preflight/is);
  assert.match(updater, /full-access.*manage-managed-skills\.mjs apply.*--all.*--approved.*--json/is);
  assert.match(updater, /approval-gated modes.*manage-managed-skills\.mjs apply.*--name/is);
  assert.match(updater, /content digest.*instruction rule verify/is);
  assert.match(updater, /modified.*Never overwrite it automatically/is);
  assert.match(core, /full-access.*synchronize.*--all/is);
  assert.match(core, /agent-approve.*ask-each-change.*--name/is);
});

test("preflight CLI emits combined JSON for a cached self-update result", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-preflight-cli-"));
  const skillRoot = path.join(rootDir, "agent-seed");
  const targetDir = path.join(rootDir, "project");

  try {
    await writeFixture({ skillRoot, targetDir, selfUpdater: 'console.log(JSON.stringify({ hasUpdate: false, currentVersion: "v1.1.0", latestVersion: "v1.1.0", cached: true }));\n' });
    const report = await runCli({ skillRoot, targetDir });

    assert.equal(report.agent_seed.state, "current");
    assert.equal(report.agent_seed.cached, true);
    assert.equal(report.managed[0].state, "install-available");
    assert.deepEqual(report.errors, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preflight CLI preserves managed results when self-update exits nonzero", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-preflight-cli-failure-"));
  const skillRoot = path.join(rootDir, "agent-seed");
  const targetDir = path.join(rootDir, "project");

  try {
    await writeFixture({ skillRoot, targetDir, selfUpdater: 'console.error("network unavailable"); process.exitCode = 1;\n' });
    const report = await runCli({ skillRoot, targetDir });

    assert.equal(report.agent_seed.state, "unknown");
    assert.equal(report.managed[0].state, "install-available");
    assert.equal(report.errors[0].source, "agent-seed");
    assert.match(report.errors[0].message, /network unavailable/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preflight CLI skip flag avoids self-update while preserving managed results", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-preflight-cli-skip-"));
  const skillRoot = path.join(rootDir, "agent-seed");
  const targetDir = path.join(rootDir, "project");
  const markerPath = path.join(rootDir, "self-update-called.txt");

  try {
    await writeFixture({ skillRoot, targetDir, selfUpdater: `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "called");\n` });
    const report = await runCli({ skillRoot, targetDir, extraArgs: ["--skip-self-update"] });

    assert.equal(report.agent_seed.state, "skipped");
    assert.equal(report.managed[0].state, "install-available");
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function writeFixture({ skillRoot, targetDir, selfUpdater }) {
  await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(skillRoot, "scripts", "update-agent-seed.mjs"), selfUpdater);
  await writeFile(path.join(skillRoot, "bundled-skills.json"), `${JSON.stringify({
    bundled_skills: [{
      name: "alpha",
      version: "v1.1.0",
      source_path: "bundled-skills/alpha/skill",
      default_install: { offer_by_default: true },
      platforms: [{ platform: "codex", target_path: "skills/alpha" }],
    }],
  })}\n`);
  await writeFile(path.join(skillRoot, "bundled-packages.json"), '{"bundled_packages":[]}\n');
}

async function runCli({ skillRoot, targetDir, extraArgs = [] }) {
  const script = path.join(process.cwd(), "skill", "scripts", "check-agent-seed-updates.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    targetDir,
    "--platform",
    "codex",
    "--skill-root",
    skillRoot,
    ...extraArgs,
    "--json",
  ]);
  return JSON.parse(stdout);
}
