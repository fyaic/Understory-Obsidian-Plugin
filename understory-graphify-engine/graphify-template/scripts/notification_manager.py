#!/usr/bin/env python3
"""
notification_manager —— L6 通知管理。

职责：生成每日冲突摘要文件、判断通知冷却、（可选）推送 webhook。
默认静默：只生成 .understory/notifications/YYYY-MM-DD.md，不弹窗。
冷却：同一冲突 7 天内不重复推送（severity 升级则重新推送）。

用法：
    python notification_manager.py --vault "C:/..." [--webhook URL --webhook-type slack]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import graphify_common as gc

SEV_ICON = {"high": "🔴", "medium": "🟡", "low": "🟢"}
COOLDOWN_DAYS = 7


def _load_conflicts(vault_path: Path) -> dict:
    p = gc.get_graphify_dir(vault_path) / "conflicts.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _cooldown_state_path(vault_path: Path) -> Path:
    return gc.get_graphify_dir(vault_path) / "notifications" / ".cooldown.json"


def _load_cooldown(vault_path: Path) -> dict:
    p = _cooldown_state_path(vault_path)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_cooldown(vault_path: Path, state: dict):
    gc.atomic_write_text(_cooldown_state_path(vault_path),
                         json.dumps(state, ensure_ascii=False, indent=2))


def should_notify_issue(issue: dict, vault_path: Path) -> bool:
    """冷却判断：7 天内同冲突不重复；severity 升级则放行。"""
    state = _load_cooldown(vault_path)
    rec = state.get(issue["id"])
    now = datetime.now()
    if rec:
        try:
            last = datetime.fromisoformat(rec["last_notified"])
        except (ValueError, KeyError):
            last = now - timedelta(days=COOLDOWN_DAYS + 1)
        sev_up = SEV_ORDER_IDX(issue.get("severity")) > SEV_ORDER_IDX(rec.get("severity"))
        if (now - last) < timedelta(days=COOLDOWN_DAYS) and not sev_up:
            return False
    state[issue["id"]] = {"last_notified": now.isoformat(timespec="seconds"),
                          "severity": issue.get("severity")}
    _save_cooldown(vault_path, state)
    return True


def SEV_ORDER_IDX(sev) -> int:
    return {"low": 0, "medium": 1, "high": 2}.get(sev, -1)


def generate_daily_digest(vault_path: Path) -> dict:
    """生成当日冲突摘要 markdown，返回统计。"""
    vault_path = Path(vault_path)
    logger = gc.setup_logger("notify", vault_path)
    conflicts = _load_conflicts(vault_path)
    issues = [i for i in conflicts.get("issues", []) if i.get("status") == "open"]
    issues.sort(key=lambda x: SEV_ORDER_IDX(x.get("severity")), reverse=True)

    today = datetime.now().strftime("%Y-%m-%d")
    ndir = gc.get_graphify_dir(vault_path) / "notifications"
    ndir.mkdir(exist_ok=True)

    high = [i for i in issues if i.get("severity") == "high"]
    medium = [i for i in issues if i.get("severity") == "medium"]
    low = [i for i in issues if i.get("severity") == "low"]

    lines = [f"# 知识库冲突摘要 {today}\n",
             f"> 扫描时间：{conflicts.get('scan_time', '-')}",
             f"> 共 {len(issues)} 项活跃冲突：🔴 {len(high)} · 🟡 {len(medium)} · 🟢 {len(low)}\n",
             "---\n"]
    for label, group in (("🔴 High 严重度", high), ("🟡 Medium 严重度", medium)):
        if not group:
            continue
        lines.append(f"## {label}（{len(group)} 项）\n")
        for it in group[:30]:
            docs = it.get("doc_a") or it.get("doc") or "-"
            if it.get("doc_b"):
                docs += f" vs {it['doc_b']}"
            lines.append(f"- **[{it.get('id')}]** {it.get('type')} | {docs}")
            lines.append(f"  - {it.get('description', '')}")
            if it.get("suggestion"):
                lines.append(f"  - 💡 {it['suggestion']}")
        lines.append("")
    if low:
        lines.append(f"## 🟢 Low 严重度（{len(low)} 项，折叠）\n")
        lines.append(f"详见 [[.understory/conflicts.json]]（含 {len(low)} 项低优先级问题）\n")
    lines.append("---\n> 完整索引：[[.understory/index]]")

    out_path = ndir / f"{today}.md"
    gc.atomic_write_text(out_path, "\n".join(lines) + "\n")
    gc.rotate_logs(vault_path)
    gc.rotate_notifications(vault_path)
    logger.info(f"daily digest: high={len(high)} medium={len(medium)} low={len(low)} -> {out_path.name}")
    return {"status": "ok", "high": len(high), "medium": len(medium),
            "low": len(low), "path": str(out_path)}


def _webhook_request_allowed(enabled: bool | None) -> bool:
    try:
        scripts_dir = gc.get_kg_skill_path() / "scripts"
        scripts_path = str(scripts_dir)
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        from network_policy import webhook_allowed  # type: ignore
        return webhook_allowed(enabled)
    except Exception:
        mode = os.environ.get("UNDERSTORY_NETWORK_MODE", "local").strip().lower()
        if mode in {"", "local", "local_only", "offline", "none", "no_network"}:
            return False
        if enabled is not None:
            return bool(enabled)
        return os.environ.get("UNDERSTORY_WEBHOOK_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def send_webhook(webhook_url: str, webhook_type: str, vault_path: Path, enabled: bool | None = None) -> bool:
    """推送当日 high/medium 摘要到 webhook（slack/feishu/wecom/custom）。"""
    if not webhook_url:
        return False
    if not _webhook_request_allowed(enabled):
        return False
    try:
        import requests
    except Exception:
        return False
    conflicts = _load_conflicts(vault_path)
    issues = [i for i in conflicts.get("issues", []) if i.get("status") == "open"]
    high = [i for i in issues if i.get("severity") == "high"]
    medium = [i for i in issues if i.get("severity") == "medium"]
    if not high and not medium:
        return False

    text = (f"🔴 AIC-000 知识库发现 {len(high)} 项 high / {len(medium)} 项 medium 冲突\n"
            + "\n".join(f"• {SEV_ICON.get(i.get('severity'),'')} {i.get('description','')[:60]}"
                        for i in (high + medium)[:8]))

    if webhook_type == "slack":
        payload = {"text": text}
    elif webhook_type == "feishu":
        payload = {"msg_type": "text", "content": {"text": text}}
    elif webhook_type == "wecom":
        payload = {"msgtype": "text", "text": {"content": text}}
    else:
        payload = {"text": text}
    try:
        resp = requests.post(webhook_url, json=payload, timeout=15)
        return resp.status_code < 300
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Conflict notification manager")
    parser.add_argument("--vault", help="Vault 根路径")
    parser.add_argument("--webhook", help="Webhook URL")
    parser.add_argument("--webhook-type", default="slack",
                        choices=["slack", "feishu", "wecom", "custom"])
    parser.add_argument("--webhook-enabled", action="store_true", default=None,
                        help="Explicitly allow sending the configured webhook.")
    args = parser.parse_args()
    vault = gc.get_vault_path(args.vault)
    result = generate_daily_digest(vault)
    if args.webhook:
        result["webhook_sent"] = send_webhook(args.webhook, args.webhook_type, vault, args.webhook_enabled)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
