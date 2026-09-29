// 接线测试：用「会真跑 effect」的迷你 React，验证 Overlay → createSplash 的完整链路。
// 与 splash-smoke.mjs 的区别：那边直接驱动 createSplash 本体，这边测 React 接线。
//
// 用法：node test/wiring-check.mjs [client.js 的路径]
import { readFileSync } from 'node:fs'

const CLIENT = process.argv[2] ?? new URL('../client.js', import.meta.url)
const source = readFileSync(CLIENT, 'utf8')

const problems = []
const rafQueue = []
const timers = []
let now = 0

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
    // 贴图是 insertBefore(img, artEl.firstChild) 挂上去的
    insertBefore(node, ref) {
      const i = ref ? this.childNodes.indexOf(ref) : -1
      if (i >= 0) this.childNodes.splice(i, 0, node)
      else this.childNodes.push(node)
      node.parentNode = this
      return node
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
    attachShadow() {
      const root = makeEl('shadow-root')
      this.shadowRoot = root
      return root
    },
    // 开屏本体用 canvas 点阵引擎，桩里得给一个能跑的 2D 上下文
    getContext() {
      return makeCtx()
    },
    querySelector(selector) {
      return query(this, selector)
    },
    querySelectorAll() {
      return []
    },
    get firstChild() {
      return this.childNodes[0] ?? null
    },
    get clientWidth() {
      return 1280
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
  return el
}

/* --------------------------------------------------------- 最小 canvas 2D 桩 */
// 只求「不炸且能走出真实分支」：点阵引擎会 fillText 采样字形（getImageData），
// 再按采样结果 fillRect 画点。这里伪造一半单元格「有字」。
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
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    fillText() {},
    measureText(text) {
      return { width: String(text).length * 40 }
    },
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let yy = 0; yy < h; yy += 1) {
        for (let xx = 0; xx < w; xx += 1) {
          data[(yy * w + xx) * 4 + 3] = (xx + yy) % 3 !== 0 ? 255 : 0
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

const rootEl = makeEl('html')
const headEl = makeEl('head')
const bodyEl = makeEl('body')
const appRoot = makeEl('div')
appRoot.setAttribute('id', 'app-root')
rootEl.appendChild(headEl)
rootEl.appendChild(bodyEl)
bodyEl.appendChild(appRoot)

const byId = new Map([['app-root', appRoot]])
const realCreateElement = makeEl
globalThis.document = {
  documentElement: rootEl,
  head: headEl,
  body: bodyEl,
  readyState: 'complete',
  createElement: (tag) => realCreateElement(tag),
  getElementById: (id) => byId.get(id) ?? null,
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
}

globalThis.window = globalThis
globalThis.innerWidth = 1280
globalThis.innerHeight = 800
globalThis.matchMedia = () => ({ matches: false })
globalThis.sessionStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) } }
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) } }
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
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}

/* ------------------------------------------------- 会真跑 effect 的迷你 React */
function createReact() {
  const store = { order: [], hooks: new Map(), effects: new Map() }
  return {
    __store: store,
    useState(initial) {
      const key = store.order[store.index] ?? (store.order[store.index] = 'h' + store.index)
      store.index += 1
      if (!store.hooks.has(key)) store.hooks.set(key, typeof initial === 'function' ? initial() : initial)
      return [
        store.hooks.get(key),
        (v) => {
          store.hooks.set(key, typeof v === 'function' ? v(store.hooks.get(key)) : v)
          rerender()
        },
      ]
    },
    useEffect(fn) {
      const key = store.order[store.index] ?? (store.order[store.index] = 'h' + store.index)
      store.index += 1
      store.effects.set(key, fn)
    },
    createElement(type, props) {
      if (typeof type === 'function') return { __component: type, props: props ?? {} }
      return { type, props: props ?? {} }
    },
    Fragment: 'Fragment',
  }
}

let React = createReact()
const requireShim = (id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}

let captured = null
globalThis.window.__ModuleLoader__ = { load: (reg) => { captured = reg } }

/* ---------------------------------------------- 迷你渲染器（跑 effect，带清理） */
let component = null
let containerEl = null
const renderLog = []

