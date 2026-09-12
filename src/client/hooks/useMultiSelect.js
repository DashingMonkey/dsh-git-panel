/** 文件列表多选状态机（Ctrl/⌘ 增删、Shift 范围，按仓库隔离）。 */
import React from 'react'
import { rowKey } from '../lib/util.js'
// 文件列表多选状态机（Ctrl/⌘ 增删、Shift 范围，按 'group\u0000path' 键、按仓库隔离）：
// 普通点击 = 单选激活行（打开/关闭 diff）并清空多选；Shift 以锚点（或激活行）为
// 起点按可见顺序取范围；修饰键点击不切换 diff（多选只为批量操作服务）。
// status 刷新后自动剪掉已消失的选中项（移组/放弃后），锚点失效则重置。
function useMultiSelect(data, groupsOpen, activeKey, onOpenRow) {
  const [selKeys, setSelKeys] = React.useState(() => new Set())
  const anchorRef = React.useRef(null)
  // 可见的扁平顺序（staged → unstaged → untracked，收起的组跳过）：Shift 范围选择按它取区间。
  // 冲突行不在其中：它不参与多选（未合并路径的批量放弃语义不明，见 onRowClick）
  const flatKeys = React.useMemo(() => {
    const out = []
    if (data) {
      for (const g of ['staged', 'unstaged', 'untracked']) {
        if (groupsOpen[g] === false) continue
        for (const f of data[g] || []) out.push(rowKey(g, f.path))
      }
    }
    return out
  }, [data, groupsOpen])
  // 剪枝按「全部行」（含收起组）校验：收起组里的选中项仍是有效文件，不应被误剪
  React.useEffect(() => {
    if (!data) return
    const valid = new Set((() => {
      const out = []
      for (const g of ['staged', 'unstaged', 'untracked']) for (const f of data[g] || []) out.push(rowKey(g, f.path))
      return out
    })())
    setSelKeys((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set()
      for (const k of prev) { if (valid.has(k)) next.add(k); else changed = true }
      return changed ? next : prev
    })
    if (anchorRef.current && !valid.has(anchorRef.current)) anchorRef.current = null
    // 依赖有意只挂 data：剪枝只随 status 数据变化（groupsOpen 等读取即可，不必重跑）
  }, [data])
  // 文件行点击：普通 = 单选并打开/关闭 diff（同一行再次点击 = 取消选中并关闭抽屉）；
  // Ctrl/⌘ = 增删多选；Shift = 锚点到当前行的范围多选。修饰键点击阻止原生文本
  // 选区/焦点抢占（Shift 框选会带出蓝色选区，在 renderGroup 的 onMouseDown 处理）
  const onRowClick = (e, f, group) => {
    const key = rowKey(group, f.path)
    // 冲突行不参与多选：批量放弃对未合并路径没有确定语义（批量暂存才是「全部标记
    // 已解决」，已由分组标题的 ＋ 提供），避免选中后静默无效的假状态。
    // 修饰键下也不切抽屉——其余分组的 Ctrl/⌘/Shift 点击只做多选、不动抽屉，这里保持一致
    if (group === 'conflicted') {
      setSelKeys(new Set())
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) onOpenRow(f, group)
      return
    }
    if (e.shiftKey) {
      let from = anchorRef.current != null && flatKeys.indexOf(anchorRef.current) >= 0 ? anchorRef.current
        : (activeKey != null && flatKeys.indexOf(activeKey) >= 0 ? activeKey : key)
      const i = flatKeys.indexOf(from)
      const j = flatKeys.indexOf(key)
      if (i >= 0 && j >= 0) setSelKeys(new Set(flatKeys.slice(Math.min(i, j), Math.max(i, j) + 1)))
      else setSelKeys(new Set([key]))
      return
    }
    anchorRef.current = key
    if (e.ctrlKey || e.metaKey) {
      setSelKeys((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
      return
    }
    setSelKeys(new Set())
    onOpenRow(f, group)
  }
  // 多选分区：unstage 仅对 staged；stage 对 unstaged+untracked；放弃须按组分别调用
  const selParts = React.useMemo(() => {
    const byGroup = { staged: [], unstaged: [], untracked: [] }
    if (data) {
      for (const g of ['staged', 'unstaged', 'untracked']) {
        const map = new Map((data[g] || []).map((f) => [rowKey(g, f.path), f.path]))
        for (const k of selKeys) { const p = map.get(k); if (p != null) byGroup[g].push(p) }
      }
    }
    return byGroup
  }, [selKeys, data])
  const selCount = selParts.staged.length + selParts.unstaged.length + selParts.untracked.length
  return { selKeys, setSelKeys, flatKeys, onRowClick, selParts, selCount }
}
export { useMultiSelect }
