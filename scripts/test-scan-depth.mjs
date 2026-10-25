/**
 * 行为回归：仓库扫描深度默认 1（对齐 VS Code）与扫描缓存版本闸门（src/host.js）。
 *
 * 背景：默认扫描深度曾是 10，深层嵌套的上游克隆（如 work/upstream/ 下整仓 checkout 的
 * 三个独立 .git）会被 BFS 逐个发现并与主项目并列展示——用户视角「一个目录冒出四个项目」。
 * VS Code 内置 git 扩展的 git.repositoryScanMaxDepth 默认值是 1（只扫工作区根目录与
 * 直接子目录，extensions/git/src/model.ts 的 scanWorkspaceFolders/traverseWorkspaceFolder），
 * 本插件对齐该默认。本测试把语义钉死：
 *   1) 默认深度 1：根仓库 + 一层子目录仓库被发现，三层嵌套仓库不出现；
 *   2) config 覆盖：scanMaxDepth: 3 时嵌套仓库照常发现（多仓工作区不受默认值限制）；
 *   3) 缓存版本闸门：version 1 的旧磁盘缓存（深度 10 时代的扫描结果）整文件作废，
 *      不命中、不复用其中条目；重扫后落盘 version 2。
 *
 * 跑法：完全在临时目录里（USERPROFILE 与 settings.prepareDocument 都指向临时根），真实的
 * ~/.dsh 与 profile 目录不会被读或写。npm test 一部分；非 0 退出 = 失败。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { dirname as upDir, join as upJoin } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = upJoin(upDir(fileURLToPath(import.meta.url)), '..')
const HOST_URL = pathToFileURL(upJoin(ROOT, 'src', 'host.js')).href

const results = []
// ⚠ 只上报**失败**的断言：不过滤的话全绿场景也会把每条断言都印出来，看着像全挂
//（test-rules-dirs.mjs 第一版就踩过这个坑——输出里「期望 X，实际 X」全部相等却标着 ✗）。
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

// ---- 临时环境：tempRoot 下自建扫描目标 ws 与 profile 数据目录 ----
// USERPROFILE 必须是「家目录」而不是 .dsh 本身——与 test-rules-dirs.mjs 同一口径，
// settings.prepareDocument 所在目录决定 $DSH_HOME/git-panel/（scan-cache.json 就写在这里）。
const tempRoot = mkdtempSync(join(tmpdir(), 'git-panel-scan-'))
const homeDir = join(tempRoot, '.dsh', 'profiles', 'desktop') // settings.prepareDocument 所在目录
const dataDir = join(homeDir, 'git-panel')
const scanCachePath = join(dataDir, 'scan-cache.json')
const prevUserProfile = process.env.USERPROFILE
const prevHome = process.env.HOME
process.env.USERPROFILE = tempRoot
delete process.env.HOME

// fixture A：根本身是仓库 + 第二层（直接子目录）两个仓库 + 第三层嵌套仓库（模拟 work/upstream/<repo> 布局）
const wsDir = join(tempRoot, 'ws')
mkdirSync(join(wsDir, '.git'), { recursive: true })
mkdirSync(join(wsDir, 'alpha', '.git'), { recursive: true })
mkdirSync(join(wsDir, 'beta', '.git'), { recursive: true })
mkdirSync(join(wsDir, 'work', 'upstream', 'inner', '.git'), { recursive: true })
// fixture B：根不是仓库，第二层两个仓库并列（对应 VS Code 打开一个「装项目的文件夹」）
const noRootDir = join(tempRoot, 'no-root')
mkdirSync(join(noRootDir, 'alpha', '.git'), { recursive: true })
mkdirSync(join(noRootDir, 'beta', '.git'), { recursive: true })
mkdirSync(join(noRootDir, 'work', 'upstream', 'inner', '.git'), { recursive: true })

/** 每个场景起一个全新的 host 实例（apply 内部闭包各自独立）；cfg 即 apply 第二参 */
async function startHost(cfg) {
  const mod = await import(HOST_URL)
  const fsSvc = {
    async resolve(p) { return { __p: String(p) } },
    processPath(t) { return (t && t.__p) || String(t) },
    async readText(t) { return readFileSync((t && t.__p) || String(t), 'utf8') }, // 不存在即抛，调用方 fsReadText 会吞
    async writeText(t, c) {
      const p = (t && t.__p) || String(t)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, c, 'utf8')
    },
    async stat(t) {
      const st = statSync((t && t.__p) || String(t))
      return { type: st.isDirectory() ? 'directory' : 'file', size: st.size }
    },
    async listDir(t) {
      const p = (t && t.__p) || String(t)
      return readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file', target: { __p: join(p, d.name) } }))
    }
  }
  let routeHandler = null
  const services = {
    fs: fsSvc,
    subprocess: {
      spawn(o) { return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: '', stderr: '' }, terminate() {} } }
    },
    settings: { async prepareDocument() { return join(homeDir, 'settings.json') } },
    webServer: { register(r) { routeHandler = r.handler; return () => {} } },
    connection: { requestRejection() { return undefined } },
    timer: { timeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) } }
  }
  const ctx = { get: (k) => services[k], effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} }, inject: () => {}, on: () => {} }
  mod.default().apply(ctx, cfg || {})
  // 协议信封 { ok:true, value:{...} } 按 test-rules-dirs.mjs 的 rpc 同一口径摊平
  const rpc = async (method, payload) => {
    const res = { writeHead() {}, end(b) { this.__body = b } }
    await routeHandler({
      method: 'POST', url: '/git-panel/' + method, headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'r', method, payload })) }
    }, res)
    const env = JSON.parse(res.__body).result
    if (env && env.ok === true) return Object.assign({ ok: true }, env.value || {})
    return { ok: false, error: env && env.error && (env.error.message || env.error.code) }
  }
  const scan = async (opts) => {
    const r = await rpc('scan', Object.assign({ root: wsDir, force: true }, opts || {}))
    if (!r.ok) throw new Error('scan failed: ' + r.error)
    return r
  }
  return { rpc, scan }
}

