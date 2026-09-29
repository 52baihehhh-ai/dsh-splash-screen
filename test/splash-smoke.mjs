// 冒烟测试：加载 client 半并驱动开屏本体（含新的点阵引擎），跑完整条时间轴。
// 用最小 DOM + canvas 2D 桩，不需要浏览器、不需要 DSH 在跑。
//
// 用法：node test/splash-smoke.mjs [client.js 的路径]
// 不给参数时默认读本仓库根目录的 client.js。
import { readFileSync } from 'node:fs'

const CLIENT = process.argv[2] ?? new URL('../client.js', import.meta.url)
const source = readFileSync(CLIENT, 'utf8')

const problems = []
const created = []
const rafQueue = []
const timers = []
const windowListeners = []
const canvasCalls = { fillRect: 0, arc: 0, fillText: 0, clearRect: 0, getImageData: 0 }
let now = 0
let lastFrameAt = -1

/* ------------------------------------------------------------- 最小 DOM */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    childNodes: [],
    parentNode: null,
    className: '',
    textContent: '',
    _html: '',
    _attrs: {},
    _events: [],
    style: { setProperty() {}, removeProperty() {} },
    clientWidth: 1280,
    clientHeight: 800,
    classList: {
      _set: new Set(),
      add(...names) {
        names.forEach((n) => this._set.add(n))
      },
      remove(...names) {
        names.forEach((n) => this._set.delete(n))
      },
      contains(name) {
        return this._set.has(name)
      },
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v)
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null
    },
    removeAttribute(k) {
      delete this._attrs[k]
    },
    addEventListener(type, fn) {
      this._events.push([type, fn])
    },
    removeEventListener() {},
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.push(child)
      return child
    },
    insertBefore(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = this
      this.childNodes.unshift(child)
      return child
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child)
      if (i >= 0) this.childNodes.splice(i, 1)
      child.parentNode = null
      return child
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this)
    },
    getContext() {
      return makeCtx()
    },
    querySelector(selector) {
      return query(this, selector)
    },
    querySelectorAll(selector) {
      const m = /\[([\w-]+)\]/.exec(selector)
      const out = []
      if (m) collectByAttr(this, m[1], out)
      return out
    },
    get firstChild() {
      return this.childNodes[0] ?? null
    },
    set innerHTML(html) {
      this._html = String(html)
      this.childNodes = []
      const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g
      let m
      while ((m = tagRe.exec(this._html)) !== null) {
        const el = makeEl(m[1])
        const attrs = m[2] ?? ''
        const classMatch = /class="([^"]*)"/.exec(attrs)
        if (classMatch) el.className = classMatch[1]
        const attrRe = /([\w-]+)(?:="([^"]*)")?/g
        let a
        while ((a = attrRe.exec(attrs)) !== null) {
          if (a[1].toLowerCase() === 'class') continue
          el.setAttribute(a[1], a[2] ?? '')
        }
        el.parentNode = this
        this.childNodes.push(el)
      }
    },
    get innerHTML() {
      return this._html
    },
    contains(node) {
      if (node === this) return true
      return this.childNodes.some((c) => c.contains && c.contains(node))
    },
  }
  created.push(el)
  return el
}

function makeCtx() {
  return {
    canvas: null,
    fillStyle: '#000',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    setTransform() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    clearRect() {
      canvasCalls.clearRect += 1
    },
    fillRect() {
      canvasCalls.fillRect += 1
    },
    beginPath() {},
    arc() {
      canvasCalls.arc += 1
    },
    fill() {},
    fillText() {
      canvasCalls.fillText += 1
    },
    measureText(text) {
      return { width: String(text).length * 40 }
    },
    // 伪造点阵采样：一半单元格「有字」，从而真的走出槽位分配逻辑
    getImageData(x, y, w, h) {
      canvasCalls.getImageData += 1
      const data = new Uint8ClampedArray(w * h * 4)
      for (let yy = 0; yy < h; yy += 1) {
        for (let xx = 0; xx < w; xx += 1) {
          const on = (xx + yy) % 3 !== 0
          data[(yy * w + xx) * 4 + 3] = on ? 255 : 0
        }
      }
      return { data, width: w, height: h }
    },
  }
}

function walk(root, visit) {
  for (const child of root.childNodes ?? []) {
    if (visit(child) === true) return child
    const hit = walk(child, visit)
    if (hit) return hit
  }
  return null
}

function collectByAttr(root, name, out) {
  for (const child of root.childNodes ?? []) {
    if (child.getAttribute && child.getAttribute(name) !== null) out.push(child)
    collectByAttr(child, name, out)
  }
}

