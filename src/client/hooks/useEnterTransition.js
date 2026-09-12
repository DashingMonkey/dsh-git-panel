/** 双 rAF 入场动效（根治首帧以终态闪现）。 */
import React from 'react'
// 双 rAF 入场：先让屏外/初始样式完成一次绘制，再触发 transition 切到终态
//（根治首帧以终态闪现的问题）。active 由 false 变 true 时启动；返回前可取消。
function useEnterTransition(active, onReady) {
  const rafRef = React.useRef(0)
  const cbRef = React.useRef(onReady)
  cbRef.current = onReady
  React.useEffect(() => {
    if (!active) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => cbRef.current())
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])
}
export { useEnterTransition }
