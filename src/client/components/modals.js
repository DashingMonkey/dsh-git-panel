/** 小型弹窗：确认弹窗骨架（ConfirmModal）与面板设置（布局模式）弹窗。 */
import React from 'react'
import { tr } from '../i18n.js'
import { icon } from '../icons.js'
import { store, savePrefStr, savePrefBool, useStore, pushToast } from '../store.js'
import { openNativeTab, quietHideNativeTab, canUseNativePane } from '../nativePane.js'
// 小型确认弹窗骨架（放弃更改 / Reset / Clean / 中止合并 共用）：warning 图标标题 +
// 自定义 body + 取消/危险确认按钮；backdrop 点击关闭，Esc 分层由调用方处理
function ConfirmModal({ title, body, okLabel, busy, onCancel, onOk }) {
  return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); onCancel() } },
    React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'gp-modal-head' }, icon('warning', 15), title),
      React.createElement('div', { className: 'gp-modal-body' }, body),
      React.createElement('div', { className: 'gp-modal-foot' },
        React.createElement('button', { className: 'gp-btn', onClick: onCancel }, tr('cancel')),
        React.createElement('button', { className: 'gp-btn gp-btn-danger', disabled: !!busy, onClick: onOk }, okLabel))))
}

// 布局模式设置弹窗：dock（停靠挤压对话）/ overlay（浮窗覆盖）/ native（原生侧栏制表签页签）
// 三选一，点击卡片即生效并记忆 localStorage（gp-layout），无保存按钮；底部提示窄视口自动回退。
// 单选点是纯 CSS 绘制的圆点（无 input 嵌套 button 的非法交互结构）。
function LayoutSettingsModal({ onClose }) {
  const s = useStore()
  const pick = (mode) => {
    if (mode === s.layout) { onClose(); return }
    // native 不是「只改个偏好」：它要把面板搬进 DSH 右侧栏。缺右栏服务/会话时
    // 提前拒绝并提示，免得上一个选项都没生效、面板还留在远处。
    if (mode === 'native' && !canUseNativePane()) {
      pushToast('error', tr('gpNativeFailed'))
      onClose()
      return
    }
    const prev = s.layout
    store.set((st) => (st.layout === mode ? st : { ...st, layout: mode }))
    savePrefStr('gp-layout', mode)
    if (mode === 'native') {
      // 立即开页签：设置弹窗就是从面板里打开的，选了却不出现＝又一次「面板没变化」。
      // openNativeTab 失败时已 toast，这里把布局与偏好回滚，保持现场一致。
      if (!openNativeTab()) {
        store.set((st) => ({ ...st, layout: prev }))
        savePrefStr('gp-layout', prev)
      }
    } else {
      // 离开 native：收掉右栏那枚 Git Panel 页签，让 dock/overlay 实例按 panelOpen
      // 接管（静默收，不动开关态，避免面板闪断）。
      quietHideNativeTab()
    }
    onClose()
  }
  const opt = (mode, titleKey, descKey, badgeKey) => React.createElement('button', {
    className: 'gp-layout-opt' + (s.layout === mode ? ' gp-layout-on' : ''),
    onClick: () => pick(mode)
  },
    React.createElement('span', { className: 'gp-layout-radio', 'aria-hidden': true }),
    React.createElement('span', { className: 'gp-layout-opt-text' },
      React.createElement('span', { className: 'gp-layout-opt-title' }, tr(titleKey), badgeKey ? React.createElement('span', { className: 'gp-layout-default-badge' }, tr(badgeKey)) : null),
      React.createElement('span', { className: 'gp-layout-opt-desc' }, tr(descKey))))
  return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); onClose() } },
    React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'gp-modal-head' }, icon('gear', 15), tr('panelSettings')),
      React.createElement('div', { className: 'gp-modal-body' },
        opt('dock', 'modeDock', 'modeDockDesc', 'modeDockBadge'),
        opt('overlay', 'modeOverlay', 'modeOverlayDesc', null),
        opt('native', 'modeNative', 'modeNativeDesc', null),
        // 独立开关项（不是单选组）：隐藏侧栏底部的 Git Panel 入口按钮。
        // 关闭后的重新打开路径：native 走右栏开始页卡片；dock/overlay 由折叠竖条兜底。
        React.createElement('button', {
          className: 'gp-toggle-opt' + (s.toggleHidden ? ' gp-toggle-on' : ''),
          onClick: () => {
            store.set((st) => ({ ...st, toggleHidden: !st.toggleHidden }))
            savePrefBool('gp-toggle-hidden', !s.toggleHidden)
          }
        },
          React.createElement('span', { className: 'gp-toggle-box', 'aria-hidden': true }),
          React.createElement('span', { className: 'gp-layout-opt-text' },
            React.createElement('span', { className: 'gp-layout-opt-title' }, tr('hideToggleTitle')),
            React.createElement('span', { className: 'gp-layout-opt-desc' }, tr('hideToggleDesc')))),
        // 独立开关项：历史图行右侧小字（作者 · 日期）默认关闭，开启后每行显示。
        React.createElement('button', {
          className: 'gp-toggle-opt' + (s.showGraphMeta ? ' gp-toggle-on' : ''),
          onClick: () => {
            store.set((st) => ({ ...st, showGraphMeta: !st.showGraphMeta }))
            savePrefBool('gp-graph-meta', !s.showGraphMeta)
          }
        },
          React.createElement('span', { className: 'gp-toggle-box', 'aria-hidden': true }),
          React.createElement('span', { className: 'gp-layout-opt-text' },
            React.createElement('span', { className: 'gp-layout-opt-title' }, tr('showMetaTitle')),
            React.createElement('span', { className: 'gp-layout-opt-desc' }, tr('showMetaDesc')))),
        React.createElement('div', { className: 'gp-layout-hint' }, tr('layoutNarrowHint')))))
}
export { ConfirmModal, LayoutSettingsModal }
