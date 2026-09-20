import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STATE_DIR = path.join(os.homedir(), '.zh-patch')
export const PID_FILE = path.join(STATE_DIR, 'watch.pid')
export const LOG_FILE = path.join(STATE_DIR, 'watch.log')

export const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
}

export function log(msg = '') { process.stdout.write(msg + '\n') }
export function ok(msg) { log(`${C.green}✓${C.reset} ${msg}`) }
export function warn(msg) { log(`${C.yellow}!${C.reset} ${msg}`) }
export function fail(msg) { log(`${C.red}✗${C.reset} ${msg}`) }
export function info(msg) { log(`${C.dim}${msg}${C.reset}`) }
export function head(msg) { log(`\n${C.bold}${msg}${C.reset}`) }

export function ensureStateDir() { fs.mkdirSync(STATE_DIR, { recursive: true }) }

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}
export function exists(p) { try { fs.accessSync(p); return true } catch { return false } }

/** 统一的输出出口：--json 时只吐 JSON，人类模式下走 render() */
export function output(json, human, asJson) {
  if (asJson) process.stdout.write(JSON.stringify(json, null, 2) + '\n')
  else if (human) human()
  return json
}

export function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch { return null }
}

export function globFreePort(start, tries = 20) {
  return start // 单实例场景够用：端口被占由调用方提示
}

export async function waitFor(fn, { timeout = 20000, interval = 400 } = {}) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await fn(); if (v) return v } catch {}
    if (Date.now() - t0 > timeout) return null
    await sleep(interval)
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }