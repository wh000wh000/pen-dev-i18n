# 翻译规范

给任何 App 做词典都适用；这套规范来自 Pen 汉化（1880 条）的实践。

## 1. key 的写法

词典是 `{"英文原文": "中文译文"}`，**key 必须是界面上那一串字符本身**：

- 省略号：界面常用 `…`（U+2026），也有 `...`（三个点）。**两者是不同的 key**，都要收。
- 尾随空格：`"Install "` 这种拼接前缀，空格不能省（本项目引擎额外支持 `^Install (.+)$` 这类规则，见 `engine.rules`）。
- 大小写、弯引号 `’`、`—`（em dash）都要原样。
- 不要为了「整齐」改 key —— 精确匹配失败等于没翻。

## 2. 该译 / 不该译

**要译**：按钮、菜单项、标签、提示、报错、空状态、设置项、字段名、列头、tooltip、无障碍标签（`aria-label` 也是界面上能看到的 tooltip 来源）。

**不译**：
- 品牌与产品名：Pen、pencil.dev、Figma、Notion、Linear、GitHub、Vercel…
- 模型名：`GPT-5.6 Sol`、`Claude Opus 5`、`DeepSeek V4 Flash`、`Composer`、`Auto`
- 字体家族名：`Roboto Condensed`、`noto sans …`
- 设备型号：`iPhone 17 Pro`、`Pixel 10`、`Galaxy Tab S8`
- 文件格式与协议：`PDF/PNG/SVG/JSON/HTML/MCP/URL`
- 键盘码与交互名：`Enter`、`Escape`、`ArrowLeft`
- 第三方库内部日志：PostHog、Sentry、Tiptap、PixiJS、csstree… 的调试输出
- **用户内容与智能体输出**：模板名、用户提示词、模型回复 —— 留在英文是对的

判不准时**宁可不译**：多翻一条代价是「本该是内容的地方出现了中文」，比漏译更糟。

## 3. 术语表（建议统一）

| 英文 | 中文 | 备注 |
|---|---|---|
| canvas | 画布 | |
| frame | 画框 | 设计工具里指容器，不是「帧」 |
| layer / layers panel | 图层 / 图层面板 | |
| component / variant | 组件 / 变体 | |
| style / design system | 样式 / 设计系统 | |
| asset / library | 素材 / 组件库 | Figma 语境里 library 是组件库 |
| workspace / document | 工作区 / 文档 | |
| template / draft / recents | 模板 / 草稿 / 最近 | |
| grid / zoom / selection | 网格 / 缩放 / 选区 | |
| opacity / corner radius | 不透明度 / 圆角 | |
| stroke / fill / shadow / blur | 描边 / 填充 / 阴影 / 模糊 | |
| auto layout / constraints | 自动布局 / 约束 | |
| group / ungroup / mask | 编组 / 取消编组 / 蒙版 | |
| anchor / handle | 锚点 / 手柄 | |
| export / import / share | 导出 / 导入 / 分享 | |
| snapshot / handoff | 快照 / 交付 | |
| agent / skill / tool | 智能体 / 技能 / 工具 | agent 不译「代理」 |
| model / provider | 模型 / 服务商 | |
| prompt / context | 提示词 / 上下文 | |
| subscription / billing / plan | 订阅 / 计费 / 套餐 | |
| upgrade / usage | 升级 / 用量 | |
| settings / dashboard | 设置 / 主页 | |
| undo / redo / duplicate | 撤销 / 重做 / 创建副本 | |
| align / distribute | 对齐 / 分布 | |
| nudge | 微移 | 键盘方向键的细调 |

## 4. 语气与长度

- 按钮、菜单项：**2–6 个汉字**，动词优先（`Export` → `导出`，`Let it cook` → `交给它跑`）。
- 说明句：说人话，不要机翻腔。`Automatic uses provider defaults.` → `"自动"将使用服务商的默认设置。`
- 不要「您」的堆砌，不要台湾用语（用「设置」不用「設定」，用「视频」不用「視訊」）。
- 原文有感叹号/问号就保留；原文没有句号就不要加。
- 含变量的句子按中文语序重排：`3 of 5 selected` → `已选 3 / 5`。

## 5. 占位符与快捷键

原样保留、只调位置：

```
"Could not open {fileName}"        → "无法打开 {fileName}"
"${count} files were skipped"      → "已跳过 ${count} 个文件"
"Delete “{name}”?"                 → "删除“{name}”？"
"Toggle sidebar  ⌘B"               → "切换侧边栏  ⌘B"
```

## 6. 质量检查清单（提交前过一遍）

- [ ] `zh-patch dict check` 无「空译文 / 译文等于原文」告警
- [ ] 每个 key 都能在界面或 `zh-patch extract` 输出里找到
- [ ] 同一概念在不同条目里译法一致（对照上面的术语表）
- [ ] 目标界面 `zh-patch verify --min 90` 通过
- [ ] `todo` 里剩下的英文，逐条确认「确实该留英文」