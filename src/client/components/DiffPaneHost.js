/** 原生侧栏「变更详情」页签（git-diff kind）的正文。
 *
 * native 下点击**任意分组**的文件行（Git 历史、staged/unstaged/untracked/冲突行）
 * → openNativeDiffTab → 框架开一枚新页签，正文由本组件渲染：DiffDrawer 以 fitContainer
 * 形态铺满该页签，关闭即关页签。不再把详情锚进 Git Panel 页签内部——那层会被页签
 * 本体盖住（用户实测的故障形态）。导航参数从框架注入的 useTabInfo() 读
 * tab.navigation.params；参数不全时渲染空态提示，不硬渲染半截详情。
 */
import React from 'react'
import { tr } from '../i18n.js'
import { DiffDrawer } from './DiffDrawer.js'

function DiffPaneHost(props) {
  const hk = typeof (props && props.useTabInfo) === 'function' ? props.useTabInfo() : null
  const tab = hk && hk.tab ? hk.tab : null
  const nav = tab && tab.navigation ? tab.navigation : null
  const p = (nav && nav.params) || {}
  const repoId = String(p.repoId || '')
  const hash = String(p.hash || '')
  const path = String(p.path || '')
  // 分组默认 commit（历史文件）；staged/unstaged/untracked/conflicted 由点击行带来。
  // 非法分组回落 commit 不安全（commit 路径会拿空 hash 走 hash^ 比较失败报错），
  // 所以只做白名单归一：不在五组内一律按 'unstaged'（fileDiff RPC 对未知分组的兜底）
  const GROUP_WHITELIST = ['staged', 'unstaged', 'untracked', 'conflicted', 'commit']
  const group = GROUP_WHITELIST.indexOf(String(p.group || '')) >= 0 ? String(p.group) : 'unstaged'
  if (!repoId || !path) {
    return React.createElement('div', { className: 'gp-empty' }, tr('gpDiffEmpty'))
  }
  const closeTab = () => { try { if (tab.actions && typeof tab.actions.close === 'function') tab.actions.close() } catch (e) { /* 幂等 */ } }
  const repo = { id: repoId, name: String(p.repoName || repoId), path: String(p.repoPath || '') }
  // hash 只对 commit 组有值；其余组 fileDiff 走工作区口径，hash 置 null 不参与
  const h = group === 'commit' ? (hash || null) : null
  const sel = { repoId, path, group, hash: h, short: h ? h.slice(0, 7) : '', x: 0, y: 0, orig: null }
  return React.createElement('div', { className: 'gp-diff-panewrap' },
    React.createElement(DiffDrawer, { repo, sel, panelW: 0, fitContainer: true,
      onClose: closeTab, onRequestClose: closeTab }))
}
export { DiffPaneHost }