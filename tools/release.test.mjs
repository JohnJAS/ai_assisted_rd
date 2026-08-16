import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { releaseSkill } from "./release.mjs";

const execFileAsync = promisify(execFile);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("releaseSkill creates an expanded skill directory and zip package", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-"));

  try {
    const skillDir = path.join(rootDir, "skill");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await writeFile(path.join(skillDir, "references", "guide.md"), "# Guide\n");

    const result = await releaseSkill({
      rootDir,
      skillDir: path.join(rootDir, "skill"),
      outputDir: path.join(rootDir, "outputs"),
    });

    assert.equal(path.basename(result.expandedDir), "agent-seed");
    assert.equal(path.basename(result.zipPath), "agent-seed.zip");
    assert.equal(await readFile(path.join(result.expandedDir, "SKILL.md"), "utf8"), "---\nname: agent-seed\n---\n");
    assert.equal(await readFile(path.join(result.expandedDir, "references", "guide.md"), "utf8"), "# Guide\n");

    const zipStat = await stat(result.zipPath);
    assert.ok(zipStat.size > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("releaseSkill packages bundled direct skills from the manifest", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-bundled-"));

  try {
    const skillDir = path.join(rootDir, "skill");
    const bundledSkillDir = path.join(skillDir, "bundled-skills", "alpha-tool", "skill");
    const codexOverlayDir = path.join(skillDir, "bundled-skills", "alpha-tool", "overlays", "codex");

    await mkdir(path.join(bundledSkillDir, "references"), { recursive: true });
    await mkdir(path.join(codexOverlayDir, "agents"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await writeFile(path.join(bundledSkillDir, "SKILL.md"), "---\nname: alpha-tool\n---\n");
    await writeFile(path.join(bundledSkillDir, "references", "guide.md"), "# Alpha\n");
    await writeFile(path.join(codexOverlayDir, "agents", "openai.yaml"), "version: 1\n");
    await writeFile(
      path.join(skillDir, "bundled-skills.json"),
      `${JSON.stringify(
        {
          bundled_skills: [
            {
              name: "alpha-tool",
              version: "$AGENT_SEED_VERSION",
              source_path: "bundled-skills/alpha-tool/skill",
              platforms: [
                {
                  platform: "codex",
                  overlay_path: "bundled-skills/alpha-tool/overlays/codex",
                },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await releaseSkill({
      rootDir,
      skillDir: path.join(rootDir, "skill"),
      outputDir: path.join(rootDir, "outputs"),
    });

    const bundledOutputDir = path.join(rootDir, "outputs", "bundled-skills");
    assert.equal(
      await readFile(path.join(bundledOutputDir, "alpha-tool", "SKILL.md"), "utf8"),
      "---\nname: alpha-tool\n---\n",
    );
    assert.equal(
      await readFile(path.join(bundledOutputDir, "alpha-tool", "references", "guide.md"), "utf8"),
      "# Alpha\n",
    );
    assert.equal(
      await readFile(path.join(bundledOutputDir, "alpha-tool-codex", "agents", "openai.yaml"), "utf8"),
      "version: 1\n",
    );

    assert.ok((await stat(path.join(bundledOutputDir, "alpha-tool.zip"))).size > 0);
    assert.ok((await stat(path.join(bundledOutputDir, "alpha-tool-codex.zip"))).size > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("releaseSkill writes package version metadata and a release manifest", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-version-"));

  try {
    const skillDir = path.join(rootDir, "skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: agent-seed\n---\n");

    const result = await releaseSkill({
      rootDir,
      skillDir,
      outputDir: path.join(rootDir, "outputs"),
      version: "v2.3.4",
      repository: "owner/agent-seed",
      commit: "0123456789abcdef",
    });

    const versionMetadata = JSON.parse(await readFile(path.join(result.expandedDir, "VERSION.json"), "utf8"));
    assert.equal(versionMetadata.name, "agent-seed");
    assert.equal(versionMetadata.version, "v2.3.4");
    assert.equal(versionMetadata.repository, "owner/agent-seed");
    assert.equal(versionMetadata.commit, "0123456789abcdef");
    assert.equal(versionMetadata.update.release_manifest, "agent-seed-release.json");

    const manifestPath = path.join(rootDir, "outputs", "agent-seed-release.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.name, "agent-seed");
    assert.equal(manifest.version, "v2.3.4");
    assert.equal(manifest.repository, "owner/agent-seed");
    assert.equal(manifest.commit, "0123456789abcdef");
    assert.ok(
      manifest.assets.some(
        (asset) => asset.name === "agent-seed.zip" && asset.path === "agent-seed.zip" && /^[a-f0-9]{64}$/.test(asset.sha256),
      ),
    );
    assert.ok(manifest.assets.some((asset) => asset.name === "agent-seed-release.json" && /^[a-f0-9]{64}$/.test(asset.sha256)));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("releaseSkill materializes bundled direct-skill versions", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-bundled-version-"));

  try {
    const skillDir = path.join(rootDir, "skill");
    await mkdir(path.join(skillDir, "bundled-skills", "alpha", "skill"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: agent-seed\n---\n");
    await writeFile(path.join(skillDir, "bundled-skills", "alpha", "skill", "SKILL.md"), "---\nname: alpha\n---\n");
    await writeFile(
      path.join(skillDir, "bundled-skills.json"),
      `${JSON.stringify({ bundled_skills: [{ name: "alpha", version: "$AGENT_SEED_VERSION", source_path: "bundled-skills/alpha/skill", platforms: [] }] })}\n`,
    );

    const result = await releaseSkill({ rootDir, skillDir, outputDir: path.join(rootDir, "outputs"), version: "v2.3.4" });
    const manifest = JSON.parse(await readFile(path.join(result.expandedDir, "bundled-skills.json"), "utf8"));

    assert.equal(manifest.bundled_skills[0].version, "v2.3.4");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("release CLI accepts a local version override", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "agent-seed-release-cli-version-"));

  try {
    const skillDir = path.join(rootDir, "skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: agent-seed\n---\n");

    await execFileAsync(process.execPath, [
      path.join(process.cwd(), "tools", "release.mjs"),
      "--root-dir",
      rootDir,
      "--version",
      "v9.9.9",
    ]);

    const versionMetadata = JSON.parse(await readFile(path.join(rootDir, "outputs", "agent-seed", "VERSION.json"), "utf8"));
    const releaseManifest = JSON.parse(await readFile(path.join(rootDir, "outputs", "agent-seed-release.json"), "utf8"));

    assert.equal(versionMetadata.version, "v9.9.9");
    assert.equal(releaseManifest.version, "v9.9.9");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

function assertModeAwareInstallPolicy(activationPolicy, { requiredIntegrations, appliesToDefaultInstalls } = {}) {
  assert.deepEqual(activationPolicy.mode_policy.approval_gated_modes, ["ask-each-change", "agent-approve"]);
  assert.deepEqual(activationPolicy.mode_policy.full_access, {
    default_install_action: "must_install_and_verify_before_onboarding",
    requires_user_approval: false,
    allow_network: true,
    allow_personal_or_global_writes: true,
    authorize_declared_install_side_effects: true,
    failure_action: "block_onboarding",
    ...(requiredIntegrations ? { required_integrations: requiredIntegrations } : {}),
    ...(appliesToDefaultInstalls ? { applies_to_default_installs: true } : {}),
  });
  assert.deepEqual(activationPolicy.skip_reason_required_in_modes, ["ask-each-change", "agent-approve"]);
  assert.equal(activationPolicy.requires_user_approval, undefined);
  assert.equal(activationPolicy.skip_reason_required, undefined);
}

function assertModeAwareItemApproval(item) {
  assert.deepEqual(item.requires_user_approval_in_modes, ["ask-each-change", "agent-approve"]);
  assert.equal(item.requires_user_approval, undefined);
}

test("external packages config uses the generalized file name", async () => {
  const packagesPath = path.join(process.cwd(), "skill", "external-packages.json");
  const pluginsPath = path.join(process.cwd(), "skill", "external-plugins.json");

  assert.equal(await exists(packagesPath), true);
  assert.equal(await exists(pluginsPath), false);
});

test("external packages config includes install metadata", async () => {
  const configPath = path.join(process.cwd(), "skill", "external-packages.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(config.activation_policy.on_agent_seed_start, "must_check");
  assert.equal(config.activation_policy.approval_gated_missing_action, "must_offer_before_onboarding");
  assertModeAwareInstallPolicy(config.activation_policy, {
    requiredIntegrations: ["superpowers", "opencli"],
  });
  assert.deepEqual(config.activation_policy.recurring_install_prompt, {
    applies_to: ["opencli"],
    modes: ["ask-each-change", "agent-approve"],
    missing_action: "must_ask_every_activation_before_onboarding",
    declined_action: "record_reason_and_continue",
    previous_decline_suppresses_prompt: false,
  });
  assert.deepEqual(config.activation_policy.update_policy, {
    ownership: "platform-native",
    version_check: "best-effort",
    update_requires_user_approval: true,
  });

  assert.ok(Array.isArray(config.recommended_external_plugins));
  assert.ok(config.recommended_external_plugins.length > 0);

  for (const plugin of config.recommended_external_plugins) {
    assert.equal(typeof plugin.name, "string");
    assert.notEqual(plugin.name.trim(), "");
    assert.equal(typeof plugin.display_name, "string");
    assert.notEqual(plugin.display_name.trim(), "");
    assert.equal(typeof plugin.purpose, "string");
    assert.notEqual(plugin.purpose.trim(), "");
    assert.equal(typeof plugin.use_when, "string");
    assert.notEqual(plugin.use_when.trim(), "");
    assert.equal(typeof plugin.do_not_vendor_unless_explicitly_requested, "boolean");

    assert.equal(typeof plugin.default_recommendation.requires_network, "boolean");
    assertModeAwareItemApproval(plugin.default_recommendation);
    assert.deepEqual(plugin.default_recommendation.safety_level_by_mode, {
      "ask-each-change": "ask-first",
      "agent-approve": "ask-first",
      "full-access": "autonomous",
    });

    assert.ok(Array.isArray(plugin.platforms));
    assert.ok(plugin.platforms.length > 0);

    for (const platform of plugin.platforms) {
      assert.equal(typeof platform.platform, "string");
      assert.notEqual(platform.platform.trim(), "");
      assert.equal(typeof platform.install_action, "string");
      assert.notEqual(platform.install_action.trim(), "");
      assert.ok(Array.isArray(platform.detection_evidence));
      assert.ok(platform.detection_evidence.length > 0);
      assert.ok(platform.detection_evidence.every((entry) => typeof entry === "string" && entry.trim() !== ""));
      assert.equal(typeof platform.verification, "string");
      assert.notEqual(platform.verification.trim(), "");
    }
  }
});

test("Agent Seed installs a non-blocking agent-seed-updater startup rule", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");

  await stat(path.join(rootDir, "skill", "scripts", "manage-managed-skills.mjs"));
  await stat(path.join(rootDir, "skill", "scripts", "check-agent-seed-updates.mjs"));
  for (const content of [skill, outputAssets]) {
    assert.match(content, /agent-seed-updater/i);
    assert.match(content, /before the first.*task.*new agent conversation/is);
    assert.match(content, /exactly once|do not invoke it again/i);
    assert.match(content, /cached.*self-update.*managed-skill/is);
    assert.match(content, /do not.*Agent Seed onboarding.*scan the repository/is);
    assert.match(content, /without blocking|must not block/i);
    assert.match(content, /owner approval|user approval/i);
  }
  assert.match(skill, /update-agent-seed\.mjs --json/);
  assert.match(skill, /self-update.*must never.*--apply/is);
  assert.match(outputAssets, /Codex.*OpenCode.*AGENTS\.md/is);
  assert.match(outputAssets, /Claude Code.*codeagent-cli.*CLAUDE\.md/is);
  assert.match(outputAssets, /pre-existing|partial installation/i);
  assert.match(outputAssets, /missing.*startup rule.*offer.*repair/is);
  assert.doesNotMatch(outputAssets, /run `node <agent-seed-root>\/scripts\/manage-managed-skills\.mjs check/);
});

test("Agent Seed migrates the existing direct managed preflight without onboarding", async () => {
  const skill = await readFile(path.join(process.cwd(), "skill", "SKILL.md"), "utf8");
  const outputAssets = await readFile(path.join(process.cwd(), "skill", "references", "output-assets.md"), "utf8");

  for (const content of [skill, outputAssets]) {
    assert.match(content, /old|obsolete|legacy/i);
    assert.match(content, /direct.*manage-managed-skills\.mjs.*preflight/is);
    assert.match(content, /replace|remove/i);
    assert.match(content, /after.*agent-seed-updater.*install/is);
    assert.match(content, /preserve unrelated/i);
    assert.match(content, /do not.*scan.*interview.*knowledge distillation/is);
  }
});

test("README documents the lightweight Agent Seed updater lifecycle", async () => {
  const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");

  assert.match(readme, /agent-seed-updater/i);
  assert.match(readme, /check-agent-seed-updates\.mjs/);
  assert.match(readme, /24-hour cache/i);
  assert.match(readme, /install-available/);
  assert.match(readme, /declined-current-version/);
  assert.match(readme, /same version.*not.*prompt|same version.*suppressed/is);
  assert.match(readme, /higher.*version.*prompt/is);
  assert.match(readme, /synchronous.*recheck/is);
  assert.match(readme, /queued.*next conversation/is);
  assert.match(readme, /knowledge-updater.*after.*task/is);
  assert.match(readme, /does not.*repository scan|no repository scan/is);
});

test("public managed-skill guidance documents full-access batch synchronization", async () => {
  const rootDir = process.cwd();
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");
  const chineseReadme = await readFile(path.join(rootDir, "README.zh-CN.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");

  for (const content of [readme, chineseReadme, outputAssets]) {
    assert.match(content, /full-access.*(automatic|automatically|auto|自动).*managed.*(sync|synchron|batch|批量)/is);
    assert.match(content, /rollback.*failed.*continue|failed.*rollback.*later/is);
    assert.match(content, /exact-version.*decline|same version.*suppressed|精确版本.*拒绝/is);
    assert.match(content, /approval-gated.*per-entry|ask-each-change.*--name|逐条.*批准/is);
    assert.match(content, /external.*platform-native.*(never|not|remain|不会|原生)/is);
  }
});

test("README provides a bilingual user quick start for onboarding and skill installs", async () => {
  const rootDir = process.cwd();
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");
  const chineseReadmePath = path.join(rootDir, "README.zh-CN.md");

  assert.equal(await exists(chineseReadmePath), true);
  assert.match(readme, /README\.zh-CN\.md/);
  assert.match(readme, /## Quick Start/);
  assert.match(readme, /lazy|first-run|knowledge distillation/i);
  assert.match(readme, /bundled skills|plugins|full-access/i);
  assert.match(readme, /full refresh|owner interview/i);

  const chineseReadme = await readFile(chineseReadmePath, "utf8");
  assert.match(chineseReadme, /快速入门/);
  assert.match(chineseReadme, /首次.*蒸馏|知识蒸馏/);
  assert.match(chineseReadme, /skill|插件|安装/i);
  assert.match(chineseReadme, /全量.*蒸馏|重新.*访谈/);
  assert.match(chineseReadme, /full-access|ask-each-change|agent-approve/);
});

test("bundled install manifests require activation preflight handling", async () => {
  const rootDir = process.cwd();
  const bundledSkills = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const bundledPackages = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-packages.json"), "utf8"));

  for (const config of [bundledSkills, bundledPackages]) {
    assert.equal(config.activation_policy.on_agent_seed_start, "must_check");
    assert.equal(config.activation_policy.approval_gated_default_install_action, "must_offer_before_onboarding");
    assertModeAwareInstallPolicy(config.activation_policy, { appliesToDefaultInstalls: true });
    assert.deepEqual(config.activation_policy.managed_target_policy, {
      full_access: "replace-and-verify",
      approval_gated: "ask-before-write",
      personal_or_global_target_requires_explicit_request: true,
    });
  }

  assert.equal(bundledSkills.activation_policy.recurring_install_prompt, undefined);
  assert.deepEqual(bundledPackages.activation_policy.recurring_install_prompt, {
    applies_to: ["git-code-tracker"],
    modes: ["ask-each-change", "agent-approve"],
    missing_action: "must_ask_every_activation_before_onboarding",
    declined_action: "record_reason_and_continue",
    previous_decline_suppresses_prompt: false,
  });

  for (const entry of bundledSkills.bundled_skills) {
    assertModeAwareItemApproval(entry.default_install);
    assert.equal(entry.safety, undefined);
    if (entry.post_install) {
      assertModeAwareItemApproval(entry.post_install);
    }
  }

  for (const entry of bundledPackages.bundled_packages) {
    assertModeAwareItemApproval(entry.default_install);
    assert.equal(entry.safety, undefined);
  }
});

test("bundled direct skill manifest registers every bundled skill directory", async () => {
  const rootDir = process.cwd();
  const bundledSkillsDir = path.join(rootDir, "skill", "bundled-skills");
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const registeredNames = new Set(config.bundled_skills.map((skill) => skill.name));
  const directoryNames = (await readdir(bundledSkillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directoryName of directoryNames) {
    assert.ok(registeredNames.has(directoryName), `missing bundled-skills.json entry for ${directoryName}`);
  }

  for (const skill of config.bundled_skills) {
    assert.equal(typeof skill.source_path, "string");
    await stat(path.join(rootDir, "skill", skill.source_path, "SKILL.md"));
  }
});

test("ticket-lookup bundled skill defines configurable read-only SR and AR retrieval", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const ticketLookup = config.bundled_skills.find((skill) => skill.name === "ticket-lookup");

  assert.ok(ticketLookup, "expected ticket-lookup bundled skill");
  assert.equal(ticketLookup.kind, "multi-platform-direct-skill");
  assert.equal(ticketLookup.source_path, "bundled-skills/ticket-lookup/skill");
  assert.equal(ticketLookup.default_install.mode, "project-local");
  assert.equal(ticketLookup.default_install.offer_by_default, true);
  assertModeAwareItemApproval(ticketLookup.default_install);
  assert.equal(ticketLookup.default_install.install_only_for_detected_or_requested_platforms, true);
  assert.deepEqual(ticketLookup.platforms.map((platform) => platform.platform).sort(), ["claude", "codeagent-cli", "codex", "opencode"]);
  assert.equal(ticketLookup.platforms.find((platform) => platform.platform === "codex").overlay_path, "bundled-skills/ticket-lookup/overlays/codex");
  assert.deepEqual(ticketLookup.external_dependency, {
    registry_path: "external-packages.json",
    plugin: "opencli",
  });

  const skill = await readFile(path.join(rootDir, "skill", ticketLookup.source_path, "SKILL.md"), "utf8");
  assert.match(skill, /SR/i);
  assert.match(skill, /AR/i);
  assert.match(skill, /\.agents\/ticket-lookup\.local\.json/);
  assert.match(skill, /\.agents\/ticket-lookup\.json/);
  assert.match(skill, /requirement_management_url/);
  assert.match(skill, /allow_prefilled_login_submit/);
  assert.match(skill, /"allow_prefilled_login_submit"\s*:\s*true/);
  assert.match(skill, /\.agents\/sitemaps\/<host>\//);
  assert.match(skill, /\.agents\/ticket-lookup\/sites\/<host>\.md/);
  assert.match(skill, /Observed/);
  assert.match(skill, /Verified/);
  assert.match(skill, /Inferred/);
  assert.match(skill, /After each successful lookup/i);
  assert.match(skill, /ticket content|ticket body/i);
  assert.match(skill, /without reading or filling/i);
  assert.match(skill, /click.*once/i);
  assert.match(skill, /MFA|验证码|captcha/i);
  assert.match(skill, /configured browser-automation skill/i);
  assert.match(skill, /read-only/i);
  assert.match(skill, /\.gitignore/);

  const siteKnowledgeTemplate = await readFile(
    path.join(rootDir, "skill", ticketLookup.source_path, "references", "site-knowledge-template.md"),
    "utf8",
  );
  assert.match(siteKnowledgeTemplate, /Direct Paths/);
  assert.match(siteKnowledgeTemplate, /Observed/);
  assert.match(siteKnowledgeTemplate, /Verified/);
  assert.match(siteKnowledgeTemplate, /Inferred/);

  const codexPrompt = await readFile(path.join(rootDir, "skill", "bundled-skills", "ticket-lookup", "overlays", "codex", "agents", "openai.yaml"), "utf8");
  assert.match(codexPrompt, /ticket-lookup/i);
  assert.match(codexPrompt, /SR/i);
  assert.match(codexPrompt, /AR/i);
  assert.doesNotMatch(codexPrompt, /OpenCLI/i);
});

test("agent-seed-updater bundled skill defines a bounded conversation preflight", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const updater = config.bundled_skills.find((entry) => entry.name === "agent-seed-updater");

  assert.ok(updater, "expected agent-seed-updater bundled skill");
  assert.equal(updater.kind, "multi-platform-direct-skill");
  assert.equal(updater.source_path, "bundled-skills/agent-seed-updater/skill");
  assert.equal(updater.default_install.mode, "project-local");
  assert.equal(updater.default_install.offer_by_default, true);
  assertModeAwareItemApproval(updater.default_install);
  assert.equal(updater.default_install.install_only_for_detected_or_requested_platforms, true);
  assert.deepEqual(updater.platforms.map((entry) => entry.platform).sort(), ["claude", "codeagent-cli", "codex", "opencode"]);
  assert.equal(
    updater.platforms.find((entry) => entry.platform === "codex").overlay_path,
    "bundled-skills/agent-seed-updater/overlays/codex",
  );
  assert.deepEqual(updater.post_install, {
    action: "ensure-agent-seed-updater-startup-rule",
    requires_user_approval_in_modes: ["ask-each-change", "agent-approve"],
    instruction_files: ["AGENTS.md", "CLAUDE.md"],
  });

  const skill = await readFile(path.join(rootDir, "skill", updater.source_path, "SKILL.md"), "utf8");
  assert.match(skill, /once.*before the first user task/is);
  assert.match(skill, /check-agent-seed-updates\.mjs/);
  assert.match(skill, /decline.*--confirmed/is);
  assert.match(skill, /apply.*--approved/is);
  assert.match(skill, /synchronous.*run the preflight again/is);
  assert.match(skill, /queued.*next conversation/is);
  assert.match(skill, /do not scan the repository/i);
  assert.match(skill, /do not invoke Agent Seed onboarding/i);
  assert.match(skill, /do not update knowledge assets/i);
  assert.match(skill, /must not block the user.*task/is);
  assert.match(skill, /first run.*AGENTS\.md/is);
  assert.match(skill, /old direct.*manage-managed-skills\.mjs.*preflight/is);
  assert.match(skill, /post_install.*ensure-agent-seed-updater-startup-rule/is);
  assert.match(skill, /resolve.*knowledge_asset_write_mode.*before.*preflight/is);
  assert.match(skill, /full-access.*manage-managed-skills\.mjs apply.*--all.*--approved.*--json/is);
  assert.match(skill, /ask-each-change.*agent-approve.*manage-managed-skills\.mjs apply.*--name/is);
  assert.match(skill, /post_install.*preflight again/is);
  assert.match(skill, /failed.*continue.*later/is);

  const codexPrompt = await readFile(
    path.join(rootDir, "skill", "bundled-skills", "agent-seed-updater", "overlays", "codex", "agents", "openai.yaml"),
    "utf8",
  );
  assert.match(codexPrompt, /Agent Seed Updater/);
  assert.match(codexPrompt, /before the first project task/i);
  assert.match(codexPrompt, /do not run Agent Seed onboarding/i);
});

test("knowledge-updater bundled skill defines recurring bounded knowledge maintenance", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const updater = config.bundled_skills.find((skill) => skill.name === "knowledge-updater");

  assert.ok(updater, "expected knowledge-updater bundled skill");
  assert.equal(updater.kind, "multi-platform-direct-skill");
  assert.equal(updater.source_path, "bundled-skills/knowledge-updater/skill");
  assert.equal(updater.default_install.mode, "project-local");
  assert.equal(updater.default_install.offer_by_default, true);
  assertModeAwareItemApproval(updater.default_install);
  assert.equal(updater.default_install.install_only_for_detected_or_requested_platforms, true);
  assert.deepEqual(updater.platforms.map((platform) => platform.platform).sort(), ["claude", "codeagent-cli", "codex", "opencode"]);
  assert.equal(
    updater.platforms.find((platform) => platform.platform === "codex").overlay_path,
    "bundled-skills/knowledge-updater/overlays/codex",
  );

  const skill = await readFile(path.join(rootDir, "skill", updater.source_path, "SKILL.md"), "utf8");
  assert.match(skill, /after.*task.*before.*final response/is);
  assert.match(skill, /current conversation/i);
  assert.match(skill, /AGENTS\.md/);
  assert.match(skill, /agents\.d\//);
  assert.match(skill, /do not scan.*repository/is);
  assert.match(skill, /do not.*child agent/is);
  assert.match(skill, /smallest coherent edit/i);
  assert.match(skill, /conflict.*not updated/is);
  for (const sourceLabel of ["Owner-confirmed", "Observed during run", "Repo-confirmed", "Preference", "Risk judgment"]) {
    assert.match(skill, new RegExp(sourceLabel, "i"));
  }
  assert.match(skill, /secrets.*personal data.*private account identifiers.*machine-specific paths/is);
  assert.match(skill, /raw conversation text.*temporary debugging attempts.*duplicate guidance.*unsupported inference/is);
  assert.match(skill, /avoid duplication/i);
  assert.match(skill, /add a concise link.*AGENTS\.md.*index/is);
  assert.match(skill, /Knowledge assets: no new reusable knowledge/);
  assert.match(skill, /Knowledge assets: updated/);
  assert.match(skill, /Knowledge assets: not initialized/);
  assert.match(skill, /Knowledge assets: conflict, not updated/);
  assert.match(skill, /Knowledge assets: update failed/);
  assert.match(skill, /does not.*start.*initial.*distillation/is);
  assert.match(skill, /does not.*mark.*distillation.*complete/is);
  assert.match(skill, /agents\.d.*absent.*create/is);

  const codexPrompt = await readFile(
    path.join(rootDir, "skill", "bundled-skills", "knowledge-updater", "overlays", "codex", "agents", "openai.yaml"),
    "utf8",
  );
  assert.match(codexPrompt, /knowledge-updater/i);
  assert.match(codexPrompt, /before.*final response/i);
});

test("Agent Seed installs a knowledge-updater completion rule without lifecycle hooks", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";

  for (const content of [skill, outputAssets]) {
    assert.match(content, /knowledge-updater/i);
    assert.match(content, /after.*task.*before.*final response/is);
    assert.match(content, /AGENTS\.md/);
    assert.match(content, /owner approval|user approval/i);
  }

  assert.match(outputAssets, /Knowledge assets: no new reusable knowledge/);
  assert.match(outputAssets, /Knowledge assets: updated/);
  assert.match(outputAssets, /Codex.*OpenCode.*AGENTS\.md/is);
  assert.match(outputAssets, /Claude Code.*codeagent-cli.*CLAUDE\.md/is);
  assert.match(outputAssets, /skill.*unavailable.*Knowledge assets: update failed/is);
  assert.match(outputAssets, /installed.*completion rule.*missing.*offer.*repair/is);
  assert.match(outputAssets, /partial installation/i);
  assert.doesNotMatch(frontmatter, /add newly discovered project knowledge/i);
  assert.doesNotMatch(skill, /Update existing onboarding assets when reusable project knowledge appears during later agent work/i);
  assert.match(skill, /explicitly requests.*Agent Seed.*refresh/is);
});

test("Agent Seed uses a lazy distillation marker and supports explicit full refresh", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");

  for (const content of [skill, outputAssets, readme]) {
    assert.match(content, /knowledge_distillation/);
    assert.match(content, /status.*complete/is);
    assert.match(content, /AGENTS\.md.*agents\.d/is);
  }
  assert.match(skill, /missing.*invalid.*in_progress.*failed/is);
  assert.match(skill, /only after.*fresh-agent.*dry run.*self-review/is);
  assert.match(skill, /full refresh.*bypass.*complete/is);
  assert.match(skill, /重新进行全量知识蒸馏和访谈/);
  assert.match(outputAssets, /agents\.d.*on demand|on demand.*agents\.d/is);
  assert.match(outputAssets, /after.*agent-seed-updater.*knowledge_distillation/is);
  assert.match(outputAssets, /invoke[\s>]*Agent Seed onboarding/i);
});

test("Agent Seed treats legacy SessionEnd hooks as approval-gated migration", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");

  assert.match(skill, /legacy/i);
  assert.match(skill, /session-end-knowledge-update\.mjs/);
  assert.match(skill, /\.claude\/settings\.json/);
  assert.match(skill, /\.cac\/settings\.json/);
  assert.match(skill, /approval/i);
  assert.match(skill, /must not.*silently/is);
  assert.match(skill, /personal|global/i);
  assert.match(skill, /parse.*JSON/is);
  assert.match(skill, /exact matching command/i);
  assert.match(skill, /preserve unrelated/i);
});

test("release source no longer contains the SessionEnd implementation", async () => {
  const rootDir = process.cwd();
  const obsoletePaths = [
    path.join(rootDir, "skill", "scripts", "session-end-knowledge-update.mjs"),
    path.join(rootDir, "skill", "references", "session-end-hooks.md"),
  ];

  for (const obsoletePath of obsoletePaths) {
    await assert.rejects(access(obsoletePath), { code: "ENOENT" });
  }

  const makefile = await readFile(path.join(rootDir, "Makefile"), "utf8");
  const gitignore = await readFile(path.join(rootDir, ".gitignore"), "utf8");
  assert.doesNotMatch(makefile, /session-end-knowledge-update/);
  assert.doesNotMatch(gitignore, /session-summaries/);
});

test("README documents lightweight knowledge-updater behavior", async () => {
  const rootDir = process.cwd();
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");

  assert.match(readme, /knowledge-updater/i);
  assert.match(readme, /after.*task.*before.*final response/is);
  assert.match(readme, /AGENTS\.md/);
  assert.match(readme, /agents\.d\//);
  assert.match(readme, /current conversation/i);
  assert.match(readme, /no repository scan/i);
  assert.match(readme, /legacy.*SessionEnd/is);
  assert.match(readme, /approval/i);
  assert.doesNotMatch(readme, /session_end_knowledge_update/);
  assert.doesNotMatch(readme, /\.agents\/session-summaries/);
});

test("Codex bundled direct skill detection does not treat AGENTS.md as a standalone platform signal", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));

  for (const skill of config.bundled_skills) {
    const codex = skill.platforms.find((platform) => platform.platform === "codex");
    assert.ok(codex, `${skill.name} must define Codex platform metadata`);
    assert.ok(Array.isArray(codex.detection_paths));
    assert.equal(codex.detection_paths.includes("AGENTS.md"), false, `${skill.name} Codex detection should not use AGENTS.md`);
  }
});

test("external plugin config recognizes both OpenCode config file names", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "external-packages.json"), "utf8"));
  const opencodePlatforms = config.recommended_external_plugins
    .flatMap((plugin) => plugin.platforms)
    .filter((platform) => platform.platform === "opencode");

  assert.ok(opencodePlatforms.length > 0);

  for (const platform of opencodePlatforms) {
    const searchableText = [platform.install_action, platform.verification, ...platform.detection_evidence].join("\n");
    assert.match(searchableText, /opencode\.json/);
    assert.match(searchableText, /\.opencode\.yaml/);
  }
});

