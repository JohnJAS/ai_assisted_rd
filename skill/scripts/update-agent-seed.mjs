import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assessMinimumAgentSeedVersion,
  ensureAgentSeedGitignore,
  migrateAgentSeedConfig,
  readAgentSeedFiles,
  refreshAgentSeedBaseline,
  resolveAgentSeedConfig,
  writeLocalAgentSeedState,
} from "./agent-seed-config.mjs";
import { migrateManagedState } from "./manage-managed-skills.mjs";

export { assessMinimumAgentSeedVersion, refreshAgentSeedBaseline };

const DEFAULT_ASSET_NAME = "agent-seed.zip";
const DEFAULT_CONFIG_PATH = path.join(".agents", "agent-seed.json");
const ENV_PROXY_REEXEC_MARKER = "AGENT_SEED_ENV_PROXY_REEXEC";
const PROXY_ENV_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
const DEFERRED_UPDATE_ARG = "--complete-staged-update";
const DEFERRED_STAGE_RECORD = "update-stage.json";
const DEFERRED_HELPER_NAME = "update-agent-seed-helper.mjs";
const DEFERRED_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const DEFERRED_UPDATE_TIMEOUT_MS = 12 * 60 * 60 * 1_000;
const FAILED_STAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const TARGET_LOCK_RETRY_MS = 100;
const TARGET_LOCK_STALE_MS = 5 * 60 * 1_000;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const SUCCESSFUL_CHECK_STATUSES = new Set(["current", "available"]);

export function compareVersions(left, right) {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

export function buildUpdatePlan({ currentVersion, latestRelease, assetName = DEFAULT_ASSET_NAME }) {
  if (!latestRelease || typeof latestRelease !== "object") {
    throw new Error("latestRelease must be an object");
  }

  const latestVersion = latestRelease.tag_name;
  if (typeof latestVersion !== "string" || latestVersion.trim() === "") {
    throw new Error("latest release is missing tag_name");
  }

  const assets = Array.isArray(latestRelease.assets) ? latestRelease.assets : [];
  const asset = assets.find((entry) => entry.name === assetName);
  if (!asset) {
    throw new Error(`latest release does not include ${assetName}`);
  }

  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseUrl: latestRelease.html_url || "",
    asset,
  };
}

export function shouldCheckForUpdates({ selfUpdate = {}, currentVersion = "", now = new Date() } = {}) {
  const lastCheck = selfUpdate?.last_check;
  const checkedAt = Date.parse(lastCheck?.checked_at || "");
  const intervalHours = normalizeCheckIntervalHours(selfUpdate?.check_interval_hours);
  const hasMatchingVersion = typeof lastCheck?.current_version === "string"
    && lastCheck.current_version !== ""
    && lastCheck.current_version === currentVersion
    && typeof lastCheck.latest_version === "string"
    && lastCheck.latest_version !== "";

  return !SUCCESSFUL_CHECK_STATUSES.has(lastCheck?.status)
    || !Number.isFinite(checkedAt)
    || !hasMatchingVersion
    || now.getTime() - checkedAt >= intervalHours * 60 * 60 * 1_000;
}

function normalizeCheckIntervalHours(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CHECK_INTERVAL_HOURS;
  }

  return value;
}

