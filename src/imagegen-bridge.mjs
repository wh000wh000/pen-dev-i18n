/**
 * 生图旁路（image generation bypass）
 *
 * 背景：宿主 App 把出图请求发到自己的后端（例如 Pen 的 POST https://api.pencil.dev/generate-image），
 * 渲染进程的 CSP 又不允许直连本机端口，所以我们把转发器挂在 **CSP 白名单里的 origin** 上
 * （`http://api.localhost:<port>`，IPv6 回环），再把页面里的请求 URL 改写到它。
 *
 * 流程：
 *   页面 fetch(原后端/ generate-image)
 *     → 注入的拦截器改写成 http://api.localhost:<port>/generate-image（CSP 允许）
 *     → 本转发器调用你自己配置的 OpenAI 兼容出图服务（如 ccswitch router 的 image2.5）
 *     → 转成宿主要求的 { success, image: <纯 base64> } 返回
 *   宿主的后续处理（base64 解码、导入文档）完全不变。
 */
import http from 'node:http'
import { Buffer } from 'node:buffer'

const DEFAULT_PORT = 3001
const HOSTNAME = 'api.localhost'   // 必须解析到 ::1，且出现在宿主 CSP 的 connect-src 白名单里

/** 把上游（OpenAI 兼容 /images/generations）的响应转成宿主需要的形状 */
async function callUpstream(cfg, { prompt, provider }) {
  const toolModel = (cfg.providerMap && cfg.providerMap[provider]) || cfg.toolModel
  const url = `${String(cfg.baseUrl).replace(/\/$/, '')}/images/generations`
  const payload = {
    model: cfg.model,
    prompt,
    n: cfg.n ?? 1,
    size: cfg.size ?? '1024x1024',
    ...(toolModel ? { toolModel } : {}),
    ...(cfg.quality ? { quality: cfg.quality } : {}),
    ...(cfg.background ? { background: cfg.background } : {}),
    ...(cfg.outputFormat ? { output_format: cfg.outputFormat } : {}),
  }
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  if (!res.ok) throw new Error(`upstream ${res.status}: ${text.slice(0, 200)}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`upstream 返回非 JSON：${text.slice(0, 120)}`) }
  const item = (json.data || [])[0] || {}
  const b64 = item.b64_json || null
  if (!b64) throw new Error('upstream 没有返回 b64_json')
  return { b64, upstream: { model: cfg.model, toolModel } }
}

export async function startImageBridge(cfg, { log = () => {} } = {}) {
  const port = cfg.bridgePort === undefined ? DEFAULT_PORT : cfg.bridgePort
  const token = cfg.bridgeToken || null

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOSTNAME}:${port}`)
    // 页面 origin 是 pencil:// 这类自定义 scheme，属于跨源请求：
    // 必须回 CORS 头，而且带自定义头时会先发 OPTIONS 预检。
    const cors = {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-zh-patch',
      'access-control-max-age': '600',
      vary: 'origin',
    }
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...cors })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') return send(204)
    if (req.method !== 'POST') return send(405, { success: false, error: 'method not allowed' })
    if (token && req.headers['x-zh-patch'] !== token) return send(403, { success: false, error: 'forbidden' })

    let body = ''
    for await (const chunk of req) body += chunk
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { return send(400, { success: false, error: 'bad json' }) }

    if (!url.pathname.endsWith('/generate-image')) {
      return send(404, { success: false, error: `未实现：${url.pathname}` })
    }
    try {
      const { prompt, imageGeneratorProvider } = payload
      const { b64, upstream } = await callUpstream(cfg, { prompt, provider: imageGeneratorProvider })
      log(`image2.5 出图成功：provider=${imageGeneratorProvider || '-'} → ${upstream.model}${upstream.toolModel ? '+' + upstream.toolModel : ''}，${Math.round(b64.length / 1024)}KB base64`)
      return send(200, { success: true, image: b64, request_id: 'zh-patch', version: 'image2.5' })
    } catch (e) {
      log(`出图失败：${e.message}`)
      // 失败时回落到原后端，避免用户直接卡死
      if (cfg.fallbackToOriginal) return send(200, { success: false, error: `zh-patch bypass: ${e.message}`, __fallback: true })
      return send(502, { success: false, error: String(e.message || e) })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '::1', resolve)
  })
  const addr = server.address()
  log(`生图旁路已监听 http://${HOSTNAME}:${addr.port}（IPv6 回环，命中宿主 CSP 白名单）`)
  return {
    url: `http://${HOSTNAME}:${addr.port}`,
    close: () => new Promise((r) => server.close(() => r())),
  }
}
