/**
 * git-panel 构建脚本：把 src/ 打包成 DSH 文件态（web profile）可装载的产物。
 *
 * 产出（lib/）：
 *   - index.js  文件态 host 入口：对象形态插件（loader 直接支持），内部委托 src/host.js
 *   - host.js   src/host.js 原样复制（供 index.js import）
 *   - client.js 浏览器半体 bundle：window.__ModuleLoader__.load({id, factory}) 格式，
 *               由 dsh-client-modules 按 exports["./client"] 原样服务
 *
 * 说明：
 *   - src/host.js 与 src/client.js 保持「函数形态」源码（export default function () {...}），
 *     该形态同时是动态 Cordis 包（见 cordis.yml，cordis_define code.host/code.client）的取法来源；
 *   - 本脚本只做文本级封装，零第三方依赖：client 半体是纯 JS + React.createElement，
 *     React 由 bundle 的 require("react") 从浏览器模块表绑定。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')
const PKG_ID = '@dsh-local/git-panel'

/** 取 client 源码中 `export default function () {` 起的完整函数体（含两端大括号）。
 *  源文件约定为「头部注释 + 单个默认导出函数」：函数体延伸到文件最后一个 `}`。
 *  刻意不做逐字符括号配对——字符串/注释里落单的 `{`/`}` 会把配对扫描引到错误位置。 */
function clientFunctionBody(src) {
  const marker = 'export default function () {'
  const start = src.indexOf(marker)
  if (start < 0) throw new Error('client.js 缺少 "export default function () {"')
  const body = src.slice(start + marker.length - 1)
  const end = body.lastIndexOf('}')
  if (end < 0) throw new Error('client.js 缺少函数结尾 "}"')
  const tail = body.slice(end + 1)
  const tailOk = tail.split('\n').every((l) => l.trim() === '' || l.trim().startsWith('//'))
  if (!tailOk) throw new Error('client.js 函数结束后仍有未预期内容: ' + tail.trim().slice(0, 80))
  return body.slice(0, end + 1)
}

// ---- 清理并重建 lib ----
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })

// ---- 1) host 半体原样复制 ----
copyFileSync(join(ROOT, 'src', 'host.js'), join(LIB, 'host.js'))

// ---- 1b) 防笔误守卫：git NUL 分隔选项拼写 ----
// git 选项名 --pathspec-file-nul 来自 NUL 字符（ASCII 0），结尾没有 "l"。
// 历史上被多次误拼为 null 结尾（git 报 unknown option、批量操作全线失败），
// 故构建期直接拦截，防止错误拼写进入 lib 产物（注意检查顺序：错误拼写包含
// 正确拼写作为前缀，必须先查错误拼写）。
{
  const hostOut = readFileSync(join(LIB, 'host.js'), 'utf8')
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
const inject = ['fs', 'subprocess', 'connection']

function apply(ctx, cfg) {
  // host.js 的函数形态工厂每次返回全新插件对象（内部闭包状态独立）
  return hostFactory().apply(ctx, cfg)
}

export default { name, inject, apply }
`
writeFileSync(join(LIB, 'index.js'), indexJs)

// ---- 3) lib/client.js：浏览器半体（ModuleLoader bundle 格式） ----
const clientSrc = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8')
const body = clientFunctionBody(clientSrc)
const clientBundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PKG_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tvar React = require("react");
\t\tif (React && React.__esModule && React.default) React = React.default;
\t\tvar __gitPanelPlugin = (function () ${body})();
\t\texports.apply = __gitPanelPlugin.apply;
\t\texports.inject = ["slots", "connection"];
\t\treturn module.exports;
\t}
});
`
writeFileSync(join(LIB, 'client.js'), clientBundle)

console.log('[git-panel] build 完成 → lib/index.js, lib/host.js, lib/client.js')
