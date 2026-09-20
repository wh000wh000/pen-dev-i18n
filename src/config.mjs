import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists, readJson, writeJson, fail, log, C } from './util.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG_NAME = 'zh-patch.config.json'

export const DEFAULT_CONFIG = {
  $schema: 'https://raw.githubusercontent.com/wh000wh000/zh-patch/main/schema/zh-patch.config.schema.json',
  app: {
    name: 'MyApp',
    // macOS: .app 路径；Windows: .exe 路径；Linux: AppImage / bin 路径
    path: '/Applications/MyApp.app',
    // 可选：用于识别进程（默认取 path 的文件名）
    processPattern: 'MyApp',
  },
  debug: { pagePort: 9333, inspectPort: 9229 },
  dict: 'dict/myapp.zh.json',
  engine: {
    attrs: ['placeholder', 'title', 'aria-label', 'alt', 'data-placeholder'],
    skipTags: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE'],
    skipSelector: '[contenteditable="true"],[data-zh-patch-skip]',
    pseudoAttrs: ['data-placeholder'],
    attrMaxLength: 160,
    rules: [],
  },
  menu: { enabled: true, extraKeys: [] },
  watch: { intervalMs: 2500, menuIntervalMs: 8000, exitAfterIdleMs: 600000 },
}

export function findConfigPath(cwd = process.cwd()) {
  let dir = path.resolve(cwd)
  for (;;) {
    const p = path.join(dir, CONFIG_NAME)
    if (exists(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadConfig({ cwd = process.cwd(), configPath = null, allowMissing = false } = {}) {
  const file = configPath ? path.resolve(configPath) : findConfigPath(cwd)
  if (!file) {
    if (allowMissing) return { file: null, config: null }
    fail(`找不到 ${CONFIG_NAME}。先在目标 App 目录运行：zh-patch init --app "/Applications/YourApp.app"`)
    process.exit(2)
  }
  const raw = readJson(file)
  if (!raw) { fail(`配置文件不是合法 JSON：${file}`); process.exit(2) }
  const config = merge(DEFAULT_CONFIG, raw)
  config.__file = file
  config.__root = path.dirname(file)
  return { file, config }
}

export function merge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base
  if (typeof base !== 'object' || base === null) return override ?? base
  if (typeof override !== 'object' || override === null) return override ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) out[k] = merge(base[k], v)
  return out
}

export function dictPath(config) {
  return path.resolve(config.__root, config.dict)
}

export function loadDict(config) {
  const p = dictPath(config)
  if (!exists(p)) return {}
  return readJson(p, {}) ?? {}
}

export function saveDict(config, dict) {
  const p = dictPath(config)
  const sorted = {}
  for (const k of Object.keys(dict).sort()) sorted[k] = dict[k]
  writeJson(p, sorted)
  return p
}

export function resolvePreset(name) {
  const p = path.join(ROOT, 'presets', `${name}.json`)
  if (!exists(p)) return null
  return readJson(p)
}

export function writeConfigTemplate(target, { name, appPath, processPattern, dictRel, pagePort, inspectPort }) {
  const cfg = merge(DEFAULT_CONFIG, {
    app: { name, path: appPath, processPattern },
    debug: { pagePort, inspectPort },
    dict: dictRel,
  })
  delete cfg.$schema
  writeJson(target, cfg)
  return cfg
}