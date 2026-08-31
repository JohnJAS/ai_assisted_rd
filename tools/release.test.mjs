import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { releaseSkill } from "./release.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const skillRoot = path.join(repoRoot, "skill");

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("releaseSkill creates expanded and zipped Agent Seed artifacts", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-"));
  try {
    const source = path.join(rootDir, "skill");
    await mkdir(path.join(source, "references"), { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await writeFile(path.join(source, "references", "guide.md"), "# Guide\n");

    const result = await releaseSkill({ rootDir, skillDir: source, outputDir: path.join(rootDir, "outputs") });
    assert.equal(path.basename(result.expandedDir), "agent-seed");
    assert.equal(path.basename(result.zipPath), "agent-seed.zip");
    assert.equal(await readFile(path.join(result.expandedDir, "references", "guide.md"), "utf8"), "# Guide\n");
    assert.ok((await stat(result.zipPath)).size > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("releaseSkill packages direct skills and platform overlays", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-bundled-"));
  try {
    const source = path.join(rootDir, "skill");
    const child = path.join(source, "bundled-skills", "alpha", "skill");
    const overlay = path.join(source, "bundled-skills", "alpha", "overlays", "codex", "agents");
    await mkdir(path.join(child, "references"), { recursive: true });
    await mkdir(overlay, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await writeFile(path.join(child, "SKILL.md"), "---\nname: alpha\n---\n");
    await writeFile(path.join(child, "references", "guide.md"), "# Alpha\n");
    await writeFile(path.join(overlay, "openai.yaml"), "interface:\n  display_name: \"Alpha\"\n");
    await writeFile(path.join(source, "bundled-skills.json"), `${JSON.stringify({
      bundled_skills: [{
        name: "alpha",
        version: "v1.0.0",
        source_path: "bundled-skills/alpha/skill",
        platforms: [{ platform: "codex", overlay_path: "bundled-skills/alpha/overlays/codex" }],
      }],
    })}\n`);

    await releaseSkill({ rootDir, skillDir: source, outputDir: path.join(rootDir, "outputs") });
    assert.equal(await readFile(path.join(rootDir, "outputs", "bundled-skills", "alpha", "references", "guide.md"), "utf8"), "# Alpha\n");
    assert.match(await readFile(path.join(rootDir, "outputs", "bundled-skills", "alpha-codex", "agents", "openai.yaml"), "utf8"), /Alpha/);
    assert.ok((await stat(path.join(rootDir, "outputs", "bundled-skills", "alpha.zip"))).size > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("releaseSkill writes version metadata and release digests", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-version-"));
  try {
    const source = path.join(rootDir, "skill");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "---\nname: agent-seed\n---\n");
    const result = await releaseSkill({
      rootDir,
      skillDir: source,
      outputDir: path.join(rootDir, "outputs"),
      version: "v2.3.4",
      repository: "owner/agent-seed",
      commit: "0123456789abcdef",
    });
    const version = JSON.parse(await readFile(path.join(result.expandedDir, "VERSION.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(rootDir, "outputs", "agent-seed-release.json"), "utf8"));
    assert.equal(version.version, "v2.3.4");
    assert.equal(version.repository, "owner/agent-seed");
    assert.ok(manifest.assets.some((asset) => asset.name === "agent-seed.zip" && /^[a-f0-9]{64}$/.test(asset.sha256)));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("release CLI accepts an explicit version", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-cli-"));
  try {
    const source = path.join(rootDir, "skill");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await execFileAsync(process.execPath, [path.join(repoRoot, "tools", "release.mjs"), "--root-dir", rootDir, "--version", "v9.9.9"]);
    const version = JSON.parse(await readFile(path.join(rootDir, "outputs", "agent-seed", "VERSION.json"), "utf8"));
    assert.equal(version.version, "v9.9.9");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Agent Seed is an installer and routes distillation to a child skill", async () => {
  const source = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(source, /installer and orchestrator/i);
  assert.match(source, /does not perform repository knowledge distillation/i);
  assert.match(source, /route.*project-distiller/is);
  assert.match(source, /project-distiller.*owns repository scanning/is);
  assert.match(source, /optional.*Git helpers.*ticket-lookup.*git-code-tracker/is);
  assert.match(source, /external.*failure.*must not block/is);
});

test("bundled manifests expose only the three core components by default", async () => {
  const skills = JSON.parse(await readFile(path.join(skillRoot, "bundled-skills.json"), "utf8"));
  const packages = JSON.parse(await readFile(path.join(skillRoot, "bundled-packages.json"), "utf8"));
  const defaults = skills.bundled_skills.filter((entry) => entry.default_install.offer_by_default);
  assert.deepEqual(defaults.map((entry) => entry.name), ["agent-seed-updater", "project-distiller", "knowledge-updater"]);
  assert.ok(defaults.every((entry) => entry.default_install.required === true));
  assert.ok(skills.bundled_skills.filter((entry) => !defaults.includes(entry)).every((entry) => entry.default_install.offer_by_default === false));
  assert.ok(packages.bundled_packages.every((entry) => entry.default_install.offer_by_default === false));
  assert.ok(skills.bundled_skills.every((entry) => /^v\d+\.\d+\.\d+$/.test(entry.version)));
  assert.ok(skills.bundled_skills.every((entry) => entry.version !== "$AGENT_SEED_VERSION"));
});

test("core post-install rules are declarative and manager-owned", async () => {
  const skills = JSON.parse(await readFile(path.join(skillRoot, "bundled-skills.json"), "utf8"));
  const updater = skills.bundled_skills.find((entry) => entry.name === "agent-seed-updater");
  const knowledge = skills.bundled_skills.find((entry) => entry.name === "knowledge-updater");
  assert.equal(updater.post_install.action, "ensure-agent-seed-updater-startup-rule");
  assert.equal(knowledge.post_install.action, "ensure-knowledge-updater-completion-rule");
  assert.deepEqual(updater.post_install.instruction_files, ["AGENTS.md", "CLAUDE.md"]);
  assert.deepEqual(knowledge.post_install.instruction_files, ["AGENTS.md", "CLAUDE.md"]);
});

test("project-distiller is self-contained and owns the distillation lifecycle", async () => {
  const root = path.join(skillRoot, "bundled-skills", "project-distiller", "skill");
  const source = await readFile(path.join(root, "SKILL.md"), "utf8");
  for (const relative of [
    "references/knowledge-distillation.md",
    "references/framework-fingerprints.md",
    "references/output-assets.md",
    "references/update-existing-assets.md",
    "references/fresh-agent-dry-run.md",
    "framework-knowledge.json",
  ]) {
    await access(path.join(root, relative));
  }
  assert.match(source, /in_progress/);
  assert.match(source, /status.*complete/is);
  assert.match(source, /owner interview/i);
  assert.match(source, /fresh-agent/i);
  assert.match(source, /does not install or update skills/i);
  assert.equal(await exists(path.join(skillRoot, "references", "knowledge-distillation.md")), false);
});

test("project-distiller framework registry resolves inside the child skill", async () => {
  const root = path.join(skillRoot, "bundled-skills", "project-distiller", "skill");
  const config = JSON.parse(await readFile(path.join(root, "framework-knowledge.json"), "utf8"));
  for (const entry of config.framework_knowledge) {
    assert.ok(entry.name);
    assert.ok(entry.aliases.length > 0);
    await access(path.join(root, entry.knowledge_path));
  }
  const harmony = await readFile(path.join(root, "references", "frameworks", "harmonyos.md"), "utf8");
  const nuwa = await readFile(path.join(root, "references", "frameworks", "nuwa.md"), "utf8");
  assert.match(harmony, /DevEco CLI/);
  assert.doesNotMatch(nuwa, /DevEco CLI|devecocli|hvigor|ohpm/i);
});

test("external integrations are recommendations and never onboarding blockers", async () => {
  const external = JSON.parse(await readFile(path.join(skillRoot, "external-packages.json"), "utf8"));
  assert.equal(external.activation_policy.mode_policy.full_access.failure_action, "report-and-continue");
  assert.equal(external.activation_policy.mode_policy.full_access.required_integrations, undefined);
  assert.equal(external.activation_policy.recurring_install_prompt, undefined);
  assert.ok(external.recommended_external_plugins.some((entry) => entry.name === "opencli"));
  assert.ok(external.recommended_external_plugins.some((entry) => entry.name === "superpowers"));
});

test("managed updater documents digest drift, partial installs, and required decline boundaries", async () => {
  const source = await readFile(path.join(skillRoot, "bundled-skills", "agent-seed-updater", "skill", "SKILL.md"), "utf8");
  assert.match(source, /exactly once.*before the first project task/is);
  assert.match(source, /modified.*recorded digest/is);
  assert.match(source, /Never overwrite it automatically/i);
  assert.match(source, /partial/);
  assert.match(source, /Required core components.*cannot be persistently declined/is);
  assert.match(source, /Do not scan repository source/i);
});

test("knowledge-updater remains a bounded end-of-task skill", async () => {
  const source = await readFile(path.join(skillRoot, "bundled-skills", "knowledge-updater", "skill", "SKILL.md"), "utf8");
  assert.match(source, /after the main task.*before the final response/is);
  assert.match(source, /Do not scan or search the repository/i);
  assert.match(source, /does not start initial knowledge distillation/i);
  assert.match(source, /Knowledge assets: updated/);
});

test("all direct skills provide project-local targets for four supported platforms", async () => {
  const manifest = JSON.parse(await readFile(path.join(skillRoot, "bundled-skills.json"), "utf8"));
  for (const entry of manifest.bundled_skills) {
    assert.deepEqual(entry.platforms.map((platform) => platform.platform), ["codex", "claude", "codeagent-cli", "opencode"]);
    const cac = entry.platforms.find((platform) => platform.platform === "codeagent-cli");
    assert.match(cac.target_path, /^\.cac\/skills\//);
    await access(path.join(skillRoot, entry.source_path, "SKILL.md"));
  }
});

test("git workflow skills preserve their safety invariants", async () => {
  const gitpush = await readFile(path.join(skillRoot, "bundled-skills", "gitpush", "skill", "SKILL.md"), "utf8");
  const gittag = await readFile(path.join(skillRoot, "bundled-skills", "gittag", "skill", "SKILL.md"), "utf8");
  assert.match(gitpush, /git remote get-url origin/);
  assert.match(gitpush, /git remote get-url upstream/);
  assert.match(gitpush, /git commit -S/);
  assert.match(gittag, /gitsync/);
  assert.match(gittag, /git push origin/);
  assert.match(gittag, /git push upstream/);
});

test("release source contains no legacy SessionEnd hook implementation", async () => {
  assert.equal(await exists(path.join(skillRoot, "scripts", "session-end-knowledge-update.mjs")), false);
  const source = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.doesNotMatch(source, /session-end-knowledge-update\.mjs/);
});

test("README quick starts describe installer, distiller, and updater roles", async () => {
  const english = await readFile(path.join(repoRoot, "README.md"), "utf8");
  const chinese = await readFile(path.join(repoRoot, "README.zh-CN.md"), "utf8");
  for (const content of [english, chinese]) {
    assert.match(content, /agent-seed/i);
    assert.match(content, /project-distiller/i);
    assert.match(content, /knowledge-updater/i);
    assert.match(content, /agent-seed-updater/i);
  }
});
