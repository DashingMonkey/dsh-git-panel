/** 历史区可变行高虚拟滚动（前缀和 + 二分定位 + 触底分页）。 */
import React from 'react'
// 可变行高虚拟滚动（历史区）：普通行高 ROWH，展开行 = ROWH + 文件列表高度
//（loading/错误/空 = 一行提示的高度，文件列表载入前后不同，靠 filesVer 触发重算）。
// tops 为前缀和（tops[i] = 第 i 行纵坐标，tops[len] = 内容总高），供绝对定位与
// 二分定位；syncWindow 用二分框出可视窗口（±15 行 overscan）并兼做触底分页。
function useVariableRows(entries, expandedIdx, filesCache, filesVer, listRef, stateRef, loadPage, ROWH, FILEH, MAXVIS) {
  const heights = React.useMemo(() => {
    const hs = new Array(entries.length)
    for (let i = 0; i < entries.length; i++) {
      if (i !== expandedIdx) { hs[i] = ROWH; continue }
      const d = filesCache.current.get(entries[i].hash)
      const n = !d || d.loading || d.error || !d.files ? 1 : Math.min(d.files.length, MAXVIS)
      hs[i] = ROWH + n * FILEH + 8
    }
    return hs
  }, [entries, expandedIdx, filesVer])
  const tops = React.useMemo(() => {
    const t = new Array(entries.length + 1)
    t[0] = 0
    for (let i = 0; i < entries.length; i++) t[i + 1] = t[i] + (heights[i] || ROWH)
    return t
  }, [heights])
  const topsRef = React.useRef(tops)
  topsRef.current = tops
  const [win, setWin] = React.useState({ first: 0, last: 40 })
  const syncWindow = React.useCallback(() => {
    const el = listRef.current
    if (!el) return
    const t = topsRef.current
    const len = stateRef.current.entries.length
    // 二分找首个「底边超过滚动位置」的行（含跨过视口顶端的行），再留 15 行 overscan
    let lo = 0, hi = len
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid + 1] > el.scrollTop) hi = mid; else lo = mid + 1 }
    const first = Math.max(0, lo - 15)
    // 二分找首个「顶边到达视口底」的行（不含），再留 15 行 overscan
    const y2 = el.scrollTop + el.clientHeight
    lo = 0; hi = len
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] >= y2) hi = mid; else lo = mid + 1 }
    const last = Math.min(len, lo + 15)
    setWin((w) => (w.first === first && w.last === last ? w : { first, last }))
    if (stateRef.current.hasMore && !stateRef.current.loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 800) {
      loadPage(stateRef.current.entries.length, true)
    }
  }, [loadPage])
  return { heights, tops, win, syncWindow }
}
export { useVariableRows }