const readCacheIf = () => (existsSync(scanCachePath) ? JSON.parse(readFileSync(scanCachePath, 'utf8')) : null)

const scenarios = []
const run = (name, fn) => scenarios.push([name, fn])
const INNER_ID = join('work', 'upstream', 'inner') // rel 用平台分隔符（r.path 按根切片而来）

try {
  run('默认深度 1＝根+直接子目录：第二层两个仓库全部显示，第三层嵌套不出现', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    const host = await startHost()
    const r = await host.scan()
    const ids = r.repos.map((x) => x.id).sort()
    return [
      eq(r.count, 3, '发现数量为 3（根 + alpha + beta）'),
      eq(JSON.stringify(ids), JSON.stringify(['alpha', 'beta', 'ws']), 'ids 恰为根仓库(目录名 ws)与第二层的 alpha、beta：' + JSON.stringify(ids)),
      eq(ids.includes(INNER_ID), false, '第三层嵌套仓库未被扫描'),
      eq(r.repos.find((x) => x.id === 'ws').rel, '.', '根仓库 rel 为 .')
    ]
  })

  run('根不是仓库时同理：第二层两个仓库全部显示（VS Code 打开「装项目的文件夹」）', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    const host = await startHost()
    const r = await host.scan({ root: noRootDir })
    const ids = r.repos.map((x) => x.id).sort()
    return [
      eq(r.count, 2, '第二层两个仓库全部显示'),
      eq(JSON.stringify(ids), JSON.stringify(['alpha', 'beta']), 'ids 恰为 alpha、beta：' + JSON.stringify(ids)),
      eq(ids.includes(INNER_ID), false, '第三层嵌套仓库未被扫描')
    ]
  })

  run('config 覆盖：scanMaxDepth=3 时第三层嵌套仓库照常发现', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    const host = await startHost({ scanMaxDepth: 3 })
    const r = await host.scan()
    const ids = r.repos.map((x) => x.id)
    return [
      eq(r.count, 4, '发现数量为 4'),
      eq(ids.includes(INNER_ID), true, '第三层嵌套仓库被扫描：' + JSON.stringify(ids))
    ]
  })

  run('缓存版本闸门：version 1 旧缓存整体作废，重扫后落盘 version 2', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    // 种子：深度 10 时代的扫描结果（version 1），四条目里嵌套仓库指向真实存在的 .git——
    // 若闸门失效走了缓存命中路径，validateCachedRepos 的 stat 校验拦不住它，count 会变成 4。
    const innerRepo = { id: INNER_ID, name: 'inner', path: join(wsDir, 'work', 'upstream', 'inner'), rel: INNER_ID }
    mkdirSync(dirname(scanCachePath), { recursive: true })
    writeFileSync(scanCachePath, JSON.stringify({
      version: 1,
      entries: [{ root: wsDir, scannedAt: Date.now(), repos: [
        { id: 'ws', name: 'ws', path: wsDir, rel: '.' },
        { id: 'alpha', name: 'alpha', path: join(wsDir, 'alpha'), rel: 'alpha' },
        { id: 'beta', name: 'beta', path: join(wsDir, 'beta'), rel: 'beta' },
        innerRepo
      ] }]
    }, null, 2) + '\n', 'utf8')
    const host = await startHost()
    const r = await host.scan({ force: false }) // 不带 force：若 v1 缓存被复用会直接命中返回 4 条
    const cache = readCacheIf()
    const wsEntry = cache && Array.isArray(cache.entries) ? cache.entries.find((e) => e.root === wsDir) : null
    return [
      eq(r.count, 3, 'version 1 缓存未命中，按当前深度全量重扫'),
      eq(r.repos.some((x) => x.id === INNER_ID), false, '嵌套仓库未从旧缓存漏进来'),
      eq(cache && cache.version, 2, '重扫后落盘 version 2'),
      eq(wsEntry ? wsEntry.repos.length : -1, 3, 'version 2 条目只含 3 个仓库')
    ]
  })

  for (const [name, fn] of scenarios) {
    try {
      scenario(name, await fn())
    } catch (e) {
      scenario(name, [{ ok: false, msg: '场景抛错: ' + (e && e.message ? e.message : String(e)) }])
    }
  }
} finally {
  process.env.USERPROFILE = prevUserProfile
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
  rmSync(tempRoot, { recursive: true, force: true })
}

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 扫描深度默认：${results.length} 个场景全部通过`
  : `✗ 扫描深度默认：${failed.length}/${results.length} 个场景失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)
