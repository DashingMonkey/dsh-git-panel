/** 提交区：生成（含终止/进度）、提交、提交并推送，仅处理已暂存（staged）文件。
 *  推送失败现场只经 onPushFail/onPushRetryFail 上报（状态由 RepoCard 持有）。 */
import React from 'react'
import { callRpc, isPushNoUpstream } from '../../api.js'
import { tr, fmt } from '../../i18n.js'
import { getTimer } from '../../runtime.js'
import { pushToast, store } from '../../store.js'
import { icon } from '../../icons.js'
import { RuleEditorModal } from '../RuleEditorModal.js'
import { GenModelModal } from '../GenModelModal.js'
// 提交区：仅处理已暂存（staged）文件——生成 / 提交 / 提交并推送都基于 stagedPaths。
// conflictedCount > 0 时提交按钮禁用：git 自己也会拒绝（"Committing is not possible
// because you have unmerged files"，实测 exit 128），面板提前把原因写在按钮提示里。
// otherOp 不拦提交（实测 rebase / cherry-pick 冲突解决后 git 接受该提交并据此收尾），
// 只在提示里说明它会成为该操作的提交、并替换掉原提交信息。
function CommitArea({ repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus, conflictedCount, otherOp, pushFail, onPushFail, onPushRetryFail, getPushRetryToken, isPushRetryStale, pushRetrying, setPushRetrying, pushFailActions }) {
  const [rulesMenuOpen, setRulesMenuOpen] = React.useState(false)
  const [rulesInfo, setRulesInfo] = React.useState(null)
  const [openRules, setOpenRules] = React.useState(false)
  const [openGenModel, setOpenGenModel] = React.useState(false)
  // 当前生效的生成模型（用于菜单显示 + 生成按钮 hover 提示）；null=跟随会话
  const [genModel, setGenModel] = React.useState(null)
  const loadGenModel = React.useCallback(() => {
    callRpc('genModelGet', {}).then((r) => {
      if (r && r.ok) {
        const cfg = r.configured
        const eff = r.effective
        let label
        if (cfg) {
          label = cfg.model
          if (cfg.reasoningEffort) label += fmt(tr('genModelThinkingParen'), { e: cfg.reasoningEffort === 'off' ? tr('genModelEffortOff') : cfg.reasoningEffort === 'high' ? tr('genModelEffortHigh') : tr('genModelEffortMax') })
        } else if (eff) {
          // 跟随会话默认：模型名 + （默认）标记
          label = eff.model + tr('genModelDefaultMark')
        } else {
          label = '-' + tr('genModelDefaultMark')
        }
        setGenModel(label)
      }
    }).catch(() => {})
  }, [])
  React.useEffect(() => { loadGenModel() }, [loadGenModel])
  // 卸载中断标志：doGenerate 的轮询循环在组件卸载（面板关闭/重挂载）后必须停止，
  // 否则旧循环在后台无限发 generatePoll 且与新循环叠加
  const genAliveRef = React.useRef(true)
  // 当前生成任务 id：doGenerate 里是局部变量，停止按钮够不着，必须放到 ref 上。
  // 同一面板实例同一时刻只会有一个在跑的生成（busy 把生成按钮锁住了）。
  const genIdRef = React.useRef(null)
  // 已点停止、等 host 确认的过渡态：与 busy 分开——点击后按钮立刻变「停止中…」，
  // 但 busy 仍保持 'generate'，否则按钮会瞬间跳回「生成」让人以为没生效而反复点击
  const [cancelling, setCancelling] = React.useState(false)
  // 生成进度（秒 + 已生成字数）：纯粹为了让人判断「在慢慢吐字」还是「卡住了」
  const [genProgress, setGenProgress] = React.useState(null)
  // host 确认的「此刻确实在跑」：busy 是本地状态，点了停止之后它仍为 'generate'，
  // 但那时已经不该再转圈了，所以存活指示单独用一个状态
  const [generatingNow, setGeneratingNow] = React.useState(false)
  const genStartRef = React.useRef(0)

  // 请求终止某一次生成，带退避重试。
  // 为什么要重试：Client 点「停止」可能发生在 Host 把任务放进 genTasks **之前**
  // （generate RPC 还在路上）。此时 generateCancel 会查无此任务——而「查无任务」在
  // 生成尚未返回时是**暂时**的，过一会儿就能命中。不重试就会出现「点了停止、按钮正常、
  // 实际没停」这种最糟的表现。
  // shouldRetry：**只约束重试，不约束首枪**——首枪必发，否则「终止」会静默失效
  //（曾经把闸门放在首枪前面：卸载路径传 () => false，于是一次 generateCancel 都发不
  //  出去，面板关了 Host 侧还在烧 token）。默认要求 genIdRef 仍指向这次生成（重试期间
  // 用户又发起新生成时必须停手，否则会把新任务误停）；卸载路径传 () => false = 只发
  // 一次；超时路径传 () => true 沿用老行为（它紧跟着就清空引用）。判断在预检里做。
  // 两个回调**各自独立**，都只在「重试耗尽（约 1.2s 没命中，说明已完成/已过期），
  // 且组件还活着、这次生成仍是当前生成」时触发：
  //   onGiveUp（UI 复位）与 onLate（补提示）用途不同，绑在同一个参数上会让只想要
  //   复位的那条路径因为传 null 而连复位也丢掉。
  const cancelGen = (genId, onGiveUp, onLate, shouldRetry) => {
    const isAlive = () => genIdRef.current === genId
    const canRetry = shouldRetry || isAlive
    let tries = 0
    let stopped = false
    const attempt = () => {
      if (stopped || (tries > 0 && !canRetry())) return
      callRpc('generateCancel', { genId }).then((r) => {
        if (stopped || !canRetry()) return
        if (r && r.ok && r.cancelled) return                      // 已受理，收尾交给轮询循环
        if (++tries > 10) {                                       // 约 1.2s 仍未命中：已完成/已过期
          if (genAliveRef.current && isAlive()) {
            if (onGiveUp) onGiveUp()
            if (onLate) onLate()
          }
          return
        }
        getTimer().timeout(attempt, 120)
      }).catch(() => { stopped = true })                           // 通道不可达：放弃，轮询循环会兜底
    }
    attempt()
  }

  React.useEffect(() => () => {
    genAliveRef.current = false
    // 面板关闭/重挂载时把 host 侧还在跑的生成一起终止：否则面板没了、LLM 还在烧 token，
    // 只能等 60s 后任务被回收。卸载后不能再 setState / pushToast，所以只发 RPC、不提示。
    // shouldRetry 传 () => false：卸载后组件已死，重试窗口里再发 RPC 只是白打，发一次
    // 拿结果就够（那一次的预检此时仍为真，首枪照样发得出去）。
    const id = genIdRef.current
    genIdRef.current = null
    if (id) cancelGen(id, null, null, () => false)
  }, [])
  const canCommit = message.trim() !== '' && stagedPaths.length > 0 && busy === null && !conflictedCount
  const lineCount = Math.min(6, Math.max(2, (message.match(/\n/g) || []).length + 1))

  const doGenerate = async () => {
    if (busy) return
    setBusy('generate')
    setCancelling(false)
    genStartRef.current = Date.now()
    setGenProgress(fmt(tr('genProgress'), { s: 0, n: 0 }))
    // 从点下去就亮存活指示：读 diff 的准备阶段虽然没有流式输出，但确实在干活，
    // 而且这正是「点了没反应」最容易让人怀疑卡死的阶段
    setGeneratingNow(true)
    // 乐观 genId：Host 的 prepareGenerate（逐文件 git diff，多文件仓库要数秒）发生在
    // generate RPC 返回之前。若等 RPC 回来才拿 genId，这段时间点「停止」会落在空处。
    // 所以先本地生成一个 id，经 clientGenId 交给 Host 用作任务 id（Host 侧有格式校验，
    // 不合规会自己另生成，那时的提前取消会退化成「停止中…直到有结果」而不是误中断）。
    genIdRef.current = 'gen-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    try {
      // 生成前先刷新仓库状态：生成基于 staged diff，必须用最新的 staged 文件列表
      //（外部改动/自动刷新延迟可能让面板列表过期，导致漏掉刚暂存或带上已取消暂存的文件）。
      let paths = stagedPaths
      try {
        const st = await callRpc('status', { repoId: repo.id })
        if (st && st.ok && Array.isArray(st.staged)) {
          paths = st.staged.map((f) => f.path)
          if (refreshStatus) refreshStatus()
        }
      } catch (e) { /* 刷新失败时退用面板现有列表 */ }
      if (paths.length === 0) { pushToast('error', tr('stageFirst')); return }
      const r = await callRpc('generate', { repoId: repo.id, files: paths, clientGenId: genIdRef.current })
      if (!(r && r.ok)) {
        // Host 在准备 diff 阶段被终止：错误串里带 gen-stopped 标记。这时**不能**弹生成失败
        // —— doCancelGenerate 已经/即将弹出「已停止」，再弹一个红色错误就是自相矛盾。
        if (!(r && typeof r.error === 'string' && r.error.indexOf('gen-stopped') >= 0)) {
          pushToast('error', (r && r.error) || tr('genFailedKeep'))
        }
        return
      }
      const genId = r.genId
      genIdRef.current = genId
      let fails = 0
      // 整体超时兜底：Host 端 LLM 挂起时 generatePoll 会永远返回未完成，
      // 无超时则 busy 永久卡死（180s 覆盖慢模型的正常生成）
      const deadline = Date.now() + 180000
      while (true) {
        // 组件已卸载（面板关闭/重挂载）：停止轮询（finally 的 setBusy 为卸载后 no-op）
        if (!genAliveRef.current) return
        if (Date.now() > deadline) {
          pushToast('error', tr('genTimeout'))
          // 超时也要真的把 Host 侧任务停掉，否则 180s 后照样继续烧 token。
          // shouldRetry 传恒真：判断在每次 attempt 的预检里做，而下面 break 之后的
          // finally 会把 genIdRef 清空——用默认的「仍是当前生成」判定会让重试全被判否，
          // 等于放弃重试、任务继续跑。
          // 这里不可能误停后来的生成：genIdRef 随即被清空，后发起的生成自会另起一条链。
          // onGiveUp 只是保险：finally 已经同步复位 cancelling/busy/进度，而且 give-up
          // 发生时 genIdRef 多半已清空（isAlive() 为假），回调通常根本不会触发。
          // onLate 传 null——此时按超时汇报才对，不该再说「生成已完成，未中断」。
          cancelGen(genId, () => setCancelling(false), null, () => true)
          break
        }
        // 统一走 timer 服务（动态包沙箱禁用原生 setTimeout）
        await new Promise((res) => { getTimer().timeout(res, 120) })
        const p = await callRpc('generatePoll', { genId }).catch(() => null)
        if (!p || !p.ok) {
          if (++fails > 5) { pushToast('error', (p && p.error) || tr('genFailedKeep')); break }
          continue
        }
        setMessage(p.text || '')
        setGenProgress(fmt(tr('genProgress'), { s: Math.round((Date.now() - genStartRef.current) / 1000), n: (p.text || '').length }))
        // 已经收尾（含被终止）就别再转圈了：存活指示只在 host 说「还没完」时为真
        if (p.aborted || p.done || p.error) setGeneratingNow(false)
        // aborted 是 host 确认过的终态：用户主动点击造成的中断走这条，绝不出红色报错。
        // 放在 p.error 之前判断——主动终止的任务 error 恒为空，顺序反了会走进失败分支。
        if (p.aborted) { pushToast('success', tr('genStopped')); break }
        if (p.error) { pushToast('error', p.error); break }
        if (p.done) {
          pushToast('success', fmt(tr('generated'), { s: p.ruleSource === 'repo' ? tr('ruleRepo') : p.ruleSource === 'global' ? tr('ruleGlobal') : tr('ruleBuiltin') }))
          break
        }
      }
    } catch (e) { pushToast('error', fmt(tr('genFailed'), { e: e && e.message ? e.message : String(e) })) }
    finally {
      genIdRef.current = null
      setCancelling(false)
      setGenProgress(null)
      setGeneratingNow(false)
      setBusy(null)
    }
  }

  // 终止生成：立刻把按钮切到「停止中…」（不等 RPC 返回——abort 要等 adapter 的
  // fetch 真正中断，可能几百毫秒到几秒，没有即时反馈用户会反复点击）。
  // 真正结束由轮询循环看到 aborted/done 后统一收尾。重试逻辑见上方 cancelGen。
  // 两个回调的收场：① 复位按钮，否则重试耗尽后会永远停在「停止中…」；② 这次生成若
  // 仍是当前生成，说明它已自行完成/过期，补一条中性提示（用 info 而非 success：
  // 这件事本身不是成功）。两者都由 cancelGen 保证「组件还活着且仍是当前生成」。
  const doCancelGenerate = () => {
    const id = genIdRef.current
    if (!id || cancelling) return
    setCancelling(true)
    // 点了停止就撤掉「正在跑」的动效：转圈还在转、点的是停止，观感自相矛盾
    setGeneratingNow(false)
    cancelGen(id, () => setCancelling(false), () => pushToast('info', tr('genStopTooLate')))
  }

  // Host 的「无上游」失败带 [push-no-upstream] 前缀，随 message 字符串过来（与
  // errGenStopped 同一约定）。标记本身在 unwrapRpc 那个边界上已经剥掉，**不会**进任何
  // 用户可见文案（toast 与弹窗同源）。
  // 判据取 unwrapRpc 摊平出来的结构化字段 reason === 'no-upstream'（Host 侧同时用
  // errPushNoUpstream 那句话兜底判——两者的含义在 host.js 的 opPush 里写着），
  // 不再对文案做字符串匹配：那句话一改（或换个语言）匹配就会失效。
  // 记录一次推送失败（提交后推送失败、以及「重试推送」又失败都走这里）。
  // 现场本身由 RepoCard 持有并渲染（弹窗是它渲染的），本组件只上报，不再自己写状态——
  // 上一版把写入函数 applyPushFail 留在本组件、而 RepoCard 的 handleWriteResult 调它，
  // 撤销成功时抛 ReferenceError，把一次成功的撤销报成了「reset 失败」。
  // 两条不同的文本必须分开存，别互相顶掉：
  //   raw —— git 自己的输出（fail(...).detail，经信封 details.detail 摊平回来），
  //          弹窗里的等宽框直接显示它（见 pushFailText）；Host 没给原文时框里显示
  //          command 那条建议命令
  //   error —— 给人看的那句话，失败提示用
  const recordPushFail = (res, afterCommit, branch, redo) => {
    const rawText = (res && res.error) || fmt(tr('failedSuffix'), { label: 'PUSH' })
    onPushFail({ error: rawText, raw: (res && res.detail) || '', command: (res && res.command) || '', afterCommit, branch, redo, noUpstream: isPushNoUpstream(res) })
  }

  const doCommit = async (pushAfter) => {
    if (!canCommit) return
    setBusy(pushAfter ? 'push' : 'commit')
    try {
      const r = await callRpc('commit', { repoId: repo.id, files: stagedPaths, message, sessionId })
      const out = handleWriteResult(r, 'COMMIT')
      if (pushAfter && out === 'ok') {
        // 推送失败弹窗要说清「本地多了哪个提交、在哪个分支上」：
        //   afterCommit —— **提交后**的 HEAD 短 hash，也就是撤回（reset --soft HEAD~1）
        //                  的落点，弹窗里当核对凭据用，并作为 reset 的 expectHash 传回去
        //                  （HEAD 若已前移，Host 会拒绝撤销，见 opReset）
        //   onBranch    —— 分支名，避免弹窗再去读可能已过期的 status；无上游时也用它拼出
        //                  「复制建议命令」里那条可直接执行的 git push -u
        // 这次 status 落在 commit 之后、push 之前：此刻的 HEAD 必然是刚提交出来的那个，
        // 中间没有别的路径能再造一个提交（refreshStatus 与它前后脚跑，同样落不进提交）。
        const st = await callRpc('status', { repoId: repo.id }).catch(() => null)
        const afterCommit = (st && st.ok && st.headShort) || ''
        const onBranch = (st && st.ok && st.branch) || ''
        const pr = await callRpc('push', { repoId: repo.id, sessionId })
          // 与 doPushRetry 同款：把「通道抛错」也归一成失败结果，否则会掉进下面的 catch
          // 被报成「提交失败」——而提交其实已经成功了
          .catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }))
        if (pr && pr.ok) handleWriteResult(pr, 'PUSH')
        else {
          // 提交成功 + 推送失败是最该打断用户的状态：改为弹窗收尾，现场一起交给它。
          // ⚠ 这里**不再补发 toast**。原先的理由是「toast 有响一声的作用」，但 pushToast 是
          // 追加进数组、容器是 bottom:14px + column，新 toast 落在最底部＝最显眼处，不存在
          // 「被绿色『提交成功』压住而漏看」；而它与弹窗同文、4.6s 后自行消失，只在屏幕上
          // 留一段会自动消失的重复话术，与「要用户明确选一条路」的弹窗定位相矛盾。
          recordPushFail(pr, afterCommit, onBranch, message)
        }
      }
    } catch (e) { pushToast('error', fmt(tr('commitFailed'), { e: e && e.message ? e.message : String(e) })) }
    finally { setBusy(null) }
  }

  // 推送失败弹窗的「重试推送」：只重试推送，不重新提交（提交已经在本地了）。
  // busy = 'push'：与面板其它写操作共用同一把锁——重试期间提交/推送/暂存/Pull 全部禁用，
  // 避免并发 git 操作与在飞的 push 交错。
  // ⚠ 这里**不用 runWrite**。runWrite 的失败分支会经 handleWriteResult 弹一条错误 toast，
  // 而本弹窗会把同一条失败就地摊在用户眼前——同一件事报两遍（toast 还会在 4.6s 后自行
  // 消失，只留下一段废话）。所以手动复刻 runWrite 的成功收尾（store.set + 关窗 + toast），
  // 失败则只更新弹窗内容、不 toast。锁与刷新语义与 runWrite 完全一致。
  // 成功时关窗 + 刷新：handleWriteResult 的 'push' 分支就是 setPushFail(null)，这里保留，
  // 否则弹窗会挂着一个早已推上去的提交继续提供「取消上次提交」（撤已推送的提交＝本地与远端分叉）。
  const doPushRetry = async () => {
    if (busy || pushRetrying) return
    const token = getPushRetryToken()
    setBusy('push')
    setPushRetrying(true)
    try {
      const res = await callRpc('push', { repoId: repo.id, sessionId })
        .catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }))
      // 关窗/换现场可能发生在这条请求在飞的时候（用户点了关闭，或撤销成功收窗）：
      // 那次结果属于一个已过期的现场，直接丢掉，别去动状态。判据由本层提供
      // （isPushRetryStale 读的是 RepoCard 的计数器）——子组件只读不写，不碰父层 ref。
      if (isPushRetryStale(token)) return
      if (res && res.ok) {
        onPushFail(null)
        pushToast('success', res.summary || fmt(tr('doneSuffix'), { label: 'PUSH' }))
        store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'write', lastOpRepoId: repo.id }))
        return
      }
      // 重试又失败：就地把现场换成新的失败（保留原 afterCommit / redo / branch——重试不产生
      // 新提交，撤回目标没变）。合并逻辑在 RepoCard（现场的持有方），并顺带把「重试中…」复位，
      // 否则按钮会永远停在转圈态、点不动。
      // raw / command 逐字段跟新失败走：重试若变成「无上游」（有意不给原文），raw 必须清空，
      // 否则详情框会把上一次的原文接着显示成这次的原因。
      onPushRetryFail(res)
    } finally {
      setPushRetrying(false)
      setBusy(null)
    }
  }

  // 推送失败弹窗的「取消上次提交」：git reset --soft HEAD~1——撤销那个提交、
  // 改动原样退回暂存区，工作区一个字节都不动。成功后把输入框内容恢复回去，
  // 用户可以直接改一改重新提交，或干脆不提交。
  // expectHash 是这次撤销的**目标校验**：reset 只认相对引用，而弹窗不阻塞面板操作，
  // 用户在这期间又提交过一次的话，HEAD~1 撤掉的就是新提交。把提交后的 HEAD 短 hash
  // 一起传过去，Host 侧对不上直接拒绝（而不是撤错提交）。拿不到 hash 就先补读一次
  // status，仍然拿不到就**不撤**——「没有校验的撤销」正是这个出口要避免的事。
  // 撤销期间不关窗（busy = 'reset' → 按钮转圈并全禁用、遮罩点击也被忽略）：失败时弹窗
  // 还在，「重试推送 / 复制 / 关闭」这些出口不会跟着丢；成功才收窗（见下）。
  // ⚠ 这里**不能用 runWrite**：那是 RepoCard 的局部函数，而本函数在 CommitArea 的
  // 作用域里——引用它会抛 ReferenceError（runWrite is not defined），点「取消上次提交」
  // 直接没反应（错误只落在浏览器控制台）。这也是它在失败分支上**不能**复用 runWrite 的
  // 第二个理由：runWrite 会经 handleWriteResult 弹错误 toast，而本弹窗已把同一条失败
  // 摊在用户眼前（同 doPushRetry）。所以两段各自显式实现，锁与收尾语义保持一致：
  //   setBusy('reset') → 按钮转圈并全禁用、遮罩与 Esc 都被忽略（见 pushFailModal 与 Esc 分层）
  //   成功后 handleWriteResult 的 'reset' 分支补齐「已撤销提交 <hash>」→ toast 与关窗
  //   失败交给它弹 toast（此时只有面板话术，弹窗信息量更大，不重复弹窗内展示）
  //   最后无论成败都复位 busy——否则面板会永远卡在禁用态
  const doUndoCommit = async () => {
    if (busy || !pushFail) return
    setBusy('reset')
    try {
      let expectHash = pushFail.afterCommit || ''
      if (!expectHash) {
        const st = await callRpc('status', { repoId: repo.id }).catch(() => null)
        expectHash = (st && st.ok && st.headShort) || ''
      }
      // 没有校验就不撤：撤错提交比「没反应」严重得多（URL 拿不到 hash 时给的是可操作结论）
      if (!expectHash) {
        handleWriteResult({ ok: false, error: tr('pushFailNoHash') }, 'reset')
        return
      }
      const r = await callRpc('reset', { repoId: repo.id, mode: 'soft', sessionId, expectHash })
      // expectHash 已被 Host 校验为「撤销前的 HEAD」：报它是**被撤掉的那个提交**，
      // 而不是「当前 HEAD」（撤销后 HEAD 已是它的父提交，说成当前会误导）。
      // 由 handleWriteResult（'reset' 分支）拼进 toast，弹窗随后就被它关掉。
      if (r && r.ok) {
        r.undoCommit = expectHash
        if (pushFail.redo) setMessage(pushFail.redo)
      }
      handleWriteResult(r, 'reset')
      // 撤销改了暂存区：刷新列表。放在 handleWriteResult 之后（它已刷新 store），
      // 且本组件没有 repo 级 store.set，走 refreshStatus（= loadStatus）这条现成通道
      if (r && r.ok) refreshStatus()
    } catch (e) {
      pushToast('error', fmt(tr('failedWith'), { label: 'reset', e: e && e.message ? e.message : String(e) }))
    } finally { setBusy(null) }
  }

  // 弹窗挂在卡片外层渲染（见 RepoCard 的 return）：fixed 定位的 backdrop 不能放进卡片
  // 内部的堆叠上下文，否则覆盖范围会跟着卡片走。这里把「现场 + 动作」交给卡片层渲染，
  // ref 本身由 RepoCard 持有并当 prop 传进来——**同一个对象**，两边不会各写一份。
  // ⚠ 每次 render 都整体换新对象，且**只允许在事件里读**（RepoCard 用 pushAct 延迟取值）：
  // 父组件先于子组件渲染，父在自己的 render 里取 ref 只能拿到上一轮的闭包。
  pushFailActions.current = { retry: doPushRetry, undo: doUndoCommit, close: () => onPushFail(null, { abortRetry: true }) }

  const loadRulesInfo = () => {
    callRpc('rulesGet', { repoId: repo.id }).then((r) => {
      if (r && r.ok) setRulesInfo({ source: r.effective.source, repoRuleExists: r.repoRuleExists })
    }).catch(() => {})
  }

  const rulesMenu = rulesMenuOpen ? React.createElement('div', { className: 'gp-menu', style: { right: 'auto', left: 0 } },
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setOpenRules(true) } }, tr('editRules')),
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); callRpc('rulesCopy', { repoId: repo.id }).then((r) => pushToast(r && r.ok ? 'success' : 'error', r && r.ok ? (r.summary || tr('copied')) : (r && r.error) || tr('copyFailed'))).catch(() => pushToast('error', tr('copyFailed'))) } }, tr('copyRules')),
    React.createElement('div', { className: 'gp-menu-sep' }),
    React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setOpenGenModel(true) } }, tr('genModelConfig')),
    React.createElement('div', { className: 'gp-menu-sep' }),
    React.createElement('div', { className: 'gp-menu-note' }, fmt(tr('effectiveRules'), { s: rulesInfo ? (rulesInfo.source === 'repo' ? tr('repoRules') : rulesInfo.source === 'global' ? tr('globalRules') : tr('ruleBuiltin')) : tr('loading') })),
    genModel ? React.createElement('div', { className: 'gp-menu-note' }, fmt(tr('genModelCurrent'), { m: genModel })) : null
  ) : null

  return React.createElement('div', { className: 'gp-commit-area' + (busy === 'generate' ? ' gp-generating' : '') },
    React.createElement('textarea', { className: 'gp-textarea', rows: lineCount, value: message, placeholder: tr('msgPlaceholder'), onChange: (e) => setMessage(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(false) } } }),
    React.createElement('div', { className: 'gp-commit-row' },
      React.createElement('div', { className: 'gp-left-group' },
        // 生成中把「生成」原位换成「停止」：只保留一个按钮，既不出现两个灰按钮互相干扰，
        // 也不会让右侧提示左右抖动（.gp-stop-btn 有 min-width，两个状态等宽）。
        busy === 'generate'
          ? React.createElement('button', { className: 'gp-btn gp-stop-btn', onClick: doCancelGenerate, disabled: cancelling, title: tr('genStopTitle') },
            cancelling ? React.createElement('span', { className: 'gp-spinner' }) : icon('stop'),
            cancelling ? tr('genStopping') : tr('genStop'))
          : React.createElement('button', { className: 'gp-btn', onClick: doGenerate, disabled: busy !== null || stagedPaths.length === 0, title: genModel ? fmt(tr('genTitleWithModel'), { m: genModel }) : tr('genTitle') },
            icon('sparkles'), tr('generate')),
        React.createElement('div', { className: 'gp-menu-wrap' },
          React.createElement('button', { className: 'gp-btn', onClick: () => { setRulesMenuOpen((o) => !o); if (!rulesMenuOpen) loadRulesInfo() } }, icon('gear'), tr('rules') + ' ', icon('chevronDown', 11)),
          rulesMenu)),
      React.createElement('span', { className: 'gp-staged-hint' },
        // 存活指示：停止按钮本身是静止的，这里用「转圈 + 生成中 12s」补回「正在跑」的感觉。
        // 曾经这一格就是「⟳ 生成中…」按钮，换成停止按钮后动效丢了，必须显式补上。
        // generatingNow 只在 host 确认 done===false 时为真：点了停止之后指示器立刻消失，
        // 不会出现「已经不跑了还在转」。提交区顶边另有一条扫光，见 .gp-commit-area.gp-generating。
        generatingNow
          ? React.createElement('span', { className: 'gp-gen-progress' }, React.createElement('span', { className: 'gp-spinner' }), genProgress, ' · ')
          : null,
        stagedPaths.length > 0 ? fmt(tr('stagedCount'), { n: stagedPaths.length }) : tr('noStaged'))),
    React.createElement('div', { className: 'gp-commit-actions' },
      React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: () => doCommit(false), disabled: !canCommit, title: conflictedCount > 0 ? fmt(tr('titleResolveFirst'), { n: conflictedCount }) : otherOp ? fmt(tr('titleOtherOp'), { op: otherOp }) : stagedPaths.length === 0 ? tr('titleStageFirst') : fmt(tr('commitTitle'), { n: stagedPaths.length }) },
        busy === 'commit' ? React.createElement('span', { className: 'gp-spinner' }) : icon('check'),
        busy === 'commit' ? tr('committing') : tr('commit')),
      React.createElement('button', { className: 'gp-btn', onClick: () => doCommit(true), disabled: !canCommit, title: tr('pushTitle') },
        busy === 'push' ? React.createElement('span', { className: 'gp-spinner' }) : icon('arrowUp'),
        busy === 'push' ? tr('pushing') : tr('commitAndPush'))),
    rulesMenuOpen ? React.createElement('div', { className: 'gp-menu-backdrop', onClick: (e) => { e.stopPropagation(); setRulesMenuOpen(false) } }) : null,
    openRules ? React.createElement(RuleEditorModal, { repo, onClose: () => setOpenRules(false) }) : null,
    openGenModel ? React.createElement(GenModelModal, { onClose: () => setOpenGenModel(false), onSaved: () => loadGenModel() }) : null)
}
export { CommitArea }