test("bundled direct skills support codeagent-cli .cac targets", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));

  for (const skill of config.bundled_skills) {
    const platform = skill.platforms.find((entry) => entry.platform === "codeagent-cli");

    assert.ok(platform, `${skill.name} must define codeagent-cli platform metadata`);
    assert.equal(platform.target_path, `.cac/skills/${skill.name}`);
    assert.deepEqual(platform.detection_paths, [".cac"]);
    assert.equal(platform.verification, `SKILL.md exists at .cac/skills/${skill.name}/SKILL.md`);
    assert.ok(skill.writes.includes(`.cac/skills/${skill.name}`), `${skill.name} writes must include .cac target`);
  }
});

test("git-code-tracker release asset supports codeagent-cli .cac installation", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-packages.json"), "utf8"));
  const tracker = config.bundled_packages.find((entry) => entry.name === "git-code-tracker");

  assert.ok(tracker, "expected git-code-tracker package entry");
  assert.equal(tracker.version, "v1.0.7");
  assert.equal(tracker.source.type, "github-release-asset");
  assert.equal(tracker.source.ref, "refs/tags/v1.0.7");
  assert.equal(tracker.source.commit, "d882fc8ba66b5aadf32e0c445389e51eaa17ae7f");
  assert.equal(tracker.source.asset, "ai-commit-statistic-skill-v1.0.7.zip");
  assert.equal(tracker.asset_path, "packages/git-code-tracker/ai-commit-statistic-skill-v1.0.7.zip");
  assert.equal(tracker.default_install.auto_detect_platform, true);
  assert.match(tracker.default_install.command, /scripts\/install-git-code-tracker\.mjs/);
  assert.ok(tracker.default_install.writes.includes(".cac/skills/ai-code-tracker"));
  assert.ok(tracker.default_install.writes.includes(".cac/commands"));
  assert.ok(tracker.default_install.writes.includes(".cac/settings.json"));
  assert.ok(tracker.default_install.writes.includes(".ai-tracking/config.json"));
  assert.ok(tracker.default_install.writes.includes(".ai-tracking/upload-outbox.json"));
  assert.deepEqual(tracker.upload, {
    config_path: ".ai-tracking/config.json",
    default_url: "http://7.213.196.158:8088/v1/records",
    trigger: "git pre-push hook",
    outbox_path: ".ai-tracking/upload-outbox.json",
    preserve_existing_url: true,
  });

  const platform = tracker.platform_skills.find((entry) => entry.platform === "codeagent-cli");
  assert.ok(platform, "git-code-tracker must define codeagent-cli platform skill metadata");
  assert.equal(platform.source_path, ".cac/skills/ai-code-tracker");
  assert.equal(platform.target_path, ".cac/skills/ai-code-tracker");
  assert.equal(platform.verification, "node .cac/skills/ai-code-tracker/scripts/install.js --check");

  await stat(path.join(rootDir, "skill", tracker.asset_path));
  const installer = await readFile(path.join(rootDir, "skill", "scripts", "install-git-code-tracker.mjs"), "utf8");
  assert.match(installer, /codeagent-cli/);
  assert.match(installer, /AI_CODE_TRACKER_PROCESS_TREE/);
});

