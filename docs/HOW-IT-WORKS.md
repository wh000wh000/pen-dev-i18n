# 原理与实现

## 1. 为什么不能用「改包」的方案

Electron 应用的界面文案全部编译在渲染进程的 JS bundle 里，通常还带着 `app.asar` 打包。

| 手段 | 结果 |
|---|---|
| 解包 `app.asar` → 改字符串 → 重新打包 | macOS 上 `Info.plist` 的 `ElectronAsarIntegrity` 是对 `app.asar` 的 SHA256；改了必须同步改 plist，而 plist 又是代码签名封印的一部分。实测在 hardened runtime 的 App 上 `codesign --force --deep --sign -` 会直接失败（`internal error in Code Signing subsystem`），App 启动会卡在 `dyld_start` |
| 把 `app.asar` 换成解包目录 `Resources/app/` | Electron 确实会优先加载 `app.asar`、其次 `app` 目录，但 App 内部大量使用 `app.getAppPath().replace(/\.asar$/, '.asar.unpacked')` 这类路径推导，目录布局一变就错位 |
| 系统级「App 汉化」工具 | 多数只能读取界面文本，无法注入 |
| **运行时注入（本项目）** | App 文件零改动。只在渲染进程里做文本替换 + 在主进程里改菜单对象，进程退出即消失 |

## 2. 两条注入通道

### 2.1 渲染进程（DevTools Protocol）

以 `--remote-debugging-port=<port>` 启动 App 后：

```
GET  http://127.0.0.1:<port>/json/list     # 枚举窗口（target）
WS   <webSocketDebuggerUrl>                # 连上去
→    Runtime.evaluate { expression: <注入脚本> }
```

注入的脚本（[`src/engine-runtime.js`](../src/engine-runtime.js)）在页面里做四件事：

1. **翻译文本节点**：`TreeWalker(SHOW_TEXT)`，对每个节点的值做「去掉首尾空白 → 精确查词典 → 还原空白」的替换。
2. **翻译属性**：`placeholder` / `title` / `aria-label` / `alt` / `data-placeholder`。
3. **跟进动态渲染**：`MutationObserver` 监听 `childList` / `characterData` / 目标属性变化；新节点、重渲染、路由切换都能接住。
4. **覆盖率审计**：`window.__ZH_PATCH__.audit()` 返回「本页翻译过的去重原文 / 仍未收录的英文串」，CLI 的 `todo` 与 `verify` 就靠它。

### 2.2 主进程（Node inspector）

原生菜单栏（`文件 / 编辑 / 视图 …`）是 Node 侧的 `Menu` 对象，DOM 注入够不着。加 `--inspect=<port>` 后可以连上主进程的 Node inspector，在 `Runtime.evaluate` 里拿着 `require('electron')` 直接改 `MenuItem.label`：

```js
const { Menu } = process.mainModule.require('electron')
Menu.getApplicationMenu().items.forEach(i => { if (DICT[i.label]) i.label = DICT[i.label] })
```

连 Electron 的内置 role 项（`Hide Others`、`Bring All to Front`…）也能改，因为它们默认 label 是英文常量。App 重建菜单时会把 label 还原，所以守护进程每 8 秒校准一次。

## 3. 几个踩过的坑（都已处理）

| 坑 | 现象 | 处理 |
|---|---|---|
| **伪元素占位符** | tiptap / ProseMirror 的输入框占位符是 `p[data-placeholder]::before { content: attr(data-placeholder) }`，编辑器内核会把属性改回英文 | 不跟它抢属性，改为**注入一条 CSS 规则**：`[data-placeholder="Design anything…"]::before{content:"设计任何东西…"}!important`。属性怎么变，渲染都是中文 |
| **文案被拆成多个节点** | `Click the ▢ next to file name…` 里的图标是独立节点，文本节点只有后半句 | 词典可以只收片段；引擎做**前缀软匹配**（比目标串长 1–2 个非字母字符的词典 key 也算命中） |
| **`contenteditable` 里是用户内容** | 直接翻译会把用户输入/智能体回复也翻了 | 文本节点跳过 `[contenteditable="true"]`，但**属性不跳过**（占位符还是要翻） |
| **审计看到中间态** | 刚注入就 audit，报告「一条都没翻」 | `audit` 前先调用 `applyNow()` 并等 900ms |
| **覆盖率被历史污染** | 重新注入后 `translated` 计数清零，覆盖率虚低 | 翻译去重集合在重新注入时**继承**上一次的结果（`__PATCH.__translated`） |
| **引擎改版但词典没改，不重新注入** | 版本号只看词典 mtime | 版本 = `sha1(引擎源码 + 词典 + engine 配置)` |
| **生成注入脚本时的转义地狱** | 引擎源码嵌在模板字符串里，反引号 / `\n` / 正则互相打架 | 引擎独立成文件 `src/engine-runtime.js`，由 Node 读文件后**原样字符串拼接**，配置通过 `window.__ZH_PATCH_BOOT__` 传进去 |

