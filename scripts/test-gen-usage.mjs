/**
 * 行为回归：生成提交信息的 token 用量账（默认关闭、可开关）。
 *
 * mock 的 llm 按调用序号给出确定性 usage 分片：
 *   第 1~3 次：{inputTokens:100, outputTokens:50, totalTokens:150}（两次普通 + 换模型一次）
 *   第 4 次：不发 usage 分片（adapter 不给的口径）→ 只计次、token 全 0
 *   第 5 次：{inputTokens:30, outputTokens:20} 无 totalTokens → 按 input+output 兜底求和
 * 覆盖：
 *   A) 缺省关闭：账本不出、审计无 generate-usage 行、行为与未升级版本一致；
 *   B) 开启记账：五连生成后 calls=5、total=150*3+50=500、poll 对不发 usage 的那次返回 null；
 *   C) 账本损坏降级：坏 JSON 按空表处理、不抛错、随后记录可重建；
 *   D) 再关闭：停写新行、历史账本保留且可读；
 *   E) wiring 守卫（token 级）+ 构建产物防漂移。
 *
 * 完全在临时目录里跑（USERPROFILE/settings 都指向临时根）。npm test 一部分。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn as cpSpawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_URL = pathToFileURL(join(ROOT, 'src', 'host.js')).href

// ---- git 原语（真 git 造现场） ----
function gitRaw(cwd, args) {
  return new Promise((resolve) => {
    const child = cpSpawn('git', args, { cwd, env: process.env })
    let out = '', errOut = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { errOut += c })
    child.on('error', () => resolve({ code: -1, text: '', errText: 'spawn git failed' }))
    child.on('close', (code) => resolve({ code, text: out, errText: errOut }))
  })
}

const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })
const has = (haystack, needle, msg) => ({ ok: String(haystack || '').includes(String(needle)), msg: msg + `（应包含 ${JSON.stringify(needle)}）` })
const lacks = (haystack, needle, msg) => ({ ok: !String(haystack || '').includes(String(needle)), msg: msg + `（不应包含 ${JSON.stringify(needle)}）` })
const gt = (actual, expected, msg) => ({ ok: actual > expected, msg: msg + `（应大于 ${expected}，实际 ${actual}）` })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 临时环境（各场景共用同一 home，模拟「一个 profile 的连续记账」）----
const tempRoot = mkdtempSync(join(tmpdir(), 'git-panel-genusage-'))
const homeDir = join(tempRoot, 'home')
const prevUserProfile = process.env.USERPROFILE
const prevHome = process.env.HOME
process.env.USERPROFILE = tempRoot
delete process.env.HOME

let routeHandlerFn = null
let callSeq = 0 // mock llm 调用序号（跨 host 实例连续，覆盖五连生成的确定性序列）

async function startHost() {
  const mod = await import(HOST_URL)
  const nodeFs = await import('node:fs')
  function dirnameOf(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i >= 0 ? p.slice(0, i) : p }
  const fsSvc = {
    async resolve(p) { return { __p: String(p) } },
    processPath(t) { return (t && t.__p) || String(t) },
    async readText(t) { try { return nodeFs.readFileSync((t && t.__p) || String(t), 'utf8') } catch (e) { return null } },
    async writeText(t, c) { nodeFs.mkdirSync(dirnameOf((t && t.__p) || String(t)), { recursive: true }); nodeFs.writeFileSync((t && t.__p) || String(t), c, 'utf8') },
    async stat(t) { const st = nodeFs.statSync((t && t.__p) || String(t)); return { type: st.isDirectory() ? 'directory' : 'file', size: st.size } },
    async listDir(t) { return nodeFs.readdirSync((t && t.__p) || String(t), { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file', target: { __p: join((t && t.__p) || String(t), d.name) } })) }
  }
  // llm 桩：按调用序号给确定性 usage 分片（见文件头注释）
  const llm = {
    listProviders: () => [{ id: 'mockprov' }],
    listModels: async () => [{ id: 'mockmodel', maxTokens: 4096 }, { id: 'mockmodel2', maxTokens: 4096 }],
    stream(opts) {
      callSeq++
      const n = callSeq
      const chunks = [{ type: 'text-delta', text: 'chore(demo): 生成回执' }]
      if (n <= 3 || n >= 6) chunks.push({ type: 'usage', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } })
      else if (n === 5) chunks.push({ type: 'usage', usage: { inputTokens: 30, outputTokens: 20 } }) // 无 totalTokens → 兜底求和
      // n === 4：不发 usage 分片
      chunks.push({ type: 'finish', reason: { kind: 'stop' } })
      return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
    }
  }
  const services = {
    fs: fsSvc,
    subprocess: {
      spawn(o) {
        const out = [], errs = []
        const collect = (buf) => (c) => { buf.push(c) }
        const child = cpSpawn(o.argv[0], o.argv.slice(1), { cwd: o.cwd, env: o.env || process.env })
        child.stdout.on('data', collect(out))
        child.stderr.on('data', collect(errs))
        const done = new Promise((resolve, reject) => {
          child.on('error', reject)
          child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
        })
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: Buffer.concat(out).toString('utf8') }) },
            stderr: { readFrom: () => ({ text: Buffer.concat(errs).toString('utf8') }) }
          },
          terminate() { try { child.kill() } catch (e) { /* ignore */ } }
        }
      }
    },
    settings: { async prepareDocument() { return join(homeDir, 'settings.json') } },
    webServer: { register(r) { routeHandlerFn = r.handler; return () => {} } },
    connection: { requestRejection() { return undefined } },
    timer: { timeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) } },
    llm
  }
  const ctx = { get: (k) => services[k], effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} }, inject: () => {}, on: () => {} }
  mod.default().apply(ctx, {})
  const rpc = async (method, payload) => {
    const res = { writeHead() {}, end(b) { this.__body = b } }
    await routeHandlerFn({
      method: 'POST', url: '/git-panel/' + method, headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'r', method, payload })) }
    }, res)
    const env = JSON.parse(res.__body).result
    if (env && env.ok === true) return Object.assign({ ok: true }, env.value || {})
    return { ok: false, error: env && env.error && (env.error.message || env.error.code) }
  }
  return { rpc }
}

