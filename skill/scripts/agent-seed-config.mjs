import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SHARED_CONFIG_FILE = path.join(".agents", "agent-seed.json");
export const LOCAL_CONFIG_FILE = path.join(".agents", "agent-seed.local.json");
export const KNOWLEDGE_DISTILLATION_STATUSES = Object.freeze(["in_progress", "complete", "failed"]);
export const KNOWLEDGE_ASSET_WRITE_MODES = Object.freeze(["full-access", "agent-approve", "ask-each-change"]);

const SHARED_SELF_UPDATE_KEYS = new Set(["check_on_start", "check_interval_hours", "update_mode"]);
const LOCAL_SELF_UPDATE_KEYS = new Set(["proxy", "last_check"]);
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "minimum_agent_seed_version",
  "knowledge_asset_write_mode",
  "knowledge_distillation",
  "self_update",
  "installation",
  "install_prompt_history",
  "legacy_unclassified",
]);

export async function readAgentSeedFiles(targetDir) {
  const root = path.resolve(targetDir);
  const shared = await readJsonIfExists(path.join(root, SHARED_CONFIG_FILE));
  if (Number.isInteger(shared?.schema_version) && shared.schema_version > 2) {
    throw new Error(`Unsupported future Agent Seed config schema: ${shared.schema_version}`);
  }
  const local = await readJsonIfExists(path.join(root, LOCAL_CONFIG_FILE));
  assertSupportedLocalSchema(local);
  return {
    shared: shared || {},
    local: local || {},
    legacy: shared && isLegacyConfig(shared) ? shared : null,
  };
}

export function resolveAgentSeedConfig({ shared = {}, local = {} } = {}) {
  const sharedSelfUpdate = pickObjectKeys(shared.self_update, SHARED_SELF_UPDATE_KEYS);
  const localSelfUpdate = pickObjectKeys(local.self_update, LOCAL_SELF_UPDATE_KEYS);
  const effective = {
    ...pickDefined({
      schema_version: shared.schema_version,
      minimum_agent_seed_version: shared.minimum_agent_seed_version,
      knowledge_asset_write_mode: shared.knowledge_asset_write_mode,
      knowledge_distillation: shared.knowledge_distillation,
      installation: local.installation,
      install_prompt_history: local.install_prompt_history,
    }),
    self_update: {
      ...sharedSelfUpdate,
      ...localSelfUpdate,
    },
  };
  if (Object.keys(effective.self_update).length === 0) delete effective.self_update;
  return effective;
}

export function resolveKnowledgeAssetWriteMode({ requestedMode, shared = {} } = {}) {
  if (requestedMode !== undefined) {
    assertValidKnowledgeAssetWriteMode(requestedMode, "current request");
    return { status: "resolved", mode: requestedMode, source: "current-request" };
  }
  if (shared.knowledge_asset_write_mode !== undefined) {
    assertValidKnowledgeAssetWriteMode(shared.knowledge_asset_write_mode, "shared Agent Seed config");
    return { status: "resolved", mode: shared.knowledge_asset_write_mode, source: "shared-config" };
  }
  return {
    status: "requires-selection",
    recommended_mode: "full-access",
    supported_modes: [...KNOWLEDGE_ASSET_WRITE_MODES],
  };
}

export function assessMinimumAgentSeedVersion({ installedVersion, minimumVersion } = {}) {
  const installed = normalizeVersion(installedVersion);
  const minimum = normalizeVersion(minimumVersion);
  if (!installed || !minimum) return { state: "unconfigured", installed_version: installed || null, minimum_version: minimum || null };
  const comparison = compareVersions(installed, minimum);
  if (comparison < 0) return { state: "version-incompatible", installed_version: installed, minimum_version: minimum };
  if (comparison === 0) return { state: "version-current", installed_version: installed, minimum_version: minimum };
  return { state: "baseline-refresh-available", installed_version: installed, minimum_version: minimum };
}

