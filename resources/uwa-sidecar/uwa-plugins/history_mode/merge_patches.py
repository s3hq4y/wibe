#!/usr/bin/env python3
"""merge_patches.py —— 把 history_mode 插件的数据补丁合并进上游配置文件。

用法（在项目根目录执行）：
    python uwa-plugins/history_mode/merge_patches.py

作用：
  1. site_patches.json  -> config/sites.json
       - 新增站点（add_sites）
       - 给已有站点预设的指定步骤打标记（step_patches）
  2. config_patch.json  -> config/browser_config.json（顶层键覆盖）

安全性：
  - 合并前自动备份 <file>.bak_plugin
  - 幂等：重复执行结果一致
  - 只新增/覆盖指定键，不删除任何现有配置
"""
from __future__ import annotations

import copy
import json
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # 项目根目录（uwa-plugins/history_mode -> 根）

SITES_FILE = ROOT / "config" / "sites.json"
BROWSER_FILE = ROOT / "config" / "browser_config.json"


def _load(path: Path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _save(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _backup(path: Path):
    bak = path.with_name(path.name + ".bak_plugin")
    shutil.copy2(path, bak)
    return bak


def _deep_merge(base, patch):
    """与上游 _merge_config_patch 语义一致的深合并：dict 递归，其余整体替换。"""
    if not isinstance(base, dict) or not isinstance(patch, dict):
        return copy.deepcopy(patch)
    merged = dict(base)
    for k, v in patch.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _deep_merge(merged[k], v)
        else:
            merged[k] = copy.deepcopy(v)
    return merged


def apply_site_patches(sites: dict, patches: dict) -> int:
    applied = 0
    # 1) 新增站点
    for domain, cfg in (patches.get("add_sites") or {}).items():
        if domain in sites:
            print(f"  [skip] 站点已存在，跳过新增: {domain}")
            continue
        sites[domain] = copy.deepcopy(cfg)
        applied += 1
        print(f"  [add] 新增站点: {domain}")

    # 2) 步骤标记
    for p in patches.get("step_patches") or []:
        domain = p["domain"]; preset = p["preset"]
        match = p["match"]; set_kv = p["set"]
        site = sites.get(domain)
        if not isinstance(site, dict):
            print(f"  [warn] 站点不存在，跳过: {domain}")
            continue
        presets = site.get("presets", {})
        cfg = presets.get(preset) if isinstance(presets, dict) else None
        if not isinstance(cfg, dict):
            print(f"  [warn] 预设不存在，跳过: {domain}/{preset}")
            continue
        hit = 0
        for step in cfg.get("workflow", []) or []:
            if not isinstance(step, dict):
                continue
            if all(step.get(k) == v for k, v in match.items()):
                step.update(set_kv)
                hit += 1
        applied += hit
        print(f"  [set] {domain}/{preset}: 命中 {hit} 个步骤 {match} -> {set_kv}")
    return applied


def main() -> int:
    print("== history_mode 数据补丁合并 ==")

    # ---- sites.json ----
    sp = _load(HERE / "site_patches.json")
    if SITES_FILE.exists():
        sites = _load(SITES_FILE)
        bak = _backup(SITES_FILE)
        print(f"已备份 sites.json -> {bak.name}")
        n = apply_site_patches(sites, sp)
        _save(SITES_FILE, sites)
        print(f"sites.json 已更新（{n} 处改动）")
    else:
        print(f"[warn] 未找到 {SITES_FILE}，跳过")

    # ---- browser_config.json ----
    cp = _load(HERE / "config_patch.json")
    if BROWSER_FILE.exists():
        cfg = _load(BROWSER_FILE)
        bak = _backup(BROWSER_FILE)
        print(f"已备份 browser_config.json -> {bak.name}")
        cfg = _deep_merge(cfg, cp)
        _save(BROWSER_FILE, cfg)
        keys = [k for k in cp if not k.startswith("_")]
        print(f"browser_config.json 已覆盖: {keys}")
    else:
        print(f"[warn] 未找到 {BROWSER_FILE}，跳过")

    print("完成。若要回滚，用 *.bak_plugin 覆盖回去即可。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
