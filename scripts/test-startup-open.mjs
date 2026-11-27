/**
 * 行为回归：DSH 启动即展开面板（gp-open-on-start）。
 *
 * 需求：启动 DSH 后不必再点一次左下角开关，侧边栏（dock）模式直接把面板带出来。
 * 判定收敛在 store.js 的 initialState()：resetStore() 每次 apply 都会重算，所以「真启动」
 * 与「插件重装载」走同一条路径，不会出现两套状态。native 不代开页签——右栏页签的开合归
 * DSH 的制表签状态管，插件在 apply 期代开会在用户关掉页签之后又把它拉起来。
 *
 * 覆盖：
 *   A) 无任何偏好：默认 dock + 面板展开；
 *   B) 偏好 gp-open-on-start=0：不展开（可关）；
 *   C) native 布局：即使偏好为开也不展开（页签交回右栏）；
 *   D) 历史 gp-layout=overlay：白名单回落 dock，并照常展开；
 *   E) 折叠偏好不被吞：panelOpen 展开但 collapsed 保持，启动只恢复竖条；
 *   F) 设置弹窗开关 / 双语文案 / 构建产物防漂移。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = (p) => readFileSync(join(ROOT, p), 'utf8')
const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })
const has = (hay, needle, msg) => ({ ok: String(hay).includes(String(needle)), msg })
const lacks = (hay, needle, msg) => ({ ok: !String(hay).includes(String(needle)), msg })

// ---- 假 localStorage：先垫片再动态 import（store.js 装载期就会读偏好）----
class FakeLS {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
const ls = new FakeLS()
globalThis.window = { localStorage: ls }
const { store, resetStore } = await import(new URL('../src/client/store.js', import.meta.url))

// 写入偏好后走 resetStore()——与 index.js 的 apply 完全同一条路径（启动态重算）
const boot = (prefs) => {
  for (const [k, v] of Object.entries(prefs)) {
    if (v == null) ls.removeItem(k)
    else ls.setItem(k, v)
  }
  resetStore()
  return store.get()
}

// ---- A) 缺省：dock + 展开 ----
{
  const s = boot({ 'gp-layout': null, 'gp-open-on-start': null })
  scenario('A 缺省启动：dock + 面板展开', [
    eq(s.layout, 'dock', '默认布局仍是 dock'),
    eq(s.openOnStart, true, '偏好缺省为开'),
    eq(s.panelOpen, true, '启动即展开（不必点左下角开关）')
  ])
}

// ---- B) 关掉偏好：收着启动 ----
{
  const s = boot({ 'gp-open-on-start': '0' })
  scenario('B gp-open-on-start=0：收着启动', [
    eq(s.openOnStart, false, '偏好读回关闭'),
    eq(s.panelOpen, false, '面板不展开（恢复旧行为）')
  ])
}

// ---- C) native：不代开页签 ----
{
  const s = boot({ 'gp-layout': 'native', 'gp-open-on-start': '1' })
  scenario('C native 不被代开页签', [
    eq(s.layout, 'native', '布局读回 native'),
    eq(s.openOnStart, true, '偏好仍为开'),
    eq(s.panelOpen, false, '启动不代开右栏页签（交回 DSH 制表签状态）')
  ])
}

// ---- D) 历史 overlay 偏好：回落 dock 并展开 ----
{
  const s = boot({ 'gp-layout': 'overlay', 'gp-open-on-start': '1' })
  scenario('D 历史 gp-layout=overlay 回落 dock', [
    eq(s.layout, 'dock', '白名单把 overlay 回落为 dock'),
    eq(s.panelOpen, true, '回落之后照常启动即展开')
  ])
}

// ---- E) 折叠偏好不被启动展开吞掉 ----
{
  const s = boot({ 'gp-layout': 'dock', 'gp-collapsed': '1', 'gp-open-on-start': '1' })
  scenario('E 折叠偏好保留：启动只恢复竖条', [
    eq(s.panelOpen, true, '按偏好进入打开态'),
    eq(s.collapsed, true, '折叠偏好不被 resetStore 改写（界面只出竖条，不强行展开）')
  ])
}

// ---- F) 设置开关、文案与产物 ----
const STORE = R('src/client/store.js')
const MODALS = R('src/client/components/modals.js')
const I18N = R('src/client/i18n.js')
const INDEX = R('src/client/index.js')
const STYLES = R('src/client/styles.js')
const BUNDLE = R('lib/client.js')

scenario('设置弹窗开关与文案', [
  has(STORE, "prefBool('gp-open-on-start', true)", '偏好缺省开（新装用户直接享受启动即展开）'),
  has(STORE, "panelOpen: openOnStart && layout !== 'native'", '启动展开只对非 native 生效'),
  lacks(STORE, 'panelOpen: false,', '旧的「启动永远关闭」硬编码已移除'),
  has(MODALS, "savePrefBool('gp-open-on-start'", '开关写入 localStorage'),
  // 两个独立开关统一走 toggle 助手：只留标题 + 勾选框，说明行已删
  has(MODALS, "const toggle = (on, titleKey, onClick) =>", '开关行收敛为一个助手（勾选框 + 标题）'),
  has(MODALS, "className: 'gp-toggle-opt' + (on ? ' gp-toggle-on' : '')", '勾选态走 .gp-toggle-on'),
  has(MODALS, "'aria-checked': on", 'aria-checked 随状态（读屏可辨）'),
  has(MODALS, "toggle(s.openOnStart, 'openOnStartTitle'", '启动开关复用助手'),
  has(MODALS, "toggle(s.toggleHidden, 'hideToggleTitle'", '隐藏按钮开关复用助手'),
  has(MODALS, "role: 'switch'", '开关语义 role=switch（读屏可辨）'),
  // 勾选态的视觉与动效也别丢：图形显隐/反色、过渡都在同一组选择器里
  has(STYLES, '.gp-toggle-opt.gp-toggle-on .gp-toggle-box svg', '勾选态图形样式（显隐 + 反色）'),
  has(STYLES, 'transition: opacity .08s ease', '勾选图形有过渡（不是硬切）'),
  has(INDEX, 'resetStore()', 'apply 期仍走 resetStore（启动态重算的接线）'),
  // 勾选图形是线性对勾字形（lucide 同款），不是 CSS 拼边框/codicon 填充字形——
  // 后两者在 16px 方框里都会发虚（用户实测），改回任何一个都应该红。
  has(MODALS, "icon('checkLine', 14, 3)", '勾选图形用线性对勾（14px / sw3）'),
  has(R('src/client/icons.js'), "checkLine: { vb: '0 0 24 24'", 'icons.js 定义 checkLine（24 网格）'),
  lacks(R('src/client/styles.js'), '.gp-toggle-box::before', 'CSS 拼边框的对勾已删除'),
  lacks(MODALS, 'openOnStartDesc', '启动开关不渲染说明行'),
  lacks(MODALS, 'hideToggleDesc', '隐藏开关不渲染说明行'),
  // 设置页只留「选项 + 开关」：模式说明保留（两个模式需要解释差别），但底部的窄窗提示已删——
  // 窄窗退化为覆盖是自动行为，不需要用户在设置页先读一段说明。
  lacks(MODALS, 'gp-layout-hint', '底部窄窗提示已删'),
  lacks(I18N, 'layoutNarrowHint', '窄窗提示文案键已删'),
  lacks(I18N, 'openOnStartDesc', '启动开关的说明文案键已删'),
  lacks(I18N, 'hideToggleDesc', '隐藏按钮的说明文案键已删'),
  has(I18N, "openOnStartTitle: '启动时自动打开面板'", '中文标题'),
  has(I18N, "openOnStartTitle: 'Open panel on startup'", '英文标题（pin 原文，防 tr 静默回退中文）')
])

scenario('构建产物防漂移', [
  has(BUNDLE, 'gp-open-on-start', 'bundle 内偏好键'),
  has(BUNDLE, '启动时自动打开面板', 'bundle 内中文文案'),
  // esbuild 出口把字符串统一成双引号，这里按产物形态 pin（源码那份在上面 STORE 断言里用单引号）
  has(BUNDLE, 'panelOpen: openOnStart && layout !== "native"', 'bundle 内启动展开判定（不是旧产物）')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 启动即展开面板：${results.length} 组全部通过`
  : `✗ 启动即展开面板：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)
