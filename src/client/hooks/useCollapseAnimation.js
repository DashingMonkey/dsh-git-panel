/** 折叠/展开交叉滑入滑出动效（面板与竖条，240ms 相位）。 */
import React from 'react'
import { getTimer } from '../runtime.js'
import { store, savePrefBool } from '../store.js'
import { useEnterTransition } from './useEnterTransition.js'
// 折叠/展开滑动动效（复用 DiffDrawer 的相位模式，同 240ms/曲线）：点击不立即
// 切换渲染形态，先进过渡相——离场元素 translateX(100%) 右滑出屏、进场元素从
// 右缘屏外滑入，两者同时在场 ~240ms；动效播完才写入 collapsed（store +
// localStorage）并卸载离场元素。过渡相内忽略重复点击。onBeforeCollapse 在
// 折叠开始前调用（面板用于先关 diff 抽屉）。
function useCollapseAnimation(onBeforeCollapse) {
  const [collAnim, setCollAnim] = React.useState(null) // null | { dir, entered }
  // 过渡相：双 rAF 先让进场元素的屏外初始帧完成一次绘制，再置 entered 触发
  // transition（根治首帧以终态闪现的问题）
  useEnterTransition(!!collAnim && !collAnim.entered, () => setCollAnim((a) => (a ? { ...a, entered: true } : a)))
  // 收尾：动效播完（对齐 .22s 过渡）才真正切换折叠态并卸载离场元素；
  // 中途组件卸载则取消，不残留定时器
  React.useEffect(() => {
    if (!collAnim || !collAnim.entered) return
    return getTimer().timeout(() => {
      const toCollapsed = collAnim.dir === 'collapse'
      savePrefBool('gp-collapsed', toCollapsed)
      store.set((st) => ({ ...st, collapsed: toCollapsed }))
      setCollAnim(null)
    }, 240)
  }, [collAnim])
  const startCollapse = () => {
    if (collAnim) return
    if (onBeforeCollapse) onBeforeCollapse()
    setCollAnim({ dir: 'collapse', entered: false })
  }
  const startExpand = () => { if (!collAnim) setCollAnim({ dir: 'expand', entered: false }) }
  return { collAnim, startCollapse, startExpand }
}
export { useCollapseAnimation }
