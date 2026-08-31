import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readAgentSeedFiles, writeLocalAgentSeedState } from "./agent-seed-config.mjs";
import { installGitCodeTracker } from "./install-git-code-tracker.mjs";

const STATE_DIRECTORY = ".agents";
const STATE_FILE = "managed-skills.json";
const MANAGED_METADATA_FILE = ".agent-seed-managed.json";
const MIGRATABLE_STATE_KEYS = new Set([
  "schema_version",
  "managed_skills",
  "external_integrations",
  "declined_install_offers",
]);
const EMPTY_STATE = Object.freeze({
  schema_version: 2,
  managed_skills: [],
  external_integrations: [],
  declined_install_offers: [],
});
const ACTIONABLE_MANAGED_STATES = new Set([
  "update-available",
  "install-available",
  "missing",
  "unverified",
  "legacy-unmanaged",
  "partial",
]);
const EXISTING_TARGET_STATES = new Set(["update-available", "unverified", "legacy-unmanaged", "partial"]);
const POST_INSTALL_ACTIONS = new Set([
  "ensure-agent-seed-updater-startup-rule",
  "ensure-knowledge-updater-completion-rule",
]);
const STARTUP_RULE_MARKER = "agent-seed:agent-seed-updater";
const KNOWLEDGE_RULE_MARKER = "agent-seed:knowledge-updater";
const DEFAULT_MANAGED_TARGET_POLICY = Object.freeze({
  full_access: "ask-before-write",
  approval_gated: "ask-before-write",
  personal_or_global_target_requires_explicit_request: true,
});

export async function readManagedState(targetDir) {
  const statePath = path.join(path.resolve(targetDir), STATE_DIRECTORY, STATE_FILE);
  let shared;
  try {
    const raw = JSON.parse(await readFile(statePath, "utf8"));
    assertSupportedManagedState(raw, statePath);
    shared = normalizeState(raw, statePath);
  } catch (error) {
    if (error.code === "ENOENT") shared = structuredClone(EMPTY_STATE);
    else throw error;
  }
  const local = (await readAgentSeedFiles(targetDir)).local.managed_skills || {};
  return {
    ...shared,
    declined_install_offers: deduplicate([
      ...shared.declined_install_offers,
      ...(Array.isArray(local.declined_install_offers) ? local.declined_install_offers : []),
    ]),
    installed_external_integrations: Array.isArray(local.external_integrations)
      ? local.external_integrations
      : [],
  };
}

