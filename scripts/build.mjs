/**
 * 构建器：src/splash.js（唯一起源）→ client.js + index.js
 * ===========================================================================
 * 为什么需要构建：开屏动画必须有两份「发行形态」，但只能有一份源码。
 *
 *   1) client.js —— 浏览器 bundle，符合 dsh-client-modules 的懒 CJS 契约：
 *      window.__ModuleLoader__.load({ id, factory })，factory 返回 Cordis 插件对象。
 *      负责把动画挂到 shell.overlay、与插件生命周期同步、提供重播钩子。
 *
 *   2) index.js —— node 半：用官方结构化注入行 webserver/index-inject 把动画
 *      **内联**进 index，让它在应用挂载之前就接管画面。
 *      为什么内联而不是 script-src：桌面端 boot gate 遇到加载失败的 script-src 会
 *      reject 并把应用打进崩溃恢复页；内联脚本没有网络依赖，也不受 CSP 影响。
 *
 * 运行：node scripts/build.mjs   （--check 只比对不写盘）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'splash.js')
const OUT_CLIENT = join(ROOT, 'client.js')
const OUT_NODE = join(ROOT, 'index.js')

const CHECK = process.argv.includes('--check')
const PKG = 'dsh-splash-screen'

/* --------------------------------------------------------- 构建期贴图探测 */
/**
 * 找插件目录里的贴图，只记录**文件名**，运行期走宿主路由按需加载。
 *
 * 为什么不内联成 data URI（第一版那么做过）：一张竖版立绘 base64 之后有十几 MB，
 * 注入脚本会被撑到 13MB 量级，完全不可接受；而且真机验证时 9.68MB 的原图在 B 阶段
 * 解码直接把主线程堵住，开屏会卡。所以贴图既走路由，也优先取压缩过的 webp 版本。
 */
function findArt() {
  const candidates = ['art.webp', 'art.png', 'art.jpg', 'art.jpeg', 'art-original.png', 'illustration.png']
  for (const name of candidates) {
    const file = join(ROOT, name)
    if (existsSync(file)) return { name, size: statSync(file).size }
  }
  return null
}

/* --------------------------------------------------------- 动画本体打包 */
function bundleSplashSource() {
  const raw = readFileSync(SRC, 'utf8')
  if (/(^|\n)\s*(import|export)\s/.test(raw)) {
    throw new Error('src/splash.js 不得出现 import/export（它要被内联进普通脚本）')
  }
  const bin = findEsbuild()
  if (bin === null) {
    console.log('[build] 未找到 esbuild，按无依赖 ES5 脚本原样内联')
    return raw
  }
  const tmp = join(ROOT, '.build-splash.js')
  mkdirSync(dirname(tmp), { recursive: true })
  const res = spawnSync(
    bin,
    [
      'src/splash.js',
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--target=es2019',
      '--charset=utf8',
      '--legal-comments=none',
      '--outfile=' + tmp,
    ],
    { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true },
  )
  if (res.error) throw new Error('esbuild 启动失败：' + res.error.message)
  if (res.status !== 0) throw new Error('esbuild 失败：' + (res.stderr || ''))
  const out = readFileSync(tmp, 'utf8')
  rmSync(tmp, { force: true })
  return out
}

function findEsbuild() {
  const base = join(ROOT, 'node_modules', '.bin', 'esbuild')
  if (existsSync(base + '.cmd')) return base + '.cmd'
  if (existsSync(base)) return base
  return null
}

/* ------------------------------------------------- 注入脚本（node 半用） */
/**
 * 生成注入脚本：铺开屏 + 摘掉宿主自带启动壳 + 兜底收尾。
 * 所有可变部分在生成期以 JSON 内联，运行期零网络依赖。
 */
