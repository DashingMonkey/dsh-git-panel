/**
 * git-panel — Client 半体
 *
 * 浏览器端 UI，全部使用 React.createElement（动态包不经过 JSX/TS 编译）。
 * 整体视觉对齐 VS Code Source Control：
 *   - 全部图标为 16×16 扁平 SVG 图标（stroke/fill + currentColor，类 codicon），无 emoji；
 *   - 「暂存即选择」：无 checkbox，文件行/分组行右侧悬停出现 ＋（暂存）/－（取消暂存），
 *     生成 / 提交 / 提交并推送只处理已暂存（Staged）的文件；
 *   - 变更分组（暂存的更改 / 更改 / 未跟踪的更改）最左侧带展开/收起 chevron，
 *     最右侧「放弃全部 / 放弃单个」+「暂存/取消暂存」按钮，按钮右侧显示组内数量；
 *     放弃更改（Discard，VS Code codicon 官方「U 形回旋曲箭头」填充图标，与刷新圆箭头明显区分）
 *     为不可逆操作，直接执行（仅留审计）；行内操作按钮（放弃/暂存/取消暂存）悬停时
 *     图标不变色，周围垫一块更深的方形底色（VS Code 工具栏 hover 风格）；
 *   - 提交区位于仓库卡片顶部（message 输入框在上，变更列表在下）；
 *   - 历史区加大：行高 26 / 字号 13 / 高度 470，节点更大更清晰；
 *     图谱按 lane 循环配色、合并线为圆角肘形曲线，提交详情改为行悬停浮层（VS Code hover 风格）；
 *   - 面板左缘可拖拽调整整体宽度，宽度记忆在 localStorage。
 *
 * 组件映射（原 TSX 设计 → 本实现）：
 *   GitPanel.tsx        → GitPanelMain（主面板 + 扫描 + 工作空间跟随 + 拖拽调宽）
 *   RepoCard.tsx        → RepoCard（仓库卡片 + 分支/更多菜单 + 变更分组 + 暂存操作）
 *   CommitArea.tsx      → CommitArea（提交输入 + 生成 + 规则 + 提交/提交并推送，仅处理 staged）
 *   CommitRuleEditor.tsx→ RuleEditorModal（system_prompt / user_context 双编辑框（键名固定防误删）+ 实时预览 + 仓库专属开关）
 *   GitGraph.tsx        → GitGraphView（SVG 图谱：lane 配色/圆角合并线 + 悬停详情浮层）
 *   DiffPreview.tsx     → DiffPane（右侧只读 diff 预览）
 *
 * Slot 注入：
 *   sidebar.footer.action  → git-panel-toggle（侧栏底部开关按钮）
 *   shell.overlay          → git-panel（右浮面板）、git-panel-toasts（通知）
 *
 * 交互约定：
 *   - 下拉菜单（分支/更多/规则）带全局透明遮罩，点击任何外部区域自动关闭；
 *   - 文件行只显示文件名，悬停 title 显示完整路径；
 *   - 写操作（commit/pull/push/switch/stash/reset/clean）直接执行（无审批/确认，类似 VS Code）。
 *
 * 依赖的 Client 服务（ctx.get 可选读取）：slots / timer / workspaces(openPath/pickDirectory)
 */