export async function writeManagedState(targetDir, state) {
  const statePath = path.join(path.resolve(targetDir), STATE_DIRECTORY, STATE_FILE);
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const normalizedState = normalizeState(state, statePath);
  const sharedState = {
    schema_version: 2,
    managed_skills: normalizedState.managed_skills,
    external_integrations: normalizedState.external_integrations,
  };
  await mkdir(path.dirname(statePath), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(sharedState, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  } finally {
    await rm(tempPath, { force: true });
  }
  return sharedState;
}

export async function migrateManagedState(targetDir) {
  const statePath = path.join(path.resolve(targetDir), STATE_DIRECTORY, STATE_FILE);
  let raw;
  try {
    raw = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { status: "current" };
    throw error;
  }
  assertSupportedManagedState(raw, statePath);
  const state = normalizeState(raw, statePath);
  const isLegacyState = raw.schema_version === 1 || Object.hasOwn(raw, "declined_install_offers");
  if (!isLegacyState) {
    return { status: "current" };
  }
  const files = await readAgentSeedFiles(targetDir);
  const currentLocal = files.local.managed_skills || {};
  await writeLocalAgentSeedState({
    targetDir,
    patch: {
      managed_skills: {
        ...currentLocal,
        declined_install_offers: deduplicate([
          ...(Array.isArray(currentLocal.declined_install_offers) ? currentLocal.declined_install_offers : []),
          ...state.declined_install_offers,
        ]),
        external_integrations: deduplicate([
          ...(Array.isArray(currentLocal.external_integrations) ? currentLocal.external_integrations : []),
          ...state.external_integrations,
        ]),
      },
    },
  });
  await writeManagedState(targetDir, state);
  return { status: "migrated" };
}

async function writeLocalManagedState(targetDir, patch) {
  const state = await readManagedState(targetDir);
  const local = {
    declined_install_offers: state.declined_install_offers,
    external_integrations: state.installed_external_integrations,
    ...patch,
  };
  return writeLocalAgentSeedState({
    targetDir,
    patch: { managed_skills: local },
  });
}

function deduplicate(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function inspectManagedUpdates({ skillRoot, targetDir, platform }) {
  const resolvedTargetDir = path.resolve(targetDir);
  const entries = await readManagedEntries(skillRoot, platform);
  const state = await readManagedState(resolvedTargetDir);
  const managed = [];

  for (const entry of entries) {
    const record = state.managed_skills.find((candidate) => candidate.name === entry.name && candidate.platform === platform);
    const targetPath = resolveInside(resolvedTargetDir, entry.target_path, `${entry.name} target path`);
    const targetExists = await pathExists(targetPath);
    const installed = targetExists ? await readManagedMetadata(targetPath) : null;
    const installedMatches = isMatchingManagedMetadata(installed, entry, platform);
    const contentCurrent = installedMatches && hasManagedContentDigest(installed)
      ? await managedContentMatches(targetPath, installed.content_sha256)
      : false;
    const postInstallCurrent = targetExists && installedMatches && contentCurrent
      ? await isPostInstallSatisfied({ targetDir: resolvedTargetDir, platform, postInstall: entry.post_install })
      : false;
    const decline = state.declined_install_offers.find((candidate) =>
      candidate.name === entry.name
      && candidate.kind === entry.kind
      && candidate.platform === platform
      && compareVersions(candidate.offered_version, entry.version) === 0
    );
    if (!record && !targetExists && !entry.offer_by_default) continue;

    const manifestBelowBaseline = record && compareVersions(record.version, entry.version) > 0;
    const status = record
      ? manifestBelowBaseline
        && (!installedMatches || compareVersions(installed.version, record.version) < 0)
          ? "baseline-unavailable"
          : !targetExists
            ? "missing"
            : !installedMatches
              ? "unverified"
              : !hasManagedContentDigest(installed)
                ? "unverified"
                : !contentCurrent
                  ? "modified"
              : compareVersions(installed.version, entry.version) < 0
                || compareVersions(installed.version, record.version) < 0
                ? "update-available"
                : !postInstallCurrent
                  ? "partial"
                : "current"
      : targetExists
        ? "legacy-unmanaged"
        : decline
          ? "declined-current-version"
          : "install-available";
    managed.push({
      name: entry.name,
      kind: entry.kind,
      platform,
      target_path: entry.target_path,
      installed_version: installed?.version ?? null,
      available_version: entry.version,
      state: status,
      required: entry.required,
      ...(status === "baseline-unavailable" ? { required_version: record.version } : {}),
    });
  }

  for (const record of state.managed_skills.filter((candidate) =>
    candidate.platform === platform
    && !entries.some((entry) => entry.name === candidate.name)
  )) {
    const targetPath = resolveInside(resolvedTargetDir, record.target_path, `${record.name} target path`);
    const targetExists = await pathExists(targetPath);
    const installed = targetExists ? await readManagedMetadata(targetPath) : null;
    const installedSatisfiesBaseline = isMatchingManagedMetadata(installed, record, platform)
      && compareVersions(installed.version, record.version) >= 0;
    managed.push({
      name: record.name,
      kind: record.kind,
      platform,
      target_path: record.target_path,
      installed_version: installed?.version ?? null,
      available_version: null,
      required_version: record.version,
      state: installedSatisfiesBaseline ? "current" : "baseline-unavailable",
    });
  }

  const desiredExternal = state.external_integrations.filter((entry) => entry.platform === platform);
  const actualExternal = state.installed_external_integrations.filter((entry) => entry.platform === platform);
  const external = desiredExternal.map((entry) => {
    const actual = actualExternal.find((candidate) => candidate.name === entry.name);
    return {
      ...entry,
      state: getExternalIntegrationState(entry, actual),
    };
  });
  for (const actual of actualExternal) {
    if (!desiredExternal.some((entry) => entry.name === actual.name)) {
      external.push({ ...actual, state: "legacy-unmanaged" });
    }
  }

  return { managed, external };
}

export async function applyManagedUpdate({ skillRoot, targetDir, name, platform, approved, installPackage }) {
  if (approved !== true) {
    throw new Error("Owner approval is required to apply a managed update.");
  }

  const resolvedTargetDir = path.resolve(targetDir);
  const entry = (await readManagedEntries(skillRoot, platform)).find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`Unknown managed entry for ${platform}: ${name}`);
  }
  await assertNoManagedDowngrade({ entry, targetDir: resolvedTargetDir, platform });
  if (entry.kind === "package") {
    return applyPackageUpdate({ entry, targetDir: resolvedTargetDir, platform, installPackage });
  }

  const sourceDir = resolveInside(path.resolve(skillRoot), entry.source_path, `${name} source path`);
  const targetPath = resolveInside(resolvedTargetDir, entry.target_path, `${name} target path`);
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "agent-seed-managed-update-"));
  const stagedSkill = path.join(stagingRoot, "skill");
  const backupPath = `${targetPath}.agent-seed-backup-${Date.now()}`;
  const targetExisted = await pathExists(targetPath);
  let instructionBackup = null;

  try {
    if (entry.post_install) {
      instructionBackup = await backupWriteRoots(
        resolvedTargetDir,
        entry.post_install.instruction_files,
        path.join(stagingRoot, "instruction-backup"),
      );
    }
    await cp(sourceDir, stagedSkill, { recursive: true });
    if (entry.overlay_path) {
      await cp(resolveInside(path.resolve(skillRoot), entry.overlay_path, `${name} overlay path`), stagedSkill, { recursive: true });
    }
    await access(path.join(stagedSkill, "SKILL.md"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (targetExisted) {
      await rename(targetPath, backupPath);
    }
    await cp(stagedSkill, targetPath, { recursive: true });
    await access(path.join(targetPath, "SKILL.md"));
    await writeManagedMetadata(targetPath, {
      name: entry.name,
      kind: entry.kind,
      version: entry.version,
      platform,
      content_sha256: await calculateManagedContentDigest(targetPath),
    });
    await applyPostInstall({ targetDir: resolvedTargetDir, platform, postInstall: entry.post_install });
    if (!(await isPostInstallSatisfied({ targetDir: resolvedTargetDir, platform, postInstall: entry.post_install }))) {
      throw new Error(`Post-install verification failed: ${entry.name}`);
    }
    await recordManagedInstall(resolvedTargetDir, {
      name: entry.name,
      kind: entry.kind,
      version: entry.version,
      platform,
      target_path: entry.target_path,
      source: entry.source_path,
    });
    await rm(backupPath, { recursive: true, force: true });
    return { status: targetExisted ? "updated" : "installed", post_install: entry.post_install ?? null };
  } catch (error) {
    await rm(targetPath, { recursive: true, force: true });
    if (targetExisted && (await pathExists(backupPath))) {
      await rename(backupPath, targetPath);
    }
    if (instructionBackup) await restoreWriteRoots(resolvedTargetDir, instructionBackup);
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function applyManagedUpdates({
  skillRoot,
  targetDir,
  platform,
  approved,
  applyEntry = applyManagedUpdate,
  installPackage,
}) {
  if (approved !== true) {
    throw new Error("Owner approval is required to apply a managed update.");
  }

  const entries = await readManagedEntries(skillRoot, platform);
  const entryByKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.name}`, entry]));
  const report = await inspectManagedUpdates({ skillRoot, targetDir, platform });
  const results = [];
  let selected = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const inspected of report.managed) {
    const entry = entryByKey.get(`${inspected.kind}:${inspected.name}`);
    const selectable = ACTIONABLE_MANAGED_STATES.has(inspected.state)
      && entry
      && (entry.managed_target_policy.full_access === "replace-and-verify" || !EXISTING_TARGET_STATES.has(inspected.state));
    if (!selectable) {
      skipped += 1;
      results.push({
        name: inspected.name,
        kind: inspected.kind,
        state: inspected.state,
        result: "skipped",
      });
      continue;
    }

    selected += 1;
    try {
      const applied = await applyEntry({
        skillRoot,
        targetDir,
        name: inspected.name,
        platform,
        approved: true,
        installPackage,
      });
      const result = applied?.status === "installed" || applied?.status === "updated"
        ? applied.status
        : inspected.state === "install-available" || inspected.state === "missing"
          ? "installed"
          : "updated";
      const item = {
        name: inspected.name,
        kind: inspected.kind,
        state: inspected.state,
        result,
      };
      if (applied?.post_install) item.post_install = applied.post_install;
      results.push(item);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      results.push({
        name: inspected.name,
        kind: inspected.kind,
        state: inspected.state,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    results,
    summary: { selected, succeeded, failed, skipped },
  };
}

async function applyPackageUpdate({ entry, targetDir, platform, installPackage }) {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "agent-seed-managed-package-"));
  const backup = await backupWriteRoots(
    targetDir,
    [...entry.write_paths, ...(entry.post_install?.instruction_files || [])],
    stagingRoot,
  );
  const installer = installPackage || defaultPackageInstaller(entry.name);
  const installedTarget = resolveInside(targetDir, entry.target_path, `${entry.name} target path`);
  const targetExisted = await pathExists(installedTarget);

  try {
    await installer({ targetDir, platform });
    await access(path.join(installedTarget, "SKILL.md"));
    await writeManagedMetadata(installedTarget, {
      name: entry.name,
      kind: entry.kind,
      version: entry.version,
      platform,
      content_sha256: await calculateManagedContentDigest(installedTarget),
    });
    await applyPostInstall({ targetDir, platform, postInstall: entry.post_install });
    if (!(await isPostInstallSatisfied({ targetDir, platform, postInstall: entry.post_install }))) {
      throw new Error(`Post-install verification failed: ${entry.name}`);
    }
    await recordManagedInstall(targetDir, {
      name: entry.name,
      kind: entry.kind,
      version: entry.version,
      platform,
      target_path: entry.target_path,
      source: entry.source_path ?? entry.name,
    });
    return { status: targetExisted ? "updated" : "installed", post_install: entry.post_install ?? null };
  } catch (error) {
    await restoreWriteRoots(targetDir, backup);
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export function compareVersions(left, right) {
  const leftSegments = parseVersion(left);
  const rightSegments = parseVersion(right);
  for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index += 1) {
    const difference = (leftSegments[index] ?? 0) - (rightSegments[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export async function recordExternalIntegration({ targetDir, name, platform, ownership, version = "unknown" }) {
  if (![name, platform, ownership].every((value) => typeof value === "string" && value.trim() !== "")) {
    throw new Error("External integration name, platform, and ownership are required.");
  }
  const state = await readManagedState(targetDir);
  const record = { name, platform, ownership, version };
  const retained = state.external_integrations.filter((entry) => entry.name !== name || entry.platform !== platform);
  const existing = state.external_integrations.find((entry) => entry.name === name && entry.platform === platform);
  const desired = [...retained, preferHigherVersionRecord(existing, record)];
  await writeManagedState(targetDir, { ...state, external_integrations: desired });
  const retainedActual = state.installed_external_integrations.filter((entry) => entry.name !== name || entry.platform !== platform);
  await writeLocalManagedState(targetDir, { external_integrations: [...retainedActual, record] });
  return readManagedState(targetDir);
}

export async function recordInstallOfferDecline({ skillRoot, targetDir, name, platform, confirmed, now = new Date() }) {
  if (confirmed !== true) throw new Error("An explicit owner decline is required.");
  const entry = (await readManagedEntries(skillRoot, platform)).find((candidate) => candidate.name === name);
  if (!entry || !entry.offer_by_default) throw new Error(`Unknown default install offer for ${platform}: ${name}`);
  if (entry.required) throw new Error(`Required managed components cannot be declined: ${name}`);

  const state = await readManagedState(targetDir);
  const decline = {
    name: entry.name,
    kind: entry.kind,
    platform,
    offered_version: entry.version,
    declined_at: now.toISOString(),
  };
  const retained = state.declined_install_offers.filter((candidate) =>
    candidate.name !== entry.name || candidate.kind !== entry.kind || candidate.platform !== platform
  );
  await writeLocalManagedState(targetDir, { declined_install_offers: [...retained, decline] });
  return decline;
}

export async function applyExternalUpdate({ approved, nativeUpdate }) {
  if (approved !== true) throw new Error("Owner approval is required to update an external integration.");
  if (typeof nativeUpdate !== "function") throw new Error("A platform-native update action is required.");
  await nativeUpdate();
  return true;
}

async function readManagedEntries(skillRoot, platform) {
  const root = path.resolve(skillRoot);
  const [skillManifest, packageManifest] = await Promise.all([
    readJson(path.join(root, "bundled-skills.json")),
    readJson(path.join(root, "bundled-packages.json")),
  ]);
  const skillPolicy = normalizeManagedTargetPolicy(skillManifest, path.join(root, "bundled-skills.json"));
  const packagePolicy = normalizeManagedTargetPolicy(packageManifest, path.join(root, "bundled-packages.json"));
  const directSkills = (skillManifest.bundled_skills || []).flatMap((entry) => {
    const platformEntry = entry.platforms?.find((candidate) => candidate.platform === platform);
    return platformEntry ? [normalizeEntry(entry, platformEntry, "direct-skill", skillPolicy)] : [];
  });
  const packages = (packageManifest.bundled_packages || []).flatMap((entry) => {
    const platformEntry = entry.platform_skills?.find((candidate) => candidate.platform === platform);
    return platformEntry ? [normalizeEntry(entry, platformEntry, "package", packagePolicy)] : [];
  });
  return [...directSkills, ...packages];
}

function normalizeManagedTargetPolicy(manifest, manifestPath) {
  const raw = manifest?.activation_policy?.managed_target_policy;
  if (raw === undefined) return { ...DEFAULT_MANAGED_TARGET_POLICY };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid managed target policy: ${manifestPath}`);
  }
  if (!["replace-and-verify", "ask-before-write"].includes(raw.full_access)
      || raw.approval_gated !== "ask-before-write"
      || raw.personal_or_global_target_requires_explicit_request !== true) {
    throw new Error(`Invalid managed target policy: ${manifestPath}`);
  }
  return {
    full_access: raw.full_access,
    approval_gated: raw.approval_gated,
    personal_or_global_target_requires_explicit_request: raw.personal_or_global_target_requires_explicit_request,
  };
}