function buildInjectionScript(splashCode, artSrc) {
  return [
    '(function(){',
    'var SPLASH=' + JSON.stringify(splashCode) + ';',
    // 贴图在构建期就内联成 data URI（可能是空串 = 没有图，运行期退回程序化底）
    'var ART=' + JSON.stringify(artSrc) + ';',
    'var KEY=' + JSON.stringify(PKG + ':shown') + ';',
    'var MUTE=' + JSON.stringify(PKG + ':muted') + ';',
    'if(globalThis.__DSH_SPLASH_ACTIVE__)return;',
    // 宿主自带启动壳（HARNESS + 圆形转圈 + Loading plugins…）由 SPA 入口直接建在
    // #root 里，插件改不了它的源码；但注入行解释器在我们的脚本之前已经跑完 style 行，
    // 浏览器还没机会绘制，所以这里把它收掉，那圈永远不会上屏。
    'function killShell(){',
    'try{',
    'var cards=document.querySelectorAll("[data-dsh-boot] [class*=\\"_card_\\"]");',
    'for(var i=0;i<cards.length;i+=1){cards[i].style.display="none"}',
    'var boot=document.querySelectorAll("[data-dsh-boot]");',
    'for(var j=0;j<boot.length;j+=1){boot[j].style.background="transparent"}',
    '}catch(e){}',
    '}',
    'killShell();',
    'try{',
    'var seen=false;',
    'try{seen=!!(window.sessionStorage&&window.sessionStorage.getItem(KEY)==="1")}catch(e){}',
    'if(seen){',
    // 已播过：仍然要收掉旧壳，否则会留着宿主那个圈
    'globalThis.__DSH_SPLASH_ACTIVE__="skipped";',
    'if(document.body)killShell();else document.addEventListener("DOMContentLoaded",killShell,{once:true});',
    'return;',
    '}',
    'try{if(window.sessionStorage)window.sessionStorage.setItem(KEY,"1")}catch(e){}',
    'var reduce=false;',
    'try{reduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){}',
    'globalThis.__DSH_SPLASH_ACTIVE__="pending";',
    'var started=false;',
    'function start(){',
    'if(started)return;started=true;',
    'var api=globalThis.__DSH_SPLASH__;',
    'if(api&&typeof api.createSplash==="function"){',
    'var h=api.createSplash({mount:document.body,owner:"boot",artSrc:ART,muteKey:MUTE,onDone:function(){globalThis.__DSH_SPLASH_ACTIVE__="done"}});',
    'globalThis.__DSH_SPLASH_ACTIVE__=h||"done";',
    '}else{globalThis.__DSH_SPLASH_ACTIVE__="failed"}',
    '}',
    'new Function(SPLASH)();',
    'if(document.body)start();else document.addEventListener("DOMContentLoaded",start,{once:true});',
    // 兜底：脚本若异常，按「#root 里出现真实应用内容」或 6s 硬超时收尾，绝不留遮罩。
    'var timer=null,obs=null;',
    'function bail(reason){',
    'if(globalThis.__DSH_SPLASH_ACTIVE__==="pending"){',
    'globalThis.__DSH_SPLASH_ACTIVE__=reason;',
    'var api=globalThis.__DSH_SPLASH__;',
    'if(api&&typeof api.destroySplash==="function")api.destroySplash();',
    '}',
    'if(obs)try{obs.disconnect()}catch(e){}',
    'if(timer)clearTimeout(timer);',
    '}',
    'try{',
    'var root=document.getElementById("root");',
    'if(root&&window.MutationObserver){',
    'obs=new MutationObserver(function(){',
    'for(var i=0;i<root.children.length;i+=1){var c=root.children[i];',
    'if(c.nodeType===1&&!c.hasAttribute("data-dsh-boot")){bail("mounted");return}}',
    '});',
    'obs.observe(root,{childList:true,subtree:false});',
    '}',
    '}catch(e){}',
    'timer=setTimeout(function(){bail("timeout")},6000);',
    '}catch(err){',
    'if(window.console)console.error("[dsh-splash-screen] 注入脚本失败：",err);',
    '}',
    '})();',
  ].join('\n')
}

