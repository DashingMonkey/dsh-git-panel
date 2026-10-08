/**
 * 行为回归：提交规则的两目录解析（src/host.js 的 profile 规则目录 ↔ 老共享目录）。
 *
 * 背景（本次故障的根因）：桌面版把数据目录换到 profile 下（<profile>/git-panel/）之后，
 * profile 化之前落在 %USERPROFILE%\.dsh\git-panel\rules 的老规则文件从未被搬过来，于是
 * 「切到仓库专属规则」读到的只是新目录里以全局默认创建的副本——看着就像没加载对应文件。
 * 本测试把这一整套语义钉死：
 *   1) 老目录里缺失的规则在首次 scan 时补进本 profile；
 *   2) profile 侧被「未经编辑的内置默认」占位时，用老目录的自定义版替换（全局/仓库各自判据）；
 *   3) 与全局默认逐字相同的仓库文件副本（种子）让位给老目录里真正定制过的那份；
 *   4) 两个目录都已定制 → 本 profile 优先，老目录不被覆盖；
 *   5) 保存写回读到的那个目录（就地覆写，不留影子副本）；重置清掉两边；
 *   6) web 形态（两目录同一路径）行为完全不变；
 *   7) 导入通道失效时 scan 仍成功，读取靠回退仍可用。
 *
 * 跑法：完全在临时目录里（USERPROFILE 与 settings.prepareDocument 都指向临时根），真实的
 * ~/.dsh 与 profile 目录不会被读或写。npm test 一部分；非 0 退出 = 失败。
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { dirname as upDir, join as upJoin } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = upJoin(upDir(fileURLToPath(import.meta.url)), '..')
const HOST_URL = pathToFileURL(upJoin(ROOT, 'src', 'host.js')).href

const results = []
// ⚠ 只上报**失败**的断言：不过滤的话全绿场景也会把每条断言都印出来，看着像全挂
//（本文件第一版就踩过这个坑——输出里「期望 X，实际 X」全部相等却标着 ✗）。
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

// 自建规则 fixture：parseRulesYaml 是极简块标量解析，两个键都必须有非空内容才过 validateRules
const ruleYaml = (marker) =>
  'system_prompt: |\n  S-' + marker + '\n\nuser_context: |\n  U-' + marker + '\n'
const markerOf = (text) => {
  const m = /S-([A-Za-z0-9-]+)/.exec(String(text || ''))
  return m ? m[1] : ''
}

// ---- 临时环境：tempRoot/{.dsh/git-panel/rules, .dsh/profiles/desktop/git-panel/rules} ----
// USERPROFILE 必须是「家目录」而不是 .dsh 本身——sharedRulesDir() 会自己拼 .dsh
//（写错的话老目录变成 <USERPROFILE>\.dsh\.dsh\git-panel\rules，导入永远找不到来源）。
const tempRoot = mkdtempSync(join(tmpdir(), 'git-panel-rules-'))
const sharedDir = join(tempRoot, '.dsh', 'git-panel', 'rules')
const homeDir = join(tempRoot, '.dsh', 'profiles', 'desktop') // settings.prepareDocument 所在目录
const profileDir = join(homeDir, 'git-panel', 'rules')
const prevUserProfile = process.env.USERPROFILE
const prevHome = process.env.HOME
process.env.USERPROFILE = tempRoot
delete process.env.HOME

// 仓库路径用 realpath：Host 的 repo.path 由 fs.processPath 摊平（Windows 上是反斜杠绝对路径），
// 而 {name}-{pathHash8(path)}.yaml 这个文件名对分隔符形态敏感，两边必须逐字一致。
const wsDir = join(tempRoot, 'ws')
mkdirSync(join(wsDir, 'proj', '.git'), { recursive: true })
const REPO = { id: 'proj', name: 'proj', path: join(wsDir, 'proj') }

const sanitizeName = (name) => String(name || 'repo').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)
const normPathKey = (p) => {
  let s = String(p || '').trim().replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1).replace(/\//g, '\\')
  return s
}
const pathHash8 = (p) => {
  let h = 0x811c9dc5
  const s = String(p)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return ('0000000' + h.toString(16)).slice(-8)
}
const REPO_FILE = sanitizeName(REPO.name) + '-' + pathHash8(normPathKey(REPO.path.split('/').join(sep))) + '.yaml'

/** 每个场景起一个全新的 host 实例（内部闭包各自独立，导入单例也各算一次） */
async function startHost(opts) {
  opts = opts || {}
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
      if (opts.breakListDir && p.includes(opts.breakListDir)) throw new Error('probe: listDir broken')
      return readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file', target: { __p: join(p, d.name) } }))
    }
  }
  let routeHandler = null
  const services = {
    fs: fsSvc,
    // host.js 的两条写盘回退（writeTextAnywhere / removeFileAnywhere）都走 subprocess
    // 直写脚本（fs 服务被拒时的兜底路径）；测试里**真跑这条脚本**，否则删除/写入永远
    // 静默失败，重置类断言会得到「删了还在」的假失败。
    subprocess: {
      spawn(o) {
        try {
          execFileSync(o.argv[0], o.argv.slice(1), { input: o.stdin || '', stdio: ['pipe', 'pipe', 'pipe'] })
          return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: { stdout: '', stderr: '' }, terminate() {} }
        } catch (e) {
          return { done: Promise.resolve({ exitCode: e.status === undefined ? 1 : e.status, signal: null }), collected: { stdout: '', stderr: '' }, terminate() {} }
        }
      }
    },
    settings: opts.noSettings ? null : { async prepareDocument() { return join(homeDir, 'settings.json') } },
    webServer: { register(r) { routeHandler = r.handler; return () => {} } },
    connection: { requestRejection() { return undefined } },
    timer: { timeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) } }
  }
  const ctx = { get: (k) => services[k], effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} }, inject: () => {}, on: () => {} }
  mod.default().apply(ctx, {})
  // 协议信封 { ok:true, value:{...} } / { ok:false, error:{code,message} } 按 client/api.js 的
  // unwrapRpc 同一口径摊平——测试里读到就是业务字段（与面板组件看到的形状一致）。
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
  const scan = async () => {
    const r = await rpc('scan', { root: REPO.path, force: true })
    if (!r.ok) throw new Error('scan failed: ' + r.error)
    return r
  }
  return { rpc, scan }
}

