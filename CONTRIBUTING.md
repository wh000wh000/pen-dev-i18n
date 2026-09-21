# 贡献指南

## 最需要的贡献：语言校对

仓库里 12 种语言的 Pen 词典，**除简体中文外都是 AI 初翻**，欢迎母语者纠正：

```bash
git clone https://github.com/wh000wh000/pen-dev-i18n.git && cd pen-dev-i18n
# 直接改 dict/pen.<你的语言>.json，然后本地验一遍：
zh-patch preset use pen --dir ~/pen-test && cd ~/pen-test && zh-patch lang use <code>
zh-patch start --daemon && zh-patch verify --lang <code>
```

改完提 PR，说明你改了哪些词条、依据是什么（比如「Figma 日文版用的是『書き出し』而不是『エクスポート』」）。

## 新增一种语言

见 [docs/LANGUAGES.md](docs/LANGUAGES.md)。核心约定：**词典的 key 永远是英文原文**，译文才是目标语言。

## 给新 App 做本地化

```bash
zh-patch init --app "/Applications/YourApp.app"
zh-patch start --daemon && zh-patch todo --write todo.json   # 收集 → 翻译 → dict merge
```

产出一份 `dict/<app>.<lang>.json` 与 `presets/<app>.json`，提 PR 即可。

## 改代码

- 引擎：`src/engine-runtime.js`（在渲染进程里运行，无构建、ES5 风格，避免转义坑）
- CLI：`src/commands.mjs`；配置：`src/config.mjs`；注入与菜单：`src/injector.mjs`
- 改完请跑 `npm test`，并在目标 App 上走一遍 `apply → todo → verify`
- 提交信息用 Conventional Commits（`feat:` / `fix:` / `docs:` …）

## 不要做的事

- 不要修改目标 App 的 `app.asar`（会破坏代码签名与完整性校验）
- 不要把智能体回复、用户输入、设计稿内容当界面文案翻译
- 不要在界面里注入伪装成宿主 App 元素的广告或推广位
