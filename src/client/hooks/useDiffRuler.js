/** diff 滚动条 overview ruler 的测量逻辑（详见组件内与 CSS 注释）。 */
import React from 'react'
// diff 滚动条 overview ruler（详见 CSS 区 .gp-diff-ruler 注释）：渲染后实测每个
// diff 行的 offsetTop/offsetHeight（自动换行下行高不固定，只能实测 DOM），按
// 「行位置 ÷ 内容总高」生成红/绿色块，比例与滚动位置无关、滚动天然同步；
// 分栏修改对（左红右绿）拆为上半红/下半绿。active=内容就绪，refreshKey 变化
//（切换文件 / split / 全文）时重测：同步一次 + 下一帧校一次（防字体晚加载改
// 行高）；宽度变化（拖拽/窗口缩放）由 ResizeObserver 兜底重算。
function useDiffRuler(active, refreshKey) {
  const [marks, setMarks] = React.useState(null)
  const [sbw, setSbw] = React.useState(0)
  const bodyRef = React.useRef(null)
  const measureRuler = React.useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const w = el.offsetWidth - el.clientWidth
    setSbw((v) => (v === w ? v : w))
    const H = el.scrollHeight
    if (H <= el.clientHeight) { setMarks(null); return }
    const out = []
    let cur = null
    const push = (t, top, bot) => {
      if (cur && cur.t === t && top <= cur.bot + 0.002) { cur.bot = bot; cur.h = bot - cur.top }
      else { cur = { t, top, bot, h: bot - top }; out.push(cur) }
    }
    el.querySelectorAll('.gp-diff-row').forEach((row) => {
      const top = row.offsetTop / H
      const bot = (row.offsetTop + row.offsetHeight) / H
      if (row.classList.contains('gp-dr-add')) push('add', top, bot)
      else if (row.classList.contains('gp-dr-del')) push('del', top, bot)
      else if (row.classList.contains('gp-dr-note')) cur = null
      else {
        // 分栏行：修改对半行带 gp-dh-add / gp-dh-del；上下文行两者皆无
        const ha = row.querySelector('.gp-dh-add') != null
        const hd = row.querySelector('.gp-dh-del') != null
        if (ha && hd) { push('del', top, (top + bot) / 2); push('add', (top + bot) / 2, bot) }
        else if (ha) push('add', top, bot)
        else if (hd) push('del', top, bot)
        else cur = null
      }
    })
    setMarks(out.length ? out : null)
  }, [])
  React.useEffect(() => {
    if (!active) return
    measureRuler()
    const raf = requestAnimationFrame(() => measureRuler())
    return () => cancelAnimationFrame(raf)
  }, [active, refreshKey, measureRuler])
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measureRuler())
    if (bodyRef.current) ro.observe(bodyRef.current)
    return () => ro.disconnect()
  }, [measureRuler])
  // 点击 ruler 按比例跳转（目标行居中到视口）
  const onRulerClick = (e) => {
    const el = bodyRef.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    el.scrollTop = Math.max(0, Math.round(ratio * el.scrollHeight - el.clientHeight / 2))
  }
  return { marks, sbw, bodyRef, onRulerClick }
}
export { useDiffRuler }