function normalizeEntry(entry, platformEntry, kind, managedTargetPolicy) {
  if (!entry || typeof entry.name !== "string" || entry.name.trim() === "") throw new Error("Managed manifest entry requires a name.");
  if (typeof entry.version !== "string" || entry.version.trim() === "") throw new Error(`Managed manifest entry requires a version: ${entry.name}`);
  if (!platformEntry || typeof platformEntry.target_path !== "string" || platformEntry.target_path.trim() === "") throw new Error(`Managed manifest entry requires a target path: ${entry.name}`);
  return {
    name: entry.name,
    version: entry.version,
    kind,
    target_path: platformEntry.target_path,
    source_path: entry.source_path,
    overlay_path: platformEntry.overlay_path,
    offer_by_default: entry.default_install?.offer_by_default === true,
    post_install: normalizePostInstall(entry.post_install, entry.name),
    required: entry.default_install?.required === true,
    write_paths: entry.default_install?.writes || [platformEntry.target_path],
    managed_target_policy: managedTargetPolicy,
  };
}

function normalizePostInstall(postInstall, name) {
  if (postInstall === undefined) return null;
  const approvalModes = postInstall?.requires_user_approval_in_modes;
  if (!postInstall || typeof postInstall !== "object" || Array.isArray(postInstall)
      || typeof postInstall.action !== "string" || !POST_INSTALL_ACTIONS.has(postInstall.action)
      || !Array.isArray(approvalModes)
      || approvalModes.some((mode) => typeof mode !== "string" || mode.trim() === "")
      || !Array.isArray(postInstall.instruction_files)) {
    throw new Error(`Invalid post-install action: ${name}`);
  }
  return {
    action: postInstall.action,
    requires_user_approval_in_modes: approvalModes,
    instruction_files: postInstall.instruction_files,
  };
}

