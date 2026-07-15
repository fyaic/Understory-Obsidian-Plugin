#!/usr/bin/env python3
"""Validate the Obsidian release package."""
from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    required = ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"]
    missing = [key for key in required if key not in manifest]
    if missing:
        raise SystemExit(f"manifest.json missing required keys: {', '.join(missing)}")

    plugin_id = str(manifest["id"])
    if not re.fullmatch(r"[a-z][a-z-]*[a-z]", plugin_id):
        raise SystemExit(f"Invalid plugin id: {plugin_id}")
    if "obsidian" in plugin_id or plugin_id.endswith("plugin"):
        raise SystemExit(f"Plugin id violates Obsidian naming guidance: {plugin_id}")

    plugin_name = str(manifest["name"])
    if "obsidian" in plugin_name.lower() or "plugin" in plugin_name.lower():
        raise SystemExit(f"Plugin name violates Obsidian naming guidance: {plugin_name}")

    description = str(manifest["description"])
    if "obsidian" in description.lower():
        raise SystemExit("manifest.json description must not include the word Obsidian")

    version = str(manifest["version"])
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Version must use x.y.z format: {version}")

    for filename in ["main.js", "styles.css", "README.md", "PRIVACY.md", "LICENSE", "NOTICE", "versions.json"]:
        if not (ROOT / filename).exists():
            raise SystemExit(f"Missing required release file: {filename}")

    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    if "Required Notice:" not in notice or "Fuyo AI Tech Co. Limited" not in notice:
        raise SystemExit("NOTICE must include Required Notice and Fuyo AI Tech Co. Limited")

    required_engine_files = [
        "understory-graphify-engine/api.py",
        "understory-graphify-engine/scripts/deploy_graphify.py",
        "understory-graphify-engine/requirements.txt",
    ]
    for filename in required_engine_files:
        if not (ROOT / filename).exists():
            raise SystemExit(f"Missing bundled engine file: {filename}")

    forbidden_engine_files = [
        "understory-graphify-engine/.env",
        "understory-graphify-engine/config.yaml",
        "understory-graphify-engine/.cache/embedding_index.sqlite",
    ]
    for filename in forbidden_engine_files:
        if (ROOT / filename).exists():
            raise SystemExit(f"Forbidden local engine state must not be committed: {filename}")

    main_js = (ROOT / "main.js").read_text(encoding="utf-8")
    for marker in [
        "./authProtocol",
        "./hostedAnalysis",
        "./hostedClient",
        "./hostedDiscovery",
        "./bundledEnginePayload",
        "api.py",
        "scripts/deploy_graphify.py",
        "requirements.txt",
    ]:
        if marker not in main_js:
            raise SystemExit(f"main.js is missing required bundle marker: {marker}")
    if '"./settingsStyles"' in main_js:
        raise SystemExit("main.js still contains the deleted settingsStyles module")
    for filename in required_engine_files:
        digest = hashlib.sha256((ROOT / filename).read_bytes()).hexdigest()
        if digest not in main_js:
            raise SystemExit(f"main.js bundled engine payload is stale for: {filename}")

    lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]
    if not any((ROOT / filename).exists() for filename in lockfiles):
        raise SystemExit("Missing JavaScript lockfile for reproducible build verification")

    versions = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
    if version not in versions:
        raise SystemExit(f"versions.json missing current version: {version}")
    if versions.get(version) != str(manifest["minAppVersion"]):
        raise SystemExit(
            f"versions.json current minAppVersion {versions.get(version)} "
            f"does not match manifest minAppVersion {manifest['minAppVersion']}"
        )

    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if str(package.get("version")) != version:
        raise SystemExit(f"package.json version {package.get('version')} does not match manifest version {version}")

    package_lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    lock_versions = [
        package_lock.get("version"),
        (package_lock.get("packages") or {}).get("", {}).get("version"),
    ]
    mismatched_lock_versions = [item for item in lock_versions if item and str(item) != version]
    if mismatched_lock_versions:
        raise SystemExit(f"package-lock.json version(s) {mismatched_lock_versions} do not match manifest version {version}")

    release_notes = (ROOT / "RELEASE_NOTES.md").read_text(encoding="utf-8")
    if f"# Understory {version}" not in release_notes:
        raise SystemExit(f"RELEASE_NOTES.md does not start with current version {version}")

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if f"## {version}" not in changelog:
        raise SystemExit(f"CHANGELOG.md missing current version {version}")

    for filename in ["README.md", "README.zh-CN.md"]:
        readme = (ROOT / filename).read_text(encoding="utf-8")
        if f"`{version}`" not in readme:
            raise SystemExit(f"{filename} does not mention current release version `{version}`")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    privacy = (ROOT / "PRIVACY.md").read_text(encoding="utf-8")
    for marker in ["Continue with Bondie", "Optional payments", "server-managed provider"]:
        if marker not in readme:
            raise SystemExit(f"README.md is missing hosted release disclosure: {marker}")
    for marker in ["Hosted mode is not local-only", "selected snippets", "processing units", "does not read clipboard contents"]:
        if marker not in privacy:
            raise SystemExit(f"PRIVACY.md is missing required data-flow disclosure: {marker}")

    release_workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    for marker in [
        "npm run verify",
        "git diff --exit-code -- main.js",
        "actions/attest@v4",
        "gh release create",
        "--verify-tag",
    ]:
        if marker not in release_workflow:
            raise SystemExit(f"Release workflow is missing provenance gate: {marker}")
    if not (ROOT / ".github" / "workflows" / "ci.yml").exists():
        raise SystemExit("Missing pull request CI workflow")

    tracked = subprocess.run(
        ["git", "ls-files"],
        cwd=str(ROOT),
        text=True,
        capture_output=True,
        check=True,
    ).stdout.splitlines()
    forbidden_tracked_names = {".env", ".DS_Store", "id_rsa", "id_ed25519"}
    for filename in tracked:
        path = Path(filename)
        if path.name in forbidden_tracked_names or path.suffix.lower() in {".pem", ".p12", ".pfx"}:
            raise SystemExit(f"Sensitive or local-only file is tracked: {filename}")

    subprocess.run(["node", "--check", str(ROOT / "main.js")], check=True)

    with tempfile.TemporaryDirectory(prefix="understory-release-check-") as tmp:
        vault = Path(tmp)
        notes = vault / "Notes"
        notes.mkdir()
        (notes / "A.md").write_text("# A\n\nLocal release smoke note.\n", encoding="utf-8")
        env = os.environ.copy()
        env["UNDERSTORY_NETWORK_MODE"] = "local"
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "understory-graphify-engine" / "api.py"),
                "init",
                "--vault",
                str(vault),
            ],
            cwd=str(ROOT / "understory-graphify-engine"),
            env=env,
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            raise SystemExit(f"Local api.py init smoke failed: {result.stderr or result.stdout}")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Local api.py init did not return JSON: {exc}: {result.stdout}") from exc
        if payload.get("status") != "ok" or payload.get("indexing") != "skipped":
            raise SystemExit(f"Unexpected local api.py init result: {payload}")

    print(f"Release package OK: {manifest['name']} {version}")


if __name__ == "__main__":
    main()
