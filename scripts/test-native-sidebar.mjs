/**
 * 行为回归（静态接线守卫）：原生侧栏模式（layout === 'native'）的装配链。
 *
 * DSH 右栏是「每会话一个停靠面」的制表签系统；Git Panel 作为一页制表签注册：
 *   sidebarRightTabs.register({id, kind, title}) → slots('sidebar.right.pane.tab') → PaneHost
 *   → GitPanelMain(native 门控渲染 .gp-pane-host)。钉住的接线点：
 *     1) store 布局白名单含 'native'，设置弹窗三选一；
 *     2) overlay 槽位在 native 下返回 null（绝不双渲染），且把 hook props 暂存到 runtime；
 *     3) 开关在 native 下走 openTab/hideNativeTab（contentId 固定 → 重复打开=聚焦）；
 *     4) GitPanelMain 的形态门控与抽屉宽度源（实测容器宽）；
 *     5) styles.js 有 native 段（面板去 fixed、抽屉贴容器左缘）；
 *     6) 构建产物 lib/client.js 确实含上述注册（防源码/产物漂移）。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = (p) => readFileSync(join(ROOT, p), 'utf8')
const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const has = (hay, needle, msg) => ({ ok: String(hay).includes(String(needle)), msg })

scenario('store 与设置弹窗', [
  has(R('src/client/store.js'), "'native'", 'LAYOUT_MODES 白名单含 native'),
  has(R('src/client/components/modals.js'), "opt('native'", '设置弹窗第三选项 native'),
  has(R('src/client/i18n.js'), "modeNative:", '中英文案 modeNative')
])

scenario('overlay 双渲染门控与 hook 暂存', [
  has(R('src/client/index.js'), "if (store.get().layout === 'native') return null", 'overlay 实例 native 下返回 null'),
  has(R('src/client/index.js'), 'stashOverlayHooks(', 'overlay props 暂存进 runtime'),
  has(R('src/client/runtime.js'), 'export function stashOverlayHooks', 'runtime 导出暂存器'),
  has(R('src/client/components/GitPanelMain.js'), 'takeOverlayHooks()', '页签正文回退取暂存钩子')
])

scenario('开关与页签开合语义', [
  has(R('src/client/index.js'), 'sr.openTab(NATIVE_KIND, { params: { contentId: NATIVE_TAB_ID } })', '固定 contentId 打开（重复打开=聚焦，去重语义）'),
  has(R('src/client/index.js'), 'function hideNativeTab', '用户路径收起连开关态复位'),
  has(R('src/client/index.js'), 'function quietHideNativeTab', '模式切换静默收（不动开关态，让 dock/overlay 接管）'),
  has(R('src/client/index.js'), "tabs.register({ id: NATIVE_TAB_ID, kind: NATIVE_KIND", '类型先注册（kind+title）'),
  has(R('src/client/index.js'), "slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_TAB_ID }, PaneHost)", '正文再经 slots 注册（与 Files/Terminal 同款两步）')
])

scenario('GitPanelMain 形态门控与抽屉定位', [
  has(R('src/client/components/GitPanelMain.js'), "const nativePane = s.layout === 'native'", '形态门控变量'),
  has(R('src/client/components/GitPanelMain.js'), 'className: \'gp-pane-host\'', 'native 渲染进页签容器'),
  has(R('src/client/components/GitPanelMain.js'), 'ResizeObserver', '容器实测宽随侧栏拖拽跟随'),
  has(R('src/client/components/GitPanelMain.js'), 'const drawerW = nativePane ? Math.min(960, Math.max(380, paneWidthRef.current)) : s.panelW', '抽屉宽度源：native 取实测容器宽'),
  has(R('src/client/components/GitPanelMain.js'), 'if (paneClose) { paneClose(); return }', 'header 关闭键 native 下走收页签'),
  has(R('src/client/components/GitPanelMain.js'), 'paneClose })', 'GitPanelMain 接受 paneClose 关闭钩子'),
  has(R('src/client/index.js'), 'paneClose: () => { hideNativeTab()', 'PaneHost 传入关闭钩子（header 关闭键收页签）')
])

scenario('styles.js native 段', [
  has(R('src/client/styles.js'), "body[data-gp-layout='native'] .gp-pane-host", 'native 容器样式'),
  has(R('src/client/styles.js'), "body[data-gp-layout='native'] .gp-pane-host > .gp-panel {", '面板覆写：去 fixed 宽满容器'),
  has(R('src/client/styles.js'), "body[data-gp-layout='native'] .gp-diff-drawer { right: 0 !important; }", '抽屉贴容器左缘')
])

scenario('构建产物含注册代码（防源码/产物漂移）', [
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'sidebar.right.pane.tab', 'bundle 内注册槽位'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'gp-pane-host', 'bundle 内 native 容器类名'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'sidebarRightTabs', 'bundle 内类型注册表引用')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 原生侧栏接线：${results.length} 组全部通过`
  : `✗ 原生侧栏接线：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)