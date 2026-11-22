/**
 * git-panel — Client 半体（模块化装配层）
 *
 * 浏览器端 UI，全部使用 React.createElement（不经过 JSX/TS 编译）。
 * 源码为 src/client/ 下多模块（import/export 保证跨模块引用），由 scripts/build.mjs
 * 经 esbuild 打包成单文件 ModuleLoader bundle（lib/client.js），对外形态与官方
 * dsh-client-ui-* 插件一致。
 *
 * 核心交互约定（详见 docs/usage.md 与各组件文件头）：
 *   - 全部图标为 codicon 填充字形 SVG；「暂存即选择」：提交/提交并推送只处理已暂存文件，
 *     生成在暂存区为空时回退到全部未暂存改动（未暂存 diff + 未跟踪新文件内容）；
 *   - 写操作（commit/pull/push/switch/stash/reset/clean）由用户点击直接执行（无审批门），
 *     仅 host 侧留审计记录；「提交成功、推送失败」改为弹窗收尾（PushFailModal）；
 *   - 视图偏好（分栏/全文/抽屉宽/面板宽/折叠态/布局模式）记忆在 localStorage，键名见读写点。
 *
 * 组件映射（原 TSX 设计 → 本实现）：
 *   GitPanel.tsx        → components/GitPanelMain.js（主面板 + 扫描 + 工作空间跟随 + 拖拽调宽）
 *   RepoCard.tsx        → components/RepoCard/index.js（仓库卡片 + 分支/更多菜单 + 变更分组）
 *   CommitArea.tsx      → components/RepoCard/CommitArea.js（提交输入 + 生成 + 提交/提交并推送）
 *   CommitRuleEditor.tsx→ components/RuleEditorModal.js
 *   GitGraph.tsx        → components/GitGraphView.js（历史图谱）
 *   DiffPreview.tsx     → components/DiffDrawer.js（diff 抽屉）
 *
 * Slot 注入：
 *   sidebar.footer.action → git-panel-toggle（侧栏底部开关按钮；native 模式下它
 *                           打开/收起原生侧栏页签而非浮层面板）
 *   shell.overlay          → git-panel（右浮面板）、git-panel-toasts（通知）
 *   sidebar.right.pane.tab / .tab.title → git-panel（Git Panel 原生侧栏页签，
 *                            仅布局模式 native 时承载面板，见下方「原生侧栏页签装配」）
 *   弹窗（含 fixed 定位的 modal）必须挂在 overlay 层的根 Fragment 外侧，否则堆叠上下文
 *   会限制遮罩范围（RepoCard / GitPanelMain 的 return 均是 Fragment 外层挂弹窗）。
 *
 * 依赖的 Client 服务（ctx.get 可选读取）：slots / timer / locale / workspaces(openPath) /
 * uiWorkspace（selection=当前会话，切换对话后面板跟随的信号源）；
 * exports.inject 硬依赖见 lib/client.js 模板（slots / connection / workspaces / uiWorkspace）。
 */
import React from 'react'
import { initClientServices, stashOverlayHooks } from './runtime.js'
import { initLocale, tr } from './i18n.js'
import { store, resetStore, savePrefStr, useStore } from './store.js'
import { injectCss, PANEL_CSS } from './styles.js'
import { icon } from './icons.js'
import { applyDockGeometry } from './components/dock.js'
import { ToastLayer } from './components/ToastLayer.js'
import { GitPanelMain } from './components/GitPanelMain.js'
import { DiffPaneHost } from './components/DiffPaneHost.js'
import { NATIVE_DIFF_KIND } from './nativeDiff.js'
import { NATIVE_KIND, NATIVE_TAB_ID, openNativeTab, hideNativeTab, quietHideNativeTab, registerNativeTab } from './nativePane.js'

