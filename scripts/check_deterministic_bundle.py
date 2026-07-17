#!/usr/bin/env python3
"""Verify that the generated plugin bundle is reproducible from source."""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUNDLER = ROOT / "scripts" / "bundle_obsidian_plugin.py"
GENERATED_BUNDLE = ROOT / "main.js"


def build_bundle(output: Path) -> bytes:
    subprocess.run(
        [
            sys.executable,
            str(BUNDLER),
            "--plugin-dir",
            str(ROOT / "src"),
            "--out",
            str(output),
        ],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return output.read_bytes()


def main() -> None:
    if not GENERATED_BUNDLE.exists():
        raise SystemExit("main.js has not been generated; run npm run build first")

    with tempfile.TemporaryDirectory(prefix="understory-bundle-check-") as tmp:
        tmp_dir = Path(tmp)
        first = build_bundle(tmp_dir / "first.js")
        second = build_bundle(tmp_dir / "second.js")

    if first != second:
        raise SystemExit("Two clean bundle builds produced different bytes")
    if GENERATED_BUNDLE.read_bytes() != first:
        raise SystemExit("Generated main.js does not match a clean source build")

    digest = hashlib.sha256(first).hexdigest()
    print(f"Deterministic bundle OK: sha256={digest}")


if __name__ == "__main__":
    main()
