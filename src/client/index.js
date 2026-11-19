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
import { initClientServices, getClientCtx, stashOverlayHooks } from './runtime.js'
import { initLocale, tr } from './i18n.js'
import { store, resetStore, pushToast, useStore } from './store.js'
import { injectCss, PANEL_CSS } from './styles.js'
import { icon } from './icons.js'
import { applyDockGeometry } from './components/dock.js'
import { ToastLayer } from './components/ToastLayer.js'
import { GitPanelMain } from './components/GitPanelMain.js'

// ===== 原生侧栏模式（layout === 'native'）装配 =====
// DSH 右栏是「每会话一个停靠面」的制表签系统（见 @deepseek-ai/dsh-client-ui-sidebar-right）：
// 文件树、终端等第三方页签都经 sidebar.right.pane.tab 槽位注册。本插件把 Git Panel
// 也做成一页制表签：类型先经 sidebarRightTabs.register 声明（kind + title + guide
// 引导入口，让开始页有入口卡片），正文再经 slots 注册；页签身份 contentId 固定，
// 因此重复「打开」只是聚焦既有页签（与 Files 的去重语义一致），不会冒出第二张卡片。
// apply 返回两个 disposer 随插件卸载。
const NATIVE_KIND = 'git-panel'
const NATIVE_TAB_ID = '@dsh-local/git-panel'
// sessionId → 已开页签 id 的登记表：收起（hide）与避免重复聚焦都要它。
const nativeTabsBySession = new Map()
function sidebarRightOf() { return getClientCtx() ? getClientCtx().get('sidebarRight') : null }
// 打开（或聚焦既有）本面板的原生页签；无屏幕会话/服务缺失时 toast 提示，绝不静默失效。
function openNativeTab() {
  const sid = store.get().currentSessionId
  if (!sid) { pushToast('error', tr('gpNativeFailed')); return }
  const sr = sidebarRightOf()
  if (!sr || typeof sr.openTab !== 'function') { pushToast('error', tr('gpNativeFailed')); return }
  try {
    sr.openTab(NATIVE_KIND, { params: { contentId: NATIVE_TAB_ID } })
    const t = typeof sr.active === 'function' ? sr.active() : null
    if (t && t.id) nativeTabsBySession.set(sid, t.id)
    store.set((st) => ({ ...st, panelOpen: true }))
  } catch (e) { pushToast('error', tr('gpNativeFailed')) }
}
// 收起页签（两种收尾）：
//   hideNativeTab     —— 用户主动收（开关再点 / header 关闭键）：连 panelOpen 一起复位；
//   quietHideNativeTab —— 模式切换等非用户路径的静默收，只关页签不动开关态，
//                       让 dock/overlay 实例按当前 panelOpen 无缝接管。
function quietHideNativeTab() {
  const sid = store.get().currentSessionId
  const tid = sid ? nativeTabsBySession.get(sid) : undefined
  const sr = sidebarRightOf()
  try { if (tid && sr && typeof sr.hide === 'function') sr.hide(tid) } catch (e) { /* 忽略 */ }
  if (sid) nativeTabsBySession.delete(sid)
}
function hideNativeTab() {
  quietHideNativeTab()
  store.set((st) => ({ ...st, panelOpen: false }))
}
// 页签正文：不传 hook props（GitPanelMain 内部回退到 runtime 暂存的 overlay 钩子），
// paneClose 让 header 关闭键走「先收页签、再清开关态」。body[data-gp-layout] 属性由本组件
// 依据布局模式维护——styles.js 的 native 段据此覆写面板与抽屉的定位形态。
function PaneHost() {
  const s = useStore()
  // 模式不再处于 native：页签空壳没有意义，静默收页签让位给 overlay/dock 实例
  // （开关态保持，由后者的渲染门控决定是否显示，避免切模式时面板闪断）。
  React.useEffect(() => { if (s.layout !== 'native') quietHideNativeTab() }, [s.layout])
  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return
    const el = document.documentElement
    if (s.layout === 'native') el.setAttribute('data-gp-layout', 'native')
    else el.removeAttribute('data-gp-layout')
  }, [s.layout])
  React.useEffect(() => () => {
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.removeAttribute('data-gp-layout')
  }, [])
  return React.createElement(GitPanelMain, { paneClose: () => { hideNativeTab(); store.set((st) => ({ ...st, panelOpen: false })) } })
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

      // shell.overlay 的槽位 props（useSessions / useWorkspaces）必须原样暂存到
      // runtime.js：原生侧栏模式的页签正文没有这份 props，而工作区解析需要同一批
      // 快照订阅器。注册回调每次渲染都先 stash，再按布局模式决定是否出图——
      // native 模式下面板由侧栏页签承载，overlay 实例返回 null，绝不双渲染。
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'git-panel', order: 40, label: () => tr('panelLabel') },
        (props) => {
          stashOverlayHooks(props && props.useSessions, props && props.useWorkspaces)
          if (store.get().layout === 'native') return null
          return React.createElement(GitPanelMain, { useSessions: props && props.useSessions, useWorkspaces: props && props.useWorkspaces })
        }
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
        }
      } catch (e) { console.error('[git-panel] 原生侧栏注册失败: ' + (e && e.message ? e.message : String(e))) }

      // 侧栏底部开关：dock/overlay 切换 panelOpen；native 打开/收起原生页签
      // （再次点击收起页签、右栏随最后一个页签整列收起）。订阅 store 让点亮态实时可见。
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'git-panel-toggle', order: 0, label: () => 'Git Panel' },
        (props) => {
          const wide = props && props.wide
          const s = useStore()
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
        if (typeof document !== 'undefined' && document.documentElement) document.documentElement.removeAttribute('data-gp-layout')
      }
    }
  }
}
