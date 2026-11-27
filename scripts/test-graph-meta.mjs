/**
 * 行为回归（静态接线守卫）：历史工具条右端的「行末作者 · 日期」开关。
 *
 * 背景：这个开关原先在「面板设置」弹窗里，1.4.x 搬到历史图谱工具条最右端（与
 * 「当前分支 / 全部」同一行）——它是本视图的显示密度选项，就地切换比翻设置页直接，
 * 设置页只留布局级选项（布局模式 + 隐藏左下角按钮）。本文件把接线钉住：
 *   1) 偏好键 gp-graph-meta 缺省 false，store 里是全局标志（所有仓库卡片共用）；
 *   2) 按钮在工具条内、位于两个视图 tab 之后（CSS margin-left:auto 推最右）——
 *      只断言类名存在是不够的：把按钮挪到仓库头部、或删掉推右规则，这里都要红；
 *   3) 点击翻转 store 并落盘 localStorage，落盘读 set 之后的值（连点不跑偏）；
 *   4) 日历图标 + 稳定 aria-label（不随状态翻转）+ aria-pressed 表开关态；
 *   5) 行级条件渲染：开关为真才渲染「作者 · 日期」；
 *   6) 中英双语键齐全且英文原文被 pin（tr() 缺键会静默回退中文，只查键名拦不住）；
 *   7) 旧入口删干净：设置弹窗不再有该开关、旧文案键已删、旧的常显 metaEl 已移除；
 *   8) 构建产物含新接线（防源码/产物漂移）。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = (p) => readFileSync(join(ROOT, p), 'utf8')
const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const has = (hay, needle, msg) => ({ ok: String(hay).includes(String(needle)), msg })
const lacks = (hay, needle, msg) => ({ ok: !String(hay).includes(String(needle)), msg })

const GRAPH = R('src/client/components/GitGraphView.js')
const I18N = R('src/client/i18n.js')
const ICONS = R('src/client/icons.js')
const CSS = R('src/client/styles.js')
const MODALS = R('src/client/components/modals.js')
const BUNDLE = R('lib/client.js')

// 工具条块切片（gp-graph-bar → bar 之后的悬停浮层 pop）：用来断言**顺序**而不是
// 全文件存在性，否则按钮被挪到别处、或两个 tab 被删掉，断言仍会通过。
const barStart = GRAPH.indexOf("className: 'gp-graph-bar'")
const barEnd = GRAPH.indexOf('const pop', barStart)
const barBlock = barStart >= 0 && barEnd > barStart ? GRAPH.slice(barStart, barEnd) : ''
const iTabCurrent = barBlock.indexOf("switchView('auto')")
const iTabAll = barBlock.indexOf("switchView('all')")
const iMetaBtn = barBlock.indexOf('gp-graph-meta-btn')

// 样式块切片（.gp-graph-meta-btn → 下一条 .gp-graph-scroll）：避免 min-width / 品牌色
// 这些子串恰好在别处（.gp-btn-icon、.gp-graph-tab-on）也存在而误判为通过。
const cssStart = CSS.indexOf('.gp-graph-meta-btn {')
const cssEnd = CSS.indexOf('.gp-graph-scroll {', cssStart)
const cssBlock = cssStart >= 0 && cssEnd > cssStart ? CSS.slice(cssStart, cssEnd) : ''

scenario('偏好与 store（全局标志，缺省关闭）', [
  has(R('src/client/store.js'), "showGraphMeta: prefBool('gp-graph-meta', false)", '偏好缺省 false（默认不显示日期）'),
  has(R('src/client/store.js'), '全局偏好，所有仓库卡片一起变', 'store 注释写清作用域（不再是「设置页可手动开启」）')
])

scenario('工具条位置：两个 tab 之后的图标按钮', [
  { ok: barStart >= 0 && barEnd > barStart, msg: '取到 gp-graph-bar 块' },
  { ok: iTabCurrent >= 0, msg: '工具条内有「当前分支」tab' },
  { ok: iTabAll > iTabCurrent, msg: '「全部」tab 在「当前分支」之后' },
  { ok: iMetaBtn > iTabAll, msg: '日期开关在「全部」之后（末尾 = 视觉最右，配合 CSS 推右）' },
  has(GRAPH, "icon('calendar', 14)", '日历图标给可点 affordance'),
  has(GRAPH, "title: metaTip", 'title 是随态动作提示'),
  has(GRAPH, "'aria-label': tr('graphMetaLabel')", 'aria-label 用稳定名字（不随状态翻转）'),
  has(GRAPH, "'aria-pressed': metaOn", 'aria-pressed 表开关态（布尔，不是三目字符串）')
])

scenario('点击语义：翻转 store 并落盘', [
  has(GRAPH, 'store.set((st) => ({ ...st, showGraphMeta: !st.showGraphMeta }))', '按钮翻转写 store（函数式更新，连点安全）'),
  has(GRAPH, "savePrefBool('gp-graph-meta', store.get().showGraphMeta)", '落盘读 set 之后的值（读渲染快照会写旧值）'),
  has(GRAPH, "s.showGraphMeta ? React.createElement('span'", '行级条件渲染：开关为真才渲染行小字'),
  has(GRAPH, "className: 'gp-graph-meta-btn' + (metaOn ? ' gp-graph-meta-on' : '')", '激活态类名随开关切换')
])

scenario('图标与样式', [
  has(ICONS, 'calendar: { f:', 'icons.js 定义 calendar 图标'),
  has(ICONS, 'C2.343 1 1 2.343 1 4V12C1 13.657', 'codicon calendar 外框字形（不是随便一个 path）'),
  { ok: cssStart >= 0 && cssEnd > cssStart, msg: '取到 .gp-graph-meta-btn 样式块' },
  has(cssBlock, 'margin-left: auto', '推最右（去掉它按钮会挤在 tab 旁边）'),
  has(cssBlock, 'min-width: 24px', '点击目标宽 ≥ 24（WCAG 2.2 SC 2.5.8）'),
  has(cssBlock, 'min-height: 22px', '点击目标高 ≥ 22'),
  has(cssBlock, '.gp-graph-meta-on, .gp-graph-meta-on:hover', '激活态（含 hover，压过 .gp-graph-meta-btn:hover）'),
  has(cssBlock, 'color: var(--dsw-alias-brand-primary)', '激活态品牌色')
])

scenario('中英文案（pin 英文原文，防 tr() 静默回退中文）', [
  has(I18N, "graphMetaLabel: '行末作者与日期'", '中文稳定名'),
  has(I18N, "graphMetaShowTip: '在每行右侧显示作者与日期'", '中文显示提示'),
  has(I18N, "graphMetaHideTip: '隐藏每行右侧的作者与日期'", '中文隐藏提示'),
  has(I18N, "graphMetaLabel: 'Author and date on each row'", '英文稳定名'),
  has(I18N, "graphMetaShowTip: 'Show author and date on the right of each row'", '英文显示提示'),
  has(I18N, "graphMetaHideTip: 'Hide author and date on the right of each row'", '英文隐藏提示')
])

scenario('旧入口已删干净', [
  // 同一偏好若还有第二处入口，状态来源就不唯一了
  lacks(MODALS, 'showGraphMeta', '设置弹窗不再有该开关'),
  lacks(I18N, 'showMetaTitle', '旧文案键 showMetaTitle 已删'),
  lacks(I18N, 'showMetaDesc', '旧文案键 showMetaDesc 已删'),
  lacks(GRAPH, 'const metaEl = React.createElement', '旧的常显 metaEl 已移除')
])

scenario('构建产物防漂移', [
  has(BUNDLE, 'gp-graph-meta-btn', 'bundle 内有按钮类名'),
  has(BUNDLE, 'graphMetaLabel', 'bundle 内有稳定 aria-label 文案'),
  has(BUNDLE, 'gp-graph-meta-on', 'bundle 内有激活态类名')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 历史行日期开关接线：${results.length} 组全部通过`
  : `✗ 历史行日期开关接线：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)
