#!/usr/bin/env node
import { C, fail, info, log } from '../src/util.mjs'
import {
  cmdApply, cmdDict, cmdDoctor, cmdExtract, cmdInit, cmdInstallLauncher, cmdManifest,
  cmdBrand, cmdMenu, cmdPreset, cmdStart, cmdStatus, cmdStop, cmdTodo, cmdVerify, COMMANDS,
} from '../src/commands.mjs'

const argv = process.argv.slice(2)

// 解析 --flag / --key value，其余为位置参数
function parse(argv) {
  const args = []
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { args.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=')
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (inline !== undefined) { opts[key] = inline; continue }
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++ }
      else opts[key] = true
    } else args.push(a)
  }
  return { args, opts }
}

const { args, opts } = parse(argv)
const cmd = args.shift() || (opts.help || opts.h ? 'help' : 'help')

const table = {
  init: cmdInit, doctor: cmdDoctor, start: cmdStart, run: cmdStart, apply: cmdApply,
  stop: cmdStop, status: cmdStatus, extract: cmdExtract, todo: cmdTodo, verify: cmdVerify,
  menu: cmdMenu, dict: cmdDict, brand: cmdBrand, 'install-launcher': cmdInstallLauncher, preset: cmdPreset,
  manifest: cmdManifest,
}

function usage() {
  log(`${C.bold}zh-patch${C.reset} —— Electron 应用运行时汉化（对 Agent 友好）\n`)
  log(`用法：zh-patch <命令> [参数] [--json]\n`)
  const width = Math.max(...Object.values(COMMANDS).map(c => c.usage.length))
  for (const [name, c] of Object.entries(COMMANDS)) {
    log(`  ${name.padEnd(18)} ${c.usage.replace(name, '').trim().padEnd(width)}  ${C.dim}${c.desc}${C.reset}`)
  }
  log(`\n典型流程：`)
  log(`  zh-patch init --app "/Applications/Pen.app"   # 生成配置（或 zh-patch preset use pen）`)
  log(`  zh-patch start                                # 带汉化启动`)
  log(`  zh-patch todo --json                          # 取未翻译清单`)
  log(`  zh-patch verify --min 90                      # 覆盖率验收`)
  log(`\n${C.dim}给 Agent 用：zh-patch manifest --json${C.reset}`)
}

if (cmd === 'help' || cmd === '--help' || cmd === '-h') { usage(); process.exit(0) }
if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  log(pkg.version); process.exit(0)
}
const fn = table[cmd]
if (!fn) { fail(`未知命令：${cmd}`); usage(); process.exit(2) }

try {
  await fn(args, opts)
} catch (e) {
  if (opts.json) log(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2))
  else { fail(String(e.message || e)); if (opts.debug) console.error(e) }
  process.exit(1)
}