/** 主面板：扫描、工作空间跟随、拖拽调宽、折叠/展开、dock 同步、卡片与抽屉装配。 */
import React from 'react'
import { getClientCtx, getTimer, takeOverlayHooks } from '../runtime.js'
import { openNativeDiffTab } from '../nativeDiff.js'
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

// 客户端扫描结果缓存（root → repos）：切换工作区/对话时先呈现上次结果，后台再
// 静默重扫（宿主侧另有内存+磁盘两级仓库发现缓存，命中即回）。没有这层时，每次
// 切换都会把整个列表换成「扫描中」转圈——即便宿主命中缓存也白闪一下。
// 模块级单例：面板开合、对话切换都复用；仅 bundle 重装载才清零。
const scanResultsByRoot = new Map()

// DSH 0.1.7 起两个 store 的快照形状变了，旧解析字段双双消失：
//   sessions   { current, ... }                          → { ids, byId, phase, projectionsBySession }
//   workspaces { items, recentWorkspaceId, ... }          → { items, archivedSessionIds, pinnedSessionIds, state, phase, error }
// 后果：旧路径全部落空，面板永远解析不到工作区，停在「未打开工作空间」空态。
// 修复：兼容新旧两种形状，优先级从高到低——
//   1) hintSessionId：shell 当前主区会话（uiWorkspace.selection 镜像，切换对话即
//      更新，见 index.js 的订阅）。会话反查工作区，这是「切换对话 → 面板跟随」的关键。
//   2) 旧版字段：sessSt.current 反查 / wsSt.recentWorkspaceId 回退（旧版 DSH 兼容）。
//   3) 官方 recentWorkspace() 同款口径：工作区按其会话的最新 updatedAt 排序
//     （byId 查会话摘要），无会话则回退 createdAt，取时间最新者（并列时 items
//     顺序先者胜）。phase 未就绪时不计算，避免装载期闪错工作区。
function resolveWorkspace(wsSt, sessSt, hintSessionId) {
  if (!wsSt || !Array.isArray(wsSt.items) || wsSt.items.length === 0) return null
  const items = wsSt.items
  if (hintSessionId) {
    const w = items.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.indexOf(hintSessionId) >= 0)
    if (w) return w
  }
  if (sessSt && sessSt.current) {
    const w = items.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.indexOf(sessSt.current) >= 0)
    if (w) return w
  }
  if (wsSt.recentWorkspaceId) {
    const w = items.find((x) => x.workspaceId === wsSt.recentWorkspaceId)
    if (w) return w
  }
  if (wsSt.phase && wsSt.phase !== 'ready') return null
  if (sessSt && sessSt.phase && sessSt.phase !== 'ready') return null
  const byId = (sessSt && sessSt.byId) || {}
  let best = null
  let bestTime = -Infinity
  for (const ws of items) {
    let latest = -Infinity
    for (const id of Array.isArray(ws.sessionIds) ? ws.sessionIds : []) {
      const session = byId[id]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === -Infinity) latest = Date.parse(ws.createdAt)
    if (best === null || latest > bestTime) { best = ws; bestTime = latest }
  }
  return best
}

