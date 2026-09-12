/**
 * git-panel — Client 半体（模块化装配层）
 *
 * 浏览器端 UI，全部使用 React.createElement（不经过 JSX/TS 编译）。
 * 源码为 src/client/ 下多模块（import/export 保证跨模块引用），由 scripts/build.mjs
 * 经 esbuild 打包成单文件 ModuleLoader bundle（lib/client.js），对外形态与官方
 * dsh-client-ui-* 插件一致。
 *
 * 核心交互约定（详见 docs/usage.md 与各组件文件头）：
 *   - 全部图标为 codicon 填充字形 SVG；「暂存即选择」：生成/提交/提交并推送只处理已暂存文件；
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
 *   sidebar.footer.action  → git-panel-toggle（侧栏底部开关按钮）
 *   shell.overlay          → git-panel（右浮面板）、git-panel-toasts（通知）
 *   弹窗（含 fixed 定位的 modal）必须挂在 overlay 层的根 Fragment 外侧，否则堆叠上下文
 *   会限制遮罩范围（RepoCard / GitPanelMain 的 return 均是 Fragment 外层挂弹窗）。
 *
 * 依赖的 Client 服务（ctx.get 可选读取）：slots / timer / workspaces(openPath)；
 * exports.inject 硬依赖见 lib/client.js 模板（slots / connection / workspaces）。
 */
import React from 'react'
import { initClientServices } from './runtime.js'
import { initLocale, tr } from './i18n.js'
import { store, resetStore } from './store.js'
import { injectCss, PANEL_CSS } from './styles.js'
import { icon } from './icons.js'
import { applyDockGeometry } from './components/dock.js'
import { ToastLayer } from './components/ToastLayer.js'
import { GitPanelMain } from './components/GitPanelMain.js'

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

      const disposeCss = injectCss(PANEL_CSS)

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'git-panel-toasts', order: 50, label: () => tr('toastsLabel') },
        () => React.createElement(ToastLayer)
      ))

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'git-panel', order: 40, label: () => tr('panelLabel') },
        (props) => React.createElement(GitPanelMain, { useSessions: props && props.useSessions, useWorkspaces: props && props.useWorkspaces })
      ))

      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'git-panel-toggle', order: 0, label: () => 'Git Panel' },
        (props) => {
          const wide = props && props.wide
          return React.createElement('button', { className: 'gp-sidebar-toggle', title: tr('toggleTitle'), onClick: () => { const st0 = store.get(); store.set((st) => ({ ...st, panelOpen: !st0.panelOpen })) } },
            icon('branch', 16),
            wide ? React.createElement('span', null, 'Git Panel') : null)
        }
      ))

      console.log('[git-panel] Client 已就绪')

      // 插件卸载/热重载时移除文件态注入的 <style>（动态包形态由宿主 styles 服务管理）
      // 并清除停靠几何痕迹（body 属性/CSS 变量/兜底内联样式），防止页面残留挤压
      return () => {
        disposeCss()
        applyDockGeometry(false, 0, false)
      }
    }
  }
}
