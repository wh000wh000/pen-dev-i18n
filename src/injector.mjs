import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT } from './config.mjs'
import { listTargets, pickPage, portAlive, withTarget } from './cdp.mjs'
import { sleep } from './util.mjs'

const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'src', 'engine-runtime.js'), 'utf8')

export function engineVersion(config, dict) {
  return crypto.createHash('sha1')
    .update(ENGINE_SRC)
    .update(JSON.stringify(dict))
    .update(JSON.stringify(config.engine || {}))
    .update(JSON.stringify(config.branding || {}))
    .digest('hex').slice(0, 16)
}

/** 生成注入用的完整脚本：先塞配置，再跑引擎 */
export function buildBootScript(config, dict) {
  const boot = {
    dict,
    version: engineVersion(config, dict),
    attrs: config.engine.attrs,
    skipTags: config.engine.skipTags,
    skipSelector: config.engine.skipSelector,
    pseudoAttrs: config.engine.pseudoAttrs,
    attrMaxLength: config.engine.attrMaxLength,
    rules: config.engine.rules,
    branding: config.branding || { enabled: false },
  }
  return `window.__ZH_PATCH_BOOT__ = ${JSON.stringify(boot)};\n${ENGINE_SRC}`
}

/** 给单个渲染进程注入（带版本判断） */
export async function injectTargets(config, dict, { match } = {}) {
  const bootVersion = engineVersion(config, dict)
  const targets = await listTargets(config.debug.pagePort)
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)
  const chosen = match ? pages.filter(t => new RegExp(match).test(t.url || '')) : pages
  const results = []
  for (const t of chosen) {
    try {
      const r = await withTarget(t, async ({ evaluate }) => {
        const state = await evaluate('window.__ZH_PATCH__ ? window.__ZH_PATCH__.version : 0')
        if (state === bootVersion) return { skipped: 'same-version' }
        return await evaluate(buildBootScript(config, dict))
      })
      results.push({ url: t.url, title: t.title, result: r })
    } catch (e) {
      results.push({ url: t.url, title: t.title, error: String(e.message || e) })
    }
  }
  return results
}

/** 原生菜单汉化（主进程 Node inspector） */
export async function patchMenu(config, dict) {
  if (config.menu?.enabled === false) return { skipped: 'disabled' }
  const inspectPort = config.debug.inspectPort
  if (!(await portAlive(inspectPort))) return { skipped: 'no-inspector' }
  const targets = await listTargets(inspectPort)
  const target = targets.find(t => t.webSocketDebuggerUrl)
  if (!target) return { skipped: 'no-target' }
  const extra = config.menu.extraKeys || []
  const script = `(() => {
    const DICT = ${JSON.stringify(dict)};
    const EXTRA = ${JSON.stringify(extra)};
    const RULES = [[/^Install (.+)$/, '安装 $1']];
    let electron;
    try { electron = require('electron') } catch (e) { try { electron = process.mainModule.require('electron') } catch (e2) { return 'no-electron' } }
    const Menu = electron.Menu;
    let menu;
    try { menu = Menu.getApplicationMenu() } catch (e) { return 'no-menu-api' }
    if (!menu) return 'no-menu';
    let n = 0, total = 0;
    const map = (l) => {
      if (DICT[l]) return DICT[l];
      if (EXTRA.indexOf(l) >= 0 && DICT[l]) return DICT[l];
      for (const [re, rep] of RULES) if (re.test(l)) return l.replace(re, rep);
      return null;
    };
    const walk = (items, depth) => {
      depth = depth || 0;
      for (const it of items) {
        total++;
        try {
          const nl = it.label ? map(it.label) : null;
          if (nl && nl !== it.label) { it.label = nl; n++; }
        } catch (e) {}
        if (it.submenu && it.submenu.items) walk(it.submenu.items, depth + 1);
      }
    };
    walk(menu.items);
    return JSON.stringify({ patched: n, total: total, top: menu.items.map(i => i.label) });
  })()`
  try {
    const r = await withTarget(target, async ({ evaluate }) => evaluate(script, { commandLineAPI: true }))
    if (typeof r === 'string') { try { return JSON.parse(r) } catch { return { raw: r } } }
    return r
  } catch (e) {
    return { error: String(e.message || e) }
  }
}

/** 读取页面审计信息（可见字符串 / 命中词典数 / 未翻译清单） */
export async function auditPage(config, { match } = {}) {
  const targets = await listTargets(config.debug.pagePort)
  const t = pickPage(targets, match)
  if (!t) return { error: 'no-page' }
  return withTarget(t, async ({ evaluate }) => {
    const state = await evaluate('window.__ZH_PATCH__ ? 1 : 0')
    if (state !== 1) return { error: 'engine-not-injected' }
    // 先让引擎把当前界面翻完，否则审计会看到「还没翻」的中间态
    await evaluate('window.__ZH_PATCH__.applyNow(); 1')
    await sleep(900)
    const r = await evaluate('JSON.stringify(window.__ZH_PATCH__.audit())')
    try { return { url: t.url, ...JSON.parse(r) } } catch { return { error: 'audit-failed', raw: r } }
  })
}

/** 抓取页面上所有可见的 UI 字符串（给 extract 用） */
export async function extractStrings(config, { match, includeAttrs = true } = {}) {
  const targets = await listTargets(config.debug.pagePort)
  const t = pickPage(targets, match)
  if (!t) return { error: 'no-page' }
  return withTarget(t, async ({ evaluate }) => {
    const expr = `(() => {
      const out = new Set();
      const attrs = ${JSON.stringify(includeAttrs ? (config.engine.attrs || ['placeholder', 'title', 'aria-label', 'alt']) : [])};
      for (const el of document.querySelectorAll('*')) {
        for (const a of attrs) { const v = el.getAttribute && el.getAttribute(a); if (v) out.add(v.replace(/\\s+/g,' ').trim()) }
      }
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const v = (w.currentNode.nodeValue || '').replace(/\\s+/g,' ').trim(); if (v) out.add(v) }
      const list = [...out].filter(s => /[A-Za-z]/.test(s) && s.length <= 160).sort();
      return JSON.stringify({ url: location.href, strings: list });
    })()`
    const r = await evaluate(expr)
    try { return JSON.parse(r) } catch { return { error: 'extract-failed' } }
  })
}

/** 守护循环 */
export async function watch(config, dict, { onEvent = () => {}, signal } = {}) {
  const idleMs = config.watch?.exitAfterIdleMs ?? 600000
  let lastSeen = Date.now()
  let lastMenu = ''
  let stopped = false
  if (signal) signal.addEventListener('abort', () => { stopped = true })

  const tick = async () => {
    if (stopped) return
    const results = await injectTargets(config, dict)
    if (config.debug.pagePort && (await portAlive(config.debug.pagePort))) lastSeen = Date.now()
    for (const r of results) if (r.result && !r.result.skipped) onEvent('inject', r)
    if (results.length) lastSeen = Date.now()

    const menu = await patchMenu(config, dict)
    const menuStr = JSON.stringify(menu)
    if (menuStr !== lastMenu && !menu?.skipped) { lastMenu = menuStr; onEvent('menu', menu) }
    if (!menu?.skipped) lastSeen = Date.now()

    if (Date.now() - lastSeen > idleMs) { onEvent('idle-exit', { idleMs }); stopped = true }
  }

  await tick()
  while (!stopped) {
    await sleep(config.watch?.intervalMs ?? 2500)
    await tick()
  }
  return { stopped: true }
}