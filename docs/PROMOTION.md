# GitHub 推广手册（本项目实测版）

这份文档记录的是**实测结论**，不是泛泛的建议。测法：`gh search repos "<关键词>" --json fullName,description`，观察自己的仓库是否出现、排第几。

## 1. GitHub 仓库搜索到底看什么

| 位置 | 参与默认仓库搜索 | 权重感觉 | 说明 |
|---|---|---|---|
| **仓库名** | ✅ | 高 | 会做模糊分词，`pen-dev` 会被拆成 pen/dev，和 pentest 撞车 |
| **Description** | ✅ | 中高 | 关键词**越靠前越有效**；中文可被索引（搜「汉化」能出中文仓库） |
| **Topics** | ✅ | 高（topic 页可直接进） | `gh search repos --topic pen-dev` 能命中；topic 页 `github.com/topics/pen-dev` 可被搜索引擎抓 |
| README 正文 | ❌（默认） | — | 只在 `in:readme` 或 **Google/Bing** 里有用 |
| Star 数 | ✅（排序信号） | 高 | 新仓库 0 star 时很难压过老仓库 |
| Release 标题/正文 | ❌（搜索）| — | 但对「关注者」和 Google 有用 |

**结论**：想让搜「pen.dev 汉化」「pencil.dev 中文」的人找到，必须把关键词塞进 **名字、描述（前置）、topics**；README 只负责**转化**（点进来后是否 star/安装）与**站外搜索**。

## 2. 本项目当前状态（已做）

- 仓库名：**`pen-dev-i18n`** → 命中 `pen` / `dev` / `i18n`
- Description：`pen.dev 汉化 / pencil.dev 中文 / Pen 中文界面补丁 | 12 语言：… | Electron 应用运行时本地化 CLI…`（关键词全部前置）
- Topics（19 个）：`pen-dev` `pencil-dev` `pen-dev-chinese` `pen` `pencil` `chinese` `zh-cn` `i18n` `localization` `translation` `multi-language` `electron` `runtime-patch` `devtools-protocol` `app-localization` `design-tools` `agent-friendly` `ai-agent` `cli`
- README 首屏：中英双语摘要、关键词行、badge、三行上手、4 张多语言截图
- `package.json`：26 个 npm 关键词 + `zh-patch` / `pen-i18n` 双命令
- 旧仓库地址 301 跳转，已分享的链接不会失效

## 3. 还没做、但最有效的（按性价比排序）

1. **app 名进仓库名（可选加强）**：如果想让「pencil」也命中名字，可把仓库改成 `pen-pencil-i18n`；代价是丢掉 `dev` 分词。当前选择保留 `pen-dev`，靠描述里的 `pencil.dev` 覆盖。
2. **用 topic 页吃流量**：`github.com/topics/pen-dev` 与 `github.com/topics/pencil-dev` 目前仓库极少，我们排前 3 —— 这两个页面对 Google 是可达的。
3. **写一篇中文长文**（发布在你自己的站点，再回链 GitHub）：标题直接打关键词，例如
   《pen.dev 汉化教程：不修改 App、12 种语言热切换》。文章里放 GitHub 链接 —— **这是唯一能显著提升 Google 排名的杠杆**（反链）。
4. **中文社区分发**：V2EX（创意/分享节点）、少数派、即刻、小红书、B 站短的录屏（语言热切换的 10 秒演示非常适合传播）、掘金/思否。
5. **Show HN / Reddit**：`Show HN: Runtime localization for any Electron app (no asar patching)`；Reddit 的 r/electronjs、r/SideProject。
6. **给相关 awesome-list 提 PR**：搜 `awesome electron`、`awesome i18n`、`awesome design tools`，把项目加到对应分类。这类 PR 门槛低、外链质量高。
7. **让 README 更容易被 star**：加一段 10 秒 GIF（`lang use ja` 热切换 + 菜单栏变中文），比 4 张静态图更有说服力。
8. **仓库社交预览图**：GitHub 的 Social Preview 只能手动在 Settings 上传（无 API），建议用 `docs/images/lang-zh-CN.jpg` 裁一张。

## 4. 关键词表（写进描述/文章/视频标题）

**中文**：pen.dev 汉化 · pencil.dev 中文 · Pen 中文界面 · Pen 汉化补丁 · pen.dev 中文版 · Pencil 汉化 ·
Electron 应用汉化 · 桌面应用本地化 · 软件多语言 · 应用汉化工具 · 不改安装包汉化

**English**：pen.dev chinese · pencil.dev chinese · pen.dev localization · pencil.dev i18n ·
electron runtime localization · electron app translation without patching asar · hot language switching ·
agent-friendly localization cli

## 5. 不要做的事

- ❌ 刷 star / 互赞：会被 GitHub 判定滥用，且毁掉项目可信度
- ❌ 在无关仓库刷 issue 打广告：直接被举报，反噬站点
- ❌ 在界面里塞伪装成宿主 App 元素的广告（冒用 pen.dev 背书，容易被投诉下架）
- ❌ 用与 pen.dev 官方高度相似的仓库名/头像让人误以为是官方项目（写明 community/unofficial 才安全）