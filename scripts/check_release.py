#!/usr/bin/env python3
"""Validate the Obsidian release package."""
from __future__ import annotations

import json
import re
import subprocess
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

    version = str(manifest["version"])
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Version must use x.y.z format: {version}")

    for filename in ["main.js", "styles.css", "README.md", "PRIVACY.md", "LICENSE", "versions.json"]:
        if not (ROOT / filename).exists():
            raise SystemExit(f"Missing required release file: {filename}")

    for filename in [
        "understory-graphify-engine/api.py",
        "understory-graphify-engine/scripts/deploy_graphify.py",
        "understory-graphify-engine/requirements.txt",
    ]:
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
    for marker in ["./bundledEnginePayload", "scripts/deploy_graphify.py", "requirements.txt"]:
        if marker not in main_js:
            raise SystemExit(f"main.js is missing bundled engine payload marker: {marker}")

    lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]
    if not any((ROOT / filename).exists() for filename in lockfiles):
        raise SystemExit("Missing JavaScript lockfile for reproducible build verification")

    versions = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
    if version not in versions:
        raise SystemExit(f"versions.json missing current version: {version}")

    subprocess.run(["node", "--check", str(ROOT / "main.js")], check=True)
    print(f"Release package OK: {manifest['name']} {version}")


if __name__ == "__main__":
    main()
