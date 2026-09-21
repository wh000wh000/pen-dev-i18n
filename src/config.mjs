import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists, readJson, writeJson, fail, log, C } from './util.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG_NAME = 'zh-patch.config.json'

export const DEFAULT_CONFIG = {
  $schema: 'https://raw.githubusercontent.com/wh000wh000/pen-dev-i18n/main/schema/zh-patch.config.schema.json',
  app: {
    name: 'MyApp',
    // macOS: .app 路径；Windows: .exe 路径；Linux: AppImage / bin 路径
    path: '/Applications/MyApp.app',
    // 可选：用于识别进程（默认取 path 的文件名）
    processPattern: 'MyApp',
  },
  debug: { pagePort: 9333, inspectPort: 9229 },
  // 目标语言（BCP-47 精简写法）。词典路径默认按 dict/<app>.<lang>.json 约定。
  lang: 'zh-CN',
  dict: 'dict/myapp.zh-CN.json',
  engine: {
    attrs: ['placeholder', 'title', 'aria-label', 'alt', 'data-placeholder'],
    skipTags: ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE'],
    skipSelector: '[contenteditable="true"],[data-zh-patch-skip]',
    pseudoAttrs: ['data-placeholder'],
    attrMaxLength: 160,
    rules: [],
    // 只影响 todo/verify 的统计口径：这些容器里是「内容」（智能体正文、用户输入），不是界面文案
    auditSkipSelector: '',
  },
  menu: { enabled: true, extraKeys: [] },
  // 生图旁路：把宿主 App 的托管出图请求转发到你自己的 OpenAI 兼容出图服务。
  // 默认关闭。开启后由 `start` 的守护进程在本机 IPv6 回环（CSP 白名单 origin）上起转发器。
  imagegen: {
    enabled: false,
    match: '/generate-image',          // 命中宿主请求 URL 的片段
    bridgePort: 3001,
    bridgeUrl: 'http://api.localhost:3001',
    bridgePath: '/generate-image',
    bridgeToken: null,
    baseUrl: 'http://127.0.0.1:8080/v1',
    apiKey: null,
    model: 'gpt-5.5',
    toolModel: 'gpt-image-2.5-sunburst',
    providerMap: {},
    size: '1024x1024',
    quality: 'high',
    n: 1,
    fallbackToOriginal: true,
  },
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

/** 已知语言包（仓库自带） */
export const KNOWN_LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt-BR', 'Português (Brasil)'],
  ['ru', 'Русский'], ['it', 'Italiano'], ['vi', 'Tiếng Việt'], ['tr', 'Türkçe'],
]
export const LANG_LABEL = Object.fromEntries(KNOWN_LANGS)

/** dict/<app>.<lang>.json 约定：把当前词典路径里的语言段换掉 */
export function dictPathForLang(config, lang) {
  const cur = config.dict || ''
  const m = /^(.*?)([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/.exec(cur)
  if (m) return path.resolve(config.__root, `${m[1]}${lang}.json`)
  const base = cur.replace(/\.json$/, '')
  return path.resolve(config.__root, `${base}.${lang}.json`)
}

/** 列出本机可用的语言包（按词典文件是否存在） */
export function availableLangs(config) {
  return KNOWN_LANGS.map(([code, label]) => ({
    code, label, dict: dictPathForLang(config, code), exists: exists(dictPathForLang(config, code)),
  }))
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