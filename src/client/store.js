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
// gp-diff-full（全文）/ gp-collapsed（折叠态）/ gp-layout（布局模式：dock 停靠 / overlay 浮窗）
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
const LAYOUT_MODES = ['dock', 'overlay']

const initialState = () => ({ panelOpen: false, toasts: [], refreshTick: 0, lastOp: null, lastOpRepoId: null, panelW: prefInt('gp-panel-w', 380, 2400, 520), collapsed: prefBool('gp-collapsed', false), layout: prefStr('gp-layout', LAYOUT_MODES, 'dock') })
export const store = createStore(initialState())
// 重装载（apply 再次执行）时打回初始态：旧行为是每次 apply 新建 store
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
