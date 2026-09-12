/** 通知栈渲染（overlay 注册项；pushToast/removeToast 在 store.js）。 */
import React from 'react'
import { useStore } from '../store.js'
function ToastLayer() {
  const s = useStore()
  return React.createElement('div', { className: 'gp-toast-stack' },
    (s.toasts || []).map((t) => React.createElement('div', { key: t.id, className: 'gp-toast gp-toast-' + t.kind + (t.exiting ? ' gp-toast-exit' : '') }, t.text)))
}
export { ToastLayer }