export default function () {
  return {
    apply(ctx) {
      const slots = ctx.get('slots')
      const workspaces = ctx.get('workspaces')
      if (!slots) return

      // timer 服务降级：文件态（浏览器 bundle）直接用原生 setTimeout；
      // 动态包沙箱禁用 setTimeout，但动态形态下 timer 必由运行器提供。
      let timer = ctx.get('timer')
      if (!timer) {
        timer = { timeout: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) } }
      }

      // 双形态 RPC：
      //   - 动态 Cordis 包：host.call(method, args)（运行器注入的内置件）
      //   - 文件态：ctx.connection.rpc.call('/git-panel', method, args)
      //     （@deepseek-ai/dsh-client-connection 的通用 RPC 通道，与 host 半体
      //       connection.rpc.handle('/git-panel', ...) 配对）
      // 协议信封为 {ok:true, value} / {ok:false, error:{code,message,details}}；
      // 这里统一摊平为 {ok:true, ...value} / {ok:false, error:<string>}，
      // 下游组件保持读业务字段的旧约定，无需逐处适配。
      const unwrapRpc = (p) => p.then((res) => {
        if (res && res.ok === true) {
          if (res.value !== null && typeof res.value === 'object') return Object.assign({ ok: true }, res.value)
          return { ok: true, value: res.value }
        }
        if (res && res.ok === false && res.error && typeof res.error === 'object') {
          return { ok: false, error: res.error.message || res.error.code || 'error' }
        }
        return res
      })
      const callRpc = (method, args) => {
        if (typeof host !== 'undefined' && host && typeof host.call === 'function') return unwrapRpc(host.call(method, args))
        const conn = ctx.get('connection')
        if (conn && conn.rpc && typeof conn.rpc.call === 'function') return unwrapRpc(conn.rpc.call('/git-panel', method, args))
        return Promise.reject(new Error('git-panel: no RPC channel available'))
      }

      // 样式注入双形态：动态包用 styles.insert；文件态用 <style> 标签（data-plugin-css 去重）
      const injectCss = (css) => {
        if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') return styles.insert(css)
        if (typeof document === 'undefined') return () => {}
        if (document.querySelector('style[data-plugin-css="git-panel"]')) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'git-panel'
        tag.dataset.pluginCss = 'git-panel'
        tag.textContent = css
        document.head.appendChild(tag)
        return () => { if (tag.parentNode) tag.parentNode.removeChild(tag) }
      }

      injectCss(`
.gp-panel, .gp-panel * { box-sizing: border-box; }
.gp-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 520px; max-width: 96vw; background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; pointer-events: auto; z-index: 60; font-size: 14px; color: var(--dsw-alias-label-primary); box-shadow: -12px 0 32px rgba(0,0,0,.18); font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.gp-resize { position: absolute; top: 0; left: -2px; bottom: 0; width: 5px; cursor: ew-resize; z-index: 80; }
.gp-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; transform: translateX(-50%); background: var(--dsw-alias-brand-primary); opacity: 0; transition: opacity .15s; }
.gp-resize:hover::after { opacity: .35; }
.gp-resize-active::after, .gp-resize-active:hover::after { opacity: .6; }
.gp-header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-sidebar-fill); flex: 0 0 auto; }
.gp-title { font-weight: 600; font-size: 14px; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; overflow: hidden; }
.gp-root { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; direction: rtl; text-align: left; }
.gp-header-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.gp-chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.gp-follow-chip { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); max-width: 42%; }
.gp-main { flex: 1; min-height: 0; display: flex; }
.gp-body { flex: 1; min-width: 0; overflow-y: auto; padding: 6px 8px; }
.gp-empty { padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.gp-scanning { padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; }
.gp-btn { background: transparent; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 11px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.gp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.gp-btn:disabled { opacity: .45; cursor: not-allowed; }
.gp-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #ffffff; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
.gp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.1); }
.gp-btn-sm { padding: 3px 9px; font-size: 12px; }
body[data-ds-dark-theme] .gp-btn-primary { color: #16181d; text-shadow: none; }
.gp-btn-icon { padding: 3px 5px; border: none; background: transparent; border-radius: 5px; cursor: pointer; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 24px; min-height: 22px; font-size: 13px; }
.gp-btn-icon:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-btn-icon:disabled { opacity: .4; cursor: not-allowed; }
.gp-icon-btn { border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 3px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
/* 类 VS Code 工具栏 hover：图标不变色，周围垫一块更深的方形底色把图标扩住 */
.gp-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.gp-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.gp-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: gp-spin .8s linear infinite; }
@keyframes gp-spin { to { transform: rotate(360deg); } }
.gp-repo-card { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; margin-bottom: 8px; }
.gp-repo-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; }
.gp-repo-name { font-weight: 600; color: var(--dsw-alias-brand-primary); font-size: 14px; cursor: default; }
.gp-branch { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-count { font-size: 12px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.gp-count-staged { color: var(--dsw-alias-state-success-primary); }
.gp-count-unstaged { color: var(--dsw-alias-state-warn-primary); }
.gp-count-untracked { color: var(--dsw-alias-brand-primary); }
.gp-spacer { flex: 1; }
.gp-menu-wrap { position: relative; }
.gp-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.25); z-index: 120; min-width: 250px; padding: 4px; }
.gp-menu-backdrop { position: fixed; inset: 0; z-index: 110; background: transparent; }
.gp-menu-item { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; background: none; border: none; color: var(--dsw-alias-label-primary); padding: 7px 10px; border-radius: 5px; font-size: 13px; cursor: pointer; }
.gp-menu-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.gp-menu-item:disabled { opacity: .5; cursor: default; }
.gp-menu-sep { height: 1px; background: var(--dsw-alias-border-l1); margin: 4px 6px; }
.gp-menu-note { padding: 6px 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.gp-menu-input { margin: 4px 6px; padding: 5px 8px; font-size: 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); width: calc(100% - 12px); }
.gp-section { padding: 2px 2px 4px; }
.gp-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #000000; padding: 6px 4px 3px; display: flex; gap: 6px; align-items: center; cursor: pointer; user-select: none; border-radius: 4px; position: relative; transition: background-color .1s ease, box-shadow .12s ease; }
body[data-ds-dark-theme] .gp-section-title { color: #ffffff; }
/* 悬停浮起（类 VS Code 树列表 hover）：背景高亮 + 细描边 + 柔和投影 */
.gp-section-title:hover { background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 3px rgba(0,0,0,.10), 0 3px 10px rgba(0,0,0,.07), inset 0 0 0 1px var(--dsw-alias-border-l2); }
body[data-ds-dark-theme] .gp-section-title:hover { box-shadow: 0 1px 4px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.35), inset 0 0 0 1px var(--dsw-alias-border-l2); }
.gp-section-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-chev { border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 0; width: 16px; height: 16px; border-radius: 3px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.gp-chev:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-group-count { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: 0 0 auto; min-width: 14px; text-align: center; }
/* 组标题行操作按钮用 visibility 占位（收起/展开按钮、放弃、暂存/取消暂存、计数都不跳动） */
.gp-section-title .gp-row-actions { visibility: hidden; }
.gp-section-title:hover .gp-row-actions { visibility: visible; }
.gp-file-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 14px; border-radius: 4px; cursor: pointer; min-height: 22px; position: relative; transition: background-color .1s ease, box-shadow .12s ease; }
/* 悬停浮起（类 VS Code 树列表 hover）：背景高亮 + 细描边 + 柔和投影 */
.gp-file-row:hover { background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 3px rgba(0,0,0,.10), 0 3px 10px rgba(0,0,0,.07), inset 0 0 0 1px var(--dsw-alias-border-l2); }
body[data-ds-dark-theme] .gp-file-row:hover { box-shadow: 0 1px 4px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.35), inset 0 0 0 1px var(--dsw-alias-border-l2); }
.gp-file-dot { flex: 0 0 auto; width: 10px; text-align: center; font-size: 13px; line-height: 1; color: var(--dsw-alias-label-secondary); opacity: .9; }
.gp-file-dot.gp-g-added { color: var(--dsw-alias-state-success-primary); opacity: 1; }
.gp-file-dot.gp-g-modified { color: var(--dsw-alias-state-warn-primary); opacity: 1; }
.gp-file-dot.gp-g-deleted { color: var(--dsw-alias-state-error-primary); opacity: 1; }
.gp-row-actions { display: flex; gap: 2px; opacity: 0; flex: 0 0 auto; }
.gp-file-row:hover .gp-row-actions, .gp-section-title:hover .gp-row-actions, .gp-repo-head:hover .gp-row-actions { opacity: 1; }
.gp-file-badge { font-size: 11px; font-weight: 700; width: 14px; text-align: center; flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.gp-file-badge.gp-g-added { color: var(--dsw-alias-state-success-primary); }
.gp-file-badge.gp-g-modified { color: var(--dsw-alias-state-warn-primary); }
.gp-file-badge.gp-g-deleted { color: var(--dsw-alias-state-error-primary); }
.gp-file-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; color: #333333; }
body[data-ds-dark-theme] .gp-file-name { color: #e6e6e6; }
.gp-file-dir { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; }
.gp-file-orig { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-commit-area { padding: 9px 10px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.gp-textarea { width: 100%; resize: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding: 7px 9px; font-size: 13px; line-height: 1.5; font-family: inherit; min-height: 58px; max-height: 138px; }
.gp-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gp-commit-row { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; gap: 8px; }
.gp-left-group { display: flex; gap: 6px; align-items: center; }
.gp-commit-actions { display: flex; gap: 6px; margin-top: 8px; }
.gp-commit-actions .gp-btn { flex: 1; padding: 6px 12px; font-weight: 600; }
.gp-staged-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-history-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; color: var(--dsw-alias-label-secondary); }
.gp-history-head:hover { color: var(--dsw-alias-label-primary); }
.gp-history-body { display: flex; padding: 6px 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1); height: 470px; }
.gp-graph-wrap { flex: 1 1 auto; min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.gp-graph-scroll { position: relative; height: 100%; overflow-y: auto; overflow-x: hidden; }
.gp-grow { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; padding: 0 6px; cursor: pointer; border-left: 2px solid transparent; box-sizing: border-box; overflow: hidden; }
.gp-grow:hover { background: var(--dsw-alias-bg-layer-2); }
.gp-grow-sel { background: var(--dsw-alias-bg-layer-2); border-left-color: var(--dsw-alias-brand-primary); }
.gp-grow-subject { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.gp-grow-refs { display: inline-flex; gap: 3px; flex: 0 0 auto; max-width: 32%; overflow: hidden; }
.gp-grow-ref { font-size: 10.5px; line-height: 1.5; padding: 0 5px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-grow-ref-cur { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.gp-grow-ref-tag { color: #d7a648; border-color: rgba(215, 166, 72, .5); }
.gp-grow-meta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; flex: 0 0 auto; }
.gp-grow-more { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gp-cd-pop { position: fixed; z-index: 320; width: 400px; max-width: 86vw; max-height: 320px; overflow-y: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.35); padding: 4px 12px 10px; font-size: 13px; color: var(--dsw-alias-label-primary); pointer-events: auto; }
.gp-cd-subject { font-weight: 600; padding: 6px 0; }
.gp-cd-hash { margin-left: 8px; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 11.5px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.gp-cd-refs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
.gp-cd-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); margin-bottom: 6px; }
.gp-cd-message { white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.gp-cd-stat { white-space: pre-wrap; font-family: monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.gp-diff-pane { flex: 0 0 46%; min-width: 300px; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.gp-diff-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-family: monospace; font-size: 13px; flex: 0 0 auto; }
.gp-diff-body { flex: 1; overflow: auto; padding: 8px 10px; }
.gp-diff-pre { margin: 0; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.gp-diff-add { color: var(--dsw-alias-state-success-primary); }
.gp-diff-del { color: var(--dsw-alias-state-error-primary); }
.gp-diff-hunk { color: var(--dsw-alias-brand-primary); }
.gp-diff-hdr { color: var(--dsw-alias-label-secondary); font-weight: 600; }
.gp-diff-plain { color: var(--dsw-alias-label-secondary); }
.gp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 400; pointer-events: auto; }
.gp-modal { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; width: 960px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.gp-modal-sm { width: 440px; }
.gp-genmodel-scroll { max-height: 42vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 2px; }
.gp-genmodel-group { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.gp-genmodel-group-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em; padding: 4px 8px 2px; }
.gp-genmodel-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 7px; background: none; border: none; color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; }
.gp-genmodel-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-genmodel-item.gp-genmodel-selected { background: var(--dsw-alias-brand-primary); color: #ffffff; }
.gp-genmodel-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.gp-genmodel-item.gp-genmodel-selected .gp-genmodel-meta { color: rgba(255,255,255,.78); }
.gp-genmodel-effort { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); flex-wrap: wrap; }
.gp-genmodel-effort-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-right: 4px; }
.gp-modal-head { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-weight: 600; font-size: 14px; }
.gp-modal-body { flex: 1; overflow: auto; padding: 12px 14px; }
.gp-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gp-rule-cols { display: flex; gap: 12px; height: 500px; }
.gp-rule-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gp-rule-col-title { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; letter-spacing: .3px; }
/* 规则编辑器：system_prompt / user_context 两个独立编辑框，键名固定展示、不可编辑，
   从根上避免误删 YAML 键；普通单层 textarea，无叠加层对齐问题；两框等宽等高（各占一半）。 */
.gp-rule-fields { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.gp-rule-field { flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; }
.gp-rule-field-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); letter-spacing: .3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-rule-field-key { font-family: 'Cascadia Mono', Consolas, monospace; color: var(--dsw-alias-label-primary); }
.gp-rule-field-label { font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.gp-rule-input { flex: 1; min-height: 0; width: 100%; resize: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); padding: 8px 10px; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; line-height: 1.5; white-space: pre; overflow: auto; tab-size: 2; }
.gp-rule-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gp-rule-preview { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 10px; background: var(--dsw-alias-bg-layer-2); font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
.gp-rule-preview-title { font-weight: 700; color: var(--dsw-alias-brand-primary); margin: 8px 0 4px; }
.gp-rule-preview-title:first-child { margin-top: 0; }
.gp-toast-stack { position: fixed; right: 14px; bottom: 14px; z-index: 500; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.gp-toast { pointer-events: auto; padding: 10px 14px; border-radius: 7px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-left: 3px solid var(--dsw-alias-brand-primary); box-shadow: 0 8px 24px rgba(0,0,0,.3); font-size: 13.5px; max-width: 420px; word-break: break-word; color: var(--dsw-alias-label-primary); animation: gp-toast-in .18s ease-out; }
.gp-toast.gp-toast-exit { animation: gp-toast-out .24s ease-in forwards; }
@keyframes gp-toast-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
@keyframes gp-toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(28px); } }
.gp-toast-success { border-left-color: var(--dsw-alias-state-success-primary); }
.gp-toast-error { border-left-color: var(--dsw-alias-state-error-primary); }
.gp-toggle-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.gp-danger { color: var(--dsw-alias-state-error-primary); font-weight: 600; }
.gp-confirm-summary { margin: 6px 0 10px; font-size: 13.5px; display: flex; align-items: flex-start; gap: 6px; }
.gp-confirm-input { width: 100%; padding: 8px 9px; font-size: 13.5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-sidebar-toggle { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; padding: 5px 8px; border-radius: 6px; }
.gp-sidebar-toggle:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
`)

      // ============ 扁平 SVG 图标（16×16，stroke/fill + currentColor，类 VS Code codicon） ============
      // p: 线性 path（stroke）；f: 填充 path（fill: currentColor，用于官方 codicon 填充字形）；c: [cx, cy, r, filled?] 圆形元素
      const ICONS = {
        plus: { p: ['M8 3.5v9', 'M3.5 8h9'] },
        minus: { p: ['M3.5 8h9'] },
        chevronRight: { p: ['M6 3.5L10.5 8 6 12.5'] },
        chevronDown: { p: ['M3.5 6L8 10.5 12.5 6'] },
        close: { p: ['M4.2 4.2l7.6 7.6', 'M11.8 4.2l-7.6 7.6'] },
        back: { p: ['M10 3.2L5.2 8 10 12.8'] },
        check: { p: ['M2.8 8.7l3.4 3.4L13.2 4.8'] },
        // VS Code codicon「refresh」官方路径（填充字形，环形箭头）
        // 来源：https://github.com/microsoft/vscode-codicons/blob/main/src/icons/refresh.svg
        refresh: { f: ['M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z'] },
        folder: { p: ['M2.2 4.4A1.6 1.6 0 0 1 3.8 2.8h2.4l1.3 1.8h4.7a1.6 1.6 0 0 1 1.6 1.6v5a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6z'] },
        ellipsis: { c: [[3.2, 8, 1.35, 1], [8, 8, 1.35, 1], [12.8, 8, 1.35, 1]] },
        dot: { c: [[8, 8, 4, 1]] },
        branch: { p: ['M5 5.5v5', 'M11 7.5c0 2-1.6 2.7-3.8 2.9'], c: [[5, 3.8, 1.7], [5, 12.2, 1.7], [11, 5.8, 1.7]] },
        gear: { p: ['M8 1.7v1.9', 'M8 12.4v1.9', 'M1.7 8h1.9', 'M12.4 8h1.9', 'M3.5 3.5l1.3 1.3', 'M11.2 11.2l1.3 1.3', 'M12.5 3.5l-1.3 1.3', 'M4.8 11.2l-1.3 1.3'], c: [[8, 8, 2.1]] },
        sparkles: { p: ['M7.8 2l1.3 3.9 3.9 1.3-3.9 1.3L7.8 12.4 6.5 8.5 2.6 7.2l3.9-1.3z', 'M12.7 11.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z'] },
        arrowUp: { p: ['M8 13.2V2.8', 'M3.6 6.8L8 2.4l4.4 4.4'] },
        arrowDown: { p: ['M8 2.8v10.4', 'M3.6 9.2L8 13.6l4.4-4.4'] },
        pull: { p: ['M8 2v7.4', 'M4.8 6.6L8 9.8l3.2-3.2', 'M2.6 13.4h10.8'] },
        history: { p: ['M8 4.6V8l2.4 1.5'], c: [[8, 8, 6.2]] },
        shield: { p: ['M8 1.6l5 2.2v4.1c0 3.3-2.1 5.3-5 6.3-2.9-1-5-3-5-6.3V3.8z'] },
        warning: { p: ['M8 2.2l6.3 10.8H1.7z', 'M8 6.6v3.2'], c: [[8, 12.1, 0.95, 1]] },
        // VS Code codicon「discard」官方路径（填充字形：U 形回旋曲箭头，与 refresh 圆箭头明显区分）
        // 来源：https://github.com/microsoft/vscode-codicons/blob/main/src/icons/discard.svg
        discard: { f: ['M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z'] }
      }
      function Icon(props) {
        const spec = ICONS[props.name] || { p: [] }
        const size = props.size || 14
        const children = []
        ;(spec.p || []).forEach((d, i) => children.push(React.createElement('path', {
          key: 'p' + i, d, fill: 'none', stroke: 'currentColor',
          strokeWidth: props.sw || 1.5, strokeLinecap: 'round', strokeLinejoin: 'round'
        })))
        ;(spec.f || []).forEach((d, i) => children.push(React.createElement('path', {
          key: 'f' + i, d, fill: 'currentColor', stroke: 'none'
        })))
        ;(spec.c || []).forEach((c, i) => children.push(React.createElement('circle', {
          key: 'c' + i, cx: c[0], cy: c[1], r: c[2],
          fill: c[3] ? 'currentColor' : 'none', stroke: c[3] ? 'none' : 'currentColor', strokeWidth: 1.4
        })))
        return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: '0 0 auto' } }, children)
      }
      const icon = (name, size, sw) => React.createElement(Icon, { name, size, sw })

      function loadPanelW() {
        try {
          const v = parseInt(window.localStorage.getItem('gp-panel-w'), 10)
          if (v >= 380 && v <= 2400) return v
        } catch (e) { /* ignore */ }
        return 520
      }
      function savePanelW(w) {
        try { window.localStorage.setItem('gp-panel-w', String(w)) } catch (e) { /* ignore */ }
      }

      function createStore(initial) {
        let state = initial
        const listeners = new Set()
        return {
          get: () => state,
          set: (updater) => { state = updater(state); listeners.forEach((l) => l()) },
          subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) }
        }
      }
      const store = createStore({ panelOpen: false, toasts: [], refreshTick: 0, lastOp: null, lastOpRepoId: null, panelW: loadPanelW() })

      // ============ 国际化：跟随 DSH 语言设置（locale.preference）自动切换 中文 / English ============
      const localeSvc = ctx.get('locale')
      let lang = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale().active : 'zh'
      if (lang !== 'en') lang = 'zh'
      const TEXTS = {
        zh: {
          groupStaged: '暂存的更改', groupChanges: '更改', groupUntracked: '未跟踪的更改', history: '历史',
          rulesLoadFailed: '读取规则失败', reading: '(读取中…)', saved: '已保存', saveFailed: '保存失败', saveFailedWith: '保存失败: {e}',
          validationNoSys: '校验失败: 缺少 system_prompt', validationNoUser: '校验失败: 缺少 user_context',
          restoredDefaults: '已恢复为内置默认内容（未保存）', repoOnlyLabel: '仓库专属规则（覆盖全局默认，保存到 {name}.yaml）',
          rulesContent: '规则内容', sysPromptLabel: '系统提示词（必填）', userCtxLabel: '用户上下文（必填）',
          livePreview: '实时预览（最终注入 LLM 的 prompt）', userCtxTitle: 'USER CONTEXT（占位符已替换）', userCtxPlaceholder: '（占位符已替换）',
          empty: '(空)', missingUserCtx: '(缺少 user_context)', stagedPlaceholder: '<已暂存的文件，生成时实时注入>',
          stagedDiffPlaceholder: '<点击「生成」时实时注入的 staged diff>', restoreDefaults: '恢复默认', cancel: '取消',
          saving: '保存中…', save: '保存', ruleEditorTitle: '提交规则编辑器 — {name}', close: '关闭',
          loadFailed: '读取失败', backToChanges: '返回变更列表', back: '返回', loadingDiff: '加载 diff…',
          historyLoadFailed: '读取历史失败', loadingHistory: '加载历史…', graphHint: '点击行查看提交详情', loadingDetail: '加载详情…',
          stageFirst: '请先点击文件右侧的 + 暂存要提交的文件', generated: '已生成提交信息（规则来源：{s}）',
          ruleRepo: '仓库专属', ruleGlobal: '全局', ruleBuiltin: '内置默认', genFailedKeep: '生成失败，已保留原内容', genFailed: '生成失败: {e}',
          commitFailed: '提交失败: {e}', editRules: '编辑提交规则', setRepoRules: '为当前仓库单独设置规则',
          resetGlobalRules: '重置全局默认为内置规则', resetRepoRules: '重置仓库专属规则', copyRules: '复制当前生效规则到剪贴板',
          effectiveRules: '当前生效：{s}', loading: '读取中…', msgPlaceholder: '提交信息（仅提交已暂存的文件；Ctrl+Enter 提交）',
          genTitle: '生成提交信息', genTitleWithModel: '当前生成模型：{m}',
          genModelConfig: '配置生成模型…', genModelFollowDefault: '跟随当前会话模型（默认）',
          genModelEffort: '思考强度', genModelEffortFollow: '跟随模型默认', genModelEffortOff: '关闭思考', genModelEffortHigh: '高', genModelEffortMax: '最大',
          genModelSaved: '已保存生成模型', genModelLoadFailed: '读取生成模型/模型列表失败', genModelEmpty: '没有可用模型',
          genModelCurrent: '生成模型: {m}', genModelThinking: '思考: {e}',
          genModelDefaultMark: '（默认）', genModelThinkingParen: '（思考: {e}）', resetDone: '已重置', resetFailed: '重置失败', copied: '已复制', copyFailed: '复制失败',
          stagedCount: '已暂存 {n} 个文件', noStaged: '暂无暂存文件', generate: '生成', generating: '生成中…', rules: '规则',
          commit: '提交', committing: '提交中…', pushing: '推送中…', commitAndPush: '提交并推送',
          titleStageFirst: '先用文件右侧的 + 暂存文件', commitTitle: 'git commit（仅已暂存的 {n} 个文件）', pushTitle: '提交成功后推送当前分支',
          loadingStatus: '读取状态…', statusLoadFailed: '读取状态失败', gitStatusFailed: 'git status 失败：{e}', treeClean: '工作区干净，没有变更',
          unstageAll: '取消暂存全部', stageAll: '暂存全部（{n} 个文件）', unstage: '取消暂存', stage: '暂存（git add）',
          discardAll: '放弃所有更改', discardFile: '放弃更改', groupCount: '共 {n} 个文件',
          stagedNTitle: '已暂存 {n} 个文件', unstagedNTitle: '未暂存变更 {n} 个文件', untrackedNTitle: '未跟踪 {n} 个文件',
          pullTitle: 'Pull（fetch + merge）', switchBranch: '切换分支',
          loadingBranches: '读取分支…', branchesLoadFailed: '读取分支失败', newBranchName: '新分支名', createAndSwitch: '创建并切换',
          newBranch: '新建分支…', moreActions: '更多操作', push: '推送（push）', stashChanges: 'Stash 当前变更',
          stashPop: 'Stash pop（最近一条）', behindAhead: '落后 {b} / 领先 {a}', doneSuffix: '{label}完成', failedSuffix: '{label}失败',
          morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Stash pop（最近一条）',
          loadingMore: '加载更多…', emptyHistory: '暂无提交记录',
          failedWith: '{label}失败: {e}',
          followChip: '跟随: {s}', followTitle: '自动跟随当前工作空间（切换工作空间时自动重新扫描）', followResume: '跟随工作空间', followResumeTitle: '恢复跟随当前工作空间并重新扫描',
          rescan: '重新扫描（并刷新所有仓库状态）', pickRoot: '选择其他根目录（手动模式，不再自动跟随）',
          locating: '正在定位工作空间…', scanning: '正在扫描 Git 仓库…', scanFailed: '扫描失败',
          noRepos: '未发现 Git 仓库。可点击右上角文件夹图标选择其他目录。', resizeTitle: '拖拽调整面板宽度',
          toastsLabel: 'Git Panel 通知', panelLabel: 'Git Panel 面板', toggleTitle: 'Git Panel（类 VS Code Source Control）'
        },
        en: {
          groupStaged: 'Staged Changes', groupChanges: 'Changes', groupUntracked: 'Untracked Changes', history: 'History',
          rulesLoadFailed: 'Failed to load rules', reading: '(loading…)', saved: 'Saved', saveFailed: 'Save failed', saveFailedWith: 'Save failed: {e}',
          validationNoSys: 'Validation failed: missing system_prompt', validationNoUser: 'Validation failed: missing user_context',
          restoredDefaults: 'Restored to built-in defaults (not saved)', repoOnlyLabel: 'Repo-specific rules (override global defaults, saved to {name}.yaml)',
          rulesContent: 'Rule content', sysPromptLabel: 'system prompt (required)', userCtxLabel: 'user context (required)',
          livePreview: 'Live preview (the final prompt injected into the LLM)', userCtxTitle: 'USER CONTEXT (placeholders replaced)', userCtxPlaceholder: '(placeholders replaced)',
          empty: '(empty)', missingUserCtx: '(missing user_context)', stagedPlaceholder: '<staged files, injected live at generation>',
          stagedDiffPlaceholder: '<staged diff injected live when you click Generate>', restoreDefaults: 'Restore Defaults', cancel: 'Cancel',
          saving: 'Saving…', save: 'Save', ruleEditorTitle: 'Commit Rule Editor — {name}', close: 'Close',
          loadFailed: 'Failed to load', backToChanges: 'Back to changes', back: 'Back', loadingDiff: 'Loading diff…',
          historyLoadFailed: 'Failed to load history', loadingHistory: 'Loading history…', graphHint: 'Click a row to view commit details', loadingDetail: 'Loading details…',
          stageFirst: 'Stage files first using the + on the right of each file', generated: 'Commit message generated (rules: {s})',
          ruleRepo: 'repo-specific', ruleGlobal: 'global', ruleBuiltin: 'built-in', genFailedKeep: 'Generation failed; original content kept', genFailed: 'Generation failed: {e}',
          commitFailed: 'Commit failed: {e}', editRules: 'Edit commit rules', setRepoRules: 'Set rules for this repo only',
          resetGlobalRules: 'Reset global defaults to built-in rules', resetRepoRules: 'Reset repo-specific rules', copyRules: 'Copy effective rules to the clipboard',
          effectiveRules: 'Effective: {s}', loading: 'Loading…', msgPlaceholder: 'Commit message (commits only staged files; Ctrl+Enter to commit)',
          genTitle: 'Generate commit message', genTitleWithModel: 'Generation model: {m}',
          genModelConfig: 'Configure generation model…', genModelFollowDefault: 'Follow current session model (default)',
          genModelEffort: 'Reasoning effort', genModelEffortFollow: 'Model default', genModelEffortOff: 'Off', genModelEffortHigh: 'High', genModelEffortMax: 'Max',
          genModelSaved: 'Generation model saved', genModelLoadFailed: 'Failed to load generation model / model list', genModelEmpty: 'No models available',
          genModelCurrent: 'Generation model: {m}', genModelThinking: 'thinking: {e}',
          genModelDefaultMark: ' (default)', genModelThinkingParen: ' (thinking: {e})', resetDone: 'Reset', resetFailed: 'Reset failed', copied: 'Copied', copyFailed: 'Copy failed',
          stagedCount: '{n} files staged', noStaged: 'No staged files', generate: 'Generate', generating: 'Generating…', rules: 'Rules',
          commit: 'Commit', committing: 'Committing…', pushing: 'Pushing…', commitAndPush: 'Commit & Push',
          titleStageFirst: 'Stage files first with +', commitTitle: 'git commit (only {n} staged files)', pushTitle: 'Commits, then pushes the current branch',
          loadingStatus: 'Loading status…', statusLoadFailed: 'Failed to load status', gitStatusFailed: 'git status failed: {e}', treeClean: 'Working tree clean',
          unstageAll: 'Unstage All', stageAll: 'Stage All ({n} files)', unstage: 'Unstage', stage: 'Stage (git add)',
          discardAll: 'Discard All Changes', discardFile: 'Discard Changes', groupCount: '{n} files in this group',
          stagedNTitle: '{n} files staged', unstagedNTitle: '{n} unstaged changes', untrackedNTitle: '{n} untracked files',
          pullTitle: 'Pull (fetch + merge)', switchBranch: 'Switch Branch',
          loadingBranches: 'Loading branches…', branchesLoadFailed: 'Failed to load branches', newBranchName: 'New branch name', createAndSwitch: 'Create & Switch',
          newBranch: 'New Branch…', moreActions: 'More Actions', push: 'Push', stashChanges: 'Stash Changes',
          stashPop: 'Stash Pop (latest)', behindAhead: 'Behind {b} / Ahead {a}', doneSuffix: '{label} completed', failedSuffix: '{label} failed',
          morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Pop Latest Stash',
          loadingMore: 'Loading more…', emptyHistory: 'No commits yet',
          failedWith: '{label} failed: {e}',
          followChip: 'Follow: {s}', followTitle: 'Auto-follow the current workspace (rescans when the workspace changes)', followResume: 'Follow workspace', followResumeTitle: 'Resume following the workspace and rescan',
          rescan: 'Rescan (also refreshes all repository statuses)', pickRoot: 'Pick another root (manual mode, stops following)',
          locating: 'Locating workspace…', scanning: 'Scanning for Git repositories…', scanFailed: 'Scan failed',
          noRepos: 'No Git repositories found. Click the folder icon to pick another directory.', resizeTitle: 'Drag to resize the panel width',
          toastsLabel: 'Git Panel notifications', panelLabel: 'Git Panel panel', toggleTitle: 'Git Panel (VS Code Source Control style)'
        }
      }
      function tr(key) {
        const table = TEXTS[lang] || TEXTS.zh
        return table[key] !== undefined ? table[key] : (TEXTS.zh[key] !== undefined ? TEXTS.zh[key] : key)
      }
      function fmt(template, params) {
        let s = template
        for (const k of Object.keys(params || {})) s = s.split('{' + k + '}').join(String(params[k]))
        return s
      }
      function applyLocale(next) {
        const nextLang = next === 'en' ? 'en' : 'zh'
        if (nextLang !== lang) {
          lang = nextLang
          store.set((s) => ({ ...s, langTick: (s.langTick || 0) + 1 }))
          callRpc('setLocale', { locale: lang }).catch(() => {})
        }
      }
      if (localeSvc && typeof localeSvc.getLocale === 'function') {
        ctx.on('locale/change', (snap) => { if (snap) applyLocale(snap.active) })
      }
      callRpc('setLocale', { locale: lang }).catch(() => {})

      function pushToast(kind, text) {
        const id = 'gp-t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        store.set((s) => ({ ...s, toasts: s.toasts.concat([{ id, kind, text: String(text), exiting: false }]).slice(-5) }))
        if (timer) timer.timeout(() => removeToast(id), 4600)
      }
      // 两段式移除：先标记 exiting（播放消失动画），动画时长过后真正移除
      function removeToast(id) {
        store.set((s) => ({ ...s, toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)) }))
        if (timer) timer.timeout(() => store.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 300)
      }

      function useStore() {
        const [, force] = React.useState(0)
        React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
        return store.get()
      }

      const GROUP_META = {
        staged: { titleKey: 'groupStaged' },
        unstaged: { titleKey: 'groupChanges' },
        untracked: { titleKey: 'groupUntracked' }
      }
      // 状态字母徽标（VS Code 风格）：未跟踪显示 U
      function glyphOf(x, y) {
        const code = x !== ' ' && x !== '?' ? x : y
        if (code === '?') return { g: 'U', cls: 'gp-g-added' }
        if (code === 'A') return { g: 'A', cls: 'gp-g-added' }
        if (code === 'M') return { g: 'M', cls: 'gp-g-modified' }
        if (code === 'D') return { g: 'D', cls: 'gp-g-deleted' }
        if (code === 'R') return { g: 'R', cls: 'gp-g-modified' }
        if (code === 'C') return { g: 'C', cls: 'gp-g-modified' }
        if (code === 'U') return { g: 'U', cls: 'gp-g-deleted' }
        if (code === 'T') return { g: 'T', cls: 'gp-g-modified' }
        return { g: '?', cls: '' }
      }
      function parseRulesYaml(text) {
        const out = {}
        const lines = String(text || '').split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(\|[+-]?|\>[+-]?))?\s*(.*)$/.exec(lines[i])
          if (m && m[2] && m[2][0] === '|') {
            const key = m[1]
            const raw = []
            i++
            while (i < lines.length) {
              const l = lines[i]
              if (l.trim() === '') { raw.push(''); i++; continue }
              const ind = /^(\s*)/.exec(l)[1].length
              if (ind === 0 && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l)) break
              raw.push(l)
              i++
            }
            // YAML 块标量：以首条非空行的缩进为块缩进统一剥离，保留内容自身的层级缩进
            let blockInd = 0
            for (const l of raw) { if (l.trim() !== '') { blockInd = /^(\s*)/.exec(l)[1].length; break } }
            const block = raw.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(blockInd, /^(\s*)/.exec(l)[1].length))))
            out[key] = block.join('\n').replace(/\n+$/, '')
          } else if (m) { out[m[1]] = m[3]; i++ } else { i++ }
        }
        return out
      }
      // 与 host.js 的 emitRulesYaml 完全一致：两个块标量、内容统一缩进 2 空格
      function emitRulesYaml(rules) {
        const indent = (s) => String(s || '').split('\n').map((l) => (l === '' ? '' : '  ' + l)).join('\n')
        return 'system_prompt: |\n' + indent(rules.system_prompt) + '\n\nuser_context: |\n' + indent(rules.user_context) + '\n'
      }
      function diffLineClass(line) {
        if (line.startsWith('+++') || line.startsWith('---')) return 'gp-diff-hdr'
        if (line.startsWith('@@')) return 'gp-diff-hunk'
        if (line.startsWith('+')) return 'gp-diff-add'
        if (line.startsWith('-')) return 'gp-diff-del'
        return 'gp-diff-plain'
      }

      function ToastLayer() {
        const s = useStore()
        return React.createElement('div', { className: 'gp-toast-stack' },
          (s.toasts || []).map((t) => React.createElement('div', { key: t.id, className: 'gp-toast gp-toast-' + t.kind + (t.exiting ? ' gp-toast-exit' : '') }, t.text)))
      }

      function RuleEditorModal({ repo, scope, onClose }) {
        // 两个独立编辑框：system_prompt / user_context 的 YAML 键固定展示、不可编辑，避免误删
        const [sysPrompt, setSysPrompt] = React.useState('')
        const [userCtx, setUserCtx] = React.useState('')
        const [repoOnly, setRepoOnly] = React.useState(scope === 'repo')
        const [loaded, setLoaded] = React.useState(false)
        const [saving, setSaving] = React.useState(false)
        const [branch, setBranch] = React.useState(tr('reading'))

        React.useEffect(() => {
          callRpc('rulesGet', { repoId: repo.id }).then((r) => {
            if (r && r.ok) {
              const initial = scope === 'repo' ? (r.repoYaml || r.defaultYaml) : r.defaultYaml
              const fields = parseRulesYaml(initial)
              setSysPrompt(fields.system_prompt || '')
              setUserCtx(fields.user_context || '')
              setLoaded(true)
            } else pushToast('error', (r && r.error) || tr('rulesLoadFailed'))
          }).catch((e) => pushToast('error', tr('rulesLoadFailed') + ': ' + (e && e.message ? e.message : String(e))))
          callRpc('status', { repoId: repo.id }).then((r) => { if (r && r.ok && r.branch) setBranch(r.branch) }).catch(() => {})
        }, [repo.id])

        const previewUser = (userCtx || tr('missingUserCtx'))
          .replaceAll('{repo_name}', repo.name)
          .replaceAll('{branch}', branch)
          .replaceAll('{file_list}', '- ' + tr('stagedPlaceholder'))
          .replaceAll('{staged_diff}', tr('stagedDiffPlaceholder'))

        const onSave = async () => {
          if (!sysPrompt.trim()) { pushToast('error', tr('validationNoSys')); return }
          if (!userCtx.trim()) { pushToast('error', tr('validationNoUser')); return }
          setSaving(true)
          try {
            const yaml = emitRulesYaml({ system_prompt: sysPrompt, user_context: userCtx })
            const r = await callRpc('rulesSave', { repoId: repo.id, scope: repoOnly ? 'repo' : 'global', yaml })
            if (r && r.ok) { pushToast('success', r.summary || tr('saved')); onClose() }
            else pushToast('error', (r && r.error) || tr('saveFailed'))
          } catch (e) { pushToast('error', fmt(tr('saveFailedWith'), { e: e && e.message ? e.message : String(e) })) }
          finally { setSaving(false) }
        }
        const onRestoreDefault = () => {
          callRpc('rulesGet', { repoId: repo.id }).then((r) => {
            if (r && r.ok) {
              const fields = parseRulesYaml(r.defaultYaml)
              setSysPrompt(fields.system_prompt || '')
              setUserCtx(fields.user_context || '')
              pushToast('info', tr('restoredDefaults'))
            }
          }).catch(() => {})
        }

        const fieldEditor = (keyName, label, value, setValue) =>
          React.createElement('div', { className: 'gp-rule-field' },
            React.createElement('div', { className: 'gp-rule-field-head' },
              React.createElement('code', { className: 'gp-rule-field-key' }, keyName),
              React.createElement('span', { className: 'gp-rule-field-label' }, label)),
            React.createElement('textarea', { className: 'gp-rule-input', value, spellCheck: false, onChange: (e) => setValue(e.target.value) }))

        const body = React.createElement('div', { className: 'gp-modal-body' },
          React.createElement('div', { className: 'gp-toggle-row' },
            React.createElement('input', { type: 'checkbox', checked: repoOnly, onChange: (e) => setRepoOnly(e.target.checked) }),
            React.createElement('span', null, fmt(tr('repoOnlyLabel'), { name: repo.name }))),
          React.createElement('div', { className: 'gp-rule-cols' },
            React.createElement('div', { className: 'gp-rule-col' },
              React.createElement('div', { className: 'gp-rule-col-title' }, tr('rulesContent')),
              React.createElement('div', { className: 'gp-rule-fields' },
                fieldEditor('system_prompt', tr('sysPromptLabel'), sysPrompt, setSysPrompt),
                fieldEditor('user_context', tr('userCtxLabel'), userCtx, setUserCtx))),
            React.createElement('div', { className: 'gp-rule-col' },
              React.createElement('div', { className: 'gp-rule-col-title' }, tr('livePreview')),
              React.createElement('div', { className: 'gp-rule-preview' },
                React.createElement('div', { className: 'gp-rule-preview-title' }, 'SYSTEM PROMPT'),
                sysPrompt || tr('empty'),
                React.createElement('div', { className: 'gp-rule-preview-title' }, tr('userCtxTitle')),
                previewUser))))

        const foot = React.createElement('div', { className: 'gp-modal-foot' },
          React.createElement('button', { className: 'gp-btn', onClick: onRestoreDefault }, tr('restoreDefaults')),
          React.createElement('button', { className: 'gp-btn', onClick: onClose }, tr('cancel')),
          React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: onSave, disabled: saving || !loaded }, saving ? tr('saving') : tr('save')))

        return React.createElement('div', { className: 'gp-modal-backdrop', onClick: onClose },
          React.createElement('div', { className: 'gp-modal', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' },
              icon('gear', 15),
              React.createElement('span', { className: 'gp-spacer' }, fmt(tr('ruleEditorTitle'), { name: repo.name })),
              React.createElement('button', { className: 'gp-btn-icon', onClick: onClose, title: tr('close') }, icon('close'))),
            body,
            foot))
      }

      function DiffPane({ repo, path, group, onClose }) {
        const [state, setState] = React.useState({ loading: true, text: '', error: '' })
        React.useEffect(() => {
          let alive = true
          callRpc('fileDiff', { repoId: repo.id, path, group }).then((r) => {
            if (!alive) return
            if (r && r.ok) setState({ loading: false, text: r.text, error: '' })
            else setState({ loading: false, text: '', error: (r && r.error) || tr('loadFailed') })
          }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
          return () => { alive = false }
        }, [repo.id, path, group])
        const lines = state.text.split('\n').map((l, i) => React.createElement('span', { key: i, className: diffLineClass(l) }, l, '\n'))
        const head = React.createElement('div', { className: 'gp-diff-head' },
          React.createElement('button', { className: 'gp-btn-icon', onClick: onClose, title: tr('backToChanges') }, icon('back'), tr('back')),
          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, path),
          React.createElement('span', { className: 'gp-spacer' }),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, GROUP_META[group] ? tr(GROUP_META[group].titleKey) : group))
        const body = React.createElement('div', { className: 'gp-diff-body' },
          state.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingDiff')) : state.error ? React.createElement('div', { className: 'gp-empty' }, state.error) : React.createElement('pre', { className: 'gp-diff-pre' }, lines))
        return React.createElement('div', { className: 'gp-diff-pane' }, head, body)
      }

      // 简易 lane 图算法（VS Code 风格）：按行计算提交所在的 lane、合并连线与活跃 lane 区间
      function computeGraph(entries) {
        const laneTips = new Map()
        const laneSince = []
        const laneLast = []
        const laneOpen = []
        const freeLanes = []
        const rowLane = []
        const rowMerge = []
        const rowActive = []
        let maxLane = 0
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]
          const merges = []
          const pending = laneTips.get(e.hash)
          let lane
          if (pending !== undefined && pending.length > 0) {
            lane = pending[0]
            laneTips.delete(e.hash)
            laneLast[lane] = i
            // 其余等待同一提交的 lane 在本行汇合（画水平连线后终止）
            for (let k = 1; k < pending.length; k++) {
              const j = pending[k]
              laneLast[j] = i
              laneOpen[j] = false
              freeLanes.push(j)
              merges.push(j)
            }
          } else {
            lane = freeLanes.length > 0 ? freeLanes.pop() : laneSince.length
            if (lane === laneSince.length) { laneSince.push(i); laneLast.push(i); laneOpen.push(false) }
            else { laneSince[lane] = i; laneLast[lane] = i }
          }
          rowLane[i] = lane
          if (lane > maxLane) maxLane = lane
          const parents = e.parents || []
          if (parents.length > 0) {
            laneOpen[lane] = true
            for (let p = 0; p < parents.length; p++) {
              const ph = parents[p]
              const lst = laneTips.get(ph)
              if (lst !== undefined) {
                if (p === 0) {
                  // 第一父提交已被其他 lane 挂起：本 lane 作为 joiner 一起等它（到父提交行汇合）
                  lst.push(lane)
                  laneTips.set(ph, lst)
                } else {
                  merges.push(lst[0])
                }
              } else if (p === 0) {
                laneTips.set(ph, [lane])
              } else {
                let pl = freeLanes.length > 0 ? freeLanes.pop() : laneSince.length
                if (pl === laneSince.length) { laneSince.push(i); laneLast.push(-1); laneOpen.push(true) }
                else { laneSince[pl] = i; laneLast[pl] = -1; laneOpen[pl] = true }
                if (pl > maxLane) maxLane = pl
                laneTips.set(ph, [pl])
                merges.push(pl)
              }
            }
          } else {
            laneOpen[lane] = false
            freeLanes.push(lane)
          }
          rowMerge[i] = merges
          const active = []
          for (let l = 0; l < laneSince.length; l++) {
            if (laneSince[l] <= i && (laneOpen[l] || laneLast[l] >= i)) active.push(l)
          }
          rowActive[i] = active
        }
        // maxLane 不设上限：向下滚动追加数据出现更多 lane 时，图形宽度随之动态增长
        return { rowLane, rowMerge, rowActive, maxLane, laneSince, laneLast }
      }

      // VS Code 内置 Graph lane 配色（青/绿/红/琥珀/紫…），按 lane 循环取色
      const LANE_COLORS = ['#00bcf2', '#2d8844', '#ec5a5a', '#b18e35', '#8f4b8f', '#4ec9b0', '#e2a33d', '#d16ba5']
      const laneColor = (l) => LANE_COLORS[l % LANE_COLORS.length]

      // 解析 %D refs 装饰：区分当前分支/本地分支/远程分支/tag；origin/HEAD 为符号引用，始终隐藏
      function parseRefs(refsStr) {
        const out = { current: '', branches: [], remotes: [], tags: [] }
        String(refsStr || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((r) => {
          const m = r.match(/^HEAD -> (.+)$/)
          if (m) { out.current = m[1]; return }
          if (r === 'HEAD' || r === 'origin/HEAD') return
          if (r.lastIndexOf('tag: ', 0) === 0) { out.tags.push(r.slice(5)); return }
          if (r.indexOf('/') >= 0) out.remotes.push(r)
          else out.branches.push(r)
        })
        return out
      }

      function GitGraphView({ repo }) {
        const [state, setState] = React.useState({ loading: true, entries: [], error: '', hasMore: true, loadingMore: false })
        const [hover, setHover] = React.useState(null)
        const [, bumpHover] = React.useReducer((c) => c + 1, 0)
        const [win, setWin] = React.useState({ first: 0, last: 40 })
        const stateRef = React.useRef(state)
        stateRef.current = state
        const listRef = React.useRef(null)
        const hoverHashRef = React.useRef(null)
        const hideRef = React.useRef(null)
        const detailCache = React.useRef(new Map())
        const ROWH = 26
        const PAGE = 200

        const loadPage = React.useCallback(async (skip, append) => {
          if (append) setState((s) => ({ ...s, loadingMore: true }))
          else setState((s) => ({ ...s, loading: true, error: '' }))
          try {
            const r = await callRpc('log', { repoId: repo.id, skip, limit: PAGE })
            if (r && r.ok) {
              const list = append ? stateRef.current.entries.concat(r.entries || []) : (r.entries || [])
              setState({ loading: false, loadingMore: false, error: '', entries: list, hasMore: !!r.hasMore })
            } else setState((s) => ({ ...s, loading: false, loadingMore: false, error: (r && r.error) || tr('historyLoadFailed') }))
          } catch (e) { setState((s) => ({ ...s, loading: false, loadingMore: false, error: e && e.message ? e.message : String(e) })) }
        }, [repo.id])

        React.useEffect(() => { loadPage(0, false) }, [loadPage])

        const syncWindow = React.useCallback(() => {
          const el = listRef.current
          if (!el) return
          const first = Math.max(0, Math.floor(el.scrollTop / ROWH) - 15)
          const last = Math.min(stateRef.current.entries.length, Math.ceil((el.scrollTop + el.clientHeight) / ROWH) + 15)
          setWin((w) => (w.first === first && w.last === last ? w : { first, last }))
          if (stateRef.current.hasMore && !stateRef.current.loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 800) {
            loadPage(stateRef.current.entries.length, true)
          }
        }, [loadPage])

        // 滚动加载：到底部前 800px 预取下一页；数据追加后若仍靠近底部则继续加载
        React.useEffect(() => { syncWindow() }, [state.entries, state.hasMore, state.loading, state.loadingMore, syncWindow])

        const graph = React.useMemo(() => computeGraph(state.entries), [state.entries])

        // 悬停详情（VS Code hover 风格）：离开行/弹层后短暂延迟关闭，滚动立即关闭
        const cancelHide = () => { if (hideRef.current) { hideRef.current(); hideRef.current = null } }
        const scheduleHide = () => {
          cancelHide()
          if (timer) hideRef.current = timer.timeout(() => { hoverHashRef.current = null; setHover(null); hideRef.current = null }, 160)
          else { hoverHashRef.current = null; setHover(null) }
        }
        const closeHover = () => { cancelHide(); if (hoverHashRef.current) { hoverHashRef.current = null; setHover(null) } }
        const ensureDetail = (hash) => {
          if (detailCache.current.has(hash)) return
          detailCache.current.set(hash, { loading: true })
          callRpc('commitDetail', { repoId: repo.id, hash }).then((r) => {
            detailCache.current.set(hash, r && r.ok ? { loading: false, data: r } : { loading: false, error: (r && r.error) || tr('loadFailed') })
            if (hoverHashRef.current === hash) bumpHover()
          }).catch((e) => {
            detailCache.current.set(hash, { loading: false, error: e && e.message ? e.message : String(e) })
            if (hoverHashRef.current === hash) bumpHover()
          })
        }
        const showDetail = (hash, el, refs, short) => {
          cancelHide()
          const rect = el.getBoundingClientRect()
          hoverHashRef.current = hash
          setHover({ hash, top: rect.top, left: rect.left, refs: refs || '', short: short || '' })
          ensureDetail(hash)
        }

        const total = state.entries.length * ROWH
        const maxLane = graph.maxLane
        // 左缘留白 8px：保证 lane 0 的 HEAD 外环（含描边）完整落在视口内不被截断
        const X = (l) => 8 + l * 14
        const W = 8 + (maxLane + 1) * 14 + 6
        const MID = ROWH / 2
        const rows = []
        for (let i = win.first; i < win.last && i < state.entries.length; i++) {
          const e = state.entries[i]
          const lane = graph.rowLane[i]
          const merges = graph.rowMerge[i] || []
          const active = graph.rowActive[i] || []
          const isHead = /HEAD/.test(e.refs || '')
          const els = []
          const skipVert = new Set()
          // 分支/合并连线：平滑 S 形贝塞尔曲线（VS Code 风格），在行的上/下边缘与竖线无缝衔接
          for (const m of merges) {
            const x1 = X(m), x2 = X(lane)
            if (graph.laneLast[m] === i) {
              // 该 lane 在本行汇入提交节点：从行顶弯入节点
              skipVert.add(m)
              els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x1 + ' -1 C ' + x1 + ' ' + (MID - 7) + ' ' + x2 + ' ' + (MID - 7) + ' ' + x2 + ' ' + MID, fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
            } else {
              // 从提交节点分出新 lane / 并入途经 lane：从节点弯向行底
              if (graph.laneSince[m] === i) skipVert.add(m)
              els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x2 + ' ' + MID + ' C ' + x2 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (ROWH + 1), fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
            }
          }
          // 垂直 lane 线：贯穿整行；根提交的 lane 止于节点；已由曲线接管的 lane 不再画竖线
          for (const l of active) {
            if (skipVert.has(l)) continue
            const y2 = l === lane && (e.parents || []).length === 0 ? MID : ROWH + 1
            els.push(React.createElement('line', { key: 'v' + l, x1: X(l), y1: -1, x2: X(l), y2, stroke: laneColor(l), strokeWidth: 1.5, strokeLinecap: 'round' }))
          }
          // 提交节点：以背景色描边镂空穿过节点的连线（VS Code 风格）
          els.push(React.createElement('circle', { key: 'd', cx: X(lane), cy: MID, r: 4, fill: laneColor(lane), stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 2 }))
          // HEAD 外环：紧贴内球的细空心环（VSCode 内置 Graph 风格），外缘 5.9+0.7=6.6 < 左缘 8px
          if (isHead) els.push(React.createElement('circle', { key: 'h', cx: X(lane), cy: MID, r: 5.9, fill: 'none', stroke: laneColor(lane), strokeWidth: 1.4 }))
          // 行内只展示一个主要分支标签（当前分支高亮），远程分支等完整 refs 放入悬浮详情
          const refs = parseRefs(e.refs)
          const refEls = []
          const primary = refs.current || refs.branches[0] || refs.remotes[0]
          if (primary) refEls.push(React.createElement('span', { key: 'p', className: refs.current ? 'gp-grow-ref gp-grow-ref-cur' : 'gp-grow-ref' }, primary))
          refs.tags.forEach((t, ti) => refEls.push(React.createElement('span', { key: 't' + ti, className: 'gp-grow-ref gp-grow-ref-tag' }, t)))
          rows.push(React.createElement('div', { key: e.hash, className: 'gp-grow', style: { top: i * ROWH, height: ROWH }, onMouseEnter: (ev) => showDetail(e.hash, ev.currentTarget, e.refs, e.short), onMouseLeave: scheduleHide },
            React.createElement('svg', { width: W, height: ROWH, viewBox: '0 0 ' + W + ' ' + ROWH, style: { display: 'block', flex: '0 0 auto' } }, els),
            React.createElement('span', { className: 'gp-grow-subject' }, e.subject),
            refEls.length > 0 ? React.createElement('span', { className: 'gp-grow-refs' }, refEls) : null,
            React.createElement('span', { className: 'gp-grow-meta' }, (e.author || '') + ' · ' + (e.date || '').slice(0, 10))))
        }

        const body = state.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingHistory')) :
          state.error ? React.createElement('div', { className: 'gp-empty' }, state.error) :
            state.entries.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('emptyHistory')) :
              React.createElement('div', { className: 'gp-graph-scroll', ref: listRef, onScroll: () => { closeHover(); syncWindow() } },
                React.createElement('div', { style: { position: 'relative', height: total + (state.hasMore ? ROWH : 0) } },
                  rows,
                  state.loadingMore ? React.createElement('div', { className: 'gp-grow-more', style: { top: total, height: ROWH } }, React.createElement('span', { className: 'gp-spinner' }), tr('loadingMore')) : null))

        // 悬停唤出的提交详情浮层（替代原右侧详情栏），可移入浮层内查看
        const POPW = 400
        const POPH = 320
        const pop = hover ? (() => {
          const d = detailCache.current.get(hover.hash)
          const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
          const left = Math.max(8, hover.left - POPW - 10)
          const top = Math.max(8, Math.min(hover.top - 8, vh - POPH - 12))
          // 完整 refs（当前分支高亮，如 main 与 origin/main 同列）——行内只展示主分支，悬浮展示全部
          const refs = parseRefs(hover.refs)
          const refChips = []
          if (refs.current) refChips.push(React.createElement('span', { key: 'c', className: 'gp-grow-ref gp-grow-ref-cur' }, refs.current))
          refs.branches.forEach((b, bi) => refChips.push(React.createElement('span', { key: 'b' + bi, className: 'gp-grow-ref' }, b)))
          refs.remotes.forEach((r, ri) => refChips.push(React.createElement('span', { key: 'r' + ri, className: 'gp-grow-ref' }, r)))
          refs.tags.forEach((t, ti) => refChips.push(React.createElement('span', { key: 't' + ti, className: 'gp-grow-ref gp-grow-ref-tag' }, t)))
          const inner = !d || d.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingDetail')) :
            d.error ? React.createElement('div', { className: 'gp-empty' }, d.error) :
              React.createElement('div', null,
                React.createElement('div', { className: 'gp-cd-subject' }, d.data.subject,
                  React.createElement('span', { className: 'gp-cd-hash' }, hover.short || String(hover.hash || '').slice(0, 7))),
                refChips.length > 0 ? React.createElement('div', { className: 'gp-cd-refs' }, refChips) : null,
                React.createElement('div', { className: 'gp-cd-meta' }, d.data.author + ' <' + d.data.email + '>  ·  ' + d.data.date),
                React.createElement('div', { className: 'gp-cd-message' }, d.data.message),
                d.data.stat ? React.createElement('div', { className: 'gp-cd-stat' }, d.data.stat) : null)
          return React.createElement('div', { className: 'gp-cd-pop', style: { left, top, maxHeight: POPH }, onMouseEnter: cancelHide, onMouseLeave: scheduleHide }, inner)
        })() : null

        return React.createElement('div', { className: 'gp-history-body' },
          React.createElement('div', { className: 'gp-graph-wrap' }, body),
          pop)
      }

      // 提交区：仅处理已暂存（staged）文件——生成 / 提交 / 提交并推送都基于 stagedPaths
      function CommitArea({ repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus }) {
        const [rulesMenuOpen, setRulesMenuOpen] = React.useState(false)
        const [rulesInfo, setRulesInfo] = React.useState(null)
        const [openRules, setOpenRules] = React.useState(false)
        const [openGenModel, setOpenGenModel] = React.useState(false)
        const [rulesScope, setRulesScope] = React.useState('global')
        // 当前生效的生成模型（用于菜单显示 + 生成按钮 hover 提示）；null=跟随会话
        const [genModel, setGenModel] = React.useState(null)
        const loadGenModel = React.useCallback(() => {
          callRpc('genModelGet', {}).then((r) => {
            if (r && r.ok) {
              const cfg = r.configured
              const eff = r.effective
              let label
              if (cfg) {
                label = cfg.model
                if (cfg.reasoningEffort) label += fmt(tr('genModelThinkingParen'), { e: cfg.reasoningEffort === 'off' ? tr('genModelEffortOff') : cfg.reasoningEffort === 'high' ? tr('genModelEffortHigh') : tr('genModelEffortMax') })
              } else if (eff) {
                // 跟随会话默认：模型名 + （默认）标记
                label = eff.model + tr('genModelDefaultMark')
              } else {
                label = '-' + tr('genModelDefaultMark')
              }
              setGenModel(label)
            }
          }).catch(() => {})
        }, [])
        React.useEffect(() => { loadGenModel() }, [loadGenModel])
        const canCommit = message.trim() !== '' && stagedPaths.length > 0 && busy === null
        const lineCount = Math.min(6, Math.max(2, (message.match(/\n/g) || []).length + 1))

        const doGenerate = async () => {
          if (busy) return
          setBusy('generate')
          try {
            // 生成前先刷新仓库状态：生成基于 staged diff，必须用最新的 staged 文件列表
            //（外部改动/自动刷新延迟可能让面板列表过期，导致漏掉刚暂存或带上已取消暂存的文件）。
            let paths = stagedPaths
            try {
              const st = await callRpc('status', { repoId: repo.id })
              if (st && st.ok && Array.isArray(st.staged)) {
                paths = st.staged.map((f) => f.path)
                if (refreshStatus) refreshStatus()
              }
            } catch (e) { /* 刷新失败时退用面板现有列表 */ }
            if (paths.length === 0) { pushToast('error', tr('stageFirst')); return }
            const r = await callRpc('generate', { repoId: repo.id, files: paths })
            if (!(r && r.ok)) { pushToast('error', (r && r.error) || tr('genFailedKeep')); return }
            const genId = r.genId
            let fails = 0
            while (true) {
              // 统一走 timer 服务（动态包沙箱禁用原生 setTimeout）
              await new Promise((res) => { timer.timeout(res, 120) })
              const p = await callRpc('generatePoll', { genId }).catch(() => null)
              if (!p || !p.ok) {
                if (++fails > 5) { pushToast('error', (p && p.error) || tr('genFailedKeep')); break }
                continue
              }
              setMessage(p.text || '')
              if (p.error) { pushToast('error', p.error); break }
              if (p.done) {
                pushToast('success', fmt(tr('generated'), { s: p.ruleSource === 'repo' ? tr('ruleRepo') : p.ruleSource === 'global' ? tr('ruleGlobal') : tr('ruleBuiltin') }))
                break
              }
            }
          } catch (e) { pushToast('error', fmt(tr('genFailed'), { e: e && e.message ? e.message : String(e) })) }
          finally { setBusy(null) }
        }

        const doCommit = async (pushAfter) => {
          if (!canCommit) return
          setBusy(pushAfter ? 'push' : 'commit')
          try {
            const r = await callRpc('commit', { repoId: repo.id, files: stagedPaths, message, sessionId })
            const out = handleWriteResult(r, 'COMMIT')
            if (pushAfter && out === 'ok') {
              const pr = await callRpc('push', { repoId: repo.id, sessionId })
              handleWriteResult(pr, 'PUSH')
            }
          } catch (e) { pushToast('error', fmt(tr('commitFailed'), { e: e && e.message ? e.message : String(e) })) }
          finally { setBusy(null) }
        }

        const loadRulesInfo = () => {
          callRpc('rulesGet', { repoId: repo.id }).then((r) => {
            if (r && r.ok) setRulesInfo({ source: r.effective.source, repoRuleExists: r.repoRuleExists })
          }).catch(() => {})
        }

        const rulesMenu = rulesMenuOpen ? React.createElement('div', { className: 'gp-menu', style: { right: 'auto', left: 0 } },
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setRulesScope('global'); setOpenRules(true) } }, tr('editRules')),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setRulesScope('repo'); setOpenRules(true) } }, tr('setRepoRules')),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); callRpc('rulesReset', { repoId: repo.id, scope: 'global' }).then((r) => pushToast(r && r.ok ? 'success' : 'error', r && r.ok ? (r.summary || tr('resetDone')) : (r && r.error) || tr('resetFailed'))).catch(() => pushToast('error', tr('resetFailed'))) } }, tr('resetGlobalRules')),
          rulesInfo && rulesInfo.repoRuleExists ? React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); callRpc('rulesReset', { repoId: repo.id, scope: 'repo' }).then((r) => pushToast(r && r.ok ? 'success' : 'error', r && r.ok ? (r.summary || tr('resetDone')) : (r && r.error) || tr('resetFailed'))).catch(() => pushToast('error', tr('resetFailed'))) } }, tr('resetRepoRules')) : null,
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); callRpc('rulesCopy', { repoId: repo.id }).then((r) => pushToast(r && r.ok ? 'success' : 'error', r && r.ok ? (r.summary || tr('copied')) : (r && r.error) || tr('copyFailed'))).catch(() => pushToast('error', tr('copyFailed'))) } }, tr('copyRules')),
          React.createElement('div', { className: 'gp-menu-sep' }),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setOpenGenModel(true) } }, tr('genModelConfig')),
          React.createElement('div', { className: 'gp-menu-sep' }),
          React.createElement('div', { className: 'gp-menu-note' }, fmt(tr('effectiveRules'), { s: rulesInfo ? (rulesInfo.source === 'repo' ? tr('ruleRepo') : rulesInfo.source === 'global' ? tr('ruleGlobal') : tr('ruleBuiltin')) : tr('loading') })),
          genModel ? React.createElement('div', { className: 'gp-menu-note' }, fmt(tr('genModelCurrent'), { m: genModel })) : null
        ) : null

        return React.createElement('div', { className: 'gp-commit-area' },
          React.createElement('textarea', { className: 'gp-textarea', rows: lineCount, value: message, placeholder: tr('msgPlaceholder'), onChange: (e) => setMessage(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(false) } } }),
          React.createElement('div', { className: 'gp-commit-row' },
            React.createElement('div', { className: 'gp-left-group' },
              React.createElement('button', { className: 'gp-btn', onClick: doGenerate, disabled: busy !== null || stagedPaths.length === 0, title: genModel ? fmt(tr('genTitleWithModel'), { m: genModel }) : tr('genTitle') },
                busy === 'generate' ? React.createElement('span', { className: 'gp-spinner' }) : icon('sparkles'),
                busy === 'generate' ? tr('generating') : tr('generate')),
              React.createElement('div', { className: 'gp-menu-wrap' },
                React.createElement('button', { className: 'gp-btn', onClick: () => { setRulesMenuOpen((o) => !o); if (!rulesMenuOpen) loadRulesInfo() } }, icon('gear'), tr('rules') + ' ', icon('chevronDown', 11)),
                rulesMenu)),
            React.createElement('span', { className: 'gp-staged-hint' }, stagedPaths.length > 0 ? fmt(tr('stagedCount'), { n: stagedPaths.length }) : tr('noStaged'))),
          React.createElement('div', { className: 'gp-commit-actions' },
            React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: () => doCommit(false), disabled: !canCommit, title: stagedPaths.length === 0 ? tr('titleStageFirst') : fmt(tr('commitTitle'), { n: stagedPaths.length }) },
              busy === 'commit' ? React.createElement('span', { className: 'gp-spinner' }) : icon('check'),
              busy === 'commit' ? tr('committing') : tr('commit')),
            React.createElement('button', { className: 'gp-btn', onClick: () => doCommit(true), disabled: !canCommit, title: tr('pushTitle') },
              busy === 'push' ? React.createElement('span', { className: 'gp-spinner' }) : icon('arrowUp'),
              busy === 'push' ? tr('pushing') : tr('commitAndPush'))),
          rulesMenuOpen ? React.createElement('div', { className: 'gp-menu-backdrop', onClick: (e) => { e.stopPropagation(); setRulesMenuOpen(false) } }) : null,
          openRules ? React.createElement(RuleEditorModal, { repo, scope: rulesScope, onClose: () => setOpenRules(false) }) : null,
          openGenModel ? React.createElement(GenModelModal, { onClose: () => setOpenGenModel(false), onSaved: () => loadGenModel() }) : null)
      }

      // 生成模型配置弹窗：跟随会话默认 / 按 provider 分组选择模型 + 思考强度
      function GenModelModal({ onClose, onSaved }) {
        const [st, setSt] = React.useState({ loading: true, providers: [], configured: null, sessionDefault: null, selected: null, effort: null, saving: false, error: '' })
        React.useEffect(() => {
          let alive = true
          Promise.all([callRpc('genModelGet', {}).catch(() => null), callRpc('models', {}).catch(() => null)]).then(([gm, ms]) => {
            if (!alive) return
            const configured = gm && gm.ok ? gm.configured : null
            const sessionDefault = gm && gm.ok ? gm.sessionDefault : null
            setSt((s) => ({
              ...s,
              loading: false,
              providers: ms && ms.ok && Array.isArray(ms.providers) ? ms.providers : [],
              configured,
              sessionDefault,
              selected: configured ? { provider: configured.provider, model: configured.model } : null,
              effort: configured ? configured.reasoningEffort : null,
              error: (gm && gm.ok && ms && ms.ok) ? '' : tr('genModelLoadFailed')
            }))
          })
          return () => { alive = false }
        }, [])

        const save = async () => {
          setSt((s) => ({ ...s, saving: true }))
          try {
            const payload = st.selected ? { provider: st.selected.provider, model: st.selected.model, reasoningEffort: st.effort } : { configured: null }
            const r = await callRpc('genModelSet', payload)
            if (r && r.ok) { pushToast('success', tr('genModelSaved')); if (onSaved) onSaved(); onClose() }
            else pushToast('error', (r && r.error) || tr('saveFailed'))
          } catch (e) { pushToast('error', fmt(tr('saveFailedWith'), { e: e && e.message ? e.message : String(e) })) }
          finally { setSt((s) => ({ ...s, saving: false })) }
        }

        const effortBtn = (val, label) => React.createElement('button', {
          className: 'gp-btn gp-btn-sm ' + (st.effort === val ? 'gp-btn-primary' : ''),
          onClick: () => setSt((s) => ({ ...s, effort: val }))
        }, label)

        const listBody = st.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loading')) :
          st.providers.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('genModelEmpty')) :
            React.createElement('div', { className: 'gp-genmodel-scroll' },
              React.createElement('button', { className: 'gp-genmodel-item' + (st.selected === null ? ' gp-genmodel-selected' : ''), onClick: () => setSt((s) => ({ ...s, selected: null })) },
                React.createElement('span', null, tr('genModelFollowDefault')),
                st.sessionDefault ? React.createElement('span', { className: 'gp-genmodel-meta' }, st.sessionDefault.provider + ' / ' + st.sessionDefault.model) : null),
              st.providers.map((g) => React.createElement('div', { key: g.provider, className: 'gp-genmodel-group' },
                React.createElement('div', { className: 'gp-genmodel-group-title' }, g.provider),
                g.models.map((m) => React.createElement('button', { key: m.id, className: 'gp-genmodel-item' + (st.selected && st.selected.provider === g.provider && st.selected.model === m.id ? ' gp-genmodel-selected' : ''), onClick: () => setSt((s) => ({ ...s, selected: { provider: g.provider, model: m.id } })) }, m.id)))))

        return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); if (!st.saving) onClose() } },
          React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' }, icon('sparkles', 15), tr('genModelConfig')),
            React.createElement('div', { className: 'gp-modal-body' },
              listBody,
              React.createElement('div', { className: 'gp-genmodel-effort' },
                React.createElement('span', { className: 'gp-genmodel-effort-label' }, tr('genModelEffort')),
                effortBtn(null, tr('genModelEffortFollow')),
                effortBtn('off', tr('genModelEffortOff')),
                effortBtn('high', tr('genModelEffortHigh')),
                effortBtn('max', tr('genModelEffortMax'))),
              st.error ? React.createElement('div', { className: 'gp-empty gp-danger' }, st.error) : null),
            React.createElement('div', { className: 'gp-modal-foot' },
              React.createElement('button', { className: 'gp-btn', onClick: onClose, disabled: st.saving }, tr('cancel')),
              React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: save, disabled: st.saving || st.loading }, st.saving ? tr('saving') : tr('save')))))
      }

      function RepoCard({ repo, sessionId, onOpenDiff }) {
        const [status, setStatus] = React.useState({ loading: true, data: null, error: '' })
        const [isCollapsed, setCollapsed] = React.useState(false)
        const [historyOpen, setHistoryOpen] = React.useState(false)
        const [branchMenu, setBranchMenu] = React.useState({ open: false, loading: false, data: null, error: '', creating: false, newName: '' })
        const [moreMenu, setMoreMenu] = React.useState({ open: false })
        const [busy, setBusy] = React.useState(null)
        const [message, setMessage] = React.useState('')
        const s = useStore()

        const loadStatus = React.useCallback(async () => {
          try {
            const r = await callRpc('status', { repoId: repo.id })
            if (r && r.ok) setStatus({ loading: false, data: r, error: '' })
            else setStatus({ loading: false, data: null, error: (r && r.error) || tr('statusLoadFailed') })
          } catch (e) { setStatus({ loading: false, data: null, error: e && e.message ? e.message : String(e) }) }
        }, [repo.id])

        React.useEffect(() => { loadStatus() }, [loadStatus])
        // 定向刷新：只刷新最近一次写操作涉及的仓库卡片（lastOpRepoId 为空时才全量刷新，
        // 避免多仓库面板一次操作触发 4×N 条并发 git 命令）
        React.useEffect(() => { if (s.refreshTick > 0 && (s.lastOpRepoId == null || s.lastOpRepoId === repo.id)) loadStatus() }, [s.refreshTick, s.lastOpRepoId, repo.id, loadStatus])
        React.useEffect(() => {
          if (s.lastOp === 'commit' && s.lastOpRepoId === repo.id && s.refreshTick > 0) setMessage('')
        }, [s.refreshTick, s.lastOp, s.lastOpRepoId, repo.id])

        const handleWriteResult = (res, label) => {
          if (res && res.ok) {
            pushToast('success', res.summary || fmt(tr('doneSuffix'), { label }))
            store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: label === 'COMMIT' ? 'commit' : 'write', lastOpRepoId: repo.id }))
            return 'ok'
          }
          pushToast('error', (res && res.error) || fmt(tr('failedSuffix'), { label }))
          return 'error'
        }

        const runWrite = async (label, call) => {
          if (busy) return
          setBusy(label)
          try { handleWriteResult(await call(), label) } catch (e) { pushToast('error', fmt(tr('failedWith'), { label, e: e && e.message ? e.message : String(e) })) }
          finally { setBusy(null) }
        }

        // 暂存 / 取消暂存：可逆的本地 index 操作，直接执行
        const stage = (paths) => runWrite('stage', () => callRpc('stage', { repoId: repo.id, files: paths, sessionId }))
        const unstage = (paths) => runWrite('unstage', () => callRpc('unstage', { repoId: repo.id, files: paths, sessionId }))
        // 放弃更改（不可逆）：分组标题 = 放弃全部，文件行 = 放弃单个文件
        const discard = (paths, group) => runWrite('discard', () => callRpc('discard', { repoId: repo.id, files: paths, group, sessionId }))
        // 分组展开/收起（VS Code 风格：最左侧 chevron）
        const [groupsOpen, setGroupsOpen] = React.useState({ staged: true, unstaged: true, untracked: true })
        const toggleGroup = (g) => setGroupsOpen((o) => ({ ...o, [g]: !o[g] }))

        const openBranchMenu = () => {
          setBranchMenu((b) => ({ ...b, open: !b.open }))
          if (!branchMenu.open && !branchMenu.data && !branchMenu.loading) {
            setBranchMenu((b) => ({ ...b, loading: true }))
            callRpc('branches', { repoId: repo.id }).then((r) => setBranchMenu((b) => ({ ...b, loading: false, data: r && r.ok ? r : null, error: r && r.ok ? '' : (r && r.error) || tr('branchesLoadFailed') }))).catch((e) => setBranchMenu((b) => ({ ...b, loading: false, error: e && e.message ? e.message : String(e) })))
          }
        }

        const openMoreMenu = () => {
          setMoreMenu((m) => ({ ...m, open: !m.open }))
        }

        const closeAllMenus = () => {
          setBranchMenu((b) => ({ ...b, open: false }))
          setMoreMenu((m) => ({ ...m, open: false }))
        }

        const data = status.data
        const stagedPaths = data ? data.staged.map((f) => f.path) : []
        const totalStaged = data ? data.staged.length : 0
        const totalUnstaged = data ? data.unstaged.length : 0
        const totalUntracked = data ? data.untracked.length : 0

        const renderGroup = (group, list) => {
          list = list || []
          // 「更改」为空时仍保留标题行（占位提示）；「暂存的更改」「未跟踪的更改」为空时整组隐藏
          if (list.length === 0 && group !== 'unstaged') return null
          const meta = GROUP_META[group]
          const paths = list.map((f) => f.path)
          const open = groupsOpen[group] !== false
          const isStaged = group === 'staged'
          const hasItems = list.length > 0
          return React.createElement('div', { className: 'gp-section', key: group },
            React.createElement('div', { className: 'gp-section-title', onClick: () => toggleGroup(group) },
              React.createElement('button', { className: 'gp-chev', onClick: (e) => { e.stopPropagation(); toggleGroup(group) } }, icon(open ? 'chevronDown' : 'chevronRight', 13)),
              React.createElement('span', { className: 'gp-section-label' }, tr(meta.titleKey)),
              React.createElement('span', { className: 'gp-spacer' }),
              hasItems ? React.createElement('span', { className: 'gp-row-actions' },
                React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); discard(paths, group) } }, icon('discard')),
                isStaged
                  ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstageAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstage(paths) } }, icon('minus'))
                  : React.createElement('button', { className: 'gp-icon-btn', title: fmt(tr('stageAll'), { n: list.length }), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stage(paths) } }, icon('plus'))) : null,
              hasItems ? React.createElement('span', { className: 'gp-group-count', title: fmt(tr('groupCount'), { n: list.length }) }, list.length) : null),
            !open ? null : list.map((f) => {
              const gl = glyphOf(f.x, f.y)
              const trimmed = f.path.replace(/\/+$/, '')
              const seg = trimmed.split('/').pop() || f.path
              const base = f.path.endsWith('/') ? seg + '/' : seg
              const dir = trimmed.length > seg.length ? trimmed.slice(0, trimmed.length - seg.length).replace(/\/+$/, '') : ''
              return React.createElement('div', { className: 'gp-file-row', key: group + ':' + f.path, title: f.path, onClick: () => onOpenDiff(repo, f.path, group) },
                React.createElement('span', { className: 'gp-file-dot ' + gl.cls }, '•'),
                React.createElement('span', { className: 'gp-file-name' }, base),
                dir ? React.createElement('span', { className: 'gp-file-dir' }, dir) : null,
                f.orig ? React.createElement('span', { className: 'gp-file-orig', title: f.orig }, '← ' + (f.orig.replace(/\/+$/, '').split('/').pop() || f.orig)) : null,
                React.createElement('span', { className: 'gp-spacer' }),
                React.createElement('span', { className: 'gp-row-actions' },
                  React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardFile'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); discard([f.path], group) } }, icon('discard')),
                  isStaged
                    ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstage([f.path]) } }, icon('minus'))
                    : React.createElement('button', { className: 'gp-icon-btn', title: tr('stage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stage([f.path]) } }, icon('plus'))),
                React.createElement('span', { className: 'gp-file-badge ' + gl.cls }, gl.g))
            }))
        }

        const head = React.createElement('div', { className: 'gp-repo-head', onClick: () => setCollapsed((c) => !c) },
          React.createElement('button', { className: 'gp-btn-icon', onClick: (e) => { e.stopPropagation(); setCollapsed((c) => !c) } }, icon(isCollapsed ? 'chevronRight' : 'chevronDown')),
          React.createElement('span', { className: 'gp-repo-name', title: repo.path }, repo.name),
          data ? React.createElement('span', { className: 'gp-branch' }, icon('branch', 12), data.branch) : null,
          data && data.aheadBehind ? React.createElement('span', { className: 'gp-count', title: fmt(tr('behindAhead'), { b: data.aheadBehind.behind, a: data.aheadBehind.ahead }) }, icon('arrowDown', 12), data.aheadBehind.behind, ' ', icon('arrowUp', 12), data.aheadBehind.ahead) : null,
          data && totalStaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-staged', title: fmt(tr('stagedNTitle'), { n: totalStaged }) }, icon('dot', 7), totalStaged) : null,
          data && totalUnstaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-unstaged', title: fmt(tr('unstagedNTitle'), { n: totalUnstaged }) }, icon('dot', 7), totalUnstaged) : null,
          data && totalUntracked > 0 ? React.createElement('span', { className: 'gp-count gp-count-untracked', title: fmt(tr('untrackedNTitle'), { n: totalUntracked }) }, icon('dot', 7), totalUntracked) : null,
          React.createElement('span', { className: 'gp-spacer' }),
          /* 仓库级「刷新状态」按钮已移除：状态刷新统一由顶部「重新扫描」（全量）+ 自动轮询（定向）触发；
             加载期间在原位置放一个等宽 spinner 占位，保留加载反馈且不抖动布局 */
          status.loading ? React.createElement('span', { className: 'gp-btn-icon', style: { cursor: 'default' } }, React.createElement('span', { className: 'gp-spinner' })) : null,
          React.createElement('button', { className: 'gp-btn-icon', title: tr('pullTitle'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, busy === 'pull' ? React.createElement('span', { className: 'gp-spinner' }) : icon('pull')),
          React.createElement('div', { className: 'gp-menu-wrap' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('switchBranch'), onClick: (e) => { e.stopPropagation(); openBranchMenu() } }, icon('branch')),
            branchMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
              branchMenu.loading ? React.createElement('div', { className: 'gp-menu-note' }, tr('loadingBranches')) : branchMenu.error ? React.createElement('div', { className: 'gp-menu-note' }, branchMenu.error) :
                React.createElement('div', null,
                  (branchMenu.data && branchMenu.data.branches ? branchMenu.data.branches : []).map((b) => React.createElement('button', { key: b.name, className: 'gp-menu-item', onClick: () => { setBranchMenu((x) => ({ ...x, open: false })); if (!b.current) runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: b.name, create: false, sessionId })) } },
                    React.createElement('span', { style: { width: 14, display: 'inline-flex', justifyContent: 'center' } }, b.current ? icon('check', 12) : null),
                    b.name + (b.upstream ? '  → ' + b.upstream : ''))),
                  React.createElement('div', { className: 'gp-menu-sep' }),
                  branchMenu.creating ? React.createElement('div', { className: 'gp-menu-note' },
                    React.createElement('input', { className: 'gp-menu-input', autoFocus: true, value: branchMenu.newName, placeholder: tr('newBranchName'), onChange: (e) => setBranchMenu((x) => ({ ...x, newName: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter' && branchMenu.newName.trim()) { setBranchMenu((x) => ({ ...x, open: false, creating: false })); runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: branchMenu.newName.trim(), create: true, sessionId })) } } }),
                    React.createElement('button', { className: 'gp-btn', style: { marginTop: 4 }, onClick: () => { const nm = branchMenu.newName.trim(); setBranchMenu((x) => ({ ...x, open: false, creating: false })); if (nm) runWrite('switch', () => callRpc('switchBranch', { repoId: repo.id, branch: nm, create: true, sessionId })) } }, tr('createAndSwitch'))) :
                    React.createElement('button', { className: 'gp-menu-item', onClick: () => setBranchMenu((x) => ({ ...x, creating: true, newName: '' })) }, icon('plus', 12), tr('newBranch')))
            ) : null),
          React.createElement('div', { className: 'gp-menu-wrap' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('moreActions'), onClick: (e) => { e.stopPropagation(); openMoreMenu() } }, icon('ellipsis')),
            moreMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
              React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, tr('morePull')),
              React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('push', () => callRpc('push', { repoId: repo.id, sessionId })) } }, tr('morePush')),
              React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash', () => callRpc('stashPush', { repoId: repo.id, message: 'stash @ ' + new Date().toLocaleString(), sessionId })) } }, tr('moreStash')),
              React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash-pop', () => callRpc('stashPop', { repoId: repo.id, ref: null, sessionId })) } }, tr('moreStashPop'))
            ) : null),
          (branchMenu.open || moreMenu.open) ? React.createElement('div', { className: 'gp-menu-backdrop', onClick: (e) => { e.stopPropagation(); closeAllMenus() } }) : null)

        const body = isCollapsed ? null :
          React.createElement('div', null,
            status.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingStatus')) : status.error ? React.createElement('div', { className: 'gp-empty' }, status.error) :
              React.createElement('div', null,
                React.createElement(CommitArea, { repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus: loadStatus }),
                data && data.statusError ? React.createElement('div', { className: 'gp-empty gp-danger' }, fmt(tr('gitStatusFailed'), { e: data.statusError })) : null,
                !(data && data.statusError) && totalStaged + totalUnstaged + totalUntracked === 0 ? React.createElement('div', { className: 'gp-empty', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, icon('check', 13), tr('treeClean')) : null,
                renderGroup('staged', data && data.staged),
                renderGroup('unstaged', data && data.unstaged),
                renderGroup('untracked', data && data.untracked)),
            React.createElement('div', { className: 'gp-history-head', onClick: () => setHistoryOpen((o) => !o) },
              icon(historyOpen ? 'chevronDown' : 'chevronRight', 12),
              icon('history'),
              tr('history')),
            historyOpen ? React.createElement(GitGraphView, { repo }) : null)

        return React.createElement('div', { className: 'gp-repo-card' }, head, body)
      }

      function workspaceOfSession(st, sessionId) {
        if (!st || !Array.isArray(st.items)) return null
        const items = st.items
        let w = null
        if (sessionId) w = items.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.indexOf(sessionId) >= 0) || null
        if (!w && st.recentWorkspaceId) w = items.find((x) => x.workspaceId === st.recentWorkspaceId) || null
        return w
      }

      function GitPanelMain({ useSessions, useWorkspaces }) {
        const s = useStore()
        const sessionId = typeof useSessions === 'function' ? useSessions((st) => (st && st.current) || undefined) : undefined
        const wsPath = typeof useWorkspaces === 'function' ? useWorkspaces((st) => { const w = workspaceOfSession(st, sessionId); return w && w.path ? w.path : '' }) : ''
        const wsTitle = typeof useWorkspaces === 'function' ? useWorkspaces((st) => { const w = workspaceOfSession(st, sessionId); return w && w.title ? w.title : '' }) : ''
        const [scan, setScan] = React.useState({ state: 'idle', root: '', repos: [], error: '' })
        const [diffSel, setDiffSel] = React.useState(null)
        const [follow, setFollow] = React.useState(true)
        const [resizing, setResizing] = React.useState(false)
        const initialDoneRef = React.useRef(false)
        const resizeRef = React.useRef(false)
        // 扫描请求序列号：丢弃过期响应，防止「初始无 root 的慢扫描」晚到覆盖
        // 「跟随 workspace 的快扫描」的成功结果（竞态会让面板显示错误的空列表）
        const scanSeqRef = React.useRef(0)

        const doScan = React.useCallback(async (root) => {
          const seq = ++scanSeqRef.current
          setScan((x) => ({ ...x, state: 'scanning', error: '' }))
          try {
            const res = await callRpc('scan', root ? { root } : {})
            if (seq !== scanSeqRef.current) return
            if (res && res.ok) {
              setScan({ state: 'done', root: res.root, repos: res.repos || [], error: '' })
              // 扫描完成后联动刷新所有仓库状态（VS Code SCM Refresh 语义：重扫 + 全量状态刷新）。
              // 复用 refreshTick 定向刷新机制：lastOpRepoId = null 表示全量，已挂载的 RepoCard
              // 各自重新 loadStatus（仓库 id 不变时卡片不重挂载，必须靠这里触发，否则看到旧状态）。
              store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'rescan', lastOpRepoId: null }))
            }
            else setScan((x) => ({ ...x, state: 'error', error: (res && res.error) || tr('scanFailed') }))
          } catch (e) {
            if (seq !== scanSeqRef.current) return
            setScan((x) => ({ ...x, state: 'error', error: e && e.message ? e.message : String(e) }))
          }
        }, [])

        React.useEffect(() => {
          if (follow) {
            if (wsPath && wsPath !== scan.root) doScan(wsPath)
            else if (!wsPath && !initialDoneRef.current) { initialDoneRef.current = true; doScan(null) }
          } else if (!initialDoneRef.current) { initialDoneRef.current = true; doScan(null) }
        }, [follow, wsPath, scan.root, doScan])

        React.useEffect(() => {
          // 面板挂载时重新同步 DSH 语言：apply 阶段 locale 服务可能尚未就绪，
          // 导致初始 lang 固定为 zh、且后续切换事件也没订阅上。
          // 优先用 LocaleFace 标准订阅（subscribe），退化到 locale/change 事件。
          const svc = ctx.get('locale')
          if (!svc || typeof svc.getLocale !== 'function') return
          const sync = () => { try { applyLocale(svc.getLocale().active) } catch (e) { /* ignore */ } }
          sync()
          if (typeof svc.subscribe === 'function') return svc.subscribe(sync)
          return ctx.on('locale/change', (snap) => { if (snap) applyLocale(snap.active) })
        }, [])

        // 自动刷新：外部（当前对话框修改代码、编辑器保存、其他工具改动等）导致工作区
        // 变化时自动刷新仓库状态。轮询 status 并比对指纹（branch/ahead/staged/unstaged/
        // untracked），有变化则触发对应仓库的定向刷新（bump refreshTick）。
        const autoFpRef = React.useRef({})
        React.useEffect(() => {
          if (!s.panelOpen) return
          // 统一走 timer 服务（动态包沙箱禁用原生 setInterval），链式调度代替轮询定时器
          let stopped = false
          let cancel = null
          const tick = async () => {
            if (stopped) return
            try {
              const list = scan.repos || []
              for (const r of list) {
                const res = await callRpc('status', { repoId: r.id }).catch(() => null)
                if (!res || !res.ok) continue
                const fp = [res.branch, res.aheadBehind, res.staged, res.unstaged, res.untracked]
                  .map((x) => (Array.isArray(x) ? x.map((f) => ((f && f.path) || '') + ((f && f.orig) || '')).join('\u0000') : x === null ? 'null' : x && typeof x === 'object' ? JSON.stringify(x) : String(x)))
                  .join('\u001f')
                const prev = autoFpRef.current[r.id]
                if (prev !== undefined && prev !== fp) {
                  store.set((st) => ({ ...st, refreshTick: st.refreshTick + 1, lastOp: 'external', lastOpRepoId: r.id }))
                }
                autoFpRef.current[r.id] = fp
              }
            } catch (e) { /* ignore */ }
            if (!stopped) cancel = timer.timeout(tick, 4000)
          }
          cancel = timer.timeout(tick, 4000)
          return () => { stopped = true; if (cancel) cancel() }
        }, [s.panelOpen, scan.repos])

        // 面板左缘拖拽调宽：pointer 事件挂在 window 上，松手时持久化到 localStorage
        React.useEffect(() => {
          const onMove = (e) => {
            if (!resizeRef.current) return
            const w = Math.min(Math.round(window.innerWidth * 0.96), Math.max(380, Math.round(window.innerWidth - e.clientX)))
            store.set((st) => (st.panelW === w ? st : { ...st, panelW: w }))
          }
          const onUp = () => {
            if (!resizeRef.current) return
            resizeRef.current = false
            setResizing(false)
            savePanelW(store.get().panelW)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
        }, [])

        if (!s.panelOpen) return null
        const diffRepo = diffSel ? scan.repos.find((r) => r.id === diffSel.repoId) : null
        // diff 打开时在用户宽度基础上自动加宽（不超过视口 96%）
        const effW = diffSel && diffRepo
          ? Math.min(Math.round(window.innerWidth * 0.96), Math.max(860, s.panelW + 470))
          : s.panelW

        const header = React.createElement('div', { className: 'gp-header' },
          React.createElement('span', { className: 'gp-title' }, icon('branch', 15), 'Git Panel'),
          follow ? React.createElement('span', { className: 'gp-chip gp-follow-chip', title: tr('followTitle') }, fmt(tr('followChip'), { s: wsTitle || (wsPath ? wsPath.split(/[\\/]/).filter(Boolean).pop() : '—') })) : null,
          !follow && wsPath ? React.createElement('button', { className: 'gp-btn', style: { fontSize: 11, padding: '2px 8px' }, title: tr('followResumeTitle'), onClick: () => { setFollow(true); doScan(wsPath) } }, tr('followResume')) : null,
          scan.root ? React.createElement('span', { className: 'gp-root', title: scan.root }, scan.root) : null,
          React.createElement('div', { className: 'gp-header-actions' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('rescan'), onClick: () => doScan(follow ? (wsPath || scan.root) : scan.root) }, icon('refresh')),
            React.createElement('button', { className: 'gp-btn-icon', title: tr('pickRoot'), onClick: async () => { if (workspaces && workspaces.pickDirectory) { const p = await workspaces.pickDirectory().catch(() => null); if (p) { setFollow(false); doScan(p) } } } }, icon('folder')),
            React.createElement('button', { className: 'gp-btn-icon', title: tr('close'), onClick: () => store.set((st) => ({ ...st, panelOpen: false })) }, icon('close'))))

        const body = React.createElement('div', { className: 'gp-body' },
          scan.state === 'scanning' || scan.state === 'idle' ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), scan.state === 'idle' ? ' ' + tr('locating') : ' ' + tr('scanning')) :
            scan.state === 'error' ? React.createElement('div', { className: 'gp-empty' }, scan.error) :
              scan.repos.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('noRepos')) :
                scan.repos.map((r) => React.createElement(RepoCard, { key: r.id, repo: r, sessionId, onOpenDiff: (repo, path, group) => setDiffSel({ repoId: repo.id, path, group }) })))

        return React.createElement('div', { className: 'gp-panel', style: { width: effW + 'px' } },
          React.createElement('div', {
            className: 'gp-resize' + (resizing ? ' gp-resize-active' : ''),
            title: tr('resizeTitle'),
            onPointerDown: (e) => { e.preventDefault(); resizeRef.current = true; setResizing(true) }
          }),
          header,
          React.createElement('div', { className: 'gp-main' },
            body,
            diffSel && diffRepo ? React.createElement(DiffPane, { repo: diffRepo, path: diffSel.path, group: diffSel.group, onClose: () => setDiffSel(null) }) : null))
      }

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
          const s = useStore()
          const wide = props && props.wide
          return React.createElement('button', { className: 'gp-sidebar-toggle', title: tr('toggleTitle'), onClick: () => { const st0 = store.get(); store.set((st) => ({ ...st, panelOpen: !st0.panelOpen })) } },
            icon('branch', 16),
            wide ? React.createElement('span', null, 'Git Panel') : null)
        }
      ))

      console.log('[git-panel] Client 已就绪')
    }
  }
}