function buildCachedUpdatePlan(lastCheck) {
  return {
    hasUpdate: lastCheck.status === "available",
    currentVersion: lastCheck.current_version || "v0.0.0",
    latestVersion: lastCheck.latest_version || lastCheck.current_version || "v0.0.0",
    releaseUrl: "",
    asset: null,
    cached: true,
  };
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === DEFERRED_UPDATE_ARG) {
    if (!argv[1] || argv.length !== 2) {
      throw new Error(`${DEFERRED_UPDATE_ARG} requires exactly one stage-record path`);
    }

    const result = await runDeferredUpdate({ stagePath: path.resolve(argv[1]) });
    console.log(`agent-seed deferred update ${result.status}: ${result.version || "unknown"}`);
    return;
  }

  const options = parseArgs(argv);
  const configPath = path.resolve(options.config || DEFAULT_CONFIG_PATH);

  if (hasProxyConfigUpdate(options)) {
    await writeAgentSeedProxyConfig({
      configPath,
      proxy: {
        httpsProxy: options.setHttpsProxy,
        httpProxy: options.setHttpProxy,
        allProxy: options.setAllProxy,
        noProxy: options.setNoProxy,
      },
    });
    console.log(`agent-seed proxy config updated: ${configPath}`);
    return;
  }

  if (options.recordNetworkDenied) {
    await writeAgentSeedNetworkDeniedState({ configPath });
    console.log(`agent-seed update check deferred: ${configPath}`);
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultTargetDir = path.resolve(scriptDir, "..");
  const targetDir = path.resolve(options.target || defaultTargetDir);
  const isPackagedInstallation = await validateAgentSeedInstallationRoot(targetDir);
  const versionMetadata = await readVersionMetadata(targetDir);
  if (options.refreshBaseline) {
    if (!isStandardAgentSeedConfigPath(configPath)) {
      throw new Error("--refresh-baseline requires the project .agents/agent-seed.json config path.");
    }
    const result = await refreshAgentSeedBaseline({
      targetDir: projectRootForConfig(configPath),
      installedVersion: versionMetadata.version,
      approved: options.approved,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`agent-seed baseline ${result.status}: ${result.minimum_agent_seed_version}`);
    return;
  }
  if (isStandardAgentSeedConfigPath(configPath) && versionMetadata.version) {
    await migrateAgentSeedConfig({
      targetDir: projectRootForConfig(configPath),
      installedVersion: versionMetadata.version,
    });
    await migrateManagedState(projectRootForConfig(configPath));
    await ensureAgentSeedGitignore(projectRootForConfig(configPath));
  }
  if (isPackagedInstallation) {
    await writeAgentSeedInstallationState({ configPath, skillRoot: targetDir });
  }
  const agentSeedConfig = await readAgentSeedConfig(configPath);
  let env = await buildProxyEnvironmentWithSystemProxy({ env: process.env, config: agentSeedConfig });

  const repository = options.repository || versionMetadata.repository;

  if (!repository) {
    throw new Error("Missing repository. Pass --repository owner/repo or use a packaged VERSION.json.");
  }

  const currentVersion = options.currentVersion || versionMetadata.version || "v0.0.0";
  const selfUpdate = agentSeedConfig.self_update || {};
  const baseline = assessMinimumAgentSeedVersion({
    installedVersion: currentVersion,
    minimumVersion: agentSeedConfig.minimum_agent_seed_version,
  });
  if (!options.apply && !options.forceCheck && !shouldCheckForUpdates({ selfUpdate, currentVersion })) {
    const updatePlan = buildCachedUpdatePlan(selfUpdate.last_check);
    updatePlan.baseline = baseline;
    if (options.json) {
      console.log(JSON.stringify(updatePlan, null, 2));
    } else if (updatePlan.hasUpdate) {
      console.log(`agent-seed update available: ${updatePlan.currentVersion} -> ${updatePlan.latestVersion} (cached check)`);
    } else {
      console.log(`agent-seed is current (${updatePlan.currentVersion}, cached check).`);
    }
    return;
  }

  let latestRelease;
  try {
    latestRelease = await fetchLatestRelease(repository, { env });
  } catch (error) {
    const retryEnv = await promptForProxyAfterNetworkError({
      error,
      configPath,
      env,
      json: options.json,
    });

    if (!retryEnv) {
      throw withProxyGuidance(error);
    }

    env = retryEnv;
    latestRelease = await fetchLatestRelease(repository, { env });
  }
  const updatePlan = buildUpdatePlan({
    currentVersion,
    latestRelease,
    assetName: options.assetName || DEFAULT_ASSET_NAME,
  });
  updatePlan.baseline = baseline;
  await writeAgentSeedUpdateState({
    configPath,
    status: updatePlan.hasUpdate ? "available" : "current",
    reason: "latest-release",
    currentVersion,
    latestVersion: updatePlan.latestVersion,
  });

  if (options.json) {
    console.log(JSON.stringify(updatePlan, null, 2));
  } else if (!updatePlan.hasUpdate) {
    console.log(`agent-seed is current (${currentVersion}).`);
  } else {
    console.log(`agent-seed update available: ${currentVersion} -> ${updatePlan.latestVersion}`);
    console.log(`Release: ${updatePlan.releaseUrl}`);
  }

  if (!options.apply || !updatePlan.hasUpdate) {
    return;
  }
  assertAgentSeedUpdateMeetsBaseline({ candidateVersion: updatePlan.latestVersion, baseline });

  const result = await applyUpdate({
    targetDir,
    asset: updatePlan.asset,
    requestOptions: { env },
    configPath,
    currentVersion,
    latestVersion: updatePlan.latestVersion,
  });
  if (result.status === "queued") {
    console.log(`agent-seed update queued until the Windows directory lock is released: ${result.stagePath}`);
    return;
  }

  console.log(`agent-seed updated in ${targetDir}`);
}

export function buildProxyEnvironment(env, config = {}) {
  const proxy = config?.self_update?.proxy || {};
  const result = { ...env };

  applyProxyEnv(result, "HTTPS_PROXY", ["HTTPS_PROXY", "https_proxy"], proxy.https_proxy ?? proxy.httpsProxy);
  applyProxyEnv(result, "HTTP_PROXY", ["HTTP_PROXY", "http_proxy"], proxy.http_proxy ?? proxy.httpProxy);
  applyProxyEnv(result, "ALL_PROXY", ["ALL_PROXY", "all_proxy"], proxy.all_proxy ?? proxy.allProxy);
  applyProxyEnv(result, "NO_PROXY", ["NO_PROXY", "no_proxy"], proxy.no_proxy ?? proxy.noProxy);

  return result;
}

export async function buildProxyEnvironmentWithSystemProxy({
  env = process.env,
  config = {},
  cwd = process.cwd(),
  platform = process.platform,
  commandRunner = runCapture,
} = {}) {
  const result = buildProxyEnvironment(env, config);
  if (hasProxyEnvironment(result)) {
    return result;
  }

  const gitProxy = await readGitProxyConfig({ cwd, commandRunner });
  if (gitProxy) {
    return buildProxyEnvironment(result, {
      self_update: {
        proxy: {
          https_proxy: gitProxy,
        },
      },
    });
  }

  const windowsProxy = await readWindowsSystemProxyConfig({ platform, commandRunner });
  if (windowsProxy.httpsProxy || windowsProxy.noProxy) {
    return buildProxyEnvironment(result, {
      self_update: {
        proxy: {
          https_proxy: windowsProxy.httpsProxy,
          no_proxy: windowsProxy.noProxy,
        },
      },
    });
  }

  return result;
}

export async function writeAgentSeedProxyConfig({ configPath = DEFAULT_CONFIG_PATH, proxy }) {
  const config = await readAgentSeedConfig(configPath);
  const nextProxy = {
    ...(config.self_update?.proxy || {}),
    ...normalizeProxyConfig(proxy),
  };

  await writeAgentSeedState(configPath, { self_update: { proxy: nextProxy } });
}

export async function writeAgentSeedInstallationState({ configPath = DEFAULT_CONFIG_PATH, skillRoot, now = new Date() } = {}) {
  if (typeof skillRoot !== "string" || skillRoot.trim() === "") throw new Error("Agent Seed skill root is required.");
  await writeAgentSeedState(configPath, {
    installation: {
      skill_root: path.resolve(skillRoot),
      recorded_at: now.toISOString(),
    },
  });
}

async function validateAgentSeedInstallationRoot(skillRoot) {
  const requiredFiles = [
    "bundled-skills.json",
    "bundled-packages.json",
    path.join("scripts", "update-agent-seed.mjs"),
    path.join("scripts", "manage-managed-skills.mjs"),
    path.join("scripts", "check-agent-seed-updates.mjs"),
  ];
  for (const relativePath of requiredFiles) {
    try {
      await stat(path.join(skillRoot, relativePath));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Invalid Agent Seed installation root: missing ${relativePath}`);
      }
      throw error;
    }
  }

  const versionMetadata = await readVersionMetadata(skillRoot);
  if (Object.keys(versionMetadata).length === 0) return false;
  if (typeof versionMetadata.version !== "string" || versionMetadata.version.trim() === "") {
    throw new Error("Invalid Agent Seed installation root: VERSION.json is missing version");
  }
  return true;
}

export async function writeAgentSeedNetworkDeniedState({ configPath = DEFAULT_CONFIG_PATH, now = new Date() } = {}) {
  await writeAgentSeedUpdateState({
    configPath,
    status: "deferred",
    reason: "network-denied",
    now,
  });
}

export async function writeAgentSeedUpdateState({
  configPath = DEFAULT_CONFIG_PATH,
  status,
  reason,
  currentVersion,
  latestVersion,
  now = new Date(),
} = {}) {
  await writeAgentSeedState(configPath, {
    self_update: {
      last_check: {
        status,
        reason,
        current_version: currentVersion,
        latest_version: latestVersion,
        checked_at: now.toISOString(),
      },
    },
  });
}

export function getEnvProxyReexecArgs({
  argv = process.argv,
  execArgv = process.execArgv,
  env = process.env,
  allowedFlags = process.allowedNodeEnvironmentFlags,
} = {}) {
  if (env[ENV_PROXY_REEXEC_MARKER] === "1" || !hasProxyEnvironment(env)) {
    return null;
  }

  if (!allowedFlags?.has?.("--use-env-proxy")) {
    return null;
  }

  if (hasUseEnvProxyFlag(execArgv) || hasUseEnvProxyFlag(splitNodeOptions(env.NODE_OPTIONS))) {
    return null;
  }

  const scriptAndArgs = argv.slice(1);
  if (scriptAndArgs.length === 0) {
    return null;
  }

  return {
    nodeArgs: [...execArgv, "--use-env-proxy", ...scriptAndArgs],
    env: {
      ...env,
      [ENV_PROXY_REEXEC_MARKER]: "1",
    },
  };
}

export function isLikelyProxyNetworkError(error) {
  const code = error?.code || error?.cause?.code || "";
  const message = `${error?.message || ""} ${error?.cause?.message || ""}`;
  const proxyLikeCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);

  return proxyLikeCodes.has(code) || /ConnectTimeoutError|connect timeout|timed out|ENOTFOUND|getaddrinfo|api\.github\.com:443/i.test(message);
}

export function withProxyGuidance(error) {
  if (!isLikelyProxyNetworkError(error)) {
    return error;
  }

  const guided = new Error(
    [
      error.message,
      "",
      "agent-seed could not reach GitHub. If this network requires a proxy, configure one and retry:",
      "node scripts/update-agent-seed.mjs --set-https-proxy http://proxy.example:8080",
      "node scripts/update-agent-seed.mjs --set-no-proxy localhost,127.0.0.1",
    ].join("\n"),
    { cause: error },
  );
  guided.code = error.code;
  return guided;
}

export async function promptForProxyAfterNetworkError({
  error,
  configPath = DEFAULT_CONFIG_PATH,
  env = process.env,
  input = process.stdin,
  output = process.stderr,
  isInteractive = Boolean(input.isTTY && output.isTTY),
  json = false,
} = {}) {
  if (json || !isInteractive || !isLikelyProxyNetworkError(error) || hasProxyEnvironment(env)) {
    return null;
  }

  const readline = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  try {
    const proxyUrl = (
      await readline.question(
        "agent-seed could not reach GitHub. Enter HTTPS proxy URL to save and retry, or leave blank to fail: ",
      )
    ).trim();

    if (!proxyUrl) {
      return null;
    }

    await writeAgentSeedProxyConfig({
      configPath,
      proxy: {
        httpsProxy: proxyUrl,
      },
    });

    const config = await readAgentSeedConfig(configPath);
    return buildProxyEnvironment(env, config);
  } finally {
    readline.close();
  }
}

function applyProxyEnv(env, canonicalName, candidateNames, value) {
  if (typeof value !== "string" || value.trim() === "" || candidateNames.some((name) => env[name])) {
    return;
  }

  env[canonicalName] = value.trim();
}

function normalizeProxyConfig(proxy = {}) {
  const normalized = {};
  const mappings = [
    ["https_proxy", proxy.httpsProxy ?? proxy.https_proxy],
    ["http_proxy", proxy.httpProxy ?? proxy.http_proxy],
    ["all_proxy", proxy.allProxy ?? proxy.all_proxy],
    ["no_proxy", proxy.noProxy ?? proxy.no_proxy],
  ];

  for (const [key, value] of mappings) {
    if (typeof value === "string" && value.trim() !== "") {
      normalized[key] = value.trim();
    }
  }

  return normalized;
}

function hasProxyConfigUpdate(options) {
  return [options.setHttpsProxy, options.setHttpProxy, options.setAllProxy, options.setNoProxy].some(Boolean);
}

function hasProxyEnvironment(env) {
  return PROXY_ENV_NAMES.some((name) => typeof env[name] === "string" && env[name].trim() !== "");
}

function hasUseEnvProxyFlag(args) {
  return args.some((arg) => arg === "--use-env-proxy" || arg === "--use_env_proxy");
}

function splitNodeOptions(nodeOptions = "") {
  return nodeOptions
    .split(/\s+/)
    .map((option) => option.trim())
    .filter(Boolean);
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^refs\/tags\//, "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function parseArgs(argv) {
  const options = {
    apply: false,
    approved: false,
    forceCheck: false,
    json: false,
    refreshBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--force-check") {
      options.forceCheck = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--refresh-baseline") {
      options.refreshBaseline = true;
    } else if (arg === "--repository") {
      options.repository = requireValue(argv, (index += 1), arg);
    } else if (arg === "--target") {
      options.target = requireValue(argv, (index += 1), arg);
    } else if (arg === "--current-version") {
      options.currentVersion = requireValue(argv, (index += 1), arg);
    } else if (arg === "--asset-name") {
      options.assetName = requireValue(argv, (index += 1), arg);
    } else if (arg === "--config") {
      options.config = requireValue(argv, (index += 1), arg);
    } else if (arg === "--set-https-proxy") {
      options.setHttpsProxy = requireValue(argv, (index += 1), arg);
    } else if (arg === "--set-http-proxy") {
      options.setHttpProxy = requireValue(argv, (index += 1), arg);
    } else if (arg === "--set-all-proxy") {
      options.setAllProxy = requireValue(argv, (index += 1), arg);
    } else if (arg === "--set-no-proxy") {
      options.setNoProxy = requireValue(argv, (index += 1), arg);
    } else if (arg === "--record-network-denied") {
      options.recordNetworkDenied = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

async function readAgentSeedConfig(configPath) {
  if (isStandardAgentSeedConfigPath(configPath)) {
    const files = await readAgentSeedFiles(projectRootForConfig(configPath));
    if (files.legacy) {
      return {
        ...files.shared,
        ...pickLocalTopLevel(files.local),
        self_update: {
          ...(files.shared.self_update || {}),
          ...(files.local.self_update || {}),
        },
      };
    }
    return resolveAgentSeedConfig(files);
  }

  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeAgentSeedConfig(configPath, config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function writeAgentSeedState(configPath, patch) {
  if (isStandardAgentSeedConfigPath(configPath)) {
    return writeLocalAgentSeedState({ targetDir: projectRootForConfig(configPath), patch });
  }
  const config = await readAgentSeedConfig(configPath);
  return writeAgentSeedConfig(configPath, mergeStatePatch(config, patch));
}

function mergeStatePatch(config, patch) {
  return {
    ...config,
    ...patch,
    self_update: {
      ...(config.self_update || {}),
      ...(patch.self_update || {}),
    },
  };
}

export function assertAgentSeedUpdateMeetsBaseline({ candidateVersion, baseline }) {
  const minimumVersion = baseline?.minimum_version;
  if (minimumVersion && compareVersions(candidateVersion, minimumVersion) < 0) {
    throw new Error(`Agent Seed release ${candidateVersion} does not satisfy shared minimum ${minimumVersion}.`);
  }
}

function isStandardAgentSeedConfigPath(configPath) {
  const resolved = path.resolve(configPath);
  return path.basename(resolved) === "agent-seed.json" && path.basename(path.dirname(resolved)) === ".agents";
}

function projectRootForConfig(configPath) {
  return path.dirname(path.dirname(path.resolve(configPath)));
}

function pickLocalTopLevel(local) {
  return {
    ...(local.installation === undefined ? {} : { installation: local.installation }),
    ...(local.install_prompt_history === undefined ? {} : { install_prompt_history: local.install_prompt_history }),
  };
}

async function readVersionMetadata(targetDir) {
  try {
    return JSON.parse(await readFile(path.join(targetDir, "VERSION.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function fetchLatestRelease(repository, requestOptions = {}) {
  const url = `https://api.github.com/repos/${repository}/releases/latest`;

  try {
    const response = await fetchWithProxy(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "agent-seed-updater",
      },
    }, requestOptions);

    if (!response.ok) {
      throw new Error(`GitHub latest release request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } catch (nodeError) {
    return fetchJsonViaCurlFallback(url, requestOptions, nodeError);
  }
}

export async function applyUpdate({
  targetDir,
  asset,
  requestOptions = {},
  configPath,
  currentVersion,
  latestVersion,
  platform = process.platform,
  stageRoot = getDeferredStageRoot({ platform }),
  launcher = launchDeferredUpdate,
  replace = replaceDirectory,
  now = () => new Date(),
  scriptPath = fileURLToPath(import.meta.url),
} = {}) {
  if (!asset.browser_download_url) {
    throw new Error(`Release asset ${asset.name} is missing browser_download_url`);
  }

  if (platform === "win32") {
    return applyWindowsUpdate({
      targetDir,
      asset,
      requestOptions,
      configPath,
      currentVersion,
      latestVersion,
      stageRoot,
      launcher,
      replace,
      now,
      scriptPath,
    });
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-seed-update-"));
  const zipPath = path.join(tempDir, asset.name);
  const extractDir = path.join(tempDir, "expanded");
  const backupDir = path.join(tempDir, "backup");

  try {
    await downloadAsset(asset.browser_download_url, zipPath, requestOptions);
    await verifyAssetDigest(zipPath, asset);
    await extractZip(zipPath, extractDir);
    await replaceAndVerify({ sourceDir: extractDir, targetDir, backupDir, latestVersion, replace });
    await writeUpdateStateIfConfigured({ configPath, status: "updated", reason: "applied", currentVersion, latestVersion, now: now() });
    return { status: "updated", version: latestVersion };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function applyWindowsUpdate({
  targetDir,
  asset,
  requestOptions,
  configPath,
  currentVersion,
  latestVersion,
  stageRoot,
  launcher,
  replace,
  now,
  scriptPath,
}) {
  await pruneExpiredFailedStages(stageRoot, now());
  await mkdir(stageRoot, { recursive: true });
  const stageDir = await mkdtemp(path.join(stageRoot, "stage-"));
  const zipPath = path.join(stageDir, asset.name);
  const sourceDir = path.join(stageDir, "expanded");
  const backupDir = path.join(stageDir, "backup");

  try {
    await downloadAsset(asset.browser_download_url, zipPath, requestOptions);
    await verifyAssetDigest(zipPath, asset);
    await extractZip(zipPath, sourceDir);
    await copyDeferredHelper({ stageDir, scriptPath });
    return withTargetUpdateLock({ stageRoot, targetDir }, async () => {
      await supersedeQueuedStages(stageRoot, targetDir, now());
      try {
        await replaceAndVerify({ sourceDir, targetDir, backupDir, latestVersion, replace });
        await writeUpdateStateIfConfigured({ configPath, status: "updated", reason: "applied", currentVersion, latestVersion, now: now() });
        await rm(stageDir, { recursive: true, force: true });
        return { status: "updated", version: latestVersion };
      } catch (error) {
        if (!isRetryableWindowsLock(error)) {
          throw error;
        }

        return queueDeferredUpdate({
          stageDir,
          targetDir,
          configPath,
          currentVersion,
          latestVersion,
          launcher,
          scriptPath,
          now,
        });
      }
    });
  } catch (error) {
    await writeUpdateStateIfConfigured({
      configPath,
      status: "failed",
      reason: getUpdateFailureReason(error),
      currentVersion,
      latestVersion,
      now: now(),
    });
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

export async function queueDeferredUpdate({
  stageDir,
  targetDir,
  configPath,
  currentVersion,
  latestVersion,
  launcher = launchDeferredUpdate,
  scriptPath = fileURLToPath(import.meta.url),
  now = () => new Date(),
} = {}) {
  const timestamp = now();
  const stagePath = path.join(stageDir, DEFERRED_STAGE_RECORD);
  const helperPath = await copyDeferredHelper({ stageDir, scriptPath });
  const stage = {
    status: "queued",
    targetDir: path.resolve(targetDir),
    sourceDir: path.join(stageDir, "expanded"),
    backupDir: path.join(stageDir, "backup"),
    configPath: configPath ? path.resolve(configPath) : "",
    currentVersion: currentVersion || "",
    latestVersion: latestVersion || "",
    startedAt: timestamp.toISOString(),
    deadlineAt: new Date(timestamp.getTime() + DEFERRED_UPDATE_TIMEOUT_MS).toISOString(),
  };

  await writeFile(stagePath, `${JSON.stringify(stage, null, 2)}\n`);
  await writeUpdateStateIfConfigured({
    configPath,
    status: "queued",
    reason: "windows-directory-locked",
    currentVersion,
    latestVersion,
    now: timestamp,
  });
  await appendDeferredLog(stageDir, `queued replacement for ${stage.targetDir}`);
  launcher(process.execPath, [helperPath, DEFERRED_UPDATE_ARG, stagePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: stageDir,
  }).unref();

  return { status: "queued", version: latestVersion, stagePath: stageDir };
}

export async function runDeferredUpdate({
  stagePath,
  sleep = delay,
  now = () => new Date(),
  replace = replaceDirectory,
  notifier = notifyWindowsUpdateCompleted,
} = {}) {
  const suppliedPath = path.resolve(stagePath);
  const recordPath = path.basename(suppliedPath) === DEFERRED_STAGE_RECORD
    ? suppliedPath
    : path.join(suppliedPath, DEFERRED_STAGE_RECORD);
  const stageDir = path.dirname(recordPath);
  let stage = JSON.parse(await readFile(recordPath, "utf8"));
  let attempt = 0;

  while (true) {
    let outcome;
    try {
      outcome = await withTargetUpdateLock({
        stageRoot: path.dirname(stageDir),
        targetDir: stage.targetDir,
        deadlineAt: stage.deadlineAt,
      }, async () => {
      stage = JSON.parse(await readFile(recordPath, "utf8"));
      if (stage.status === "superseded" || await isInstalledVersionNewer(stage.targetDir, stage.latestVersion)) {
        return { status: "superseded" };
      }

      try {
        await replaceAndVerify({
          sourceDir: stage.sourceDir,
          targetDir: stage.targetDir,
          backupDir: stage.backupDir,
          latestVersion: stage.latestVersion,
          replace,
        });
        return { status: "updated" };
      } catch (error) {
        return { status: "error", error };
      }
      });
    } catch (error) {
      outcome = { status: "error", error };
    }

    if (outcome.status === "superseded") {
      await appendDeferredLog(stageDir, "stage superseded by a newer update");
      await rm(stageDir, { recursive: true, force: true });
      return { status: "superseded", version: stage.latestVersion };
    }
    if (outcome.status === "updated") {
      await writeUpdateStateIfConfigured({
        configPath: stage.configPath,
        status: "updated",
        reason: "applied",
        currentVersion: stage.currentVersion,
        latestVersion: stage.latestVersion,
        now: now(),
      });
      await appendDeferredLog(stageDir, "replacement completed");
      try {
        notifier({ version: stage.latestVersion });
      } catch {
        // A desktop notification cannot change an already verified update result.
      }
      await rm(stageDir, { recursive: true, force: true });
      return { status: "updated", version: stage.latestVersion };
    }

    const error = outcome.error;
    {
      if (!isRetryableWindowsLock(error) || error.code === "ETIMEDOUT" || now().getTime() >= new Date(stage.deadlineAt).getTime()) {
        await writeUpdateStateIfConfigured({
          configPath: stage.configPath,
          status: "failed",
          reason: isRetryableWindowsLock(error) || error.code === "ETIMEDOUT" ? "lock-timeout" : getUpdateFailureReason(error),
          currentVersion: stage.currentVersion,
          latestVersion: stage.latestVersion,
          now: now(),
        });
        await markStageFailed(recordPath, stage, now());
        await appendDeferredLog(stageDir, `replacement failed: ${error.message}`);
        throw error;
      }

      await appendDeferredLog(stageDir, `directory still locked; retry ${attempt + 1}`);
      await sleep(DEFERRED_RETRY_DELAYS_MS[Math.min(attempt, DEFERRED_RETRY_DELAYS_MS.length - 1)]);
      attempt += 1;
    }
  }
}

export function notifyWindowsUpdateCompleted({ platform = process.platform, version = "", runner = spawn } = {}) {
  if (platform !== "win32") {
    return false;
  }

  const notificationScript = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$notification = New-Object System.Windows.Forms.NotifyIcon",
    "$notification.Icon = [System.Drawing.SystemIcons]::Information",
    "$notification.Visible = $true",
    "$notification.ShowBalloonTip(10000, 'Agent Seed updated', ('Version ' + $args[0] + ' is ready for your next session.'), [System.Windows.Forms.ToolTipIcon]::Info)",
    "Start-Sleep -Milliseconds 10500",
    "$notification.Dispose()",
  ].join("; ");

  try {
    runner(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", notificationScript, version],
      { detached: true, stdio: "ignore", windowsHide: true },
    ).unref();
    return true;
  } catch {
    return false;
  }
}

function getDeferredStageRoot({ platform = process.platform, env = process.env } = {}) {
  const localData = env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
  return platform === "win32" ? path.join(localData, "agent-seed", "updates") : path.join(tmpdir(), "agent-seed", "updates");
}

async function copyDeferredHelper({ stageDir, scriptPath }) {
  const helperPath = path.join(stageDir, DEFERRED_HELPER_NAME);
  await cp(scriptPath, helperPath, { force: true });
  return helperPath;
}

function launchDeferredUpdate(command, args, options) {
  return spawn(command, args, options);
}

function isRetryableWindowsLock(error) {
  if (["EBUSY", "ENOTEMPTY"].includes(error?.code)) {
    return true;
  }

  return error?.code === "EPERM" && /resource busy|sharing violation|used by another process/i.test(String(error?.message || ""));
}

async function replaceAndVerify({ sourceDir, targetDir, backupDir, latestVersion, replace }) {
  try {
    await replace({ sourceDir, targetDir, backupDir });
    await verifyInstalledVersion(targetDir, latestVersion);
  } catch (error) {
    const backupExists = await stat(backupDir).then(() => true, (statError) => {
      if (statError.code === "ENOENT") {
        return false;
      }
      throw statError;
    });
    if (backupExists) {
      await restoreDirectory({ sourceDir: backupDir, targetDir });
    }
    throw error;
  }
}

async function restoreDirectory({ sourceDir, targetDir }) {
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

function getUpdateFailureReason(error) {
  return /Installed update version mismatch/.test(String(error?.message || ""))
    ? "version-verification-failed"
    : "replacement-failed";
}

async function verifyInstalledVersion(targetDir, latestVersion) {
  if (!latestVersion) {
    return;
  }

  const metadata = await readVersionMetadata(targetDir);
  if (metadata.version !== latestVersion) {
    throw new Error(`Installed update version mismatch: expected ${latestVersion}, got ${metadata.version || "missing"}`);
  }
}

async function writeUpdateStateIfConfigured({ configPath, status, reason, currentVersion, latestVersion, now }) {
  if (!configPath) {
    return;
  }

  await writeAgentSeedUpdateState({ configPath, status, reason, currentVersion, latestVersion, now });
}

async function appendDeferredLog(stageDir, message) {
  await appendFile(path.join(stageDir, "update.log"), `${new Date().toISOString()} ${message}\n`);
}

async function markStageFailed(recordPath, stage, now) {
  await writeFile(recordPath, `${JSON.stringify({ ...stage, status: "failed", failedAt: now.toISOString() }, null, 2)}\n`);
}

async function pruneExpiredFailedStages(stageRoot, now) {
  const entries = await readdir(stageRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const candidate = path.join(stageRoot, entry.name);
    try {
      const record = JSON.parse(await readFile(path.join(candidate, DEFERRED_STAGE_RECORD), "utf8"));
      if (record.status === "failed" && Date.parse(record.failedAt) + FAILED_STAGE_RETENTION_MS <= now.getTime()) {
        await rm(candidate, { recursive: true, force: true });
      }
    } catch {
      // An incomplete or active stage is retained for its helper or later diagnosis.
    }
  }));
}

async function supersedeQueuedStages(stageRoot, targetDir, now) {
  const entries = await readdir(stageRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const recordPath = path.join(stageRoot, entry.name, DEFERRED_STAGE_RECORD);
    try {
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      if (record.status === "queued" && path.resolve(record.targetDir) === path.resolve(targetDir)) {
        await writeFile(recordPath, `${JSON.stringify({ ...record, status: "superseded", supersededAt: now.toISOString() }, null, 2)}\n`);
      }
    } catch {
      // A stage without a complete record cannot safely be superseded.
    }
  }));
}

async function withTargetUpdateLock({ stageRoot, targetDir, deadlineAt }, action) {
  const lockDir = path.join(stageRoot, "locks");
  const lockName = createHash("sha256").update(path.resolve(targetDir).toLowerCase()).digest("hex");
  const lockPath = path.join(lockDir, `${lockName}.lock`);
  await mkdir(lockDir, { recursive: true });

  while (true) {
    if (deadlineAt && Date.now() >= new Date(deadlineAt).getTime()) {
      const error = new Error(`Timed out waiting for update lock: ${targetDir}`);
      error.code = "ETIMEDOUT";
      throw error;
    }
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${Date.now()}\n`);
        return await action();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      const lockInfo = await stat(lockPath).catch(() => null);
      if (lockInfo && Date.now() - lockInfo.mtimeMs >= TARGET_LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      await delay(TARGET_LOCK_RETRY_MS);
    }
  }
}

async function isInstalledVersionNewer(targetDir, latestVersion) {
  if (!latestVersion) {
    return false;
  }

  const metadata = await readVersionMetadata(targetDir);
  return metadata.version && compareVersions(metadata.version, latestVersion) > 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyAssetDigest(filePath, asset = {}) {
  const match = typeof asset.digest === "string" ? asset.digest.trim().match(/^sha256:([a-f0-9]{64})$/i) : null;
  if (!match) {
    return;
  }

  const actualDigest = createHash("sha256").update(await readFile(filePath)).digest("hex");
  if (actualDigest.toLowerCase() !== match[1].toLowerCase()) {
    throw new Error(`Release asset digest mismatch: expected ${match[1]}, got ${actualDigest}`);
  }
}

export async function downloadAsset(downloadUrl, zipPath, requestOptions = {}) {
  if (downloadUrl.startsWith("file:")) {
    await cp(fileURLToPath(downloadUrl), zipPath, { force: true });
    return;
  }

  try {
    const response = await fetchWithProxy(downloadUrl, {
      headers: {
        "User-Agent": "agent-seed-updater",
      },
    }, requestOptions);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
    return;
  } catch (nodeError) {
    await downloadViaCurlFallback(downloadUrl, zipPath, requestOptions, nodeError);
  }
}

async function downloadViaCurlFallback(downloadUrl, zipPath, requestOptions = {}, nodeError = null) {
  const env = requestOptions.env || process.env;
  const commandRunner = requestOptions.commandRunner || runCapture;
  const proxyUrl = resolveProxyForUrl(downloadUrl, env);
  const args = ["-sS", "-L", "--max-time", "120", "-A", "agent-seed-updater", "-o", zipPath];

  if (proxyUrl) {
    args.push("-x", proxyUrl, "-k");
  }

  args.push(downloadUrl);

  try {
    await commandRunner("curl", args, { env });
  } catch (curlError) {
    throw wrapCurlFallbackError(curlError, nodeError);
  }
}

async function fetchJsonViaCurlFallback(url, requestOptions = {}, nodeError = null) {
  const env = requestOptions.env || process.env;
  const commandRunner = requestOptions.commandRunner || runCapture;
  const proxyUrl = resolveProxyForUrl(url, env);
  const args = ["-sS", "-L", "--max-time", "60", "-A", "agent-seed-updater", "-H", "Accept: application/vnd.github+json"];

  if (proxyUrl) {
    args.push("-x", proxyUrl, "-k");
  }

  args.push(url);

  let stdout;
  try {
    stdout = await commandRunner("curl", args, { env });
  } catch (curlError) {
    throw wrapCurlFallbackError(curlError, nodeError);
  }

  try {
    return JSON.parse(String(stdout || ""));
  } catch (parseError) {
    const wrapped = new Error(`curl fallback returned invalid JSON: ${parseError.message}`, { cause: parseError });
    wrapped.curlFailed = true;
    wrapped.nodeError = nodeError;
    throw wrapped;
  }
}

function wrapCurlFallbackError(curlError, nodeError) {
  const reason = String(curlError?.message || "").trim() || String(curlError?.code || "");
  const wrapped = new Error(
    [
      `curl fallback download also failed: ${reason}`,
      nodeError ? `prior Node download error: ${nodeError.message}` : "",
    ].filter(Boolean).join("\n"),
    { cause: curlError },
  );
  wrapped.code = curlError?.code;
  wrapped.curlFailed = true;
  wrapped.nodeError = nodeError;
  return wrapped;
}

async function fetchWithProxy(url, init = {}, { env = process.env, fetchImpl = fetch, maxRedirects = 5 } = {}) {
  if (fetchImpl !== fetch) {
    return fetchImpl(url, init);
  }

  const proxyUrl = resolveProxyForUrl(url, env);
  if (!proxyUrl) {
    return fetchImpl(url, init);
  }

  return fetchViaHttpProxy(url, init, { env, maxRedirects });
}

export function resolveProxyForUrl(url, env = process.env) {
  const requestUrl = new URL(url);
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (matchesNoProxy(requestUrl.hostname, noProxy)) {
    return "";
  }

  const candidateNames =
    requestUrl.protocol === "https:"
      ? ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
      : ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

  for (const name of candidateNames) {
    if (typeof env[name] === "string" && env[name].trim() !== "") {
      return env[name].trim();
    }
  }

  return "";
}

function matchesNoProxy(hostname, noProxy) {
  if (typeof noProxy !== "string" || noProxy.trim() === "") {
    return false;
  }

  const host = hostname.toLowerCase();
  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }

      if (entry.startsWith(".")) {
        return host.endsWith(entry);
      }

      return host === entry || host.endsWith(`.${entry}`);
    });
}

