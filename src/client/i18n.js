/**
 * 国际化：跟随 DSH 语言设置（locale.preference）自动切换 中文 / English。
 * TEXTS 原文未动；lang 由 initLocale（apply 时）设定，运行期由 applyLocale 切换。
 */
import { callRpc } from './api.js'
import { store } from './store.js'

let lang = 'zh'

// apply 阶段只做一次初始同步（此时 locale 服务可能尚未就绪）；运行期切换由
// GitPanelMain 挂载时的 locale 订阅驱动（见其 effect 注释）
export function initLocale(localeSvc) {
  lang = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale().active : 'zh'
  if (lang !== 'en') lang = 'zh'
  callRpc('setLocale', { locale: lang }).catch(() => {})
}

const TEXTS = {
  zh: {
    groupStaged: '暂存的更改', groupChanges: '更改', groupUntracked: '未跟踪的更改', groupConflicted: '冲突（未解决）', history: '历史',
    rulesLoadFailed: '读取规则失败', reading: '(读取中…)', saved: '已保存', saveFailed: '保存失败', saveFailedWith: '保存失败: {e}',
    scopeSwitchFailed: '切换规则来源失败',
    validationNoSys: '校验失败: 缺少 system_prompt', validationNoUser: '校验失败: 缺少 user_context',
    restoredDefaults: '已恢复为内置默认内容（未保存）', globalRules: '全局规则', repoRules: '仓库专属规则', scopeSaveTo: '保存到: {p}', scopeNewFile: '（文件不存在，保存时创建）',
    rulesContent: '规则内容', sysPromptLabel: '系统提示词（必填）', userCtxLabel: '用户上下文（必填）',
    livePreview: '实时预览（最终注入 LLM 的 prompt）', userCtxTitle: 'USER CONTEXT（占位符已替换）', userCtxPlaceholder: '（占位符已替换）',
    empty: '(空)', missingUserCtx: '(缺少 user_context)', stagedPlaceholder: '<已暂存的文件，生成时实时注入>',
    stagedDiffPlaceholder: '<点击「生成」时实时注入的 staged diff>', restoreDefaults: '恢复默认', cancel: '取消',
    restoring: '恢复中…', saving: '保存中…', save: '保存', ruleEditorTitle: '提交规则编辑器', close: '关闭',
    loadFailed: '读取失败', loadingDiff: '加载 diff…',
    closeDiff: '关闭 diff（Esc）',
    splitDiffTitle: '分栏对比', unifiedDiffTitle: '单栏对比',
    diffFullFile: '显示完整文件（含未变更行）', diffChangesOnly: '仅显示变更行',
    imgOld: '旧', imgNew: '新', imgLoading: '加载图片…',
    imgTooLarge: '图片过大（{s}），超出预览上限', imgMissing: '（无此版本）', imgNoPreview: '无法预览图片',
    imgZoomTitle: '点击查看原图（1:1）', imgCloseZoom: '关闭全屏预览（Esc）', imgSwitchHint: '←/→ 切换旧/新版本',
    historyLoadFailed: '读取历史失败', loadingHistory: '加载历史…', graphHint: '点击行查看提交详情', loadingDetail: '加载详情…',
    loadingFiles: '加载文件…', commitNoFiles: '该提交无文件变更（合并提交无合并差异）',
    stageFirst: '请先点击文件右侧的 + 暂存要提交的文件', generated: '已生成提交信息（规则来源：{s}）',
    ruleRepo: '仓库专属', ruleGlobal: '全局', ruleBuiltin: '内置默认', genFailedKeep: '生成失败，已保留原内容', genFailed: '生成失败: {e}', genTimeout: '生成超时，请重试',
    commitFailed: '提交失败: {e}', editRules: '编辑提交规则',
    copyRules: '复制当前生效规则到剪贴板',
    effectiveRules: '当前生效：{s}', loading: '读取中…', msgPlaceholder: '提交信息（仅提交已暂存的文件；Ctrl+Enter 提交）',
    genTitle: '生成提交信息', genTitleWithModel: '当前生成模型：{m}',
    genModelConfig: '配置生成模型…', genModelFollowDefault: '跟随当前会话模型（默认）',
    genModelEffort: '思考强度', genModelEffortFollow: '跟随模型默认', genModelEffortOff: '关闭思考', genModelEffortHigh: '高', genModelEffortMax: '最大',
    genModelSaved: '已保存生成模型', genModelLoadFailed: '读取生成模型/模型列表失败', genModelEmpty: '没有可用模型',
    genModelCurrent: '生成模型: {m}', genModelThinking: '思考: {e}',
    genModelDefaultMark: '（默认）', genModelThinkingParen: '（思考: {e}）', copied: '已复制', copyFailed: '复制失败',
    stagedCount: '已暂存 {n} 个文件', noStaged: '暂无暂存文件', generate: '生成', generating: '生成中…', rules: '规则',
    genStop: '停止', genStopping: '停止中…', genStopTitle: '终止本次生成（已生成的内容会保留）',
    genStopped: '已停止生成，已生成的内容已保留', genStopTooLate: '生成已完成，未中断',
    genProgress: '生成中 {s}s',
    // 提交成功、推送失败：这条必须弹窗而不是 toast（4.6 秒会被绿色「提交成功」压住）
    pushFailTitle: '推送失败（提交已成功）',
    pushFailKept: '本地提交已保留，远端没有更新（分支：{b}）。',
    pushFailNoUpstream: '该分支还没有 upstream（上游分支），重试推送不会成功：先按下面这条命令在终端建立跟踪，之后面板的推送就能用了。',
    pushFailRetry: '重试推送',
    pushFailUndo: '取消上次提交',
    pushFailUndoing: '撤销中…',
    pushFailUndoDone: '已撤销上次提交，改动已回到暂存区',
    pushFailUndoHash: '已撤销提交 {h}',
    pushFailNoHash: '无法确认当前 HEAD，已取消撤销（没有校验就撤销可能撤错提交）。刷新面板后重试即可。',
    commit: '提交', committing: '提交中…', pushing: '推送中…', commitAndPush: '提交并推送',
    titleStageFirst: '先用文件右侧的 + 暂存文件', commitTitle: 'git commit（仅已暂存的 {n} 个文件）', pushTitle: '提交成功后推送当前分支',
    loadingStatus: '读取状态…', statusLoadFailed: '读取状态失败', gitStatusFailed: 'git status 失败：{e}', treeClean: '工作区干净，没有变更',
    unstageAll: '取消暂存全部', stageAll: '暂存全部（{n} 个文件）', unstage: '取消暂存', stage: '暂存（git add）',
    discardAll: '放弃所有更改', discardFile: '放弃更改', groupCount: '共 {n} 个文件',
    discardTitle: '放弃更改', discardConfirmN: '确定要放弃对 {n} 个文件的更改吗？', discardConfirm1: '确定要放弃对该文件的更改吗？',
    discardIrreversible: '此操作不可恢复。', discardUntrackedNote: '其中未跟踪的文件将被直接删除。',
    discardMore: '…以及其他 {n} 个文件', discardOk: '放弃更改',
    stagedNTitle: '已暂存 {n} 个文件', unstagedNTitle: '未暂存变更 {n} 个文件', untrackedNTitle: '未跟踪 {n} 个文件',
    pullTitle: 'Pull（fetch + merge）', switchBranch: '切换分支',
    loadingBranches: '读取分支…', branchesLoadFailed: '读取分支失败', newBranchName: '新分支名', createAndSwitch: '创建并切换',
    newBranch: '新建分支…', moreActions: '更多操作', push: '推送（push）', stashChanges: 'Stash 当前变更',
    stashPop: 'Stash pop（最近一条）', behindAhead: '落后 {b} / 领先 {a}', doneSuffix: '{label}完成', failedSuffix: '{label}失败',
    morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Stash pop（最近一条）',
    moreResetSoft: 'Reset（撤销上次提交，保留更改）', moreResetHard: 'Reset Hard（撤销上次提交并丢弃更改）', moreClean: 'Clean（删除未跟踪文件）',
    resetSoftTitle: 'Soft Reset（HEAD~1）', resetHardTitle: 'Hard Reset（HEAD~1）', cleanTitle: 'Clean 未跟踪文件', dangerRun: '执行',
    resetSoftNote: '将撤销最近一次提交，其更改退回暂存区。此操作改写本地历史。',
    resetHardNote: '将撤销最近一次提交并丢弃其全部更改。此操作不可恢复。',
    cleanNote: '将删除所有未跟踪的文件与目录（git clean -fd）。此操作不可恢复。',
    conflictBar: '有 {n} 个文件存在冲突，解决后点该行的 ＋ 标记为已解决。',
    conflictBarResolved: '冲突已全部标记为已解决，可以提交以完成本次合并。',
    conflictBarNoStaged: '冲突已全部解决，且解决结果与 HEAD 一致（没有暂存内容）。点「完成合并」提交本次合并。',
    // 有未暂存改动时不能说「与 HEAD 一致」：那种状态下最可能是「解决完又取消了暂存」，
    // 解决结果正躺在工作区里没进 index——此时点「完成合并」提交出的合并提交不含它。
    conflictBarUnstaged: '冲突已全部解决，但当前索引没有可提交的内容（解决结果尚未暂存，或暂存后又被取消暂存）。先点该行的 ＋ 再提交；若按当前索引收尾合并，点「完成合并」——工作区里未暂存的改动不会被本次提交包含。',
    // rebase / cherry-pick / revert：冲突同样进冲突组，但收尾出口不在面板里
    conflictBarOtherOp: '有 {n} 个文件存在冲突，且当前进行的是 {op}（不是合并）：解决后点该行的 ＋ 标记为已解决，收尾请回终端执行 git {op} --continue（或 git {op} --abort）。',
    conflictBarOtherOpResolved: '冲突已全部标记为已解决，但当前进行的是 {op}：收尾请回终端执行 git {op} --continue（面板里的「提交」会被 git 当作该 {op} 的提交，并替换掉原提交信息）。',
    resolveFile: '标记为已解决（git add）', resolveAll: '全部标记为已解决',
    mergeAbortMenu: '中止合并（放弃本次合并）', mergeAbortTitle: '中止合并',
    mergeAbortNote: '将放弃本次合并，工作区恢复到合并前状态，冲突标记一并清除。若已解决的文件内容是必要改动，请先自行备份。',
    mergeAbortOk: '中止合并', mergeAbortDone: '已中止合并', conflictedNTitle: '冲突 {n} 个文件',
    mergeFinishTitle: '完成合并', mergeFinishDone: '已提交本次合并',
    // 完成合并用的提交信息取自 .git/MERGE_MSG（git 自己写好的合并摘要），
    // 悬停即可看到将要提交的那句话
    mergeFinishTitleWith: '完成合并（提交信息：{m}）',
    titleResolveFirst: '还有 {n} 个文件未解决，先解决并标记为已解决再提交',
    titleOtherOp: '{op} 进行中：提交会被 git 当作该 {op} 的提交并替换原提交信息，收尾建议回终端 git {op} --continue',
    loadingMore: '加载更多…', emptyHistory: '暂无提交记录',
    failedWith: '{label}失败: {e}',
    rescan: '重新扫描（并刷新所有仓库状态）', openFolder: '在文件资源管理器中打开工作空间', openFolderFailed: '打开文件夹失败: {e}', openFolderUnavailable: '文件管理器服务不可用',
    locating: '正在定位工作空间…', scanning: '正在扫描 Git 仓库…', scanFailed: '扫描失败',
    noWorkspace: '未打开工作空间', noRepos: '当前工作空间内未发现 Git 仓库。', resizeTitle: '拖拽调整面板宽度',
    toastsLabel: 'Git Panel 通知', panelLabel: 'Git Panel 面板', toggleTitle: 'Git Panel',
    expandTitle: '展开 Git Panel',
    panelSettings: '面板设置',
    modeDock: '侧边栏模式', modeDockDesc: '面板停靠在对话右侧，对话区域自动收窄让位', modeDockBadge: '默认',
    modeOverlay: '浮窗模式', modeOverlayDesc: '面板浮在对话区域上方，不改变对话布局',
    layoutNarrowHint: '窗口较窄时，侧边栏模式会临时按浮窗显示，拉宽窗口后自动恢复。'
  },
  en: {
    groupStaged: 'Staged Changes', groupChanges: 'Changes', groupUntracked: 'Untracked Changes', groupConflicted: 'Merge Conflicts', history: 'History',
    rulesLoadFailed: 'Failed to load rules', reading: '(loading…)', saved: 'Saved', saveFailed: 'Save failed', saveFailedWith: 'Save failed: {e}',
    scopeSwitchFailed: 'Failed to switch rules source',
    validationNoSys: 'Validation failed: missing system_prompt', validationNoUser: 'Validation failed: missing user_context',
    restoredDefaults: 'Restored to built-in defaults (not saved)', globalRules: 'Global rules', repoRules: 'Repo-specific rules', scopeSaveTo: 'Saved to: {p}', scopeNewFile: ' (file does not exist, will be created on save)',
    rulesContent: 'Rule content', sysPromptLabel: 'system prompt (required)', userCtxLabel: 'user context (required)',
    livePreview: 'Live preview (the final prompt injected into the LLM)', userCtxTitle: 'USER CONTEXT (placeholders replaced)', userCtxPlaceholder: '(placeholders replaced)',
    empty: '(empty)', missingUserCtx: '(missing user_context)', stagedPlaceholder: '<staged files, injected live at generation>',
    stagedDiffPlaceholder: '<staged diff injected live when you click Generate>', restoreDefaults: 'Restore Defaults', cancel: 'Cancel',
    restoring: 'Restoring…', saving: 'Saving…', save: 'Save', ruleEditorTitle: 'Commit Rule Editor', close: 'Close',
    loadFailed: 'Failed to load', loadingDiff: 'Loading diff…',
    closeDiff: 'Close diff (Esc)',
    splitDiffTitle: 'Split view', unifiedDiffTitle: 'Unified view',
    diffFullFile: 'Show full file (including unchanged lines)', diffChangesOnly: 'Show changed lines only',
    imgOld: 'Old', imgNew: 'New', imgLoading: 'Loading image…',
    imgTooLarge: 'Image too large ({s}); exceeds the preview limit', imgMissing: '(no such version)', imgNoPreview: 'Cannot preview image',
    imgZoomTitle: 'Click to view at actual size (1:1)', imgCloseZoom: 'Close fullscreen preview (Esc)', imgSwitchHint: '←/→ switch old/new',
    historyLoadFailed: 'Failed to load history', loadingHistory: 'Loading history…', graphHint: 'Click a row to view commit details', loadingDetail: 'Loading details…',
    loadingFiles: 'Loading files…', commitNoFiles: 'No file changes in this commit (merge without combined diff)',
    stageFirst: 'Stage files first using the + on the right of each file', generated: 'Commit message generated (rules: {s})',
    ruleRepo: 'repo-specific', ruleGlobal: 'global', ruleBuiltin: 'built-in', genFailedKeep: 'Generation failed; original content kept', genFailed: 'Generation failed: {e}', genTimeout: 'Generation timed out, please retry',
    commitFailed: 'Commit failed: {e}', editRules: 'Edit commit rules',
    copyRules: 'Copy effective rules to the clipboard',
    effectiveRules: 'Effective: {s}', loading: 'Loading…', msgPlaceholder: 'Commit message (commits only staged files; Ctrl+Enter to commit)',
    genTitle: 'Generate commit message', genTitleWithModel: 'Generation model: {m}',
    genModelConfig: 'Configure generation model…', genModelFollowDefault: 'Follow current session model (default)',
    genModelEffort: 'Reasoning effort', genModelEffortFollow: 'Model default', genModelEffortOff: 'Off', genModelEffortHigh: 'High', genModelEffortMax: 'Max',
    genModelSaved: 'Generation model saved', genModelLoadFailed: 'Failed to load generation model / model list', genModelEmpty: 'No models available',
    genModelCurrent: 'Generation model: {m}', genModelThinking: 'thinking: {e}',
    genModelDefaultMark: ' (default)', genModelThinkingParen: ' (thinking: {e})', copied: 'Copied', copyFailed: 'Copy failed',
    stagedCount: '{n} files staged', noStaged: 'No staged files', generate: 'Generate', generating: 'Generating…', rules: 'Rules',
    genStop: 'Stop', genStopping: 'Stopping…', genStopTitle: 'Abort this generation (generated content is kept)',
    genStopped: 'Generation stopped; the content produced so far was kept', genStopTooLate: 'Generation already finished; nothing to abort',
    genProgress: 'generating {s}s',
    pushFailTitle: 'Push failed (commit succeeded)',
    pushFailKept: 'The local commit was kept; the remote was not updated (branch: {b}).',
    pushFailNoUpstream: 'This branch has no upstream yet, so retrying the push cannot succeed: run the command below once in a terminal to set it up; the panel can push normally afterwards.',
    pushFailRetry: 'Retry push',
    pushFailUndo: 'Undo last commit',
    pushFailUndoing: 'Undoing…',
    pushFailUndoDone: 'Last commit undone; changes are back in the index',
    pushFailUndoHash: 'Undid commit {h}',
    pushFailNoHash: 'Could not confirm the current HEAD, so the undo was cancelled (undoing without that check could remove the wrong commit). Refresh the panel and try again.',
    commit: 'Commit', committing: 'Committing…', pushing: 'Pushing…', commitAndPush: 'Commit & Push',
    titleStageFirst: 'Stage files first with +', commitTitle: 'git commit (only {n} staged files)', pushTitle: 'Commits, then pushes the current branch',
    loadingStatus: 'Loading status…', statusLoadFailed: 'Failed to load status', gitStatusFailed: 'git status failed: {e}', treeClean: 'Working tree clean',
    unstageAll: 'Unstage All', stageAll: 'Stage All ({n} files)', unstage: 'Unstage', stage: 'Stage (git add)',
    discardAll: 'Discard All Changes', discardFile: 'Discard Changes', groupCount: '{n} files in this group',
    discardTitle: 'Discard Changes', discardConfirmN: 'Discard changes to {n} files?', discardConfirm1: 'Discard changes to this file?',
    discardIrreversible: 'This action cannot be undone.', discardUntrackedNote: 'Untracked files among them will be deleted outright.',
    discardMore: '…and {n} more', discardOk: 'Discard Changes',
    stagedNTitle: '{n} files staged', unstagedNTitle: '{n} unstaged changes', untrackedNTitle: '{n} untracked files',
    pullTitle: 'Pull (fetch + merge)', switchBranch: 'Switch Branch',
    loadingBranches: 'Loading branches…', branchesLoadFailed: 'Failed to load branches', newBranchName: 'New branch name', createAndSwitch: 'Create & Switch',
    newBranch: 'New Branch…', moreActions: 'More Actions', push: 'Push', stashChanges: 'Stash Changes',
    stashPop: 'Stash Pop (latest)', behindAhead: 'Behind {b} / Ahead {a}', doneSuffix: '{label} completed', failedSuffix: '{label} failed',
    morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Pop Latest Stash',
    moreResetSoft: 'Reset (undo last commit, keep changes)', moreResetHard: 'Reset Hard (undo last commit, discard changes)', moreClean: 'Clean (delete untracked files)',
    resetSoftTitle: 'Soft Reset (HEAD~1)', resetHardTitle: 'Hard Reset (HEAD~1)', cleanTitle: 'Clean Untracked Files', dangerRun: 'Run',
    resetSoftNote: 'Undoes the last commit; its changes return to the staging area. This rewrites local history.',
    resetHardNote: 'Undoes the last commit and discards all of its changes. This action cannot be undone.',
    cleanNote: 'Deletes all untracked files and directories (git clean -fd). This action cannot be undone.',
    conflictBar: '{n} file(s) have conflicts. Resolve them, then press + on the row to mark resolved.',
    conflictBarResolved: 'All conflicts are marked resolved; commit to complete this merge.',
    conflictBarNoStaged: 'All conflicts are resolved and the result matches HEAD, so nothing is staged. Press "Complete Merge" to commit this merge.',
    conflictBarUnstaged: 'All conflicts are resolved, but the index has nothing to commit (the resolution was never staged, or staged and then unstaged). Press + on the row first; to finish the merge with the current index press "Complete Merge" — unstaged worktree changes are not part of this commit.',
    conflictBarOtherOp: '{n} file(s) have conflicts and a {op} (not a merge) is in progress: resolve them, then press + on the row to mark resolved, and finish in a terminal with git {op} --continue (or git {op} --abort).',
    conflictBarOtherOpResolved: 'All conflicts are marked resolved, but a {op} is in progress: finish it in a terminal with git {op} --continue (the panel\'s Commit would be taken as that {op}\'s commit and replace its original message).',
    resolveFile: 'Mark as resolved (git add)', resolveAll: 'Mark all as resolved',
    mergeAbortMenu: 'Abort merge (discard this merge)', mergeAbortTitle: 'Abort Merge',
    mergeAbortNote: 'Discards this merge and restores the worktree to its pre-merge state, clearing the conflict markers. Back up any resolved content you still need first.',
    mergeAbortOk: 'Abort Merge', mergeAbortDone: 'Merge aborted', conflictedNTitle: '{n} conflicted file(s)',
    mergeFinishTitle: 'Complete Merge', mergeFinishDone: 'Merge committed',
    mergeFinishTitleWith: 'Complete Merge (message: {m})',
    titleResolveFirst: '{n} file(s) are still unresolved; resolve and mark them before committing',
    titleOtherOp: 'A {op} is in progress: committing is taken as that {op}\'s commit and replaces its original message; prefer git {op} --continue in a terminal',
    loadingMore: 'Loading more…', emptyHistory: 'No commits yet',
    failedWith: '{label} failed: {e}',
    rescan: 'Rescan (also refreshes all repository statuses)', openFolder: 'Open workspace in file explorer', openFolderFailed: 'Failed to open folder: {e}', openFolderUnavailable: 'File manager service unavailable',
    locating: 'Locating workspace…', scanning: 'Scanning for Git repositories…', scanFailed: 'Scan failed',
    noWorkspace: 'No workspace open', noRepos: 'No Git repositories found in the current workspace.', resizeTitle: 'Drag to resize the panel width',
    toastsLabel: 'Git Panel notifications', panelLabel: 'Git Panel panel', toggleTitle: 'Git Panel',
    expandTitle: 'Expand Git Panel',
    panelSettings: 'Panel Settings',
    modeDock: 'Side panel', modeDockDesc: 'The panel docks to the right of the conversation, which narrows to make room', modeDockBadge: 'Default',
    modeOverlay: 'Floating overlay', modeOverlayDesc: 'The panel floats above the conversation without changing its layout',
    layoutNarrowHint: 'On narrow windows the side-panel mode temporarily behaves as floating; it restores automatically once the window is widened.'
  }
}
function tr(key) {
  const table = TEXTS[lang] || TEXTS.zh
  return table[key] !== undefined ? table[key] : (TEXTS.zh[key] !== undefined ? TEXTS.zh[key] : key)
}
function fmt(template, params) {
  let s = template
  for (const k of Object.keys(params || {})) s = s.split('{' + k + '}').join(String(params[k]))
  return s
}
function applyLocale(next) {
  const nextLang = next === 'en' ? 'en' : 'zh'
  if (nextLang !== lang) {
    lang = nextLang
    store.set((s) => ({ ...s, langTick: (s.langTick || 0) + 1 }))
    callRpc('setLocale', { locale: lang }).catch(() => {})
  }
}
export { tr, fmt, applyLocale }