async function applyPostInstall({ targetDir, platform, postInstall }) {
  if (!postInstall) return;
  const block = postInstall.action === "ensure-agent-seed-updater-startup-rule"
    ? {
        marker: STARTUP_RULE_MARKER,
        heading: "Agent Seed startup",
        text: "Before the first user task in each new agent conversation, invoke the installed `agent-seed-updater` exactly once. Let it check only Agent Seed and project-local managed components, report actionable results without blocking the requested task, and never start repository onboarding. If project knowledge is not initialized or the owner requests a full refresh, invoke the installed `project-distiller` separately.",
      }
    : {
        marker: KNOWLEDGE_RULE_MARKER,
        heading: "Knowledge maintenance",
        text: "After completing and verifying every task, invoke the installed `knowledge-updater` immediately before the final response. Let it use only current-conversation knowledge plus existing `AGENTS.md` and relevant `agents.d/` files, and append exactly one returned knowledge-asset status.",
      };
  await ensureInstructionBlock(path.join(targetDir, "AGENTS.md"), block);
  if (["claude", "codeagent-cli"].includes(platform)) {
    await ensureAgentsImport(path.join(targetDir, "CLAUDE.md"));
  }
}

async function isPostInstallSatisfied({ targetDir, platform, postInstall }) {
  if (!postInstall) return true;
  const marker = postInstall.action === "ensure-agent-seed-updater-startup-rule"
    ? STARTUP_RULE_MARKER
    : KNOWLEDGE_RULE_MARKER;
  const agents = await readTextIfExists(path.join(targetDir, "AGENTS.md"));
  if (!agents.includes(`<!-- ${marker} -->`)) return false;
  if (["claude", "codeagent-cli"].includes(platform)) {
    const claude = await readTextIfExists(path.join(targetDir, "CLAUDE.md"));
    if (!/^@AGENTS\.md\s*$/m.test(claude)) return false;
  }
  return true;
}

