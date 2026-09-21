/**
 * zh-patch 注入引擎（在目标 App 的渲染进程里运行）
 *
 * 由 injector 以 `window.__ZH_PATCH_BOOT__ = {...}; <本文件>` 的形式注入。
 * 这里刻意写成「无构建、无依赖、ES5 风格」的独立文件，避免模板字符串转义踩坑。
 */
(function () {
  var BOOT = window.__ZH_PATCH_BOOT__ || {};
  var DICT = BOOT.dict || {};
  var VER = BOOT.version || '0';
  var ATTRS = BOOT.attrs || ['placeholder', 'title', 'aria-label', 'alt', 'data-placeholder'];
  var SKIP_TAGS = {}
  ;(BOOT.skipTags || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']).forEach(function (t) { SKIP_TAGS[t] = 1 })
  var SKIP_SELECTOR = BOOT.skipSelector || '[contenteditable="true"],[data-zh-patch-skip]'
  var PSEUDO_ATTRS = BOOT.pseudoAttrs || ['data-placeholder']
  var LIMIT = BOOT.attrMaxLength || 160
  var IMAGEGEN = BOOT.imagegen || null
  var AUDIT_IGNORE = []
  ;(BOOT.auditIgnore || []).forEach(function (p) { try { AUDIT_IGNORE.push(new RegExp(p, 'i')) } catch (e) {} })

  var prev = window.__ZH_PATCH__
  if (prev && prev.version === VER) return { ok: true, skipped: 'same-version', version: VER }
  var langChanged = !!(prev && prev.lang && prev.lang !== BOOT.lang)
  if (prev && prev.restore) { try { prev.restore() } catch (e) {} }
  if (prev && prev.destroy) { try { prev.destroy() } catch (e) {} }

  // ---- 动态文案规则 ----------------------------------------------------------
  var RULES = [
    [/^Edited (.+)$/, '编辑于 $1'],
    [/^Opened (.+)$/, '打开于 $1'],
    [/^Created (.+)$/, '创建于 $1'],
    [/^Modified (.+)$/, '修改于 $1'],
    [/^Last edited (.+)$/, '最后编辑于 $1'],
    [/^Thought for (.+)$/, '思考了 $1'],
    [/^Worked for (.+)$/, '工作了 $1'],
    [/^Worked for (.+)$/, '工作了 $1'],
    [/^Ran for (.+)$/, '运行了 $1'],
    [/^Waiting for (.+)$/, '等待了 $1'],
    [/^Step (\d+)$/, '第 $1 步'],
    [/^Attempt (\d+)$/, '第 $1 次尝试'],
    [/^(\d+) models?$/, '$1 个模型'],
    [/^(\d+) files?$/, '$1 个文件'],
    [/^(\d+) lines?$/, '$1 行'],
    [/^(\d+) results?$/, '$1 条结果'],
    [/^(\d+) selected$/, '已选 $1 项'],
    [/^(\d+) of (\d+)$/, '$1 / $2'],
    [/^Show (\d+) more$/, '再显示 $1 条'],
    [/^\+(\d+) more$/, '还有 $1 条'],
    [/^(\d+) (days?|hours?|minutes?|seconds?) ago$/, '$1 前']
  ]
  ;(BOOT.rules || []).forEach(function (r) {
    try { RULES.unshift([new RegExp(r[0]), r[1]]) } catch (e) {}
  })

  // ---- 工具 ------------------------------------------------------------------
  function matches(el, sel) {
    try { return el.matches && el.matches(sel) } catch (e) { return false }
  }
  function blockedText(node) {
    var el = node.nodeType === 1 ? node : node.parentElement
    while (el) {
      if (SKIP_TAGS[el.tagName]) return true
      if (matches(el, SKIP_SELECTOR)) return true
      el = el.parentElement
    }
    return false
  }
  var SKIP_ATTR_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 }
  function blockedAttr(el) {
    var n = el
    while (n) {
      if (SKIP_ATTR_TAGS[n.tagName]) return true
      if (matches(n, '[data-zh-patch-skip]')) return true
      n = n.parentElement
    }
    return false
  }
  function translate(raw) {
    if (raw == null) return null
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)
    if (!m) return null
    var body = m[2]
    if (!body) return null
    var out = Object.prototype.hasOwnProperty.call(DICT, body) ? DICT[body] : undefined
    if (out === undefined) {
      // 软匹配：DOM 把 "... via" 和 "+" 拆成两个节点时，用更长的词典 key 命中
      for (var pk in DICT) {
        if (pk.length > body.length && pk.length - body.length <= 2 && pk.indexOf(body) === 0) {
          var tail = pk.slice(body.length)
          if (!/[A-Za-z0-9]/.test(tail)) { out = DICT[pk].slice(0, DICT[pk].length) ; break }
        }
      }
    }
    if (out === undefined) {
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i][0].test(body)) { out = body.replace(RULES[i][0], RULES[i][1]); break }
      }
    }
    if (out === undefined || out === body) return null
    return m[1] + out + m[3]
  }

  // 伪元素占位符（tiptap / ProseMirror 用 ::before content: attr(data-placeholder)）：
  // 编辑器内核会把属性改回英文，所以补一条 CSS 规则，用英文值当选择器渲染中文。
  var cssSeen = {}
  var BS = String.fromCharCode(92)
  function cssEscape(s) { return s.split(BS).join(BS + BS).split('"').join(BS + '"') }
  function ensureCss(eng, zh) {
    if (cssSeen[eng]) return
    cssSeen[eng] = 1
    var style = document.querySelector('style[data-zh-patch]')
    if (!style) {
      style = document.createElement('style')
      style.setAttribute('data-zh-patch', '')
      ;(document.head || document.documentElement).appendChild(style)
    }
    var rule = ''
    for (var i = 0; i < PSEUDO_ATTRS.length; i++) {
      rule += '[' + PSEUDO_ATTRS[i] + '="' + cssEscape(eng) + '"]::before,'
      rule += '[' + PSEUDO_ATTRS[i] + '="' + cssEscape(eng) + '"]::after{content:"' + cssEscape(zh) + '" !important;}'
    }
    style.textContent += rule + String.fromCharCode(10)
  }

  // ---- 翻译动作 ---------------------------------------------------------------
  var stats = { text: 0, attr: 0, pseudo: 0 }
  // 去重后的「已翻译原文」。重新注入时继承上一次的结果，
  // 这样覆盖率反映的是「本页生命周期内翻译过多少」，而不是本次注入的增量。
  var translatedSet = (prev && prev.__translated && prev.__lang === BOOT.lang) ? prev.__translated : {}
  var ORIG_KEY = '__zhPatchOrig'
  function doText(node) {
    if (blockedText(node)) return
    var v = node.nodeValue
    if (!v || v.length > LIMIT) return
    var t = translate(v)
    if (t !== null && t !== v && node[ORIG_KEY] === undefined) {
      try { Object.defineProperty(node, ORIG_KEY, { value: v, writable: true, configurable: true, enumerable: false }) } catch (e) { node[ORIG_KEY] = v }
    }
    if (t !== null && t !== v) { translatedSet[v.trim()] = 1; node.nodeValue = t; stats.text++ }
  }
  function doAttrs(el) {
    if (!el.getAttribute || blockedAttr(el)) return
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i]
      var v = el.getAttribute(a)
      if (!v || v.length > LIMIT) continue
      var t = translate(v)
      if (t !== null && t !== v) {
        if (!el[ORIG_KEY]) {
          try { Object.defineProperty(el, ORIG_KEY, { value: {}, writable: true, configurable: true, enumerable: false }) } catch (e) { el[ORIG_KEY] = {} }
        }
        if (el[ORIG_KEY][a] === undefined) el[ORIG_KEY][a] = v
        translatedSet[v.trim()] = 1
        if (PSEUDO_ATTRS.indexOf(a) >= 0) { ensureCss(v, t); stats.pseudo++ }
        el.setAttribute(a, t)
        stats.attr++
      }
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit')) {
      var val = el.value
      var tv = val && translate(val)
      if (tv !== null && tv !== val) { el.value = tv; stats.attr++ }
    }
  }

  var scheduled = false
  var pending = []
  function flush() {
    scheduled = false
    var list = pending
    pending = []
    for (var i = 0; i < list.length; i++) {
      var n = list[i]
      try {
        if (n.isConnected === false) continue
        if (n.nodeType === 3) doText(n)
        else if (n.nodeType === 1) {
          doAttrs(n)
          var els = n.querySelectorAll('*')
          for (var j = 0; j < els.length; j++) doAttrs(els[j])
          var w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT)
          while (w.nextNode()) doText(w.currentNode)
        }
      } catch (e) {}
    }
  }
  function schedule(n) {
    if (pending.indexOf(n) < 0) pending.push(n)
    if (!scheduled) { scheduled = true; (window.requestAnimationFrame || setTimeout)(flush) }
  }
  function scanAll() { if (document.body) schedule(document.body) }

  /** 把上一次翻译过的节点还原成原文（换语言/换词典时先做这一步） */
  function restoreAll() {
    if (!document.body) return 0
    var n = 0
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      var node = w.currentNode
      if (node[ORIG_KEY] !== undefined && node.nodeValue !== node[ORIG_KEY]) { node.nodeValue = node[ORIG_KEY]; n++ }
    }
    var els = document.body.querySelectorAll('*')
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      var keep = el[ORIG_KEY]
      if (!keep) continue
      for (var a in keep) {
        if (el.getAttribute(a) !== keep[a]) { el.setAttribute(a, keep[a]); n++ }
      }
    }
    return n
  }

  // ---- 覆盖率审计（给 Agent 用的机器可读接口）--------------------------------
  function audit() {
    var seen = {}
    var unknown = {}
    var known = 0
    var total = 0
    function consider(v) {
      if (!v) return
      var s = String(v).replace(/\s+/g, ' ').trim()
      if (s.length < 2 || s.length > LIMIT) return
      if (!/[A-Za-z]/.test(s)) return
      if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(s)) return          // 已经是中文（或中英混排的已译文案）
      if (seen[s]) return
      seen[s] = 1
      total++
      if (Object.prototype.hasOwnProperty.call(DICT, s)) { known++; return }
      if (/^https?:\/\/|^[\w.+-]+@/.test(s)) return
      if (/^[\w.-]+\.(js|ts|tsx|css|json|png|jpg|svg|md|com|dev|io|ai|app|org|net|cn)(:\d+)?$/i.test(s)) return
      if (/^[\w.-]+:\d+$/.test(s)) return
      for (var ri = 0; ri < AUDIT_IGNORE.length; ri++) if (AUDIT_IGNORE[ri].test(s)) return
      unknown[s] = 1
    }
    if (!document.body) return { total: 0, known: 0, unknown: [] }
    var all = document.body.querySelectorAll('*')
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if (blockedAttr(el)) continue
      for (var k = 0; k < ATTRS.length; k++) consider(el.getAttribute && el.getAttribute(ATTRS[k]))
    }
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) { if (!blockedText(w.currentNode)) consider(w.currentNode.nodeValue) }
    var list = []
    for (var key in unknown) list.push(key)
    list.sort()
    var translated = Object.keys(translatedSet).length
    return { total: total, known: known, unknown: list, translated: translated, applied: stats.text + stats.attr + stats.pseudo, stats: stats }
  }

  // ---- 生命周期 ---------------------------------------------------------------
  var timers = []
  var obs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var mu = muts[i]
      if (mu.type === 'characterData') {
        var v = mu.target.nodeValue
        if (v && Object.prototype.hasOwnProperty.call(DICT, v.trim())) schedule(mu.target)
      } else if (mu.type === 'attributes') {
        if (mu.target) schedule(mu.target)
      } else {
        for (var j = 0; j < mu.addedNodes.length; j++) {
          var n = mu.addedNodes[j]
          if (n.nodeType === 3 || n.nodeType === 1) schedule(n)
        }
      }
    }
  })
  // ---- 生图旁路：把宿主的出图请求改写到本地转发器（CSP 白名单 origin）------------
  function installImagegen() {
    if (!IMAGEGEN || !IMAGEGEN.enabled || !IMAGEGEN.bridgeUrl) return
    if (window.__zhPatchFetchInstalled) return
    var origFetch = window.fetch ? window.fetch.bind(window) : null
    if (!origFetch) return
    var match = IMAGEGEN.match || '/generate-image'
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || ''
        if (url && url.indexOf(match) >= 0) {
          var target = IMAGEGEN.bridgeUrl + (IMAGEGEN.bridgePath || '/generate-image')
          var headers = {}
          try { new Headers(init && init.headers).forEach(function (v, k) { headers[k] = v }) } catch (e) {}
          headers['x-zh-patch'] = IMAGEGEN.token || ''
          var nextInit = Object.assign({}, init, { headers: headers })
          if (typeof input === 'string') return origFetch(target, nextInit)
          try { return origFetch(new Request(target, input), nextInit) } catch (e) { return origFetch(target, nextInit) }
        }
      } catch (e) {}
      return origFetch(input, init)
    }
    window.__zhPatchFetchInstalled = true
  }

  function start() {
    if (!document.body) { timers.push(setTimeout(start, 100)); return }
    obs.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    })
    scanAll()
    installImagegen()
    ;[300, 900, 2000, 4000].forEach(function (d) { timers.push(setTimeout(scanAll, d)) })
    timers.push(setInterval(function () {
      var els = document.querySelectorAll('[data-placeholder],[placeholder]')
      for (var i = 0; i < els.length; i++) doAttrs(els[i])
    }, 3000))
  }

  window.__ZH_PATCH__ = {
    version: VER,
    lang: BOOT.lang || null,
    restore: restoreAll,
    __translated: translatedSet,
    dictSize: Object.keys(DICT).length,
    applyNow: scanAll,
    audit: audit,
    stats: stats,
    destroy: function () {
      try { obs.disconnect() } catch (e) {}
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t) })
      timers = []
      var st = document.querySelector('style[data-zh-patch]')
      if (st && st.parentNode) st.parentNode.removeChild(st)
    }
  }
  start()
  return { ok: true, version: VER, dictSize: window.__ZH_PATCH__.dictSize }
})()