/**
 * git-panel 构建脚本：把 src/ 打包成 DSH 文件态（web profile）可装载的产物。
 *
 * 产出（lib/）：
 *   - index.js  文件态 host 入口：对象形态插件（loader 直接支持），内部委托 src/host.js
 *   - host.js   src/host.js 原样复制（供 index.js import）
 *   - client.js 浏览器半体 bundle：window.__ModuleLoader__.load({id, factory}) 格式，
 *               由 dsh-client-modules 按 exports["./client"] 原样服务
 *
 * Client 半体的两条装载路径（文件态 install.mjs / 动态 Cordis 包 cordis.yml）都经
 * package.json 的 exports["./client"] 取 lib/client.js，因此源码可以是 src/client/ 多模块：
 *   - esbuild 打包（format cjs、react external），产物置于 factory 闭包内——
 *     require("react") 由宿主模块表在运行期解析，与官方 dsh-client-ui-* 产物同形态
 *     （官方样本：lib/client.js 内 require("react") 同样出现在 factory 体内）；
 *   - 构建期依赖（devDependencies）：esbuild（打包）、eslint（no-undef 守卫，见
 *     scripts/lint-client.mjs）、acorn + react（行为回归测试用，运行时依旧零依赖）。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')
const STAGE = join(ROOT, '.build-stage')
const PKG_ID = '@dsh-local/git-panel'

// ---- 0) 构建前守卫：客户端未定义标识符（ESLint no-undef） ----
// 模块文件内部引用了未声明（含漏 import）的标识符就拦截——本项目曾因此崩过四次
//（pushDetailOpen / pushFailText / applyPushFail / isPushNoUpstream is not defined，
// 全是语法合法、渲染到那一行才抛的 ReferenceError）。跨模块引用由 import/export +
// 下面的 esbuild 打包保证（漏导出在打包期报 "No matching export"），本守卫兜住
// 模块内部的同类错误。曾用自研 AST 守卫顶过一阵（先后写错三版、两次给出假安全），
// 换成标准工具后自研守卫已删除。
{
  console.log('▶ 检查客户端未定义标识符（no-undef）...')
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'lint-client.mjs')], { cwd: ROOT, stdio: 'inherit' })
  } catch (e) {
    throw new Error('客户端 no-undef 检查未通过——详见上面的输出（缺的是漏 import 还是拼错的局部名，按报错到对应模块核对）。')
  }
}

// ---- 暂存目录：全部产物先写到这里，全部成功后才整体换上 ----
// 教训（2026-09-12 审查）：原先第一步就 rmSync(lib)，而 esbuild 在最后才跑；一旦
// esbuild/守卫报错（例如模块漏导出），lib/ 就只剩 host.js + index.js，**client.js 消失**。
// 那时 profile 里那份若是从这种状态同步过去的，插件会以「declares dsh.client but exports
// no ./client bundle」装载失败；`npm test` 也会 ENOENT。构建必须是原子的：要么整体更新，
// 要么原样保留上一次的好产物。
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })
// 任何一步抛错都清掉暂存目录，绝不碰现有 lib/
process.on('exit', () => { try { rmSync(STAGE, { recursive: true, force: true }) } catch (e) { /* 退出阶段尽力而为 */ } })

// ---- 1) host 半体原样复制 ----
copyFileSync(join(ROOT, 'src', 'host.js'), join(STAGE, 'host.js'))

