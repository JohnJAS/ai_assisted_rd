import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { installGitCodeTracker, selectPlatforms } from "../skill/scripts/install-git-code-tracker.mjs";

const execFileAsync = promisify(execFile);
const archivePath = path.join(process.cwd(), "skill", "packages", "git-code-tracker", "ai-commit-statistic-skill-v1.0.7.zip");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createGitRepository() {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-tracker-install-"));
  await execFileAsync("git", ["init"], { cwd: targetDir });
  return targetDir;
}

test("selectPlatforms detects the only project platform", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-tracker-detect-"));

  try {
    await mkdir(path.join(targetDir, ".claude"));

    assert.deepEqual(await selectPlatforms({ targetDir, env: {} }), ["claude"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("selectPlatforms rejects conflicting project platforms", async () => {
  const targetDir = await mkdtemp(path.join(tmpdir(), "agent-seed-tracker-ambiguous-"));

  try {
    await Promise.all([mkdir(path.join(targetDir, ".claude")), mkdir(path.join(targetDir, ".cac"))]);

    await assert.rejects(
      selectPlatforms({ targetDir, env: {} }),
      /Unable to determine a single target platform/,
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("selectPlatforms rejects an unsupported explicit platform", async () => {
  await assert.rejects(
    selectPlatforms({ targetDir: process.cwd(), platform: "codex", env: {} }),
    /Unsupported platform: codex/,
  );
});

test("installGitCodeTracker copies and initializes only the detected Claude asset", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));

    await installGitCodeTracker({ targetDir, env: {}, archivePath });

    assert.equal(await exists(path.join(targetDir, ".claude", "skills", "ai-code-tracker", "SKILL.md")), true);
    assert.equal(await exists(path.join(targetDir, ".opencode", "skills", "ai-code-tracker", "SKILL.md")), false);
    assert.equal(await exists(path.join(targetDir, ".cac", "skills", "ai-code-tracker", "SKILL.md")), false);
    assert.match(await readFile(path.join(targetDir, "AGENTS.md"), "utf8"), /Claude Code skill `ai-code-tracker`/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker initializes every explicitly requested platform", async () => {
  const targetDir = await createGitRepository();

  try {
    await installGitCodeTracker({ targetDir, platform: "all", env: {}, archivePath });

    for (const platformDir of [".claude", ".opencode", ".cac"]) {
      assert.equal(await exists(path.join(targetDir, platformDir, "skills", "ai-code-tracker", "SKILL.md")), true);
    }
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker applies the manifest upload default to a new config", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));

    await installGitCodeTracker({ targetDir, env: {} });

    const config = JSON.parse(await readFile(path.join(targetDir, ".ai-tracking", "config.json"), "utf8"));
    assert.equal(config.installedVersion, "1.0.7");
    assert.equal(config.uploadUrl, "http://7.213.196.158:8088/v1/records");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker installs v1.0.7 AI source tracking hooks", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));

    await installGitCodeTracker({ targetDir, env: {}, archivePath });

    for (const hookName of ["pre-commit", "post-commit", "pre-push", "post-rewrite"]) {
      const hook = await readFile(path.join(targetDir, ".git", "hooks", hookName), "utf8");
      assert.match(hook, /ai-code-tracker begin/);
      assert.match(hook, /commit-stats\.js/);
    }
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker preserves a non-empty project upload URL", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));
    await mkdir(path.join(targetDir, ".ai-tracking"));
    await writeFile(
      path.join(targetDir, ".ai-tracking", "config.json"),
      `${JSON.stringify({ enabled: true, uploadUrl: "https://project.example/records" })}\n`,
    );

    await installGitCodeTracker({ targetDir, env: {}, archivePath });

    const config = JSON.parse(await readFile(path.join(targetDir, ".ai-tracking", "config.json"), "utf8"));
    assert.equal(config.uploadUrl, "https://project.example/records");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker rejects an invalid tracker config before verification", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));
    await mkdir(path.join(targetDir, ".ai-tracking"));
    await writeFile(path.join(targetDir, ".ai-tracking", "config.json"), "not json\n");

    await assert.rejects(
      installGitCodeTracker({ targetDir, env: {}, archivePath }),
      /Invalid tracker config/,
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker downloads the release asset when the bundled zip is missing", async () => {
  const targetDir = await createGitRepository();
  const downloaded = [];
  const missingArchivePath = path.join(targetDir, "missing.zip");

  try {
    await mkdir(path.join(targetDir, ".claude"));

    await installGitCodeTracker({
      targetDir,
      env: {},
      archivePath: missingArchivePath,
      downloadAsset: async (downloadUrl, zipPath) => {
        downloaded.push({ downloadUrl, zipPath });
        await writeFile(zipPath, await readFile(archivePath));
      },
    });

    assert.equal(downloaded.length, 1);
    assert.equal(
      downloaded[0].downloadUrl,
      "https://github.com/yooocen/git-code-tracker/releases/download/v1.0.7/ai-commit-statistic-skill-v1.0.7.zip",
    );
    assert.equal(downloaded[0].zipPath, missingArchivePath);
    assert.equal(await exists(path.join(targetDir, ".claude", "skills", "ai-code-tracker", "SKILL.md")), true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("installGitCodeTracker adds a zip ignore rule to the target repository", async () => {
  const targetDir = await createGitRepository();

  try {
    await mkdir(path.join(targetDir, ".claude"));

    await installGitCodeTracker({ targetDir, env: {}, archivePath });

    const gitignore = await readFile(path.join(targetDir, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.claude\/skills\/agent-seed\/packages\/git-code-tracker\/\*\.zip$/m);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
