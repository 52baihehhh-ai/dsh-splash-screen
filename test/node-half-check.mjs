// 校验 node 半：注入行合法性 + 覆盖样式 + 注入脚本语法与关键逻辑 + 贴图内联状态。
//
// 用法：node test/node-half-check.mjs [index.js 的路径]
import { fileURLToPath, pathToFileURL } from 'node:url'

const NODE_HALF = process.argv[2] ?? fileURLToPath(new URL('../index.js', import.meta.url))
const problems = []

// 宿主白名单（抄自 dsh-host-webserver 的 renderRow）；未知 kind 会让 boot gate reject
const KINDS = new Set(['global', 'script', 'script-src', 'script-preload', 'style', 'html'])
const PLACEMENTS = new Set(['head', 'body'])

const mod = await import(pathToFileURL(NODE_HALF).href)
console.log('name =', mod.name)
console.log('inject =', JSON.stringify(mod.inject))
console.log('apply 类型 =', typeof mod.apply)
if (mod.name !== 'dsh-splash-screen') problems.push('name 与包名不一致')
if (!Array.isArray(mod.inject) || !mod.inject.includes('webServer')) problems.push('inject 未声明 webServer')

const rows = []
let listener = null
const routes = []

mod.apply({
  inject(services, cb) {
    console.log('ctx.inject 服务 =', JSON.stringify(services))
    cb({
      webServer: {
        register(route) {
          routes.push(route.kind + ' ' + route.path)
          return () => {}
        },
      },
      on(event, handler, options) {
        listener = { event, handler, options }
      },
    })
  },
})

console.log('注册路由 =', routes.length ? routes.join(', ') : '(无)')
console.log('事件 =', listener && listener.event, '| 选项 =', JSON.stringify(listener && listener.options))
if (!listener || listener.event !== 'webserver/index-inject') problems.push('未注册 webserver/index-inject')

listener.handler(rows)
console.log('注入行数 =', rows.length)

for (const row of rows) {
  const okKind = KINDS.has(row.kind)
  const okPlace = row.placement === undefined || PLACEMENTS.has(row.placement)
  console.log(
    '  kind=%s placement=%s 长度=%s kind合法=%s',
    row.kind,
    row.placement ?? '(默认)',
    (row.text ?? row.html ?? '').length,
    okKind,
  )
  if (!okKind) problems.push('非法 kind：' + row.kind)
  if (!okPlace) problems.push('非法 placement：' + row.placement)
  if (typeof row.text !== 'string') problems.push(row.kind + ' 行缺 text')
  try {
    JSON.parse(JSON.stringify(row))
  } catch (err) {
    problems.push('行不可 JSON 序列化：' + err.message)
  }
}

const styleRow = rows.find((r) => r.kind === 'style')
const scriptRow = rows.find((r) => r.kind === 'script')
if (!styleRow) problems.push('没有 style 行')
if (!scriptRow) problems.push('没有 script 行')

if (styleRow) {
  console.log('\n覆盖样式 =', styleRow.text)
  for (const must of ['_card_', 'data-dsh-boot', '#f5f8e6']) {
    if (!styleRow.text.includes(must)) problems.push('覆盖样式缺少关键选择器/变量：' + must)
  }
}

if (scriptRow) {
  const js = scriptRow.text
  console.log('注入脚本长度 =', js.length)
  try {
    // eslint-disable-next-line no-new-func
    new Function(js)
    console.log('注入脚本语法 = OK')
  } catch (err) {
    problems.push('注入脚本语法错误：' + err.message)
  }

  const m = /var ART=("(?:[^"\\]|\\.)*");/.exec(js)
  if (!m) {
    problems.push('注入脚本里找不到 var ART 声明')
  } else {
    const raw = JSON.parse(m[1])
    console.log(
      'ART =',
      raw === '' ? '(空串，无图 → 运行期用程序化绿光底)' : raw + '（宿主路由，按需加载）',
    )
    if (raw !== '' && !raw.startsWith('/dsh-splash/')) problems.push('ART 既不是空串也不是 /dsh-splash/ 路由')
    if (raw !== '' && !routes.some((r) => r.includes('/dsh-splash/art'))) {
      problems.push('有图却没注册贴图路由')
    }
  }

  for (const must of ['killShell', 'createSplash', 'destroySplash', '__DSH_SPLASH_ACTIVE__', 'MutationObserver']) {
    if (!js.includes(must)) problems.push('注入脚本缺少关键逻辑：' + must)
  }
}

if (problems.length > 0) {
  console.log('\n=== 问题 ===')
  for (const p of problems) console.log('- ' + p)
  process.exit(1)
}
console.log('\nOK：注入行合法 / 覆盖样式齐备 / 注入脚本语法与关键逻辑齐备')
