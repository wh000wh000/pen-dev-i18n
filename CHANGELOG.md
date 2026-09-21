# 更新日志

## v0.6.0 —— 生图旁路（native image generation bypass）

- 新增 `imagegen`：把宿主 App 的托管出图请求（如 Pen 的 `POST api.pencil.dev/generate-image`）旁路到你自己
  的 OpenAI 兼容出图服务；界面、按钮、provider 下拉都不变，只换出图的字节
- 绕过 CSP（改写到白名单 origin `api.localhost`，转发器绑 IPv6 回环）与 CORS（回 ACAO + 预检）
- 新增 `zh-patch imagegen [enable|disable|test]`；旁路失败自动回落官方后端
- 实测：Pen 内出图走 ccswitch router 的 `gpt-5.5 + gpt-image-2.5-sunburst`，返回 1254×1254 PNG


## v0.5.0 —— 使用者视角重写 + 一键安装

- README 重新定位：从「通用工具」改为「**我们已经把 Pen 汉化好了，装上就用**」，
  安装、效果、语言表、FAQ（会不会改 App / 更新后是否有效 / 安全性 / 卸载 / 漏译反馈）前置，
  开发者与扩展能力下沉到后半部分
- 新增 `install.sh`：一条命令装到 `~/Pen汉化/`，生成双击启动器与 `./pen-zh` 快捷入口
- `preset use` 现在一次装齐该 App 的全部语言词典（不必等切换时才下载）
- 修复 `install-launcher --dir X`、`preset use --dir X` 仍从当前目录找配置的问题


## v0.4.1 —— 移除署名角标 / 聚焦本地化本身

- 移除 `brand` 命令与窗口角落的署名角标，工具不再往目标 App 里注入任何品牌信息
- 移除 `link` 命令（其唯一用途是打开品牌站点）
- 文档同步清理；README 增加「与 pen.dev / pencil.dev 官方无关」的说明


本项目提供 **Pen / pencil.dev 汉化补丁**（中文界面）与通用的 **Electron 应用多语言本地化** 能力。

## v0.4.0 —— Pen 汉化补丁 · 关键词与仓库定位

- 仓库更名 `zh-patch` → **`pen-dev-i18n`**，让搜 「pen.dev 汉化」「pencil.dev 中文」的人能找到（旧地址 301 自动跳转）
- README 首屏按 pen.dev / pencil.dev / 汉化 / i18n 关键词重写，补 badge 与英文摘要
- `package.json` 补 npm 侧关键词与双命令别名（`zh-patch` / `pen-i18n`）
- CLI 增加版本号输出与关键词横幅

## v0.3.0 —— 12 种语言 + 热切换

- 新增 11 个语言包：`zh-TW` `ja` `ko` `es` `fr` `de` `pt-BR` `ru` `it` `vi` `tr`（各 1800+ 条）
- `zh-patch lang use <code>` 热切换：引擎先还原原文再重译，**不用重启、不用刷新**
- 守护进程支持词典/配置热重载；`--lang` 可覆盖 `start/apply/verify/todo`
- 修复 `preset use` 覆盖用户署名配置的问题

## v0.2.0 —— 署名角标

- 新增 `zh-patch brand`：窗口角落的半透明署名标签（点击复制网址、可一键隐藏）
- 新增 `zh-patch link`：用默认浏览器打开品牌站点

## v0.1.0 —— 首个版本

- 运行时注入本地化：渲染进程 DOM 翻译层 + 主进程原生菜单改写
- 14 个命令、全部支持 `--json`；`extract → todo → dict merge → verify` 的 Agent 闭环
- 内置 Pen 简体中文词典 1880 条