// ===== 原生侧栏模式（layout === 'native'）装配 =====
// DSH 右栏是「每会话一个停靠面」的制表签系统（见 @deepseek-ai/dsh-client-ui-sidebar-right）：
// 文件树、终端等第三方页签都经 sidebar.right.pane.tab 槽位注册。本插件把 Git Panel
// 也做成一页制表签：类型先经 sidebarRightTabs.register 声明（kind + title + guide
// 引导入口，让开始页有入口卡片），正文再经 slots 注册；页签身份 contentId 固定，
// 因此重复「打开」只是聚焦既有页签（与 Files 的去重语义一致），不会冒出第二张卡片。
// 页签的开合动作与 id 登记下沉到 nativePane.js：布局设置弹窗（modals.js）选 native
// 时也要立即开页签，而 modals 不能反向 import 本文件（GitPanelMain → modals 已是
// 一条依赖边）。
const NATIVE_DIFF_TAB_ID = '@dsh-local/git-panel-diff'
// shell.overlay 的包装组件：**必须订阅 store**，不能在注册回调里用 store.get() 读一次。
// 1.4.0 的原始写法不订阅 layout：从设置里切到 native 时这里不重渲染、不让位，而
// GitPanelMain 自己已经翻成 paneHost 形态 —— 面板就以浮层身份继续钉在右侧
//（右栏没打开、没有页签、data-gp-layout 也没挂），用户看到的是「选了原生侧栏，
// 面板一点没动，还在侧面」。订阅后切换即卸载 overlay 实例，由原生页签接管。
function OverlayHost(props) {
  // 每次渲染都把 slot props 暂存进 runtime：native 页签正文没有这份 hook props，
  // GitPanelMain 经 takeOverlayHooks 回退（见 runtime.js）。
  stashOverlayHooks(props && props.useSessions, props && props.useWorkspaces)
  const s = useStore()
  if (s.layout === 'native') return null
  return React.createElement(GitPanelMain, { useSessions: props && props.useSessions, useWorkspaces: props && props.useWorkspaces })
}
// 页签正文：不传 hook props（GitPanelMain 内部回退到 runtime 暂存的 overlay 钩子），
// paneClose 让 header 关闭键走「先收页签、再清开关态」。html 上不加属性——样式段
// 选择器是 body[data-gp-layout]，写 body 才生效（documentElement 上写是死代码）。
function setGpLayoutAttr(on) {
  if (typeof document === 'undefined' || !document.body) return
  if (on) document.body.setAttribute('data-gp-layout', 'native')
  else document.body.removeAttribute('data-gp-layout')
}
function PaneHost(props) {
  const s = useStore()
  // 页签正文的标准注入（sidebar.right.pane.tab 的 hookContext 提供 useTabInfo）：
  // 拿到本页签的 id 与框架动作。开始页入口卡片开的页签不经过 openNativeTab，
  // id 靠这里补登记，开关的收起才有据可依；切走布局时也用框架动作关掉自己，
  // 不依赖内存登记表。
  const hk = typeof (props && props.useTabInfo) === 'function' ? props.useTabInfo() : null
  const tab = hk && hk.tab ? hk.tab : null
  const tabId = tab && tab.id ? tab.id : null
  const mountedRef = React.useRef(false)
  React.useEffect(() => { if (tabId) registerNativeTab(tabId) }, [tabId, s.currentSessionId])
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      // 挂载即代表用户从右栏入口打开了本面板页签（开始页的入口卡片，或上次留下的
      // 页签）。此时布局还停在 dock/overlay —— 卡片本就是 native 的入口，这里把
      // 布局切过来；否则页签里不该画任何东西（dock 面板另有实例），点了卡片就只剩
      // 一枚空白页签。只切 store + 偏好，不重复开页签（已经在开了）。
      if (s.layout !== 'native') {
        store.set((st) => (st.layout === 'native' ? st : { ...st, layout: 'native', panelOpen: true }))
        savePrefStr('gp-layout', 'native')
      }
      return
    }
    if (s.layout === 'native') return
    // 模式已切走：主动关掉这枚页签，否则右栏会留一页空白的 Git Panel。
    // 框架动作拿不到时退回内存登记表（quietHideNativeTab）。
    try {
      if (tab && tab.actions && typeof tab.actions.close === 'function') { tab.actions.close(); return }
    } catch (e) { /* 落到下面的登记表兜底 */ }
    quietHideNativeTab()
  }, [s.layout, tab])
  React.useEffect(() => {
    setGpLayoutAttr(s.layout === 'native')
    // native 下页签在屏即「打开」：从开始页入口卡片进入的页签不经 openNativeTab、
    // panelOpen 为假，这里补点亮开关按钮的指示态（纯展示用途，渲染门控在 GitPanelMain）。
    if (s.layout === 'native' && !s.panelOpen) store.set((st) => ({ ...st, panelOpen: true }))
  }, [s.layout])
  React.useEffect(() => () => {
    setGpLayoutAttr(false)
    // 页签被框架关闭（页签上的 X / 关闭快捷键）时不会经过 paneClose：开关态会停在
    // 「已打开」，下一次点左下角开关只会先「收」一下、要再点一次才重开。
    // 布局仍是 native 说明这是用户关页签，不是切模式（切走时要保留 panelOpen，
    // 让 dock/overlay 实例无缝接管），这里把开关态复位。
    if (store.get().layout === 'native' && store.get().panelOpen) {
      store.set((st) => ({ ...st, panelOpen: false }))
    }
  }, [])
  // 布局已切走：先不出图（等上面的关闭 effect 收页签），避免在页签里渲染一版
  // fixed 定位的 dock 面板。
  if (s.layout !== 'native') return null
  return React.createElement(GitPanelMain, { paneClose: hideNativeTab })
}