export function getKnowledgeDistillationState(shared = {}) {
  const state = shared?.knowledge_distillation;
  if (!isPlainObject(state) || typeof state.status !== "string") return { status: "missing" };
  if (!KNOWLEDGE_DISTILLATION_STATUSES.includes(state.status)) {
    return { status: "missing", reason: "invalid-status" };
  }
  if (state.status === "complete" && !isValidKnowledgeDistillationTimestamp(state.completed_at)) {
    return { status: "missing", reason: "invalid-complete" };
  }
  return { ...state };
}

export function shouldStartKnowledgeDistillation({ shared = {}, hasAgentsFile = false, forceFullRefresh = false } = {}) {
  if (forceFullRefresh) return true;
  return getKnowledgeDistillationState(shared).status !== "complete" || hasAgentsFile !== true;
}

export async function writeKnowledgeDistillationState({ targetDir, state } = {}) {
  if (!isPlainObject(state) || typeof state.status !== "string") {
    throw new Error("Knowledge distillation state must include a status.");
  }
  if (!KNOWLEDGE_DISTILLATION_STATUSES.includes(state.status)) {
    throw new Error(`Unsupported knowledge distillation status: ${state.status}`);
  }
  if (state.status === "complete" && !isValidKnowledgeDistillationTimestamp(state.completed_at)) {
    throw new Error("completed_at is required when knowledge distillation is complete.");
  }

  const files = await readAgentSeedFiles(targetDir);
  if (files.legacy) throw new Error("Migrate the legacy Agent Seed config before writing knowledge distillation state.");
  const next = {
    ...files.shared,
    schema_version: 2,
    knowledge_distillation: { ...state },
  };
  await writeSharedAgentSeedConfig({ targetDir, config: next });
  return next.knowledge_distillation;
}

export async function refreshAgentSeedBaseline({ targetDir, installedVersion, approved = false } = {}) {
  if (approved !== true) throw new Error("Owner approval is required to refresh the Agent Seed baseline.");
  const files = await readAgentSeedFiles(targetDir);
  if (files.legacy) throw new Error("Migrate the legacy Agent Seed config before refreshing its baseline.");
  const installed = normalizeVersion(installedVersion);
  if (!installed) throw new Error("A valid installed Agent Seed version is required.");
  const current = normalizeVersion(files.shared.minimum_agent_seed_version);
  if (current && compareVersions(installed, current) <= 0) {
    return { status: "unchanged", minimum_agent_seed_version: current };
  }
  const next = { ...files.shared, schema_version: 2, minimum_agent_seed_version: installed };
  await writeSharedAgentSeedConfig({ targetDir, config: next });
  return { status: "refreshed", minimum_agent_seed_version: installed };
}

export function splitLegacyAgentSeedConfig(legacy, installedVersion) {
  if (!isPlainObject(legacy)) throw new Error("Invalid legacy Agent Seed config.");
  assertValidLegacyFields(legacy);
  const baseline = selectInitialBaseline(legacy.minimum_agent_seed_version, installedVersion);
  const sharedSelfUpdate = pickObjectKeys(legacy.self_update, SHARED_SELF_UPDATE_KEYS);
  const localSelfUpdate = pickObjectKeys(legacy.self_update, LOCAL_SELF_UPDATE_KEYS);
  const shared = {
    schema_version: 2,
    minimum_agent_seed_version: baseline,
    ...pickDefined({
      knowledge_asset_write_mode: legacy.knowledge_asset_write_mode,
      knowledge_distillation: legacy.knowledge_distillation,
    }),
  };
  if (Object.keys(sharedSelfUpdate).length > 0) shared.self_update = sharedSelfUpdate;

  const local = {
    schema_version: 1,
    ...pickDefined({
      installation: legacy.installation,
      install_prompt_history: legacy.install_prompt_history,
    }),
  };
  if (Object.keys(localSelfUpdate).length > 0) local.self_update = localSelfUpdate;

  const unclassified = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) unclassified[key] = value;
  }
  const unknownSelfUpdate = {};
  for (const [key, value] of Object.entries(isPlainObject(legacy.self_update) ? legacy.self_update : {})) {
    if (!SHARED_SELF_UPDATE_KEYS.has(key) && !LOCAL_SELF_UPDATE_KEYS.has(key)) unknownSelfUpdate[key] = value;
  }
  if (Object.keys(unknownSelfUpdate).length > 0) unclassified.self_update = unknownSelfUpdate;
  if (isPlainObject(legacy.legacy_unclassified)) Object.assign(unclassified, legacy.legacy_unclassified);
  if (Object.keys(unclassified).length > 0) local.legacy_unclassified = unclassified;
  return { shared, local };
}

