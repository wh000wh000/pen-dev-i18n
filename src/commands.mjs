import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  C, LOG_FILE, PID_FILE, ensureStateDir, exists, fail, head, info, log, ok, output,
  pidAlive, readJson, readPid, sleep, warn, writeJson, waitFor,
} from './util.mjs'
import {
  CONFIG_NAME, KNOWN_LANGS, LANG_LABEL, ROOT, availableLangs, dictPath, dictPathForLang,
  findConfigPath, loadConfig, loadDict, saveDict, writeConfigTemplate, resolvePreset,
} from './config.mjs'
import { patchMenu, auditPage, extractStrings, injectTargets, watch, engineVersion } from './injector.mjs'
import { detectApp, findPids, hasDebugPort, isRunning, launch, quit, forceKill } from './app.mjs'
import { listTargets, portAlive } from './cdp.mjs'


/** 载入配置，并支持用 --lang / --dict 临时覆盖语言包 */
function cfg(opts = {}, { allowMissing = false } = {}) {
  const { config } = loadConfig({ configPath: opts.config, allowMissing })
  if (!config) return null
  if (opts.lang) {
    const dp = dictPathForLang(config, String(opts.lang))
    config.lang = String(opts.lang)
    config.dict = path.relative(config.__root, dp)
  }
  if (opts.dict) config.dict = String(opts.dict)
  return config
}

/* ------------------------------------------------------------------ init */

export async function cmdInit(args, opts) {
  const appPath = args[0] || opts.app
  if (!appPath) { fail('用法：zh-patch init --app "/Applications/YourApp.app"'); process.exit(2) }
  const det = detectApp(appPath)
  if (det.electron === false) warn('没在 App 里找到 app.asar / resources/app —— 它可能不是 Electron 应用，汉化注入会无效。')

  const dir = path.resolve(opts.dir || process.cwd())
  const target = path.join(dir, CONFIG_NAME)
  if (exists(target) && !opts.force) { fail(`${target} 已存在（要覆盖加 --force）`); process.exit(2) }

  const dictRel = `dict/${det.slug}.zh.json`
  const cfg = writeConfigTemplate(target, {
    name: det.name,
    appPath: det.appPath,
    processPattern: det.processPattern,
    dictRel,
    pagePort: Number(opts.pagePort || 9333),
    inspectPort: Number(opts.inspectPort || 9229),
  })
  const dp = path.join(dir, dictRel)
  if (!exists(dp)) writeJson(dp, {})

  return output(
    { config: target, dict: dp, detected: det, configData: cfg },
    () => {
      ok(`已生成 ${path.relative(process.cwd(), target)}`)
      log(`   App: ${det.name}${det.electron ? '' : '（未检出 Electron）'}`)
      log(`   词典: ${path.relative(process.cwd(), dp)}（空词典，用 zh-patch extract / todo 开始收集）`)
      log(`\n下一步：zh-patch start      # 带汉化启动`)
      log(`        zh-patch todo       # 看看还有哪些没翻译`)
    }, opts.json)
}

/* ---------------------------------------------------------------- doctor */