/* --------------------------------------------------------- 生成 node 半 */
function buildNodeHalf(splashCode, injectionScript, artNames) {
  return `/**
 * dsh-splash-screen —— node 半（Host half）
 * ===========================================================================
 * ⚠ 本文件由 scripts/build.mjs 从 src/splash.js 生成，请勿手改。
 *
 * 职责两条：
 *
 * 1) 让宿主发现 client 半。@deepseek-ai/dsh-client-modules 只为「存在活的、已启用
 *    的 Loader 行、且该行模块能解析到本包」的包下发浏览器 bundle；没有这一半就
 *    没有 Loader 行，client.js 既不会被发现，也不会由 /plugins 下发。停用本插件
 *    = 撤掉 Loader 行 = 两半一起消失。
 *
 * 2) 用官方结构化注入行（webserver/index-inject）把开屏**内联**进 index，让动画在
 *    应用挂载之前接管画面，并顺手收掉宿主自带的启动壳（HARNESS + 圆形转圈 +
 *    Loading plugins…，由 SPA 入口直接建在 #root 里，插件无法改其源码，但可以在
 *    它绘制之前把它从视觉上收掉）。
 *
 * 为什么内联而不是 script-src：桌面端 boot gate 遇到加载失败的 script-src 会 reject
 * 并把应用打进崩溃恢复页；内联脚本没有网络依赖。注入行必须是纯 JSON 且 kind 在
 * 白名单内，未知 kind 同样会让 boot gate reject。
 *
 * 贴图（插件目录里的 art.png 等）由本半注册一条宿主路由按需提供：桌面端
 * dsh-app://app 会把未知路径转发给宿主，浏览器端同源直取，脚本里只留一个短 URL。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 与 package.json 的 name 一致。 */
export const name = ${JSON.stringify(PKG)}

/** 需要 webServer 来注册注入行与贴图路由。 */
export const inject = ['webServer']

/** 开屏本体（由 src/splash.js 生成，内联进注入行）。 */
const SPLASH_SOURCE = ${JSON.stringify(splashCode)}

/** 注入脚本（由 src/splash.js 在生成期定稿）。 */
const INJECTION_SCRIPT = ${JSON.stringify(injectionScript)}

/**
 * 宿主自带启动壳的覆盖样式。
 *
 * 壳的 DOM 是 <div data-dsh-boot class="_boot_…"><div class="_card_…">…</div></div>，
 * 失败态则是同一层里的 <div class="_failed_…">。这里只把转圈卡片收掉、把舞台底
 * 刷成开屏底色（避免首帧闪深色），**失败态保持原样可见**——开屏脚本万一挂了，
 * 必须还能看到宿主自己的报错屏。
 */
const BOOT_OVERRIDE_CSS = [
  'html,body{background-color:#f5f8e6 !important;}',
  'body{--dsh-boot-bg:#f5f8e6;}',
  '[data-dsh-boot]{background:transparent !important;}',
  '[data-dsh-boot] [class*="_card_"]{display:none !important;}',
].join('')

/** 贴图候选文件名（构建期探测到的那一个优先）。 */
const ART_NAMES = ${JSON.stringify(artNames)}

/** 贴图路由。 */
const ART_ROUTE = '/dsh-splash/art'

/** 找贴图：命中候选名即返回绝对路径。 */
function findArt() {
  try {
    // link: 安装时本模块从源码目录加载，因此这里解析到的就是真实插件目录。
    const here = fileURLToPath(new URL('.', import.meta.url))
    for (const entry of ART_NAMES) {
      const candidate = join(here, entry)
      if (existsSync(candidate)) return candidate
    }
  } catch (error) {
    /* 解析失败按「没有图」处理 */
  }
  return null
}

function mimeOf(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

/**
 * Host 半：注册贴图路由 + 注入开屏。除注入与这一条只读路由外无副作用。
 * @param {any} ctx Cordis 上下文
 * @returns {void}
 */
export function apply(ctx) {
  const artPath = findArt()

  ctx.inject(['webServer'], (webCtx) => {
    if (artPath !== null) {
      webCtx.webServer.register({
        kind: 'prefix',
        path: ART_ROUTE,
        handler: (_req, res) => {
          try {
            const bytes = readFileSync(artPath)
            res.writeHead(200, {
              'Content-Type': mimeOf(artPath),
              'Cache-Control': 'no-store',
              'Content-Length': String(bytes.length),
            })
            res.end(bytes)
          } catch (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('art unavailable: ' + String((error && error.message) || error))
          }
        },
      })
    }

    webCtx.on(
      'webserver/index-inject',
      (table) => {
        if (!Array.isArray(table)) return
        table.push({ kind: 'style', text: BOOT_OVERRIDE_CSS })
        table.push({ kind: 'script', placement: 'head', text: INJECTION_SCRIPT })
      },
      { prepend: true },
    )
  })
}
`
}

