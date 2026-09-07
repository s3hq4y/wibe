# en_logs — 控制台 & 文件日志英文化插件

把 UWA 控制台（PowerShell）与文件日志中的中文翻译为中立的英文，不改任何上游源码。

## 原理

上游 `SecureLogger` 输出前会调用 `_cuteify_*_message` 计算"展示层文本"：
- 控制台 Formatter 优先显示 `codex_display_message_text`；
- 文件 Formatter 优先显示 `codex_original_message_text`。

本插件做了三件事：

1. **替换 cuteify**：把 `secure_logger` 的四个 `_cuteify_*_message` 换成英文翻译器，
   控制台显示英文，可爱文案（"小鹿…喵"）随之不再出现。
2. **包装 `SecureLogger._emit`**：落日志前先把 `msg` 翻译为英文，
   于是 `codex_original_message_text`（文件日志）同样为英文。
3. **root handler Filter**：兜底翻译不走 SecureLogger 的标准 logging 日志。

## 启动初期日志

`install_early()` 用 `__import__` 钩子在 `secure_logger` 首次导入时立即接管，
main.py 顶部会在 `from app import ...` 之前调用它，因此**启动初期的 app 初始化
日志同样输出英文**。

## 安装 / 卸载

- 安装：把 `en_logs/` 目录放进项目的 `uwa-plugins/` 下，并在 `main.py` 顶部
  `from app import ...` 之前加入 early 接管片段（见壳补丁）。重启服务生效。
- 卸载：删除 `en_logs/` 目录并移除 main.py 中的 early 片段，重启后恢复中文输出。

## 翻译表

- `translations_a.py` ~ `translations_h.py`：中文片段 → 英文映射，共约 2150 条规则。
  - `_a`~`_d`：常规日志片段（单行日志，约 1290 条）。
  - `_e`：单字量词/虚词兜底（个/项/条/张/每/但/或/在…）。
  - `_f`：更新/回滚/版本切换模块（`updater.py`）。
  - `_g`：多行拼接日志的长短语（长度 ≥ 9）。
  - `_h`：多行拼接日志的短语与短词兜底（长度 < 9）。
- 匹配按片段长度降序进行，长短语优先整句命中，短词仅作兜底。
- 翻译后统一做后处理：中文标点（，。：；！？（）…）转英文、连续空格压缩。

## 验证

- 以 clonetest（上游源码）为样本做静态回归：
  - 日志语句内中文片段 2129 个 → 翻译表覆盖 100%；
  - 1956 条日志消息翻译后中文残留 0 条。

## 说明

- 若上游日志文案更新，可重跑提取脚本（跨行跟踪括号平衡）重新生成片段清单后补译。