export default function () {
  return {
    apply(ctx) {
      const slots = ctx.get('slots')
      if (!slots) return

      // timer 服务降级：文件态（浏览器 bundle）直接用原生 setTimeout；
      // 动态包沙箱禁用 setTimeout，但动态形态下 timer 必由运行器提供。
      let timer = ctx.get('timer')
      if (!timer) {
        timer = { timeout: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) } }
      }
      // 运行时服务注入（callRpc / toast / GitPanelMain 经 runtime.js 读取）
      initClientServices(ctx, timer)
      // 语言初始同步 + setLocale 上报（旧单文件 apply 顶部的行为，见 i18n.js）
      initLocale(ctx.get('locale'))
      // 旧单文件里 store 是每次 apply 新建的；模块单例下等价打回初始态
      resetStore()

      // 跟随当前会话（DSH 0.1.7+）：shell 把主区当前会话放在 uiWorkspace 服务的
      // selection store 里（{ sessionId, subagentAddress? } 快照，每次切换对话即
      // set，并持久化为 dsh.sessions.current；无会话时为 {}）。新版 sessions store
      // 已无 current 字段，这里是唯一可靠的「当前会话」信号。镜像进本插件 store，
      // GitPanelMain 据此优先解析当前工作区（uiWorkspace 已加入 bundle 的 inject，
      // 保证 apply 时可读）。旧版 DSH 没有该服务，留空走旧字段/最近工作区兜底。
      let disposeSelection = null
      const uiWs = ctx.get('uiWorkspace')
      const sel = uiWs && uiWs.selection
      if (sel && typeof sel.getSnapshot === 'function' && typeof sel.subscribe === 'function') {
        const syncSelection = () => {
          const snap = sel.getSnapshot()
          const sid = snap && snap.sessionId ? snap.sessionId : null
          if (store.get().currentSessionId !== sid) store.set((st) => ({ ...st, currentSessionId: sid }))
        }
        syncSelection()
        disposeSelection = sel.subscribe(syncSelection)
      }

      const disposeCss = injectCss(PANEL_CSS)

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'git-panel-toasts', order: 50, label: () => tr('toastsLabel') },
        () => React.createElement(ToastLayer)
      ))

      // 面板实体（dock/overlay）由 OverlayHost 承载：它订阅 store，切到 native 时
      // 返回 null 立即让位（不订阅就会以浮层身份继续停在右侧，见 OverlayHost 注释）。
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'git-panel', order: 40, label: () => tr('panelLabel') },
        OverlayHost
      ))

      // ===== 原生侧栏页签装配（布局模式 native 时承载面板）=====
      // 制表签类型与正文分两步注册（同 Files/Terminal 插件的做法，见
      // @deepseek-ai/dsh-client-ui-sidebar-right 的扩展席位章节）；服务缺失
      // （旧版 DSH 无右栏）时整体跳过——native 选择会在开关处 toast 提示，无副作用。
      const nativeDisposers = []
      try {
        const tabs = ctx.get('sidebarRightTabs')
        const sr = ctx.get('sidebarRight')
        if (tabs && typeof tabs.register === 'function' && sr && typeof sr.openTab === 'function') {
          nativeDisposers.push(ctx.effect(() => {
            const d = tabs.register({
              id: NATIVE_TAB_ID,
              kind: NATIVE_KIND,
              title: () => tr('panelLabel'),
              // 开始页（引导页）入口框：声明 guide 后，右栏框架渲染默认卡片（标题 +
              // 描述，条目未给图标时用引导页自己的占位图形），点击即按 kind 打开本页签
              // （与 Files/Terminal 的引导卡片同一套语义）。order 排在官方 builtin
              // 之后（files 10 / terminal 20），保持相近的展示次序。
              guide: [{ id: 'panel', order: 30, title: () => tr('gpGuideTitle'), description: () => tr('gpGuideDesc') }]
            })
            return () => { try { d() } catch (e) { /* dispose 幂等 */ } }
          }, 'git-panel.native-type'))
          nativeDisposers.push(ctx.effect(() => slots.inject('sidebar.right.pane.tab',
            () => slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_TAB_ID }, PaneHost)), 'git-panel.native-body'))
          // 「变更详情」页签：类型 + 正文与面板页签同批注册（kind 不同、正文不同）。
          // 打开动作由 nativeDiff.js 的 openNativeDiffTab 触发（GitPanelMain 在 native
          // 模式点历史文件时调用），contentId 定死 → 重复点击只聚焦不新增。
          nativeDisposers.push(ctx.effect(() => {
            const d = tabs.register({ id: NATIVE_DIFF_TAB_ID, kind: NATIVE_DIFF_KIND, title: () => tr('gpDiffTitle') })
            return () => { try { d() } catch (e) { /* dispose 幂等 */ } }
          }, 'git-panel.native-diff-type'))
          nativeDisposers.push(ctx.effect(() => slots.inject('sidebar.right.pane.tab',
            () => slots.register({ name: 'sidebar.right.pane.tab', key: NATIVE_DIFF_TAB_ID }, DiffPaneHost)), 'git-panel.native-diff-body'))
        }
      } catch (e) { console.error('[git-panel] 原生侧栏注册失败: ' + (e && e.message ? e.message : String(e))) }

      // 侧栏底部开关：dock/overlay 切换 panelOpen；native 打开/收起原生页签
      // （再次点击收起页签、右栏随最后一个页签整列收起）。订阅 store 让点亮态实时可见。
      // 「设置 → 隐藏左下角开关」开启时本槽位整体返回 null；此时 dock/overlay 的重新
      // 打开路径由折叠竖条兜底（见 GitPanelMain），native 由右栏开始页卡片兜底。
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'git-panel-toggle', order: 0, label: () => 'Git Panel' },
        (props) => {
          // hook 必须在任何提前 return 之前调用：开关被隐藏时若先 return null 再跳过
          // useStore，hook 数量会随设置变化（React 报 "Rendered fewer hooks than
          // expected"），整个 footer 槽位崩溃。先订阅，再决定是否出图。
          const s = useStore()
          if (s.toggleHidden) return null
          const wide = props && props.wide
          const nativeOn = s.layout === 'native' && s.panelOpen
          return React.createElement('button', { className: 'gp-sidebar-toggle' + (nativeOn ? ' gp-native-on' : ''), title: tr('toggleTitle'), onClick: () => {
            if (s.layout === 'native') {
              if (s.panelOpen) hideNativeTab()
              else openNativeTab()
              return
            }
            const st0 = store.get()
            store.set((st) => ({ ...st, panelOpen: !st0.panelOpen }))
          } },
            icon('branch', 16),
            wide ? React.createElement('span', null, 'Git Panel') : null)
        }
      ))

      console.log('[git-panel] Client 已就绪')

      // 插件卸载/热重载时移除文件态注入的 <style>（动态包形态由宿主 styles 服务管理）
      // 并清除停靠几何痕迹（body 属性/CSS 变量/兜底内联样式），防止页面残留挤压；
      // native 页签类型与正文随 ctx.effect 的 disposer 一并注销，data-gp-layout 属性
      // 由 PaneHost 的卸载 effect 清除。
      return () => {
        if (disposeSelection) disposeSelection()
        disposeCss()
        applyDockGeometry(false, 0, false)
        for (const d of nativeDisposers) { try { d() } catch (e) { /* 幂等 */ } }
        setGpLayoutAttr(false)
      }
    }
  }
}
