/**
 * 行为回归（静态接线守卫）：原生侧栏模式（layout === 'native'）的装配链。
 *
 * DSH 右栏是「每会话一个停靠面」的制表签系统；Git Panel 作为一页制表签注册：
 *   sidebarRightTabs.register({id, kind, title, guide}) → slots('sidebar.right.pane.tab') → PaneHost
 *   → GitPanelMain(native 门控渲染 .gp-pane-host)。钉住的接线点：
 *     1) store 布局白名单 = dock / native（浮窗 overlay 已下线），设置弹窗二选一；
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
 *        根层抽屉仅限 dock；
 *    11) keepMounted 后多个页签正文并存：data-gp-layout 由 apply 单写者维护、开关态只在
 *        最后一个面板卸载时复位；后台会话的正文暂停轮询且不写全局 wsRoot（否则自愈重扫
 *        会指向别的工作区）；
 *    12) chip 标题 = 图标 + 文本，且右侧必须留够 dockkit 渐隐带 + 关闭键的宽度：
 *        选中态标题行末 30px 会被 mask 掉，文字顶到行尾会少字母、chip 跟着变窄。
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
  // 浮窗（overlay）模式已下线：白名单、设置卡片、双语文案三处都不许复活。
  // 历史用户存过 gp-layout=overlay → prefStr 白名单校验回落默认 dock（无需迁移代码）。
  has(R('src/client/store.js'), "const LAYOUT_MODES = ['dock', 'native']", '布局白名单只剩 dock / native'),
  lacks(R('src/client/components/modals.js'), "opt('overlay'", '设置弹窗不再提供浮窗模式'),
  lacks(R('src/client/components/modals.js'), 'modeOverlay', '设置弹窗不再引用浮窗文案键'),
  lacks(R('src/client/i18n.js'), 'modeOverlay', '浮窗模式文案（中英）已删除'),
  has(R('src/client/components/GitPanelMain.js'), 'innerW >= 1200', '窄窗退化为覆盖不挤压的守卫保留（原浮窗几何形态）'),
  has(R('src/client/store.js'), "toggleHidden: prefBool('gp-toggle-hidden', false)", '开关隐藏偏好持久化'),
  has(R('src/client/components/modals.js'), "opt('native'", '设置弹窗第二选项 native'),
  has(R('src/client/components/modals.js'), 'gp-toggle-opt', '设置弹窗的「隐藏左下角开关」独立开关行'),
  has(R('src/client/components/modals.js'), "savePrefBool('gp-toggle-hidden'", '开关隐藏写入 localStorage'),
  has(R('src/client/i18n.js'), 'modeNative:', '中英文案 modeNative'),
  // 设置里的模式名是产品措辞（用户拍板的叫法），pin 住防止顺手改回去或中英漂移
  has(R('src/client/i18n.js'), "modeDock: '独立侧边栏'", '默认模式名 = 独立侧边栏'),
  has(R('src/client/i18n.js'), "modeNative: '内置侧边栏页签'", 'native 模式名 = 内置侧边栏页签'),
  has(R('src/client/i18n.js'), "modeDock: 'Standalone sidebar'", '英文模式名 = Standalone sidebar'),
  has(R('src/client/i18n.js'), "modeNative: 'Built-in sidebar tab'", '英文模式名 = Built-in sidebar tab'),
  has(R('src/client/i18n.js'), 'hideToggleTitle:', '中英文案 hideToggleTitle')
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
  // 「面板收着 + 入口按钮隐藏」的兜底必须写在提前 return 之前：主体里那条 rail 到那种
  // 状态根本执行不到（旧版本把兜底写在那里，条件 `s.toggleHidden && !effectiveOpen` 永远
  // 为假 —— dock 模式下开关隐藏、面板又收着时没有任何 UI 入口，只能改 localStorage）。
  has(R('src/client/components/GitPanelMain.js'), 'if (nativePane || !s.toggleHidden) return null', '收着态单独渲染竖条兜底（在提前 return 之前）'),
  has(R('src/client/components/GitPanelMain.js'), 'store.set((st) => ({ ...st, panelOpen: true, collapsed: false }))', '竖条点击同时开面板（startExpand 只翻折叠态）'),
  lacks(R('src/client/components/GitPanelMain.js'), '|| (s.toggleHidden && !effectiveOpen)', '主体里那条永远执行不到的 rail 兜底已删')
])

scenario('shell.overlay 槽位双渲染门控与 hook 暂存', [
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
  has(R('src/client/nativePane.js'), 'function quietHideNativeTab', '模式切换静默收（不动开关态，让 dock 接管）'),
  has(R('src/client/nativePane.js'), 'function canUseNativePane', '切换前能力检查（无右栏/无会话不切模式）'),
  has(R('src/client/index.js'), 'kind: NATIVE_KIND,', '类型先注册（kind+title）'),
  // chip 只写产品名；panelLabel（"Git Panel 面板"）仍留给浮层槽位 label。
  has(R('src/client/index.js'), "title: () => tr('nativeTabTitle')", '页签标题用 nativeTabTitle（即 Git Panel）'),
  lacks(R('src/client/index.js'), "title: () => tr('panelLabel')", '页签标题不再复用 panelLabel（避免 chip 显示「Git Panel 面板」）'),
  has(R('src/client/i18n.js'), "nativeTabTitle: 'Git Panel'", '中英双语 nativeTabTitle'),
  // 切走 tab 再切回不重挂：保活页签正文（扫描结果/草稿/diff 现场不丢）。
  has(R('src/client/index.js'), 'keepMounted: true', 'Git Panel 页签声明 keepMounted（切 tab 不重载）'),
  // 标题席位：覆盖打开时捕获的旧标题（历史布局里存的是「Git Panel 面板」）。
  has(R('src/client/index.js'), "name: 'sidebar.right.pane.tab.title', key: NATIVE_TAB_ID", '注册页签标题席位（chip 实时显示）'),
  has(R('src/client/index.js'), 'function GitPanelTabTitle', 'chip 标题提成模块级组件（身份稳定，重注入不重挂）'),
  has(R('src/client/index.js'), "icon('branch', 13)", 'chip 标题复用 branch 图标'),
  // 右侧留白不是装饰：dockkit 对选中/hover/focus 页签的标题行有 30px 渐隐带（关闭键
  // 是 right:4px、20px 的绝对定位层），文字顶到行尾会被 mask 吃掉（实测「Git Panel」少 l、
  // chip 也随之变窄）。取 32 = 30（渐隐带起点）+ 2（亚像素/高 DPI 余量），别再删掉。
  has(R('src/client/index.js'), "className: 'gp-tab-chip'", 'chip 标题容器（图标 + 文本）'),
  has(R('src/client/styles.js'), '.gp-tab-chip { display: inline-flex', 'chip 标题排版（图标与文字对齐）'),
  has(R('src/client/styles.js'), 'padding-right: 32px', 'chip 右侧留白对齐 dockkit 渐隐带（30px + 2px 余量）'),
  has(R('src/client/index.js'), "guide: [{ id: 'panel', order: 30, title: () => tr('gpGuideTitle'), description: () => tr('gpGuideDesc') }]", 'guide 声明让开始页（引导页）渲染入口卡片（点击按 kind 开页签）'),
  has(R('src/client/i18n.js'), 'gpGuideTitle:', '中英文案 gpGuideTitle'),
  has(R('src/client/index.js'), "slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_TAB_ID }, PaneHost)", '正文再经 slots 注册（与 Files/Terminal 同款两步）'),
  has(R('src/client/index.js'), 'registerNativeTab(regSessionId, tabId)', '页签正文挂载时按本页签会话补登记 id（开始页入口卡片路径）'),
  has(R('src/client/index.js'), 'const tabSessionId = props && props.sessionId ? String(props.sessionId) : null', '登记用会话作用域 props.sessionId（keepMounted 后台正文不串会话）'),
  has(R('src/client/index.js'), 'unregisterNativeTab(regSessionId, tabId)', '页签正文卸载时按值注销 id（关页签不留陈旧条目）'),
  has(R('src/client/index.js'), 'tab.actions.close()', '切走布局时用框架动作关页签（不依赖内存表）')
])

scenario('设置里切 native：立即搬进右栏', [
  has(R('src/client/components/modals.js'), "import { openNativeTab, quietHideNativeTab, canUseNativePane } from '../nativePane.js'", '设置弹窗复用原生页签动作（无循环依赖）'),
  has(R('src/client/components/modals.js'), 'if (mode === \'native\' && !canUseNativePane())', '无右栏服务/会话时拒绝切换并提示'),
  has(R('src/client/components/modals.js'), 'if (!openNativeTab()) {', '切 native 时立即开页签'),
  has(R('src/client/components/modals.js'), 'store.set((st) => ({ ...st, layout: prev }))', '开页签失败回滚布局'),
  has(R('src/client/components/modals.js'), 'quietHideNativeTab()', '切离 native 时收掉页签（交给 dock）'),
  // 右栏开始页的入口卡片按 kind 直接开页签、不经过设置弹窗：正文挂载时要把布局
  // 切到 native，否则页签里不会出图（dock 面板另有实例），点卡片等于什么都没发生。
  has(R('src/client/index.js'), 'const mountedRef = React.useRef(false)', '页签正文区分「首次挂载」与「布局被切走」'),
  has(R('src/client/index.js'), "savePrefStr('gp-layout', 'native')", '入口卡片挂载即切 native 并记忆')
])

scenario('GitPanelMain 形态门控与抽屉定位', [
  has(R('src/client/components/GitPanelMain.js'), 'const effectiveOpen = nativePane ? true : s.panelOpen', '渲染门控：native 下页签在屏即显示（不看 panelOpen——开始页入口卡片开页签不经 openNativeTab）'),
  has(R('src/client/components/GitPanelMain.js'), 'const pollOn = nativePane ? isForeground : s.panelOpen', '轮询门控：native 看前台、dock 看 panelOpen（开始页进入的页签不停摆）'),
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
  has(R('src/client/index.js'), 'sessionIdHint: tabSessionId', '页签正文把自己的会话传给面板（keepMounted 后台不跟错会话）'),
  has(R('src/client/components/GitPanelMain.js'), 'const sessionHint = sessionIdHint || s.currentSessionId', '面板优先使用页签会话解析工作区'),
  has(R('src/client/components/GitPanelMain.js'), 'nativePane ? null :', 'native 顶栏不渲染标题按钮（chip 已带图标与名字）'),
  has(R('src/client/components/GitPanelMain.js'), "className: 'gp-title gp-title-btn'", 'dock 顶栏标题仍是折叠开关'),
  has(R('src/client/components/GitPanelMain.js'), 'className: \'gp-pane-host\'', 'native 渲染进页签容器'),
  has(R('src/client/components/GitPanelMain.js'), 'className: \'gp-panel\'', '页签内保留 .gp-panel 层（基础样式载体 + native 覆写选择器目标）'),
  // native 下抽屉不再出现（详情一律走新页签），宽度源回归面板宽；实测宽代码已删
  has(R('src/client/components/GitPanelMain.js'), 'const drawerW = s.panelW', '抽屉宽度源回归面板宽（native 无抽屉）'),
  lacks(R('src/client/components/GitPanelMain.js'), 'paneWidthRef', '容器实测宽的残留代码已清干净'),
  // native 的关闭交给 chip 上的 X（框架负责），顶栏不再放重复的关闭键。
  lacks(R('src/client/components/GitPanelMain.js'), 'paneClose', 'native 顶栏不再放关闭键（用 chip 上的 X）')
])

scenario('native 不参与折叠挤压（顶栏 logo 不再留 44px 空白）', [
  // native 下面板是右栏页签，没有折叠竖条可点回来：历史版本点顶栏 logo 会走
  // startCollapse，railPush 把 44px（RAIL_W）写进宿主 frame，对话区右缘留下一条
  // 「侧边栏模式收起」同款空白且无法复原。三处守卫必须同时在：
  //   1) railMounted 整体排除 native（DockSync 不再写 padding-right）；
  //   2) native 顶栏不渲染折叠按钮（chip 承担标题，收页签走右上角 X）；
  //   3) 插件装载时一次性清掉历史残留的 gp-collapsed（不再每次进 native 都复位，那会
  //      吞掉用户的 dock 折叠偏好）。
  has(R('src/client/components/GitPanelMain.js'), "const railMounted = !nativePane && (s.collapsed || collDir === 'collapse')", 'railMounted 排除 native（折叠挤压不写入页签模式的 frame）'),
  lacks(R('src/client/components/GitPanelMain.js'), "const railMounted = s.collapsed || collDir === 'collapse'", '旧的无条件 railMounted 已移除'),
  has(R('src/client/components/GitPanelMain.js'), 'nativePane ? null :', 'native 顶栏不渲染折叠按钮'),
  // 残留清理改为 apply 期一次性归一：不再「每次进 native 都复位」，那会吞掉 dock 折叠偏好。
  has(R('src/client/index.js'), "savePrefBool('gp-collapsed', false)", 'apply 期一次性清理历史折叠残留'),
  has(R('src/client/index.js'), "store.get().layout === 'native' && store.get().collapsed", '只在 native 布局下清残留（不动 dock 的折叠偏好）'),
  lacks(R('src/client/components/GitPanelMain.js'), "savePrefBool('gp-collapsed'", '面板不再每次进 native 都重置折叠偏好')
])

scenario('keepMounted 多实例：全局痕迹不随单个面板卸载丢失', [
  // data-gp-layout 属于布局模式，不属于某个面板实例：由 apply 里的单一订阅写。
  has(R('src/client/index.js'), 'function syncGpLayoutAttr', '布局属性收敛为单写者'),
  has(R('src/client/index.js'), 'store.subscribe(syncGpLayoutAttr)', 'apply 订阅布局模式变化'),
  (() => {
    const src = R('src/client/index.js')
    const start = src.indexOf('function PaneHost')
    const end = src.indexOf('export default function', start)
    const block = start >= 0 && end > start ? src.slice(start, end) : ''
    return { ok: block.length > 0 && !block.includes('setGpLayoutAttr'), msg: 'PaneHost 不写 data-gp-layout（多实例下由 apply 单写者维护）' }
  })(),
  has(R('src/client/index.js'), 'nativePaneMounts', '原生面板实例计数'),
  has(R('src/client/index.js'), 'if (nativePaneMounts > 0) return', '只有最后一个实例卸载才复位开关态'),
  // keepMounted 保活的后台会话正文：不写全局 wsRoot、不继续轮询。
  has(R('src/client/components/GitPanelMain.js'), 'const isForeground = !sessionIdHint || sessionIdHint === s.currentSessionId', '前后台判定（按页签自己的会话）'),
  has(R('src/client/components/GitPanelMain.js'), 'if (!isForeground) return', '后台面板不写全局 wsRoot（自愈重扫不会指错工作区）'),
  has(R('src/client/components/GitPanelMain.js'), 'const pollOn = nativePane ? isForeground : s.panelOpen', '轮询按前台门控'),
  has(R('src/client/components/GitPanelMain.js'), '}, [pollOn, scan.repos])', '轮询 effect 依赖前台态（切会话即停/启）')
])

scenario('data-gp-layout 属性写 body（选择器是 body[...]）', [
  has(R('src/client/index.js'), 'function setGpLayoutAttr(on)', '属性读写收敛为一个函数'),
  has(R('src/client/index.js'), "body.setAttribute('data-gp-layout', 'native')", '写 body 而非 html（与样式段选择器一致）'),
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
  // 根层覆盖抽屉只在 dock 出现（native 一律走新页签）
  has(R('src/client/components/GitPanelMain.js'), '!nativePane && diffSel && diffRepo ? React.createElement(DiffDrawer', '根层抽屉仅限 dock')
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
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'gpGuideTitle:', 'bundle 内开始页入口文案'),
  lacks(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'modeOverlay', 'bundle 内浮窗文案已删除（源码/产物未漂移）')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 原生侧栏接线：${results.length} 组全部通过`
  : `✗ 原生侧栏接线：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)