async function ensureInstructionBlock(filePath, { marker, heading, text }) {
  const existing = await readTextIfExists(filePath);
  if (existing.includes(`<!-- ${marker} -->`)) return false;
  const separator = existing.trim() === "" ? "" : "\n\n";
  const block = `<!-- ${marker} -->\n## ${heading}\n\n${text}\n<!-- /${marker} -->\n`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${existing.replace(/\s+$/, "")}${separator}${block}`, "utf8");
  return true;
}

async function ensureAgentsImport(filePath) {
  const existing = await readTextIfExists(filePath);
  if (/^@AGENTS\.md\s*$/m.test(existing)) return false;
  const separator = existing.trim() === "" ? "" : "\n\n";
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${existing.replace(/\s+$/, "")}${separator}@AGENTS.md\n`, "utf8");
  return true;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export async function calculateManagedContentDigest(targetPath) {
  const root = path.resolve(targetPath);
  const hash = createHash("sha256");

  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== MANAGED_METADATA_FILE)
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        hash.update(`D\0${relative}\0`);
        await visit(absolute);
      } else if (entry.isSymbolicLink()) {
        hash.update(`L\0${relative}\0${await readlink(absolute)}\0`);
      } else {
        const details = await lstat(absolute);
        hash.update(`F\0${relative}\0${details.mode}\0${details.size}\0`);
        hash.update(await readFile(absolute));
      }
    }
  }

  await visit(root);
  return hash.digest("hex");
}

