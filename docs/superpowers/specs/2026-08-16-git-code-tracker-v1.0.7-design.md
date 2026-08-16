# git-code-tracker v1.0.7 Upgrade Design

**Goal:** Update the bundled `git-code-tracker` package in `agent-seed` to
`v1.0.7` and keep the project-local installer aligned with the new release.

## Scope

- Pin `git-code-tracker` to tag `v1.0.7` and commit
  `d882fc8ba66b5aadf32e0c445389e51eaa17ae7f`.
- Replace the vendored release asset with
  `ai-commit-statistic-skill-v1.0.7.zip`.
- Update installer defaults, release metadata, bilingual documentation, and
  tests that assert the package version or download URL.
- Preserve the existing platform detection, upload URL behavior, backup-free
  staging flow, and platform-specific installation paths.
- Add regression coverage for the new release's AI-source tracking surface:
  four Git hook integrations and the package's `1.0.7` installed marker.

## Design

`skill/bundled-packages.json` remains the source of truth for the package
version, immutable source commit, asset name, and asset path. The installer
continues to read this manifest at runtime, so its default archive path only
needs to track the vendored asset filename. The archive is verified by the
release metadata test and by the installer integration tests against a real
temporary Git repository.

The v1.0.7 archive is compatible with the current platform source paths and
installer entry point. No new production abstraction is needed. Tests will
assert that installation produces the new version marker and the new
`pre-commit`, `post-commit`, `pre-push`, and `post-rewrite` hook blocks, while
existing upload configuration preservation and download fallback behavior
remain covered.

## Verification

- Run the focused tracker release tests during the red-green cycle.
- Run the full `make check` suite.
- Run `make release` to rebuild and validate the packaged Agent Seed output.
- Verify the vendored ZIP SHA-256 against the upstream release digest.