function query(root, selector) {
  const s = selector.trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    const name = s.slice(1, -1)
    return walk(root, (el) => el.getAttribute && el.getAttribute(name) !== null)
  }
  if (s.startsWith('.')) {
    const parts = s.split(/\s+/)
    const cls = parts[parts.length - 1].slice(1)
    return walk(root, (el) => el.classList && el.classList.contains(cls))
  }
  return walk(root, (el) => el.tagName === s.toUpperCase())
}

const documentElement = makeEl('html')
const head = makeEl('head')
const body = makeEl('body')
documentElement.appendChild(head)
documentElement.appendChild(body)

globalThis.document = {
  documentElement,
  head,
  body,
  readyState: 'complete',
  createElement: (tag) => makeEl(tag),
  getElementById: (id) =>
    walk(documentElement, (el) => el.getAttribute && (el.getAttribute('id') === id || el._attrs.id === id)) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
}

globalThis.window = globalThis
globalThis.innerWidth = 1280
globalThis.innerHeight = 800
globalThis.devicePixelRatio = 2
globalThis.matchMedia = () => ({ matches: false })
globalThis.sessionStorage = {
  _m: new Map(),
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null
  },
  setItem(k, v) {
    this._m.set(k, String(v))
  },
}
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null
  },
  setItem(k, v) {
    this._m.set(k, String(v))
  },
}
globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn)
  return rafQueue.length
}
globalThis.cancelAnimationFrame = () => {}
globalThis.setTimeout = (fn, ms) => {
  timers.push({ fn, at: now + (ms ?? 0), cancelled: false })
  return timers.length
}
globalThis.clearTimeout = (id) => {
  if (typeof id === 'number' && timers[id - 1]) timers[id - 1].cancelled = true
}
globalThis.AudioContext = undefined
globalThis.webkitAudioContext = undefined
globalThis.addEventListener = (type, fn, opts) => {
  windowListeners.push({ type, fn, capture: !!(opts === true || (opts && opts.capture)) })
}
globalThis.removeEventListener = (type, fn) => {
  const i = windowListeners.findIndex((l) => l.type === type && l.fn === fn)
  if (i >= 0) windowListeners.splice(i, 1)
}

/* --------------------------------------------------- 伪 React + ModuleLoader */
let captured = null
globalThis.window.__ModuleLoader__ = {
  load(reg) {
    captured = reg
  },
}

function makeReact() {
  const hooks = { states: [], index: 0, effects: [] }
  return {
    useState(initial) {
      const i = hooks.index
      hooks.index += 1
      if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? initial() : initial
      return [
        hooks.states[i],
        (v) => {
          hooks.states[i] = typeof v === 'function' ? v(hooks.states[i]) : v
        },
      ]
    },
    useEffect(fn) {
      hooks.effects.push(fn)
    },
    createElement(type, props) {
      if (typeof type === 'function') {
        hooks.index = 0
        hooks.effects = []
        const out = type(props ?? {})
        return { __component: type, out, props: props ?? {}, effects: hooks.effects.slice() }
      }
      return { type, props: props ?? {} }
    },
    Fragment: 'Fragment',
  }
}

const React = makeReact()
const requireShim = (id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}

function record(fn, label) {
  try {
    return fn()
  } catch (err) {
    problems.push(label + '：' + (err && err.stack ? err.stack : err))
    return undefined
  }
}

/* ---------------------------------------------------------------- 1) 契约 */
record(() => {
  new Function('window', 'document', 'require', 'requestAnimationFrame', 'cancelAnimationFrame', source)(
    globalThis.window,
    globalThis.document,
    requireShim,
    globalThis.requestAnimationFrame,
    globalThis.cancelAnimationFrame,
  )
}, '顶层执行')
console.log('registration.id =', captured && captured.id)
const plugin = record(() => captured.factory(requireShim), 'factory 执行')
console.log('plugin.name =', plugin && plugin.name, '| inject =', JSON.stringify(plugin && plugin.inject))
console.log('开屏本体已挂到 globalThis =', typeof globalThis.__DSH_SPLASH__ === 'object')