/* ------------------------------------------------------- 生成 client 半 */
function buildClientHalf(splashCode, artSrc) {
  return `/**
 * dsh-splash-screen —— client 半（browser half）
 * ===========================================================================
 * ⚠ 本文件由 scripts/build.mjs 从 src/splash.js 生成，请勿手改。
 *
 * 契约（dsh-client-modules 懒 CJS）：文件体只做一次
 * window.__ModuleLoader__.load({ id, factory }) 注册；副作用都在 factory 内，
 * 首次物化才执行；factory(require) 返回普通 Cordis 插件对象。
 *
 * 它做什么：
 *   · 把动画挂进 shell.overlay，与插件生命周期绑定；
 *   · 注入脚本已经起过开屏时（桌面端主窗口就是这条路径）不重复创建；
 *   · 被停用 / HMR 换版时立刻收尾，绝不留遮罩盖住界面。
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG)},
  factory: function (require) {
    'use strict'

    var React = require('react')
    var PKG = ${JSON.stringify(PKG)}
    var MUTE = PKG + ':muted'

    /** 右侧贴图（构建期内联为 data URI；空串表示没有图）。 */
    var ART_SRC = ${JSON.stringify(artSrc)}

    /** 开屏本体（由 src/splash.js 生成）。 */
    var SPLASH_SOURCE = ${JSON.stringify(splashCode)}

    if (!globalThis.__DSH_SPLASH__) {
      try {
        new Function(SPLASH_SOURCE)()
      } catch (error) {
        console.warn('[dsh-splash-screen] 开屏本体求值失败：', error)
      }
    }

    function api() {
      return globalThis.__DSH_SPLASH__ || null
    }

    /** 注入脚本是否已经在放（或已经放完）开屏？ */
    function injectedActive() {
      var flag = globalThis.__DSH_SPLASH_ACTIVE__
      return flag === 'pending' || (flag !== null && typeof flag === 'object')
    }

    var inject = ['slots']

    function apply(ctx) {
      function Overlay() {
        var [container, setContainer] = React.useState(null)
        var [finished, setFinished] = React.useState(false)

        React.useEffect(
          function () {
            if (container === null) return undefined
            // 注入脚本已经起了开屏：不重复创建，只等它收尾。
            if (injectedActive()) return undefined

            var live = api()
            var created = null
            if (live && typeof live.createSplash === 'function') {
              created = live.createSplash({
                mount: container,
                owner: 'client',
                artSrc: ART_SRC,
                muteKey: MUTE,
                onDone: function () {
                  setFinished(true)
                },
              })
            }
            if (created) {
              return function () {
                var now = api()
                if (now && typeof now.destroySplash === 'function') now.destroySplash()
              }
            }
            setFinished(true)
            return undefined
          },
          [container],
        )

        if (finished) return null
        return React.createElement('div', {
          ref: setContainer,
          'data-dsh-splash-anchor': '',
        })
      }

      function registerSlot() {
        try {
          return ctx.slots.register({ name: 'shell.overlay', id: PKG, order: 30 }, Overlay)
        } catch (error) {
          console.warn('[dsh-splash-screen] shell.overlay 注册失败：', error)
          return undefined
        }
      }

      ctx.slots.inject('shell.overlay', registerSlot)

      // 停用 / 换版：连注入脚本起的开屏一起收掉，否则遮罩会留着。
      ctx.effect(
        function () {
          return function () {
            var live = api()
            if (live && typeof live.destroySplash === 'function') live.destroySplash()
          }
        },
        'dsh-splash-screen: teardown',
      )
    }

    return { name: PKG, inject: inject, apply: apply }
  },
})
`
}

