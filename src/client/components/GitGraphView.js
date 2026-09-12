/** 历史区：SVG 图谱（lane 配色/圆角合并线）+ 行内展开文件列表 + 悬停详情浮层。 */
import React from 'react'
import { callRpc } from '../api.js'
import { tr } from '../i18n.js'
import { getTimer } from '../runtime.js'
import { useStore } from '../store.js'
import { icon } from '../icons.js'
import { computeGraph, laneColor, parseRefs } from '../lib/graph.js'
import { glyphOf, splitPath } from '../lib/util.js'
import { useVariableRows } from '../hooks/useVariableRows.js'
// 统计行：取 git --stat 汇总行原文（保留 git 的单复数措辞），insertions 段绿色、deletions 段红色
// 找不到汇总行（合并提交无统计 / git 输出本地化）时返回 null，该段不显示
function renderStatSummary(stat) {
  const line = String(stat || '').split('\n').map((l) => l.trim()).find((l) => /\d+\s+files?\s+changed/.test(l))
  if (!line) return null
  const parts = line.split(/(\d+\s+insertions?\(\+\)|\d+\s+deletions?\(-\))/g).filter((s) => s)
  return parts.map((seg, i) => {
    if (/insertions?\(\+\)/.test(seg)) return React.createElement('span', { key: i, className: 'gp-cd-add' }, seg)
    if (/deletions?\(-\)/.test(seg)) return React.createElement('span', { key: i, className: 'gp-cd-del' }, seg)
    return seg
  })
}

// 展开区内容：loading / 错误 / 空（合并提交）提示，或文件列表（点击复用 DiffDrawer）
function CommitFilesPanel({ e, repo, filesCache, diffSel, onOpenDiff }) {
  const d = filesCache.current.get(e.hash)
  if (!d || d.loading) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note' }, React.createElement('span', { className: 'gp-spinner' }), tr('loadingFiles'))
  if (d.error) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note gp-danger' }, d.error)
  if (d.files.length === 0) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note' }, tr('commitNoFiles'))
  return React.createElement('div', { className: 'gp-grow-files' },
    d.files.map((f) => {
      const gl = glyphOf(f.status, ' ')
      const { seg, dir } = splitPath(f.path)
      return React.createElement('div', {
        key: f.path, className: 'gp-gfile' + (diffSel && !diffSel.closing && diffSel.repoId === repo.id && diffSel.group === 'commit' && diffSel.hash === e.hash && diffSel.path === f.path ? ' gp-gfile-active' : ''),
        title: f.path + (f.oldPath ? '  ←  ' + f.oldPath : ''),
        onClick: (ev) => { ev.stopPropagation(); onOpenDiff(repo, { path: f.path, x: f.status, y: ' ', hash: e.hash, short: e.short, orig: f.oldPath || undefined }, 'commit') }
      },
        React.createElement('span', { className: 'gp-diff-glyph ' + gl.cls }, gl.g),
        React.createElement('span', { className: 'gp-gfile-name' }, seg),
        dir ? React.createElement('span', { className: 'gp-gfile-dir' }, dir) : null,
        f.oldPath ? React.createElement('span', { className: 'gp-gfile-orig', title: f.oldPath }, '← ' + (f.oldPath.replace(/\/+$/, '').split('/').pop() || f.oldPath)) : null,
        React.createElement('span', { className: 'gp-spacer' }),
        React.createElement('span', { className: 'gp-gfile-stats' },
          f.adds != null && f.adds > 0 ? React.createElement('span', { className: 'gp-gf-add' }, '+' + f.adds) : null,
          f.dels != null && f.dels > 0 ? React.createElement('span', { className: 'gp-gf-del' }, '−' + f.dels) : null))
    }))
}

