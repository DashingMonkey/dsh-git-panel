/**
 * 端到端验证：host.js 里**真实的** gitRun 在遇到真实 index.lock 竞争时能否自愈。
 *
 * 与 test-git-lock-retry.mjs 的分工：那边测判据/排程与真机样本，这边把 host.js 的
 * gitRun 用 acorn 原样抽出来（本仓库既有的做法，见 test-write-result.mjs），配一个
 * 忠实实现 subprocess 契约的 spawnRaw 桩，然后：
 *   A) 让另一个进程真的持有 `.git/index.lock` 约 400ms（比第一次重试的 180ms 长、
 *      比总预算 680ms 短）→ 生产代码必须重试到成功，且提交真的落库；
 *   B) 让锁被持有远超总预算 → 必须如实失败（重试不是无限兜底，不能把失败吞掉）。
 *
 * 不放进 npm test：它要真跑 git、真要一次对时序敏感的竞争。
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { parse } from 'acorn'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'host.js')
const src = readFileSync(SRC, 'utf8')

// ---- AST 提取 gitRun（不猜括号配对）----
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
let decl = null
const visit = (node) => {
  if (!node || typeof node !== 'object' || decl) return
  if (Array.isArray(node)) { node.forEach(visit); return }
  if (typeof node.type === 'string') {
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'gitRun') { decl = node; return }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue
      visit(node[key])
    }
  }
}
visit(ast)
if (!decl) { console.error('✗ 未能在 host.js 中定位 gitRun（改名/移走？请同步更新本脚本）'); process.exit(1) }
// 连同它依赖的常量与判据一起抽出：从 LOCK_MARKERS 声明处截到函数结束
const start = src.lastIndexOf('const LOCK_MARKERS', decl.start)
const fnSource = src.slice(start, decl.end)

// ---- spawnRaw 桩：忠实实现 host.js 用到的契约 ----
// ⚠ 契约有两层，别搞混（本桩第一版就搞混了，白查了半天）：
//   * gitRun 调 spawnRaw 时给的是**扁平** opts：{ stdinData, maxBytes, timeoutMs, env }；
//   * host 的 spawnRaw 内部把它翻成 stdio 契约 { stdin: {data}|'ignore', stdout, stderr }
//     再交给 subprocess.spawn。
// 所以桩要读 opts.stdinData，而不是 opts.stdio.stdin.data。
const spawnRaw = (argv, cwd, opts) => new Promise((resolve, reject) => {
  const o = opts || {}
  const inputVal = o.stdinData != null ? o.stdinData : undefined
  if (process.env.GP_E2E_DEBUG) {
    console.log('    [spawnRaw] argv=' + JSON.stringify(argv) + ' input=' + JSON.stringify(inputVal))
  }
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: Object.assign({}, process.env, o.env || {}),
    input: inputVal,
    encoding: 'utf8',
    timeout: o.timeoutMs || 90000,
    windowsHide: true,
    maxBuffer: o.maxBytes || 32 * 1024 * 1024
  })
  if (r.error) { reject(r.error); return }
  const out = { code: r.status, signal: r.signal, text: r.stdout || '', errText: r.stderr || '', truncated: false }
  if (process.env.GP_E2E_DEBUG) {
    console.log('    [spawnRaw] code=' + out.code + ' err=' + JSON.stringify(String(out.errText).slice(0, 60)))
  }
  resolve(out)
})

// host 的 timer 服务契约：timer.timeout(fn, ms) → 返回取消函数（见 host.js 里
// disposeTimer = timer.timeout(...) 的用法）。桩必须照这个契约来，否则测的就不是
// 线上那条异步等待路径——用同步 Atomics.wait 的版本正是被这个测试逮出来的。
const timer = { timeout: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) } }

const gitRun = vm.runInNewContext(
  '(function () { ' + fnSource + '\n; return gitRun })()',
  { spawnRaw, timer, console, String },
  { filename: 'gitRun.vm.js' }
)

const git = (dir, args) => {
  try { return { code: 0, text: execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { return { code: e.status == null ? -1 : e.status, text: String(e.stdout || ''), err: String(e.stderr || '') } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 竞争进程：立刻持锁 holdMs 后放手（模拟"另一个 git 正在写 index"）
async function holdLock(dir, holdMs) {
  const lock = join(dir, '.git', 'index.lock')
  writeFileSync(lock, '', 'utf8')
  await sleep(holdMs)
  rmSync(lock, { force: true })
}

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' —— ' + detail : '')) }

function makeRepo(label) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-e2e-' + label + '-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'probe@example.com'])
  git(dir, ['config', 'user.name', 'probe'])
  writeFileSync(join(dir, 'a.txt'), label + '\n', 'utf8')
  git(dir, ['add', 'a.txt'])
  return dir
}

// A) 锁在重试预算内放手 → 生产代码应该自愈
{
  const dir = makeRepo('a')
  try {
    const racer = holdLock(dir, 400)   // 400ms > 第一次重试等待 180ms、< 总预算 680ms
    const t0 = Date.now()
    const r = await gitRun(dir, ['commit', '-F', '-'], { stdinData: 'probe: 竞争自愈\n', maxBytes: 256 * 1024, timeoutMs: 60000 })
    const ms = Date.now() - t0
    await racer
    const log = git(dir, ['log', '--oneline'])
    check('A1 真实 gitRun 在锁竞争下重试成功', r.code === 0, 'exit=' + r.code + ' 用时 ' + ms + 'ms err=' + JSON.stringify((r.errText || '').slice(0, 80)))
    check('A2 提交真的落库', log.code === 0 && log.text.trim().length > 0, JSON.stringify(log.text.trim().slice(0, 60)))
    check('A3 用时落在重试预算内（说明是重试救的，不是碰巧）', ms >= 180 && ms < 3000, ms + 'ms')
    check('A4 锁没被我们的重试逻辑私自删掉（只等不抢）', !existsSync(join(dir, '.git', 'index.lock')), '锁已由持有方释放')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// B) 锁一直被持有 → 必须如实失败（重试不是无限兜底）
{
  const dir = makeRepo('b')
  try {
    const racer = holdLock(dir, 2500)  // 远超 680ms 预算
    const t0 = Date.now()
    const r = await gitRun(dir, ['commit', '-F', '-'], { stdinData: 'probe: 应当失败\n', maxBytes: 256 * 1024, timeoutMs: 60000 })
    const ms = Date.now() - t0
    await racer
    const log = git(dir, ['log', '--oneline'])
    check('B1 锁不放手时如实失败（不吞错）', r.code === 128, 'exit=' + r.code)
    check('B2 失败原文仍是 git 原文（用户仍能看到真因）', String(r.errText || '').indexOf('index.lock') >= 0, JSON.stringify(String(r.errText || '').slice(0, 70)))
    check('B3 没有产生提交', log.code !== 0, 'git log exit=' + log.code)
    check('B4 重试次数有界（约 0.68s 后放弃）', ms < 2000, ms + 'ms')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const bad = results.filter((r) => !r.ok).length
console.log('')
console.log(bad === 0
  ? `✓ 端到端 ${results.length}/${results.length} 通过：生产 gitRun 能自愈瞬时锁竞争，且不会吞掉真失败`
  : `✗ ${results.length - bad}/${results.length} 通过，失败项见上`)
process.exit(bad ? 1 : 0)
