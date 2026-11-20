/**
 * 行为回归：无暂存文件的生成口径（src/host.js 的 generate RPC / prepareGenerate /
 * untrackedGenText），以及「有暂存时按显式 files 生成」的旧口径不被破坏。
 *
 * 覆盖：
 *   1) 工作区完全干净且 files=[] → 直接失败并给「没有可生成的变更」，不建 LLM 任务；
 *   2) 只有未跟踪新文件且 files=[] → 注入内容带「暂存区为空」说明、新文件的合成新增
 *      diff（含内容行），而不是只给一行「新文件（未跟踪）」标记；
 *   3) 有暂存且 files=[已暂存路径] → 注入该文件的 staged diff、无任何「暂存区为空」
 *      说明（旧口径逐字保持）；变更集外的路径仍被拒绝；
 *   4) 只有未暂存修改且 files=[] → 注入未暂存 diff + 说明。
 *   5) errRepoMissing 的 host 契约：注册表只保留最近一次扫描的根——先扫 A 再扫 B 后，
 *      generate(A-repoId) 必须失败且带结构化 reason='repo-missing'（Client 自愈判据），
 *      重扫 A 后该 repoId 重新可用、生成照常进任务流。
 *   6) Client 自愈接线守卫（token 级）：CommitArea 按 reason 判据、经共享 store 的根 +
 *      scan RPC 重扫重试，配额一次性；store/GitPanelMain 的 wsRoot 通道在位。
 *
 * llm 用捕获桩代替真实 stream：断言直接打在「最终注入 LLM 的 user_context」上——这是
 * 生成语义的核心契约，而不是把 LLM 调用成败当测试目标。provider/model 选择也顺带钉死
 * （配置缺失时回退到首个可用 provider/model）。
 *
 * 完全在临时目录里跑（USERPROFILE / settings.prepareDocument 都指向临时根），真实的
 * ~/.dsh 不被读写。npm test 一部分；非 0 退出 = 失败。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn as cpSpawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_URL = pathToFileURL(join(ROOT, 'src', 'host.js')).href

// ---- git 原语（真 git，现场在临时仓库里造） ----
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
;(async () => {
  const probe = await gitRaw(process.cwd(), ['--version'])
  if (probe.code !== 0) {
    console.error('✗ git 不可用（需要 git 在 PATH 中）：' + (probe.errText || ''))
    process.exit(1)
  }
})()

const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })
const has = (haystack, needle, msg) => ({ ok: String(haystack || '').includes(String(needle)), msg: msg + `（应包含 ${JSON.stringify(needle)}）` })
const lacks = (haystack, needle, msg) => ({ ok: !String(haystack || '').includes(String(needle)), msg: msg + `（不应包含 ${JSON.stringify(needle)}，实际：${JSON.stringify(String(haystack || '').slice(0, 200))}）` })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 临时环境：一个家目录（settings.prepareDocument）+ 若干独立临时仓库 ----
const tempRoot = mkdtempSync(join(tmpdir(), 'git-panel-gen-'))
const homeDir = join(tempRoot, 'home')
const prevUserProfile = process.env.USERPROFILE
const prevHome = process.env.HOME
process.env.USERPROFILE = tempRoot
delete process.env.HOME

// HTTP 路由表在 apply 时经 webServer.register 建立：注册时把 handler 捕获进模块级变量，
// rpc 通道据它驱动（与 test-rules-dirs.mjs 的做法同款）
let routeHandlerFn = null
const callsRef = { list: [] }

async function startHost() {
  const mod = await import(HOST_URL)
  const fsSvc = {
    async resolve(p) { return { __p: String(p) } },
    processPath(t) { return (t && t.__p) || String(t) },
    async readText(t) { return requireReadText((t && t.__p) || String(t)) },
    async writeText(t, c) { requireWrite((t && t.__p) || String(t), c) },
    async stat(t) {
      const st = requireStat((t && t.__p) || String(t))
      return { type: st.isDirectory() ? 'directory' : 'file', size: st.size }
    },
    async listDir(t) {
      return requireListDir((t && t.__p) || String(t)).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file', target: { __p: join((t && t.__p) || String(t), d.name) } }))
    }
  }
  // fs 的四个原语用 node:fs 同步实现同步包一层：测试只需面板的调用形态，不必复刻
  // spill/限额这些收集细节（生成场景的 git 输出都在 KB 级）
  const nodeFs = await import('node:fs')
  function requireReadText(p) { try { return nodeFs.readFileSync(p, 'utf8') } catch (e) { return null } }
  function requireWrite(p, c) { nodeFs.mkdirSync(dirnameOf(p), { recursive: true }); nodeFs.writeFileSync(p, c, 'utf8') }
  function requireStat(p) { return nodeFs.statSync(p) }
  function requireListDir(p) { return nodeFs.readdirSync(p, { withFileTypes: true }) }
  function dirnameOf(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i >= 0 ? p.slice(0, i) : p }

  // llm 桩：record 每次 stream 调用的完整 opts（system/messages/provider/model），
  // 产出一段固定的确定性文本——完成语义与真实模型无异，但断言不依赖网络。
  callsRef.list = []
  const llm = {
    listProviders: () => [{ id: 'mockprov' }],
    listModels: async () => [{ id: 'mockmodel', maxTokens: 4096 }],
    stream(opts) {
      callsRef.list.push(opts)
      const chunks = [
        { type: 'text-delta', text: 'chore(demo): 生成回执（用于验证注入上下文）' },
        { type: 'finish', reason: { kind: 'stop' } }
      ]
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
  // 与生产端 api.js 的 unwrapRpc 同口径摊平（含 details.reason 等业务字段透传）：
  // errRepoMissing 自愈判据就落在摊平后的 res.reason 上。
  const rpc = async (method, payload) => {
    const res = { writeHead() {}, end(b) { this.__body = b } }
    await routeHandlerFn({
      method: 'POST', url: '/git-panel/' + method, headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'r', method, payload })) }
    }, res)
    const env = JSON.parse(res.__body).result
    if (env && env.ok === true) return Object.assign({ ok: true }, env.value || {})
    if (env && env.ok === false && env.error && typeof env.error === 'object') {
      const err = { ok: false, error: env.error.message || env.error.code || 'error' }
      const d = env.error.details
      if (d && typeof d === 'object') {
        if (typeof d.detail === 'string' && d.detail) err.detail = d.detail
        if (typeof d.reason === 'string' && d.reason) err.reason = d.reason
        if (typeof d.command === 'string' && d.command) err.command = d.command
      }
      return err
    }
    return { ok: false, error: 'bad envelope' }
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
  return dir
}

async function bootAndScan(host, repoDir) {
  const s = await host.rpc('scan', { root: repoDir, force: true })
  if (!s.ok) throw new Error('scan failed: ' + s.error)
  const repo = s.repos && s.repos[0]
  if (!repo) throw new Error('scan 未发现仓库: ' + JSON.stringify(s))
  return String(repo.id)
}

// 轮询到生成收尾（done / error / aborted），超时报错而不是挂着
async function waitDone(host, genId, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const p = await host.rpc('generatePoll', { genId })
    if (p.done || p.aborted || (p && p.error)) return p
    await sleep(25)
  }
  throw new Error('生成超时未收尾（genId=' + genId + '）')
}

// 最后一次 stream 调用的注入上下文：runGenerate 恒用 messages[0].content[0].text
function lastInjected() {
  const last = callsRef.list[callsRef.list.length - 1]
  if (!last || !Array.isArray(last.messages) || !last.messages[0]) return ''
  const content = last.messages[0].content
  return Array.isArray(content) ? String(content[0].text || '') : String(content || '')
}

const NOTE = '暂存区为空，以下为工作区全部未暂存的改动，含未跟踪的新文件内容'

try {
  // ---- 1) 干净工作区 + files=[]：没有可生成的对象，快速失败，不烧 token ----
  {
    const repo = await freshRepo()
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    const r = await h.rpc('generate', { repoId, files: [] })
    scenario('1 干净工作区按全部改动生成：拒绝并给出「没有可生成的变更」', [
      eq(r.ok, false, 'generate 结果'),
      eq(r.error, '没有可生成的变更：暂存区与未暂存改动均为空', '错误文案'),
      eq(callsRef.list.length, 0, '未发起任何 LLM 调用')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- 2) 未跟踪新文件 + files=[]：读入内容、合成新增 diff、带「暂存区为空」说明 ----
  {
    const repo = await freshRepo()
    writeFileSync(join(repo, 'new.txt'), 'hello world\nsecond line\n')
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    const r = await h.rpc('generate', { repoId, files: [] })
    const p = await waitDone(h, r.genId)
    const ctx = lastInjected()
    scenario('2 无暂存且有未跟踪新文件：注入内容含说明与合成新增 diff', [
      eq(r.ok, true, 'generate 结果'),
      eq(p.done, true, '任务收尾'),
      eq(p.text, 'chore(demo): 生成回执（用于验证注入上下文）', '回显文本'),
      has(ctx, NOTE, '注入上下文带「暂存区为空」说明'),
      has(ctx, '- new.txt', 'file_list 含新文件'),
      has(ctx, 'diff --git a/new.txt b/new.txt', '合成新增 diff 头'),
      has(ctx, 'new file mode 100644', '新增文件标记'),
      has(ctx, '+hello world', '新文件内容行 1'),
      has(ctx, '+second line', '新文件内容行 2'),
      lacks(ctx, '# 新文件（未跟踪）: new.txt', '不再退回只有文件名的旧标记')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- 3) 有暂存 + 显式 files=[已暂存路径]：沿用 staged 口径，无说明；非法路径被拒 ----
  {
    const repo = await freshRepo()
    writeFileSync(join(repo, 'mod.txt'), 'first\nsecond\n')
    await gitRaw(repo, ['add', 'mod.txt'])
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    const r = await h.rpc('generate', { repoId, files: ['mod.txt'] })
    const p = await waitDone(h, r.genId)
    const ctx = lastInjected()
    scenario('3 有暂存按 staged 口径生成：staged diff、无说明（旧口径保持）', [
      eq(r.ok, true, 'generate 结果'),
      eq(p.done, true, '任务收尾'),
      has(ctx, '+++ b/mod.txt', '注入 staged diff 新版头'),
      has(ctx, '+second', '注入 staged 内容行'),
      has(ctx, '+first', 'mod.txt 是新暂存文件，staged diff 即整份新增'),
      has(ctx, '- mod.txt', 'file_list 含已暂存文件'),
      lacks(ctx, NOTE, '不带「暂存区为空」说明'),
      // 变更集外路径：手动构造的 RPC 也进不了生成目标（与写操作同一道校验）
      eq((await h.rpc('generate', { repoId, files: ['ghost.txt'] })).ok, false, '变更集外路径被拒'),
      has((await h.rpc('generate', { repoId, files: ['ghost.txt'] })).error, '文件不在变更集中', '拒绝文案为 errNotChanged')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- 4) 只有未暂存修改 + files=[]：注入未暂存 diff + 说明 ----
  {
    const repo = await freshRepo()
    writeFileSync(join(repo, 'edit.txt'), 'one\n')
    await gitRaw(repo, ['add', 'edit.txt'])
    await gitRaw(repo, ['commit', '-q', '-m', 'track edit.txt'])
    writeFileSync(join(repo, 'edit.txt'), 'one\ntwo\n') // 只改工作区，不 add
    const h = await startHost()
    const repoId = await bootAndScan(h, repo)
    const r = await h.rpc('generate', { repoId, files: [] })
    const p = await waitDone(h, r.genId)
    const ctx = lastInjected()
    scenario('4 无暂存但有未暂存修改：注入未暂存 diff + 说明', [
      eq(r.ok, true, 'generate 结果'),
      eq(p.done, true, '任务收尾'),
      has(ctx, NOTE, '注入上下文带「暂存区为空」说明'),
      has(ctx, '- edit.txt', 'file_list 含未暂存文件'),
      has(ctx, '+two', '注入未暂存内容行'),
      lacks(ctx, '+one\ntwo', '工作区原文不被整份塞进 diff（diff 只含变更行）')
    ])
    rmSync(repo, { recursive: true, force: true })
  }

  // ---- 5) errRepoMissing 自愈的 host 契约：注册表只保留最近一次扫描的根 ----
  // 复现用户现场：两个工作区根 A/B，先扫 A 再扫 B → A 的 repoId 已被挤出注册表；
  // generate(A-repoId) 必须给结构化 reason='repo-missing'（Client 自愈判据，不靠文案匹配），
  // 重扫 A 后该 repoId 重新可用。Client 侧的自愈接线由场景 6 的守卫钉住。
  {
    let checks = []
    try {
      const dirA = mkdtempSync(join(tempRoot, 'rootA-'))
      await gitRaw(dirA, ['init', '-q'])
      const dirB = mkdtempSync(join(tempRoot, 'rootB-'))
      await gitRaw(dirB, ['init', '-q'])
      writeFileSync(join(dirA, 'a.txt'), 'a\n')
      writeFileSync(join(dirB, 'b.txt'), 'b\n')
      const h = await startHost()
      const idA = await bootAndScan(h, dirA)
      const sB = await h.rpc('scan', { root: dirB, force: true })
      checks.push(eq(sB.ok, true, '切到 B 扫描成功'))
      checks.push(eq((sB.repos || []).length, 1, 'B 下只有自己的仓库（注册表已整体替换）'))
      const gone = await h.rpc('generate', { repoId: idA, files: [] })
      checks.push(eq(gone.ok, false, '旧 repoId 的 generate 失败'))
      checks.push(eq(gone.error, '仓库不存在，请重新扫描', '错误文案为 errRepoMissing'))
      checks.push(eq(gone.reason, 'repo-missing', '结构化判据（Client 自愈依赖它，不做文案匹配）'))
      // 重扫 A：原 repoId 重新解析成功，生成照常进入任务流——Client 自愈的前置契约
      const back = await h.rpc('scan', { root: dirA, force: true })
      checks.push(eq(back.ok, true, '重扫 A 成功'))
      const again = await h.rpc('generate', { repoId: idA, files: [] })
      checks.push(eq(again.ok, true, '重扫原根后生成恢复'))
      checks.push(eq((await waitDone(h, again.genId)).done, true, '恢复后的任务正常收尾'))
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    } catch (e) {
      checks = [{ ok: false, msg: '场景抛错: ' + (e && e.message ? e.message : String(e)) }]
    }
    scenario('5 切根后旧 repoId：结构化 repo-missing + 重扫原根可恢复（自愈的 host 契约）', checks)
  }

  // ---- 6) Client 自愈接线守卫（token 级）：CommitArea 收到 repo-missing 时的重扫重试链 ----
  {
    const checks = []
    const ca = readFileSync(join(ROOT, 'src/client/components/RepoCard/CommitArea.js'), 'utf8')
    checks.push({ ok: ca.indexOf("r.reason === 'repo-missing'") >= 0, msg: 'CommitArea 判 reason（而非匹配 errRepoMissing 文案）' })
    checks.push({ ok: ca.indexOf('store.get().wsRoot') >= 0 && ca.indexOf("callRpc('scan'") >= 0, msg: '自愈经共享 store 的根 + scan RPC（不引用 GitPanelMain 的 doScan 局部函数）' })
    checks.push({ ok: /rescanAllowed\s*=\s*false/.test(ca), msg: '「重扫+重试」配额一次性，防递归死循环' })
    const st = readFileSync(join(ROOT, 'src/client/store.js'), 'utf8')
    checks.push({ ok: st.indexOf('wsRoot') >= 0, msg: 'store 携带 wsRoot 字段' })
    const gm = readFileSync(join(ROOT, 'src/client/components/GitPanelMain.js'), 'utf8')
    checks.push({ ok: gm.indexOf('wsRoot: wsPath') >= 0 || gm.indexOf('{ ...st, wsRoot: wsPath }') >= 0, msg: 'GitPanelMain 把当前工作区根写进 store' })
    scenario('6 Client 自愈接线守卫（token 级）', checks)
  }
} finally {
  process.env.USERPROFILE = prevUserProfile
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome
  rmSync(tempRoot, { recursive: true, force: true })
}

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 生成口径（无暂存回退 + staged 旧口径 + 仓库缺失自愈）：${results.length} 个场景全部通过`
  : `✗ 生成口径：${failed.length}/${results.length} 个场景失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)