test("git-code-tracker release asset guidance delegates initialization to the copied skill", async () => {
  const rootDir = process.cwd();
  const config = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-packages.json"), "utf8"));
  const tracker = config.bundled_packages.find((entry) => entry.name === "git-code-tracker");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");

  assert.ok(tracker, "expected git-code-tracker package entry");
  assert.match(tracker.default_install.command, /install-git-code-tracker\.mjs/);
  assert.match(outputAssets, /release asset/i);
  assert.match(outputAssets, /copied skill.*install\.js/i);
  assert.match(outputAssets, /http:\/\/7\.213\.196\.158:8088\/v1\/records/);
  assert.match(outputAssets, /pre-commit.*post-commit.*pre-push.*post-rewrite/is);
  assert.match(outputAssets, /AI modification|AI source|修改来源/i);
  assert.match(outputAssets, /upload-outbox\.json/);
  assert.match(readme, /release asset/i);
  assert.match(readme, /copied skill.*install\.js/i);
  assert.match(readme, /http:\/\/7\.213\.196\.158:8088\/v1\/records/);
  assert.match(readme, /git push/i);
  assert.match(readme, /upload-outbox\.json/);
  const packageDir = path.join(rootDir, "skill", "packages", "git-code-tracker");
  assert.deepEqual(
    (await readdir(packageDir)).sort(),
    ["ai-commit-statistic-skill-v1.0.7.zip"],
  );
});