export async function cmdDoctor(args, opts) {
  const checks = []
  const push = (name, okFlag, detail) => checks.push({ name, ok: !!okFlag, detail })

  push('node', Number(process.versions.node.split('.')[0]) >= 20, `v${process.versions.node}`)
  const cfgFound = findConfigPath(process.cwd())
  push('config', !!cfgFound, cfgFound || `未找到 ${CONFIG_NAME}`)

  if (cfgFound) {
    const config = cfg(opts)
    push('app 路径', exists(config.app.path), config.app.path)
    const electronish = detectApp(config.app.path).electron
    push('Electron 应用', electronish, electronish ? 'ok' : '没找到 app.asar（可能不是 Electron）')
    const dp = dictPath(config)
    const dict = loadDict(config)
    push('词典', exists(dp), `${path.relative(process.cwd(), dp)}（${Object.keys(dict).length} 条）`)
    const running = isRunning(config)
    push('App 进程', true, running ? `运行中（${findPids(config).length} 个进程）` : '未运行')
    const pageUp = await portAlive(config.debug.pagePort)
    const inspectUp = await portAlive(config.debug.inspectPort)
    push('页面调试端口', pageUp || !running, `${config.debug.pagePort} ${pageUp ? '可连' : '未监听'}`)
    push('主进程 inspector', inspectUp || !running, `${config.debug.inspectPort} ${inspectUp ? '可连' : '未监听'}`)
    if (running && !pageUp) push('结论', false, 'App 不是由 zh-patch 启动的：先 Cmd+Q 退出，再 zh-patch start')
    else if (running && pageUp) push('结论', true, '可以直接注入')
  }

  const okAll = checks.every(c => c.ok)
  return output({ ok: okAll, checks }, () => {
    head('zh-patch doctor')
    for (const c of checks) log(`  ${c.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`} ${c.name.padEnd(16, ' ')} ${C.dim}${c.detail}${C.reset}`)
    log('')
    okAll ? ok('可以正常工作') : warn('有项目未通过，见上面')
  }, opts.json)
}

/* ----------------------------------------------------------------- start */

export async function cmdStart(args, opts) {
  const config = cfg(opts)
  const dict = loadDict(config)

  if (opts.daemon && !opts.__daemonChild) return startDaemon(config, dict, opts)

  let launched = false
  if (isRunning(config) && !(await portAlive(config.debug.pagePort))) {
    fail('App 正在运行但没有开启调试端口。先 Cmd+Q 退出 App，再运行 zh-patch start（或加 --restart）。')
    if (opts.restart) { await quit(config); await sleep(1200); }
    else process.exit(3)
  }
  if (!isRunning(config)) {
    info(`启动 ${config.app.name}（页面端口 ${config.debug.pagePort} / inspector ${config.debug.inspectPort}）…`)
    const up = await launch(config)
    if (!up) { fail('等待调试端口超时：App 可能启动失败'); process.exit(4) }
    launched = true
    await sleep(1500)
  }

  const first = await injectTargets(config, dict)
  const menu = await patchMenu(config, dict)

  if (opts.once) return output({ launched, injected: first, menu }, () => {
    ok(`已注入 ${first.filter(f => f.result && !f.result.skipped).length} 个窗口`)
    log(`  菜单：${JSON.stringify(menu)}`)
  }, opts.json)

  output({ launched, injected: first, menu, watching: true }, () => {
    ok('汉化已启用（守护中，Ctrl+C 退出）')
    for (const f of first) info(`   ${f.result?.skipped ? '已是最新' : '已注入'} ${f.url || ''}`)
    info(`  原生菜单：${JSON.stringify(menu)}`)
  }, opts.json)

  // 运行期热重载：词典或配置文件的 mtime 变了就重新载入
  const stamp = (f) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }
  let dictStamp = stamp(dictPath(config))
  let cfgStamp = stamp(config.__file)
  const reload = async () => {
    const d = stamp(dictPath(config)), c = stamp(config.__file)
    if (d === dictStamp && c === cfgStamp) return null
    dictStamp = d; cfgStamp = c
    const fresh = { config: loadConfig({ configPath: config.__file }).config, dict: {} }
    fresh.dict = loadDict(fresh.config)
    if (opts.lang) { const dp = dictPathForLang(fresh.config, String(opts.lang)); fresh.config.lang = String(opts.lang); fresh.config.dict = path.relative(fresh.config.__root, dp); fresh.dict = loadDict(fresh.config) }
    return fresh
  }

  await watch(config, dict, {
    reload,
    onEvent: (type, payload) => {
      if (opts.quiet || opts.json) return
      if (type === 'inject') info(`  重新注入 ${payload.url || ''}`)
      else if (type === 'reload') info(`  词典已热重载：${payload.lang || ''} ${payload.entries} 条`)
      else if (type === 'menu') info(`  菜单校准 ${JSON.stringify(payload).slice(0, 120)}`)
      else if (type === 'idle-exit') info('  App 已关闭，守护退出')
    },
  })
  return { stopped: true }
}

function startDaemon(config, dict, opts) {
  ensureStateDir()
  const args = [path.join(ROOT, 'bin', 'zh-patch.mjs'), 'start', '--daemon-child']
  // 把语言/词典/配置覆盖项带给守护子进程，否则它会回落到配置文件里的默认值
  for (const [flag, val] of [['lang', opts.lang], ['dict', opts.dict], ['config', opts.config]]) {
    if (val) args.push(`--${flag}`, String(val))
  }
  if (opts.quiet) args.push('--quiet')
  const out = fs.openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', out, out], cwd: process.cwd() })
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid) + '\n')
  writeJson(PID_FILE.replace(/\.pid$/, '.json'), { pid: child.pid, startedAt: new Date().toISOString(), cwd: process.cwd() })
  return output({ daemon: true, pid: child.pid, log: LOG_FILE }, () => {
    ok(`守护已后台启动（pid ${child.pid}）`)
    log(`   日志：${LOG_FILE}`)
    log(`   停止：zh-patch stop`)
  }, opts.json)
}

/* ------------------------------------------------------------------ stop */

export async function cmdStop(args, opts) {
  const config = cfg(opts, { allowMissing: true })
  let killed = false
  const pid = readPid()
  if (pid && pidAlive(pid)) { try { process.kill(pid, 'SIGTERM'); killed = true } catch {} }
  // 兜底：按命令行特征清理孤儿守护
  try {
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('pgrep', ['-f', 'zh-patch.mjs start'], { encoding: 'utf8' })
    for (const p of out.split('\n').map(Number).filter(Boolean)) { try { process.kill(p, 'SIGTERM'); killed = true } catch {} }
  } catch {}

  if (config && (opts.quitApp || opts.restart)) {
    await quit(config)
    if (opts.restart) { await sleep(1200); await launch(config, { wait: false }); }
  }
  return output({ stopped: killed, appQuit: !!(opts.quitApp || opts.restart) }, () => {
    killed ? ok('守护已停止') : info('守护本来就没在跑')
    if (opts.restart) log('   App 已以原版方式重启（无调试端口）')
  }, opts.json)
}

/* ---------------------------------------------------------------- status */

export async function cmdStatus(args, opts) {
  const config = cfg(opts, { allowMissing: true })
  if (!config) return output({ config: false }, () => warn(`当前目录没有 ${CONFIG_NAME}`), opts.json)
  const dict = loadDict(config)
  const running = isRunning(config)
  const pageUp = await portAlive(config.debug.pagePort)
  const inspectUp = await portAlive(config.debug.inspectPort)
  let injected = null
  let audit = null
  if (pageUp) {
    const targets = await listTargets(config.debug.pagePort)
    const pages = targets.filter(t => t.type === 'page')
    injected = false
    if (pages[0]) {
      const { withTarget } = await import('./cdp.mjs')
      const v = await withTarget(pages[0], ({ evaluate }) => evaluate('window.__ZH_PATCH__ ? window.__ZH_PATCH__.version : 0'))
      injected = v === engineVersion(config, dict) ? 'current' : (v ? 'stale' : false)
    }
    audit = await auditPage(config)
  }
  const pid = readPid()
  const json = {
    app: config.app.name, appPath: config.app.path,
    running, pids: findPids(config),
    pagePort: { port: config.debug.pagePort, up: pageUp },
    inspectPort: { port: config.debug.inspectPort, up: inspectUp },
    dict: { file: dictPath(config), entries: Object.keys(dict).length },
    injected, daemon: pid && pidAlive(pid) ? { pid, alive: true } : { alive: false },
    audit: audit && !audit.error ? { total: audit.total, translated: audit.translated, unknown: audit.unknown.length } : audit,
  }
  return output(json, () => {
    head(`${config.app.name} 状态`)
    log(`  进程        ${running ? `${C.green}运行中${C.reset} (${findPids(config).join(', ')})` : `${C.dim}未运行${C.reset}`}`)
    log(`  调试端口    page:${config.debug.pagePort} ${pageUp ? '✓' : '✗'}   inspect:${config.debug.inspectPort} ${inspectUp ? '✓' : '✗'}`)
    log(`  注入状态    ${injected === 'current' ? `${C.green}已注入（最新）${C.reset}` : injected === 'stale' ? `${C.yellow}已注入（词典/引擎已更新，待刷新）${C.reset}` : `${C.dim}未注入${C.reset}`}`)
    log(`  词典        ${Object.keys(dict).length} 条  ${C.dim}${path.relative(process.cwd(), dictPath(config))}${C.reset}`)
    if (audit && !audit.error) log(`  可见文案    已翻译 ${audit.translated} 条，未收录 ${audit.unknown.length} 条`)
    log(`  守护        ${pid && pidAlive(pid) ? `pid ${pid}` : '未运行'}`)
  }, opts.json)
}

/* --------------------------------------------------------------- extract */

export async function cmdExtract(args, opts) {
  const config = cfg(opts)
  if (!(await portAlive(config.debug.pagePort))) { fail('页面调试端口不可用。先用 zh-patch start（或 apply）打开 App。'); process.exit(4) }
  const res = await extractStrings(config, { match: opts.match })
  if (res.error) { fail(`抓取失败：${res.error}`); process.exit(4) }
  const dict = loadDict(config)
  const missing = res.strings.filter(s => !(s in dict))
  const outFile = opts.out ? path.resolve(opts.out) : path.join(config.__root, 'strings.json')
  if (opts.write !== false) writeJson(outFile, { url: res.url, extractedAt: new Date().toISOString(), total: res.strings.length, missing: missing.length, strings: res.strings })
  return output({ url: res.url, total: res.strings.length, missing: missing.length, out: outFile }, () => {
    ok(`抓到 ${res.strings.length} 条可见字符串（其中 ${missing.length} 条不在词典里）`)
    log(`   已写入 ${path.relative(process.cwd(), outFile)}`)
  }, opts.json)
}

/* ------------------------------------------------------------------ todo */

export async function cmdTodo(args, opts) {
  const config = cfg(opts)
  const dict = loadDict(config)
  const res = await auditPage(config, { match: opts.match })
  if (res.error) {
    // 没注入也要能用：退回 DOM 抓取
    const ex = await extractStrings(config, { match: opts.match })
    if (ex.error) { fail(`App 没在跑或端口不可用：${ex.error}`); process.exit(4) }
    const list = ex.strings.filter(s => !(s in dict))
    return output({ source: 'dom', total: ex.strings.length, todo: list.length, strings: list },
      () => { ok(`（未注入引擎，按 DOM 抓取）待翻译 ${list.length} 条`); list.slice(0, 40).forEach(s => log('   ' + s)) }, opts.json)
  }
  const limit = Number(opts.limit || 0)
  const list = limit ? res.unknown.slice(0, limit) : res.unknown
  if (opts.write) {
    const f = path.resolve(opts.write)
    writeJson(f, { generatedAt: new Date().toISOString(), source: 'audit', count: res.unknown.length, strings: res.unknown })
    if (!opts.json) info(`   已写入 ${path.relative(process.cwd(), f)}`)
  }
  return output({ source: 'audit', total: res.total, known: res.known, todo: res.unknown.length, strings: list }, () => {
    head(`待翻译：${res.unknown.length} 条（可见 ${res.total}，已命中 ${res.known}）`)
    list.forEach(s => log('   ' + s))
    if (!list.length) ok('当前界面没有未翻译的可见文案')
    log('')
    info('把上面的字符串翻译后追加进词典（zh-patch dict add 或直接改 JSON），保存即生效。')
  }, opts.json)
}

/* ---------------------------------------------------------------- verify */

export async function cmdVerify(args, opts) {
  const config = cfg(opts)
  const res = await auditPage(config, { match: opts.match })
  if (res.error) { fail(`无法审计：${res.error}（App 需要以 zh-patch start 启动并已注入）`); process.exit(4) }
  // 覆盖率 = 本屏翻译过的「去重原文」数 / (它 + 仍未收录的)
  const applied = res.translated ?? res.applied ?? 0
  const denom = applied + res.unknown.length
  const coverage = denom ? Math.round((applied / denom) * 1000) / 10 : 100
  const min = Number(opts.min || 0)
  const pass = coverage >= min
  const out = { coverage, applied, total: denom, unknown: res.unknown.length, threshold: min, pass, sample: res.unknown.slice(0, 20) }
  output(out, () => {
    head('汉化覆盖率')
    log(`  已翻译 ${applied} 条 / 未收录 ${res.unknown.length} 条  ≈ ${coverage}%`)
    log(`  未收录 ${res.unknown.length} 条`)
    if (res.unknown.length) res.unknown.slice(0, 10).forEach(s => log(`   ${C.dim}${s}${C.reset}`))
    log('')
    pass ? ok(`达到阈值 ${min}%`) : warn(`低于阈值 ${min}%（用 zh-patch todo 拉清单继续翻）`)
  }, opts.json)
  if (!pass) process.exit(1)
  return out
}

/* ------------------------------------------------------------------ menu */

export async function cmdMenu(args, opts) {
  const config = cfg(opts)
  const dict = loadDict(config)
  if (opts.read) {
    const { listTargets: lt, withTarget } = await import('./cdp.mjs')
    const targets = await lt(config.debug.inspectPort)
    const t = targets.find(x => x.webSocketDebuggerUrl)
    if (!t) { fail('主进程 inspector 不可用（App 需要以 zh-patch start 启动）'); process.exit(4) }
    const r = await withTarget(t, ({ evaluate }) => evaluate(`(() => {
      const { Menu } = process.mainModule.require('electron');
      const dump = (items, d) => items.filter(i => i.label).map(i => '  '.repeat(d) + i.label + (i.submenu ? String.fromCharCode(10) + dump(i.submenu.items, d + 1) : '')).join(String.fromCharCode(10));
      return dump(Menu.getApplicationMenu().items, 0);
    })()`, { commandLineAPI: true }))
    const lines = String(r || '').split('\n')
    return output({ tree: lines }, () => lines.forEach(l => log(l)), opts.json)
  }
  const r = await patchMenu(config, dict)
  return output(r, () => ok(`菜单已汉化：${JSON.stringify(r)}`), opts.json)
}

/* ------------------------------------------------------------ dict 子命令 */

export async function cmdDict(args, opts) {
  const sub = args[0]
  const config = cfg(opts)
  const dict = loadDict(config)
  const file = dictPath(config)

  if (sub === 'stats' || !sub) {
    const byLen = Object.keys(dict).filter(k => k.length > 60).length
    return output({ file, entries: Object.keys(dict).length, longKeys: byLen }, () => {
      head('词典')
      log(`  文件    ${path.relative(process.cwd(), file)}`)
      log(`  条目    ${Object.keys(dict).length}`)
    }, opts.json)
  }
  if (sub === 'add') {
    const [, en, zh] = args
    if (!en || !zh) { fail('用法：zh-patch dict add "English" "中文"'); process.exit(2) }
    dict[en] = zh
    saveDict(config, dict)
    return output({ added: en, entries: Object.keys(dict).length }, () => ok(`已加入：${en} → ${zh}`), opts.json)
  }
  if (sub === 'set' || sub === 'merge') {
    const src = args[1]
    if (!src) { fail('用法：zh-patch dict merge <json文件>'); process.exit(2) }
    const incoming = readJson(path.resolve(src))
    if (!incoming || typeof incoming !== 'object') { fail('不是合法 JSON 对象'); process.exit(2) }
    let added = 0, changed = 0
    for (const [k, v] of Object.entries(incoming)) {
      if (k in dict) { if (dict[k] !== v) changed++ } else added++
      dict[k] = v
    }
    saveDict(config, dict)
    return output({ added, changed, entries: Object.keys(dict).length }, () => ok(`合并完成：新增 ${added}，覆盖 ${changed}，共 ${Object.keys(dict).length} 条`), opts.json)
  }
  if (sub === 'check') {
    const src = args[1]
    const incoming = src ? readJson(path.resolve(src)) : dict
    if (!incoming) { fail('文件不存在'); process.exit(2) }
    const bad = Object.entries(incoming).filter(([k, v]) => !k || typeof v !== 'string' || !v.trim() || v === k)
    return output({ total: Object.keys(incoming).length, problems: bad.slice(0, 50), problemCount: bad.length },
      () => bad.length ? warn(`${bad.length} 条可疑：${bad.slice(0, 10).map(b => b[0]).join(' | ')}`) : ok('词典检查通过'), opts.json)
  }
  fail(`未知子命令：${sub}（可用：stats add merge check）`)
  process.exit(2)
}

/* ------------------------------------------------------------ launcher */

export async function cmdInstallLauncher(args, opts) {
  const config = cfg(opts)
  const dir = path.resolve(opts.dir || config.__root)
  const isWin = process.platform === 'win32'
  const shim = path.join(dir, isWin ? '启动汉化.bat' : '启动汉化.command')
  const node = process.execPath
  const cli = path.join(ROOT, 'bin', 'zh-patch.mjs')
  const body = isWin
    ? `@echo off\r\ncd /d "%~dp0"\r\n"${node}" "${cli}" start\r\npause\r\n`
    : `#!/usr/bin/env bash\ncd "$(dirname "$0")"\n"${node}" "${cli}" start\n`
  fs.writeFileSync(shim, body)
  if (!isWin) fs.chmodSync(shim, 0o755)
  return output({ launcher: shim }, () => {
    ok(`已生成双击入口：${path.relative(process.cwd(), shim)}`)
    info('   双击即可带汉化启动（首次会提示 `start` 需要 App 未运行）。')
  }, opts.json)
}


/* ------------------------------------------------------------------ lang */

export async function cmdLang(args, opts) {
  const config = cfg(opts)
  const sub = args[0]
  const rows = availableLangs(config)
  const bundled = fs.existsSync(path.join(ROOT, 'dict'))
    ? fs.readdirSync(path.join(ROOT, 'dict')).filter(f => /\.(zh-CN|zh-TW|ja|ko|es|fr|de|pt-BR|ru|it|vi|tr)\.json$/.test(f))
    : []

  if (sub === 'use') {
    const code = args[1]
    if (!code) { fail('用法：zh-patch lang use <语言代码>（如 ja / zh-TW / es）'); process.exit(2) }
    const dp = dictPathForLang(config, code)
    const raw = readJson(config.__file) || {}
    raw.lang = code
    raw.dict = path.relative(config.__root, dp)
    writeJson(config.__file, raw)
    const entries = exists(dp) ? Object.keys(readJson(dp, {})).length : 0
    if (!entries) {
      const src = path.join(ROOT, 'dict', path.basename(dp))
      if (exists(src)) { fs.mkdirSync(path.dirname(dp), { recursive: true }); fs.copyFileSync(src, dp) }
    }
    const n = exists(dp) ? Object.keys(readJson(dp, {})).length : 0
    const injected = n ? await injectTargets(config, loadDict(config)) : []
    return output({ lang: code, dict: dp, entries: n, injected: injected.map(i => i.result || i.error) },
      () => {
        n ? ok(`已切换到 ${LANG_LABEL[code] || code}：${path.relative(process.cwd(), dp)}（${n} 条）`)
          : warn(`已切换语言为 ${code}，但还没有对应词典：${path.relative(process.cwd(), dp)}`)
        n ? info('   已热更新到当前窗口') : info('   用 zh-patch extract / todo 开始收集，或从仓库 dict/ 目录拷一份现成的')
      }, opts.json)
  }

  return output({ current: config.lang, dict: dictPath(config), langs: rows, bundled }, () => {
    head('语言包')
    for (const r of rows) {
      const mark = r.code === config.lang ? `${C.green}●${C.reset}` : (r.exists ? '○' : `${C.dim}·${C.reset}`)
      log(`  ${mark} ${r.code.padEnd(7)} ${r.label.padEnd(18)} ${r.exists ? `${Object.keys(readJson(r.dict, {})).length} 条` : `${C.dim}未就位（首次 use 会自动从仓库 dict/ 拷入）${C.reset}`}`)
    }
    log('')
    info('切换：zh-patch lang use ja     临时覆盖：zh-patch start --lang es')
  }, opts.json)
}

/* -------------------------------------------------------------- manifest */

export const COMMANDS = {
  init: { usage: 'init --app <路径> [--dir .] [--force]', desc: '在目录里生成 zh-patch.config.json 与空词典', json: true },
  doctor: { usage: 'doctor', desc: '环境/配置/端口/词典自检', json: true },
  start: { usage: 'start [--daemon] [--restart] [--once] [--quiet]', desc: '带调试端口启动 App 并注入（默认前台守护）', json: true },
  apply: { usage: 'apply', desc: '对已在运行的 App 做一次性注入（不守护）', json: true },
  stop: { usage: 'stop [--quit-app] [--restart]', desc: '停止注入；可选退出 App 或恢复原版启动', json: true },
  status: { usage: 'status', desc: 'App/端口/注入状态/词典统计', json: true },
  extract: { usage: 'extract [--out strings.json] [--match 路由]', desc: '抓取当前界面所有可见 UI 字符串', json: true },
  todo: { usage: 'todo [--limit N] [--write file] [--match 路由]', desc: '列出未收录的可见文案（Agent 工作清单）', json: true },
  verify: { usage: 'verify [--min 90] [--match 路由]', desc: '输出汉化覆盖率，低于阈值退出码 1', json: true },
  menu: { usage: 'menu [--read]', desc: '汉化原生菜单 / 读取当前菜单树', json: true },
  dict: { usage: 'dict <stats|add|merge|check> [args]', desc: '词典维护', json: true },
  lang: { usage: 'lang <list|use 语言代码>', desc: '多语言包：列出 / 切换目标语言', json: true },
  'install-launcher': { usage: 'install-launcher [--dir .]', desc: '生成双击启动脚本', json: true },
  preset: { usage: 'preset <list|use 名字> [--dir .]', desc: '查看/套用内置预设（如 pen）', json: true },
  manifest: { usage: 'manifest', desc: '输出机器可读的命令清单（给 Agent 用）', json: true },
}

export async function cmdApply(args, opts) {
  const config = cfg(opts)
  const dict = loadDict(config)
  if (!(await portAlive(config.debug.pagePort))) { fail('页面调试端口不可用。用 zh-patch start 启动 App，或先 apply 前手动带 --remote-debugging-port 启动。'); process.exit(4) }
  const injected = await injectTargets(config, dict)
  const menu = await patchMenu(config, dict)
  const audit = await auditPage(config)
  return output({ injected, menu, audit: audit?.error ? audit : { total: audit.total, translated: audit.translated, unknown: audit.unknown.length } }, () => {
    ok(`注入 ${injected.filter(i => i.result && !i.result.skipped).length} 个窗口（${injected.length} 个目标）`)
    if (audit && !audit.error) log(`   可见文案已翻译 ${audit.translated} 条，未收录 ${audit.unknown.length} 条`)
    log(`   原生菜单：${JSON.stringify(menu)}`)
  }, opts.json)
}

export async function cmdPreset(args, opts) {
  const sub = args[0]
  const presetsDir = path.join(ROOT, 'presets')
  const list = fs.existsSync(presetsDir) ? fs.readdirSync(presetsDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')) : []
  if (!sub || sub === 'list') {
    return output({ presets: list }, () => { head('内置预设'); list.forEach(p => log('   ' + p)); log(''); info('用法：zh-patch preset use pen') }, opts.json)
  }
  if (sub === 'use') {
    const name = args[1]
    if (!name || !list.includes(name)) { fail(`没有预设 ${name}（可用：${list.join(', ')}）`); process.exit(2) }
    const preset = resolvePreset(name)
    const dir = path.resolve(opts.dir || process.cwd())
    const lang = opts.lang || preset.lang || 'zh-CN'
    const dictRel = `dict/${preset.dict || `${name}.${lang}.json`}`
    fs.mkdirSync(path.join(dir, 'dict'), { recursive: true })
    const dictSrc = path.join(ROOT, 'dict', preset.dict || `${name}.${lang}.json`)
    const dictDst = path.join(dir, dictRel)
    let entries = 0
    if (exists(dictSrc)) { fs.copyFileSync(dictSrc, dictDst); entries = Object.keys(readJson(dictDst, {})).length }
    const target = path.join(dir, CONFIG_NAME)
    const previous = readJson(target)        // 写模板前先留一份旧的，用于保留用户自定义
    const cfg = writeConfigTemplate(target, {
      name: preset.name, appPath: preset.app.path, processPattern: preset.app.processPattern,
      dictRel, pagePort: preset.debug.pagePort, inspectPort: preset.debug.inspectPort,
    })
    if (preset.engine) cfg.engine = { ...cfg.engine, ...preset.engine }
    if (preset.menu) cfg.menu = { ...cfg.menu, ...preset.menu }
    cfg.lang = lang
    // 别把用户已有的署名/品牌配置冲掉：preset 只提供默认值
    if (previous && previous.engine && previous.engine.rules) cfg.engine.rules = previous.engine.rules
    writeJson(target, cfg)
    return output({ preset: name, config: path.join(dir, CONFIG_NAME), dict: dictDst, entries }, () => {
      ok(`已套用预设 ${name}：配置 + ${entries} 条词典`)
      info(`   注意：预设里的 App 路径是 ${preset.app.path}，若你的安装位置不同请改配置。`)
    }, opts.json)
  }
  fail(`未知子命令：${sub}`)
  process.exit(2)
}

export function cmdManifest(args, opts) {
  const manifest = {
    name: 'zh-patch',
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    purpose: '为 Electron 应用注入运行时的多语言本地化层（不改 App 本体），并提供 Agent 可驱动的抽取/补齐/验收闭环',
    languages: KNOWN_LANGS.map(([code, label]) => ({ code, label })),
    config: { file: CONFIG_NAME, generatedBy: 'zh-patch init', schema: 'schema/zh-patch.config.schema.json' },
    commands: Object.entries(COMMANDS).map(([name, c]) => ({ name, ...c })),
    agentWorkflow: [
      'zh-patch doctor --json                     # 1. 自检，确认可注入',
      'zh-patch start --daemon --json             # 2. 拉起 App + 守护注入',
      'zh-patch extract --json                    # 3. 抓当前界面所有可见 UI 字符串',
      'zh-patch todo --json --write todo.json     # 4. 取未翻译清单',
      '# 5. 由 Agent 翻译 todo.json → translation.json（原样保留 key、占位符、快捷键）',
      'zh-patch dict merge translation.json       # 6. 合并进词典（守护 2.5s 内自动重刷）',
      'zh-patch verify --json --min 90            # 7. 验收覆盖率，不达标退出码 1',
      'zh-patch stop --restart                    # 8. 收尾（恢复原版启动）',
    ],
    contracts: {
      exitCodes: { 0: '成功', 1: 'verify 未达阈值', 2: '用法/配置错误', 3: 'App 已在运行但未开端口', 4: '端口不可用或 App 未启动' },
      jsonMode: '所有命令支持 --json，stdout 只输出 JSON（人类可读信息走 stderr 之外的分支）',
      dictFormat: '{"英文原文": "中文译文"}，key 必须与界面逐字节一致（含 … 与尾随空格）',
    },
  }
  return output(manifest, () => log(JSON.stringify(manifest, null, 2)), opts.json !== false)
}