export async function migrateAgentSeedConfig({ targetDir, installedVersion } = {}) {
  const files = await readAgentSeedFiles(targetDir);
  if (!files.legacy) return { status: "current", shared: files.shared, local: files.local };

  const split = splitLegacyAgentSeedConfig(files.legacy, installedVersion);
  const local = mergeLocalState(split.local, files.local);
  await writeJsonAtomic(path.join(path.resolve(targetDir), LOCAL_CONFIG_FILE), local);
  await writeJsonAtomic(path.join(path.resolve(targetDir), SHARED_CONFIG_FILE), split.shared);
  await ensureAgentSeedGitignore(path.resolve(targetDir));
  return { status: "migrated", shared: split.shared, local };
}

export async function writeSharedAgentSeedConfig({ targetDir, config }) {
  if (!isPlainObject(config)) throw new Error("Shared Agent Seed config must be an object.");
  await writeJsonAtomic(path.join(path.resolve(targetDir), SHARED_CONFIG_FILE), config);
}

export async function writeLocalAgentSeedState({ targetDir, patch }) {
  if (!isPlainObject(patch)) throw new Error("Local Agent Seed state patch must be an object.");
  const localPath = path.join(path.resolve(targetDir), LOCAL_CONFIG_FILE);
  const current = (await readJsonIfExists(localPath)) || {};
  assertSupportedLocalSchema(current);
  const next = mergeLocalState(current, { schema_version: 1, ...patch });
  await writeJsonAtomic(localPath, next);
  return next;
}

export async function ensureAgentSeedGitignore(targetDir) {
  return updateGitignore(path.resolve(targetDir));
}

function isLegacyConfig(config) {
  if (config.schema_version !== 2) return true;
  if (config.installation !== undefined || config.install_prompt_history !== undefined) return true;
  const selfUpdate = isPlainObject(config.self_update) ? config.self_update : {};
  return [...LOCAL_SELF_UPDATE_KEYS].some((key) => selfUpdate[key] !== undefined);
}

function assertSupportedLocalSchema(local) {
  if (Number.isInteger(local?.schema_version) && local.schema_version > 1) {
    throw new Error(`Unsupported future Agent Seed local schema: ${local.schema_version}`);
  }
  if (local?.schema_version !== undefined && local.schema_version !== 1) {
    throw new Error(`Invalid Agent Seed local schema: ${local.schema_version}`);
  }
  assertOptionalObject(local, "self_update", "Agent Seed local");
  assertOptionalObject(local, "installation", "Agent Seed local");
  assertOptionalObject(local, "legacy_unclassified", "Agent Seed local");
  assertOptionalObject(local, "managed_skills", "Agent Seed local");
  if (local?.install_prompt_history !== undefined && !Array.isArray(local.install_prompt_history)) {
    throw new Error("Invalid Agent Seed local field: install_prompt_history");
  }
}

function assertValidLegacyFields(legacy) {
  assertOptionalObject(legacy, "self_update", "legacy Agent Seed");
  assertOptionalObject(legacy, "installation", "legacy Agent Seed");
  assertOptionalObject(legacy, "knowledge_distillation", "legacy Agent Seed");
  if (legacy.knowledge_distillation !== undefined && !isValidKnowledgeDistillationState(legacy.knowledge_distillation)) {
    throw new Error("Invalid legacy Agent Seed field: knowledge_distillation");
  }
  assertOptionalObject(legacy, "legacy_unclassified", "legacy Agent Seed");
  if (legacy.install_prompt_history !== undefined && !Array.isArray(legacy.install_prompt_history)) {
    throw new Error("Invalid legacy Agent Seed field: install_prompt_history");
  }
  if (legacy.knowledge_asset_write_mode !== undefined && typeof legacy.knowledge_asset_write_mode !== "string") {
    throw new Error("Invalid legacy Agent Seed field: knowledge_asset_write_mode");
  }
  if (legacy.knowledge_asset_write_mode !== undefined) {
    assertValidKnowledgeAssetWriteMode(legacy.knowledge_asset_write_mode, "legacy Agent Seed");
  }
  if (legacy.minimum_agent_seed_version !== undefined && !normalizeVersion(legacy.minimum_agent_seed_version)) {
    throw new Error("Invalid legacy Agent Seed field: minimum_agent_seed_version");
  }
}