test("core instructions recognize codeagent-cli platform evidence", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");

  for (const content of [skill, outputAssets]) {
    assert.match(content, /codeagent-cli/i);
    assert.match(content, /\bcac\b/i);
    assert.match(content, /\.cac\//);
  }
});

test("gitpush verifies required remotes before creating a commit", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "bundled-skills", "gitpush", "skill", "SKILL.md"), "utf8");

  assert.match(skill, /fork/i);
  assert.ok(skill.indexOf("git remote get-url origin") < skill.indexOf('git commit -S -m "提交信息"'));
  assert.ok(skill.indexOf("git remote get-url upstream") < skill.indexOf('git commit -S -m "提交信息"'));
});

test("gitpush creates signed commits and helps users enable signing when -S fails", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "bundled-skills", "gitpush", "skill", "SKILL.md"), "utf8");

  assert.match(skill, /git commit -S -m "提交信息"/);
  assert.doesNotMatch(skill, /git commit -m "提交信息"/);
  assert.match(skill, /Do not retry without `-S`/);
  assert.match(skill, /do not fall back to an unsigned commit/i);
  assert.match(skill, /git config --global commit\.gpgsign true/);
  assert.match(skill, /git config --global gpg\.format ssh/);
  assert.match(skill, /git config --global user\.signingkey/);
});