async function freshRepo() {
  const dir = mkdtempSync(join(tempRoot, 'repo-'))
  await gitRaw(dir, ['init', '-q'])
  await gitRaw(dir, ['config', 'user.email', 'tester@example.com'])
  await gitRaw(dir, ['config', 'user.name', 'Git Panel Test'])
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  await gitRaw(dir, ['add', '.'])
  await gitRaw(dir, ['commit', '-q', '-m', 'init'])
  writeFileSync(join(dir, 'edit.txt'), 'one\ntwo\n')
  return dir
}

async function bootAndScan(host, repoDir) {
  const s = await host.rpc('scan', { root: repoDir, force: true })
  if (!s.ok) throw new Error('scan failed: ' + s.error)
  const repo = s.repos && s.repos[0]
  if (!repo) throw new Error('scan 未发现仓库: ' + JSON.stringify(s))
  return String(repo.id)
}

async function runOnce(host, repoId) {
  const r = await host.rpc('generate', { repoId, files: ['edit.txt'], clientGenId: 'gen-t-' + (++runTag) })
  if (!r || !r.ok) return r
  for (let i = 0; i < 80; i++) {
    const p = await host.rpc('generatePoll', { genId: r.genId })
    if (p.done || p.aborted || p.error) return p
    await sleep(25)
  }
  return { done: false }
}
let runTag = 0

const gpPanelDir = () => join(homeDir, 'git-panel')
const ledgerPath = () => join(gpPanelDir(), 'gen-usage.json')
const configPath = () => join(gpPanelDir(), 'config.json')
const todayLogPath = () => join(gpPanelDir(), 'logs', 'git-' + new Date().toISOString().slice(0, 10) + '.log')

