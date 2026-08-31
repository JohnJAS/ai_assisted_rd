import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { downloadAsset } from "./update-agent-seed.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARCHIVE_PATH = path.join(scriptDir, "..", "packages", "git-code-tracker", "ai-commit-statistic-skill-v1.0.7.zip");
const BUNDLED_PACKAGES_PATH = path.join(scriptDir, "..", "bundled-packages.json");
const TARGET_GITIGNORE_RULE = ".claude/skills/agent-seed/packages/git-code-tracker/*.zip";

const PLATFORMS = {
  opencode: {
    sourcePath: path.join(".opencode", "skills", "ai-code-tracker"),
    targetPath: path.join(".opencode", "skills", "ai-code-tracker"),
  },
  claude: {
    sourcePath: path.join(".claude", "skills", "ai-code-tracker"),
    targetPath: path.join(".claude", "skills", "ai-code-tracker"),
  },
  "codeagent-cli": {
    sourcePath: path.join(".cac", "skills", "ai-code-tracker"),
    targetPath: path.join(".cac", "skills", "ai-code-tracker"),
  },
};

export async function selectPlatforms({ targetDir, platform, env = process.env }) {
  const explicitPlatform = normalizePlatform(platform);
  if (explicitPlatform) {
    return explicitPlatform === "all" ? Object.keys(PLATFORMS) : [explicitPlatform];
  }

  const runtimePlatform = detectRuntimePlatform(env);
  if (runtimePlatform) {
    return [runtimePlatform];
  }

  const projectPlatforms = await detectProjectPlatforms(targetDir);
  if (projectPlatforms.length === 1) {
    return projectPlatforms;
  }

  throw new Error("Unable to determine a single target platform. Re-run with --platform <opencode|claude|codeagent-cli|all>.");
}

export async function installGitCodeTracker({
  targetDir = process.cwd(),
  platform,
  env = process.env,
  archivePath = DEFAULT_ARCHIVE_PATH,
  downloadAsset: downloadAssetImpl = downloadAsset,
} = {}) {
  const resolvedTargetDir = path.resolve(targetDir);
  const resolvedArchivePath = path.resolve(archivePath);
  const packageManifest = await loadBundledPackagesManifest();
  const tracker = getGitCodeTrackerPackage(packageManifest);

  if (!(await fileExists(resolvedArchivePath))) {
    const downloadUrl = buildReleaseAssetUrl(tracker);
    await mkdir(path.dirname(resolvedArchivePath), { recursive: true });
    await downloadAssetImpl(downloadUrl, resolvedArchivePath, { env });
  }

  const platforms = await selectPlatforms({ targetDir: resolvedTargetDir, platform, env });
  const uploadConfig = await loadTrackerUploadConfig(packageManifest);
  await updateTargetGitignore(resolvedTargetDir);
  for (const selectedPlatform of platforms) {
    await installPlatform({
      targetDir: resolvedTargetDir,
      platform: selectedPlatform,
      env,
      archivePath: resolvedArchivePath,
      uploadConfig,
    });
  }

  return { targetDir: resolvedTargetDir, platforms };
}