test("gitpush auto-configures SSH signing when a usable ~/.ssh key exists", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "bundled-skills", "gitpush", "skill", "SKILL.md"), "utf8");

  assert.match(skill, /Bootstrap commit signing before committing/);
  assert.match(skill, /git config --get commit\.gpgsign/);
  assert.match(skill, /git config --get gpg\.format/);
  assert.match(skill, /git config --get user\.signingkey/);
  assert.match(skill, /~\/\.ssh\/id_ed25519\.pub/);
  assert.match(skill, /~\/\.ssh\/id_ecdsa\.pub/);
  assert.match(skill, /~\/\.ssh\/id_rsa\.pub/);
  assert.match(skill, /same basename private key/);
  assert.match(skill, /git config --global gpg\.format ssh/);
  assert.match(skill, /git config --global user\.signingkey SSH_PUBLIC_KEY_PATH/);
  assert.match(skill, /GitHub Settings > SSH and GPG keys/);
});

test("gittag runs gitsync before local tag creation and pushes tags to both remotes", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "bundled-skills", "gittag", "skill", "SKILL.md"), "utf8");
  const overlay = await readFile(
    path.join(rootDir, "skill", "bundled-skills", "gittag", "overlays", "codex", "agents", "openai.yaml"),
    "utf8",
  );
  const manifest = JSON.parse(await readFile(path.join(rootDir, "skill", "bundled-skills.json"), "utf8"));
  const entry = manifest.bundled_skills.find((candidate) => candidate.name === "gittag");

  assert.ok(entry, "expected gittag to be registered in bundled-skills.json");
  assert.match(skill, /REQUIRED SUB-SKILL: Use gitsync/i);
  assert.ok(skill.indexOf("gitsync") < skill.indexOf("git tag -a TAG_NAME"));
  assert.ok(skill.indexOf("git remote get-url origin") < skill.indexOf("git tag -a TAG_NAME"));
  assert.ok(skill.indexOf("git remote get-url upstream") < skill.indexOf("git tag -a TAG_NAME"));
  assert.match(skill, /git push origin TAG_NAME/);
  assert.match(skill, /git push upstream TAG_NAME/);
  assert.match(skill, /git ls-remote --tags origin/);
  assert.match(skill, /git ls-remote --tags upstream/);
  assert.match(overlay, /display_name: "GitTag"/);
});