try {
  // ---- A) 缺省关闭 ----
  {
    callSeq = 0 // 每场景重置 mock 序号，保证五连序列的确定性
    const repo = await freshRepo()
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    const gu0 = await h.rpc('genUsageGet')
    await runOnce(h, repoId)
    const gu1 = await h.rpc('genUsageGet')
    await sleep(300) // 等审计链落盘
    const logTxt = existsSync(todayLogPath()) ? readFileSync(todayLogPath(), 'utf8') : ''
    scenario('A 缺省关闭：账本不出、审计无 generate-usage 行', [
      eq(gu0.enabled, false, '缺省 enabled=false'),
      eq(existsSync(configPath()), false, 'config.json 未创建'),
      eq(existsSync(ledgerPath()), false, '账本文件不出现'),
      eq(gu1.enabled, false, '跑过生成后仍关闭'),
      eq(gu1.calls, 0, 'calls 不累计'),
      eq(gu1.total, 0, 'tokens 不累计'),
      lacks(logTxt, 'generate-usage', '审计日志无 generate-usage 行')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- B) 开启记账：五连生成覆盖三种 usage 口径 ----
  {
    callSeq = 0
    const repo = await freshRepo()
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    await h.rpc('genUsageSet', { enabled: true })

    const p1 = await runOnce(h, repoId) // 普通（total 150）
    const p2 = await runOnce(h, repoId) // 普通（total 150）
    await h.rpc('genModelSet', { provider: 'mockprov', model: 'mockmodel2' })
    const p3 = await runOnce(h, repoId) // 换模型，普通（total 150）
    await h.rpc('genModelSet', { provider: 'mockprov', model: 'mockmodel' })
    const p4 = await runOnce(h, repoId) // adapter 不给 usage
    const p5 = await runOnce(h, repoId) // 无 totalTokens（30+20=50 兜底）

    const gu = await h.rpc('genUsageGet')
    const ledger = JSON.parse(readFileSync(ledgerPath(), 'utf8'))
    const models = (gu.models || []).map((m) => m.model)
    scenario('B 开启记账：口径、兜底与落盘', [
      eq(p1.done && p2.done && p3.done && p4.done && p5.done, true, '五次生成全部正常收尾'),
      eq(p1.usage && p1.usage.totalTokens, 150, 'poll 暴露第 1 次 usage'),
      eq(p4.usage, null, 'adapter 不给 usage → poll.usage 为 null（计次不受影响）'),
      eq(p5.usage && p5.usage.totalTokens, 50, '无 totalTokens 时按 input+output 兜底求和'),
      eq(gu.calls, 5, '五次后 calls=5'),
      eq(gu.input, 330, 'input 累加 100*3+30=330'),
      eq(gu.output, 170, 'output 累加 50*3+20=170'),
      eq(gu.total, 500, 'total 累加 150*3+50=500'),
      eq(models.indexOf('mockprov/mockmodel') >= 0, true, '模型分布含首次模型'),
      eq(models.indexOf('mockprov/mockmodel2') >= 0, true, '模型分布含换过去的模型'),
      eq(ledger.version, 1, '账本 version=1'),
      eq(typeof ledger.days === 'object' && typeof ledger.models === 'object', true, '账本 days/models 段完整'),
      eq(existsSync(ledgerPath()), true, '账本已落盘')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- C) 账本损坏降级 + 重建 ----
  {
    callSeq = 0
    const repo = await freshRepo()
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    mkdirSync(gpPanelDir(), { recursive: true })
    writeFileSync(ledgerPath(), '{ this is not json !!!', 'utf8')
    const guCorrupt = await h.rpc('genUsageGet')
    await h.rpc('genUsageSet', { enabled: true })
    await runOnce(h, repoId)
    const guAfter = await h.rpc('genUsageGet')
    scenario('C 损坏账本降级与重建', [
      eq(guCorrupt.calls, 0, '坏账按空表处理、calls=0 且不抛错'),
      eq(guAfter.calls, 1, '坏账之后首条记录并入，calls=1'),
      gt(guAfter.total, 0, 'token 有数（本场景首条生成在 mock 序列里是 total=150）')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- D) 再关闭：停写新行、历史保留 ----
  {
    callSeq = 0
    const repo = await freshRepo()
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    await h.rpc('genUsageSet', { enabled: true })
    await runOnce(h, repoId)
    const beforeOff = await h.rpc('genUsageGet')
    await h.rpc('genUsageSet', { enabled: false })
    const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
    await runOnce(h, repoId)
    const afterOff = await h.rpc('genUsageGet')
    scenario('D 再关闭：停写新行、历史账本保留', [
      gt(beforeOff.calls, 0, '关闭前有记录'),
      eq(afterOff.calls, beforeOff.calls, '关闭后 calls 不再增长'),
      eq(cfg.genUsage, false, 'config.json 落盘 genUsage=false'),
      eq(existsSync(ledgerPath()), true, '历史账本保留在磁盘')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- E) wiring 守卫（token 级）+ 产物防漂移 ----
  {
    const checks = []
    const hSrc = readFileSync(join(ROOT, 'src/host.js'), 'utf8')
    checks.push(has(hSrc, "task.captureUsage && chunk.type === 'usage'", 'consume 仅在开关开启时捕获 usage 分片'))
    checks.push(has(hSrc, 'task.captureUsage = await loadGenUsageEnabled()', '生成发起时读开关（在途任务按发起时状态记账）'))
    checks.push(has(hSrc, 'usage: (task.captureUsage ? task.usage : null) || null', 'poll 按开关暴露 usage（关闭恒 null）'))
    checks.push(has(hSrc, "op: 'generate-usage'", 'finally 单点发射 generate-usage 审计行（覆盖成功/失败/终止全路径）'))
    checks.push(has(hSrc, 'recordGenUsage(', '落盘账本调用'))
    checks.push(has(hSrc, "registerRpc('genUsageGet'", 'RPC genUsageGet'))
    checks.push(has(hSrc, "registerRpc('genUsageSet'", 'RPC genUsageSet'))
    checks.push(has(hSrc, 'j.genUsage === true', '开关严格等于 true 才算开（缺省 false）'))

    const ca = readFileSync(join(ROOT, 'src/client/components/RepoCard/CommitArea.js'), 'utf8')
    checks.push(has(ca, "p.usage && p.usage.totalTokens != null", 'CommitArea 生成进度按开关显示 tokens 后缀'))
    const gm = readFileSync(join(ROOT, 'src/client/components/GenModelModal.js'), 'utf8')
    checks.push(has(gm, "callRpc('genUsageGet'", '弹窗拉取开关态与累计'))
    checks.push(has(gm, "callRpc('genUsageSet'", '弹窗开关切换 RPC'))
    checks.push(has(gm, 'gpUsageCumulative', '弹窗累计行文案键'))
    // 失败显式提示：宿主未重启时 RPC 静默失败曾造成「点了没反应」，此处必须弹错
    checks.push(has(gm, "pushToast('error', tr('gpUsageRpcFailed'))", '开关 RPC 失败时显式 toast（不再静默）'))
    checks.push(has(gm, 'const r = await callRpc', 'toggle 先接住 RPC 结果再分支'))
    const util = readFileSync(join(ROOT, 'src/client/lib/util.js'), 'utf8')
    checks.push(has(util, "export { GROUP_META, glyphOf, rowKey, splitPath, isImagePath, fmtBytes, fmtTokens }", 'util 导出 fmtTokens'))

    const bundle = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
    checks.push(has(bundle, 'genUsageGet', 'bundle 含 genUsageGet'))
    checks.push(has(bundle, 'fmtTokens', 'bundle 含 fmtTokens 格式化'))
    scenario('E wiring 守卫 + 产物防漂移', checks)
  }
} finally {
  process.env.USERPROFILE = prevUserProfile
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
  rmSync(tempRoot, { recursive: true, force: true })
}

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 生成用量账（默认关闭、可开关）：${results.length} 个场景全部通过`
  : `✗ 生成用量账：${failed.length}/${results.length} 个场景失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)