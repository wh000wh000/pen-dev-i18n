# 语言包（Language packs）

zh-patch 的注入引擎与语言无关：**词典是「原文 → 译文」的纯数据**，所以同一套机制可以汉化、日语化、西语化……仓库自带 12 种语言的 Pen 词典。

## 自带语言

| 代码 | 语言 | 条目 | 备注 |
|---|---|---|---|
| `zh-CN` | 简体中文 | 1880 | 母本，人工逐条校对过 |
| `zh-TW` | 繁體中文 | 1839 | 台灣用語（設定／匯出／復原／新增檔案） |
| `ja` | 日本語 | 1830 | 体言止め、書き出し／元に戻す |
| `ko` | 한국어 | 1801 | 내보내기／실행 취소 |
| `es` | Español | 1838 | español neutro (LatAm) |
| `fr` | Français | 1847 | infinitif pour les boutons |
| `de` | Deutsch | 1831 | Infinitiv für Schaltflächen |
| `pt-BR` | Português (Brasil) | 1854 | imperativo para botões |
| `ru` | Русский | 1821 | инфинитив для кнопок |
| `it` | Italiano | 1853 | infinito per i pulsanti |
| `vi` | Tiếng Việt | 1824 | nhãn nút ngắn gọn |
| `tr` | Türkçe | 1832 | kısa düğme etiketleri |

> 除 `zh-CN` 外，其余语言为 **AI 初翻**（由多个翻译 Agent 按统一术语表产出，逐条保持 key 逐字节一致）。用起来没问题，但欢迎母语者校对 —— 提 PR 改 `dict/pen.<lang>.json` 即可。

每个语言的条目数略少于 1880，是因为翻译时按规范**主动跳过**了技术标识符、CSS token、键盘码、库内部日志这类不该翻译的串。

## 用法

```bash
zh-patch lang                     # 列出语言包与安装状态
zh-patch lang use ja              # 切换（自动从仓库拷贝词典到你的项目目录）
zh-patch lang use es
zh-patch lang use zh-CN           # 切回来

zh-patch start --lang de          # 临时用某语言启动，不改配置
zh-patch verify --lang ru         # 用某语言校验覆盖率
```

**热切换**：`lang use` 之后守护进程会在 2.5 秒内自动重载词典；已翻译的节点会先**还原成原文**再按新语言重译，所以不需要刷新窗口。

## 新增一种语言

1. 复制源词典：

   ```bash
   cp dict/pen.zh-CN.json /tmp/pen.new-LANG.json   # 或从英文源开始
   ```

   注意：**词典的 key 永远是英文原文**（不是中文），译文才是目标语言。所以要做新语言，请以英文 key 为基准。

2. 用 Agent 批量翻译（推荐流程，见 `AGENTS.md`）：

   ```bash
   zh-patch extract --json > strings.json
   # 让 Agent 读 strings.json，产出 {"English": "<目标语言>"} 的 JSON
   zh-patch dict merge translation.json
   zh-patch verify --lang new-LANG --min 90
   ```

3. 在 `src/config.mjs` 的 `KNOWN_LANGS` 里登记语言代码与显示名，并在 `docs/LANGUAGES.md`（本文件）补一行。

4. 提 PR 时请附上 `verify` 的输出。

## 翻译规范（所有语言通用）

详见 [`docs/TRANSLATING.md`](TRANSLATING.md)，要点：

- key 逐字节一致（大小写、`…`、尾随空格都不能动）；
- 品牌 / 模型名 / 字体名 / 设备型号 / 文件格式**一律不译**；
- 占位符 `{x}` `${x}` `%s` `{{x}}` 原样保留，只调语序；
- 快捷键符号 `⌘ ⇧ ⌥ ⌃` 保留；
- 按钮 2–5 个词，保持原文标点风格；
- 同一术语在不同条目里译法必须一致（用目标语言设计工具的实际用词）。

## 词典文件命名

```
dict/<app>.<lang>.json     例如 dict/pen.ja.json
```

`zh-patch.config.json` 里用 `"lang": "ja"` 与 `"dict": "dict/pen.ja.json"` 指定；`lang use` 会自动改这两项。