test("core skill instructions define activation preflight as a hard gate", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /## Activation Preflight/);
  assert.match(skill, /Before scanning, interviewing, generating files, or answering onboarding conclusions/i);
  assert.match(skill, /inspect `external-packages\.json`, `bundled-skills\.json`, and `bundled-packages\.json`/i);
  assert.match(skill, /Do not continue with onboarding until every applicable item/i);
  assert.match(skill, /installed and verified, already available, platform-inapplicable, or resolved under the applicable approval-gated policy/i);
  assert.match(skill, /declines.*install_prompt_history/is);
});

test("activation preflight separates manifest inspection from repository evidence based applicability", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /Resolve `knowledge_asset_write_mode` before the Activation Preflight/i);
  assert.match(skill, /inspect `external-packages\.json`, `bundled-skills\.json`, and `bundled-packages\.json`/i);
  assert.match(skill, /After the target root is known, perform a minimal platform-evidence scan/i);
  assert.match(skill, /Do not continue with onboarding until every applicable item/i);
});

test("activation preflight falls back from project evidence to runtime and approved user-level evidence", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /If target-root platform evidence is absent or ambiguous/i);
  assert.match(skill, /current agent runtime/i);
  assert.match(skill, /visible skills/i);
  assert.match(skill, /Ask the owner before inspecting user-level agent configuration/i);
  assert.match(skill, /\$CODEX_HOME/i);
  assert.match(skill, /personal\/global directories/i);
  assert.match(skill, /multiple platform candidates/i);
  assert.match(skill, /ask the owner to choose/i);
});

test("external plugins include OpenCLI for browser automation", async () => {
  const configPath = path.join(process.cwd(), "skill", "external-packages.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const opencli = config.recommended_external_plugins.find((plugin) => plugin.name === "opencli");

  assert.ok(opencli, "expected OpenCLI recommendation");
  assert.equal(opencli.display_name, "OpenCLI");
  assert.match(opencli.purpose, /website|browser|web/i);
  assert.match(opencli.use_when, /default/i);
  assert.equal(opencli.default_recommendation.requires_network, true);
  assertModeAwareItemApproval(opencli.default_recommendation);
  assert.deepEqual(opencli.default_recommendation.safety_level_by_mode, {
    "ask-each-change": "ask-first",
    "agent-approve": "ask-first",
    "full-access": "autonomous",
  });
  assert.match(opencli.default_recommendation.recommend_by_default_when, /supported platform/i);

  const supportedPlatforms = ["codex", "claude", "codeagent-cli", "opencode"];
  assert.deepEqual(opencli.platforms.map((platform) => platform.platform).sort(), supportedPlatforms.sort());

  for (const platform of opencli.platforms) {
    assert.match(platform.install_action, /npm install -g @jackwener\/opencli/);
    assert.match(platform.install_action, /npx skills add jackwener\/opencli/);
    assert.match(platform.install_action, /Browser Bridge/i);
    assert.match(platform.install_action, /do not install.*automatically/i);
    assert.ok(platform.detection_evidence.some((entry) => /opencli --version|OpenCLI skills/i.test(entry)));
    assert.match(platform.verification, /opencli --version/);
    assert.match(platform.verification, /skills/i);
  }
});

test("external plugins include DevEco CLI for HarmonyOS projects", async () => {
  const configPath = path.join(process.cwd(), "skill", "external-packages.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const deveco = config.recommended_external_plugins.find((plugin) => plugin.name === "deveco-cli");

  assert.ok(deveco, "expected DevEco CLI recommendation");
  assert.match(deveco.display_name, /DevEco CLI/);
  assert.match(deveco.purpose, /HarmonyOS/);
  assert.match(deveco.use_when, /HarmonyOS|OpenHarmony|ArkUI|ArkTS/);
  assert.match(deveco.use_when, /DevEco Toolbox|deveco-toolbox|@deveco-codegenie\/mcp/);
  assert.equal(deveco.default_recommendation.requires_network, true);
  assertModeAwareItemApproval(deveco.default_recommendation);
  assert.deepEqual(deveco.default_recommendation.safety_level_by_mode, {
    "ask-each-change": "ask-first",
    "agent-approve": "ask-first",
    "full-access": "autonomous",
  });
  assert.match(deveco.default_recommendation.recommend_by_default_when, /HarmonyOS/i);
  assert.match(deveco.default_recommendation.recommend_by_default_when, /DevEco Toolbox|@deveco-codegenie\/mcp/);
  assert.ok(deveco.platforms.some((platform) => /npm install -g @deveco\/deveco-cli@latest/.test(platform.install_action)));
  assert.ok(deveco.platforms.some((platform) => platform.detection_evidence.some((entry) => /oh-package\.json5/.test(entry))));
  assert.ok(deveco.platforms.some((platform) => platform.detection_evidence.some((entry) => /build-profile\.json5/.test(entry))));
  assert.ok(deveco.platforms.some((platform) => platform.detection_evidence.some((entry) => /module\.json5/.test(entry))));
  assert.ok(deveco.platforms.some((platform) => platform.detection_evidence.some((entry) => /DevEco Toolbox|deveco-toolbox|@deveco-codegenie\/mcp/.test(entry))));
  assert.ok(deveco.platforms.some((platform) => platform.verification.includes("devecocli --version")));
});

test("external plugins do not default to archived DevEco Toolbox", async () => {
  const configPath = path.join(process.cwd(), "skill", "external-packages.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(
    config.recommended_external_plugins.some((plugin) => /deveco-toolbox|DevEco Toolbox/i.test(`${plugin.name} ${plugin.display_name}`)),
    false
  );
});

test("Agent Seed documents recurring prompts for required integrations", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const prompt = await readFile(path.join(rootDir, "skill", "agents", "openai.yaml"), "utf8");

  assert.match(skill, /git-code-tracker/i);
  assert.match(skill, /OpenCLI/i);
  assert.match(skill, /ask-each-change.*agent-approve.*every activation/is);
  assert.match(skill, /record.*reason.*continue/i);
  assert.match(skill, /must not suppress.*future.*prompt/i);
  assert.match(skill, /full-access.*install.*verify/is);
  assert.match(skill, /install_prompt_history/);
  assert.match(skill, /\.agents\/agent-seed\.json/);
  assert.match(prompt, /ask-each-change.*agent-approve.*every activation/i);
  assert.match(prompt, /full-access.*install.*verify/i);
  assert.match(prompt, /git-code-tracker/i);
  assert.match(prompt, /OpenCLI/i);
  assert.match(prompt, /knowledge_distillation/);
  assert.match(prompt, /full.*distillation.*interviews.*bypass/i);
  assert.match(prompt, /complete.*AGENTS\.md.*absent|AGENTS\.md.*absent.*complete/is);
});

test("Codex default prompt makes bundled package installs mode aware", async () => {
  const promptPath = path.join(process.cwd(), "skill", "agents", "openai.yaml");
  const prompt = await readFile(promptPath, "utf8");

  assert.match(prompt, /bundled-packages\.json/);
  assert.match(prompt, /full-access.*install.*verify.*without approval/i);
  assert.match(prompt, /ask-each-change.*agent-approve.*approval/i);
});

test("Agent Seed resolves full-access before installing applicable defaults", async () => {
  const rootDir = process.cwd();
  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  const prompt = await readFile(path.join(rootDir, "skill", "agents", "openai.yaml"), "utf8");

  assert.match(skill, /resolve `knowledge_asset_write_mode` before the Activation Preflight/i);
  assert.match(skill, /ask the owner to choose.*recommend `full-access`.*persist the selected mode/is);
  assert.match(skill, /full-access.*install.*without.*approval/is);
  assert.match(skill, /network.*personal.*global.*without.*approval/is);
  assert.match(skill, /manifest-declared.*side effects.*hooks/is);
  assert.match(skill, /Superpowers.*OpenCLI.*required/is);
  assert.match(skill, /install.*verification.*failure.*block.*onboarding/is);
  assert.match(skill, /interactive.*manual.*stop.*onboarding/is);
  assert.match(skill, /standalone hook.*secrets.*production.*destructive/is);
  assert.match(skill, /ask-each-change.*agent-approve.*ask/is);
  assert.match(skill, /managed_target_policy.*replace-and-verify/is);
  assert.match(skill, /full-access.*managed.*batch.*approval-gated/is);
  assert.match(skill, /approval_gated.*ask-before-write/is);

  assert.match(prompt, /resolve.*knowledge_asset_write_mode.*before.*preflight/i);
  assert.match(prompt, /ask me to choose a mode.*recommend full-access.*persist the selected mode/i);
  assert.match(prompt, /full-access.*install.*verify.*without approval/i);
  assert.match(prompt, /Superpowers.*OpenCLI/i);
  assert.match(prompt, /failure.*block onboarding/i);
});

test("skill identity uses Agent Seed naming", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const promptPath = path.join(process.cwd(), "skill", "agents", "openai.yaml");
  const skill = await readFile(skillPath, "utf8");
  const prompt = await readFile(promptPath, "utf8");

  assert.match(skill, /^name: agent-seed$/m);
  assert.match(skill, /^# Agent Seed$/m);
  assert.match(prompt, /display_name: "Agent Seed"/);
  assert.match(prompt, /\$agent-seed/);
});

test("core skill instructions require mode-aware cross-platform default package installs", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /Every onboarding run/i);
  assert.match(skill, /bundled-packages\.json/);
  assert.match(skill, /default_install\.offer_by_default/);
  assert.match(skill, /Codex, Claude Code, OpenCode/);
  assert.match(skill, /In `full-access`, install and verify every missing applicable default/is);
  assert.match(skill, /In `ask-each-change` and `agent-approve`, ask for approval before installing/is);
});