// 悬停提交详情浮层：定位在行左侧（上下不越视口），可移入浮层内查看；
// 数据来自 detailCache（ensureDetail 懒加载，载入完成由 bumpHover 触发重渲染）
function CommitDetailPop({ hover, detailCache, onMouseEnter, onMouseLeave }) {
  const d = detailCache.current.get(hover.hash)
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
  const POPW = 480
  const POPH = Math.round(vh * 0.5)
  const left = Math.max(8, hover.left - POPW - 10)
  const top = Math.max(8, Math.min(hover.top - 8, vh - POPH - 12))
  const short = hover.short || String(hover.hash || '').slice(0, 7)
  let inner
  if (!d || d.loading) inner = React.createElement('div', { className: 'gp-empty' }, tr('loadingDetail'))
  else if (d.error) inner = React.createElement('div', { className: 'gp-empty' }, d.error)
  else {
    // message 全文原样展示：统一字号字重、保留空行与换行（不再单独加粗首行）；
    // markdown-lite：'- ' / '* ' 开头的行渲染为圆点列表项
    const msgLines = String(d.data.message || '').replace(/\r\n/g, '\n').split('\n')
    while (msgLines.length > 1 && msgLines[msgLines.length - 1].trim() === '') msgLines.pop()
    const msgEls = msgLines.map((ln, li) => {
      const bm = ln.match(/^(\s*)[-*]\s+(.*)$/)
      if (bm) return React.createElement('div', { key: li, className: 'gp-cd-li', style: { paddingLeft: Math.min(24, bm[1].replace(/\t/g, '    ').length * 6) } },
        React.createElement('span', { className: 'gp-cd-bullet' }, '•'),
        React.createElement('span', { className: 'gp-cd-li-text' }, bm[2]))
      if (ln.trim() === '') return React.createElement('div', { key: li, className: 'gp-cd-blank' })
      return React.createElement('div', { key: li, className: 'gp-cd-line' }, ln)
    })
    // refs pill：本地分支（含当前）=品牌色，远程=绿，tag=琥珀；仅该提交带 refs 时显示
    const refs = parseRefs(hover.refs)
    const refChips = []
    if (refs.current) refChips.push(React.createElement('span', { key: 'c', className: 'gp-cd-ref gp-cd-ref-cur' }, refs.current))
    refs.branches.forEach((b, bi) => refChips.push(React.createElement('span', { key: 'b' + bi, className: 'gp-cd-ref gp-cd-ref-local' }, b)))
    refs.remotes.forEach((r, ri) => refChips.push(React.createElement('span', { key: 'r' + ri, className: 'gp-cd-ref gp-cd-ref-remote' }, r)))
    refs.tags.forEach((t, ti) => refChips.push(React.createElement('span', { key: 't' + ti, className: 'gp-cd-ref gp-cd-ref-tag' }, t)))
    const statSum = renderStatSummary(d.data.stat)
    inner = React.createElement('div', null,
      React.createElement('div', { className: 'gp-cd-sec gp-cd-head' },
        React.createElement('span', { className: 'gp-cd-person' }, icon('person', 14)),
        React.createElement('span', { className: 'gp-cd-author' }, d.data.author),
        React.createElement('span', { className: 'gp-cd-date' }, (d.data.date || '').replace('T', ' ').slice(0, 16))),
      React.createElement('div', { className: 'gp-cd-sec gp-cd-msg' }, msgEls),
      statSum ? React.createElement('div', { className: 'gp-cd-sec gp-cd-sum' }, statSum) : null,
      refChips.length > 0 ? React.createElement('div', { className: 'gp-cd-sec gp-cd-refs' }, refChips) : null,
      React.createElement('div', { className: 'gp-cd-sec gp-cd-hashrow', title: hover.hash }, short))
  }
  return React.createElement('div', { className: 'gp-cd-pop', style: { left, top }, onMouseEnter, onMouseLeave }, inner)
}