function assertValidKnowledgeAssetWriteMode(mode, label) {
  if (!KNOWLEDGE_ASSET_WRITE_MODES.includes(mode)) {
    throw new Error(`Invalid ${label} knowledge_asset_write_mode: ${mode}`);
  }
}

function assertOptionalObject(value, key, label) {
  if (value?.[key] !== undefined && !isPlainObject(value[key])) {
    throw new Error(`Invalid ${label} field: ${key}`);
  }
}

function mergeLocalState(base, override) {
  const baseHistory = Array.isArray(base.install_prompt_history) ? base.install_prompt_history : [];
  const overrideHistory = Array.isArray(override.install_prompt_history) ? override.install_prompt_history : [];
  const history = deduplicate([...baseHistory, ...overrideHistory]);
  const result = {
    ...base,
    ...override,
    schema_version: 1,
    self_update: {
      ...(isPlainObject(base.self_update) ? base.self_update : {}),
      ...(isPlainObject(override.self_update) ? override.self_update : {}),
    },
    legacy_unclassified: {
      ...(isPlainObject(base.legacy_unclassified) ? base.legacy_unclassified : {}),
      ...(isPlainObject(override.legacy_unclassified) ? override.legacy_unclassified : {}),
    },
  };
  if (history.length > 0) result.install_prompt_history = history;
  else delete result.install_prompt_history;
  if (Object.keys(result.self_update).length === 0) delete result.self_update;
  if (Object.keys(result.legacy_unclassified).length === 0) delete result.legacy_unclassified;
  return result;
}

function selectInitialBaseline(existing, installed) {
  const existingVersion = normalizeVersion(existing);
  const installedVersion = normalizeVersion(installed);
  if (!installedVersion) throw new Error("A valid installed Agent Seed version is required for migration.");
  if (!existingVersion) return installedVersion;
  return compareVersions(existingVersion, installedVersion) >= 0 ? existingVersion : installedVersion;
}

function normalizeVersion(value) {
  if (typeof value !== "string" || !/^v?\d+(?:\.\d+)*$/.test(value)) return "";
  return value.startsWith("v") ? value : `v${value}`;
}

function isValidKnowledgeDistillationState(state) {
  if (!isPlainObject(state) || typeof state.status !== "string") return false;
  if (!KNOWLEDGE_DISTILLATION_STATUSES.includes(state.status)) return false;
  return state.status !== "complete" || isValidKnowledgeDistillationTimestamp(state.completed_at);
}

function isValidKnowledgeDistillationTimestamp(value) {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function compareVersions(left, right) {
  const leftParts = left.replace(/^v/, "").split(".").map(Number);
  const rightParts = right.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function pickObjectKeys(value, keys) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => keys.has(key) && entry !== undefined));
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
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

async function readJsonIfExists(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (!isPlainObject(value)) throw new Error(`Invalid Agent Seed JSON object: ${filePath}`);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    JSON.parse(await readFile(tempPath, "utf8"));
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function updateGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  let content;
  try {
    content = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") content = "";
    else throw error;
  }

  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => ![".agents/agent-seed.json", ".agents/managed-skills.json"].includes(line.trim()));
  const required = [
    "!.agents/",
    ".agents/agent-seed.local.json",
    "!.agents/agent-seed.json",
    "!.agents/managed-skills.json",
  ];
  for (const line of required) {
    if (!filtered.some((existing) => existing.trim() === line)) filtered.push(line);
  }
  const next = `${filtered.join("\n").replace(/\n+$/, "")}\n`;
  if (next === content) return false;
  await writeTextAtomic(gitignorePath, next);
  return true;
}

async function writeTextAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