test("knowledge asset write mode is persistent and documented across write workflows", async () => {
  const rootDir = process.cwd();
  const files = [
    path.join(rootDir, "skill", "SKILL.md"),
    path.join(rootDir, "skill", "references", "output-assets.md"),
    path.join(rootDir, "skill", "references", "update-existing-assets.md"),
  ];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    assert.match(content, /\.agents\/agent-seed\.json/, path.relative(rootDir, filePath));
    assert.match(content, /knowledge_asset_write_mode/, path.relative(rootDir, filePath));
    assert.match(content, /ask-each-change/, path.relative(rootDir, filePath));
    assert.match(content, /agent-approve/, path.relative(rootDir, filePath));
    assert.match(content, /full-access/, path.relative(rootDir, filePath));
    assert.doesNotMatch(content, /missing[^.]*default to `full-access`|default to `full-access`[^.]*missing/is, path.relative(rootDir, filePath));
  }

  const skill = await readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8");
  assert.match(skill, /ask the owner to choose.*recommend `full-access`/is);
  assert.match(skill, /current user request wins/i);
});

test("full-access install policy is consistent across public and internal guidance", async () => {
  const rootDir = process.cwd();
  const readme = await readFile(path.join(rootDir, "README.md"), "utf8");
  const outputAssets = await readFile(path.join(rootDir, "skill", "references", "output-assets.md"), "utf8");
  const updateExisting = await readFile(path.join(rootDir, "skill", "references", "update-existing-assets.md"), "utf8");
  const knowledgeDistillation = await readFile(path.join(rootDir, "skill", "references", "knowledge-distillation.md"), "utf8");
  const dryRun = await readFile(path.join(rootDir, "skill", "references", "fresh-agent-dry-run.md"), "utf8");

  for (const [name, content] of Object.entries({ readme, outputAssets, updateExisting })) {
    assert.match(content, /full-access.*install.*without.*approval/is, name);
    assert.match(content, /network.*personal.*global/is, name);
    assert.match(content, /declared.*side effects.*hooks/is, name);
    assert.match(content, /standalone\s+hook.*secrets.*production.*destructive/is, name);
  }

  assert.match(knowledgeDistillation, /approval.*mode/i);
  assert.match(knowledgeDistillation, /full-access.*autonomous/is);
  assert.match(dryRun, /resolved.*mode/i);
  assert.match(dryRun, /full-access.*install.*verify/is);
  assert.match(dryRun, /failure.*block.*onboarding/is);
});

test("local Agent Seed config is ignored by Git", async () => {
  const gitignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");

  assert.match(gitignore, /^\.agents\/agent-seed\.local\.json$/m);
  assert.match(gitignore, /^\.agents\/agent-seed\.json$/m);
  assert.match(gitignore, /^\.agents\/managed-skills\.json$/m);
  assert.match(gitignore, /^\.agents\/ticket-lookup\.local\.json$/m);
});

test("external plugin prose stays configuration driven", async () => {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill", "external-packages.json");
  const skillPath = path.join(rootDir, "skill", "SKILL.md");
  const frameworkPackPaths = new Set([
    path.normalize(path.join(rootDir, "skill", "references", "frameworks", "nuwa.md")),
    path.normalize(path.join(rootDir, "skill", "references", "frameworks", "harmonyos.md")),
  ]);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const pluginTerms = config.recommended_external_plugins.flatMap((plugin) => [plugin.name, plugin.display_name]);
  const vendoredPackageDir = path.normalize(path.join(rootDir, "skill", "packages"));
  const files = [path.join(rootDir, "README.md"), ...(await markdownFiles(path.join(rootDir, "skill")))]
    .filter((filePath) => ![configPath, skillPath].map((allowedPath) => path.normalize(allowedPath)).includes(path.normalize(filePath)))
    .filter((filePath) => !frameworkPackPaths.has(path.normalize(filePath)))
    .filter((filePath) => !path.normalize(filePath).startsWith(vendoredPackageDir + path.sep));

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const term of pluginTerms) {
      assert.equal(
        content.toLowerCase().includes(term.toLowerCase()),
        false,
        `${path.relative(rootDir, filePath)} hardcodes external plugin term "${term}"`
      );
    }
  }
});

test("core skill instructions define mode-aware Superpowers SDD installation", async () => {
  const skillPath = path.join(process.cwd(), "skill", "SKILL.md");
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /Superpowers/i);
  assert.match(skill, /external-packages\.json/);
  assert.match(skill, /not visible/i);
  assert.match(skill, /When Superpowers is missing.*`full-access`.*install and verify.*required preflight integration/is);
  assert.match(skill, /In `ask-each-change` or `agent-approve`, recommend.*approval/is);
  assert.match(skill, /superpowers:brainstorming/);
  assert.match(skill, /superpowers:writing-plans/);
  assert.match(skill, /superpowers:subagent-driven-development/);
  assert.match(skill, /superpowers:executing-plans/);
  assert.match(skill, /superpowers:test-driven-development/);
  assert.match(skill, /superpowers:systematic-debugging/);
  assert.match(skill, /superpowers:verification-before-completion/);
  assert.match(skill, /superpowers:requesting-code-review/);
  assert.match(skill, /superpowers:receiving-code-review/);
});

test("core skill instructions document version metadata and self update flow", async () => {
  const skill = await readFile(path.join(process.cwd(), "skill", "SKILL.md"), "utf8");

  assert.match(skill, /VERSION\.json/);
  assert.match(skill, /scripts\/update-agent-seed\.mjs/);
  assert.match(skill, /--apply/);
  assert.match(skill, /GitHub latest release/i);
  assert.match(skill, /self-update preflight/i);
  assert.match(skill, /network-denied/i);
  assert.match(skill, /deferred/i);
  assert.match(skill, /\.agents\/agent-seed\.json/);
});

test("activation policy documents cached update checks and explicit apply", async () => {
  const skill = await readFile(path.join(process.cwd(), "skill", "SKILL.md"), "utf8");

  assert.match(skill, /check_interval_hours.*24/is);
  assert.match(skill, /--force-check/);
  assert.match(skill, /update_mode.*notify/is);
  assert.match(skill, /Never run `--apply` without owner approval/);
});