function hasManagedContentDigest(metadata) {
  return typeof metadata?.content_sha256 === "string" && /^[a-f0-9]{64}$/.test(metadata.content_sha256);
}

async function managedContentMatches(targetPath, expected) {
  return (await calculateManagedContentDigest(targetPath)) === expected;
}

function defaultPackageInstaller(name) {
  if (name === "git-code-tracker") return installGitCodeTracker;
  throw new Error(`No managed installer is registered for package: ${name}`);
}

async function backupWriteRoots(targetDir, paths, stagingRoot) {
  const roots = [...new Set(paths.map((entry) => normalizeRelativePath(entry)))].sort((left, right) => left.length - right.length)
    .filter((candidate, index, values) => !values.slice(0, index).some((parent) => candidate.startsWith(`${parent}/`)));
  const records = [];
  for (const relativePath of roots) {
    const source = resolveInside(targetDir, relativePath, "package write path");
    const destination = path.join(stagingRoot, relativePath);
    const exists = await pathExists(source);
    if (exists) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }
    records.push({ relativePath, exists });
  }
  return { stagingRoot, records };
}

async function restoreWriteRoots(targetDir, backup) {
  for (const record of [...backup.records].reverse()) {
    const target = resolveInside(targetDir, record.relativePath, "package write path");
    await rm(target, { recursive: true, force: true });
    if (record.exists) {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(backup.stagingRoot, record.relativePath), target, { recursive: true });
    }
  }
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

