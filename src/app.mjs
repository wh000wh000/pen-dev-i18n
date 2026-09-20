import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portAlive } from './cdp.mjs'
import { sleep, waitFor } from './util.mjs'

export const IS_MAC = process.platform === 'darwin'
export const IS_WIN = process.platform === 'win32'

export function appName(config) {
  return config.app.name || path.basename(config.app.path).replace(/\.app$/, '')
}

export function processPattern(config) {
  if (config.app.processPattern) return config.app.processPattern
  const p = config.app.path || ''
  if (IS_MAC) return path.join(p, 'Contents', 'MacOS', path.basename(p, '.app'))
  return path.basename(p)
}

/** 列出匹配进程的 pid（macOS/Linux 用 pgrep，Windows 用 tasklist） */
export function findPids(config) {
  const pattern = processPattern(config)
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(pattern)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      return out.split('\n').map(l => Number((l.match(/^"[^"]+","(\d+)"/) || [])[1])).filter(Boolean)
    }
    const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
    return out.split('\n').map(s => Number(s.trim())).filter(Boolean)
  } catch { return [] }
}

export function isRunning(config) { return findPids(config).length > 0 }

/** 该 App 是否已开启调试端口 */
export async function hasDebugPort(config) {
  return (await portAlive(config.debug.pagePort)) && (await portAlive(config.debug.inspectPort))
}

export function mainExecutable(appPath) {
  if (IS_MAC) {
    const name = path.basename(appPath, '.app')
    return path.join(appPath, 'Contents', 'MacOS', name)
  }
  return appPath
}

/** 以调试端口启动（macOS 用 open，保留正常窗口/权限行为） */
export function launch(config, { wait = true, timeout = 30000 } = {}) {
  const args = [`--remote-debugging-port=${config.debug.pagePort}`]
  if (config.debug.inspectPort) args.push(`--inspect=${config.debug.inspectPort}`)
  const extra = config.app.launchArgs || []
  const all = [...args, ...extra]

  if (IS_MAC && config.app.path.endsWith('.app')) {
    const child = spawn('open', ['-a', config.app.path, '--args', ...all], { detached: true, stdio: 'ignore' })
    child.unref()
  } else {
    const exe = mainExecutable(config.app.path)
    if (!fs.existsSync(exe)) throw new Error(`找不到可执行文件：${exe}`)
    const child = spawn(exe, all, { detached: true, stdio: 'ignore' })
    child.unref()
  }
  if (!wait) return Promise.resolve(true)
  return waitFor(() => portAlive(config.debug.pagePort), { timeout })
}

export async function quit(config) {
  if (IS_MAC && config.app.path.endsWith('.app')) {
    const name = appName(config)
    try { execFileSync('osascript', ['-e', `quit app "${name}"`], { stdio: 'ignore' }) } catch {}
  } else {
    for (const pid of findPids(config)) { try { process.kill(pid, 'SIGTERM') } catch {} }
  }
  return waitFor(() => findPids(config).length === 0, { timeout: 15000 })
}

export async function forceKill(config) {
  for (const pid of findPids(config)) { try { process.kill(pid, 'SIGKILL') } catch {} }
  await sleep(500)
}

/** 从路径里猜配置（init 用） */
export function detectApp(appPath) {
  const abs = path.resolve(appPath)
  let name = path.basename(abs).replace(/\.app$/, '')
  let processPattern = null
  let electron = false
  let dictHint = null

  if (IS_MAC && abs.endsWith('.app')) {
    processPattern = path.join(abs, 'Contents', 'MacOS', name)
    const res = path.join(abs, 'Contents', 'Resources')
    electron = fs.existsSync(path.join(res, 'app.asar')) || fs.existsSync(path.join(res, 'app'))
    const plist = path.join(abs, 'Contents', 'Info.plist')
    if (fs.existsSync(plist)) {
      try {
        const out = execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' })
        const info = JSON.parse(out)
        if (info.CFBundleName) name = info.CFBundleName
        if (info.CFBundleIdentifier) dictHint = String(info.CFBundleIdentifier).split('.').pop()
      } catch {}
    }
  } else {
    processPattern = abs
    electron = fs.existsSync(path.join(path.dirname(abs), 'resources', 'app.asar'))
  }
  return { appPath: abs, name, processPattern, electron, slug: (dictHint || name).toLowerCase().replace(/[^a-z0-9]+/g, '-') }
}