/* ------------------------------------- 2) 直接驱动 createSplash 本体（点阵） */
const splashApi = globalThis.__DSH_SPLASH__
if (!splashApi) {
  problems.push('未暴露 __DSH_SPLASH__')
} else {
  const container = makeEl('div')
  body.appendChild(container)
  const handle = record(
    () => splashApi.createSplash({ mount: container, owner: 'smoke', artSrc: '', muteKey: 'dsh-splash-screen:muted' }),
    'createSplash',
  )
  console.log('\n句柄 =', !!(handle && typeof handle.finish === 'function'))

  const host = container.childNodes[0]
  if (!host) {
    problems.push('开屏根未挂入容器')
  } else {
    console.log('开屏根 id =', host.getAttribute('id'), '| owner =', host.getAttribute('data-sp-owner'))
    console.log('  role =', host.getAttribute('role'))
    const canvas = host.querySelector('[data-sp-canvas]')
    const pct = host.querySelector('[data-sp-pct]')
    const fill = host.querySelector('[data-sp-fill]')
    const status = host.querySelector('[data-sp-status]')
    const seg = host.querySelector('[data-sp-seg]')
    console.log('  命中 canvas=%s pct=%s fill=%s status=%s seg=%s', !!canvas, !!pct, !!fill, !!status, !!seg)
    console.log('  进度条分段数 =', seg ? seg.childNodes.length : 0)
    if (!canvas || !pct || !fill || !status) problems.push('关键节点缺失')
    if (seg && seg.childNodes.length !== 40) problems.push('分段数不是 40：' + seg.childNodes.length)

    /* 推进时间轴：rAF 每帧把 now 推 16.7ms，setTimeout 按时间排序 */
    let guard = 0
    while ((rafQueue.length > 0 || timers.some((t) => !t.cancelled)) && guard < 60000) {
      guard += 1
      if (rafQueue.length > 0 && (timers.length === 0 || now + 16.7 <= timers.find((t) => !t.cancelled).at)) {
        now += 16.7
        const fn = rafQueue.shift()
        try {
          fn(now)
        } catch (err) {
          problems.push('rAF 回调失败：' + err.message)
          break
        }
        lastFrameAt = now
      } else {
        timers.sort((a, b) => a.at - b.at)
        const t = timers.find((x) => !x.cancelled)
        if (!t) continue
        now = Math.max(now, t.at)
        t.cancelled = true
        try {
          t.fn()
        } catch (err) {
          problems.push('setTimeout 回调失败：' + err.message)
          break
        }
      }
    }
    console.log('\n时间轴推进步数 =', guard, '| 结束 now =', Math.round(now), 'ms')
    console.log('canvas 调用：clearRect=%d fillRect=%d arc=%d fillText=%d getImageData=%d', canvasCalls.clearRect, canvasCalls.fillRect, canvasCalls.arc, canvasCalls.fillText, canvasCalls.getImageData)
    console.log('结束状态类 =', JSON.stringify([...host.classList._set]))
    console.log('结束进度 =', JSON.stringify(pct && pct.textContent), '| 条宽 =', JSON.stringify(fill && fill.style.width))
    console.log('结束状态词 =', JSON.stringify(status && status.textContent))
    console.log('结束 aria-valuenow =', host.getAttribute('aria-valuenow'))
    console.log('开屏根已移出容器 =', container.childNodes.indexOf(host) === -1)
    console.log('documentElement.overflow =', JSON.stringify(documentElement.style.overflow ?? ''))
    console.log('window 监听残留 =', windowListeners.length)

    if (pct && pct.textContent !== '100') problems.push('计数结束值不是 100：' + pct.textContent)
    if (status && status.textContent !== 'READY') problems.push('结束状态词不是 READY：' + status.textContent)
    if (container.childNodes.indexOf(host) !== -1) problems.push('结束后未清理开屏节点')
    if (windowListeners.length > 0) problems.push('跳过监听未解绑：' + windowListeners.length)
    if (canvasCalls.getImageData === 0) problems.push('点阵从未采样字形（getImageData 未被调用）')
    if (canvasCalls.fillRect === 0) problems.push('点阵从未绘制（fillRect 未被调用）')
    if (canvasCalls.arc > 0) problems.push('仍在用 arc 画点（应为 fillRect）')
  }

  /* 单次播放语义由调用方（注入脚本 / client 半）负责，这里只验证重复 destroy 安全 */
  record(() => splashApi.destroySplash(), 'destroySplash')
  record(() => splashApi.destroySplash(), 'destroySplash 二次')
}

/* ---------------------------------------------- 3) React 接线（shell.overlay） */
if (plugin) {
  const regs = []
  const ctx = {
    slots: {
      inject(name, cb) {
        cb()
      },
      register(options, comp) {
        regs.push({ options, comp })
        return { dispose() {} }
      },
    },
    effect(fn) {
      return fn
    },
  }
  record(() => plugin.apply(ctx), 'apply')
  const reg = regs[0]
  console.log('\n注册槽位 =', reg ? reg.options.name + ' / ' + reg.options.id : '(缺失)')
  if (!reg) problems.push('未注册 shell.overlay')
}

console.log('\n创建的 DOM 节点数 =', created.length)
if (problems.length > 0) {
  console.log('\n=== 问题 ===')
  for (const p of problems) console.log('- ' + p)
  process.exit(1)
}
console.log('\nOK：契约 / 点阵引擎 / 时间轴 / 收尾 / 槽位注册 全部通过')