async function fetchViaHttpProxy(url, init = {}, { env = process.env, maxRedirects = 5 } = {}) {
  const proxyUrl = resolveProxyForUrl(url, env);
  const response = await requestViaHttpProxy(url, init, proxyUrl);

  if (isRedirect(response.status) && response.headers.location && maxRedirects > 0) {
    const nextUrl = new URL(response.headers.location, url).href;
    return fetchViaHttpProxy(nextUrl, init, { env, maxRedirects: maxRedirects - 1 });
  }

  return response;
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function requestViaHttpProxy(url, init, proxyUrl) {
  const requestUrl = new URL(url);
  const proxy = new URL(proxyUrl);

  if (requestUrl.protocol !== "https:" || proxy.protocol !== "http:") {
    throw new Error("agent-seed proxy support currently requires an http:// proxy for https:// update URLs.");
  }

  const agent = createHttpProxyAgent(proxy);

  return new Promise((resolve, reject) => {
    const request = https.request(
      requestUrl,
      {
        method: init.method || "GET",
        headers: init.headers || {},
        agent,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve(
            new BufferedResponse({
              status: response.statusCode || 0,
              statusText: response.statusMessage || "",
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        });
      },
    );

    request.setTimeout(30_000, () => {
      request.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }));
    });
    request.on("error", reject);
    request.end(init.body);
  });
}

