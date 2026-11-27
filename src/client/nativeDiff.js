/**
 * 原生侧栏「变更详情」页签的开合入口。
 *
 * Git Panel 自己的抽屉（DiffDrawer）在 dock 下贴面板左缘滑出；原生侧栏模式
 * （layout === 'native'）下点 Git 历史里的文件（group === 'commit'）改为开一枚新的
 * 制表签页签——变更内容由 DiffPaneHost 以内嵌形态铺满该页签，不再浮出一层独立侧栏。
 * 本模块是这条路径的唯一出口：GitPanelMain 不直接碰 sidebarRight 服务（跨作用域引用
 * 的 ReferenceError 是本项目的高发区），一律经这里 + getClientCtx。
 */
import { getClientCtx } from './runtime.js'
import { tr } from './i18n.js'
import { pushToast } from './store.js'

const DIFF_KIND = 'git-diff'
// contentId 定死为「仓库+提交+文件」：同一历史文件的重复点击按 (kind, contentId) 去重，
// 只聚焦既有页签，不会越点越多（与 Files 的资源 tab 去重语义一致）。
function diffTabParams(repo, f, group) {
  return {
    contentId: (repo.path || repo.id || '') + '\u0001' + (f.hash || '') + '\u0001' + (f.path || ''),
    repoId: String(repo.id || ''),
    repoName: String(repo.name || repo.id || ''),
    repoPath: String(repo.path || ''),
    hash: String(f.hash || ''),
    path: String(f.path || ''),
    // 分组随参数走：页签正文据此选 diff 口径（staged/unstaged/untracked/conflicted/commit，
    // host 的 fileDiff RPC 全接受——非 commit 组 hash 不参与取数）
    group: String(group || 'commit')
  }
}
// 模块级打开参数快照（contentId → params）：页签正文 DiffPaneHost 的**兜底取参源**。
// 为什么需要它：框架是否把 useTabInfo 注入成正文组件的 props 存在实现差异（注册时
// 未声明 inject/hookContext 的组件未必拿得到该 hook）——没有兜底时，拿不到导航参数的
// 页签只能渲染空态，用户看到的就是「点击没反应、新页签空白」。每次打开都更新，
// 保证「最新点开的那个文件」的参数必然在快照里。
const lastParamsByContentId = new Map()
function stashLastParams(params) {
  if (!params) return
  try { lastParamsByContentId.set(String(params.contentId), params) } catch (e) { /* 忽略 */ }
}
function sidebarRightOf() {
  const ctx = getClientCtx()
  return ctx ? ctx.get('sidebarRight') : null
}
// 打开（或聚焦既有）变更详情页签；无屏幕会话/服务缺失时 toast 提示，绝不静默失效。
// group 由调用方给（GitPanelMain.onOpenDiff 的分组）——native 下**任何**分组的文件行
// 点击都开新页签，不锚进当前页签：锚进去的那层抽屉会被页签本体盖住，用户看到的就是
// 「点了没反应」（本轮用户实测确认的故障形态）。重复点击同一文件按 contentId 聚焦。
export function openNativeDiffTab(repo, f, group) {
  const sr = sidebarRightOf()
  if (!sr || typeof sr.openTab !== 'function') { pushToast('error', tr('gpNativeFailed')); return }
  const params = diffTabParams(repo, f, group)
  stashLastParams(params) // 页签正文的兜底取参源（见 lastParamsByContentId 注释）
  try {
    sr.openTab(DIFF_KIND, { params })
  } catch (e) { pushToast('error', tr('gpNativeFailed')) }
}
export { DIFF_KIND as NATIVE_DIFF_KIND, lastParamsByContentId as LAST_PARAMS_BY_CONTENT_ID }