// ---- 1b) 防笔误守卫：git NUL 分隔选项拼写 ----
// git 选项名 --pathspec-file-nul 来自 NUL 字符（ASCII 0），结尾没有 "l"。
// 历史上被多次误拼为 null 结尾（git 报 unknown option、批量操作全线失败），
// 故构建期直接拦截，防止错误拼写进入 lib 产物（注意检查顺序：错误拼写包含
// 正确拼写作为前缀，必须先查错误拼写）。
{
  const hostOut = readFileSync(join(STAGE, 'host.js'), 'utf8')
  if (hostOut.includes('--pathspec-file-null')) {
    throw new Error('检出错误拼写 "--pathspec-file-null"：git 选项是 --pathspec-file-nul（NUL 字符，结尾无 "l"）——src/host.js 里该字符串只允许出现在 OPT_PATHSPEC_FILE_NUL 常量定义处')
  }
  if (!hostOut.includes('--pathspec-file-nul')) {
    throw new Error('未找到 "--pathspec-file-nul"：NUL 分隔选项丢失会导致批量 pathspec 解析错乱（src/host.js 的 OPT_PATHSPEC_FILE_NUL 常量被删/改名？）')
  }
}

// ---- 2) lib/index.js：文件态 host 入口（对象形态插件） ----
const indexJs = `// 由 scripts/build.mjs 生成，请勿手改；源文件：src/host.js
import hostFactory from './host.js'

const name = 'git-panel'
// inject 是 fiber 级硬依赖：缺一项则本插件永不激活。
//   fs / subprocess —— git 执行层与文件读写。
//   connection      —— 复用其 requestRejection（浏览器信任围栏 + 会话 cookie 校验）。
//   webServer       —— 必需：Host 半体直接占用 webServer 的 /git-panel 前缀路由
//                      （见 src/host.js 的 registerHttpChannel）。
//                      曾用 connection.rpc.handle 注册，但该实现内部要求
//                      「调用方 fiber 的 store 能解析 webServer」，而它拿到的 ctx 是
//                      cordis 的 shadow 上下文（fiber 指向 connection 自己的 fiber），
//                      属性读取必抛 cannot get property "webServer" without inject，
//                      装载期整棵插件树 failed to load → dsh 启动失败。
const inject = ['fs', 'subprocess', 'connection', 'webServer']

function apply(ctx, cfg) {
  // host.js 的函数形态工厂每次返回全新插件对象（内部闭包状态独立）
  return hostFactory().apply(ctx, cfg)
}

export default { name, inject, apply }
`
writeFileSync(join(STAGE, 'index.js'), indexJs)

// ---- 3) lib/client.js：esbuild 打包 src/client/ → ModuleLoader bundle ----
// 用字符串拼接而非模板字面量组装外层：bundle 文本里本来就全是反引号/`${}`（CSS、文案）。
const bundle = await esbuild({
  entryPoints: [join(ROOT, 'src', 'client', 'index.js')],
  bundle: true,
  // cjs：所有 import（react 为 external）落成 factory 闭包内的 require("react")，
  // 由宿主模块表解析——不能内联，浏览器页面里也没有真正的模块系统
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  external: ['react'],
  legalComments: 'none',
  logLevel: 'warning',
  write: false
})
const code = bundle.outputFiles[0].text.replace(/\s+$/, '\n')