## 4. 进程与状态

- `zh-patch start` 前台跑守护；`--daemon` 会用同一个 CLI 起一个 detached 子进程，pid 写 `~/.zh-patch/watch.pid`，日志写 `~/.zh-patch/watch.log`。
- 守护每 `watch.intervalMs`（默认 2.5s）做一次：给所有页面 target 注入（版本不同才真正注入）→ 校准菜单。
- 10 分钟没有任何窗口（App 关了）自动退出，避免留下野进程。
- 只有 `--json` 会影响输出格式；退出码见 [AGENTS.md](../AGENTS.md)。

## 4.5 生图旁路（把宿主的出图请求改写到你自己的服务）

不是所有请求都能改 URL 就完事。以 Pen 为例，出图请求 `POST https://api.pencil.dev/generate-image` 由渲染进程直接 `fetch`，会遇到两道墙：

| 墙 | 现象 | 处理 |
|---|---|---|
| **CSP** | `Refused to connect ... violates "connect-src ..."` —— 因为白名单里没有 `127.0.0.1:15721` | 改写到白名单里已有的 `http://api.localhost:3001`，并把转发器绑在 **IPv6 回环 `[::1]:3001`**（`localhost:3001` 常被别的应用占用 IPv4） |
| **CORS** | `Access to fetch ... blocked by CORS policy` —— 页面 origin 是 `pencil://editor`，跨源，自定义头还会触发 `OPTIONS` 预检 | 转发器回 `Access-Control-Allow-Origin/Methods/Headers` 并处理预检 |

响应形状必须匹配宿主期望：Pen 拿到 `image` 后直接 `Uint8Array.setFromBase64(image)`，所以必须是**纯 base64**，不能带 `data:image/png;base64,` 前缀；外层再包成 `{ success: true, image }`。

验证过的替代方案（都不行，记录下来省得再试）：

- `Page.setBypassCSP` + 刷新：对 `<meta http-equiv>` 形式的 CSP 无效；
- 主进程代理：主进程没有通用 HTTP IPC 通道；
- 让页面走 `blob:`/`data:`：`connect-src` 允许，但拿不到网络数据。

## 5. 平台差异

| 平台 | 启动方式 | 退出方式 | 菜单注入 |
|---|---|---|---|
| macOS | `open -a X.app --args …` | `osascript -e 'quit app "X"'` | ✅ 支持 |
| Windows | 直接 spawn `X.exe` | `taskkill` | 未验证（`process.mainModule.require` 通道应可用） |
| Linux | 直接 spawn 可执行文件 | `SIGTERM` | 未验证 |

`--inspect` 的可用性依赖目标 App 没有禁用 Node inspector；若不可用，脚本会降级为「只汉化界面文案，不动菜单栏」，其它功能不受影响。

## 6. 安全边界

- 调试端口只绑 `127.0.0.1`，但**本机上的其他程序可以连**——它等价于给该 App 开了远程执行。用完 `zh-patch stop` 会保留 App 的调试端口（App 本身还在跑），彻底退出 App 即可关闭。
- 注入层不做任何网络请求、不读写文件、不改持久化状态，只操作 DOM 与菜单 label。
- 词典是纯数据，不含可执行内容；`engine.rules` 里的正则来自你自己的配置文件。