function GitGraphView({ repo, onOpenDiff, diffSel }) {
  const [state, setState] = React.useState({ loading: true, entries: [], error: '', hasMore: true, loadingMore: false })
  const [hover, setHover] = React.useState(null)
  const [, bumpHover] = React.useReducer((c) => c + 1, 0)
  // 行内展开：手风琴式，expanded 为当前展开提交的 hash
  const [expanded, setExpanded] = React.useState(null)
  const [filesVer, bumpFiles] = React.useReducer((c) => c + 1, 0)
  const stateRef = React.useRef(state)
  stateRef.current = state
  const listRef = React.useRef(null)
  const hoverHashRef = React.useRef(null)
  const hideRef = React.useRef(null)
  const detailCache = React.useRef(new Map())
  // hash → {loading} | {files} | {error}：文件列表缓存（首次展开才请求）
  const filesCache = React.useRef(new Map())
  const expandedRef = React.useRef(null)
  expandedRef.current = expanded
  const ROWH = 26
  const PAGE = 200
  const FILEH = 26   // 展开区文件行行高（含内边距）
  const MAXVIS = 8   // 展开区可见文件数上限（超出转内部滚动）

  const loadPage = React.useCallback(async (skip, append, soft) => {
    if (append) setState((s) => ({ ...s, loadingMore: true }))
    else if (!soft) setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const r = await callRpc('log', { repoId: repo.id, skip, limit: PAGE })
      if (r && r.ok) {
        const list = append ? stateRef.current.entries.concat(r.entries || []) : (r.entries || [])
        setState({ loading: false, loadingMore: false, error: '', entries: list, hasMore: !!r.hasMore })
      } else setState((s) => ({ ...s, loading: false, loadingMore: false, error: (r && r.error) || tr('historyLoadFailed') }))
    } catch (e) { setState((s) => ({ ...s, loading: false, loadingMore: false, error: e && e.message ? e.message : String(e) })) }
  }, [repo.id])

  React.useEffect(() => { loadPage(0, false) }, [loadPage])

  // 写操作（commit/push/pull 等）后定向刷新历史：订阅 refreshTick，命中本仓库时
  // 静默重拉第一页（soft 模式不闪 loading）；滚动回顶部让新提交进入视口；
  // 清空悬停详情缓存（push 后远程 ref 位置变化，旧缓存的 refs 已过期）
  const s = useStore()
  const lastTickRef = React.useRef(s.refreshTick)
  React.useEffect(() => {
    if (s.refreshTick === lastTickRef.current) return
    lastTickRef.current = s.refreshTick
    if (s.lastOpRepoId != null && s.lastOpRepoId !== repo.id) return
    detailCache.current.clear()
    if (listRef.current) listRef.current.scrollTop = 0
    loadPage(0, false, true)
  }, [s.refreshTick, s.lastOpRepoId, repo.id, loadPage])

  // 可变行高：展开行 = ROWH + 展开区高度（文件列表载入前后不同）。
  // heights/tops 前缀和/可视窗口二分定位/触底分页，见 useVariableRows
  const expandedIdx = React.useMemo(() => state.entries.findIndex((e) => e.hash === expanded), [state.entries, expanded])
  const { heights, tops, win, syncWindow } = useVariableRows(state.entries, expandedIdx, filesCache, filesVer, listRef, stateRef, loadPage, ROWH, FILEH, MAXVIS)

  // 滚动加载：到底部前 800px 预取下一页；数据追加后若仍靠近底部则继续加载；
  // tops 变化（展开/收起改变行高）后同样重算窗口
  React.useEffect(() => { syncWindow() }, [state.entries, state.hasMore, state.loading, state.loadingMore, syncWindow, tops])

  const graph = React.useMemo(() => computeGraph(state.entries), [state.entries])

  // 展开后若文件区超出视口底部则滚动补齐（文件列表异步载入后高度变化也会再校正一次）
  React.useEffect(() => {
    if (expandedIdx < 0) return
    const el = listRef.current
    if (!el) return
    const bottom = tops[expandedIdx] + (heights[expandedIdx] || ROWH)
    if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [expandedIdx, tops, heights])

  // 悬停详情：离开行/弹层后短暂延迟关闭，滚动立即关闭
  const cancelHide = () => { if (hideRef.current) { hideRef.current(); hideRef.current = null } }
  const scheduleHide = () => {
    cancelHide()
    hideRef.current = getTimer().timeout(() => { hoverHashRef.current = null; setHover(null); hideRef.current = null }, 160)
  }
  const closeHover = () => { cancelHide(); if (hoverHashRef.current) { hoverHashRef.current = null; setHover(null) } }
  // 首次访问才请求的懒加载缓存（detail 与 files 共用模式）：守卫 → 置 loading →
  // RPC → 写结果 → 通知刷新；成功条目形状由 pick 决定，失败统一 { error }
  const ensureCached = (cache, hash, method, pick, onDone) => {
    if (cache.current.has(hash)) return
    cache.current.set(hash, { loading: true })
    callRpc(method, { repoId: repo.id, hash }).then((r) => {
      cache.current.set(hash, r && r.ok ? pick(r) : { loading: false, error: (r && r.error) || tr('loadFailed') })
      onDone()
    }).catch((e) => {
      cache.current.set(hash, { loading: false, error: e && e.message ? e.message : String(e) })
      onDone()
    })
  }
  // 提交详情：悬停行懒加载；载入完成且仍在悬停同一提交时刷新浮层
  const ensureDetail = (hash) => ensureCached(detailCache, hash, 'commitDetail', (r) => ({ loading: false, data: r }), () => { if (hoverHashRef.current === hash) bumpHover() })
  const showDetail = (hash, el, refs, short) => {
    cancelHide()
    const rect = el.getBoundingClientRect()
    hoverHashRef.current = hash
    setHover({ hash, top: rect.top, left: rect.left, refs: refs || '', short: short || '' })
    ensureDetail(hash)
  }

  // 行内展开的文件列表：首次展开才请求（bumpFiles 触发展开区行高重算）
  const ensureFiles = (hash) => ensureCached(filesCache, hash, 'commitFiles', (r) => ({ loading: false, files: r.files || [] }), bumpFiles)
  const toggleExpand = (hash) => {
    closeHover()
    const opening = expandedRef.current !== hash
    setExpanded((cur) => (cur === hash ? null : hash))
    if (opening) ensureFiles(hash)
  }

  const total = tops[state.entries.length]
  const maxLane = graph.maxLane
  // 左缘留白 8px：保证 lane 0 的 HEAD 外环（含描边）完整落在视口内不被截断
  const X = (l) => 8 + l * 14
  const W = 8 + (maxLane + 1) * 14 + 6
  const MID = ROWH / 2
  const rows = []
  for (let i = win.first; i < win.last && i < state.entries.length; i++) {
    const e = state.entries[i]
    const lane = graph.rowLane[i]
    const merges = graph.rowMerge[i] || []
    const active = graph.rowActive[i] || []
    const isHead = /HEAD/.test(e.refs || '')
    const isOpen = i === expandedIdx
    const rowH = heights[i] || ROWH
    const els = []
    const skipVert = new Set()
    // 分支/合并连线：平滑 S 形贝塞尔曲线，在行的上/下边缘与竖线无缝衔接；
    // 展开行的下缘端点按整行高延伸，lane 在展开区继续下行（图形不断线）
    for (const m of merges) {
      const x1 = X(m), x2 = X(lane)
      if (graph.laneLast[m] === i) {
        // 该 lane 在本行汇入提交节点：从行顶弯入节点
        skipVert.add(m)
        els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x1 + ' -1 C ' + x1 + ' ' + (MID - 7) + ' ' + x2 + ' ' + (MID - 7) + ' ' + x2 + ' ' + MID, fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
      } else {
        // 从提交节点分出新 lane / 并入途经 lane：从节点弯向行底
        if (graph.laneSince[m] === i) skipVert.add(m)
        els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x2 + ' ' + MID + ' C ' + x2 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (rowH + 1), fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
      }
    }
    // 垂直 lane 线：贯穿整行；根提交的 lane 止于节点；已由曲线接管的 lane 不再画竖线
    for (const l of active) {
      if (skipVert.has(l)) continue
      const y2 = l === lane && (e.parents || []).length === 0 ? MID : rowH + 1
      els.push(React.createElement('line', { key: 'v' + l, x1: X(l), y1: -1, x2: X(l), y2, stroke: laneColor(l), strokeWidth: 1.5, strokeLinecap: 'round' }))
    }
    // 提交节点：以背景色描边镂空穿过节点的连线
    els.push(React.createElement('circle', { key: 'd', cx: X(lane), cy: MID, r: 4, fill: laneColor(lane), stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 2 }))
    // HEAD 外环：紧贴内球的细空心环，外缘 5.9+0.7=6.6 < 左缘 8px
    if (isHead) els.push(React.createElement('circle', { key: 'h', cx: X(lane), cy: MID, r: 5.9, fill: 'none', stroke: laneColor(lane), strokeWidth: 1.4 }))
    // 行内只展示一个主要分支标签（当前分支高亮），远程分支等完整 refs 放入悬浮详情
    const refs = parseRefs(e.refs)
    const refEls = []
    const primary = refs.current || refs.branches[0] || refs.remotes[0]
    if (primary) refEls.push(React.createElement('span', { key: 'p', className: refs.current ? 'gp-grow-ref gp-grow-ref-cur' : 'gp-grow-ref' }, primary))
    refs.tags.forEach((t, ti) => refEls.push(React.createElement('span', { key: 't' + ti, className: 'gp-grow-ref gp-grow-ref-tag' }, t)))
    const subjectEl = React.createElement('span', { className: 'gp-grow-subject' }, e.subject)
    const refsEl = refEls.length > 0 ? React.createElement('span', { className: 'gp-grow-refs' }, refEls) : null
    const metaEl = React.createElement('span', { className: 'gp-grow-meta' }, (e.author || '') + ' · ' + (e.date || '').slice(0, 10))
    // 展开行：SVG 拉高使 lane 贯穿，右侧为「顶栏 + 文件列表」纵向列；普通行保持原平铺。
    // 展开态复用 gp-grow-sel（选中样式：品牌色左边条 + 浅底）
    rows.push(React.createElement('div', {
      key: e.hash, className: 'gp-grow' + (isOpen ? ' gp-grow-sel' : ''), style: { top: tops[i], height: rowH },
      onClick: () => toggleExpand(e.hash),
      onMouseEnter: (ev) => { if (!isOpen) showDetail(e.hash, ev.currentTarget, e.refs, e.short) },
      onMouseLeave: scheduleHide
    },
      React.createElement('svg', { width: W, height: rowH, viewBox: '0 0 ' + W + ' ' + rowH, style: { display: 'block', flex: '0 0 auto' } }, els),
      isOpen
        ? React.createElement('div', { className: 'gp-grow-col' },
            React.createElement('div', { className: 'gp-grow-bar' }, subjectEl, refsEl, metaEl),
            React.createElement(CommitFilesPanel, { e, repo, filesCache, diffSel, onOpenDiff }))
        : null,
      isOpen ? null : subjectEl,
      isOpen ? null : refsEl,
      isOpen ? null : metaEl))
  }

  const body = state.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingHistory')) :
    state.error ? React.createElement('div', { className: 'gp-empty' }, state.error) :
      state.entries.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('emptyHistory')) :
        React.createElement('div', { className: 'gp-graph-scroll', ref: listRef, onScroll: () => { closeHover(); syncWindow() } },
          React.createElement('div', { style: { position: 'relative', height: total + (state.hasMore ? ROWH : 0) } },
            rows,
            state.loadingMore ? React.createElement('div', { className: 'gp-grow-more', style: { top: total, height: ROWH } }, React.createElement('span', { className: 'gp-spinner' }), tr('loadingMore')) : null))

  // 悬停唤出的提交详情浮层（见 CommitDetailPop），可移入浮层内查看
  const pop = hover ? React.createElement(CommitDetailPop, { hover, detailCache, onMouseEnter: cancelHide, onMouseLeave: scheduleHide }) : null

  return React.createElement('div', { className: 'gp-history-body' },
    React.createElement('div', { className: 'gp-graph-wrap' }, body),
    pop)
}
export { GitGraphView }
