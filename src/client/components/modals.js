/** 小型弹窗：确认弹窗骨架（ConfirmModal）与面板设置（布局模式）弹窗。 */
import React from 'react'
import { tr } from '../i18n.js'
import { icon } from '../icons.js'
import { store, savePrefStr, useStore } from '../store.js'
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

// 布局模式设置弹窗：dock（停靠挤压对话）/ overlay（浮窗覆盖）二选一，点击卡片
// 即生效并记忆 localStorage（gp-layout），无保存按钮；底部提示窄视口自动回退。
// 单选点是纯 CSS 绘制的圆点（无 input 嵌套 button 的非法交互结构）。
function LayoutSettingsModal({ onClose }) {
  const s = useStore()
  const pick = (mode) => {
    if (mode !== s.layout) {
      store.set((st) => (st.layout === mode ? st : { ...st, layout: mode }))
      savePrefStr('gp-layout', mode)
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
        React.createElement('div', { className: 'gp-layout-hint' }, tr('layoutNarrowHint')))))
}
export { ConfirmModal, LayoutSettingsModal }