// ---- 3b) 产物尾部收口：剥掉 esbuild 的 ESM 互操作外包装 ----
// !!! 这里是本插件最脆的一处，改动前先读 scripts/check-client-bundle.mjs 的对应断言 !!!
//
// esbuild 的 cjs 出口（__toCommonJS）会把 module.exports 做成一个「ESM 命名空间」：
//   { __esModule: true, default: <getter>, apply: ..., inject: ... }
// 而 DSH Client 侧的 cordis loader 用 unwrapExports(exports) 决定拿谁当插件定义，
// **判别位是 __esModule**：
//     unwrapExports(t) { if (t == null) return t; t = t.default ?? t; if (!t.__esModule) return t; return t.default ?? t }
// 于是 namespace 形态会一路走到 `t.default ?? t`：default 是 **工厂函数**，不是插件对象，
// 最终交给 cordis 的插件定义成了函数——fiber 照常进入 active（启动自检、入口状态全"正常"），
// 但插件对象的 apply() 永远不会被调用：插件静默失活（按钮消失、面板不出现，浏览器控制台
// 一条报错都没有）。这正是 1.3.0「构建切换 esbuild」后侧栏底部按钮消失的原因
//（旧打包产物是 `exports.apply = ...` 的普通对象，没有 __esModule，unwrapExports 原样返回）。
//
// 收口：在 factory 里显式调用 default() 取回插件工厂对象，把 apply/inject 挂到**新对象**上
// 并从 factory 返回它 —— 该对象没有 __esModule / default / Symbol.toStringTag，
// 与旧产物同形，unwrapExports 原样返回，cordis 拿到真正的插件对象。
const clientBundle =
  '// 由 scripts/build.mjs 生成，请勿手改；源码：src/client/（多模块，esbuild 打包，react external）\n' +
  'window.__ModuleLoader__.load({\n' +
  '\tid: ' + JSON.stringify(PKG_ID) + ',\n' +
  '\t// DSH Client 的 ModuleLoader 协议：factory(require) 返回插件半体 exports。\n' +
  '\t// 返回值必须是「插件对象本身」（带 apply / inject），不能是带 __esModule 的命名空间。\n' +
  '\t// module/exports 这两个 CommonJS 壳必须保留：esbuild 产物内部会写 module.exports。\n' +
  '\tfactory: (require) => {\n' +
  '\t\tvar module = { exports: {} };\n' +
  '\t\tvar exports = module.exports;\n' +
  code + '\n' +
  '\t\t// 见构建脚本 3b 段注释：只从这里取插件对象，别再把 namespace 交出去。\n' +
  '\t\tvar __gitPanelPlugin = index_default();\n' +
  '\t\t// inject 声明是 cordis 的等待清单：fiber 会等服务激活后才执行 apply。\n' +
  '\t\t// workspaces 必须在此声明 —— package.json 里 dsh.client.inject 的包级边只是\n' +
  '\t\t// 装载元数据（不排序 apply），apply 时序竞态会让 ctx.get(\'workspaces\') 抓到 undefined。\n' +
  '\t\treturn { apply: __gitPanelPlugin.apply, inject: ["slots", "connection", "workspaces"] };\n' +
  '\t}\n' +
  '});\n'
// ---- 3c) 产物指纹写进首行注释：产物里带一个可对账的构建标识 ----
// 用途是**对账**，不是「保证字节变化」：把源码内容哈希印在产物首行，便于回答
// 「profile 里那份到底是哪次构建的」（配合 install.mjs / HMR 排查老代码问题）。
// 注意哈希算的是**未盖章**的 clientBundle，所以源码不变时重复构建产出的字节完全相同
//（rev 也相同）——这是刻意的：可复现构建比每次抖动更有用。
// 另外记一条踩过的坑：本项目 install 是复制式，profile 里那份 client.js 是实体副本；
// 源仓库重建**不会**自动更新它，必须重跑 install.mjs（或重启 dsh web）。HMR 只 watch
// 本仓库的 lib/，看不到 profile 那份。
const digest = createHash('sha256').update(clientBundle).digest('hex').slice(0, 12)
const stamped = clientBundle.replace(
  '// 由 scripts/build.mjs 生成，请勿手改；源码：src/client/（多模块，esbuild 打包，react external）\n',
  '// 由 scripts/build.mjs 生成，请勿手改；源码：src/client/（多模块，esbuild 打包，react external）\n' +
  '// build rev: ' + digest + '\n'
)
writeFileSync(join(STAGE, 'client.js'), stamped)

// ---- 4) 整体换上：到这里所有产物都已生成成功，才开始动 lib/ ----
// lib/ 是 gitignore 的构建产物目录，替换窗口只有这两次同步调用，不需要更复杂的方案。
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
for (const name of ['host.js', 'index.js', 'client.js']) {
  copyFileSync(join(STAGE, name), join(LIB, name))
}
rmSync(STAGE, { recursive: true, force: true })

console.log('[git-panel] build 完成 → lib/index.js, lib/host.js, lib/client.js (' +
  Math.round(stamped.length / 1024) + ' KB, rev ' + digest + ')')
