/**
 * 行为回归：多仓库折叠状态记忆（repoCollapse.js）。
 *
 * localStorage 用假实现垫片（模块在调用时才读 window，不必在 import 前垫——
 * 但仍先垫后动态 import，保证任何顺序下都拿到垫片）。覆盖：
 *   A) 无记忆缺省：首次读取 = 全展开 + 整卡未折；
 *   B) 往返一致：写入的条目读回逐字相同（含显式 false 与 true 区分）；
 *   C) 部分分组写入：缺失组按「展开」补默认，不残留旧值；
 *   D) 坏数据降级：损坏 JSON / 非对象 / 版本不符 / 记录非对象 → 一律按无记忆，且不抛错；
 *   E) LRU 淘汰：超过 50 个仓库，最久未动的被淘汰（解析落盘 JSON 验证 order/data）；
 *   F) move-to-front：重复写同一路径会刷新新鲜度到队首；
 *   G) 白名单：脏分组键读写时被丢弃，不复活。
 *   H) wiring 守卫（token 级）+ 构建产物防漂移。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

// ---- 假 localStorage（先垫片再动态 import，避免 ESM 提升把垫片排到 import 之后）----
class FakeLS {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
const ls = new FakeLS()
globalThis.window = { localStorage: ls }
const { getRepoCollapse, setRepoCollapse, STORAGE_KEY } = await import(new URL('../src/client/repoCollapse.js', import.meta.url))

const P = (i) => '/ws/repo-' + i
const readStored = () => { const raw = ls.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null }
const allTrueGroups = () => ({ conflicted: true, staged: true, unstaged: true, untracked: true })

try {
  // ---- A) 无记忆缺省 ----
  {
    const got = getRepoCollapse('/ws/none')
    scenario('A 无记忆缺省', [
      eq(got.collapsed, false, '整卡未折'),
      eq(JSON.stringify(got.groups), JSON.stringify(allTrueGroups()), '四组全展开（现状缺省）')
    ])
  }

  // ---- B) 往返一致 ----
  {
    setRepoCollapse(P(1), { collapsed: true, groups: { conflicted: true, staged: false, unstaged: true, untracked: false } })
    const got = getRepoCollapse(P(1))
    scenario('B 往返一致', [
      eq(got.collapsed, true, '折叠态还原'),
      eq(got.groups.staged, false, '显式 false 的组保持收起'),
      eq(got.groups.untracked, false, '另一显式 false 组保持收起'),
      eq(got.groups.conflicted, true, '显式 true 保持展开')
    ])
  }

  // ---- C) 部分分组写入补默认 ----
  {
    setRepoCollapse(P(2), { collapsed: false, groups: { conflicted: false } })
    const got = getRepoCollapse(P(2))
    scenario('C 部分分组写入按「展开」补默认', [
      eq(got.groups.conflicted, false, '给出的组精确还原'),
      eq(got.groups.staged, true, '缺失组补展开（不残留上一次的 false）'),
      eq(got.groups.untracked, true, '另一缺失组同口径')
    ])
  }

  // ---- D) 坏数据降级 ----
  {
    ls.removeItem(STORAGE_KEY)
    let a, b, c, d
    let threw = false
    try {
      ls.setItem(STORAGE_KEY, '{ not json !!!')
      a = getRepoCollapse(P(3))
      ls.setItem(STORAGE_KEY, '"just a string"')
      b = getRepoCollapse(P(3))
      ls.setItem(STORAGE_KEY, JSON.stringify({ version: 2, order: [], data: {} }))
      c = getRepoCollapse(P(3))
      ls.setItem(STORAGE_KEY, JSON.stringify({ version: 1, order: [], data: { [P(3)]: { collapsed: 'yes', groups: 'nope' } } }))
      d = getRepoCollapse(P(3))
      threw = false
    } catch (e) { threw = true }
    scenario('D 坏数据一律按无记忆且不抛错', [
      eq(threw, false, '四种坏输入均未抛出'),
      eq(a.collapsed, false, '坏 JSON → 默认未折'),
      eq(b.collapsed, false, '非对象 → 默认未折'),
      eq(c.collapsed, false, '版本不符 → 默认未折'),
      eq(d.collapsed, false, '记录形状坏 → 默认未折'),
      eq(d.groups.staged, true, '坏记录的分组按全展开兜底')
    ])
  }

  // ---- E) LRU 淘汰 ----
  {
    ls.removeItem(STORAGE_KEY)
    for (let i = 1; i <= 51; i++) setRepoCollapse(P(i), { collapsed: i % 2 === 0, groups: allTrueGroups() })
    setRepoCollapse(P(52), { collapsed: true, groups: allTrueGroups() })
    const st = readStored()
    scenario('E 超 50 个仓库淘汰最旧', [
      eq(st.order.length, 50, 'order 截到上限'),
      eq(st.data[P(1)], undefined, '最久未动的 repo-1 已被淘汰'),
      eq(st.data[P(52)].collapsed, true, '最新写入的 repo-52 在册且折叠态还原'),
      eq(st.order[0], P(52), '队首是最新写入')
    ])
  }

  // ---- F) move-to-front ----
  {
    ls.removeItem(STORAGE_KEY)
    setRepoCollapse(P(10), { collapsed: false, groups: allTrueGroups() })
    setRepoCollapse(P(11), { collapsed: true, groups: allTrueGroups() })
    setRepoCollapse(P(10), { collapsed: true, groups: allTrueGroups() })
    const st = readStored()
    scenario('F 重复写刷新新鲜度到队首', [
      eq(st.order[0], P(10), '两次写入的 repo-10 在队首'),
      eq(st.order.indexOf(P(10)) < st.order.indexOf(P(11)), true, '排在仅写一次的 repo-11 之前'),
      eq(st.order.length, 2, '共两条')
    ])
  }

  // ---- G) 白名单 ----
  {
    ls.removeItem(STORAGE_KEY)
    setRepoCollapse(P(20), { collapsed: false, groups: Object.assign(allTrueGroups(), { phantom: true, staged: false }) })
    const st = readStored()
    const got = getRepoCollapse(P(20))
    scenario('G 脏分组键不复活', [
      eq(st.data[P(20)].groups.phantom, undefined, '未知组 phantom 未落盘'),
      eq(got.groups.phantom, undefined, '读回也无脏键'),
      eq(got.groups.staged, false, '白名单内的显式 false 正常保留')
    ])
  }

  // ---- H) wiring 守卫 + 产物防漂移 ----
  {
    const checks = []
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/client/components/RepoCard/index.js', import.meta.url), 'utf8')
    const has = (needle, msg) => ({ ok: src.indexOf(needle) >= 0, msg })
    checks.push(has("from '../../repoCollapse.js'", 'RepoCard 导入 repoCollapse'))
    checks.push(has("React.useState(() => getRepoCollapse(repo.path).collapsed)", '整卡折叠懒初始化取自记忆'))
    checks.push(has("React.useState(() => getRepoCollapse(repo.path).groups)", '分组展开态懒初始化取自记忆'))
    checks.push({ ok: /setRepoCollapse\(repo\.path, \{ collapsed: !!isCollapsed, groups: groupsOpen \}\)/.test(src), msg: '唯一写出口：两个 state 变化即写回全量条目' })
    checks.push({ ok: src.indexOf('const [isCollapsed, setCollapsed] = React.useState(false)') < 0, msg: '旧的硬编码 useState(false) 初始化已移除（记忆接入前形态）' })

    const bundle = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    checks.push({ ok: bundle.indexOf('gp-repo-collapse') >= 0, msg: 'bundle 含折叠记忆的 localStorage 键' })
    scenario('H wiring 守卫 + 产物防漂移', checks)
  }
} finally {
  if (globalThis.window) delete globalThis.window.localStorage
}

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 折叠状态记忆（多仓库）：${results.length} 个场景全部通过`
  : `✗ 折叠状态记忆：${failed.length}/${results.length} 个场景失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)