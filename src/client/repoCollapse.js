/**
 * 多仓库工作区的「折叠状态记忆」：每张仓库卡片的整卡折叠（isCollapsed）与四个分组
 * 展开态（groupsOpen）按**仓库绝对路径**持久在 localStorage（单键 gp-repo-collapse，
 * 结构 {version:1, order:[路径…], data:{路径→记录}}，LRU 上限 50 条，与 messageDraft
 * 的容量口径一致）。
 *
 * 为什么需要它：单一工作区发现多枚仓库时，用户习惯把常看的展开、其余收着；卡片一旦
 * 卸载重挂（切换工作区/会话触发重扫、整卡折叠时 body 整棵为 null、模式切换导致面板
 * 重挂载），这些排版全部丢失，每次都得重新摆一遍。提交信息草稿（messageDraft.js）
 * 已按路径记过一轮，本模块是同一思路的第二批持久状态。
 *
 * 取舍：
 *   - 只存布尔与展开开关，无敏感内容；放 localStorage 而非纯内存，整页刷新甚至
 *     重启后仍保留（与 store.js 的面板偏好同通道）；
 *   - 数据畸形（坏 JSON / 形状不符 / 版本不对）一律按「无记忆」处理，绝不抛错；
 *   - 写入失败（隐私模式、空间不足）静默，内存里的排版仍在；
 *   - 超过 50 个仓库按最久未动者淘汰，防无界增长。
 */

const LS_KEY = 'gp-repo-collapse'
const MAX_REPOS = 50
// 分组白名单：只有这四组有展开开关，其余键读写时一律丢弃（防脏数据复活）
const GROUP_KEYS = ['conflicted', 'staged', 'unstaged', 'untracked']

function defaultGroups() {
  const g = {}
  for (const k of GROUP_KEYS) g[k] = true
  return g
}

function lsGet() {
  try { return window.localStorage.getItem(LS_KEY) } catch (e) { return null }
}
function lsSet(s) {
  try { window.localStorage.setItem(LS_KEY, s) } catch (e) { /* 空间不足/隐私模式：静默 */ }
}

// 单条记录归一：collapsed 只有严格为 true 才算折叠；groups 按白名单取布尔，
// 缺失或非显式 false 一律按「展开」补默认（= 现状缺省）
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { collapsed: false, groups: defaultGroups() }
  const groups = defaultGroups()
  const rg = raw.groups
  if (rg && typeof rg === 'object' && !Array.isArray(rg)) {
    for (const k of GROUP_KEYS) if (rg[k] === false) groups[k] = false
  }
  return { collapsed: raw.collapsed === true, groups }
}

// 整表读盘：结构不符（含版本演进后的旧格式）按空表处理，返回 null 由调用方重建
function loadStore() {
  const raw = lsGet()
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    if (!j || typeof j !== 'object' || j.version !== 1 || !Array.isArray(j.order) || !j.data || typeof j.data !== 'object' || Array.isArray(j.data)) return null
    return j
  } catch (e) { return null }
}

// 读某仓库的折叠记忆：无记录/坏数据 → 默认全展开
export function getRepoCollapse(repoPath) {
  const s = loadStore()
  if (!s) return normalizeEntry(null)
  return normalizeEntry(s.data[repoPath])
}

// 写某仓库的折叠记忆：move-to-front 刷新鲜度 → 超上限按队尾淘汰最旧 → 落盘。
// entry 由调用方给全量（RepoCard 的 effect 把两个 state 原样打包），缺省段由归一补上。
export function setRepoCollapse(repoPath, entry) {
  const cur = normalizeEntry(entry)
  if (!repoPath) return
  let s = loadStore()
  if (!s) s = { version: 1, order: [], data: {} }
  const i = s.order.indexOf(repoPath)
  if (i >= 0) s.order.splice(i, 1)
  s.order.unshift(repoPath)
  s.data[repoPath] = cur
  while (s.order.length > MAX_REPOS) {
    const old = s.order.pop()
    delete s.data[old]
  }
  lsSet(JSON.stringify(s))
}

export { LS_KEY as STORAGE_KEY }