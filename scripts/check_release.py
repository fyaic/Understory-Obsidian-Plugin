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
LEGACY_ENGINE_ORIGIN_RELEASE = "1.13.0"
LEGACY_ENGINE_SNAPSHOT_SHA256 = "cac720e1033b6be233b9d4b99059604654e5cdcb78d0b688464d66792eb73743"


def release_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if b"\0" in data:
        return data
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def engine_snapshot_digest(engine_dir: Path) -> tuple[int, str]:
    excluded_names = {
        ".cache",
        ".env",
        ".git",
        ".pytest_cache",
        ".serena",
        "__pycache__",
        "config.yaml",
    }
    excluded_suffixes = {".db", ".pyc", ".sqlite"}
    digest = hashlib.sha256()
    files = [
        path
        for path in sorted(
            engine_dir.rglob("*"),
            key=lambda candidate: candidate.relative_to(engine_dir).as_posix(),
        )
        if path.is_file()
        and not (set(path.relative_to(engine_dir).parts) & excluded_names)
        and path.suffix.lower() not in excluded_suffixes
    ]
    for path in files:
        relative = path.relative_to(engine_dir).as_posix()
        file_digest = hashlib.sha256(release_bytes(path)).hexdigest()
        digest.update(relative.encode("utf-8") + b"\0" + file_digest.encode("ascii") + b"\n")
    return len(files), digest.hexdigest()


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
    if manifest.get("authorUrl") != "https://bondie.io":
        raise SystemExit("manifest.json authorUrl must use the live Bondie homepage")

    version = str(manifest["version"])
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Version must use x.y.z format: {version}")

    for filename in [
        "main.js",
        "styles.css",
        "README.md",
        "PRIVACY.md",
        "LICENSE",
        "NOTICE",
        "versions.json",
        "engine-provenance.json",
    ]:
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

    provenance = json.loads((ROOT / "engine-provenance.json").read_text(encoding="utf-8"))
    if provenance.get("schema_version") != 2:
        raise SystemExit("engine-provenance.json schema_version must be 2")
    if provenance.get("plugin_release") != version:
        raise SystemExit("engine-provenance.json plugin_release does not match manifest version")
    if provenance.get("source_repository") != "https://github.com/fyaic/Understory-graphify-engine":
        raise SystemExit("engine-provenance.json has an unexpected source repository")
    snapshot_public_commit = str(provenance.get("snapshot_public_commit") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", snapshot_public_commit):
        raise SystemExit("engine-provenance.json snapshot_public_commit must be a full Git commit SHA")
    source_commit = str(provenance.get("source_commit") or "")
    if source_commit == "legacy-unresolved":
        if provenance.get("snapshot_origin_release") != LEGACY_ENGINE_ORIGIN_RELEASE:
            raise SystemExit("Legacy engine provenance must inherit from release 1.13.0")
        if provenance.get("engine_source_changed") is not False:
            raise SystemExit("Inherited legacy engine provenance must declare engine_source_changed=false")
        if provenance.get("snapshot_sha256") != LEGACY_ENGINE_SNAPSHOT_SHA256:
            raise SystemExit("The inherited legacy engine snapshot digest must remain byte-identical to 1.13.0")
    elif not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise SystemExit("engine-provenance.json source_commit must be a full Git commit SHA")
    snapshot_file_count, snapshot_digest = engine_snapshot_digest(ROOT / "understory-graphify-engine")
    if provenance.get("snapshot_file_count") != snapshot_file_count:
        raise SystemExit("engine-provenance.json snapshot_file_count is stale")
    if provenance.get("snapshot_sha256") != snapshot_digest:
        raise SystemExit("engine-provenance.json snapshot_sha256 is stale")

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
        digest = hashlib.sha256(release_bytes(ROOT / filename)).hexdigest()
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
    scripts = package.get("scripts") or {}
    build_script = str(scripts.get("build") or "")
    if build_script != "node scripts/bundle_obsidian_plugin.js --plugin-dir src --out main.js":
        raise SystemExit("package.json build script must use the Node bundler for clean review environments")
    if "python" in build_script.lower():
        raise SystemExit("package.json build script must not require a python command")
    if str(scripts.get("check:bundle") or "") != "node scripts/check_deterministic_bundle.js":
        raise SystemExit("package.json check:bundle script must validate the Node bundler")

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
    for marker in ["Continue with Bondie", "Optional payments", "provider and model choices are not returned"]:
        if marker not in readme:
            raise SystemExit(f"README.md is missing hosted release disclosure: {marker}")
    for marker in ["Hosted mode is not local-only", "selected snippets", "processing units", "does not read clipboard contents"]:
        if marker not in privacy:
            raise SystemExit(f"PRIVACY.md is missing required data-flow disclosure: {marker}")

    release_workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    for marker in [
        "npm run verify",
        "git diff --exit-code",
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
    if "main.js" in tracked:
        raise SystemExit("Generated main.js must be published in releases, not tracked in the source repository")
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    if "main.js" not in gitignore:
        raise SystemExit(".gitignore must exclude the generated main.js release asset")
    forbidden_tracked_names = {".env", ".DS_Store", "id_rsa", "id_ed25519"}
    for filename in tracked:
        path = Path(filename)
        if path.name in forbidden_tracked_names or path.suffix.lower() in {".pem", ".p12", ".pfx"}:
            raise SystemExit(f"Sensitive or local-only file is tracked: {filename}")

    raw_heading_pattern = re.compile(r"createEl\(\s*['\"]h[1-6]['\"]")
    for source_path in sorted((ROOT / "src").glob("*.js")):
        if raw_heading_pattern.search(source_path.read_text(encoding="utf-8")):
            raise SystemExit(f"Use Obsidian or ARIA heading semantics instead of raw headings: {source_path.name}")

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
