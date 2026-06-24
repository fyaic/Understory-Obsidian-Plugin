#!/usr/bin/env python3
"""
AIC-2190: Embedding 索引增量守护进程。

定时扫描 vault，利用 mtime 预筛选只处理变更的文件，保持索引近实时更新。
可独立运行，也可作为后台任务（如 Windows Task Scheduler / cron）调用。

用法:
    python scripts/index_daemon.py              # 每 30 分钟扫描一次（守护模式）
    python scripts/index_daemon.py --once       # 只执行一次
    python scripts/index_daemon.py --interval 600  # 每 10 分钟扫描一次
"""
import json
import os
import sys
import time
from pathlib import Path

# 确保能导入 api.py 中的函数
_script_dir = Path(__file__).resolve().parent
_project_root = _script_dir.parent
sys.path.insert(0, str(_project_root))

# 自动加载 .env
_env_file = _project_root / ".env"
try:
    from dotenv import load_dotenv
    if _env_file.exists():
        load_dotenv(_env_file, override=False)
except Exception:
    pass

from api import _ensure_index_fresh, detect_vault_path


def _log(msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def run_once(vault: Path) -> dict:
    """执行一次增量索引更新。"""
    _log(f"开始增量索引扫描: {vault}")
    result = _ensure_index_fresh(vault)
    if "error" in result:
        _log(f"❌ 索引更新失败: {result['error']}")
    else:
        pruned = result.get("pruned", 0)
        success = result.get("indexed_success", 0)
        fail = result.get("indexed_fail", 0)
        skipped = result.get("skipped_by_mtime", 0)
        scanned = result.get("scanned", 0)
        _log(f"✅ 扫描完成 | 总文件: {scanned} | 跳过(未变更): {skipped} | 清理僵尸: {pruned} | 新增/更新: {success} | 失败: {fail}")
    return result


def run_daemon(vault: Path, interval_sec: int = 1800):
    """守护模式：循环执行增量索引。"""
    _log(f"索引守护进程启动，扫描间隔: {interval_sec} 秒")
    _log(f"Vault 路径: {vault}")
    _log("按 Ctrl+C 停止")

    while True:
        try:
            run_once(vault)
        except KeyboardInterrupt:
            _log("收到中断信号，守护进程退出")
            break
        except Exception as exc:
            _log(f"异常: {exc}")

        _log(f"下次扫描: {interval_sec} 秒后...")
        try:
            time.sleep(interval_sec)
        except KeyboardInterrupt:
            _log("收到中断信号，守护进程退出")
            break


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Embedding Index Daemon (AIC-2190)")
    parser.add_argument("--vault", default=None, help="Vault root path (auto-detected if omitted)")
    parser.add_argument("--interval", type=int, default=1800, help="Scan interval in seconds (default: 1800 = 30min)")
    parser.add_argument("--once", action="store_true", help="Run once and exit (no daemon loop)")
    args = parser.parse_args()

    vault = Path(args.vault) if args.vault else detect_vault_path()

    if args.once:
        result = run_once(vault)
        sys.exit(0 if "error" not in result else 1)
    else:
        run_daemon(vault, interval_sec=args.interval)
