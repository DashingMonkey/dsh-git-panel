/** 布局模式（dock 停靠 / overlay 浮窗）几何写路径 + DockSync 同步组件。 */
import React from 'react'
// ===== 布局模式（dock 停靠 / overlay 浮窗）几何写路径 =====
// 主路径纯 CSS：body[data-gp-dock] 属性 + div:has(> [data-shell-overlay]) 选择器
// （见样式段注释）。:has() 不可用的老环境走 JS 兜底：直接给 frame
// （[data-shell-overlay] 的父级）写内联 padding-right。React 重渲染只 diff 自己
// 管理的 style 键，内联 paddingRight 不会被抹掉；frame 整体重挂载时由 body 级
// MutationObserver 重涂（DSH-better-sidebar「panel host + 几何写路径」路线的
// 极简版）。锚点 [data-shell-overlay] 属 ui-layout 产物，版本升级若移除需同步
// 更新此处与样式段选择器（better-sidebar 对 DSH 版本敏感的前车之鉴）。
let dockW = 520
let dockObserver = null
// 折叠竖条宽度（px）：与样式段 .gp-rail 的 width 保持一致，折叠态并入停靠
// 挤压通道时以此值顶替面板宽（见 GitPanelMain 的 railPush/pushW）
const RAIL_W = 44
const DOCK_CSS_OK = (() => {
  try { return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('selector(div:has(*))') } catch (e) { return false }
})()
const dockFrameEl = () => {
  try {
    const layer = document.querySelector('[data-shell-overlay]')
    return (layer && layer.parentElement) || null
  } catch (e) { return null }
}
const dockInline = (w) => {
  const el = dockFrameEl()
  if (!el) return
  if (el.style.paddingRight !== w + 'px') el.style.paddingRight = w + 'px'
  if (el.style.boxSizing !== 'border-box') el.style.boxSizing = 'border-box'
}
const dockInlineClear = () => {
  const el = dockFrameEl()
  if (el) { el.style.removeProperty('padding-right'); el.style.removeProperty('box-sizing') }
}
// 停靠几何总入口：写 body 属性/CSS 变量（驱动 CSS 主路径），必要时启停 JS 兜底；
// active=false 清除全部痕迹（模式切换 / 面板关闭 / 卸载热重载共用）。
const applyDockGeometry = (active, w, noanim) => {
  if (typeof document === 'undefined' || !document.body) return
  dockW = w
  const body = document.body
  if (active) {
    body.setAttribute('data-gp-dock', '1')
    body.style.setProperty('--gp-dock-w', w + 'px')
    if (noanim) body.setAttribute('data-gp-dock-noanim', '1')
    else body.removeAttribute('data-gp-dock-noanim')
  } else {
    body.removeAttribute('data-gp-dock')
    body.removeAttribute('data-gp-dock-noanim')
    body.style.removeProperty('--gp-dock-w')
  }
  if (DOCK_CSS_OK) {
    dockInlineClear()
    if (dockObserver) { dockObserver.disconnect(); dockObserver = null }
    return
  }
  if (active) {
    dockInline(w)
    if (!dockObserver && typeof MutationObserver !== 'undefined') {
      dockObserver = new MutationObserver(() => { if (document.body.hasAttribute('data-gp-dock')) dockInline(dockW) })
      dockObserver.observe(body, { childList: true, subtree: true })
    }
  } else {
    if (dockObserver) { dockObserver.disconnect(); dockObserver = null }
    dockInlineClear()
  }
}

// 停靠几何同步组件（渲染 null）：DockSync 挂载期间每次渲染后同步
// 「是否挤压 + 挤压宽（面板宽或折叠竖条 RAIL_W）+ 拖拽态」；卸载（面板关闭/
// 插件卸载）时清除全部痕迹。on/w 由调用方计算（含折叠动画相位与窄视口守卫），
// 此处只负责写。
function DockSync({ on, w, noanim }) {
  React.useEffect(() => { applyDockGeometry(on, w, !!noanim) })
  React.useEffect(() => () => { applyDockGeometry(false, 0, false) }, [])
  return null
}
export { applyDockGeometry, DockSync, RAIL_W }