function rerender() {
  if (!component) return
  const store = React.__store
  store.index = 0
  store.effects = new Map()
  renderLog.push('render')
  const vnode = component({})
  if (!vnode) {
    renderLog.push('render:null')
    return
  }
  const ref = vnode.props && vnode.props.ref
  if (typeof ref === 'function' && !containerEl) {
    containerEl = realCreateElement('div')
    bodyEl.appendChild(containerEl)
    ref(containerEl)
    renderLog.push('ref(container)')
  }
}

function flushEffects() {
  if (!component) return false
  const store = React.__store
  store.index = 0
  store.effects = new Map()
  const vnode = component({})
  void vnode
  var ran = false
  for (const fn of store.effects.values()) {
    const cleanup = fn()
    if (typeof cleanup === 'function') renderLog.push('effect+cleanup')
    else renderLog.push('effect')
    ran = true
  }
  return ran
}

/* ------------------------------------------------------------------- 运行 */
new Function('window', 'document', 'require', 'requestAnimationFrame', 'cancelAnimationFrame', source)(
  globalThis.window,
  globalThis.document,
  requireShim,
  globalThis.requestAnimationFrame,
  globalThis.cancelAnimationFrame,
)

const plugin = captured.factory(requireShim)
console.log('plugin.name =', plugin.name)
console.log('开屏本体已求值 =', !!globalThis.__DSH_SPLASH__)

let registered = null
plugin.apply({
  slots: {
    inject(name, cb) {
      cb()
    },
    register(options, comp) {
      registered = { options, comp }
      return { dispose() {} }
    },
  },
  effect(fn) {
    return fn
  },
})
if (!registered) problems.push('未注册到 shell.overlay')
else {
  console.log('注册槽位 =', registered.options.name, '| id =', registered.options.id)
  component = registered.comp
}

/* 第一轮渲染：组件返回容器 div 并给出 ref */
rerender()
console.log('渲染轨迹 =', JSON.stringify(renderLog))
if (!containerEl) problems.push('首帧没有产出容器（ref 未调用）')
else console.log('容器已挂到 body =', bodyEl.childNodes.includes(containerEl))

/* 第二轮：跑 effect，应调用 createSplash({mount: container}) */
const ran = flushEffects()
console.log('effect 执行 =', ran)
const host = containerEl && containerEl.childNodes[0]
console.log('开屏根挂在容器里 =', !!host, host ? '| class=' + host.className : '')
if (!host) problems.push('effect 没有把开屏挂进容器')

/* 推进时间轴到底，确认走完并自清理 */
let guard = 0
while ((rafQueue.length > 0 || timers.some((t) => !t.cancelled)) && guard < 40000) {
  guard += 1
  if (rafQueue.length > 0) {
    const fn = rafQueue.shift()
    try {
      fn(now)
    } catch (err) {
      problems.push('rAF 回调失败：' + err.message)
      break
    }
  }
  timers.sort((a, b) => a.at - b.at)
  const t = timers.find((x) => !x.cancelled)
  if (t) {
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
console.log('时间轴推进步数 =', guard)
if (host) {
  console.log('结束状态类 =', JSON.stringify([...host.classList._set]))
  /* 收尾一：finish() 会把开屏根从挂载点摘掉 */
  const detached = containerEl.childNodes.indexOf(host) === -1
  console.log('开屏根已从挂载点摘除 =', detached)
  if (!detached) problems.push('开屏结束后未清理挂载点')
}

/* 收尾二：onDone 回调 → setFinished(true) → 组件返回 null（真实 React 据此卸载锚点） */
const unmounted = renderLog.includes('render:null')
console.log('onDone 后组件渲染为 null =', unmounted)
if (!unmounted) problems.push('时间轴走完没有触发 onDone')

/* 对外契约：开屏本体只暴露 __DSH_SPLASH__ = { createSplash, destroySplash } */
const splashApi = globalThis.__DSH_SPLASH__
const apiOk =
  !!splashApi &&
  typeof splashApi.createSplash === 'function' &&
  typeof splashApi.destroySplash === 'function'
console.log('__DSH_SPLASH__ 接口 =', apiOk ? 'createSplash + destroySplash' : '缺失')
if (!apiOk) problems.push('未暴露 __DSH_SPLASH__ 接口')

if (problems.length > 0) {
  console.log('\n=== 问题 ===')
  for (const p of problems) console.log('- ' + p)
  process.exit(1)
}
console.log('\nOK：React 接线 / effect 挂载 / 时间轴 / 收尾 / 对外契约 全部通过')
