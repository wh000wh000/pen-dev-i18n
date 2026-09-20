/** 极简 Chrome DevTools Protocol 客户端：连上 Electron 的调试端口做点事 */

export async function listTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

export async function portAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`)
    return r.ok
  } catch { return false }
}

export function pickPage(targets, match) {
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!match) return pages[0] ?? null
  return pages.find(t => new RegExp(match).test(t.url || '')) ?? pages[0] ?? null
}

/** 打开一条 CDP 会话；fn 里可用 evaluate / send / screenshot */
export async function withTarget(target, fn) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let id = 0
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('连接调试端口超时')), 5000)
    ws.onopen = () => { clearTimeout(t); res() }
    ws.onerror = () => { clearTimeout(t); rej(new Error('调试端口连接失败')) }
  })
  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}, timeoutMs = 15000) => new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ __timeout: true }) } }, timeoutMs)
  })
  const evaluate = async (expression, { commandLineAPI = false } = {}) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: commandLineAPI })
    if (r?.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      return { __error: d.exception?.description || d.text || 'unknown error' }
    }
    return r?.result?.result?.value
  }
  try { return await fn({ evaluate, send, target }) } finally { try { ws.close() } catch {} }
}

export async function screenshot(target, file) {
  return withTarget(target, async ({ send }) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const data = r?.result?.data
    if (!data) return null
    const fs = await import('node:fs')
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  })
}