#!/usr/bin/env python3
"""
deploy_graphify —— 把 .understory/ AI 隐藏层骨架部署到 vault。

幂等：可重复调用，不覆盖已有数据（principles.sqlite / conflicts.json 等）。
脚本模板从 kg 的「权威副本」目录同步到 vault/.understory/scripts/。

权威副本来源（优先级）：
  1. {kg_skill}/graphify-template/scripts/      （随 skill 分发的模板）
  2. {vault}/.understory/scripts/                 （已存在则视为最新，仅补缺）

用法：
    python deploy_graphify.py --vault "C:/Users/ryshi/Documents/AIC-000"
"""
import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

KG_SKILL = Path(__file__).resolve().parent.parent
HIDDEN_DIR = ".understory"
LEGACY_HIDDEN_DIR = ".graphify"

# .understory/scripts 下应当存在的脚本
SCRIPT_FILES = [
    "graphify_common.py",
    "ingest_principles.py",
    "lint.py",
    "graph_analyzer.py",
    "index_generator.py",
    "notification_manager.py",
]


def _template_dir() -> Path | None:
    cand = KG_SKILL / "graphify-template" / "scripts"
    return cand if cand.exists() else None


def _unique_archive_root(gdir: Path) -> Path:
    base = gdir / "migration-conflicts" / (
        "graphify-legacy-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    archive = base
    idx = 1
    while archive.exists():
        archive = Path(f"{base}-{idx}")
        idx += 1
    return archive


def _archive_conflict(src: Path, archive_root: Path, rel_path: Path) -> str:
    target = archive_root / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(target))
    return rel_path.as_posix()


def _merge_legacy_dir(src: Path, dst: Path, archive_root: Path, rel_root: Path | None = None) -> tuple[int, list[str]]:
    """Move legacy contents into .understory; archive conflicts so .graphify is removed."""
    moved = 0
    archived: list[str] = []
    rel_root = rel_root or Path()
    dst.mkdir(parents=True, exist_ok=True)
    for child in src.iterdir():
        rel_path = rel_root / child.name
        target = dst / child.name
        if target.exists():
            if child.is_dir() and target.is_dir():
                nested_moved, nested_archived = _merge_legacy_dir(child, target, archive_root, rel_path)
                moved += nested_moved
                archived.extend(nested_archived)
            else:
                archived.append(_archive_conflict(child, archive_root, rel_path))
            continue
        shutil.move(str(child), str(target))
        moved += 1
    try:
        src.rmdir()
    except OSError as exc:
        raise RuntimeError(f"Failed to remove legacy hidden dir after migration: {src}") from exc
    return moved, archived


def _migrate_legacy_hidden_dir(vault_path: Path) -> dict:
    old = vault_path / LEGACY_HIDDEN_DIR
    new = vault_path / HIDDEN_DIR
    if not old.exists():
        return {"status": "none"}
    if not new.exists():
        shutil.move(str(old), str(new))
        return {"status": "moved", "from": str(old), "to": str(new), "legacy_exists": False}
    archive_root = _unique_archive_root(new)
    moved, archived = _merge_legacy_dir(old, new, archive_root)
    if old.exists():
        raise RuntimeError(f"Legacy hidden dir still exists after migration: {old}")
    return {
        "status": "merged_with_conflict_archive" if archived else "merged",
        "from": str(old),
        "to": str(new),
        "moved_items": moved,
        "archived_conflicts": archived,
        "archive_dir": str(archive_root) if archive_root.exists() else None,
        "legacy_exists": False,
    }


def deploy_graphify_to_vault(vault_path: Path) -> dict:
    vault_path = Path(vault_path)
    legacy_migration = _migrate_legacy_hidden_dir(vault_path)
    gdir = vault_path / HIDDEN_DIR
    sdir = gdir / "scripts"
    for d in (gdir, sdir, gdir / "logs", gdir / "notifications"):
        d.mkdir(parents=True, exist_ok=True)

    deployed, skipped = [], []
    template = _template_dir()

    # 1. 同步脚本（若有模板源且 vault 缺失/更旧则复制）
    if template:
        for name in SCRIPT_FILES:
            src = template / name
            dst = sdir / name
            if not src.exists():
                continue
            if (not dst.exists()) or (src.stat().st_mtime > dst.stat().st_mtime):
                shutil.copy2(src, dst)
                deployed.append(name)
            else:
                skipped.append(name)
    else:
        # 没有模板源：只校验 vault 内脚本是否齐全
        for name in SCRIPT_FILES:
            (skipped if (sdir / name).exists() else deployed).append(name)

    # 2. 初始化 principles.sqlite（幂等）
    db_status = "exists"
    db_path = gdir / "principles.sqlite"
    if not db_path.exists():
        try:
            sys.path.insert(0, str(sdir))
            import ingest_principles  # type: ignore
            ingest_principles.init_database(db_path)
            db_status = "created"
        except Exception as e:
            db_status = f"error: {e}"
        finally:
            if str(sdir) in sys.path:
                sys.path.remove(str(sdir))

    # 3. 部署 AGENTS.md（不覆盖已有）
    agents = gdir / "AGENTS.md"
    agents_status = "exists"
    if not agents.exists():
        tmpl_agents = KG_SKILL / "graphify-template" / "AGENTS.md"
        if tmpl_agents.exists():
            shutil.copy2(tmpl_agents, agents)
            agents_status = "deployed"
        else:
            agents_status = "missing_template"

    missing = [n for n in SCRIPT_FILES if not (sdir / n).exists()]
    return {
        "status": "ok" if not missing else "incomplete",
        "vault": str(vault_path),
        "deployed": deployed,
        "skipped": skipped,
        "missing": missing,
        "db_status": db_status,
        "agents_status": agents_status,
        "template_source": str(template) if template else None,
        "hidden_dir": HIDDEN_DIR,
        "legacy_migration": legacy_migration,
    }


def main():
    parser = argparse.ArgumentParser(description="Deploy .understory skeleton to vault")
    parser.add_argument("--vault", required=True, help="Vault 根路径")
    args = parser.parse_args()
    print(json.dumps(deploy_graphify_to_vault(Path(args.vault)), ensure_ascii=False))


if __name__ == "__main__":
    main()