async function recordManagedInstall(targetDir, record) {
  const state = await readManagedState(targetDir);
  const retained = state.managed_skills.filter((entry) => entry.name !== record.name || entry.platform !== record.platform);
  const existing = state.managed_skills.find((entry) => entry.name === record.name && entry.platform === record.platform);
  const desiredRecord = preferHigherVersionRecord(existing, record);
  const retainedDeclines = state.declined_install_offers.filter((entry) =>
    entry.name !== record.name || entry.kind !== record.kind || entry.platform !== record.platform
  );
  const result = await writeManagedState(targetDir, {
    ...state,
    managed_skills: [...retained, desiredRecord],
  });
  await writeLocalManagedState(targetDir, {
    declined_install_offers: retainedDeclines,
  });
  return result;
}

async function assertNoManagedDowngrade({ entry, targetDir, platform }) {
  const state = await readManagedState(targetDir);
  const desired = state.managed_skills.find((candidate) => candidate.name === entry.name && candidate.platform === platform);
  if (desired && compareVersions(desired.version, entry.version) > 0) {
    throw new Error(`Refusing to downgrade ${entry.name} to ${entry.version}; shared baseline is ${desired.version}.`);
  }

  const targetPath = resolveInside(targetDir, entry.target_path, `${entry.name} target path`);
  const installed = (await pathExists(targetPath)) ? await readManagedMetadata(targetPath) : null;
  if (isMatchingManagedMetadata(installed, entry, platform) && compareVersions(installed.version, entry.version) > 0) {
    throw new Error(`Refusing to downgrade ${entry.name} to ${entry.version}; installed version is ${installed.version}.`);
  }
}

function preferHigherVersionRecord(existing, candidate) {
  if (!existing) return candidate;
  if (isComparableVersion(existing.version) && !isComparableVersion(candidate.version)) return existing;
  if (!isComparableVersion(existing.version) && isComparableVersion(candidate.version)) return candidate;
  if (!isComparableVersion(existing.version) && !isComparableVersion(candidate.version)) return candidate;
  return compareVersions(existing.version, candidate.version) > 0 ? existing : candidate;
}

function normalizeState(state, statePath) {
  if (!state || Array.isArray(state) || typeof state !== "object") throw new Error(`Invalid managed skill state: ${statePath}`);
  if (![1, 2].includes(state.schema_version)
    || !Array.isArray(state.managed_skills)
    || (state.external_integrations !== undefined && !Array.isArray(state.external_integrations))
    || (state.declined_install_offers !== undefined && !Array.isArray(state.declined_install_offers))) {
    throw new Error(`Invalid managed skill state: ${statePath}`);
  }
  return {
    schema_version: 2,
    managed_skills: state.managed_skills,
    external_integrations: state.external_integrations || [],
    declined_install_offers: state.declined_install_offers || [],
  };
}

