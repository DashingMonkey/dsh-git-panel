/** 历史图谱纯算法：lane 计算/循环配色（computeGraph / laneColor）与 %D refs 解析（parseRefs）。 */
// 简易 lane 图算法：按行计算提交所在的 lane、合并连线与活跃 lane 区间
function computeGraph(entries) {
  const laneTips = new Map()
  const laneSince = []
  const laneLast = []
  const laneOpen = []
  const freeLanes = []
  const rowLane = []
  const rowMerge = []
  const rowActive = []
  let maxLane = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const merges = []
    const pending = laneTips.get(e.hash)
    let lane
    if (pending !== undefined && pending.length > 0) {
      lane = pending[0]
      laneTips.delete(e.hash)
      laneLast[lane] = i
      // 其余等待同一提交的 lane 在本行汇合（画水平连线后终止）
      for (let k = 1; k < pending.length; k++) {
        const j = pending[k]
        laneLast[j] = i
        laneOpen[j] = false
        freeLanes.push(j)
        merges.push(j)
      }
    } else {
      lane = freeLanes.length > 0 ? freeLanes.pop() : laneSince.length
      if (lane === laneSince.length) { laneSince.push(i); laneLast.push(i); laneOpen.push(false) }
      else { laneSince[lane] = i; laneLast[lane] = i }
    }
    rowLane[i] = lane
    if (lane > maxLane) maxLane = lane
    const parents = e.parents || []
    if (parents.length > 0) {
      laneOpen[lane] = true
      for (let p = 0; p < parents.length; p++) {
        const ph = parents[p]
        const lst = laneTips.get(ph)
        if (lst !== undefined) {
          if (p === 0) {
            // 第一父提交已被其他 lane 挂起：本 lane 作为 joiner 一起等它（到父提交行汇合）
            lst.push(lane)
            laneTips.set(ph, lst)
          } else {
            merges.push(lst[0])
          }
        } else if (p === 0) {
          laneTips.set(ph, [lane])
        } else {
          let pl = freeLanes.length > 0 ? freeLanes.pop() : laneSince.length
          if (pl === laneSince.length) { laneSince.push(i); laneLast.push(-1); laneOpen.push(true) }
          else { laneSince[pl] = i; laneLast[pl] = -1; laneOpen[pl] = true }
          if (pl > maxLane) maxLane = pl
          laneTips.set(ph, [pl])
          merges.push(pl)
        }
      }
    } else {
      laneOpen[lane] = false
      freeLanes.push(lane)
    }
    rowMerge[i] = merges
    const active = []
    for (let l = 0; l < laneSince.length; l++) {
      if (laneSince[l] <= i && (laneOpen[l] || laneLast[l] >= i)) active.push(l)
    }
    rowActive[i] = active
  }
  // maxLane 不设上限：向下滚动追加数据出现更多 lane 时，图形宽度随之动态增长
  return { rowLane, rowMerge, rowActive, maxLane, laneSince, laneLast }
}

// lane 循环配色：按 lane 序号取色，多分支时颜色循环复用
const LANE_COLORS = ['#00bcf2', '#2d8844', '#ec5a5a', '#b18e35', '#8f4b8f', '#4ec9b0', '#e2a33d', '#d16ba5']
const laneColor = (l) => LANE_COLORS[l % LANE_COLORS.length]

// 解析 %D refs 装饰：区分当前分支/本地分支/远程分支/tag；origin/HEAD 为符号引用，始终隐藏。
// host 以 --decorate=full 输出完整 refname（refs/heads/、refs/remotes/、refs/tags/），
// 必须按前缀分类——本地分支名可以含 '/'（如 backup/pre-msg-rewrite），
// 「名字带斜杠 = 远程分支」的启发式会把它误判成远程分支（与 VS Code _resolveHistoryItemRefs 同策略）。
// 兼容旧短名格式（无 refs/ 前缀）：tag: 前缀之外仍按带斜杠启发式兜底。
function parseRefs(refsStr) {
  const out = { current: '', branches: [], remotes: [], tags: [] }
  const push = (kind, n) => { if (n && out[kind].indexOf(n) < 0) out[kind].push(n) }
  String(refsStr || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((r) => {
    const m = r.match(/^HEAD -> (.+)$/)
    const name = m ? m[1] : r
    if (name === 'HEAD' || name === 'origin/HEAD' || name === 'refs/remotes/origin/HEAD') return
    if (name.lastIndexOf('tag: ', 0) === 0) { push('tags', name.slice(5).replace(/^refs\/tags\//, '')); return }
    if (name.lastIndexOf('refs/heads/', 0) === 0) {
      if (m) out.current = name.slice(11)
      else push('branches', name.slice(11))
      return
    }
    if (name.lastIndexOf('refs/remotes/', 0) === 0) { push('remotes', name.slice(13)); return }
    if (name.lastIndexOf('refs/tags/', 0) === 0) { push('tags', name.slice(10)); return }
    // 旧短名格式兜底
    if (m) { out.current = name; return }
    if (name.indexOf('/') >= 0) push('remotes', name)
    else push('branches', name)
  })
  return out
}
export { computeGraph, laneColor, parseRefs }