function createHttpProxyAgent(proxy) {
  return new https.Agent({
    keepAlive: false,
    createConnection(options, callback) {
      const targetHost = options.hostname || options.host;
      const targetPort = options.port || 443;
      const headers = {
        Host: `${targetHost}:${targetPort}`,
      };

      if (proxy.username || proxy.password) {
        headers["Proxy-Authorization"] = `Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
        ).toString("base64")}`;
      }

      const connectRequest = http.request({
        host: proxy.hostname,
        port: proxy.port || 80,
        method: "CONNECT",
        path: `${targetHost}:${targetPort}`,
        headers,
      });

      let settled = false;
      const finish = (error, socket) => {
        if (settled) {
          return;
        }

        settled = true;
        callback(error, socket);
      };

      connectRequest.on("connect", (response, socket) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          finish(new Error(`Proxy CONNECT failed: ${response.statusCode} ${response.statusMessage || ""}`.trim()));
          return;
        }

        const tlsSocket = tls.connect({
          socket,
          servername: targetHost,
        });
        tlsSocket.once("secureConnect", () => finish(null, tlsSocket));
        tlsSocket.once("error", (error) => finish(error));
      });
      connectRequest.once("error", (error) => finish(error));
      connectRequest.end();
    },
  });
}

class BufferedResponse {
  constructor({ status, statusText, headers, body }) {
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.body = body;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  async json() {
    return JSON.parse(this.body.toString("utf8"));
  }

  async arrayBuffer() {
    return this.body.buffer.slice(this.body.byteOffset, this.body.byteOffset + this.body.byteLength);
  }
}

async function replaceDirectory({ sourceDir, targetDir, backupDir }) {
  const backupExists = await stat(backupDir).then(() => true, (error) => {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  });
  if (!backupExists) {
    await cp(targetDir, backupDir, { recursive: true, force: true });
  }

  try {
    await rm(targetDir, { recursive: true, force: true });
    await cp(sourceDir, targetDir, { recursive: true, force: true });
  } catch (error) {
    await restoreDirectory({ sourceDir: backupDir, targetDir });
    throw error;
  }
}

async function extractZip(zipPath, extractDir) {
  await mkdir(extractDir, { recursive: true });
  if (process.platform === "win32") {
    try {
      await run("tar", ["-xf", zipPath, "-C", extractDir]);
      return;
    } catch {
      await run("powershell", [
        "-NoProfile",
        "-Command",
        "& { param($zipPath, $extractDir) Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force }",
        zipPath,
        extractDir,
      ]);
      return;
    }
  }

  await run("unzip", ["-q", "-o", zipPath, "-d", extractDir]);
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...options });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options,
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      const error = new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited with code ${code}`);
      error.code = code;
      reject(error);
    });
  });
}

async function readGitProxyConfig({ cwd = process.cwd(), commandRunner = runCapture } = {}) {
  const commands = [
    ["git", ["config", "--get-urlmatch", "http.proxy", "https://api.github.com/"]],
    ["git", ["config", "--get", "https.proxy"]],
    ["git", ["config", "--get", "http.proxy"]],
  ];

  for (const [command, args] of commands) {
    try {
      const value = (await commandRunner(command, args, { cwd })).trim();
      if (value) {
        return value;
      }
    } catch {
      // Git may be unavailable, outside a repository, or have no proxy configured.
    }
  }

  return "";
}

async function readWindowsSystemProxyConfig({ platform = process.platform, commandRunner = runCapture } = {}) {
  if (platform !== "win32") {
    return {};
  }

  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

  try {
    const proxyEnableOutput = await commandRunner("reg", ["query", key, "/v", "ProxyEnable"]);
    const proxyEnable = parseRegValue(proxyEnableOutput, "ProxyEnable");
    if (!/^0x1$/i.test(proxyEnable)) {
      return {};
    }

    const proxyServerOutput = await commandRunner("reg", ["query", key, "/v", "ProxyServer"]);
    const proxyServer = parseRegValue(proxyServerOutput, "ProxyServer");
    const httpsProxy = normalizeWindowsProxyServer(proxyServer);
    const noProxy = await readWindowsProxyOverride({ key, commandRunner });

    if (!httpsProxy && !noProxy) {
      return {};
    }

    return { httpsProxy, noProxy };
  } catch {
    return {};
  }
}

async function readWindowsProxyOverride({ key, commandRunner }) {
  try {
    const proxyOverrideOutput = await commandRunner("reg", ["query", key, "/v", "ProxyOverride"]);
    return normalizeWindowsProxyOverride(parseRegValue(proxyOverrideOutput, "ProxyOverride"));
  } catch {
    return "";
  }
}

function parseRegValue(output, name) {
  const line = String(output || "")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(name));

  if (!line) {
    return "";
  }

  const match = line.trim().match(/^\S+\s+REG_\S+\s+(.+)$/);
  return match ? match[1].trim() : "";
}

function normalizeWindowsProxyServer(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const entries = value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const byScheme = new Map();

  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      byScheme.set("default", entry);
    } else {
      byScheme.set(entry.slice(0, separatorIndex).toLowerCase(), entry.slice(separatorIndex + 1));
    }
  }

  return normalizeProxyUrl(byScheme.get("https") || byScheme.get("http") || byScheme.get("default") || "");
}

function normalizeProxyUrl(value) {
  const proxy = String(value || "").trim();
  if (!proxy) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy)) {
    return proxy;
  }

  return `http://${proxy}`;
}

function normalizeWindowsProxyOverride(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== "<local>")
    .join(",");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