// 每个场景都要清干净：规则文件之外，git-repos.json（ruleScope 偏好，权威配置）与
// scan-cache.json 也在 profile 数据目录里——上一场景写的 ruleScope='repo' 会漏到下一场景，
// 让「无偏好时按文件存在性推断」的断言失真（本文件第一版就在这上面翻过车）。
const resetDirs = () => {
  rmSync(join(homeDir, 'git-panel'), { recursive: true, force: true })
  rmSync(sharedDir, { recursive: true, force: true })
}
const seedShared = (files) => { mkdirSync(sharedDir, { recursive: true }); for (const [n, c] of Object.entries(files)) writeFileSync(join(sharedDir, n), c, 'utf8') }
const seedProfile = (files) => { mkdirSync(profileDir, { recursive: true }); for (const [n, c] of Object.entries(files)) writeFileSync(join(profileDir, n), c, 'utf8') }
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const listYaml = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort() : [])

const scenarios = []
const run = (name, fn) => scenarios.push([name, fn])

try {
  // 前置：空环境跑一次，取回「未经编辑的内置默认」原文 + Host 计算出的仓库规则文件名
  resetDirs()
  const boot = await startHost()
  await boot.scan()
  const pristineDefault = readIf(join(profileDir, 'default.yaml'))
  if (!pristineDefault) throw new Error('无法取得内置默认规则原文（ensureDefaultRules 没建 default.yaml）')
  const bootGet = await boot.rpc('rulesGet', { repoId: REPO.id })
  const repoFile = String(bootGet.repoPath || '').split(/[\\/]/).pop()
  if (!repoFile) throw new Error('拿不到 Host 计算的仓库规则文件名')
  // 自算的名字只用于「Host 与测试是否对同一路径哈希」的对账；两者不一致时测试没有意义
  if (repoFile !== REPO_FILE) {
    throw new Error('Host 计算的仓库规则文件名与本文件复刻的算法不一致：Host=' + repoFile + ' 测试=' + REPO_FILE + '（repo.path=' + REPO.path + '）')
  }

  // 1) 老目录里的自定义规则（全局 + 仓库专属）在首次 scan 时补进本 profile，且读到的就是它
  run('1 老目录规则一次性导入并生效', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    const h = await startHost()
    await h.scan()
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(v.ok, true, 'rulesGet ok'),
      eq(markerOf(v.repoYaml), 'shared-repo', '仓库专属规则内容来自老目录'),
      eq(v.effective.source, 'repo', '生效来源（老目录有仓库文件即视为已定制）'),
      eq(v.repoRulePath, join(profileDir, repoFile), '导入后就地读 profile 目录副本'),
      eq(readIf(join(sharedDir, repoFile)) !== null, true, '老目录原文件保留')
    ]
  })

  // 2) 全局默认被「未经编辑的内置默认」占位 → 用老目录的自定义版替换（严格模式）
  run('2 全局默认：内置默认占位 → 用老目录自定义版替换', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global') })
    seedProfile({ 'default.yaml': pristineDefault })
    const h = await startHost()
    await h.scan()
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(markerOf(v.defaultYaml), 'shared-global', 'defaultYaml 取到老目录的自定义版'),
      eq(markerOf(readIf(join(profileDir, 'default.yaml'))), 'shared-global', 'profile 的 default.yaml 被替换')
    ]
  })

  // 3) 与全局默认逐字相同的仓库文件副本（种子）让位给老目录里真正定制过的那份。
  //    刻意把老目录的仓库文件放在 scan 之后写入——让「种子让位」这条读取规则单独承压
  //    （导入这一刻已经跑完，只有读取顺序能把它翻出来）
  run('3 种子副本让位（读取规则，不依赖导入）', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global') })
    seedProfile({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-global') })
    const h = await startHost()
    await h.scan()
    writeFileSync(join(sharedDir, repoFile), ruleYaml('late-custom'), 'utf8')
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(markerOf(v.repoYaml), 'late-custom', '读到老目录那份（种子让位）'),
      eq(v.repoRulePath, join(sharedDir, repoFile), '读取路径指向老目录那份'),
      eq(v.repoRuleSavePath, join(sharedDir, repoFile), '保存目标跟随读取路径')
    ]
  })

  // 4) 两个目录都已定制且不同 → 本 profile 优先，老目录不被覆盖
  run('4 两边都已定制：profile 优先', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    seedProfile({ 'default.yaml': ruleYaml('profile-global'), [repoFile]: ruleYaml('profile-repo') })
    const h = await startHost()
    await h.scan()
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(markerOf(v.repoYaml), 'profile-repo', 'profile 那份优先'),
      eq(readIf(join(sharedDir, repoFile)) !== null, true, '老目录文件仍在'),
      eq(markerOf(readIf(join(sharedDir, repoFile))), 'shared-repo', '老目录未被覆盖'),
      eq(markerOf(v.defaultYaml), 'profile-global', '全局默认同样 profile 优先')
    ]
  })

  // 5) 保存写回读到的那个目录：profile 已有 → 覆写 profile；只有老目录有 → 写老目录
  run('5 保存写回读取来源', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    seedProfile({ 'default.yaml': ruleYaml('profile-global'), [repoFile]: ruleYaml('profile-repo') })
    const h = await startHost()
    await h.scan()
    const saveProfile = await h.rpc('rulesSave', { repoId: REPO.id, scope: 'repo', yaml: ruleYaml('edited-profile') })
    const afterProfile = [markerOf(readIf(join(profileDir, repoFile))), markerOf(readIf(join(sharedDir, repoFile)))]

    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    const h2 = await startHost()
    await h2.scan()
    const saveShared = await h2.rpc('rulesSave', { repoId: REPO.id, scope: 'repo', yaml: ruleYaml('edited-shared') })
    const afterShared = [markerOf(readIf(join(profileDir, repoFile))), markerOf(readIf(join(sharedDir, repoFile)))]
    return [
      eq(saveProfile.ok, true, '第一次保存 ok'),
      eq(afterProfile[0], 'edited-profile', '覆写 profile 那份'),
      eq(afterProfile[1], 'shared-repo', '老目录那份不动'),
      eq(saveShared.ok, true, '第二次保存 ok'),
      // 老目录那份已被导入 profile，因此读到的是 profile 副本，保存也就写回 profile：
      // 目的是「不留影子副本」，不是「必须写老目录」——老目录原文保持只读。
      eq(afterShared[0], 'edited-shared', '写入导入后的 profile 副本'),
      eq(afterShared[1], 'shared-repo', '老目录原文不被改写')
    ]
  })

  // 6) 重置仓库专属：两个目录都清掉，否则读取回退还会读到老目录那份
  run('6 重置仓库专属清两个目录', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    const h = await startHost()
    await h.scan()
    const before = [readIf(join(profileDir, repoFile)) !== null, readIf(join(sharedDir, repoFile)) !== null]
    const r = await h.rpc('rulesReset', { repoId: REPO.id, scope: 'repo' })
    const after = [readIf(join(profileDir, repoFile)) !== null, readIf(join(sharedDir, repoFile)) !== null]
    const g = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(before[0] && before[1], true, '重置前两份都在'),
      eq(r.ok, true, '重置 ok'),
      eq(after[0] || after[1], false, '重置后两份都不在'),
      eq(g.repoRuleExists, false, '重置后不再报「仓库规则存在」'),
      eq(g.effective.source, 'global', '重置后回退全局')
    ]
  })

  // 7) web 形态：没有 settings 服务 → profile 目录与老目录同一路径，无导入、无回退
  run('7 web 形态（两目录同路径）保持不变', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('web-global'), [repoFile]: ruleYaml('web-repo') })
    const h = await startHost({ noSettings: true })
    await h.scan()
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(v.ok, true, 'rulesGet ok'),
      eq(markerOf(v.repoYaml), 'web-repo', '读到同一目录里的仓库规则'),
      eq(markerOf(v.defaultYaml), 'web-global', '读到同一目录里的全局默认'),
      eq(listYaml(sharedDir).length, 2, '没有产生多余文件: ' + JSON.stringify(listYaml(sharedDir))),
      eq(v.repoRulePath, join(sharedDir, repoFile), '读取路径就是该目录'),
      eq(v.repoRuleSavePath, v.repoRulePath, '保存目标与读取一致')
    ]
  })

  // 8) 导入通道失效（共享目录列不出来）→ scan/读取都不受影响：逐文件回退不依赖目录列举，
  //    老规则照样读到（这一条正是「按目录选权威」写法会挂掉的地方）
  run('8 共享目录列举失败时仍靠逐文件回退读到老规则', async () => {
    resetDirs()
    seedShared({ 'default.yaml': ruleYaml('shared-global'), [repoFile]: ruleYaml('shared-repo') })
    const h = await startHost({ breakListDir: sharedDir })
    const s = await h.scan()
    const v = await h.rpc('rulesGet', { repoId: REPO.id })
    return [
      eq(s.ok, true, 'scan 仍成功'),
      eq(s.count, 1, '仓库仍被发现'),
      eq(v.ok, true, 'rulesGet 仍成功'),
      eq(markerOf(v.repoYaml), 'shared-repo', '逐文件回退直接读到老目录那份'),
      eq(v.repoRulePath, join(sharedDir, repoFile), '读取路径指向老目录'),
      eq(listYaml(profileDir).includes(repoFile), false, '仓库规则未经导入（列不出共享目录），只在老目录: ' + JSON.stringify(listYaml(profileDir)))
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
  ? `✓ 规则目录解析：${results.length} 个场景全部通过`
  : `✗ 规则目录解析：${failed.length}/${results.length} 个场景失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)
