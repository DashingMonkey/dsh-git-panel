/** 左缘拖拽调宽（面板 / diff 抽屉共用）。 */
import React from 'react'

// 左缘拖拽调宽（面板 / diff 抽屉共用）：begin() 由拖拽手柄 pointerdown 调用，
// move 期间按公式实时写宽度（含视口钳制，公式在调用方的 apply 里），松手持久化，
// 并回调 onEnd 让调用方复位拖拽态（如激活样式、禁动画标记）。
function useWidthDrag(apply, persist, onEnd) {
  const resizeRef = React.useRef(false)
  const wRef = React.useRef(0)
  const applyRef = React.useRef(apply)
  const persistRef = React.useRef(persist)
  const onEndRef = React.useRef(onEnd)
  applyRef.current = apply
  persistRef.current = persist
  onEndRef.current = onEnd
  React.useEffect(() => {
    const onMove = (e) => {
      if (!resizeRef.current) return
      wRef.current = applyRef.current(e)
    }
    const onUp = () => {
      if (!resizeRef.current) return
      resizeRef.current = false
      persistRef.current(wRef.current)
      if (onEndRef.current) onEndRef.current()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
  }, [])
  return { begin: () => { resizeRef.current = true } }
}
export { useWidthDrag }
