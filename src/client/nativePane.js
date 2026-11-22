/**
 * 原生侧栏模式（layout === 'native'）的页签开合与登记。
 *
 * DSH 右栏是「每会话一个停靠面」的制表签系统：类型经 sidebarRightTabs.register
 * 声明，正文经 sidebar.right.pane.tab 注册。本模块只负责**开合动作**与
 * sessionId → 页签 id 的登记表，供两处调用：
 *   - index.js 的侧栏底部开关（用户点开关 → 开/收页签）；
 *   - modals.js 的布局设置（选「原生侧栏」→ 立即把面板搬进右栏，选走 → 收页签）。
 * 设置弹窗与插件入口分处两个模块，动作下沉到这里避免 index.js ↔ modals.js 的
 * 循环依赖（GitPanelMain 已经 import modals）。
 *
 * 为什么需要登记表：收起（hide）按页签 id 操作，而「右栏开始页的入口卡片」是按
 * kind 直接开页签、不经过 openNativeTab —— 那条路径的 id 由 PaneHost 挂载时补登记
 * （见 index.js 的 PaneHost），所以本表不是 openNativeTab 专属。
 */
import { getClientCtx } from './runtime.js'
import { store, pushToast } from './store.js'
import { tr } from './i18n.js'

const NATIVE_KIND = 'git-panel'
const NATIVE_TAB_ID = '@dsh-local/git-panel'
// sessionId → 已开页签 id。session 切换后旧条目留着无妨（key 不同，不会误收）。
const nativeTabsBySession = new Map()

function sidebarRightOf() {
  const ctx = getClientCtx()
  return ctx ? ctx.get('sidebarRight') : null
}

/** 当前环境是否具备打开原生页签的前提（右栏服务 + 当前会话）。 */
function canUseNativePane() {
  const sr = sidebarRightOf()
  return !!(store.get().currentSessionId && sr && typeof sr.openTab === 'function')
}

/**
 * 打开（或聚焦既有）本面板的原生页签；失败时 toast 提示并返回 false，
 * 让调用方（设置弹窗）可以撤销布局切换，绝不留「切了模式却什么都没出现」。
 */
function openNativeTab() {
  const sid = store.get().currentSessionId
  if (!sid) { pushToast('error', tr('gpNativeFailed')); return false }
  const sr = sidebarRightOf()
  if (!sr || typeof sr.openTab !== 'function') { pushToast('error', tr('gpNativeFailed')); return false }
  try {
    sr.openTab(NATIVE_KIND, { params: { contentId: NATIVE_TAB_ID } })
    const t = typeof sr.active === 'function' ? sr.active() : null
    if (t && t.id) nativeTabsBySession.set(sid, t.id)
    if (!store.get().panelOpen) store.set((st) => ({ ...st, panelOpen: true }))
    return true
  } catch (e) {
    pushToast('error', tr('gpNativeFailed'))
    return false
  }
}

/** 页签正文挂载时补登记 id（开始页入口卡片开的页签不经过 openNativeTab）。 */
function registerNativeTab(tabId) {
  const sid = store.get().currentSessionId
  if (sid && tabId) nativeTabsBySession.set(sid, String(tabId))
}

// 收起页签（两种收尾）：
//   hideNativeTab     —— 用户主动收（开关再点 / header 关闭键）：连 panelOpen 一起复位；
//   quietHideNativeTab —— 模式切换等非用户路径的静默收，只关页签不动开关态，
//                       让 dock/overlay 实例按当前 panelOpen 无缝接管。
function quietHideNativeTab() {
  const sid = store.get().currentSessionId
  const tid = sid ? nativeTabsBySession.get(sid) : undefined
  const sr = sidebarRightOf()
  try { if (tid && sr && typeof sr.hide === 'function') sr.hide(tid) } catch (e) { /* 忽略 */ }
  if (sid) nativeTabsBySession.delete(sid)
}

function hideNativeTab() {
  quietHideNativeTab()
  if (store.get().panelOpen) store.set((st) => ({ ...st, panelOpen: false }))
}

export {
  NATIVE_KIND,
  NATIVE_TAB_ID,
  canUseNativePane,
  openNativeTab,
  registerNativeTab,
  quietHideNativeTab,
  hideNativeTab,
  nativeTabsBySession
}