/* ------------------------------------------------------------------- main */
const splashCode = bundleSplashSource()
const art = findArt()
const ART_ROUTE = '/dsh-splash/art'
// 有图才给地址：图由宿主路由按需提供（内联 base64 会把脚本撑到十几 MB，不可取）。
const artSrc = art === null ? '' : ART_ROUTE
const artNames = art === null ? ['art.webp', 'art.png', 'art.jpg', 'art.jpeg', 'art-original.png'] : [art.name]

/**
 * 产物纪律检查。
 *
 * 不能用「先剥字符串再找浏览器全局」的暴力正则：内联的动画本体与贴图 base64 都是
 * 几十 KB 的单行字符串，那种正则会把栈直接拖爆。改为结构化检查——只看模块真正会
 * 执行的代码里有没有出现这些全局，浏览器全局一律只允许出现在「注入脚本」这一个
 * 字符串常量里；而注入脚本本身是发给浏览器跑的，那里本来就应该有 window/document。
 */
function assertNodeHalfClean(source) {
  const declared = /^const (SPLASH_SOURCE|INJECTION_SCRIPT) = /m
  for (const line of source.split('\n')) {
    if (declared.test(line)) continue
    for (const token of ['window.', 'document.', 'localStorage', 'navigator.']) {
      if (line.includes(token)) {
        throw new Error('index.js 模块代码里出现了浏览器全局 "' + token + '"：' + line.trim().slice(0, 120))
      }
    }
  }
}

function assertClientHalfClean(source) {
  for (const token of ['process.env', 'node:fs', 'node:path', "require('node:"]) {
    if (source.includes(token)) throw new Error('client.js 含 Node 全局：' + token)
  }
}

const injectionScript = buildInjectionScript(splashCode, artSrc)
const nodeSource = buildNodeHalf(splashCode, injectionScript, artNames)
const clientSource = buildClientHalf(splashCode, artSrc)

assertNodeHalfClean(nodeSource)
assertClientHalfClean(clientSource)

function writeOut(file, content) {
  if (CHECK) {
    let prev = null
    try {
      prev = readFileSync(file, 'utf8')
    } catch (error) {
      prev = null
    }
    if (prev !== content) {
      console.error('[build] ' + file + ' 与生成器输出不一致（运行 node scripts/build.mjs）')
      process.exitCode = 1
    } else {
      console.log('[build] ' + file + ' 新鲜（--check OK）')
    }
    return
  }
  writeFileSync(file, content)
  console.log('[build] 生成 ' + file + '（' + content.length + ' 字符）')
}

console.log(
  '[build] 动画本体 ' +
    splashCode.length +
    ' 字符；贴图 ' +
    (art === null ? '未找到（运行期走程序化绿光底）' : art.name + '（' + Math.round(art.size / 1024) + ' KB，走 ' + ART_ROUTE + ' 按需加载）'),
)
writeOut(OUT_NODE, nodeSource)
writeOut(OUT_CLIENT, clientSource)