function assertSupportedManagedState(state, statePath) {
  if (Number.isInteger(state?.schema_version) && state.schema_version > 2) {
    throw new Error(`Unsupported future managed skill schema: ${state.schema_version}`);
  }
  if (!state || Array.isArray(state) || typeof state !== "object") return;
  for (const key of Object.keys(state)) {
    if (!MIGRATABLE_STATE_KEYS.has(key)) throw new Error(`Unsupported managed skill state field: ${key} (${statePath})`);
  }
}

function parseVersion(value) {
  if (typeof value !== "string" || !/^v?\d+(?:\.\d+)*$/.test(value)) throw new Error(`Invalid managed version: ${value}`);
  return value.replace(/^v/, "").split(".").map(Number);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readManagedMetadata(targetPath) {
  try {
    const metadata = JSON.parse(await readFile(path.join(targetPath, MANAGED_METADATA_FILE), "utf8"));
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeManagedMetadata(targetPath, metadata) {
  await writeFile(path.join(targetPath, MANAGED_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function isMatchingManagedMetadata(metadata, entry, platform) {
  return metadata
    && metadata.name === entry.name
    && metadata.kind === entry.kind
    && metadata.platform === platform
    && typeof metadata.version === "string"
    && /^v?\d+(?:\.\d+)*$/.test(metadata.version);
}

function getExternalIntegrationState(desired, actual) {
  if (!actual) return "missing";
  if (!isComparableVersion(desired.version) || !isComparableVersion(actual.version)) return "version-unknown";
  return compareVersions(actual.version, desired.version) < 0 ? "update-available" : "available";
}

function isComparableVersion(value) {
  return typeof value === "string" && /^v?\d+(?:\.\d+)*$/.test(value);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function resolveInside(rootDir, relativePath, label) {
  const candidate = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Invalid ${label}: ${relativePath}`);
  return candidate;
}

function parseArgs(args) {
  const [command, targetDir, ...rest] = args;
  if (!command || !targetDir || !["check", "apply", "decline"].includes(command)) {
    throw new Error("Usage: node scripts/manage-managed-skills.mjs <check|apply|decline> <target-project> --platform <platform> [--name <name>|--all] [--approved] [--confirmed] [--json]");
  }

  const options = { command, targetDir, platform: "", name: "", all: false, approved: false, confirmed: false, json: false, skillRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--approved") options.approved = true;
    else if (arg === "--confirmed") options.confirmed = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--all") options.all = true;
    else if (["--platform", "--name", "--skill-root"].includes(arg)) {
      const value = rest[index += 1];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--platform") options.platform = value;
      if (arg === "--name") options.name = value;
      if (arg === "--skill-root") options.skillRoot = path.resolve(value);
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.platform) throw new Error("--platform is required");
  if (options.all && command !== "apply") throw new Error("--all is only supported for apply");
  if (options.all && options.name) throw new Error("--all and --name are mutually exclusive");
  if (command === "apply" && !options.all && !options.name) throw new Error("--name or --all is required for apply");
  if (command === "decline" && !options.name) throw new Error("--name is required for decline");
  if (command === "apply" && !options.approved) throw new Error("--approved is required for apply");
  if (command === "decline" && !options.confirmed) throw new Error("--confirmed is required for decline");
  return options;
}

async function runCli(args) {
  const options = parseArgs(args);
  const result = options.command === "check"
    ? await inspectManagedUpdates(options)
    : options.command === "apply"
      ? options.all ? await applyManagedUpdates(options) : await applyManagedUpdate(options)
      : await recordInstallOfferDecline(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (options.command === "check") console.log(result.managed.map((entry) => `${entry.name}: ${entry.state}`).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`[managed-skills] ${error.message}`);
    process.exitCode = 1;
  });
}
