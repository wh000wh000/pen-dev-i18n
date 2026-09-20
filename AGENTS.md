# AGENTS.md —— 给 AI Agent 的使用说明

这个仓库本身是**为 Agent 设计**的：你可以用 CLI 完成「自检 → 启动 → 抽取 → 翻译 → 合并 → 验收」的完整闭环，不需要人工点界面。

## 0. 硬性契约

| 项 | 约定 |
|---|---|
| 入口 | `node bin/zh-patch.mjs <命令> [参数] [--json]`（也可 `npm link` 后用 `zh-patch`） |
| 机器可读 | 任何命令加 `--json`，**stdout 只有 JSON**；人类可读的渲染不会混进来 |
| 命令与契约自查 | `node bin/zh-patch.mjs manifest --json` |
| 退出码 | `0` 成功 ／ `1` verify 未达阈值 ／ `2` 用法/配置错误 ／ `3` App 已在运行但没开调试端口 ／ `4` 端口不可用或 App 未启动 |
| 词典格式 | `{"英文原文": "中文译文"}`；**key 必须与界面逐字节一致**（含 `…`、尾随空格、大小写） |
| 生效时机 | 词典文件保存后守护进程 2.5 秒内自动重刷，**不需要重启 App** |
| 状态位置 | `~/.zh-patch/watch.pid`、`~/.zh-patch/watch.log` |

## 1. 标准闭环

```bash
R=/path/to/zh-patch
N="node $R/bin/zh-patch.mjs"

$N doctor --json                      # 期望 ok:true
$N start --daemon --json              # 期望 daemon:true；App 未开端口时用 --restart
$N extract --json                     # 抓当前界面所有可见 UI 串 → strings.json
$N todo --json --write todo.json      # 得到待翻译清单（todo.json.strings）

# —— 你在这里做翻译：把每条英文译成中文，产出 translation.json ——
#    格式：{"English source": "中文译文"}，key 原样复制，不要改标点/大小写/尾随空格

$N dict merge translation.json --json # 期望 added/changed 计数
$N verify --json --min 90             # 期望 pass:true，退出码 0
$N stop --restart --json              # 收尾（恢复原版启动）；只想停注入可不带 --restart
```

如果 `verify` 不达标：把返回里的 `sample` 或重新 `todo` 得到的清单继续翻译，回到第 5 步。典型收敛 2～4 轮。

## 2. 翻译时必须遵守

- **key 逐字节复制**，不要「顺手修正」原文里的空格、省略号、大小写。
- 品牌/产品/模型/字体/设备名不译（Pen、pencil.dev、Figma、Claude、GPT-6、DeepSeek、MCP、iPhone…）。
- 占位符 `{x}`、`${x}`、`%s`、`{{x}}` 原样保留，位置按中文语序摆放。
- 快捷键 `⌘ ⇧ ⌥ ⌃` 与 `+` 组合保留。
- 按钮/菜单项 2–6 个汉字；原文有 `…` 就保留 `…`；不要台湾用语，不要「您」的堆砌。
- 分不清是「界面文案」还是「内容」时，**宁可不译**：模型名、模板名、用户内容留在英文是对的。
- 完整术语表与范例见 [docs/TRANSLATING.md](docs/TRANSLATING.md)。

## 3. 判断「还差多少」的口径

`verify --json` 返回：

```json
{
  "coverage": 98.8,       // 本页翻译过的去重原文 / (它 + 未收录)，是「界面语言完成度」
  "applied": 82,          // 本页生命周期内翻译过的去重原文条数
  "unknown": 1,           // 仍然没收录的英文串（真正的工作清单）
  "pass": true,
  "sample": ["DeepSeek V4 Flash (combo auto)"]   // 通常是内容/模型名，属正常残留
}
```

`unknown` 里出现模型名、文件名、URL、域名属于正常；判定标准是「界面组件文案是否为中文」，而不是「页面上是否还有英文」。

## 4. 常见故障与处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `start` 退出码 3 | App 已运行但没开调试端口 | 先退出 App（macOS `osascript -e 'quit app "X"'`），再 `start --restart` |
| `apply`/`todo` 退出码 4 | 端口不可用 | 用 `start` 启动，而不是直接开 App |
| `todo` 里出现大段英文长句 | 真的没翻译 | 加进词典 |
| 同一条反复出现在 `todo` | 该文案由代码拼接（DOM 被拆成多个节点） | 把 **片段** 也加进词典（引擎支持前缀软匹配） |
| 改了词典但界面没变 | 守护没在跑 | `status --json` 看 `daemon.alive`，必要时重新 `start` |
| 某条译文在界面上被改回英文 | 组件重渲染 | 等 2.5s 守护重刷；仍反复则改用 `engine.rules` 或提 issue |

## 5. 你可以安全做的 / 不要做的

**可以**：改词典、加 `engine.rules` 动态规则、调 `engine.attrs` / `skipSelector`、改端口、给新 App 建 preset。

**不要**：
- 不要改目标 App 的 `app.asar`（会破坏签名与完整性校验，见 README）。
- 不要把智能体回复、用户输入、设计稿内容当文案翻译。
- 不要在词典里写正则或脚本（词典只做精确匹配；动态文案请用 `engine.rules`）。

## 6. 给维护者的建议改动路径

1. 新 App 词典：`dict/<app>.zh.json` + `presets/<app>.json`。
2. 新平台差异（Windows/Linux 启动方式）：改 `src/app.mjs`。
3. 新注入能力（例如 SVG 文本、Shadow DOM）：改 `src/engine-runtime.js` 并同步 `docs/HOW-IT-WORKS.md`。
4. 改完请跑：`npm test`（CLI 冒烟）+ 在目标 App 上 `apply → todo → verify` 走一遍。