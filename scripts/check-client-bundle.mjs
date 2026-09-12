/**
 * 产物冒烟验证：在 node:vm 里装载 lib/client.js（ModuleLoader bundle），用打桩的
 * 宿主模块表（react）与 cordis ctx 跑一遍工厂 + apply + 卸载，验证打包后的
 * 模块图、exports 契约（apply / inject）与 slot 注册真的能跑——这类问题浏览器里
 * 只能等真机才发现。跑完即退出（非 0 = 失败）；npm test 一部分。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

// 1) 装载 bundle：捕获 ModuleLoader.load 的注册对象
let def = null
const sandbox = {
  window: { __ModuleLoader__: { load(d) { def = d } } },
  console
}
vm.createContext(sandbox)
try {
  vm.runInContext(code, sandbox, { filename: 'lib/client.js' })
} catch (e) {
  fail('bundle 装载即抛错: ' + e.stack)
}
if (!def || typeof def.factory !== 'function') fail('ModuleLoader.load 未收到 {id, factory}')

// 2) 跑工厂：require 只应向宿主模块表要 react；组件不渲染就不该碰 createElement
let reactRequired = 0
const reactStub = {
  createElement: (type) => { throw new Error('apply 阶段不应渲染，却对 ' + String(type) + ' 调了 createElement') },
  Fragment: 'Fragment'
}
let plugin
try {
  plugin = def.factory((name) => {
    if (name !== 'react') throw new Error('意外的模块请求: ' + name)
    reactRequired++
    return reactStub
  })
} catch (e) {
  fail('factory 执行抛错: ' + e.stack)
}
if (typeof plugin.apply !== 'function') fail('exports.apply 不是函数')

// 2a) 判别位先查：__esModule 是 loader 的唯一开关，且它是**不可枚举**属性，
// Object.keys() 看不见它——所以必须单独读一次，否则"自有键集合"那条会先命中、
// 把真正的判别位挡在报错信息之外（自检时踩到过）。
if (plugin.__esModule === true) {
  fail('exports.__esModule 为 true —— client loader 的 unwrapExports 会把 exports 当 ESM 命名空间解包，' +
    '最终交给 cordis 的是 default（工厂函数）而非插件对象，apply() 永不执行（按钮消失且无报错）。' +
    '修 scripts/build.mjs 的 factory 出口：返回裸的 { apply, inject }。')
}
if (JSON.stringify(plugin.inject) !== JSON.stringify(['slots', 'connection', 'workspaces'])) {
  fail('exports.inject 不符: ' + JSON.stringify(plugin.inject))
}

// 2b) 反向守卫：exports 必须是「裸插件对象」，不能带 ESM 互操作外壳。
//
// 背景（2026-09-12 线上事故，1.3.0 切 esbuild 后按钮消失）：DSH Client 的 cordis 浏览器
// loader 用 unwrapExports 判定「拿谁当插件定义」，**真正的判别位是 __esModule**：
//     unwrapExports(t) {
//       if (t == null) return t
//       t = t.default ?? t
//       if (!t.__esModule) return t
//       return t.default ?? t
//     }
// esbuild cjs 出口的 __toCommonJS 恰好会造出 `{ __esModule: true, default: 工厂函数, ... }`：
// 于是 unwrapExports 返回的是**工厂函数**而不是插件对象。cordis 拿到函数照样把 fiber 走到
// active（所以启动自检、入口状态全都"正常"），但它调用的是那个函数、返回值被丢弃 ——
// 插件对象的 apply() 永不执行：侧栏底部按钮凭空消失、面板打不开，浏览器控制台一条报错都没有。
// 这就是为什么本段断言是**构建期**唯一能拦住它的地方。
//
// 断言分层（按重要性）：
//   1. __esModule —— 判别位本身，命中即必然静默失活（上面 2a 段已查，这里不重复）；
//   2. 自有 default —— 即使判别位将来变了，default 是工厂函数也会被优先取走；
//   3. 自有键集合恰为 apply,inject —— 把出口面钉死，任何多出来的键都要求人重新核对一遍
//      loader 的取值规则（宁可构建失败，也不要再赌一次静默失活）。
// 注：Symbol.toStringTag / "[object Module]" 只是**伴随特征**，不是判别位——官方产物
// （如 dsh-client-ui-sidebar-files）本身就带 Symbol.toStringTag 且工作正常，所以这一条
// 不是"因为会被误判"而是"出口面收窄"的同义约束。
if (Object.prototype.hasOwnProperty.call(plugin, 'default')) {
  fail('exports.default 存在 —— 同上：cordis loader 的 unwrapExports 会优先取 default。' +
    '产物里不要暴露 default，只暴露 apply / inject。')
}
const ownKeys = Object.keys(plugin).sort()
if (ownKeys.join(',') !== 'apply,inject') {
  fail('exports 自有键应为 apply,inject，实际: ' + ownKeys.join(',') +
    '（多出来的键会把 loader 引向错误的插件定义，见上面 __esModule/default 两条）')
}
if (Object.prototype.toString.call(plugin) === '[object Module]' ||
    (typeof Symbol !== 'undefined' && Symbol.toStringTag in plugin)) {
  fail('exports 带 Symbol.toStringTag（"[object Module]"）—— 出口面应保持与旧产物同形的裸对象。')
}

// 3) 跑 apply：打桩 cordis ctx（slots/locale/timer/connection/workspaces）
const registered = []
const slots = {
  inject: (name, setup) => { setup(); registered.push(name) },
  register: (meta) => { registered.push('register:' + meta.id); return meta }
}
const rpcMethods = []
const ctx = {
  get(key) {
    return {
      slots,
      timer: { timeout: (fn) => { return () => {} } },
      locale: { getLocale: () => ({ active: 'zh' }) },
      connection: { rpc: { call: (channel, method) => { rpcMethods.push(method); return Promise.resolve({ ok: true, value: {} }) } } },
      workspaces: {}
    }[key]
  },
  on() { return () => {} }
}
let dispose
try {
  dispose = plugin.apply(ctx)
} catch (e) {
  fail('apply 抛错: ' + e.stack)
}
if (typeof dispose !== 'function') fail('apply 未返回卸载清理函数')
for (const expected of ['shell.overlay', 'shell.overlay', 'sidebar.footer.action']) {
  if (!registered.includes(expected)) fail('slot 未注册: ' + expected)
}
if (!registered.includes('register:git-panel') || !registered.includes('register:git-panel-toasts') || !registered.includes('register:git-panel-toggle')) {
  fail('slot register 未发生: ' + registered.join(', '))
}
if (!rpcMethods.includes('setLocale')) fail('apply 未上报 setLocale')
try {
  dispose()
} catch (e) {
  fail('卸载清理抛错: ' + e.stack)
}

console.log('✓ 冒烟通过：bundle 装载 → factory(require react=' + reactRequired + ') → apply（3 个 slot 注册 + setLocale）→ 卸载，全链路无异常')
