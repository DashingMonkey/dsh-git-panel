/**
 * 行为回归（静态接线守卫）：原生侧栏模式（layout === 'native'）的装配链。
 *
 * DSH 右栏是「每会话一个停靠面」的制表签系统；Git Panel 作为一页制表签注册：
 *   sidebarRightTabs.register({id, kind, title, guide}) → slots('sidebar.right.pane.tab') → PaneHost
 *   → GitPanelMain(native 门控渲染 .gp-pane-host)。钉住的接线点：
 *     1) store 布局白名单含 'native'，设置弹窗三选一；
 *     2) overlay 槽位在 native 下返回 null（绝不双渲染），且把 hook props 暂存到 runtime；
 *     3) 开关在 native 下走 openTab/hideNativeTab（contentId 固定 → 重复打开=聚焦）；
 *     4) guide 声明让右栏开始页（引导页）渲染入口卡片；
 *     5) 渲染/轮询门控不依赖 panelOpen——开始页入口卡片开页签不经 openNativeTab，
 *        panelOpen 为假时必须照常出内容（原版从这里进入必空白）；
 *     6) data-gp-layout 属性写 body（与样式段选择器一致，旧 documentElement 写法已消除）；
 *     7) styles.js 有 native 段（面板去 fixed、抽屉贴容器左缘）；
 *     8) 构建产物 lib/client.js 确实含上述注册（防源码/产物漂移）；
 *     9) native 下点**任何**分组的文件行（含 Git 历史）都开「变更详情」新页签，
 *        分组随参数走、DiffPaneHost 白名单归一；
 *    10) 「锚进当前页签内部」的旧方案已废弃：组件与样式里的痕迹须清干净，
 *        根层抽屉仅限 dock/overlay。
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
const lacks = (hay, needle, msg) => ({ ok: !String(hay).includes(String(needle)), msg })

scenario('store 与设置弹窗', [
  has(R('src/client/store.js'), "'native'", 'LAYOUT_MODES 白名单含 native'),
  has(R('src/client/store.js'), "toggleHidden: prefBool('gp-toggle-hidden', false)", '开关隐藏偏好持久化'),
  has(R('src/client/components/modals.js'), "opt('native'", '设置弹窗第三选项 native'),
  has(R('src/client/components/modals.js'), 'gp-toggle-opt', '设置弹窗的「隐藏左下角开关」独立开关行'),
  has(R('src/client/components/modals.js'), "savePrefBool('gp-toggle-hidden'", '开关隐藏写入 localStorage'),
  has(R('src/client/i18n.js'), 'modeNative:', '中英文案 modeNative'),
  has(R('src/client/i18n.js'), 'hideToggleTitle:', '中英文案 hideToggleTitle')
])

scenario('历史图行小字开关（默认关闭）', [
  has(R('src/client/store.js'), "showGraphMeta: prefBool('gp-graph-meta', false)", '偏好缺省 false（默认不显示日期）'),
  has(R('src/client/components/modals.js'), 'showGraphMeta: !st.showGraphMeta', '设置弹窗开关翻转写 store'),
  has(R('src/client/components/modals.js'), "savePrefBool('gp-graph-meta'", '开关写入 localStorage'),
  has(R('src/client/components/modals.js'), "tr('showMetaTitle')", '弹窗标题键 showMetaTitle'),
  has(R('src/client/i18n.js'), 'showMetaTitle:', '中英文案 showMetaTitle'),
  has(R('src/client/i18n.js'), "showMetaDesc: 'Each commit row shows author and date on the right", '英文文案 showMetaDesc'),
  // GitGraphView 行级条件渲染：开关为真才渲染 metaEl（作者 · 日期）
  has(R('src/client/components/GitGraphView.js'), "s.showGraphMeta ? React.createElement('span'", 'GitGraphView 按开关条件渲染行小字'),
  lacks(R('src/client/components/GitGraphView.js'), 'const metaEl = React.createElement', '旧的常显 metaEl 已移除')
])

scenario('左下角按钮可隐藏与重开兜底', [
  // 隐藏偏好开启时槽位整体不渲染；但 useStore 必须在提前 return **之前**调用 ——
  // 否则开关切换时 hook 数量变化（React: Rendered fewer hooks than expected），
  // 整个 footer 槽位崩溃、按钮与面板入口一起消失。
  (() => {
    const src = R('src/client/index.js')
    const start = src.indexOf("id: 'git-panel-toggle'")
    const end = src.indexOf('const nativeOn', start)
    const block = start >= 0 && end > start ? src.slice(start, end) : ''
    const hook = block.indexOf('const s = useStore()')
    const ret = block.indexOf('if (s.toggleHidden) return null')
    return { ok: hook >= 0 && ret > hook, msg: 'useStore 先于隐藏态 return（hook 顺序稳定，隐藏开关不崩 footer）' }
  })(),
  has(R('src/client/index.js'), 'if (s.toggleHidden) return null', '槽位在隐藏偏好开启时整体不渲染'),
  has(R('src/client/components/GitPanelMain.js'), '(s.toggleHidden && !effectiveOpen)', '隐藏态 dock/overlay 由折叠竖条兜底重开（native 不给，开始页卡片即入口）')
])

scenario('overlay 双渲染门控与 hook 暂存', [
  // overlay 包装必须是订阅 store 的组件：只在注册回调里 store.get() 读一次的话，
  // 从设置切到 native 时它不重渲染、不让位，面板就以浮层身份继续停在右侧
  //（1.4.0 实测：右栏没开、无页签、data-gp-layout 也没挂，用户看到「切了没变化」）。
  has(R('src/client/index.js'), 'function OverlayHost(props)', 'overlay 槽位用组件承载（可订阅）'),
  (() => {
    const src = R('src/client/index.js')
    const start = src.indexOf('function OverlayHost')
    const end = src.indexOf('function setGpLayoutAttr', start)
    const block = start >= 0 && end > start ? src.slice(start, end) : ''
    const hook = block.indexOf('const s = useStore()')
    const gate = block.indexOf("if (s.layout === 'native') return null")
    return { ok: hook >= 0 && gate > hook, msg: 'OverlayHost 先 useStore 订阅，再按 layout 让位' }
  })(),
  has(R('src/client/index.js'), '        OverlayHost', '注册的是 OverlayHost 组件'),
  has(R('src/client/index.js'), 'stashOverlayHooks(', 'overlay props 暂存进 runtime'),
  has(R('src/client/runtime.js'), 'export function stashOverlayHooks', 'runtime 导出暂存器'),
  has(R('src/client/components/GitPanelMain.js'), 'takeOverlayHooks()', '页签正文回退取暂存钩子')
])

scenario('开关与页签开合语义', [
  // 开合动作与 sessionId → 页签 id 登记表在 nativePane.js：设置弹窗（modals.js）也要
  // 用同一套动作，而 modals 不能反向 import index.js（GitPanelMain → modals 已成边）。
  has(R('src/client/nativePane.js'), 'sr.openTab(NATIVE_KIND, { params: { contentId: NATIVE_TAB_ID } })', '固定 contentId 打开（重复打开=聚焦，去重语义）'),
  has(R('src/client/nativePane.js'), 'function hideNativeTab', '用户路径收起连开关态复位'),
  has(R('src/client/nativePane.js'), 'function quietHideNativeTab', '模式切换静默收（不动开关态，让 dock/overlay 接管）'),
  has(R('src/client/nativePane.js'), 'function canUseNativePane', '切换前能力检查（无右栏/无会话不切模式）'),
  has(R('src/client/index.js'), 'kind: NATIVE_KIND,', '类型先注册（kind+title）'),
  has(R('src/client/index.js'), "guide: [{ id: 'panel', order: 30, title: () => tr('gpGuideTitle'), description: () => tr('gpGuideDesc') }]", 'guide 声明让开始页（引导页）渲染入口卡片（点击按 kind 开页签）'),
  has(R('src/client/i18n.js'), 'gpGuideTitle:', '中英文案 gpGuideTitle'),
  has(R('src/client/index.js'), "slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_TAB_ID }, PaneHost)", '正文再经 slots 注册（与 Files/Terminal 同款两步）'),
  has(R('src/client/index.js'), 'registerNativeTab(tabId)', '页签正文挂载时补登记 id（开始页入口卡片路径）'),
  has(R('src/client/index.js'), 'tab.actions.close()', '切走布局时用框架动作关页签（不依赖内存表）')
])

scenario('设置里切 native：立即搬进右栏', [
  has(R('src/client/components/modals.js'), "import { openNativeTab, quietHideNativeTab, canUseNativePane } from '../nativePane.js'", '设置弹窗复用原生页签动作（无循环依赖）'),
  has(R('src/client/components/modals.js'), 'if (mode === \'native\' && !canUseNativePane())', '无右栏服务/会话时拒绝切换并提示'),
  has(R('src/client/components/modals.js'), 'if (!openNativeTab()) {', '切 native 时立即开页签'),
  has(R('src/client/components/modals.js'), 'store.set((st) => ({ ...st, layout: prev }))', '开页签失败回滚布局'),
  has(R('src/client/components/modals.js'), 'quietHideNativeTab()', '切离 native 时收掉页签（交给 dock/overlay）'),
  // 右栏开始页的入口卡片按 kind 直接开页签、不经过设置弹窗：正文挂载时要把布局
  // 切到 native，否则页签里不会出图（dock 面板另有实例），点卡片等于什么都没发生。
  has(R('src/client/index.js'), 'const mountedRef = React.useRef(false)', '页签正文区分「首次挂载」与「布局被切走」'),
  has(R('src/client/index.js'), "savePrefStr('gp-layout', 'native')", '入口卡片挂载即切 native 并记忆')
])

scenario('GitPanelMain 形态门控与抽屉定位', [
  has(R('src/client/components/GitPanelMain.js'), 'const effectiveOpen = nativePane ? true : s.panelOpen', '渲染门控：native 下页签在屏即显示（不看 panelOpen——开始页入口卡片开页签不经 openNativeTab）'),
  has(R('src/client/components/GitPanelMain.js'), 'if (!(nativePane || s.panelOpen)) return', '自动轮询同口径：开始页进入的页签不停摆'),
  // 折叠态回归守卫：showDocked 在组件顶部读 collDir，它必须在那之前就声明。
  // 曾把它留在 return 前的渲染段 —— s.collapsed 为真时表达式求值命中 const 的 TDZ，
  // 整个组件在挂载期抛 "Cannot access 'collDir' before initialization"（slot 错误
  // 边界吞掉后表现为「点 Git Panel 没反应」；展开态因 || 短路侥幸不触发）。
  (() => {
    const src = R('src/client/components/GitPanelMain.js')
    const decl = src.indexOf('const collDir =')
    const use = src.indexOf('const showDocked =')
    return { ok: decl > 0 && use > 0 && decl < use, msg: 'collDir 先于 showDocked 声明（折叠态 TDZ 崩溃守卫）' }
  })(),
  has(R('src/client/components/GitPanelMain.js'), 'className: \'gp-pane-host\'', 'native 渲染进页签容器'),
  has(R('src/client/components/GitPanelMain.js'), 'className: \'gp-panel\'', '页签内保留 .gp-panel 层（基础样式载体 + native 覆写选择器目标）'),
  // native 下抽屉不再出现（详情一律走新页签），宽度源回归面板宽；实测宽代码已删
  has(R('src/client/components/GitPanelMain.js'), 'const drawerW = s.panelW', '抽屉宽度源回归面板宽（native 无抽屉）'),
  lacks(R('src/client/components/GitPanelMain.js'), 'paneWidthRef', '容器实测宽的残留代码已清干净'),
  has(R('src/client/components/GitPanelMain.js'), 'if (paneClose) { paneClose(); return }', 'header 关闭键 native 下走收页签')
])

scenario('data-gp-layout 属性写 body（选择器是 body[...]）', [
  has(R('src/client/index.js'), 'function setGpLayoutAttr(on)', '属性读写收敛为一个函数'),
  has(R('src/client/index.js'), 'document.body.setAttribute(\'data-gp-layout\', \'native\')', '写 body 而非 html（与样式段选择器一致）'),
  lacks(R('src/client/index.js'), 'documentElement.setAttribute', '不再误写 documentElement（旧版死代码已消除）'),
  has(R('src/client/index.js'), 'if (s.layout === \'native\' && !s.panelOpen) store.set((st) => ({ ...st, panelOpen: true }))', '页签挂载补点亮开关（开始页进入的路径）')
])

scenario('native 下点任意分组的文件行 → 开「变更详情」新页签', [
  has(R('src/client/nativeDiff.js'), "const DIFF_KIND = 'git-diff'", '变更详情页签的 kind 声明'),
  has(R('src/client/nativeDiff.js'), 'function diffTabParams(repo, f, group)', '分组随打开参数走'),
  has(R('src/client/nativeDiff.js'), 'group: String(group || \'commit\')', 'params 携带 group（缺省 commit）'),
  has(R('src/client/nativeDiff.js'), 'export function openNativeDiffTab(repo, f, group)', '打开函数带分组入参'),
  has(R('src/client/nativeDiff.js'), 'sr.openTab(DIFF_KIND, { params })', '开页签经 openTab(kind, params)'),
  has(R('src/client/nativeDiff.js'), 'lastParamsByContentId', '模块级打开参数快照（正文兜底取参源）'),
  has(R('src/client/components/DiffPaneHost.js'), 'GROUP_WHITELIST', '正文对分组做白名单归一'),
  has(R('src/client/components/DiffPaneHost.js'), "const h = group === 'commit' ? (hash || null) : null", '仅 commit 组带 hash（其余组走工作区口径）'),
  has(R('src/client/components/DiffPaneHost.js'), 'props.useTabInfo()', '正文经框架注入的 useTabInfo 读导航参数'),
  has(R('src/client/components/DiffPaneHost.js'), 'fitContainer: true', 'DiffDrawer 内嵌铺满页签容器'),
  has(R('src/client/index.js'), "slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_DIFF_TAB_ID }, DiffPaneHost)", '变更详情正文注册进 pane.tab'),
  has(R('src/client/components/GitPanelMain.js'), "if (s.layout === 'native') { openNativeDiffTab(repo2, f, group); return }", 'native 下任何分组都开新页签（不再分支 commit）'),
  // 「锚进当前页签内部」方案已废弃（那层会被页签本体盖住，用户看到点击无反应）：
  // 源码与样式里的痕迹必须清干净，防后续误复活
  lacks(R('src/client/components/GitPanelMain.js'), 'nativeDiffInPane', '页签内嵌详情路径已从组件删除'),
  lacks(R('src/client/styles.js'), 'gp-inset-full', 'inset-full 死规则已从样式删除'),
  // 根层覆盖抽屉只在 dock/overlay 出现（native 一律走新页签）
  has(R('src/client/components/GitPanelMain.js'), '!nativePane && diffSel && diffRepo ? React.createElement(DiffDrawer', '根层抽屉仅限 dock/overlay')
])

scenario('styles.js native 段', [
  has(R('src/client/styles.js'), "body[data-gp-layout='native'] .gp-pane-host > .gp-panel {", '面板覆写：去 fixed 宽满容器'),
  // 高度链：native 下面板必须拿到确定高度（height/flex/min-height），否则 gp-main/gp-body
  // 的滚动失效、长列表底部被 .gp-pane-host 的 overflow:hidden 裁掉（本轮实测故障）
  // 行尾用独立子串断言（不跨行，兼容 CRLF/LF 混排）
  has(R('src/client/styles.js'), 'height: 100%; flex: 1 1 auto; min-height: 0;', 'native 面板高度由页签容器决定（滚动链前提）'),
  has(R('src/client/styles.js'), "body[data-gp-layout='native'] .gp-pane-host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; position: relative; }", '页签容器纵向布局（变更详情页签正文的 .gp-diff-panewrap 在其内 flex 撑满）'),
  has(R('src/client/styles.js'), '.gp-diff-panewrap .gp-diff-drawer {', '抽屉在页签正文容器内定位'),
  has(R('src/client/styles.js'), 'left: 0 !important; right: 0 !important; width: auto !important; height: 100% !important;', '容器内铺满定位（与组件内联 inset 双保险）')
])

scenario('构建产物含注册代码（防源码/产物漂移）', [
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'sidebar.right.pane.tab', 'bundle 内注册槽位'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'gp-pane-host', 'bundle 内 native 容器类名'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'sidebarRightTabs', 'bundle 内类型注册表引用'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'effectiveOpen', 'bundle 内渲染门控（native 不看 panelOpen）'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'gpGuideTitle:', 'bundle 内开始页入口文案')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 原生侧栏接线：${results.length} 组全部通过`
  : `✗ 原生侧栏接线：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)