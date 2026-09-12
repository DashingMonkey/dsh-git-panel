/** 主面板：扫描、工作空间跟随、拖拽调宽、折叠/展开、dock 同步、卡片与抽屉装配。 */
import React from 'react'
import { getClientCtx, getTimer } from '../runtime.js'
import { callRpc } from '../api.js'
import { tr, fmt, applyLocale } from '../i18n.js'
import { store, savePrefInt, pushToast, useStore } from '../store.js'
import { icon } from '../icons.js'
import { useCollapseAnimation } from '../hooks/useCollapseAnimation.js'
import { useWidthDrag } from '../hooks/useWidthDrag.js'
import { DockSync, RAIL_W } from './dock.js'
import { RepoCard } from './RepoCard/index.js'
import { DiffDrawer } from './DiffDrawer.js'
import { LayoutSettingsModal } from './modals.js'
function workspaceOfSession(st, sessionId) {
  if (!st || !Array.isArray(st.items)) return null
  const items = st.items
  let w = null
  if (sessionId) w = items.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.indexOf(sessionId) >= 0) || null
  if (!w && st.recentWorkspaceId) w = items.find((x) => x.workspaceId === st.recentWorkspaceId) || null
  return w
}

function GitPanelMain({ useSessions, useWorkspaces }) {
  const s = useStore()
  const sessionId = typeof useSessions === 'function' ? useSessions((st) => (st && st.current) || undefined) : undefined
  const wsPath = typeof useWorkspaces === 'function' ? useWorkspaces((st) => { const w = workspaceOfSession(st, sessionId); return w && w.path ? w.path : '' }) : ''
  const wsTitle = typeof useWorkspaces === 'function' ? useWorkspaces((st) => { const w = workspaceOfSession(st, sessionId); return w && w.title ? w.title : '' }) : ''
  const [scan, setScan] = React.useState({ state: 'idle', root: '', repos: [], error: '' })
  const [diffSel, setDiffSel] = React.useState(null)
  // 关闭动效（关闭相位由 diffSel.closing 携带，所有关闭入口统一走 requestCloseDiff）：
  // 标记 closing → 抽屉反向滑出（~240ms）→ finishCloseDiff 才真正卸载；期间点击别的
  // 文件会整体替换 diffSel（closing 复位），finishCloseDiff 检测到非 closing 相位即空操作，
  // 抽屉保持打开直接切换内容（与旧版「关闭中途换文件」的闪断行为说再见）
  const requestCloseDiff = React.useCallback(() => {
    setDiffSel((prev) => (prev && !prev.closing ? { ...prev, closing: true } : prev))
  }, [])
  const finishCloseDiff = React.useCallback(() => {
    setDiffSel((prev) => (prev && prev.closing ? null : prev))
  }, [])
  const [resizing, setResizing] = React.useState(false)
  // 面板设置弹窗（布局模式 dock/overlay）开关
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // 停靠窄视口守卫（见 dockActive 计算）：跟踪窗口宽度
  const [innerW, setInnerW] = React.useState(() => (typeof window === 'undefined' ? 9999 : window.innerWidth))
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onRz = () => setInnerW(window.innerWidth)
    window.addEventListener('resize', onRz)
    return () => window.removeEventListener('resize', onRz)
  }, [])
  // 折叠/展开滑动动效（见 useCollapseAnimation）：折叠开始前先关 diff 抽屉
  const { collAnim, startCollapse, startExpand } = useCollapseAnimation(() => setDiffSel(null))
  // 扫描请求序列号：丢弃过期响应，防止「初始无 root 的慢扫描」晚到覆盖
  // 「跟随 workspace 的快扫描」的成功结果（竞态会让面板显示错误的空列表）
  const scanSeqRef = React.useRef(0)

  // force=true 时绕过 host 端扫描缓存（手动「重新扫描」按钮）；跟随 workspace
  // 的自动扫描与手动选根目录都允许命中缓存（切换项目秒开的关键路径）
  const doScan = React.useCallback(async (root, force) => {
    const seq = ++scanSeqRef.current
    setScan((x) => ({ ...x, state: 'scanning', error: '' }))
    try {
      const res = await callRpc('scan', root ? (force ? { root, force: true } : { root }) : {})
      if (seq !== scanSeqRef.current) return
      if (res && res.ok) {
        setScan({ state: 'done', root: res.root, repos: res.repos || [], error: '' })
        // 扫描完成后联动刷新所有仓库状态（重扫 + 全量状态刷新）。
        // 复用 refreshTick 定向刷新机制：lastOpRepoId = null 表示全量，已挂载的 RepoCard
        // 各自重新 loadStatus（仓库 id 不变时卡片不重挂载，必须靠这里触发，否则看到旧状态）。
        store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'rescan', lastOpRepoId: null }))
      }
      else setScan((x) => ({ ...x, state: 'error', error: (res && res.error) || tr('scanFailed') }))
    } catch (e) {
      if (seq !== scanSeqRef.current) return
      setScan((x) => ({ ...x, state: 'error', error: e && e.message ? e.message : String(e) }))
    }
  }, [])

  // 永远跟随当前工作空间：wsPath 变化即重扫（scanSeqRef 防慢扫描晚到竞态）；
  // 无工作空间时不发起扫描，主体渲染「未打开工作空间」空态
  React.useEffect(() => {
    if (wsPath && wsPath !== scan.root) doScan(wsPath)
  }, [wsPath, scan.root, doScan])

  React.useEffect(() => {
    // 面板挂载时重新同步 DSH 语言：apply 阶段 locale 服务可能尚未就绪，
    // 导致初始 lang 固定为 zh、且后续切换事件也没订阅上。
    // 优先用 LocaleFace 标准订阅（subscribe），退化到 locale/change 事件。
    const svc = getClientCtx().get('locale')
    if (!svc || typeof svc.getLocale !== 'function') return
    const sync = () => { try { applyLocale(svc.getLocale().active) } catch (e) { /* ignore */ } }
    sync()
    if (typeof svc.subscribe === 'function') return svc.subscribe(sync)
    return getClientCtx().on('locale/change', (snap) => { if (snap) applyLocale(snap.active) })
  }, [])

  // 自动刷新：外部（当前对话框修改代码、编辑器保存、其他工具改动等）导致工作区
  // 变化时自动刷新仓库状态。轮询 status 并比对指纹（branch/ahead/staged/unstaged/
  // untracked/conflicted/mergeInProgress/otherOp），有变化则触发对应仓库的定向刷新（bump refreshTick）。
  // conflicted 与 mergeInProgress 必须入指纹：冲突发生时 staged/unstaged 可能全为空，
  // 只有这两个字段变化（外部终端里 pull/merge 出冲突正是该场景）；otherOp 同理——
  // rebase 冲突被外部解决后 conflicted 变空、而 rebase 仍在进行，只有它能反映这段过渡。
  const autoFpRef = React.useRef({})
  React.useEffect(() => {
    if (!s.panelOpen) return
    // 统一走 timer 服务（动态包沙箱禁用原生 setInterval），链式调度代替轮询定时器
    let stopped = false
    let cancel = null
    const tick = async () => {
      if (stopped) return
      try {
        const list = scan.repos || []
        for (const r of list) {
          const res = await callRpc('status', { repoId: r.id }).catch(() => null)
          if (!res || !res.ok) continue
          const fp = [res.branch, res.aheadBehind, res.staged, res.unstaged, res.untracked, res.conflicted, res.mergeInProgress, res.otherOp]
            .map((x) => (Array.isArray(x) ? x.map((f) => ((f && f.path) || '') + ((f && f.orig) || '')).join('\u0000') : x === null ? 'null' : x && typeof x === 'object' ? JSON.stringify(x) : String(x)))
            .join('\u001f')
          const prev = autoFpRef.current[r.id]
          if (prev !== undefined && prev !== fp) {
            store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'external', lastOpRepoId: r.id }))
          }
          autoFpRef.current[r.id] = fp
        }
      } catch (e) { /* ignore */ }
      if (!stopped) cancel = getTimer().timeout(tick, 4000)
    }
    cancel = getTimer().timeout(tick, 4000)
    return () => { stopped = true; if (cancel) cancel() }
  }, [s.panelOpen, scan.repos])

  // 面板左缘拖拽调宽：宽度 = 视口宽 − 指针 x（钳到 [380, 视口 96%]），
  // 松手时持久化到 localStorage
  const dragApply = (e) => {
    const w = Math.min(Math.round(window.innerWidth * 0.96), Math.max(380, Math.round(window.innerWidth - e.clientX)))
    store.set((st) => (st.panelW === w ? st : { ...st, panelW: w }))
    return w
  }
  const widthDrag = useWidthDrag(dragApply, (w) => savePrefInt('gp-panel-w', 380, 2400, w), () => setResizing(false))

  // 面板关闭时同步关闭 diff 抽屉，避免下次打开面板时残留上次的 diff 选择
  React.useEffect(() => { if (!s.panelOpen) setDiffSel(null) }, [s.panelOpen])

  if (!s.panelOpen) return null
  const diffRepo = diffSel ? scan.repos.find((r) => r.id === diffSel.repoId) : null

  const header = React.createElement('div', { className: 'gp-header' },
    React.createElement('button', { className: 'gp-title gp-title-btn', onClick: startCollapse }, icon('branch', 15), 'Git Panel'),
    wsPath ? React.createElement('span', { className: 'gp-ws-name', title: wsPath }, wsTitle || wsPath.split(/[\\/]/).filter(Boolean).pop()) : null,
    React.createElement('div', { className: 'gp-header-actions' },
      React.createElement('button', { className: 'gp-btn-icon', title: tr('rescan'), onClick: () => doScan(wsPath || scan.root, true) }, icon('refresh')),
      React.createElement('button', { className: 'gp-btn-icon', title: tr('openFolder'), disabled: !(wsPath || scan.root), onClick: () => {
        const p = wsPath || scan.root
        if (!p) return
        const failToast = (e) => pushToast('error', fmt(tr('openFolderFailed'), { e: e && e.message ? e.message : String(e) }))
        // 优先插件自己的 host RPC（explorer.exe 开新窗口，避开平台 Invoke-Item 激活
        // 不可见旧窗口的问题）；host 半体未重启仍是旧版时回退平台 workspaces.openPath
        callRpc('openInExplorer', { path: p }).then((r) => {
          if (r && r.ok) return
          if (r && typeof r.error === 'string' && r.error.indexOf('unknown method') === 0) {
            const ws = getClientCtx().get('workspaces')
            if (ws && typeof ws.openPath === 'function') { ws.openPath(p).catch(failToast); return }
            pushToast('error', tr('openFolderUnavailable'))
            return
          }
          pushToast('error', (r && r.error) || tr('openFolderUnavailable'))
        }).catch(failToast)
      } }, icon('folder')),
      React.createElement('button', { className: 'gp-btn-icon', title: tr('panelSettings'), onClick: () => setSettingsOpen(true) }, icon('gear')),
      React.createElement('button', { className: 'gp-btn-icon', title: tr('close'), onClick: () => store.set((st) => ({ ...st, panelOpen: false })) }, icon('close'))))

  const body = React.createElement('div', { className: 'gp-body' },
    !wsPath ? React.createElement('div', { className: 'gp-empty' }, tr('noWorkspace')) :
      scan.state === 'scanning' || scan.state === 'idle' ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), scan.state === 'idle' ? ' ' + tr('locating') : ' ' + tr('scanning')) :
      scan.state === 'error' ? React.createElement('div', { className: 'gp-empty' }, scan.error) :
        scan.repos.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('noRepos')) :
          scan.repos.map((r) => React.createElement(RepoCard, {
            key: r.id, repo: r, sessionId, diffSel, onCloseDiff: requestCloseDiff,
            // 普通点击行 = 单选该行并打开 diff；再次点击同一行（同 repo 同组同路径，
            // 提交文件还须同 hash）= 进入关闭相位（抽屉滑出动效播完才卸载，见
            // requestCloseDiff/finishCloseDiff）
            onOpenDiff: (repo2, f, group) => setDiffSel((prev) => prev && prev.repoId === repo2.id && prev.path === f.path && prev.group === group && (prev.hash || null) === (f.hash || null)
              ? { ...prev, closing: true }
              : { repoId: repo2.id, path: f.path, group, x: f.x, y: f.y, hash: f.hash || null, short: f.short || '', orig: f.orig || null })
          })))

  // 折叠/展开渲染：稳态只渲染一种形态（panelOpen 语义不变，自动刷新轮询继续）；
  // 过渡相内面板与竖条同时在场 —— 离场元素 translateX(100%) 右滑出屏（禁指针），
  // 进场元素从右缘屏外滑入。diff 抽屉在折叠时已关闭（折叠动作里 setDiffSel(null)）。
  const collDir = collAnim ? collAnim.dir : null
  const collOn = !!(collAnim && collAnim.entered)
  const panelOff = collDir === 'collapse' ? collOn : collDir === 'expand' ? !collOn : false
  const railOff = collDir === 'collapse' ? !collOn : collDir === 'expand' ? collOn : false

  // 停靠生效条件：偏好 dock + 视口 ≥1200px（窄窗临时退化浮窗——DSH 自身
  // sidebar 在 1024px 也会自动折叠，停靠挤压在窄窗会把对话列压死）+ 面板可见
  // （打开 + 未折叠 + 非离场相位）。面板离场（panelOff）即解除挤压，
  // padding 过渡与面板滑出/滑入同步（同曲线同时长）。
  const panelVisible = s.panelOpen && (!s.collapsed || collDir === 'expand')
  const dockActive = s.layout === 'dock' && innerW >= 1200 && panelVisible && !panelOff

  // 折叠竖条并入同一挤压通道（mini-dock）：竖条是 fixed 全高覆盖层，不在布局上
  // 让位会盖住对话列右缘（会话头部 Session log 按钮、消息与输入框右段）。折叠
  // 稳态与收进相（rail 滑入）以 RAIL_W 顶替面板宽——padding 从 panelW 平滑收到
  // 44px；展开相（rail 滑出）目标取 0：dock 模式下一帧即被 dockActive 接管
  // （44→panelW），overlay 模式 padding 随竖条滑出同步收 0（若保持 44 到竖条
  // 卸载，收尾帧会无过渡跳变）。宽视口守卫与 dock 同阈值；窄窗维持覆盖不挤压。
  const railMounted = s.collapsed || collDir === 'collapse'
  const railPush = railMounted && innerW >= 1200
  const pushOn = dockActive || railPush
  const pushW = dockActive ? s.panelW : (collDir === 'expand' ? 0 : RAIL_W)

  const rail = (s.collapsed || collDir === 'collapse') ? React.createElement('button', {
    className: 'gp-rail', title: tr('expandTitle'),
    style: { transform: railOff ? 'translateX(100%)' : 'none', pointerEvents: collDir === 'expand' ? 'none' : undefined },
    onClick: startExpand
  },
    icon('branch', 16),
    React.createElement('span', { className: 'gp-rail-label' }, 'Git Panel')) : null

  const panel = (!s.collapsed || collDir === 'expand') ? React.createElement('div', {
    className: 'gp-panel' + (resizing ? ' gp-noanim' : ''),
    style: { width: s.panelW + 'px', transform: panelOff ? 'translateX(100%)' : 'none', pointerEvents: collDir === 'collapse' ? 'none' : undefined }
  },
    React.createElement('div', {
      className: 'gp-resize' + (resizing ? ' gp-resize-active' : ''),
      title: tr('resizeTitle'),
      onPointerDown: (e) => { e.preventDefault(); widthDrag.begin(); setResizing(true) }
    }),
    header,
    React.createElement('div', { className: 'gp-main' }, body)) : null

  return React.createElement(React.Fragment, null,
    React.createElement(DockSync, { on: pushOn, w: pushW, noanim: resizing }),
    panel,
    rail,
    settingsOpen ? React.createElement(LayoutSettingsModal, { onClose: () => setSettingsOpen(false) }) : null,
    diffSel && diffRepo ? React.createElement(DiffDrawer, { repo: diffRepo, sel: diffSel, panelW: s.panelW, onClose: finishCloseDiff, onRequestClose: requestCloseDiff }) : null)
}
export { GitPanelMain }