async function installPlatform({ targetDir, platform, env, archivePath, uploadConfig }) {
  const config = PLATFORMS[platform];
  const stagingDir = await mkdtemp(path.join(tmpdir(), "agent-seed-git-code-tracker-"));

  try {
    await extractArchive(archivePath, stagingDir);

    const sourceDir = path.join(stagingDir, config.sourcePath);
    await assertDirectory(sourceDir, `${platform} skill in release asset`);

    const targetSkillDir = path.join(targetDir, config.targetPath);
    await rm(targetSkillDir, { recursive: true, force: true });
    await cp(sourceDir, targetSkillDir, { recursive: true });

    const installScript = path.join(targetSkillDir, "scripts", "install.js");
    const installEnv = { ...env, AI_CODE_TRACKER_PROCESS_TREE: platform };
    await execFileAsync(process.execPath, [installScript], { cwd: targetDir, env: installEnv });
    await applyUploadDefault({ targetDir, uploadConfig });
    await execFileAsync(process.execPath, [installScript, "--check"], { cwd: targetDir, env: installEnv });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function loadBundledPackagesManifest() {
  try {
    return JSON.parse(await readFile(BUNDLED_PACKAGES_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read bundled package manifest: ${error.message}`);
  }
}

function getGitCodeTrackerPackage(manifest) {
  const tracker = manifest.bundled_packages?.find((entry) => entry.name === "git-code-tracker");
  if (!tracker) {
    throw new Error("Missing git-code-tracker package entry in bundled-packages.json");
  }
  if (tracker.source?.type !== "github-release-asset" || typeof tracker.source.repo !== "string" || typeof tracker.source.ref !== "string" || typeof tracker.source.asset !== "string") {
    throw new Error("Invalid git-code-tracker release metadata in bundled-packages.json");
  }
  return tracker;
}

function buildReleaseAssetUrl(tracker) {
  const repo = tracker.source.repo.replace(/\/$/, "");
  const ref = tracker.source.ref.replace(/^refs\/tags\//, "");
  return `${repo}/releases/download/${ref}/${tracker.source.asset}`;
}

async function loadTrackerUploadConfig(manifest) {
  const tracker = getGitCodeTrackerPackage(manifest);
  const upload = tracker?.upload;
  if (
    !upload ||
    upload.config_path !== ".ai-tracking/config.json" ||
    typeof upload.default_url !== "string" ||
    upload.default_url.trim() === "" ||
    upload.preserve_existing_url !== true
  ) {
    throw new Error("Invalid git-code-tracker upload configuration in bundled-packages.json");
  }

  return {
    configPath: upload.config_path,
    defaultUrl: upload.default_url.trim(),
    preserveExistingUrl: upload.preserve_existing_url,
  };
}

async function updateTargetGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== TARGET_GITIGNORE_RULE);
  lines.push(TARGET_GITIGNORE_RULE);
  const next = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  if (next === content) {
    return false;
  }
  await writeFile(gitignorePath, next, "utf8");
  return true;
}

async function applyUploadDefault({ targetDir, uploadConfig }) {
  const configPath = path.resolve(targetDir, uploadConfig.configPath);
  const relativePath = path.relative(targetDir, configPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid tracker config path: ${uploadConfig.configPath}`);
  }

  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid tracker config: ${configPath} (${error.message})`);
  }
  if (!config || Array.isArray(config) || typeof config !== "object") {
    throw new Error(`Invalid tracker config: ${configPath} must contain a JSON object`);
  }

  if (uploadConfig.preserveExistingUrl && typeof config.uploadUrl === "string" && config.uploadUrl.trim() !== "") {
    return false;
  }

  config.uploadUrl = uploadConfig.defaultUrl;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

async function extractArchive(archivePath, destinationDir) {
  try {
    await execFileAsync("tar", ["-xf", archivePath, "-C", destinationDir], { windowsHide: true });
    return;
  } catch {}

  const command = [
    "-NoProfile",
    "-Command",
    [
      "& { param($archivePath, $destinationDir)",
      "Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationDir -Force",
      "}",
    ].join("; "),
    archivePath,
    destinationDir,
  ];

  await execFileAsync("powershell", command, { windowsHide: true });
}

function normalizePlatform(value) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === "opencode") {
    return "opencode";
  }
  if (normalized === "claude" || normalized === "claude-code") {
    return "claude";
  }
  if (normalized === "codeagent-cli" || normalized === "codeagent" || normalized === "cac") {
    return "codeagent-cli";
  }
  if (normalized === "all") {
    return "all";
  }

  throw new Error(`Unsupported platform: ${value}`);
}

function detectRuntimePlatform(env) {
  return normalizePlatform(
    env.AGENT_SEED_PLATFORM ||
      env.AI_AGENT_PLATFORM ||
      (env.CLAUDE_CODE || env.CLAUDE_CODE_SESSION ? "claude" : "") ||
      (env.CAC_SESSION || env.CODEAGENT_CLI || env.CODEAGENT_SESSION ? "codeagent-cli" : "") ||
      (env.OPENCODE_SESSION ? "opencode" : ""),
  );
}

async function detectProjectPlatforms(targetDir) {
  const detected = [];
  for (const [platform, marker] of [
    ["opencode", ".opencode"],
    ["claude", ".claude"],
    ["codeagent-cli", ".cac"],
  ]) {
    try {
      await access(path.join(targetDir, marker));
      detected.push(platform);
    } catch {}
  }
  return detected;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertDirectory(directoryPath, label) {
  try {
    await access(directoryPath);
  } catch {
    throw new Error(`Missing ${label}: ${directoryPath}`);
  }
}

function parseArgs(args) {
  let targetDir = null;
  let platform = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
      platform = args[index += 1];
      if (!platform) {
        throw new Error("--platform requires a value");
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error("Usage: node scripts/install-git-code-tracker.mjs [target-project] [--platform <opencode|claude|codeagent-cli|all>]");
    }
    if (!targetDir) {
      targetDir = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { targetDir: targetDir ?? process.cwd(), platform };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  installGitCodeTracker(parseArgs(process.argv.slice(2)))
    .then(({ platforms }) => console.log(`git-code-tracker installed for ${platforms.join(", ")}`))
    .catch((error) => {
      console.error(`[git-code-tracker] ${error.message}`);
      process.exitCode = 1;
    });
}