function GitPanelMain({ useSessions, useWorkspaces, sessionIdHint }) {
  const s = useStore()
  // hook 回退：native 页签正文的 slot props 只有框架注入（useTabInfo / sessionId 等），
  // 没有 shell.overlay 的 useSessions/useWorkspaces；从 runtime.js 暂存的钩子取同一批
  // 快照订阅器——两条路径解析出的工作区完全一致。
  const _hk = takeOverlayHooks()
  const sessHook = typeof useSessions === 'function' ? useSessions : _hk.useSessions
  const wsHook = typeof useWorkspaces === 'function' ? useWorkspaces : _hk.useWorkspaces
  // 整快照订阅后由 resolveWorkspace 统一解析（快照对象由 createSnapshotStore 缓存，
  // 内容不变时引用稳定，不会造成额外渲染）。sessionIdHint 是 native 页签自己的会话
  // （会话作用域槽位给；keepMounted 后后台正文仍挂在树上，必须钉住自己的会话，不能
  // 跟着全局 currentSessionId 漂到别的会话的工作区）。dock 没有该 prop，
  // 仍用 shell 当前主区会话（uiWorkspace.selection 镜像），切换对话即重解析 → 重扫。
  // sessionId 仅作 RPC 透传元数据（host 不消费），新版 store 已无 current，保持 undefined 即可。
  const sessSnap = sessHook ? sessHook((st) => st) : null
  const wsSnap = wsHook ? wsHook((st) => st) : null
  const sessionHint = sessionIdHint || s.currentSessionId
  // 「前台」= 本面板的会话就是 shell 当前主区会话。dock 没有 sessionIdHint，恒为前台；
  // native 下 keepMounted 会让后台会话的正文也留在树上，轮询与全局 wsRoot 都必须按它收住
  //（否则开几个会话就是 N 份 4s status 轮询，且 wsRoot 会被别的工作区覆盖，自愈重扫指错根）。
  const isForeground = !sessionIdHint || sessionIdHint === s.currentSessionId
  const ws = React.useMemo(() => resolveWorkspace(wsSnap, sessSnap, sessionHint), [wsSnap, sessSnap, sessionHint])
  const sessionId = sessSnap && sessSnap.current ? sessSnap.current : undefined
  const wsPath = ws && ws.path ? ws.path : ''
  const wsTitle = ws && ws.title ? ws.title : ''
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
  // 面板设置弹窗（布局模式 dock / native）开关
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
  // 折叠相方向必须在组件顶部就取：下面 native/showDocked 的形态分岔要先读它。
  // 曾经它只声明在 return 前的渲染段，而 showDocked 的表达式在 s.collapsed 为 true
  // 时会访问它 —— const 的 TDZ 让整个 GitPanelMain 在挂载期就抛
  // "Cannot access 'collDir' before initialization"，被 slot 错误边界吞掉后
  // 表现为「点 Git Panel 毫无反应」（面板收着时 100% 复现，展开态因 || 短路而正常）。
  const collDir = collAnim ? collAnim.dir : null
  // 扫描请求序列号：丢弃过期响应，防止「初始无 root 的慢扫描」晚到覆盖
  // 「跟随 workspace 的快扫描」的成功结果（竞态会让面板显示错误的空列表）
  const scanSeqRef = React.useRef(0)

  // force=true 时绕过 host 端扫描缓存（手动「重新扫描」按钮）；跟随 workspace
  // 的自动扫描与手动选根目录都允许命中缓存（切换项目秒开的关键路径）
  const doScan = React.useCallback(async (root, force) => {
    const seq = ++scanSeqRef.current
    // 客户端缓存命中：立即呈现上次的仓库列表（不清空卡片、不闪「扫描中」），
    // 扫描转后台，返回后就地更新。切回刚看过的项目 = 零重载感。
    const cached = !force && root && scanResultsByRoot.get(root)
    if (cached) setScan({ state: 'done', root, repos: cached, error: '' })
    else setScan((x) => ({ ...x, state: 'scanning', error: '' }))
    try {
      const res = await callRpc('scan', root ? (force ? { root, force: true } : { root }) : {})
      // 缓存按 root 各自独立，过期响应也照常入缓存（该 root 自己的最新数据）
      if (res && res.ok && res.root) scanResultsByRoot.set(res.root, res.repos || [])
      if (seq !== scanSeqRef.current) return
      if (res && res.ok) {
        setScan({ state: 'done', root: res.root, repos: res.repos || [], error: '' })
        // 扫描完成后联动刷新所有仓库状态（重扫 + 全量状态刷新）。
        // 复用 refreshTick 定向刷新机制：lastOpRepoId = null 表示全量，已挂载的 RepoCard
        // 各自重新 loadStatus（仓库 id 不变时卡片不重挂载，必须靠这里触发，否则看到旧状态）。
        store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'rescan', lastOpRepoId: null }))
      }
      // 后台刷新失败但已有缓存内容在展示时，不清空列表，只弹错误提示
      else if (cached) pushToast('error', (res && res.error) || tr('scanFailed'))
      else setScan((x) => ({ ...x, state: 'error', error: (res && res.error) || tr('scanFailed') }))
    } catch (e) {
      if (seq !== scanSeqRef.current) return
      if (cached) pushToast('error', e && e.message ? e.message : String(e))
      else setScan((x) => ({ ...x, state: 'error', error: e && e.message ? e.message : String(e) }))
    }
  }, [])

  // 永远跟随当前工作空间：wsPath 变化即重扫（scanSeqRef 防慢扫描晚到竞态）；
  // 无工作空间时不发起扫描，主体渲染「未打开工作空间」空态
  React.useEffect(() => {
    if (wsPath && wsPath !== scan.root) doScan(wsPath)
  }, [wsPath, scan.root, doScan])

  // 当前工作区根同步进全局 store：CommitArea 的 errRepoMissing 自愈路径要拿它发起
  // 重扫（跨组件不能引用本组件的 doScan，见 store.js 的 wsRoot 注释）。全局单值只允许
  // 前台面板写：keepMounted 保活的后台会话也挂着面板，它写进去会让前台的自愈重扫
  // 跑到别人的工作区里去找仓库（切会话时 isForeground 翻转，这里会重新写对）。
  React.useEffect(() => {
    if (!isForeground) return
    store.set((st) => (st.wsRoot === wsPath ? st : { ...st, wsRoot: wsPath }))
  }, [wsPath, isForeground])

  // ===== 原生侧栏模式（layout === 'native'）=====
  // 面板不作为 fixed 覆盖层渲染，而是作为 DSH 右栏制表签页签的页签正文（见 index.js 的
  // sidebar.right.pane.tab 注册）。这里只负责形态分岔：native 时不渲染停靠/浮层面板，
  // 把 header + main 装进 .gp-pane-host 容器；其余逻辑（扫描/自动刷新/草稿）全部共用。
  const nativePane = s.layout === 'native'
  const showDocked = !nativePane && (!s.collapsed || collDir === 'expand')
  // native 没有折叠形态：顶栏不渲染折叠按钮、railMounted 也排除 native（见下），
  // 历史版本的 gp-collapsed 残留由 apply 期一次性归一（index.js），这里不再动它——
  // 每次进入 native 都复位会吞掉用户的 dock 折叠偏好。

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
  // 轮询门控：dock 看 panelOpen（原有语义）；native 下页签在屏即视为打开
  //（从开始页入口卡片进入的页签 panelOpen 为假，也必须继续轮询），但 keepMounted 保活的
  // 后台会话不算「在屏」，按 isForeground 暂停——否则开几个会话就是几份 4s status 轮询。
  const pollOn = nativePane ? isForeground : s.panelOpen
  React.useEffect(() => {
    if (!pollOn) return
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
  }, [pollOn, scan.repos])

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

  // native 下页签存在即面板在显示：不看 panelOpen——开页签的路径不止我们的开关
  // （右栏开始页的入口卡片由框架按 kind 直接开页签，不经过 openNativeTab），那条路
  // 不置 panelOpen，若还拿它当门控就是从开始页进入必空白。panelOpen 在 native 下
  // 只用于开关按钮的点亮态与切模式时的交接，不参与渲染。
  const effectiveOpen = nativePane ? true : s.panelOpen
  if (!effectiveOpen) {
    // 面板「关闭」态：主体（含下面那条 rail）一行都渲染不到，所以「隐藏左下角按钮」必须
    // 在这里单独给一条竖条兜底——否则 dock 模式下开关被隐藏、面板又收着，用户没有任何
    // UI 入口（只能改 localStorage 自救；旧版本这个分支写在主体里，永远执行不到）。
    // 按钮还在时不必兜底：它自己就是入口。点击要同时置 panelOpen，startExpand 只翻折叠态、
    // 打不开一个已关闭的面板；两者一起写，竖条 → 面板的过渡由 DockSync 的 padding 动画接管。
    if (nativePane || !s.toggleHidden) return null
    return React.createElement(React.Fragment, null,
      React.createElement(DockSync, { on: innerW >= 1200, w: RAIL_W, noanim: false }),
      React.createElement('button', {
        className: 'gp-rail', title: tr('expandTitle'),
        onClick: () => store.set((st) => ({ ...st, panelOpen: true, collapsed: false }))
      },
        icon('branch', 16),
        React.createElement('span', { className: 'gp-rail-label' }, 'Git Panel')))
  }
  const diffRepo = diffSel ? scan.repos.find((r) => r.id === diffSel.repoId) : null

  const header = React.createElement('div', { className: 'gp-header' },
    // native 的 chip 已经带图标和「Git Panel」，顶栏不再重复标题（只留工作区名与
    // 操作按钮）；dock 的标题仍是折叠开关（有竖条兜底展开）。native 没有
    // 折叠落点，点它只会把 44px 挤压写进宿主 frame 且无路可回（用户实测故障）。
    nativePane ? null : React.createElement('button', { className: 'gp-title gp-title-btn', onClick: startCollapse }, icon('branch', 15), 'Git Panel'),
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
      // 停靠模式下不放关闭键：与普通页面右上角的关闭样式混淆，开关统一走侧栏入口（gp-sidebar-toggle）。
      // native 也不放：关闭由页签 chip 上的 X 负责，顶栏再来一个就重复了。
      React.createElement('button', { className: 'gp-btn-icon', title: tr('panelSettings'), onClick: () => setSettingsOpen(true) }, icon('gear'))))

  const body = React.createElement('div', { className: 'gp-body' },
    !wsPath ? React.createElement('div', { className: 'gp-empty' }, tr('noWorkspace')) :
      scan.state === 'scanning' || scan.state === 'idle' ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), scan.state === 'idle' ? ' ' + tr('locating') : ' ' + tr('scanning')) :
      scan.state === 'error' ? React.createElement('div', { className: 'gp-empty' }, scan.error) :
        scan.repos.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('noRepos')) :
          scan.repos.map((r) => React.createElement(RepoCard, {
            // key 带上绝对路径：repo.id 只是 root 内的相对路径，两个工作空间里同 id 的
            // 仓库（如各自都有顶层 .git）在切换工作空间时会被 React 认成同一张卡片、
            // 复用组件实例——提交信息（按 repo.path 记的草稿）就会串仓，输入框里留着
            // 上一个工作空间的半截话。path 不同则整卡重挂，各凭自己的草稿初始化。
            key: r.id + '\u0001' + r.path, repo: r, sessionId, diffSel, onCloseDiff: requestCloseDiff,
            // 普通点击行 = 单选该行并打开 diff；再次点击同一行（同 repo 同组同路径，
            // 提交文件还须同 hash）= 进入关闭相位（抽屉滑出动效播完才卸载，见
            // requestCloseDiff/finishCloseDiff）
            // native 下点**任何**分组的文件行都开一枚原生侧栏新页签看变更详情；
            // 只有停靠模式才走贴面板左缘的本地抽屉。锚进当前页签内部的抽屉会被
            // 页签本体盖住（用户实测确认），所以 native 从不锚内嵌，一律开页签。
            onOpenDiff: (repo2, f, group) => {
              if (s.layout === 'native') { openNativeDiffTab(repo2, f, group); return }
              setDiffSel((prev) => prev && prev.repoId === repo2.id && prev.path === f.path && prev.group === group && (prev.hash || null) === (f.hash || null)
                ? { ...prev, closing: true }
                : { repoId: repo2.id, path: f.path, group, x: f.x, y: f.y, hash: f.hash || null, short: f.short || '', orig: f.orig || null })
            },
          })))

  // 折叠/展开渲染：稳态只渲染一种形态（panelOpen 语义不变，自动刷新轮询继续）；
  // 过渡相内面板与竖条同时在场 —— 离场元素 translateX(100%) 右滑出屏（禁指针），
  // 进场元素从右缘屏外滑入。diff 抽屉在折叠时已关闭（折叠动作里 setDiffSel(null)）。
  // collDir 已提到组件顶部（形态分岔要读），这里只取动画进度。
  const collOn = !!(collAnim && collAnim.entered)
  const panelOff = collDir === 'collapse' ? collOn : collDir === 'expand' ? !collOn : false
  const railOff = collDir === 'collapse' ? !collOn : collDir === 'expand' ? collOn : false

  // 停靠生效条件：偏好 dock + 视口 ≥1200px（窄窗退化为「覆盖不挤压」——DSH 自身
  // sidebar 在 1024px 也会自动折叠，停靠挤压在窄窗会把对话列压死）+ 面板可见
  // （打开 + 未折叠 + 非离场相位）。面板离场（panelOff）即解除挤压，
  // padding 过渡与面板滑出/滑入同步（同曲线同时长）。浮窗 overlay 模式已下线，
  // 但这条「窄窗不挤压」的退化路径保留：它就是原先浮窗采用的几何形态。
  const panelVisible = s.panelOpen && (!s.collapsed || collDir === 'expand')
  const dockActive = s.layout === 'dock' && innerW >= 1200 && panelVisible && !panelOff

  // 折叠竖条并入同一挤压通道（mini-dock）：竖条是 fixed 全高覆盖层，不在布局上
  // 让位会盖住对话列右缘（会话头部 Session log 按钮、消息与输入框右段）。折叠
  // 稳态与收进相（rail 滑入）以 RAIL_W 顶替面板宽——padding 从 panelW 平滑收到
  // 44px；展开相（rail 滑出）目标取 0：dock 模式下一帧即被 dockActive 接管
  // （44→panelW），窄窗不挤压时 padding 随竖条滑出同步收 0（若保持 44 到竖条
  // 卸载，收尾帧会无过渡跳变）。宽视口守卫与 dock 同阈值；窄窗维持覆盖不挤压。
  // native 必须整体排除：页签面板在右栏，没有竖条可展开，此时写 44px 只会在
  // 对话区右缘留下一条「侧边栏模式收起」同款空白且无法复原（用户实测故障）。
  const railMounted = !nativePane && (s.collapsed || collDir === 'collapse')
  const railPush = railMounted && innerW >= 1200
  const pushOn = dockActive || railPush
  const pushW = dockActive ? s.panelW : (collDir === 'expand' ? 0 : RAIL_W)

  // native 下不渲染停靠面板/折叠竖条：形态分岔在下方 paneHost 一处完成。
  const panel = showDocked ? React.createElement('div', {
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

  // 折叠态的竖条把手（native 不给——右栏开始页卡片即入口）。「面板关闭 + 按钮隐藏」的
  // 兜底在上面的提前 return 里单独渲染：这一行到那种状态根本执行不到，旧版本试图在这里
  // 用 `toggleHidden && !effectiveOpen` 兜底，那个分支永远为假，等于没有入口。
  const rail = !nativePane && (s.collapsed || collDir === 'collapse') ? React.createElement('button', {
    className: 'gp-rail', title: tr('expandTitle'),
    style: { transform: railOff ? 'translateX(100%)' : 'none', pointerEvents: collDir === 'expand' ? 'none' : undefined },
    onClick: startExpand
  },
    icon('branch', 16),
    React.createElement('span', { className: 'gp-rail-label' }, 'Git Panel')) : null

  // 抽屉只在停靠模式出现（贴面板左缘的覆盖层）；native 的详情一律走新页签
  //（onOpenDiff → openNativeDiffTab）。曾经的「锚进当前页签内部」方案已废弃：
  // 那层抽屉会被页签本体盖住，用户看到的是点击无反应。
  const drawerW = s.panelW

  // 原生侧栏页签正文容器（styles.js 的 native 段覆写其内部 .gp-panel 的定位与宽度）。
  // 结构必须保留 .gp-panel 这层：基础样式（底色/左边框/字号）都挂在它身上，native
  // 段只负责「去 fixed、宽满容器」的覆写——少了这层选择器就是死代码，面板没有底色。
  // 不放左缘拖拽手柄：侧栏宽度由 DSH 自身的边缘手势管理，重复的手柄会与它冲突。
  const paneHost = nativePane ? React.createElement('div', { className: 'gp-pane-host' },
    React.createElement('div', { className: 'gp-panel' },
      header,
      React.createElement('div', { className: 'gp-main' }, body))) : null

  return React.createElement(React.Fragment, null,
    React.createElement(DockSync, { on: pushOn, w: pushW, noanim: resizing }),
    panel,
    rail,
    paneHost,
    settingsOpen ? React.createElement(LayoutSettingsModal, { onClose: () => setSettingsOpen(false) }) : null,
    !nativePane && diffSel && diffRepo ? React.createElement(DiffDrawer, { repo: diffRepo, sel: diffSel, panelW: drawerW, onClose: finishCloseDiff, onRequestClose: requestCloseDiff }) : null)
}
export { GitPanelMain }
