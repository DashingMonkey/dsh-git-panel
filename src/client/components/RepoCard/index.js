/** 仓库卡片：状态轮询、分支/更多菜单、变更分组、批量多选、各确认弹窗与推送失败弹窗装配。
 *  推送失败现场只在这一层写（applyPushFail）；CommitArea 经回调上报（见其文件头）。 */
import React from 'react'
import { callRpc, isPushNoUpstream } from '../../api.js'
import { tr, fmt } from '../../i18n.js'
import { pushToast, store, useStore } from '../../store.js'
import { icon } from '../../icons.js'
import { GROUP_META, glyphOf, rowKey, splitPath } from '../../lib/util.js'
import { useMultiSelect } from '../../hooks/useMultiSelect.js'
import { ConfirmModal } from '../modals.js'
import { GitGraphView } from '../GitGraphView.js'
import { CommitArea } from './CommitArea.js'
import { PushFailModal } from './PushFailModal.js'
function RepoCard({ repo, sessionId, onOpenDiff, diffSel, onCloseDiff }) {
  const [status, setStatus] = React.useState({ loading: true, data: null, error: '' })
  const [isCollapsed, setCollapsed] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [branchMenu, setBranchMenu] = React.useState({ open: false, loading: false, data: null, error: '', creating: false, newName: '' })
  const [moreMenu, setMoreMenu] = React.useState({ open: false })
  const [busy, setBusy] = React.useState(null)
  const [message, setMessage] = React.useState('')
  // 放弃更改确认弹窗：null 或 { byGroup: {staged:[], unstaged:[], untracked:[]}, count }
  const [confirmDiscard, setConfirmDiscard] = React.useState(null)
  // 危险操作确认弹窗（Reset / Clean）：null | 'reset-soft' | 'reset-hard' | 'clean'
  const [confirmDanger, setConfirmDanger] = React.useState(null)
  // 「提交成功、推送失败」的收尾弹窗。状态必须放在卡片这一层：弹窗用 fixed 定位，
  // 与 discardModal / dangerModal 一样挂在卡片外层（Fragment），避免卡片内的堆叠上下文
  // 干扰 backdrop 覆盖范围（见下方 return 的注释）。
  //   raw         —— git 自己的输出（Host 的 fail(...).detail → 信封 details.detail →
  //                  unwrapRpc 摊平成 res.detail），弹窗里的等宽框直接显示它。
  //                  为空说明 Host 没给原文（无上游那条路径有意不给），此时框里显示
  //                  command 那条建议命令（见 pushFailText）
  //   command     —— Host 定稿的建议命令（无上游时才有），Client 直接照搬
  //   afterCommit —— **提交后**的 HEAD 短 hash：撤回的落点，同时作为 reset 的
  //                  expectHash 传给 Host（HEAD 已前移就拒绝撤销，见 opReset）；
  //                  拿不到时撤销会先补读一次 status，再拿不到就不撤
  //   redo        —— 撤回提交后恢复输入框内容（提交成功后 message 已被清空）
  //   noUpstream  —— 这次失败是「分支没有上游」：重试不会好，弹窗换掉建议文案
  // 弹窗只在撤销成功或推送成功（handleWriteResult）时关闭：失败时留在原地，
  // 用户还有「重试推送 / 取消上次提交」可用。
  const [pushFail, setPushFail] = React.useState(null)
  const [pushRetrying, setPushRetrying] = React.useState(false)
  // 推送失败现场**只在这一层写**（弹窗也是这一层渲染的）。CommitArea 经 onPushFail /
  // onPushRetryFail 上报，它自己不再碰这份状态——这是被三次 ReferenceError 教出来的约定：
  // 状态写在哪一层，就只能由那一层改，跨层互调局部函数必然出错。
  // ⚠ 没在飞的请求时要真的中止它，否则「点了重试推送又马上关窗」会让那次重试的结局
  // （成功或失败）落到一个已经被关掉的现场上：成功后弹 toast 关空窗、失败后又把弹窗
  // 弹回来。计数器让过期结果自己作废（见 doPushRetry 里的 token 比对）。
  const pushRetrySeq = React.useRef(0)
  // 失败的结构化判据：Host 在信封里给 reason === 'no-upstream'（Host 侧 opPush 里写着）。
  // 不去匹配文案——那句话一改语言或措辞就失效。
  // 失败的结构化判据由文件作用域的 isPushNoUpstream 提供（CommitArea 与 RepoCard 共用）
  const applyPushFail = (v, opts) => {
    if (opts && opts.abortRetry) pushRetrySeq.current++ // 作废在飞的重试
    setPushRetrying(false)
    setPushFail(v)
  }
  // 给 CommitArea 的两个只读查询：重试的 token 与「是否已过期」。
  // 这样子组件不必引用本层的 ref（跨层引用局部变量正是三次崩溃的根因）。
  const getPushRetryToken = () => pushRetrySeq.current
  const isPushRetryStale = (token) => token !== pushRetrySeq.current
  // 重试又失败：现场就地换成新的失败，保留 afterCommit / redo / branch——重试不产生新提交，
  // 撤回目标没变。raw / command 逐字段跟新失败走：重试若变成「无上游」（有意不给原文），
  // raw 必须清空，否则黑框会把上一次的原文接着显示成这次的原因。
  const onPushRetryFail = (res) => {
    const rawText = (res && res.error) || fmt(tr('failedSuffix'), { label: 'PUSH' })
    applyPushFail(pushFail ? Object.assign({}, pushFail, {
      error: rawText,
      raw: (res && res.detail) || '',
      command: (res && res.command) || '',
      noUpstream: isPushNoUpstream(res)
    }) : null)
  }
  // 弹窗动作由 CommitArea 计算（它才知道 doCommit 的现场），经这个 ref 交给本层渲染。
  // ref 必须由**读取方**（本组件，负责渲染 fixed 弹窗）声明，再当 prop 传给 CommitArea
  // 写入——两边共用同一个对象。曾把声明漏成两个同名 ref，结果读取方永远是空对象。
  // ⚠ 读取必须延迟到点击时（下面的 pushAct）：本组件先于 CommitArea 渲染，在 render
  // 体内取值只能拿到上一帧的闭包。
  const pushFailActions = React.useRef(null)
  const s = useStore()

  const loadStatus = React.useCallback(async () => {
    try {
      const r = await callRpc('status', { repoId: repo.id })
      if (r && r.ok) setStatus({ loading: false, data: r, error: '' })
      else setStatus({ loading: false, data: null, error: (r && r.error) || tr('statusLoadFailed') })
    } catch (e) { setStatus({ loading: false, data: null, error: e && e.message ? e.message : String(e) }) }
  }, [repo.id])

  React.useEffect(() => { loadStatus() }, [loadStatus])
  // 定向刷新：只刷新最近一次写操作涉及的仓库卡片（lastOpRepoId 为空时才全量刷新，
  // 避免多仓库面板一次操作触发 4×N 条并发 git 命令）
  React.useEffect(() => { if (s.refreshTick > 0 && (s.lastOpRepoId == null || s.lastOpRepoId === repo.id)) loadStatus() }, [s.refreshTick, s.lastOpRepoId, repo.id, loadStatus])
  React.useEffect(() => {
    if (s.lastOp === 'commit' && s.lastOpRepoId === repo.id && s.refreshTick > 0) setMessage('')
  }, [s.refreshTick, s.lastOp, s.lastOpRepoId, repo.id])

  const handleWriteResult = (res, label) => {
    if (res && res.ok) {
      // 弹窗「取消上次提交」走的是这条路（doUndoCommit 手动实现，见该处注释）：
      // 把被撤掉的提交短 hash 拼进 summary，toast 才有「已撤销提交 <hash>」这句
      // ——弹窗随成功一起关掉，这是用户唯一能看到撤销落点的地方。undoCommit 是
      // **只有撤销成功**才会带的标记（doUndoCommit 里设），所以拿它当判据不会误关。
      if (res.undoCommit) res.summary = (res.summary || tr('pushFailUndoDone')) + ' · ' + fmt(tr('pushFailUndoHash'), { h: res.undoCommit })
      // 「提交成功但推送失败」的现场一旦解决就关掉弹窗，两条路径：
      //   推送成功 —— 现场已过期，留着它会挂着一个早已推上去的提交继续提供
      //               「取消上次提交」（撤已推送的提交＝本地与远端分叉）；
      //   撤销成功 —— 那个提交已经不存在了，留着它同样是错的：按钮还能再点一次，
      //               而再按一次撤的是「新 HEAD~1」，也就是本不属于这次推送失败的提交。
      // label 大小写不统一（doCommit 传 'PUSH'，runWrite 传 'push'），按小写比对。
      if (String(label).toLowerCase() === 'push' || res.undoCommit) applyPushFail(null)
      pushToast('success', res.summary || fmt(tr('doneSuffix'), { label }))
      store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: label === 'COMMIT' ? 'commit' : 'write', lastOpRepoId: repo.id }))
      return 'ok'
    }
    pushToast('error', (res && res.error) || fmt(tr('failedSuffix'), { label }))
    return 'error'
  }

  const runWrite = async (label, call) => {
    if (busy) return
    setBusy(label)
    // 返回 'ok' / 'error'（busy 早退返回 undefined）：批量操作据成败决定是否清空多选
    try { return handleWriteResult(await call(), label) } catch (e) { pushToast('error', fmt(tr('failedWith'), { label, e: e && e.message ? e.message : String(e) })) }
    finally { setBusy(null) }
  }

  // 暂存 / 取消暂存：可逆的本地 index 操作，直接执行
  const stage = (paths) => runWrite('stage', () => callRpc('stage', { repoId: repo.id, files: paths, sessionId }))
  const unstage = (paths) => runWrite('unstage', () => callRpc('unstage', { repoId: repo.id, files: paths, sessionId }))
  // 放弃更改（不可逆）：分组标题 = 放弃全部，文件行 = 放弃单个文件
  const discard = (paths, group) => runWrite('discard', () => callRpc('discard', { repoId: repo.id, files: paths, group, sessionId }))
  // 完成合并：冲突已全部解决、且解决结果与 HEAD 一致（无暂存差异）时的收尾出口。
  // 与提交同级（只写一个提交、非破坏性），走直接执行 + toast，不弹确认窗。
  const finishMerge = () => runWrite('merge-commit', async () => {
    const res = await callRpc('mergeCommit', { repoId: repo.id, sessionId })
    if (res && res.ok && !res.summary) res.summary = tr('mergeFinishDone')
    return res
  })
  // 分组展开/收起（最左侧 chevron）
  const [groupsOpen, setGroupsOpen] = React.useState({ conflicted: true, staged: true, unstaged: true, untracked: true })
  const toggleGroup = (g) => setGroupsOpen((o) => ({ ...o, [g]: !o[g] }))

  const openBranchMenu = () => {
    setBranchMenu((b) => ({ ...b, open: !b.open }))
    if (!branchMenu.open && !branchMenu.data && !branchMenu.loading) {
      setBranchMenu((b) => ({ ...b, loading: true }))
      callRpc('branches', { repoId: repo.id }).then((r) => setBranchMenu((b) => ({ ...b, loading: false, data: r && r.ok ? r : null, error: r && r.ok ? '' : (r && r.error) || tr('branchesLoadFailed') }))).catch((e) => setBranchMenu((b) => ({ ...b, loading: false, error: e && e.message ? e.message : String(e) })))
    }
  }

  const openMoreMenu = () => {
    setMoreMenu((m) => ({ ...m, open: !m.open }))
  }

  const closeAllMenus = () => {
    setBranchMenu((b) => ({ ...b, open: false }))
    setMoreMenu((m) => ({ ...m, open: false }))
  }

  const data = status.data
  const stagedPaths = data ? data.staged.map((f) => f.path) : []
  const totalStaged = data ? data.staged.length : 0
  const totalUnstaged = data ? data.unstaged.length : 0
  const totalUntracked = data ? data.untracked.length : 0
  const totalConflicted = data && data.conflicted ? data.conflicted.length : 0
  const mergeInProgress = !!(data && data.mergeInProgress)
  // rebase / cherry-pick / revert 进行中（host 只在「有冲突」或「HEAD detached」时探测，
  // 见 repoStatus）：这三者的冲突同样进冲突组，但收尾出口不在面板里，提示条与提交
  // 按钮的文案都要区分开，否则会把用户引到「提交即完成合并」这条错路上。
  const otherOp = (data && data.otherOp) || null
  // 完成合并将使用的提交信息（host 读 .git/MERGE_MSG 的第一行非注释内容）
  const mergeMessage = (data && data.mergeMessage) || null
  // 合并已无冲突、但解决结果与 HEAD 一致（无可提交的暂存差异）：此时只有「完成合并」能收尾
  const finishMergeOnly = mergeInProgress && totalConflicted === 0 && totalStaged === 0

  // ===== 多选 / 激活行 / 放弃确认（均需 data，置于其后） =====
  // 激活行 = diff 抽屉正展示的行（同一文件可同时出现在 staged/unstaged 两组，须带组判定）。
  // 多选状态机见 useMultiSelect：修饰键点击不切换 diff（多选只为批量操作服务，
  // diff 抽屉保持当前文件不动）
  const activeKey = diffSel && diffSel.repoId === repo.id ? rowKey(diffSel.group, diffSel.path) : null
  const { selKeys, setSelKeys, onRowClick, selParts, selCount } = useMultiSelect(data, groupsOpen, activeKey, (f, group) => onOpenDiff(repo, f, group))

  // 激活行随操作移组/消失时自动关闭 diff 抽屉，避免抽屉展示过期内容；
  // 提交内 diff（group='commit'）的目标来自历史而非工作区变更集，不适用此守卫
  React.useEffect(() => {
    if (!data || !diffSel || diffSel.repoId !== repo.id) return
    if (diffSel.group === 'commit') return
    const list = data[diffSel.group]
    const alive = Array.isArray(list) && list.some((f) => f.path === diffSel.path)
    if (!alive && onCloseDiff) onCloseDiff()
  }, [data, diffSel, repo.id, onCloseDiff])

  // Esc 分层：推送失败弹窗 > 危险操作确认 > 放弃确认 > 清空多选 > 关 diff 抽屉。
  // capture 阶段拦截，阻止抽屉的 bubble 阶段 Esc 监听在同一按键里同时触发
  //（先关弹窗又顺手关掉抽屉）。
  // 推送失败弹窗排在最前：它是模态的，Esc 必须落在它身上——否则 Esc 会穿过去清掉弹窗
  // **背后**的多选（面板明明被遮罩挡住，选择却被清空，现场就丢了）。
  // ⚠ 与遮罩点击同款地判 busy：撤销进行中（busy === 'reset'）时按钮全禁用，Esc 也不能关，
  // 否则「重试推送 / 复制」这些出口会在最不该丢现场的时候消失。busy 时这条分支**仍然吃掉
  // 这次按键**（stopPropagation 后直接 return），只是不关窗：既不误关弹窗，也不让它穿到
  // 后面去清多选——即 busy 期间按 Esc 整体无效果。
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (pushFail) { if (!busy) setPushFail(null); e.stopPropagation(); return }
      if (confirmDanger) { setConfirmDanger(null); e.stopPropagation(); return }
      if (confirmDiscard) { setConfirmDiscard(null); e.stopPropagation(); return }
      if (selKeys.size > 0) { setSelKeys(new Set()); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirmDiscard, confirmDanger, selKeys, pushFail, busy])

  // 放弃更改确认：所有入口（单行 / 组全部 / 多选批量）统一先弹确认
  const askDiscard = (paths, group) => {
    if (!paths || paths.length === 0) return
    const byGroup = { staged: [], unstaged: [], untracked: [] }
    byGroup[group] = paths.slice()
    setConfirmDiscard({ byGroup, count: paths.length })
  }
  const askDiscardSelection = () => {
    if (selCount === 0) return
    setConfirmDiscard({ byGroup: { staged: selParts.staged.slice(), unstaged: selParts.unstaged.slice(), untracked: selParts.untracked.slice() }, count: selCount })
  }
  const doDiscardConfirmed = async () => {
    const parts = confirmDiscard && confirmDiscard.byGroup
    setConfirmDiscard(null)
    if (!parts) return
    let allOk = true
    for (const g of ['staged', 'unstaged', 'untracked']) {
      if (parts[g] && parts[g].length > 0 && (await discard(parts[g], g)) !== 'ok') allOk = false
    }
    if (allOk) setSelKeys(new Set())
  }
  const discardPreviewText = (cd) => {
    const names = []
    for (const g of ['staged', 'unstaged', 'untracked']) for (const p of cd.byGroup[g]) names.push(p)
    const MAX = 5
    return names.length > MAX ? names.slice(0, MAX).join('\n') + '\n' + fmt(tr('discardMore'), { n: names.length - MAX }) : names.join('\n')
  }

  const renderGroup = (group, list) => {
    list = list || []
    // 「更改」为空时仍保留标题行（占位提示）；其余分组（含冲突组）为空时整组隐藏
    if (list.length === 0 && group !== 'unstaged') return null
    const meta = GROUP_META[group]
    const paths = list.map((f) => f.path)
    const open = groupsOpen[group] !== false
    const isStaged = group === 'staged'
    // 冲突组：该行的 ＋ 语义是「标记为已解决」（host 对未合并路径执行 git add），
    // 而放弃更改对未合并路径没有确定语义（--ours/--theirs 对用户是歧义），
    // 因此冲突行不给放弃按钮，整体出口由下方提示条的「中止合并」提供。
    const isConflicted = group === 'conflicted'
    const hasItems = list.length > 0
    return React.createElement('div', { className: 'gp-section', key: group },
      React.createElement('div', { className: 'gp-section-title', onClick: () => toggleGroup(group) },
        React.createElement('button', { className: 'gp-chev', onClick: (e) => { e.stopPropagation(); toggleGroup(group) } }, icon(open ? 'chevronDown' : 'chevronRight', 13)),
        React.createElement('span', { className: 'gp-section-label' }, tr(meta.titleKey)),
        React.createElement('span', { className: 'gp-spacer' }),
        hasItems ? React.createElement('span', { className: 'gp-row-actions' },
          isConflicted ? null : React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); askDiscard(paths, group) } }, icon('discard')),
          isStaged
            ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstageAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstage(paths) } }, icon('minus'))
            : React.createElement('button', { className: 'gp-icon-btn', title: isConflicted ? tr('resolveAll') : fmt(tr('stageAll'), { n: list.length }), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stage(paths) } }, icon('plus'))) : null,
        hasItems ? React.createElement('span', { className: 'gp-group-count', title: fmt(tr('groupCount'), { n: list.length }) }, list.length) : null),
      !open ? null : list.map((f) => {
        // DD（双方都删）冲突的解决结果就是删除，保留删除线；其余冲突码上的 U 只是
        // 「未合并」标记，加删除线会误导（DU/UD 的文件仍带着内容）
        const gl = isConflicted ? { g: 'U', cls: 'gp-g-conflict', del: f.x === 'D' && f.y === 'D' } : glyphOf(f.x, f.y)
        const { base, dir } = splitPath(f.path)
        const key = rowKey(group, f.path)
        const cls = 'gp-file-row' + (activeKey === key ? ' gp-file-active' : '') + (selKeys.has(key) ? ' gp-file-sel' : '')
        return React.createElement('div', {
          className: cls, key: group + ':' + f.path, title: f.path,
          // 修饰键点击阻止原生文本选区/焦点抢占（Shift 框选会带出蓝色选区）
          onMouseDown: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault() },
          onClick: (e) => onRowClick(e, f, group)
        },
          React.createElement('span', { className: 'gp-file-dot ' + gl.cls }, '•'),
          // D（删除）类型文件：文件名加删除线（见 .gp-file-name-del）；暂存/未暂存组均适用，
          // 未跟踪组状态恒为 U 不受影响；冲突组仅 DD（双方都删）命中
          React.createElement('span', { className: 'gp-file-name' + (gl.del || gl.g === 'D' ? ' gp-file-name-del' : '') }, base),
          dir ? React.createElement('span', { className: 'gp-file-dir' }, dir) : null,
          f.orig ? React.createElement('span', { className: 'gp-file-orig', title: f.orig }, '← ' + (f.orig.replace(/\/+$/, '').split('/').pop() || f.orig)) : null,
          React.createElement('span', { className: 'gp-spacer' }),
          React.createElement('span', { className: 'gp-row-actions' },
            isConflicted ? null : React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardFile'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); discardFromRow(key, f.path, group) } }, icon('discard')),
            isStaged
              ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstageFromRow(key, f.path) } }, icon('minus'))
              : React.createElement('button', { className: 'gp-icon-btn', title: isConflicted ? tr('resolveFile') : tr('stage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stageFromRow(key, f.path) } }, icon('plus'))),
          React.createElement('span', { className: 'gp-file-badge ' + gl.cls }, gl.g))
      }))
  }

  // 批量操作（无独立工具栏）：多选后点击任一选中行的
  // 放弃/暂存/取消暂存按钮即作用于全部选中文件；点击未选中行的按钮仅作用于该行
  const inSelection = (key) => selKeys.has(key) && selCount > 0
  const stageFromRow = async (key, path) => {
    if (!inSelection(key)) { stage([path]); return }
    if ((await stage(selParts.unstaged.concat(selParts.untracked))) === 'ok') setSelKeys(new Set())
  }
  const unstageFromRow = async (key, path) => {
    if (!inSelection(key)) { unstage([path]); return }
    if ((await unstage(selParts.staged)) === 'ok') setSelKeys(new Set())
  }
  const discardFromRow = (key, path, group) => {
    if (inSelection(key)) askDiscardSelection()
    else askDiscard([path], group)
  }

  // 放弃更改确认弹窗（单行 / 组全部 / 多选批量统一入口；Esc 由上方分层处理关闭）
  const discardModal = confirmDiscard ? React.createElement(ConfirmModal, {
    title: tr('discardTitle'),
    body: React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'gp-confirm-summary' },
        fmt(confirmDiscard.count === 1 ? tr('discardConfirm1') : tr('discardConfirmN'), { n: confirmDiscard.count })),
      React.createElement('div', { className: 'gp-confirm-note gp-danger' }, tr('discardIrreversible')),
      confirmDiscard.byGroup.untracked.length > 0 ? React.createElement('div', { className: 'gp-confirm-note' }, tr('discardUntrackedNote')) : null,
      React.createElement('div', { className: 'gp-confirm-files' }, discardPreviewText(confirmDiscard))),
    okLabel: tr('discardOk'), busy,
    onCancel: () => setConfirmDiscard(null),
    onOk: doDiscardConfirmed
  }) : null

  // 危险操作确认弹窗（Reset / Clean / 中止合并）：结构同放弃更改弹窗，Esc 由上方分层处理关闭
  const DANGER_INFO = {
    'reset-soft': { title: tr('resetSoftTitle'), note: tr('resetSoftNote') },
    'reset-hard': { title: tr('resetHardTitle'), note: tr('resetHardNote') },
    'clean': { title: tr('cleanTitle'), note: tr('cleanNote') },
    'merge-abort': { title: tr('mergeAbortTitle'), note: tr('mergeAbortNote') }
  }
  const dangerModal = confirmDanger ? React.createElement(ConfirmModal, {
    title: DANGER_INFO[confirmDanger].title,
    body: React.createElement('div', { className: 'gp-confirm-note gp-danger' }, DANGER_INFO[confirmDanger].note),
    okLabel: confirmDanger === 'merge-abort' ? tr('mergeAbortOk') : tr('dangerRun'), busy,
    onCancel: () => setConfirmDanger(null),
    onOk: () => {
      const op = confirmDanger
      setConfirmDanger(null)
      if (op === 'clean') runWrite('clean', () => callRpc('clean', { repoId: repo.id, sessionId }))
      else if (op === 'merge-abort') runWrite('merge-abort', async () => {
        const res = await callRpc('mergeAbort', { repoId: repo.id, sessionId })
        if (res && res.ok && !res.summary) res.summary = tr('mergeAbortDone')
        return res
      })
      else runWrite('reset', () => callRpc('reset', { repoId: repo.id, mode: op === 'reset-hard' ? 'hard' : 'soft', sessionId }))
    }
  }) : null

  // 推送失败弹窗（提交成功、推送失败时的收尾出口）。
  // 三个按钮：重试推送 / 取消上次提交 / 关闭——关掉只是先不管，本地提交仍在，
  // 之后可以从「更多操作 → Push」再推（推送成功会自动关掉本弹窗，见 handleWriteResult）。
  // 报错原文用一个等宽框直接整段显示（见 pushFailText），不做展开收起、也没有复制出口：
  // 屏幕先要给出「失败、提交还在、有哪几条路」这个结论，而 git 原文要看就能看到。
  // 动作由 CommitArea 经 ref 写进来。⚠ 必须**点击时**才读 ref：CommitArea 是在它自己的
  // render 体内写入的，而本组件（父）先于子渲染——在这里就地取值拿到的是**上一轮**的闭包
  //（那时 pushFail 还是 null），撤销会因此丢掉 expectHash 校验与提交信息恢复。
  // 点击发生在渲染之后，届时 ref 里已是最新一帧的闭包。
  // 弹窗里那个框要显示什么文本。**必须定义在本组件（弹窗的渲染方）里**：上一版把它
  // 写在 CommitArea 里，而 RepoCard 的 render 里调用它——跨组件作用域引用，弹窗一出现
  // 就是 ReferenceError: pushFailText is not defined（和此前 pushDetailOpen 同一类错）。
  // 规则：优先 git 自己的输出（Host 的 fail(...).detail → 信封 error.details.detail →
  // unwrapRpc 摊平成 res.detail）；没有原文时（无上游那条路径有意不给）退回 Host 定稿的
  // 建议命令，最后才退到占位符——保证框里永远有可执行的下一步，而不是空白。
  // 建议命令优先用 **Host 实测出来的那一条**（opPush 把 `git push -u <remote> <branch>`
  // 放进了信封的 details.command）。remote 取自 branch.<b>.remote、缺失才回落 origin，
  // 所以客户端不能自己拼 origin——那会在 remote 不是 origin 的仓库里给出与面板正文
  // 不一致的命令；取不到 command 时才退回按 branch 拼（老 Host / 异常路径）。

        // 动作由 CommitArea 经 ref 写进来（doCommit 的现场只有它知道）。⚠ ref 必须由**读取方**
        // （本组件，负责渲染 fixed 弹窗）声明、当 prop 传给 CommitArea 写入——两边共用同一个对象；
        // 且必须**点击时**才读（pushAct）：本组件先于 CommitArea 渲染，render 体内取值只能拿到
        // 上一轮的闭包。弹窗本体在 ./PushFailModal.js（props 进出，无跨层状态写入）。
        const pushAct = (name) => { const a = pushFailActions.current; if (a && a[name]) a[name]() }
        const pushFailModal = pushFail ? React.createElement(PushFailModal, { pushFail, busy, pushRetrying, onAct: pushAct }) : null


  // 分支菜单：切换已有分支 + 新建分支（首次打开才加载分支列表）
  const branchMenuEl = branchMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
    branchMenu.loading ? React.createElement('div', { className: 'gp-menu-note' }, tr('loadingBranches')) : branchMenu.error ? React.createElement('div', { className: 'gp-menu-note' }, branchMenu.error) :
      React.createElement('div', null,
        (branchMenu.data && branchMenu.data.branches ? branchMenu.data.branches : []).map((b) => React.createElement('button', { key: b.name, className: 'gp-menu-item', onClick: () => { setBranchMenu((x) => ({ ...x, open: false })); if (!b.current) runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: b.name, create: false, sessionId })) } },
          React.createElement('span', { style: { width: 14, display: 'inline-flex', justifyContent: 'center' } }, b.current ? icon('check', 12) : null),
          b.name + (b.upstream ? '  → ' + b.upstream : ''))),
        React.createElement('div', { className: 'gp-menu-sep' }),
        branchMenu.creating ? React.createElement('div', { className: 'gp-menu-note' },
          React.createElement('input', { className: 'gp-menu-input', autoFocus: true, value: branchMenu.newName, placeholder: tr('newBranchName'), onChange: (e) => setBranchMenu((x) => ({ ...x, newName: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter' && branchMenu.newName.trim()) { setBranchMenu((x) => ({ ...x, open: false, creating: false })); runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: branchMenu.newName.trim(), create: true, sessionId })) } } }),
          React.createElement('button', { className: 'gp-btn', style: { marginTop: 4 }, onClick: () => { const nm = branchMenu.newName.trim(); setBranchMenu((x) => ({ ...x, open: false, creating: false })); if (nm) runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: nm, create: true, sessionId })) } }, tr('createAndSwitch'))) :
          React.createElement('button', { className: 'gp-menu-item', onClick: () => setBranchMenu((x) => ({ ...x, creating: true, newName: '' })) }, icon('plus', 12), tr('newBranch')))
  ) : null

  // 更多操作菜单：Pull / Push / Stash + 危险操作（Reset / Clean，弹确认窗）
  const moreMenuEl = moreMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, tr('morePull')),
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('push', () => callRpc('push', { repoId: repo.id, sessionId })) } }, tr('morePush')),
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash', () => callRpc('stashPush', { repoId: repo.id, message: 'stash @ ' + new Date().toLocaleString(), sessionId })) } }, tr('moreStash')),
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash-pop', () => callRpc('stashPop', { repoId: repo.id, ref: null, sessionId })) } }, tr('moreStashPop')),
    React.createElement('div', { className: 'gp-menu-sep' }),
    // 合并进行中才出现：pull 冲突后「中止合并」是唯一出口，但它同样会丢弃已解决的
    // 内容，仍走确认弹窗（与 Reset/Clean 同级）
    mergeInProgress ? React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('merge-abort') } }, tr('mergeAbortMenu')) : null,
    // 危险操作：弹确认窗（与放弃更改同款），确认后执行
    React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-soft') } }, tr('moreResetSoft')),
    React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-hard') } }, tr('moreResetHard')),
    React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('clean') } }, tr('moreClean'))
  ) : null

  const head = React.createElement('div', { className: 'gp-repo-head', onClick: () => setCollapsed((c) => !c) },
    React.createElement('button', { className: 'gp-btn-icon', onClick: (e) => { e.stopPropagation(); setCollapsed((c) => !c) } }, icon(isCollapsed ? 'chevronRight' : 'chevronDown')),
    React.createElement('span', { className: 'gp-repo-name', title: repo.path }, repo.name),
    data ? React.createElement('span', { className: 'gp-branch' }, icon('branch', 12), data.branch) : null,
    data && data.aheadBehind ? React.createElement('span', { className: 'gp-count', title: fmt(tr('behindAhead'), { b: data.aheadBehind.behind, a: data.aheadBehind.ahead }) }, icon('arrowDown', 12), data.aheadBehind.behind, ' ', icon('arrowUp', 12), data.aheadBehind.ahead) : null,
    data && totalStaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-staged', title: fmt(tr('stagedNTitle'), { n: totalStaged }) }, icon('dot', 7), totalStaged) : null,
    // 冲突计数放在三组计数之前：折叠面板时它是唯一还能看见的冲突信号
    data && totalConflicted > 0 ? React.createElement('span', { className: 'gp-count gp-count-conflict', title: fmt(tr('conflictedNTitle'), { n: totalConflicted }) }, icon('warning', 12), totalConflicted) : null,
    data && totalUnstaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-unstaged', title: fmt(tr('unstagedNTitle'), { n: totalUnstaged }) }, icon('dot', 7), totalUnstaged) : null,
    data && totalUntracked > 0 ? React.createElement('span', { className: 'gp-count gp-count-untracked', title: fmt(tr('untrackedNTitle'), { n: totalUntracked }) }, icon('dot', 7), totalUntracked) : null,
    React.createElement('span', { className: 'gp-spacer' }),
    /* 仓库级「刷新状态」按钮已移除：状态刷新统一由顶部「重新扫描」（全量）+ 自动轮询（定向）触发；
       加载期间在原位置放一个等宽 spinner 占位，保留加载反馈且不抖动布局 */
    status.loading ? React.createElement('span', { className: 'gp-btn-icon', style: { cursor: 'default' } }, React.createElement('span', { className: 'gp-spinner' })) : null,
    React.createElement('button', { className: 'gp-btn-icon', title: tr('pullTitle'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, busy === 'pull' ? React.createElement('span', { className: 'gp-spinner' }) : icon('pull')),
    React.createElement('div', { className: 'gp-menu-wrap' },
      React.createElement('button', { className: 'gp-btn-icon', title: tr('switchBranch'), onClick: (e) => { e.stopPropagation(); openBranchMenu() } }, icon('branch')),
      branchMenuEl),
    React.createElement('div', { className: 'gp-menu-wrap' },
      React.createElement('button', { className: 'gp-btn-icon', title: tr('moreActions'), onClick: (e) => { e.stopPropagation(); openMoreMenu() } }, icon('ellipsis')),
      moreMenuEl),
    (branchMenu.open || moreMenu.open) ? React.createElement('div', { className: 'gp-menu-backdrop', onClick: (e) => { e.stopPropagation(); closeAllMenus() } }) : null)

  const body = isCollapsed ? null :
    React.createElement('div', null,
      status.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingStatus')) : status.error ? React.createElement('div', { className: 'gp-empty' }, status.error) :
        React.createElement('div', null,
          React.createElement(CommitArea, { repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus: loadStatus, conflictedCount: totalConflicted, otherOp, pushFail, onPushFail: applyPushFail, onPushRetryFail, getPushRetryToken, isPushRetryStale, pushRetrying, setPushRetrying, pushFailActions }),
          data && data.statusError ? React.createElement('div', { className: 'gp-empty gp-danger' }, fmt(tr('gitStatusFailed'), { e: data.statusError })) : null,
          // 冲突提示条：未解决冲突 / 合并进行中 / rebase 等进行中时出现，给出动作说明 + 出口按钮。
          // 「完成合并」只在「合并进行中且冲突已全部解决、暂存为空」时出现——那种状态下解决
          // 结果与 HEAD 一致，git status 完全为空（文件既不在冲突组也不在暂存组），提交按钮
          // 因此点不下去，而 git 本身允许直接 commit 收尾（见 host opMergeCommit）。
          // 同一状态还有第二种来路：解决后又取消了暂存——此时解决结果在工作区却没进 index，
          // 所以文案要按 totalUnstaged 分流，不能一律宣称「与 HEAD 一致」。
          // rebase / cherry-pick / revert 冲突（otherOp）不给「完成合并」也不给「中止合并」：
          // 它们的收尾出口（--continue / --skip / --abort）不在面板里，只做指引。
          (totalConflicted > 0 || mergeInProgress || otherOp) ? React.createElement('div', { className: 'gp-conflict-bar' },
            icon('warning', 14),
            React.createElement('span', { className: 'gp-conflict-text' },
              totalConflicted > 0
                ? (otherOp ? fmt(tr('conflictBarOtherOp'), { n: totalConflicted, op: otherOp }) : fmt(tr('conflictBar'), { n: totalConflicted }))
                : otherOp ? fmt(tr('conflictBarOtherOpResolved'), { op: otherOp })
                  : finishMergeOnly ? (totalUnstaged > 0 ? tr('conflictBarUnstaged') : tr('conflictBarNoStaged'))
                    : tr('conflictBarResolved')),
            finishMergeOnly ? React.createElement('button', { className: 'gp-btn gp-btn-primary gp-conflict-finish', title: mergeMessage ? fmt(tr('mergeFinishTitleWith'), { m: mergeMessage }) : tr('mergeFinishTitle'), disabled: !!busy, onClick: finishMerge }, busy === 'merge-commit' ? tr('mergeFinishTitle') + '…' : tr('mergeFinishTitle')) : null,
            mergeInProgress ? React.createElement('button', { className: 'gp-btn gp-btn-danger gp-conflict-abort', title: tr('mergeAbortMenu'), disabled: !!busy, onClick: () => setConfirmDanger('merge-abort') }, busy === 'merge-abort' ? tr('mergeAbortTitle') + '…' : tr('mergeAbortTitle')) : null) : null,
          !(data && data.statusError) && totalStaged + totalUnstaged + totalUntracked + totalConflicted === 0 ? React.createElement('div', { className: 'gp-empty', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, icon('check', 13), tr('treeClean')) : null,
          // 冲突组置顶：它决定后续能不能提交，优先于常规三组
          renderGroup('conflicted', data && data.conflicted),
          renderGroup('staged', data && data.staged),
          renderGroup('unstaged', data && data.unstaged),
          renderGroup('untracked', data && data.untracked)),
      React.createElement('div', { className: 'gp-history-head', onClick: () => setHistoryOpen((o) => !o) },
        icon(historyOpen ? 'chevronDown' : 'chevronRight', 12),
        icon('history'),
        tr('history')),
      historyOpen ? React.createElement(GitGraphView, { repo, onOpenDiff, diffSel }) : null)

  // 确认弹窗用 fixed 定位，放在卡片外层（Fragment），避免任何卡片内堆叠上下文干扰
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'gp-repo-card' }, head, body),
    discardModal,
    dangerModal,
    pushFailModal)
}
export { RepoCard }
