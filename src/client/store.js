/**
 * 全局面板状态（ createStore / store / useStore ）、Toast 栈、localStorage 偏好读写。
 * 旧单文件里 store 是每次 apply 新建的闭包量；拆模块后是模块单例，
 * 由 index.js 在每次 apply 时调 resetStore() 打回初始态（等价语义）。
 */
import React from 'react'
import { getTimer } from './runtime.js'
// localStorage 偏好读写：数值带 [min, max] 钳制（写入端同样钳制，防止读取端
// 丢弃越界值）；布尔以 '1'/'0' 记忆；字符串白名单校验；异常（隐私模式等）
// 静默退默认值。
// 键名：gp-panel-w（面板宽）/ gp-diff-w（抽屉宽）/ gp-diff-split（分栏）/
// gp-diff-full（全文）/ gp-collapsed（折叠态）/ gp-layout（布局模式：dock 停靠 / native 原生侧栏）/
// gp-open-on-start（启动即展开面板，默认开）
const prefInt = (key, min, max, def) => {
  try {
    const v = parseInt(window.localStorage.getItem(key), 10)
    if (v >= min && v <= max) return v
  } catch (e) { /* ignore */ }
  return def
}
const savePrefInt = (key, min, max, v) => {
  try { window.localStorage.setItem(key, String(Math.min(max, Math.max(min, v)))) } catch (e) { /* ignore */ }
}
const prefBool = (key, def) => {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? def : v === '1'
  } catch (e) { return def }
}
const savePrefBool = (key, v) => {
  try { window.localStorage.setItem(key, v ? '1' : '0') } catch (e) { /* ignore */ }
}
// 字符串偏好：值必须落在白名单内（防手改 localStorage 注入任意值），否则退默认
const prefStr = (key, allowed, def) => {
  try {
    const v = window.localStorage.getItem(key)
    if (allowed.indexOf(v) >= 0) return v
  } catch (e) { /* ignore */ }
  return def
}
const savePrefStr = (key, v) => {
  try { window.localStorage.setItem(key, v) } catch (e) { /* ignore */ }
}

function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set: (updater) => { state = updater(state); listeners.forEach((l) => l()) },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) }
  }
}
// 布局模式白名单。浮窗（overlay）模式已下线：它相对 dock 只差「不挤压对话区」，
// 而 dock 在窄视口（<1200px）本来就退化成不挤压的覆盖形态，native 又提供了更彻底的
// 「不参与对话区布局」形态，三选一里它没有独占场景。历史用户存过 gp-layout=overlay：
// 不在白名单 → prefStr 回落默认 'dock'，无需额外的迁移代码。
const LAYOUT_MODES = ['dock', 'native']

// currentSessionId：shell 当前主区会话（uiWorkspace.selection 镜像，见 index.js 的订阅）。
// 新版 DSH（0.1.7+）sessions store 不再暴露 current，靠它实现「切换对话 → 面板跟随工作区」。
// wsRoot：当前会话工作区根路径（GitPanelMain 解析出后写入）。跨组件的唯一共享通道——
// CommitArea 的「仓库不存在 → 重扫当前工作区 + 重试生成」自愈路径不能引用 GitPanelMain 的
// doScan 局部函数（跨作用域引用是本项目的 ReferenceError 高发区），改为直接读这里发 scan RPC。
// 启动即展开：DSH 启动（以及插件重装载）时，独立侧边栏直接把面板带出来，省掉每次点一遍
// 左下角开关；偏好 gp-open-on-start 默认开，设置弹窗里可关。native 不在此列——右栏页签
// 的开合归 DSH 的制表签状态管，插件在 apply 期代开会在用户关掉页签之后又把它拉起来。
// 判定放在 initialState 里：resetStore() 每次 apply 都重算，启动态与重装载态一致。
const initialState = () => {
  const layout = prefStr('gp-layout', LAYOUT_MODES, 'dock')
  const openOnStart = prefBool('gp-open-on-start', true)
  return {
    // panelOpen 即「面板是否显示」：启动时由偏好决定，之后只由开关/页签态改写
    panelOpen: openOnStart && layout !== 'native',
    toasts: [], refreshTick: 0, lastOp: null, lastOpRepoId: null,
    panelW: prefInt('gp-panel-w', 380, 2400, 520),
    collapsed: prefBool('gp-collapsed', false),
    layout,
    openOnStart,
    currentSessionId: null, wsRoot: '',
    toggleHidden: prefBool('gp-toggle-hidden', false),
    // 历史图行右侧小字（作者 · 日期）：默认关闭（长列表噪音），由历史工具条右端的日历按钮就地开关；全局偏好，所有仓库卡片一起变
    showGraphMeta: prefBool('gp-graph-meta', false)
  }
}
export const store = createStore(initialState())
// 重装载（apply 再次执行）时打回初始态：旧行为是每次 apply 新建 store。
// 注意这会重算「启动即展开」——插件热重载后用户刚关掉的面板会重新出现，与「启动即展开」
// 语义一致（真正的启动与重装载走同一条路径，不会出现两套状态）
export function resetStore() {
  store.set(() => initialState())
}


function pushToast(kind, text) {
  const id = 'gp-t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  store.set((s) => ({ ...s, toasts: s.toasts.concat([{ id, kind, text: String(text), exiting: false }]).slice(-5) }))
  getTimer().timeout(() => removeToast(id), 4600)
}
// 两段式移除：先标记 exiting（播放消失动画），动画时长过后真正移除
function removeToast(id) {
  store.set((s) => ({ ...s, toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)) }))
  getTimer().timeout(() => store.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 300)
}

function useStore() {
  const [, force] = React.useState(0)
  React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
  return store.get()
}
// 只导出有外部消费者的名字：createStore / removeToast / prefStr / LAYOUT_MODES 都是本模块
// 内部实现细节（初始 state 与 toast 生命周期），导出它们没有调用方，只增加"谁是公共 API"的噪声。
// savePrefStr 保留：modals.js 的布局模式单选要用它写 gp-layout。
export { prefInt, savePrefInt, prefBool, savePrefBool, savePrefStr, pushToast, useStore }