test("core skill instructions document deferred Windows self updates", async () => {
  const rootDir = process.cwd();
  const documents = await Promise.all([
    readFile(path.join(rootDir, "skill", "SKILL.md"), "utf8"),
    readFile(path.join(rootDir, "README.md"), "utf8"),
  ]);

  for (const document of documents) {
    assert.match(document, /queued/i);
    assert.match(document, /windows-directory-locked/i);
    assert.match(document, /(?:automatically completes|completes automatically) after the agent host exits and releases the (?:directory )?lock/i);
    assert.match(document, /terminal `failed` state (?:requires another `--apply` command|needs a new `--apply` command)/i);
    assert.match(document, /notification/i);
  }
});

test("framework knowledge config registers valid built-in knowledge packs", async () => {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill", "framework-knowledge.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));

  assert.ok(Array.isArray(config.framework_knowledge));
  assert.ok(config.framework_knowledge.length > 0);

  const nuwa = config.framework_knowledge.find((entry) => entry.name === "nuwa");
  assert.ok(nuwa, "expected Nuwa framework knowledge entry");
  assert.equal(nuwa.knowledge_path, "references/frameworks/nuwa.md");
  const harmonyos = config.framework_knowledge.find((entry) => entry.name === "harmonyos");
  assert.ok(harmonyos, "expected HarmonyOS framework knowledge entry");
  assert.equal(harmonyos.knowledge_path, "references/frameworks/harmonyos.md");

  for (const entry of config.framework_knowledge) {
    assert.equal(typeof entry.name, "string");
    assert.notEqual(entry.name.trim(), "");
    assert.equal(typeof entry.display_name, "string");
    assert.notEqual(entry.display_name.trim(), "");
    assert.ok(Array.isArray(entry.aliases));
    assert.ok(entry.aliases.length > 0);
    assert.ok(entry.aliases.every((alias) => typeof alias === "string" && alias.trim() !== ""));

    assert.ok(Array.isArray(entry.fingerprints.search_terms));
    assert.ok(entry.fingerprints.search_terms.length > 0);
    assert.ok(entry.fingerprints.search_terms.every((term) => typeof term === "string" && term.trim() !== ""));

    assert.ok(Array.isArray(entry.fingerprints.file_patterns));
    assert.ok(entry.fingerprints.file_patterns.length > 0);
    assert.ok(entry.fingerprints.file_patterns.every((pattern) => typeof pattern === "string" && pattern.trim() !== ""));

    assert.equal(typeof entry.knowledge_path, "string");
    assert.match(entry.knowledge_path, /^references\/frameworks\/.+\.md$/);
    await stat(path.join(rootDir, "skill", entry.knowledge_path));

    assert.ok(Array.isArray(entry.project_local.registry_paths));
    assert.ok(entry.project_local.registry_paths.length > 0);
    assert.ok(Array.isArray(entry.project_local.knowledge_paths));
    assert.ok(entry.project_local.knowledge_paths.length > 0);

    assert.ok(Array.isArray(entry.source_policy.labels));
    assert.deepEqual(entry.source_policy.labels, [
      "Preset",
      "Repo-confirmed",
      "Owner-confirmed",
      "Inferred",
      "Unknown",
    ]);
    assert.equal(entry.source_policy.preset_may_confirm_project_facts, false);
    assert.equal(entry.safety.stay_inside_target_root, true);
    assert.equal(entry.safety.external_sdk_inspection_requires_user_request, true);
  }
});

test("framework-specific prose stays in framework knowledge packs", async () => {
  const rootDir = process.cwd();
  const allowedFiles = new Set([
    path.normalize(path.join(rootDir, "skill", "framework-knowledge.json")),
    path.normalize(path.join(rootDir, "skill", "references", "frameworks", "nuwa.md")),
    path.normalize(path.join(rootDir, "skill", "references", "frameworks", "harmonyos.md")),
    path.normalize(path.join(rootDir, "skill", "references", "framework-fingerprints.md")),
    path.normalize(path.join(rootDir, "README.md")),
  ]);
  const files = [path.join(rootDir, "README.md"), ...(await markdownFiles(path.join(rootDir, "skill")))].filter(
    (filePath) => !allowedFiles.has(path.normalize(filePath))
  );

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    assert.equal(
      /\bNuwa\b/i.test(content),
      false,
      `${path.relative(rootDir, filePath)} hardcodes Nuwa prose outside framework knowledge routing`
    );
  }
});

test("HarmonyOS framework knowledge includes DevEco CLI tooling guidance", async () => {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill", "framework-knowledge.json");
  const harmonyosPath = path.join(rootDir, "skill", "references", "frameworks", "harmonyos.md");
  const config = await readFile(configPath, "utf8");
  const harmonyos = await readFile(harmonyosPath, "utf8");

  assert.match(config, /devecocli/);
  assert.match(config, /DevEco CLI/);
  assert.match(harmonyos, /DevEco CLI/);
  assert.match(harmonyos, /@deveco\/deveco-cli@latest/);
  assert.match(harmonyos, /Node\.js >= 18/);
  assert.match(harmonyos, /DevEco Studio >= 6\.1\.0/);
  assert.match(harmonyos, /devecocli build/);
  assert.match(harmonyos, /devecocli run/);
  assert.match(harmonyos, /devecocli device list/);
  assert.match(harmonyos, /devecocli emulator list/);
  assert.match(harmonyos, /devecocli log/);
  assert.match(harmonyos, /devecocli docs search/);
  assert.match(harmonyos, /devecocli docs read/);
  assert.match(harmonyos, /devecocli init --mcp/);
  assert.match(harmonyos, /devecocli serve mcp/);
  assert.match(harmonyos, /devecocli skills list/);
  assert.match(harmonyos, /full-access.*install.*without.*approval/is);
  assert.match(harmonyos, /ask-each-change.*agent-approve.*approval/is);
  assert.match(harmonyos, /updates.*devices.*emulators.*owner approval/is);
  assert.match(harmonyos, /Preset/);
});

test("HarmonyOS framework knowledge treats DevEco Toolbox as archived fallback tooling", async () => {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill", "framework-knowledge.json");
  const harmonyosPath = path.join(rootDir, "skill", "references", "frameworks", "harmonyos.md");
  const config = await readFile(configPath, "utf8");
  const harmonyos = await readFile(harmonyosPath, "utf8");

  assert.match(config, /deveco-toolbox/);
  assert.match(config, /@deveco-codegenie\/mcp/);
  assert.match(harmonyos, /DevEco Toolbox/);
  assert.match(harmonyos, /archived/i);
  assert.match(harmonyos, /not recommend/i);
  assert.match(harmonyos, /recommend DevEco CLI/i);
  assert.match(harmonyos, /DevEco CLI/);
  assert.match(harmonyos, /deveco-mcp-server/);
  assert.match(harmonyos, /@deveco-codegenie\/mcp@beta/);
  assert.match(harmonyos, /DEVECO_PATH/);
  assert.match(harmonyos, /ask first/i);
});

test("Nuwa framework knowledge stays independent from HarmonyOS tooling", async () => {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill", "framework-knowledge.json");
  const nuwaPath = path.join(rootDir, "skill", "references", "frameworks", "nuwa.md");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const nuwa = config.framework_knowledge.find((entry) => entry.name === "nuwa");
  const nuwaMarkdown = await readFile(nuwaPath, "utf8");
  const nuwaTerms = [...nuwa.aliases, ...nuwa.fingerprints.search_terms, ...nuwa.fingerprints.file_patterns].join("\n");

  assert.doesNotMatch(nuwaTerms, /harmony|openharmony|arkui|arkts|devecocli|deveco|oh-package|build-profile|hvigor|ohpm|hdc|hilog|module\.json5|app\.json5/i);
  assert.doesNotMatch(nuwaMarkdown, /DevEco CLI|devecocli|@deveco\/deveco-cli|oh-package|build-profile|hvigor|ohpm|hdc|hilog/i);
});

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(entryPath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}
