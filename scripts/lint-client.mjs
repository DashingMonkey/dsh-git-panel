/**
 * Client 源码守卫：ESLint no-undef（同文件级语法检查 + 标准工具，取代自研
 * check-client-refs.mjs——那套自研守卫先后写错三版、两次给出假安全，
 * 教训见 docs/architecture.md「Client 模块化」一节）。
 *
 * 拆模块后跨模块引用由 import/export + esbuild 打包保证（漏导出/拼错名在打包期报
 * "No matching export"）；本脚本兜住的是**模块文件内部**的未定义标识符（拼错局部名、
 * 漏 import）——正是四次线上 ReferenceError 的那一类错误，语法完全合法、
 * node --check 查不出，只有渲染到那一行才抛。
 *
 * 用 ESLint 的 Linter 类在内存里逐文件检查（无子进程、无需配置文件）：
 *   - no-undef：引用了未声明（含未 import）的标识符即报错；
 *   - 解析错误（fatal）同样报错——顺带覆盖了逐文件 node --check 的职责。
 * 浏览器全局按需列白名单：本项目刻意不假设 window/document 存在（按需探测），
 * `typeof host !== 'undefined'` 这类探测写法不会被 no-undef 误报（typeof 豁免）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { Linter } from 'eslint'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_DIR = join(ROOT, 'src', 'client')

// 面板代码直接引用过的浏览器全局（其余一律经 window.* 或探测访问）
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  CSS: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  // 动态 Cordis 形态由运行器注入的全局（文件态不存在，代码用 typeof 探测后才敢直接引用）
  host: 'readonly',
  styles: 'readonly'
}

function listJsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listJsFiles(p))
    else out.push(p)
  }
  return out.filter((p) => p.endsWith('.js'))
}

const linter = new Linter()
const files = listJsFiles(CLIENT_DIR)
let failed = false

for (const file of files) {
  const rel = relative(ROOT, file)
  const messages = linter.verify(readFileSync(file, 'utf8'), {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: BROWSER_GLOBALS
    },
    rules: { 'no-undef': 'error' }
  }, file)
  if (messages.length === 0) continue
  failed = true
  console.error('✗ ' + rel)
  for (const m of messages) {
    console.error(`    L${m.line}:${m.column} ${m.fatal ? '解析错误' : 'no-undef'}: ${m.message}`)
  }
}

if (failed) {
  console.error('\n客户端源码存在未定义标识符/解析错误（见上）。缺的是漏 import 还是拼错的局部名，' +
    '按名字到对应模块里核对——这正是曾把面板整个 slot 崩掉的那类错误。')
  process.exit(1)
}
console.log('✓ no-undef 检查通过（' + files.length + ' 个文件）')
