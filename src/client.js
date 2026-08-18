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
 *     为不可逆操作：单文件 / 整组 / 多选批量统一先弹确认框（含文件数与预览），确认后执行（留审计）；
 *     行内操作按钮（放弃/暂存/取消暂存）悬停时图标不变色，周围垫一块更深的方形底色（VS Code 工具栏 hover 风格）；
 *   - 提交区位于仓库卡片顶部（message 输入框在上，变更列表在下）；
 *   - 历史区加大：行高 26 / 字号 13 / 高度 470，节点更大更清晰；
 *     图谱按 lane 循环配色、合并线为圆角肘形曲线，提交详情改为行悬停浮层（VS Code hover 风格）；
 *   - 点击文件从面板左缘滑出浮层 diff 抽屉（覆盖在聊天区上方，文件列表保持可见可
 *     直接切换文件）：双列行号、整行柔和红绿底色、sticky 分段头、+增/−删 统计徽标、
 *     恒定自动换行（单栏/分栏一致，GitHub 式，无横向滚动）；左右分栏（split）模式：
 *     左源文件/右修改后，配对修改行带 word 级中段高亮（公共前后缀裁剪），模式记忆在
 *     localStorage（gp-diff-split）；抽屉左缘可拖拽调宽（记忆在 localStorage），Esc / 点遮罩关闭；
 *     开/关抽屉均为滑入/滑出动效（transition + 双 rAF 入场，避免首帧闪现完整面板）；
 *     被点击的文件行保持 VS Code 式选中盒（1px 品牌色边框 + 浅品牌底），再次点击同一行 = 取消选中并关闭抽屉；
 *   - 文件行支持 VS Code 式多选：Ctrl/⌘+点击增删、Shift+点击按可见顺序范围选择（按仓库隔离，
 *     修饰键点击不切换 diff），选中行同样带选中盒；多选后点击任一选中行的 放弃/暂存/取消暂存
 *     按钮即作用于全部选中文件（放弃仍弹确认），点击未选中行的按钮仅作用于该行；
 *     操作成功或文件移组后自动剪掉失效的选中项；
 *   - 面板左缘可拖拽调整整体宽度，宽度记忆在 localStorage；
 *   - 点击标题折叠为右侧 44px 竖条、点击竖条展开：面板与竖条交叉滑入/滑出
 *     （translateX 纯位移 + 双 rAF 入场，与 diff 抽屉同 240ms/曲线，动效播完才切换形态）。
 *
 * 组件映射（原 TSX 设计 → 本实现）：
 *   GitPanel.tsx        → GitPanelMain（主面板 + 扫描 + 工作空间跟随 + 拖拽调宽）
 *   RepoCard.tsx        → RepoCard（仓库卡片 + 分支/更多菜单 + 变更分组 + 暂存操作）
 *   CommitArea.tsx      → CommitArea（提交输入 + 生成 + 规则 + 提交/提交并推送，仅处理 staged）
 *   CommitRuleEditor.tsx→ RuleEditorModal（system_prompt / user_context 双编辑框（键名固定防误删）+ 实时预览 + 顶部 全局/仓库 双 checkbox 互斥切换）
 *   GitGraph.tsx        → GitGraphView（SVG 图谱：lane 配色/圆角合并线 + 悬停详情浮层）
 *   DiffPreview.tsx     → DiffDrawer（面板左缘滑出的浮层 diff 查看器）
 *
 * Slot 注入：
 *   sidebar.footer.action  → git-panel-toggle（侧栏底部开关按钮）
 *   shell.overlay          → git-panel（右浮面板）、git-panel-toasts（通知）
 *
 * 交互约定：
 *   - 下拉菜单（分支/更多/规则）带全局透明遮罩，点击任何外部区域自动关闭；
 *   - 文件行/diff 抽屉头部显示「文件名 + 目录」，空间不足时目录先收缩（省略号在左侧、
 *     保住最深层目录），文件名仅自身超长才封顶省略；悬停 title 显示完整路径；
 *   - 写操作（commit/pull/push/switch/stash/reset/clean）直接执行（无审批/确认，类似 VS Code）。
 *
 * 依赖的 Client 服务（ctx.get 可选读取）：slots / timer / workspaces(openPath)
 */
export default function () {
  return {
    apply(ctx) {
      const slots = ctx.get('slots')
      // workspaces 已声明进 bundle 的 exports.inject（见 scripts/build.mjs），cordis 会等
      // 该服务激活后才执行本 apply，因此此处必非空；守卫仅兜底动态包形态/异常时序。
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
/* ===== 面板统一边框色 =====
   主题边框透明度太低（亮 4%/10%，暗 6%/12%），分割线肉眼难辨。面板内自定义两级：
   --gp-border-1 结构性分隔线/容器描边（标题栏、仓库卡片、提交区、历史、diff 等）
   --gp-border-2 控件描边（按钮、输入框、徽章 pill、弹层外框、悬停描边）
   调整观感只需改这两处取值。 */
:root { --gp-border-1: rgba(0, 0, 0, .12); --gp-border-2: rgba(0, 0, 0, .20); }
body[data-ds-dark-theme] { --gp-border-1: rgba(255, 255, 255, .15); --gp-border-2: rgba(255, 255, 255, .26); }
/* ===== 弹层底色 =====
   宿主 --dsw-alias-bg-overlay 在深色模式下偏浅，浮在深色内容上发灰。弹层统一走
   --gp-pop-bg（覆盖 .gp-menu / .gp-cd-pop / .gp-toast）：亮色原样跟随主题，
   深色用 color-mix 向黑压（宿主深色 token 实测 ≈ #61656A，偏浅），色调仍随主题。
   观感深浅改下方取值即可。 */
:root { --gp-pop-bg: var(--dsw-alias-bg-overlay); }
body[data-ds-dark-theme] { --gp-pop-bg: color-mix(in srgb, var(--dsw-alias-bg-overlay) 40%, #000); }
.gp-panel, .gp-panel * { box-sizing: border-box; }
/* UI 控件禁用文本选择（双击/拖动扩选在列表行上很丑，对齐 VS Code 列表行为）：
   面板 / diff 抽屉 / 弹窗 / 通知整体 none；例外恢复 text —— diff 代码区（复制代码）、
   提交详情浮层（复制 hash/message）、输入框（编辑文本）。完整路径悬停 title 仍可见。 */
.gp-panel, .gp-diff-drawer, .gp-modal, .gp-toast { user-select: none; }
.gp-diff-body, .gp-cd-pop, .gp-panel input, .gp-panel textarea, .gp-modal input, .gp-modal textarea { user-select: text; }
.gp-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 520px; max-width: 96vw; background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--gp-border-1); display: flex; flex-direction: column; pointer-events: auto; z-index: 60; font-size: 14px; color: var(--dsw-alias-label-primary); box-shadow: -12px 0 32px rgba(0,0,0,.18); font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; transition: width .18s ease, transform .22s cubic-bezier(.2,.8,.2,1); }
/* 拖拽调宽期间关掉 width 过渡，避免跟手延迟；折叠/展开时播放滑入/滑出动效（与 diff 抽屉同时长/曲线） */
.gp-noanim { transition: none !important; }
.gp-resize { position: absolute; top: 0; left: -2px; bottom: 0; width: 5px; cursor: ew-resize; z-index: 80; }
.gp-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; transform: translateX(-50%); background: var(--dsw-alias-brand-primary); opacity: 0; transition: opacity .15s; }
.gp-resize:hover::after { opacity: .35; }
.gp-resize-active::after, .gp-resize-active:hover::after { opacity: .6; }
.gp-header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--gp-border-1); background: var(--dsw-specific-sidebar-fill); flex: 0 0 auto; }
.gp-title { font-weight: 600; font-size: 14px; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; overflow: hidden; }
/* 标题（logo + 文字）整体是可点按钮：点击折叠到侧栏。负 margin 抵消内边距，保持原排版不变。
   悬停不做任何高亮/阴影（保持标题栏静态观感），仅保留 pointer 手型提示可点；也不挂 title 气泡。 */
.gp-title-btn { border: none; background: transparent; color: inherit; font-family: inherit; padding: 2px 6px; margin: -2px -6px; border-radius: 5px; cursor: pointer; }
/* 折叠态：右侧 44px 竖条，整条可点击展开；只露 logo 图标 + 竖排文字；
   折叠/展开时与面板交叉滑入/滑出（translateX 纯位移，类 diff 抽屉动效） */
.gp-rail { position: fixed; top: 0; right: 0; bottom: 0; width: 44px; box-sizing: border-box; background: var(--dsw-specific-sidebar-fill); border: none; border-left: 1px solid var(--gp-border-1); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 11px 0; cursor: pointer; z-index: 60; color: var(--dsw-alias-label-primary); font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; box-shadow: -6px 0 16px rgba(0,0,0,.10); transition: transform .22s cubic-bezier(.2,.8,.2,1); }
.gp-rail:hover { background: var(--dsw-alias-bg-layer-2); }
.gp-rail-label { writing-mode: vertical-rl; font-size: 12px; font-weight: 600; letter-spacing: 2px; color: var(--dsw-alias-label-secondary); user-select: none; }
.gp-rail:hover .gp-rail-label { color: var(--dsw-alias-label-primary); }
/* 工作空间名：永远跟随当前工作空间，纯展示（无跟随/手动模式之分），完整路径在悬停 title。
   flex:1 占满标题与操作按钮之间的自由空间并居中文字；两侧宽度接近，视觉上即相对标题栏居中 */
.gp-ws-name { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; text-align: center; }
.gp-header-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.gp-chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--gp-border-2); color: var(--dsw-alias-label-secondary); white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.gp-main { flex: 1; min-height: 0; display: flex; }
.gp-body { flex: 1; min-width: 0; overflow-y: auto; padding: 6px 8px; }
.gp-empty { padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.gp-scanning { padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; }
.gp-btn { background: transparent; border: 1px solid var(--gp-border-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 11px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
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
.gp-repo-card { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--gp-border-1); border-radius: 8px; margin-bottom: 8px; }
.gp-repo-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; }
.gp-repo-name { font-weight: 600; color: var(--dsw-alias-brand-primary); font-size: 14px; cursor: default; }
.gp-branch { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--gp-border-2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-count { font-size: 12px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.gp-count-staged { color: var(--dsw-alias-state-success-primary); }
.gp-count-unstaged { color: var(--dsw-alias-state-warn-primary); }
.gp-count-untracked { color: var(--dsw-alias-brand-primary); }
.gp-spacer { flex: 1; }
.gp-menu-wrap { position: relative; }
.gp-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--gp-pop-bg); border: 1px solid var(--gp-border-2); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.25); z-index: 120; min-width: 250px; padding: 4px; }
.gp-menu-backdrop { position: fixed; inset: 0; z-index: 110; background: transparent; }
.gp-menu-item { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; background: none; border: none; color: var(--dsw-alias-label-primary); padding: 7px 10px; border-radius: 5px; font-size: 13px; cursor: pointer; }
.gp-menu-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.gp-menu-item:disabled { opacity: .5; cursor: default; }
.gp-menu-sep { height: 1px; background: var(--gp-border-1); margin: 4px 6px; }
.gp-menu-note { padding: 6px 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.gp-menu-input { margin: 4px 6px; padding: 5px 8px; font-size: 13px; border: 1px solid var(--gp-border-2); border-radius: 5px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); width: calc(100% - 12px); }
.gp-section { padding: 2px 2px 4px; }
.gp-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #000000; padding: 6px 4px 3px; display: flex; gap: 6px; align-items: center; cursor: pointer; user-select: none; border-radius: 4px; position: relative; transition: background-color .1s ease, box-shadow .12s ease; }
body[data-ds-dark-theme] .gp-section-title { color: #ffffff; }
/* 悬停浮起（类 VS Code 树列表 hover）：背景高亮 + 细描边 + 柔和投影 */
.gp-section-title:hover { background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 3px rgba(0,0,0,.10), 0 3px 10px rgba(0,0,0,.07), inset 0 0 0 1px var(--gp-border-2); }
body[data-ds-dark-theme] .gp-section-title:hover { box-shadow: 0 1px 4px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.35), inset 0 0 0 1px var(--gp-border-2); }
.gp-section-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-chev { border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 0; width: 16px; height: 16px; border-radius: 3px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.gp-chev:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-group-count { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: 0 0 auto; min-width: 14px; text-align: center; }
/* 组标题行操作按钮用 visibility 占位（收起/展开按钮、放弃、暂存/取消暂存、计数都不跳动） */
.gp-section-title .gp-row-actions { visibility: hidden; }
.gp-section-title:hover .gp-row-actions { visibility: visible; }
.gp-file-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 14px; border-radius: 4px; cursor: pointer; min-height: 22px; position: relative; transition: background-color .1s ease, box-shadow .12s ease; }
/* 悬停浮起（类 VS Code 树列表 hover）：背景高亮 + 细描边 + 柔和投影 */
.gp-file-row:hover { background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 3px rgba(0,0,0,.10), 0 3px 10px rgba(0,0,0,.07), inset 0 0 0 1px var(--gp-border-2); }
body[data-ds-dark-theme] .gp-file-row:hover { box-shadow: 0 1px 4px rgba(0,0,0,.5), 0 3px 12px rgba(0,0,0,.35), inset 0 0 0 1px var(--gp-border-2); }
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
/* 与抽屉头部同策略：文件名不先收缩（超长才被 max-width 封顶），目录独自让路；
   direction:rtl 让目录省略号落左侧，保留最深层目录（…lib/components）。 */
.gp-file-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto; max-width: 58%; color: #333333; }
body[data-ds-dark-theme] .gp-file-name { color: #e6e6e6; }
.gp-file-dir { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; direction: rtl; text-align: left; }
.gp-file-orig { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ===== 多选（Ctrl/Shift）与激活（diff 打开）行高亮：VS Code 式选中盒 =====
   1px 品牌色边框（box-shadow inset 实现，不占布局）+ 浅品牌底色，视觉明确且悬停不闪；
   置于 .gp-file-row:hover 规则之后：等特异性下后者胜出。 */
.gp-file-row.gp-file-sel, .gp-file-row.gp-file-active { background: var(--dsw-alias-interactive-bg-hover); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
/* 危险操作按钮（放弃更改确认） */
.gp-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: #ffffff; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
.gp-btn-danger:hover:not(:disabled) { filter: brightness(1.12); }
/* 放弃更改确认弹窗：不可恢复提示 + 文件预览列表 */
.gp-confirm-note { margin-top: 8px; font-size: 12.5px; }
.gp-confirm-files { margin-top: 8px; max-height: 150px; overflow-y: auto; border: 1px solid var(--gp-border-1); border-radius: 6px; padding: 6px 9px; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-all; }
.gp-commit-area { padding: 9px 10px 10px; border-bottom: 1px solid var(--gp-border-1); background: var(--dsw-alias-bg-layer-1); }
.gp-textarea { width: 100%; resize: none; border: 1px solid var(--gp-border-2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding: 7px 9px; font-size: 13px; line-height: 1.5; font-family: inherit; min-height: 58px; max-height: 138px; }
.gp-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gp-commit-row { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; gap: 8px; }
.gp-left-group { display: flex; gap: 6px; align-items: center; }
.gp-commit-actions { display: flex; gap: 6px; margin-top: 8px; }
.gp-commit-actions .gp-btn { flex: 1; padding: 6px 12px; font-weight: 600; }
.gp-staged-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-history-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; border-top: 1px solid var(--gp-border-1); font-size: 13px; color: var(--dsw-alias-label-secondary); }
.gp-history-head:hover { color: var(--dsw-alias-label-primary); }
.gp-history-body { display: flex; padding: 6px 8px 10px; border-top: 1px solid var(--gp-border-1); height: 470px; }
.gp-graph-wrap { flex: 1 1 auto; min-width: 0; border: 1px solid var(--gp-border-1); border-radius: 6px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.gp-graph-scroll { position: relative; height: 100%; overflow-y: auto; overflow-x: hidden; }
.gp-grow { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; padding: 0 6px; cursor: pointer; border-left: 2px solid transparent; box-sizing: border-box; overflow: hidden; }
.gp-grow:hover { background: var(--dsw-alias-bg-layer-2); }
.gp-grow-sel { background: var(--dsw-alias-bg-layer-2); border-left-color: var(--dsw-alias-brand-primary); }
.gp-grow-subject { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.gp-grow-refs { display: inline-flex; gap: 3px; flex: 0 0 auto; max-width: 32%; overflow: hidden; }
.gp-grow-ref { font-size: 10.5px; line-height: 1.5; padding: 0 5px; border-radius: 7px; border: 1px solid var(--gp-border-2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.gp-grow-ref-cur { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.gp-grow-ref-tag { color: #d7a648; border-color: rgba(215, 166, 72, .5); }
.gp-grow-meta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; flex: 0 0 auto; }
.gp-grow-more { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
/* ===== 提交详情悬浮卡（VSCode 风格）：分段卡片，段间细线分隔 ===== */
.gp-cd-pop { position: fixed; z-index: 320; width: 480px; max-width: 86vw; max-height: 50vh; overflow-y: auto; background: var(--gp-pop-bg); border: 1px solid var(--gp-border-2); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font-size: 13px; color: var(--dsw-alias-label-primary); pointer-events: auto; }
.gp-cd-sec { padding: 8px 12px; }
/* 段间细线分隔；作者行与 message 之间不划线、只留空白间隔 */
.gp-cd-sec + .gp-cd-sec { border-top: 1px solid var(--gp-border-1); }
.gp-cd-head { display: flex; align-items: center; gap: 7px; padding-bottom: 6px; }
.gp-cd-head + .gp-cd-sec { border-top: none; padding-top: 10px; }
.gp-cd-person { flex: 0 0 auto; display: flex; color: var(--dsw-alias-label-tertiary); }
.gp-cd-author { font-weight: 600; }
.gp-cd-date { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
/* message：全文统一字号字重，保留空行与换行；'- ' 列表行渲染为圆点（markdown-lite） */
.gp-cd-msg { font-size: 12.5px; line-height: 1.55; }
.gp-cd-line { white-space: pre-wrap; word-break: break-word; }
.gp-cd-blank { height: 9px; }
.gp-cd-li { display: flex; gap: 6px; }
.gp-cd-bullet { flex: 0 0 auto; color: var(--dsw-alias-brand-primary); }
.gp-cd-li-text { flex: 1 1 auto; min-width: 0; white-space: pre-wrap; word-break: break-word; }
.gp-cd-sum { font-size: 12px; color: var(--dsw-alias-label-secondary); }
/* 绿/红掺入约 22% 文字色降饱和（深浅主题自适应），字重 600 避免小字高饱和加粗过艳 */
.gp-cd-add { color: var(--dsw-alias-state-success-primary); color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 78%, var(--dsw-alias-label-primary)); font-weight: 600; }
.gp-cd-del { color: var(--dsw-alias-state-error-primary); color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, var(--dsw-alias-label-primary)); font-weight: 600; }
.gp-cd-refs { display: flex; flex-wrap: wrap; gap: 4px; }
.gp-cd-ref { font-size: 10.5px; line-height: 1.6; padding: 0 6px; border-radius: 7px; border: 1px solid; white-space: nowrap; }
.gp-cd-ref-cur, .gp-cd-ref-local { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); background: var(--dsw-alias-bg-layer-2); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.gp-cd-ref-cur { font-weight: 600; }
/* 远程分支：紫（与品牌蓝、琥珀 tag、绿/红统计数字都拉开）；暗色主题提亮 */
.gp-cd-ref-remote { color: #6f42c1; border-color: rgba(111,66,193,.45); background: rgba(111,66,193,.08); }
body[data-ds-dark-theme] .gp-cd-ref-remote { color: #c4b5fd; border-color: rgba(196,181,253,.5); background: rgba(196,181,253,.12); }
.gp-cd-ref-tag { color: var(--dsw-alias-state-warn-primary); border-color: rgba(215,166,72,.5); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, transparent); background: rgba(215,166,72,.10); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.gp-cd-hashrow { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
/* ===== Diff 查看器：从面板左缘滑出的浮层抽屉（z 层级低于面板菜单/模态/通知） ===== */
.gp-diff-backdrop { position: fixed; top: 0; bottom: 0; left: 0; background: rgba(0,0,0,.22); z-index: 54; pointer-events: auto; transition: opacity .22s cubic-bezier(.2,.8,.2,1); }
/* 面板不带头影：深度感由整块遮罩提供（遮罩延伸到面板下方，面板滑入盖住它）。
   入场/关闭均为纯位移：translateX(100%) 时面板整体藏在不透明的 Git Panel（z-60）
   正后方，无边影/透明度爬升，任何像素都不会在滑动开始前显形。 */
.gp-diff-drawer { position: fixed; top: 0; bottom: 0; background: var(--dsw-alias-bg-layer-1); border-left: 1px solid var(--gp-border-1); display: flex; flex-direction: column; z-index: 56; pointer-events: auto; transition: transform .22s cubic-bezier(.2,.8,.2,1); font-size: 13px; color: var(--dsw-alias-label-primary); }
.gp-diff-resize { position: absolute; top: 0; left: -2px; bottom: 0; width: 6px; cursor: ew-resize; z-index: 5; }
.gp-diff-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; transform: translateX(-50%); background: var(--dsw-alias-brand-primary); opacity: 0; transition: opacity .15s; }
.gp-diff-resize:hover::after { opacity: .35; }
.gp-diff-resize-active::after, .gp-diff-resize-active:hover::after { opacity: .6; }
.gp-diff-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--gp-border-1); background: var(--dsw-specific-sidebar-fill); flex: 0 0 auto; }
.gp-diff-glyph { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'Cascadia Mono', Consolas, monospace; }
.gp-diff-glyph.gp-g-added { color: var(--dsw-alias-state-success-primary); background: rgba(46,160,67,.16); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); }
.gp-diff-glyph.gp-g-modified { color: var(--dsw-alias-state-warn-primary); background: rgba(215,166,72,.16); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
.gp-diff-glyph.gp-g-deleted { color: var(--dsw-alias-state-error-primary); background: rgba(248,81,73,.14); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
/* 标题框 flex:1 1 auto 吃掉头部全部剩余空间（旧版 flex:0 1 auto 内容定宽，配合文件名
   max-width:60% 形成自参考封顶：目录越短标题框越窄，文件名被压到很小就省略，
   头部明明很宽也被截断）。 */
.gp-diff-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex: 1 1 auto; }
/* 收缩优先级：目录 flex:0 1 auto + min-width:0 先让路（direction:rtl 省略号落左侧，
   保住最深层目录，可收缩至完全消失）；文件名 flex:0 0 auto 不主动收缩，仅标题框
   整体不够宽时才被 max-width:100% 封顶省略。悬停 title 看完整路径。 */
.gp-diff-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto; max-width: 100%; }
.gp-diff-dir { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; flex: 0 1 auto; min-width: 0; }
.gp-diff-stats { display: inline-flex; gap: 8px; flex: 0 0 auto; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
.gp-diff-stat-add { color: var(--dsw-alias-state-success-primary); font-weight: 700; }
.gp-diff-stat-del { color: var(--dsw-alias-state-error-primary); font-weight: 700; }
.gp-btn-icon.gp-on { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.gp-diff-body { flex: 1; min-height: 0; overflow: auto; position: relative; }
/* 表格容器：单栏/分栏均恒定自动换行（无横向滚动），width 100% 让行底色铺满视口宽 */
.gp-diff-table { width: 100%; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; line-height: 1.55; padding-bottom: 10px; }
.gp-diff-meta { padding: 7px 12px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; border-bottom: 1px dashed var(--gp-border-1); }
/* @@ 分段头：sticky 吸附在滚动容器顶，实底色盖住滚过的内容 */
.gp-diff-hrow { position: sticky; top: 0; z-index: 2; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); font-size: 12px; padding: 3px 12px; border-top: 1px solid var(--gp-border-1); border-bottom: 1px solid var(--gp-border-1); white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.gp-diff-row { display: flex; }
.gp-diff-row.gp-dr-ctx:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-diff-row.gp-dr-add { background: rgba(46,160,67,.12); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.gp-diff-row.gp-dr-add:hover { background: rgba(46,160,67,.18); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.gp-diff-row.gp-dr-del { background: rgba(248,81,73,.10); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.gp-diff-row.gp-dr-del:hover { background: rgba(248,81,73,.16); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); }
.gp-diff-ln { flex: 0 0 46px; padding: 0 7px; text-align: right; color: var(--dsw-alias-label-tertiary); user-select: none; border-right: 1px solid var(--gp-border-1); font-size: 11.5px; }
.gp-dr-add .gp-diff-ln { background: rgba(46,160,67,.10); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.gp-dr-del .gp-diff-ln { background: rgba(248,81,73,.08); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.gp-diff-code { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-all; padding: 0 12px 0 0; tab-size: 4; }
.gp-diff-sign { display: inline-block; width: 2ch; text-align: center; user-select: none; }
.gp-dr-add .gp-diff-sign { color: var(--dsw-alias-state-success-primary); font-weight: 700; }
.gp-dr-del .gp-diff-sign { color: var(--dsw-alias-state-error-primary); font-weight: 700; }
.gp-diff-row.gp-dr-note .gp-diff-code { color: var(--dsw-alias-label-tertiary); font-style: italic; }
.gp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 400; pointer-events: auto; }
.gp-modal { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--gp-border-2); border-radius: 10px; width: 1180px; max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.gp-modal-sm { width: 440px; }
.gp-genmodel-scroll { max-height: 42vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 2px; }
.gp-genmodel-group { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.gp-genmodel-group-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em; padding: 4px 8px 2px; }
.gp-genmodel-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 7px; background: none; border: none; color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; }
.gp-genmodel-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-genmodel-item.gp-genmodel-selected { background: var(--dsw-alias-brand-primary); color: #ffffff; }
.gp-genmodel-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.gp-genmodel-item.gp-genmodel-selected .gp-genmodel-meta { color: rgba(255,255,255,.78); }
.gp-genmodel-effort { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--gp-border-1); flex-wrap: wrap; }
.gp-genmodel-effort-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-right: 4px; }
.gp-modal-head { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--gp-border-1); font-weight: 600; font-size: 14px; }
.gp-modal-body { flex: 1; overflow: auto; padding: 12px 14px; }
.gp-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 1px solid var(--gp-border-1); }
.gp-rule-cols { display: flex; gap: 12px; height: min(660px, 60vh); }
.gp-rule-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gp-rule-col-title { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; letter-spacing: .3px; }
/* 规则编辑器：system_prompt / user_context 两个独立编辑框，键名固定展示、不可编辑，
   从根上避免误删 YAML 键；普通单层 textarea，无叠加层对齐问题；两框等宽等高（各占一半）。
   顶部 全局/仓库 两个互斥 checkbox：双缓冲保存两份内容，切换不丢未保存修改。 */
.gp-rule-fields { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.gp-rule-field { flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; }
.gp-rule-field-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-secondary); letter-spacing: .3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-rule-field-key { font-family: 'Cascadia Mono', Consolas, monospace; color: var(--dsw-alias-label-primary); }
.gp-rule-field-label { font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.gp-rule-input { flex: 1; min-height: 0; width: 100%; resize: none; border: 1px solid var(--gp-border-2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); padding: 8px 10px; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; line-height: 1.5; white-space: pre; overflow: auto; tab-size: 2; }
.gp-rule-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gp-rule-preview { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--gp-border-1); border-radius: 6px; padding: 10px; background: var(--dsw-alias-bg-layer-2); font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
.gp-rule-preview-title { font-weight: 700; color: var(--dsw-alias-brand-primary); margin: 8px 0 4px; }
.gp-rule-preview-title:first-child { margin-top: 0; }
.gp-toast-stack { position: fixed; right: 14px; bottom: 14px; z-index: 500; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.gp-toast { pointer-events: auto; padding: 10px 14px; border-radius: 7px; background: var(--gp-pop-bg); border: 1px solid var(--gp-border-2); border-left: 3px solid var(--dsw-alias-brand-primary); box-shadow: 0 8px 24px rgba(0,0,0,.3); font-size: 13.5px; max-width: 420px; word-break: break-word; color: var(--dsw-alias-label-primary); animation: gp-toast-in .18s ease-out; }
.gp-toast.gp-toast-exit { animation: gp-toast-out .24s ease-in forwards; }
@keyframes gp-toast-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
@keyframes gp-toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(28px); } }
.gp-toast-success { border-left-color: var(--dsw-alias-state-success-primary); }
.gp-toast-error { border-left-color: var(--dsw-alias-state-error-primary); }
.gp-rule-scope { display: flex; align-items: center; gap: 22px; margin-bottom: 4px; font-size: 13px; }
.gp-rule-scope label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.gp-rule-scope input { cursor: pointer; margin: 0; flex: none; align-self: center; }
.gp-rule-scope-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 0 0 10px; font-family: 'Cascadia Mono', Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-danger { color: var(--dsw-alias-state-error-primary); font-weight: 600; }
.gp-confirm-summary { margin: 6px 0 10px; font-size: 13.5px; display: flex; align-items: flex-start; gap: 6px; }
.gp-confirm-input { width: 100%; padding: 8px 9px; font-size: 13.5px; border: 1px solid var(--gp-border-2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-sidebar-toggle { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; padding: 5px 8px; border-radius: 6px; }
.gp-sidebar-toggle:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
/* ===== diff 抽屉：左右分栏（split）模式 =====
   每行 = 左半（旧行号+旧文本）| 1px 中缝 | 右半（新行号+新文本）；半行各自着色，
   修改对左红右绿、纯删右侧留空、纯增左侧留空。中缝 stretch 撑满行高。 */
.gp-diff-half { flex: 1 1 50%; min-width: 0; display: flex; align-items: stretch; }
.gp-diff-half .gp-diff-code { flex: 1 1 auto; padding-right: 6px; }
.gp-diff-mid { flex: 0 0 1px; align-self: stretch; background: var(--gp-border-1); }
.gp-diff-half.gp-dh-del { background: rgba(248,81,73,.10); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.gp-diff-half.gp-dh-del:hover { background: rgba(248,81,73,.16); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); }
.gp-diff-half.gp-dh-add { background: rgba(46,160,67,.12); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.gp-diff-half.gp-dh-add:hover { background: rgba(46,160,67,.18); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.gp-diff-half.gp-dh-del .gp-diff-ln { background: rgba(248,81,73,.08); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.gp-diff-half.gp-dh-add .gp-diff-ln { background: rgba(46,160,67,.10); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.gp-diff-half.gp-dh-del .gp-diff-sign { color: var(--dsw-alias-state-error-primary); font-weight: 700; }
.gp-diff-half.gp-dh-add .gp-diff-sign { color: var(--dsw-alias-state-success-primary); font-weight: 700; }
/* 配对修改行的行内 word 级变化高亮（公共前后缀之外的中段） */
.gp-diff-hl-del { background: rgba(248,81,73,.28); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent); border-radius: 2px; }
.gp-diff-hl-add { background: rgba(46,160,67,.30); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent); border-radius: 2px; }
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
        // 扁平小人（头 + 肩实心剪影，类 VSCode codicon account）
        person: { f: ['M8 8.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z', 'M3.2 13.5v-.9c0-2 2.1-3.2 4.8-3.2s4.8 1.2 4.8 3.2v.9z'] },
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
        discard: { f: ['M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z'] },
        // 分栏 diff（外框 + 中缝竖线）与单栏 diff（单个窄栏）：点击在两种视图间切换
        split: { p: ['M2.5 3.5h11v9h-11z', 'M8 3.5v9'] },
        unified: { p: ['M2.5 3.5h11v9h-11z', 'M4.7 6.2h6.6', 'M4.7 9h6.6'] }
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
        // 钳制到 loadPanelW 的接受区间 [380, 2400]，否则宽屏拖出的宽度重载后会被读取端丢弃
        try { window.localStorage.setItem('gp-panel-w', String(Math.min(2400, Math.max(380, w)))) } catch (e) { /* ignore */ }
      }
      function loadDiffW() {
        try {
          const v = parseInt(window.localStorage.getItem('gp-diff-w'), 10)
          if (v >= 380 && v <= 2400) return v
        } catch (e) { /* ignore */ }
        return 0
      }
      function saveDiffW(w) {
        // 同 savePanelW：钳制到 loadDiffW 接受的区间
        try { window.localStorage.setItem('gp-diff-w', String(Math.min(2400, Math.max(380, w)))) } catch (e) { /* ignore */ }
      }
      // 分栏 diff 偏好（gp-diff-split）：记忆上次的视图模式
      function loadSplit() {
        try { return window.localStorage.getItem('gp-diff-split') === '1' } catch (e) { return false }
      }
      function saveSplit(v) {
        try { window.localStorage.setItem('gp-diff-split', v ? '1' : '0') } catch (e) { /* ignore */ }
      }
      function loadCollapsed() {
        try { return window.localStorage.getItem('gp-collapsed') === '1' } catch (e) { return false }
      }
      function saveCollapsed(v) {
        try { window.localStorage.setItem('gp-collapsed', v ? '1' : '0') } catch (e) { /* ignore */ }
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
      const store = createStore({ panelOpen: false, toasts: [], refreshTick: 0, lastOp: null, lastOpRepoId: null, panelW: loadPanelW(), collapsed: loadCollapsed() })

      // ============ 国际化：跟随 DSH 语言设置（locale.preference）自动切换 中文 / English ============
      const localeSvc = ctx.get('locale')
      let lang = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale().active : 'zh'
      if (lang !== 'en') lang = 'zh'
      const TEXTS = {
        zh: {
          groupStaged: '暂存的更改', groupChanges: '更改', groupUntracked: '未跟踪的更改', history: '历史',
          rulesLoadFailed: '读取规则失败', reading: '(读取中…)', saved: '已保存', saveFailed: '保存失败', saveFailedWith: '保存失败: {e}',
          scopeSwitchFailed: '切换规则来源失败',
          validationNoSys: '校验失败: 缺少 system_prompt', validationNoUser: '校验失败: 缺少 user_context',
          restoredDefaults: '已恢复为内置默认内容（未保存）', globalRules: '全局规则', repoRules: '仓库专属规则', scopeSaveTo: '保存到: {p}', scopeNewFile: '（文件不存在，保存时创建）',
          rulesContent: '规则内容', sysPromptLabel: '系统提示词（必填）', userCtxLabel: '用户上下文（必填）',
          livePreview: '实时预览（最终注入 LLM 的 prompt）', userCtxTitle: 'USER CONTEXT（占位符已替换）', userCtxPlaceholder: '（占位符已替换）',
          empty: '(空)', missingUserCtx: '(缺少 user_context)', stagedPlaceholder: '<已暂存的文件，生成时实时注入>',
          stagedDiffPlaceholder: '<点击「生成」时实时注入的 staged diff>', restoreDefaults: '恢复默认', cancel: '取消',
          saving: '保存中…', save: '保存', ruleEditorTitle: '提交规则编辑器', close: '关闭',
          loadFailed: '读取失败', backToChanges: '返回变更列表', back: '返回', loadingDiff: '加载 diff…',
          closeDiff: '关闭 diff（Esc）',
          splitDiffTitle: '分栏对比', unifiedDiffTitle: '单栏对比',
          historyLoadFailed: '读取历史失败', loadingHistory: '加载历史…', graphHint: '点击行查看提交详情', loadingDetail: '加载详情…',
          stageFirst: '请先点击文件右侧的 + 暂存要提交的文件', generated: '已生成提交信息（规则来源：{s}）',
          ruleRepo: '仓库专属', ruleGlobal: '全局', ruleBuiltin: '内置默认', genFailedKeep: '生成失败，已保留原内容', genFailed: '生成失败: {e}', genTimeout: '生成超时，请重试',
          commitFailed: '提交失败: {e}', editRules: '编辑提交规则',
          copyRules: '复制当前生效规则到剪贴板',
          effectiveRules: '当前生效：{s}', loading: '读取中…', msgPlaceholder: '提交信息（仅提交已暂存的文件；Ctrl+Enter 提交）',
          genTitle: '生成提交信息', genTitleWithModel: '当前生成模型：{m}',
          genModelConfig: '配置生成模型…', genModelFollowDefault: '跟随当前会话模型（默认）',
          genModelEffort: '思考强度', genModelEffortFollow: '跟随模型默认', genModelEffortOff: '关闭思考', genModelEffortHigh: '高', genModelEffortMax: '最大',
          genModelSaved: '已保存生成模型', genModelLoadFailed: '读取生成模型/模型列表失败', genModelEmpty: '没有可用模型',
          genModelCurrent: '生成模型: {m}', genModelThinking: '思考: {e}',
          genModelDefaultMark: '（默认）', genModelThinkingParen: '（思考: {e}）', copied: '已复制', copyFailed: '复制失败',
          stagedCount: '已暂存 {n} 个文件', noStaged: '暂无暂存文件', generate: '生成', generating: '生成中…', rules: '规则',
          commit: '提交', committing: '提交中…', pushing: '推送中…', commitAndPush: '提交并推送',
          titleStageFirst: '先用文件右侧的 + 暂存文件', commitTitle: 'git commit（仅已暂存的 {n} 个文件）', pushTitle: '提交成功后推送当前分支',
          loadingStatus: '读取状态…', statusLoadFailed: '读取状态失败', gitStatusFailed: 'git status 失败：{e}', treeClean: '工作区干净，没有变更',
          unstageAll: '取消暂存全部', stageAll: '暂存全部（{n} 个文件）', unstage: '取消暂存', stage: '暂存（git add）',
          discardAll: '放弃所有更改', discardFile: '放弃更改', groupCount: '共 {n} 个文件',
          discardTitle: '放弃更改', discardConfirmN: '确定要放弃对 {n} 个文件的更改吗？', discardConfirm1: '确定要放弃对该文件的更改吗？',
          discardIrreversible: '此操作不可恢复。', discardUntrackedNote: '其中未跟踪的文件将被直接删除。',
          discardMore: '…以及其他 {n} 个文件', discardOk: '放弃更改',
          stagedNTitle: '已暂存 {n} 个文件', unstagedNTitle: '未暂存变更 {n} 个文件', untrackedNTitle: '未跟踪 {n} 个文件',
          pullTitle: 'Pull（fetch + merge）', switchBranch: '切换分支',
          loadingBranches: '读取分支…', branchesLoadFailed: '读取分支失败', newBranchName: '新分支名', createAndSwitch: '创建并切换',
          newBranch: '新建分支…', moreActions: '更多操作', push: '推送（push）', stashChanges: 'Stash 当前变更',
          stashPop: 'Stash pop（最近一条）', behindAhead: '落后 {b} / 领先 {a}', doneSuffix: '{label}完成', failedSuffix: '{label}失败',
          morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Stash pop（最近一条）',
          moreResetSoft: 'Reset（撤销上次提交，保留更改）', moreResetHard: 'Reset Hard（撤销上次提交并丢弃更改）', moreClean: 'Clean（删除未跟踪文件）',
          resetSoftTitle: 'Soft Reset（HEAD~1）', resetHardTitle: 'Hard Reset（HEAD~1）', cleanTitle: 'Clean 未跟踪文件', dangerRun: '执行',
          resetSoftNote: '将撤销最近一次提交，其更改退回暂存区。此操作改写本地历史。',
          resetHardNote: '将撤销最近一次提交并丢弃其全部更改。此操作不可恢复。',
          cleanNote: '将删除所有未跟踪的文件与目录（git clean -fd）。此操作不可恢复。',
          loadingMore: '加载更多…', emptyHistory: '暂无提交记录',
          failedWith: '{label}失败: {e}',
          rescan: '重新扫描（并刷新所有仓库状态）', openFolder: '在文件资源管理器中打开工作空间', openFolderFailed: '打开文件夹失败: {e}', openFolderUnavailable: '文件管理器服务不可用',
          locating: '正在定位工作空间…', scanning: '正在扫描 Git 仓库…', scanFailed: '扫描失败',
          noWorkspace: '未打开工作空间', noRepos: '当前工作空间内未发现 Git 仓库。', resizeTitle: '拖拽调整面板宽度',
          toastsLabel: 'Git Panel 通知', panelLabel: 'Git Panel 面板', toggleTitle: 'Git Panel',
          expandTitle: '展开 Git Panel'
        },
        en: {
          groupStaged: 'Staged Changes', groupChanges: 'Changes', groupUntracked: 'Untracked Changes', history: 'History',
          rulesLoadFailed: 'Failed to load rules', reading: '(loading…)', saved: 'Saved', saveFailed: 'Save failed', saveFailedWith: 'Save failed: {e}',
          scopeSwitchFailed: 'Failed to switch rules source',
          validationNoSys: 'Validation failed: missing system_prompt', validationNoUser: 'Validation failed: missing user_context',
          restoredDefaults: 'Restored to built-in defaults (not saved)', globalRules: 'Global rules', repoRules: 'Repo-specific rules', scopeSaveTo: 'Saved to: {p}', scopeNewFile: ' (file does not exist, will be created on save)',
          rulesContent: 'Rule content', sysPromptLabel: 'system prompt (required)', userCtxLabel: 'user context (required)',
          livePreview: 'Live preview (the final prompt injected into the LLM)', userCtxTitle: 'USER CONTEXT (placeholders replaced)', userCtxPlaceholder: '(placeholders replaced)',
          empty: '(empty)', missingUserCtx: '(missing user_context)', stagedPlaceholder: '<staged files, injected live at generation>',
          stagedDiffPlaceholder: '<staged diff injected live when you click Generate>', restoreDefaults: 'Restore Defaults', cancel: 'Cancel',
          saving: 'Saving…', save: 'Save', ruleEditorTitle: 'Commit Rule Editor', close: 'Close',
          loadFailed: 'Failed to load', backToChanges: 'Back to changes', back: 'Back', loadingDiff: 'Loading diff…',
          closeDiff: 'Close diff (Esc)',
          splitDiffTitle: 'Split view', unifiedDiffTitle: 'Unified view',
          historyLoadFailed: 'Failed to load history', loadingHistory: 'Loading history…', graphHint: 'Click a row to view commit details', loadingDetail: 'Loading details…',
          stageFirst: 'Stage files first using the + on the right of each file', generated: 'Commit message generated (rules: {s})',
          ruleRepo: 'repo-specific', ruleGlobal: 'global', ruleBuiltin: 'built-in', genFailedKeep: 'Generation failed; original content kept', genFailed: 'Generation failed: {e}', genTimeout: 'Generation timed out, please retry',
          commitFailed: 'Commit failed: {e}', editRules: 'Edit commit rules',
          copyRules: 'Copy effective rules to the clipboard',
          effectiveRules: 'Effective: {s}', loading: 'Loading…', msgPlaceholder: 'Commit message (commits only staged files; Ctrl+Enter to commit)',
          genTitle: 'Generate commit message', genTitleWithModel: 'Generation model: {m}',
          genModelConfig: 'Configure generation model…', genModelFollowDefault: 'Follow current session model (default)',
          genModelEffort: 'Reasoning effort', genModelEffortFollow: 'Model default', genModelEffortOff: 'Off', genModelEffortHigh: 'High', genModelEffortMax: 'Max',
          genModelSaved: 'Generation model saved', genModelLoadFailed: 'Failed to load generation model / model list', genModelEmpty: 'No models available',
          genModelCurrent: 'Generation model: {m}', genModelThinking: 'thinking: {e}',
          genModelDefaultMark: ' (default)', genModelThinkingParen: ' (thinking: {e})', copied: 'Copied', copyFailed: 'Copy failed',
          stagedCount: '{n} files staged', noStaged: 'No staged files', generate: 'Generate', generating: 'Generating…', rules: 'Rules',
          commit: 'Commit', committing: 'Committing…', pushing: 'Pushing…', commitAndPush: 'Commit & Push',
          titleStageFirst: 'Stage files first with +', commitTitle: 'git commit (only {n} staged files)', pushTitle: 'Commits, then pushes the current branch',
          loadingStatus: 'Loading status…', statusLoadFailed: 'Failed to load status', gitStatusFailed: 'git status failed: {e}', treeClean: 'Working tree clean',
          unstageAll: 'Unstage All', stageAll: 'Stage All ({n} files)', unstage: 'Unstage', stage: 'Stage (git add)',
          discardAll: 'Discard All Changes', discardFile: 'Discard Changes', groupCount: '{n} files in this group',
          discardTitle: 'Discard Changes', discardConfirmN: 'Discard changes to {n} files?', discardConfirm1: 'Discard changes to this file?',
          discardIrreversible: 'This action cannot be undone.', discardUntrackedNote: 'Untracked files among them will be deleted outright.',
          discardMore: '…and {n} more', discardOk: 'Discard Changes',
          stagedNTitle: '{n} files staged', unstagedNTitle: '{n} unstaged changes', untrackedNTitle: '{n} untracked files',
          pullTitle: 'Pull (fetch + merge)', switchBranch: 'Switch Branch',
          loadingBranches: 'Loading branches…', branchesLoadFailed: 'Failed to load branches', newBranchName: 'New branch name', createAndSwitch: 'Create & Switch',
          newBranch: 'New Branch…', moreActions: 'More Actions', push: 'Push', stashChanges: 'Stash Changes',
          stashPop: 'Stash Pop (latest)', behindAhead: 'Behind {b} / Ahead {a}', doneSuffix: '{label} completed', failedSuffix: '{label} failed',
          morePull: 'Pull', morePush: 'Push', moreStash: 'Stash', moreStashPop: 'Pop Latest Stash',
          moreResetSoft: 'Reset (undo last commit, keep changes)', moreResetHard: 'Reset Hard (undo last commit, discard changes)', moreClean: 'Clean (delete untracked files)',
          resetSoftTitle: 'Soft Reset (HEAD~1)', resetHardTitle: 'Hard Reset (HEAD~1)', cleanTitle: 'Clean Untracked Files', dangerRun: 'Run',
          resetSoftNote: 'Undoes the last commit; its changes return to the staging area. This rewrites local history.',
          resetHardNote: 'Undoes the last commit and discards all of its changes. This action cannot be undone.',
          cleanNote: 'Deletes all untracked files and directories (git clean -fd). This action cannot be undone.',
          loadingMore: 'Loading more…', emptyHistory: 'No commits yet',
          failedWith: '{label} failed: {e}',
          rescan: 'Rescan (also refreshes all repository statuses)', openFolder: 'Open workspace in file explorer', openFolderFailed: 'Failed to open folder: {e}', openFolderUnavailable: 'File manager service unavailable',
          locating: 'Locating workspace…', scanning: 'Scanning for Git repositories…', scanFailed: 'Scan failed',
          noWorkspace: 'No workspace open', noRepos: 'No Git repositories found in the current workspace.', resizeTitle: 'Drag to resize the panel width',
          toastsLabel: 'Git Panel notifications', panelLabel: 'Git Panel panel', toggleTitle: 'Git Panel',
          expandTitle: 'Expand Git Panel'
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
      // unified diff 解析：拆出文件头元信息（meta）、@@ 分段（含旧/新行号计数的行序列）、
      // 以及 hunk 之外的杂散行（未跟踪目录列表 / 无 diff / 二进制提示）。
      // 行对象：{ t: 'add'|'del'|'ctx'|'note', o: 旧行号|null, n: 新行号|null, x: 去掉前导符的文本 }
      function parseDiff(text) {
        const meta = []
        const blocks = []
        let cur = null
        let oldNo = 0, newNo = 0
        let adds = 0, dels = 0
        const lines = String(text || '').split('\n')
        for (const raw of lines) {
          if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(raw)) {
            const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
            oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10)
            cur = { hunk: raw, rows: [] }
            blocks.push(cur)
            continue
          }
          if (cur) {
            if (raw.startsWith('+')) { cur.rows.push({ t: 'add', o: null, n: newNo++, x: raw.slice(1) }); adds++ }
            else if (raw.startsWith('-')) { cur.rows.push({ t: 'del', o: oldNo++, n: null, x: raw.slice(1) }); dels++ }
            else if (raw.startsWith('\\')) cur.rows.push({ t: 'note', o: null, n: null, x: raw })
            else cur.rows.push({ t: 'ctx', o: oldNo++, n: newNo++, x: raw.length ? raw.slice(1) : '' })
            continue
          }
          if (/^(diff --git|index |--- |\+\+\+ |(?:new|deleted) file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files|GIT binary patch)/.test(raw)) { meta.push(raw); continue }
          if (raw === '') continue
          if (!blocks.length || blocks[blocks.length - 1].hunk !== null) blocks.push({ hunk: null, rows: [] })
          const b = blocks[blocks.length - 1]
          if (raw.startsWith('+')) { b.rows.push({ t: 'add', o: null, n: null, x: raw.slice(1) }); adds++ }
          else if (raw.startsWith('-')) { b.rows.push({ t: 'del', o: null, n: null, x: raw.slice(1) }); dels++ }
          else b.rows.push({ t: 'ctx', o: null, n: null, x: raw })
        }
        return { meta, blocks, adds, dels }
      }

      // 分栏（split）配对：把 hunk 行序列对齐成 { 左, 右 } 行。
      //   ctx → 左右同内容同双行号；连续 del 块与其后 add 块先掐公共前缀/后缀
      //   （作为「未变对」按上下文渲染），剩下的中段按出现顺序一一配对（左红右绿
      //   的修改行），多余的 del 右侧留空、多余的 add 左侧留空。
      //   掐头去尾是关键：真实改动多为「函数中段改几行」，naive 下标配对会把
      //   不相干的行凑成一对，观感很差；前后缀修剪解决绝大多数对不齐。
      function pairRows(blocks) {
        const out = []
        const pushPair = (l, r, mod) => out.push({ l, r, mod: !!mod })
        for (const b of blocks) {
          const rows = b.rows
          let i = 0
          while (i < rows.length) {
            const r = rows[i]
            if (r.t === 'note') { out.push({ note: r.x }); i++; continue }
            if (r.t !== 'del' && r.t !== 'add') { pushPair(r, r, false); i++; continue }
            const dels = []
            while (i < rows.length && rows[i].t === 'del') dels.push(rows[i++])
            const adds = []
            while (i < rows.length && rows[i].t === 'add') adds.push(rows[i++])
            let p = 0
            while (p < dels.length && p < adds.length && dels[p].x === adds[p].x) p++
            let s = 0
            while (s < dels.length - p && s < adds.length - p && dels[dels.length - 1 - s].x === adds[adds.length - 1 - s].x) s++
            for (let k = 0; k < p; k++) pushPair(dels[k], adds[k], false)
            const dm = dels.slice(p, dels.length - s)
            const am = adds.slice(p, adds.length - s)
            for (let k = 0; k < Math.max(dm.length, am.length); k++) pushPair(dm[k] || null, am[k] || null, true)
            // 后缀配对：两数组后缀起点不同（dels.length - s 与 adds.length - s），
            // 必须各自从自己的后缀起点数起，用同一侧下标配对会错位
            const sf = dels.length - s
            const sa = adds.length - s
            for (let k = 0; k < s; k++) pushPair(dels[sf + k], adds[sa + k], false)
          }
        }
        return out
      }

      // 配对修改行的 word 级变化段：剥掉公共前后缀，返回中段（行内高亮用）
      function segDiff(a, b) {
        if (!a || !b || a === b) return null
        const n = Math.min(a.length, b.length)
        let p = 0
        while (p < n && a[p] === b[p]) p++
        let s = 0
        while (s < n - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
        const midA = a.slice(p, a.length - s)
        const midB = b.slice(p, b.length - s)
        if (!midA && !midB) return null
        return { pre: a.slice(0, p), midA, midB, post: a.slice(a.length - s) }
      }

      function ToastLayer() {
        const s = useStore()
        return React.createElement('div', { className: 'gp-toast-stack' },
          (s.toasts || []).map((t) => React.createElement('div', { key: t.id, className: 'gp-toast gp-toast-' + t.kind + (t.exiting ? ' gp-toast-exit' : '') }, t.text)))
      }

      function RuleEditorModal({ repo, onClose }) {
        // 双缓冲：全局 / 仓库各一套编辑内容；scope 单选即生效来源（切换走 rulesSetScope，
        // 切到仓库时缓冲区以 Host 返回的仓库文件内容为准）
        const [buffers, setBuffers] = React.useState({ global: { sysPrompt: '', userCtx: '' }, repo: { sysPrompt: '', userCtx: '' } })
        const [defaults, setDefaults] = React.useState({ sysPrompt: '', userCtx: '' })
        const [paths, setPaths] = React.useState({ global: '', repo: '' })
        const [repoExists, setRepoExists] = React.useState(false)
        // scope 初始为 null：等 rulesGet 返回后跟随当前生效来源（ruleScope 偏好 +
        // 仓库文件存在性，见 Host loadEffectiveRules），加载完成前切换禁用，避免闪跳
        const [scope, setScope] = React.useState(null)
        const [loaded, setLoaded] = React.useState(false)
        const [saving, setSaving] = React.useState(false)
        const [switching, setSwitching] = React.useState(false)
        const [branch, setBranch] = React.useState(tr('reading'))

        React.useEffect(() => {
          callRpc('rulesGet', { repoId: repo.id }).then((r) => {
            if (r && r.ok) {
              const g = parseRulesYaml(r.defaultYaml)
              const rp = parseRulesYaml(r.repoYaml || r.defaultYaml)
              setBuffers({
                global: { sysPrompt: g.system_prompt || '', userCtx: g.user_context || '' },
                repo: { sysPrompt: rp.system_prompt || '', userCtx: rp.user_context || '' }
              })
              setDefaults({ sysPrompt: g.system_prompt || '', userCtx: g.user_context || '' })
              setPaths({ global: r.defaultPath || '', repo: r.repoPath || '' })
              setRepoExists(!!r.repoRuleExists)
              setScope(r.effective && r.effective.source === 'repo' ? 'repo' : 'global')
              setLoaded(true)
            } else pushToast('error', (r && r.error) || tr('rulesLoadFailed'))
          }).catch((e) => pushToast('error', tr('rulesLoadFailed') + ': ' + (e && e.message ? e.message : String(e))))
          callRpc('status', { repoId: repo.id }).then((r) => { if (r && r.ok && r.branch) setBranch(r.branch) }).catch(() => {})
        }, [repo.id])

        const curScope = scope || 'global'
        const buf = buffers[curScope]
        const patchBuf = (p) => setBuffers((b) => ({ ...b, [curScope]: { ...b[curScope], ...p } }))

        const previewUser = (buf.userCtx || tr('missingUserCtx'))
          .replaceAll('{repo_name}', repo.name)
          .replaceAll('{branch}', branch)
          .replaceAll('{file_list}', '- ' + tr('stagedPlaceholder'))
          .replaceAll('{staged_diff}', tr('stagedDiffPlaceholder'))

        const onSave = async () => {
          if (!buf.sysPrompt.trim()) { pushToast('error', tr('validationNoSys')); return }
          if (!buf.userCtx.trim()) { pushToast('error', tr('validationNoUser')); return }
          setSaving(true)
          try {
            const yaml = emitRulesYaml({ system_prompt: buf.sysPrompt, user_context: buf.userCtx })
            const r = await callRpc('rulesSave', { repoId: repo.id, scope: curScope, yaml })
            if (r && r.ok) { pushToast('success', r.summary || tr('saved')); onClose() }
            else pushToast('error', (r && r.error) || tr('saveFailed'))
          } catch (e) { pushToast('error', fmt(tr('saveFailedWith'), { e: e && e.message ? e.message : String(e) })) }
          finally { setSaving(false) }
        }
        const onRestoreDefault = () => {
          patchBuf({ sysPrompt: defaults.sysPrompt, userCtx: defaults.userCtx })
          pushToast('info', tr('restoredDefaults'))
        }

        // scope 单选 = 真实切换生效来源（rulesSetScope 写入 git-repos.json 偏好）：
        // 切到仓库专属时 Host 会以当前生效规则为底创建文件（若不存在）；
        // 切回全局保留仓库文件，之后可再切回。保存仍是显式动作（onSave）。
        const onScopeChange = async (next) => {
          if (next === curScope || switching || !loaded) return
          setSwitching(true)
          try {
            const r = await callRpc('rulesSetScope', { repoId: repo.id, scope: next })
            if (r && r.ok) {
              if (next === 'repo' && typeof r.repoYaml === 'string') {
                const rp = parseRulesYaml(r.repoYaml)
                setBuffers((b) => ({ ...b, repo: { sysPrompt: rp.system_prompt || '', userCtx: rp.user_context || '' } }))
              }
              if (r.repoPath) setPaths((p) => ({ ...p, repo: r.repoPath }))
              setRepoExists(!!r.repoRuleExists)
              setScope(next)
              pushToast('success', r.summary || tr('saved'))
            } else pushToast('error', (r && r.error) || tr('scopeSwitchFailed'))
          } catch (e) { pushToast('error', tr('scopeSwitchFailed') + ': ' + (e && e.message ? e.message : String(e))) }
          finally { setSwitching(false) }
        }

        const fieldEditor = (keyName, label, value, setValue) =>
          React.createElement('div', { className: 'gp-rule-field' },
            React.createElement('div', { className: 'gp-rule-field-head' },
              React.createElement('code', { className: 'gp-rule-field-key' }, keyName),
              React.createElement('span', { className: 'gp-rule-field-label' }, label)),
            React.createElement('textarea', { className: 'gp-rule-input', value, spellCheck: false, onChange: (e) => setValue(e.target.value) }))

        const body = React.createElement('div', { className: 'gp-modal-body' },
          React.createElement('div', { className: 'gp-rule-scope' },
            React.createElement('label', { title: tr('globalRules') },
              React.createElement('input', { type: 'radio', name: 'gp-rule-scope', disabled: !loaded || switching, checked: curScope === 'global', onChange: () => onScopeChange('global') }),
              React.createElement('span', null, tr('globalRules'))),
            React.createElement('label', { title: tr('repoRules') },
              React.createElement('input', { type: 'radio', name: 'gp-rule-scope', disabled: !loaded || switching, checked: curScope === 'repo', onChange: () => onScopeChange('repo') }),
              React.createElement('span', null, tr('repoRules'))),
            switching ? React.createElement('span', { className: 'gp-spinner' }) : null),
          React.createElement('div', { className: 'gp-rule-scope-hint', title: paths[curScope] },
            fmt(tr('scopeSaveTo'), { p: paths[curScope] || tr('loading') }),
            curScope === 'repo' && !repoExists ? tr('scopeNewFile') : null),
          React.createElement('div', { className: 'gp-rule-cols' },
            React.createElement('div', { className: 'gp-rule-col' },
              React.createElement('div', { className: 'gp-rule-col-title' }, tr('rulesContent')),
              React.createElement('div', { className: 'gp-rule-fields' },
                fieldEditor('system_prompt', tr('sysPromptLabel'), buf.sysPrompt, (v) => patchBuf({ sysPrompt: v })),
                fieldEditor('user_context', tr('userCtxLabel'), buf.userCtx, (v) => patchBuf({ userCtx: v })))),
            React.createElement('div', { className: 'gp-rule-col' },
              React.createElement('div', { className: 'gp-rule-col-title' }, tr('livePreview')),
              React.createElement('div', { className: 'gp-rule-preview' },
                React.createElement('div', { className: 'gp-rule-preview-title' }, 'SYSTEM PROMPT'),
                buf.sysPrompt || tr('empty'),
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
              React.createElement('span', { className: 'gp-spacer' }, tr('ruleEditorTitle')),
              React.createElement('button', { className: 'gp-btn-icon', onClick: onClose, title: tr('close') }, icon('close'))),
            body,
            foot))
      }

      // DiffDrawer：点击文件后从面板左缘向左滑出的浮层查看器。
      //   - 抽屉右缘与面板左缘齐平（覆盖在聊天区上方），文件列表保持可见，点别的文件直接切换；
      //   - 遮罩仅覆盖抽屉左侧区域（聊天区），点击遮罩或按 Esc 关闭；
      //   - 开/关均为整屉滑入/滑出动效：遮罩是延伸到面板下方的一整块深色（面板滑入后
      //     盖住它，即「阴影整体 + 面板遮挡」）；面板自身无投影、无透明度动画，纯位移，
      //     初始停在 translateX(100%) —— 被不透明的 Git Panel 完全遮挡，双 rAF 确保
      //     初始样式先绘制一帧再开始过渡（根治首帧以终态闪现的问题）；
      //   - 关闭相位由父组件写入 sel.closing（所有关闭入口统一走它，含「再次点击文件行」），
      //     本组件播完滑出动效（240ms）后回调 onClose 真正卸载；期间切到新文件会取消卸载；
      //   - 左缘拖拽调宽，宽度记忆在 localStorage（gp-diff-w）；
      //   - 左右分栏（split）视图：左源文件/右修改后，配对修改行带 word 级中段高亮
      //     （公共前后缀裁剪），模式记忆在 localStorage（gp-diff-split）。
      function DiffDrawer({ repo, sel, panelW, onClose, onRequestClose }) {
        const [state, setState] = React.useState({ loading: true, text: '', error: '' })
        // 分栏（split）视图：左源文件/右修改后；记忆在 localStorage
        const [split, setSplit] = React.useState(() => loadSplit())
        const [drawerW, setDrawerW] = React.useState(() => loadDiffW() || Math.min(760, Math.max(440, Math.round(window.innerWidth * 0.42))))
        const [resizing, setResizing] = React.useState(false)
        // 滑入/滑出相位：off（未入场 / sel.closing）时整屉平移到面板正后方且全透明
        const [entered, setEntered] = React.useState(false)
        const closing = sel.closing === true
        const closeTimerRef = React.useRef(null)
        const rafRef = React.useRef(0)
        const resizeRef = React.useRef(false)
        const wRef = React.useRef(drawerW)

        // 入场：双 rAF 让「面板后方 + 全透明」的初始样式先完成一次绘制，再切到终态触发 transition
        React.useEffect(() => {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = requestAnimationFrame(() => setEntered(true))
          })
          return () => cancelAnimationFrame(rafRef.current)
        }, [])

        // 关闭相位：滑出动效播完（240ms）后回调 onClose 真正卸载；期间切到新文件
        // （父组件整体替换 diffSel、closing 复位为 false）→ effect 清理自动取消卸载
        React.useEffect(() => {
          if (!closing) return
          closeTimerRef.current = timer.timeout(() => onClose(), 240)
          return () => { if (closeTimerRef.current) { closeTimerRef.current(); closeTimerRef.current = null } }
        }, [closing, onClose])

        // Esc / X / 遮罩：请求进入关闭相位（由父组件统一标记，防止与文件切换竞态）
        const requestClose = () => { if (!closing && onRequestClose) onRequestClose() }

        React.useEffect(() => {
          let alive = true
          setState({ loading: true, text: '', error: '' })
          callRpc('fileDiff', { repoId: repo.id, path: sel.path, group: sel.group }).then((r) => {
            if (!alive) return
            if (r && r.ok) setState({ loading: false, text: r.text || '', error: '' })
            else setState({ loading: false, text: '', error: (r && r.error) || tr('loadFailed') })
          }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
          return () => { alive = false }
        }, [repo.id, sel.path, sel.group])

        React.useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') requestClose() }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [closing, onClose])

        // 抽屉左缘拖拽调宽：宽度 = 视口宽 − 面板宽 − 指针 x，松手时持久化
        React.useEffect(() => {
          const onMove = (e) => {
            if (!resizeRef.current) return
            const max = Math.max(320, Math.round(window.innerWidth - panelW - 48))
            const w = Math.min(max, Math.max(380, Math.round(window.innerWidth - panelW - e.clientX)))
            wRef.current = w
            setDrawerW((prev) => (prev === w ? prev : w))
          }
          const onUp = () => {
            if (!resizeRef.current) return
            resizeRef.current = false
            setResizing(false)
            saveDiffW(wRef.current)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
        }, [panelW])

        const parsed = React.useMemo(() => parseDiff(state.text), [state.text])
        // 分栏配对按 block 缓存（保留 @@ 分段头边界）；仅 split 模式惰性计算
        const splitPairs = React.useMemo(() => (split ? parsed.blocks.map((b) => ({ hunk: b.hunk, pairs: pairRows([b]) })) : null), [parsed, split])
        const gl = glyphOf(sel.x, sel.y)
        const trimmed = sel.path.replace(/\/+$/, '')
        const seg = trimmed.split('/').pop() || sel.path
        const base = sel.path.endsWith('/') ? seg + '/' : seg
        const dir = trimmed.length > seg.length ? trimmed.slice(0, trimmed.length - seg.length).replace(/\/+$/, '') : ''
        // 面板调宽/窗口变窄时保持抽屉不越过视口左缘
        const wEff = Math.min(drawerW, Math.max(320, Math.round(window.innerWidth - panelW - 48)))

        const renderRow = (r, i) => React.createElement('div', { key: i, className: 'gp-diff-row gp-dr-' + r.t },
          React.createElement('span', { className: 'gp-diff-ln' }, r.o == null ? '' : r.o),
          React.createElement('span', { className: 'gp-diff-ln' }, r.n == null ? '' : r.n),
          React.createElement('span', { className: 'gp-diff-code' },
            React.createElement('span', { className: 'gp-diff-sign' }, r.t === 'add' ? '+' : r.t === 'del' ? '-' : r.t === 'ctx' ? ' ' : ''),
            r.x))

        // 分栏行：左半（旧行号+旧文本，del 红）| 中缝 | 右半（新行号+新文本，add 绿）。
        // 着色/符号只看 pr.mod：掐头去尾得到的「内容相同的 del+add 对」按普通上下文
        // 渲染（无红绿、无 +/− 符号），只有中段配对与单边行才着色；
        // 修改对带 word 级中段高亮（公共前后缀之外的部分）。
        const renderSplitRow = (pr, i) => {
          if (pr.note) return React.createElement('div', { key: i, className: 'gp-diff-row gp-dr-note' },
            React.createElement('span', { className: 'gp-diff-code' }, pr.note))
          const l = pr.l, r = pr.r
          const sgd = pr.mod && l && r ? segDiff(l.x, r.x) : null
          const lDel = !!(l && l.t === 'del' && pr.mod)
          const rAdd = !!(r && r.t === 'add' && pr.mod)
          const lCode = !l ? '' : sgd ? [sgd.pre, React.createElement('span', { key: 'm', className: 'gp-diff-hl-del' }, sgd.midA), sgd.post] : l.x
          const rCode = !r ? '' : sgd ? [sgd.pre, React.createElement('span', { key: 'm', className: 'gp-diff-hl-add' }, sgd.midB), sgd.post] : r.x
          return React.createElement('div', { key: i, className: 'gp-diff-row' + (!lDel && !rAdd ? ' gp-dr-ctx' : '') },
            React.createElement('span', { className: 'gp-diff-half' + (lDel ? ' gp-dh-del' : '') },
              React.createElement('span', { className: 'gp-diff-ln' }, l && l.o != null ? l.o : ''),
              React.createElement('span', { className: 'gp-diff-code' },
                React.createElement('span', { className: 'gp-diff-sign' }, l ? (lDel ? '-' : ' ') : ''),
                lCode)),
            React.createElement('span', { className: 'gp-diff-mid' }),
            React.createElement('span', { className: 'gp-diff-half' + (rAdd ? ' gp-dh-add' : '') },
              React.createElement('span', { className: 'gp-diff-ln' }, r && r.n != null ? r.n : ''),
              React.createElement('span', { className: 'gp-diff-code' },
                React.createElement('span', { className: 'gp-diff-sign' }, r ? (rAdd ? '+' : ' ') : ''),
                rCode)))
        }

        // 头部布局：glyph | 标题框（flex:1 吃掉全部剩余空间）| +增/−删统计 | 组徽标 |
        // 分栏切换 | 关闭。不设 spacer —— 标题框的 flex-grow 已把右侧
        // 元素整体推到最右（统计居右），若再放 flex:1 的 spacer 会与标题框平分剩余空间。
        const head = React.createElement('div', { className: 'gp-diff-head' },
          React.createElement('span', { className: 'gp-diff-glyph ' + gl.cls }, gl.g),
          React.createElement('div', { className: 'gp-diff-title', title: sel.path },
            React.createElement('span', { className: 'gp-diff-name' }, base),
            dir ? React.createElement('span', { className: 'gp-diff-dir' }, dir) : null),
          !state.loading && !state.error && (parsed.adds > 0 || parsed.dels > 0) ? React.createElement('span', { className: 'gp-diff-stats' },
            parsed.adds > 0 ? React.createElement('span', { className: 'gp-diff-stat-add' }, '+' + parsed.adds) : null,
            parsed.dels > 0 ? React.createElement('span', { className: 'gp-diff-stat-del' }, '−' + parsed.dels) : null) : null,
          React.createElement('span', { className: 'gp-chip' }, GROUP_META[sel.group] ? tr(GROUP_META[sel.group].titleKey) : sel.group),
          React.createElement('button', { className: 'gp-btn-icon', title: split ? tr('unifiedDiffTitle') : tr('splitDiffTitle'), onClick: () => setSplit((v) => { saveSplit(!v); return !v }) }, icon(split ? 'unified' : 'split')),
          React.createElement('button', { className: 'gp-btn-icon', title: tr('closeDiff'), onClick: requestClose }, icon('close')))

        const body = React.createElement('div', { className: 'gp-diff-body' },
          state.loading
            ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), ' ' + tr('loadingDiff'))
            : state.error
              ? React.createElement('div', { className: 'gp-empty' }, state.error)
              : React.createElement('div', { className: 'gp-diff-table' },
                  parsed.meta.length ? React.createElement('div', { className: 'gp-diff-meta' }, parsed.meta.join('\n')) : null,
                  split
                    ? splitPairs.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                        b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                        b.pairs.map(renderSplitRow)))
                    : parsed.blocks.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                        b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                        b.rows.map(renderRow)))))

        // 滑入/滑出相位：off = 未入场或正在关闭 → 整屉藏到不透明的 Git Panel 正后方。
        // 遮罩是一整块（right: panelW，延伸到本面板下方，由面板滑入后盖住）；
        // 面板只做纯位移（无投影、无透明度动画），起点被 Git Panel 完全遮挡。
        const off = !entered || closing
        return React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'gp-diff-backdrop', style: { right: panelW + 'px', opacity: off ? 0 : 1 }, onClick: requestClose }),
          React.createElement('div', {
            className: 'gp-diff-drawer',
            style: { right: panelW + 'px', width: wEff + 'px', transform: off ? 'translateX(100%)' : 'none' }
          },
            React.createElement('div', {
              className: 'gp-diff-resize' + (resizing ? ' gp-diff-resize-active' : ''),
              title: tr('resizeTitle'),
              onPointerDown: (e) => { e.preventDefault(); resizeRef.current = true; setResizing(true) }
            }),
            head,
            body))
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

      // 统计行：取 git --stat 汇总行原文（保留 git 的单复数措辞），insertions 段绿色、deletions 段红色
      // 找不到汇总行（合并提交无统计 / git 输出本地化）时返回 null，该段不显示
      function renderStatSummary(stat) {
        const line = String(stat || '').split('\n').map((l) => l.trim()).find((l) => /\d+\s+files?\s+changed/.test(l))
        if (!line) return null
        const parts = line.split(/(\d+\s+insertions?\(\+\)|\d+\s+deletions?\(-\))/g).filter((s) => s)
        return parts.map((seg, i) => {
          if (/insertions?\(\+\)/.test(seg)) return React.createElement('span', { key: i, className: 'gp-cd-add' }, seg)
          if (/deletions?\(-\)/.test(seg)) return React.createElement('span', { key: i, className: 'gp-cd-del' }, seg)
          return seg
        })
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
        const POPW = 480
        const pop = hover ? (() => {
          const d = detailCache.current.get(hover.hash)
          const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
          const POPH = Math.round(vh * 0.5)
          const left = Math.max(8, hover.left - POPW - 10)
          const top = Math.max(8, Math.min(hover.top - 8, vh - POPH - 12))
          const short = hover.short || String(hover.hash || '').slice(0, 7)
          let inner
          if (!d || d.loading) inner = React.createElement('div', { className: 'gp-empty' }, tr('loadingDetail'))
          else if (d.error) inner = React.createElement('div', { className: 'gp-empty' }, d.error)
          else {
            // message 全文原样展示：统一字号字重、保留空行与换行（不再单独加粗首行）；
            // markdown-lite：'- ' / '* ' 开头的行渲染为圆点列表项
            const msgLines = String(d.data.message || '').replace(/\r\n/g, '\n').split('\n')
            while (msgLines.length > 1 && msgLines[msgLines.length - 1].trim() === '') msgLines.pop()
            const msgEls = msgLines.map((ln, li) => {
              const bm = ln.match(/^(\s*)[-*]\s+(.*)$/)
              if (bm) return React.createElement('div', { key: li, className: 'gp-cd-li', style: { paddingLeft: Math.min(24, bm[1].replace(/\t/g, '    ').length * 6) } },
                React.createElement('span', { className: 'gp-cd-bullet' }, '•'),
                React.createElement('span', { className: 'gp-cd-li-text' }, bm[2]))
              if (ln.trim() === '') return React.createElement('div', { key: li, className: 'gp-cd-blank' })
              return React.createElement('div', { key: li, className: 'gp-cd-line' }, ln)
            })
            // refs pill：本地分支（含当前）=品牌色，远程=绿，tag=琥珀；仅该提交带 refs 时显示
            const refs = parseRefs(hover.refs)
            const refChips = []
            if (refs.current) refChips.push(React.createElement('span', { key: 'c', className: 'gp-cd-ref gp-cd-ref-cur' }, refs.current))
            refs.branches.forEach((b, bi) => refChips.push(React.createElement('span', { key: 'b' + bi, className: 'gp-cd-ref gp-cd-ref-local' }, b)))
            refs.remotes.forEach((r, ri) => refChips.push(React.createElement('span', { key: 'r' + ri, className: 'gp-cd-ref gp-cd-ref-remote' }, r)))
            refs.tags.forEach((t, ti) => refChips.push(React.createElement('span', { key: 't' + ti, className: 'gp-cd-ref gp-cd-ref-tag' }, t)))
            const statSum = renderStatSummary(d.data.stat)
            inner = React.createElement('div', null,
              React.createElement('div', { className: 'gp-cd-sec gp-cd-head' },
                React.createElement('span', { className: 'gp-cd-person' }, icon('person', 14)),
                React.createElement('span', { className: 'gp-cd-author' }, d.data.author),
                React.createElement('span', { className: 'gp-cd-date' }, (d.data.date || '').replace('T', ' ').slice(0, 16))),
              React.createElement('div', { className: 'gp-cd-sec gp-cd-msg' }, msgEls),
              statSum ? React.createElement('div', { className: 'gp-cd-sec gp-cd-sum' }, statSum) : null,
              refChips.length > 0 ? React.createElement('div', { className: 'gp-cd-sec gp-cd-refs' }, refChips) : null,
              React.createElement('div', { className: 'gp-cd-sec gp-cd-hashrow', title: hover.hash }, short))
          }
          return React.createElement('div', { className: 'gp-cd-pop', style: { left, top }, onMouseEnter: cancelHide, onMouseLeave: scheduleHide }, inner)
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
        // 卸载中断标志：doGenerate 的轮询循环在组件卸载（面板关闭/重挂载）后必须停止，
        // 否则旧循环在后台无限发 generatePoll 且与新循环叠加
        const genAliveRef = React.useRef(true)
        React.useEffect(() => () => { genAliveRef.current = false }, [])
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
            // 整体超时兜底：Host 端 LLM 挂起时 generatePoll 会永远返回未完成，
            // 无超时则 busy 永久卡死（180s 覆盖慢模型的正常生成）
            const deadline = Date.now() + 180000
            while (true) {
              // 组件已卸载（面板关闭/重挂载）：停止轮询（finally 的 setBusy 为卸载后 no-op）
              if (!genAliveRef.current) return
              if (Date.now() > deadline) { pushToast('error', tr('genTimeout')); break }
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
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setRulesMenuOpen(false); setOpenRules(true) } }, tr('editRules')),
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
          openRules ? React.createElement(RuleEditorModal, { repo, onClose: () => setOpenRules(false) }) : null,
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

      function RepoCard({ repo, sessionId, onOpenDiff, diffSel, onCloseDiff }) {
        const [status, setStatus] = React.useState({ loading: true, data: null, error: '' })
        const [isCollapsed, setCollapsed] = React.useState(false)
        const [historyOpen, setHistoryOpen] = React.useState(false)
        const [branchMenu, setBranchMenu] = React.useState({ open: false, loading: false, data: null, error: '', creating: false, newName: '' })
        const [moreMenu, setMoreMenu] = React.useState({ open: false })
        const [busy, setBusy] = React.useState(null)
        const [message, setMessage] = React.useState('')
        // 多选（Ctrl/Shift）：'group\u0000path' 的集合，按仓库隔离；普通点击 = 单选激活行
        // （打开/关闭 diff）并清空多选。激活行（diffSel）由父组件持有，另行高亮。
        const [selKeys, setSelKeys] = React.useState(() => new Set())
        const anchorRef = React.useRef(null)
        // 放弃更改确认弹窗：null 或 { byGroup: {staged:[], unstaged:[], untracked:[]}, count }
        const [confirmDiscard, setConfirmDiscard] = React.useState(null)
        // 危险操作确认弹窗（Reset / Clean）：null | 'reset-soft' | 'reset-hard' | 'clean'
        const [confirmDanger, setConfirmDanger] = React.useState(null)
        const rowKey = (group, path) => group + '\u0000' + path
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
          // 返回 'ok' / 'error'（busy 早退返回 undefined）：批量操作据成败决定是否清空多选
          try { return handleWriteResult(await call(), label) } catch (e) { pushToast('error', fmt(tr('failedWith'), { label, e: e && e.message ? e.message : String(e) })) }
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

        // ===== 多选 / 激活行 / 放弃确认（均需 data，置于其后） =====
        // 激活行 = diff 抽屉正展示的行（同一文件可同时出现在 staged/unstaged 两组，须带组判定）
        const activeKey = diffSel && diffSel.repoId === repo.id ? rowKey(diffSel.group, diffSel.path) : null

        // 可见的扁平顺序（staged → unstaged → untracked，收起的组跳过）：Shift 范围选择按它取区间
        const flatKeys = React.useMemo(() => {
          const out = []
          if (data) {
            for (const g of ['staged', 'unstaged', 'untracked']) {
              if (groupsOpen[g] === false) continue
              for (const f of data[g] || []) out.push(rowKey(g, f.path))
            }
          }
          return out
        }, [data, groupsOpen])

        // status 刷新后剪掉已消失的多选项（暂存/放弃后文件移组），锚点失效则重置。
        // 按「全部行」（含收起组）校验：收起组里的选中项仍是有效文件，不应被误剪。
        const flatKeysAll = () => {
          const out = []
          if (data) for (const g of ['staged', 'unstaged', 'untracked']) for (const f of data[g] || []) out.push(rowKey(g, f.path))
          return out
        }
        React.useEffect(() => {
          if (!data) return
          const valid = new Set(flatKeysAll())
          setSelKeys((prev) => {
            if (prev.size === 0) return prev
            let changed = false
            const next = new Set()
            for (const k of prev) { if (valid.has(k)) next.add(k); else changed = true }
            return changed ? next : prev
          })
          if (anchorRef.current && !valid.has(anchorRef.current)) anchorRef.current = null
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [data])

        // 激活行随操作移组/消失时自动关闭 diff 抽屉，避免抽屉展示过期内容
        React.useEffect(() => {
          if (!data || !diffSel || diffSel.repoId !== repo.id) return
          const list = data[diffSel.group]
          const alive = Array.isArray(list) && list.some((f) => f.path === diffSel.path)
          if (!alive && onCloseDiff) onCloseDiff()
        }, [data, diffSel, repo.id, onCloseDiff])

        // Esc 分层：确认弹窗 > 清空多选 > 关 diff 抽屉。capture 阶段拦截，阻止抽屉的
        // bubble 阶段 Esc 监听在同一按键里同时触发（先关弹窗又顺手关掉抽屉）。
        React.useEffect(() => {
          const onKey = (e) => {
            if (e.key !== 'Escape') return
            if (confirmDanger) { setConfirmDanger(null); e.stopPropagation(); return }
            if (confirmDiscard) { setConfirmDiscard(null); e.stopPropagation(); return }
            if (selKeys.size > 0) { setSelKeys(new Set()); e.stopPropagation() }
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [confirmDiscard, confirmDanger, selKeys])

        // 文件行点击：普通 = 单选并打开/关闭 diff（同一行再次点击 = 取消选中并关闭抽屉）；
        // Ctrl/⌘ = 增删多选；Shift = 锚点到当前行的范围多选。修饰键点击不切换 diff
        // （对齐 VS Code SCM：多选只为批量操作服务，diff 抽屉保持当前文件不动）。
        const onRowClick = (e, f, group) => {
          const key = rowKey(group, f.path)
          if (e.shiftKey) {
            let from = anchorRef.current != null && flatKeys.indexOf(anchorRef.current) >= 0 ? anchorRef.current
              : (activeKey != null && flatKeys.indexOf(activeKey) >= 0 ? activeKey : key)
            const i = flatKeys.indexOf(from)
            const j = flatKeys.indexOf(key)
            if (i >= 0 && j >= 0) setSelKeys(new Set(flatKeys.slice(Math.min(i, j), Math.max(i, j) + 1)))
            else setSelKeys(new Set([key]))
            return
          }
          anchorRef.current = key
          if (e.ctrlKey || e.metaKey) {
            setSelKeys((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
            return
          }
          setSelKeys(new Set())
          onOpenDiff(repo, f, group)
        }

        // 多选分区：unstage 仅对 staged；stage 对 unstaged+untracked；放弃须按组分别调用
        const selParts = React.useMemo(() => {
          const byGroup = { staged: [], unstaged: [], untracked: [] }
          if (data) {
            for (const g of ['staged', 'unstaged', 'untracked']) {
              const map = new Map((data[g] || []).map((f) => [rowKey(g, f.path), f.path]))
              for (const k of selKeys) { const p = map.get(k); if (p != null) byGroup[g].push(p) }
            }
          }
          return byGroup
        }, [selKeys, data])
        const selCount = selParts.staged.length + selParts.unstaged.length + selParts.untracked.length

        // 放弃更改确认：所有入口（单行 / 组全部 / 多选批量）统一先弹确认
        const askDiscard = (paths, group) => {
          if (!paths || paths.length === 0) return
          const byGroup = { staged: [], unstaged: [], untracked: [] }
          byGroup[group] = paths.slice()
          setConfirmDiscard({ byGroup, count: paths.length })
        }
        const askDiscardSelection = () => {
          if (selCount === 0) return
          setConfirmDiscard({ byGroup: { staged: selParts.staged.slice(), unstaged: selParts.unstaged.slice(), untracked: selParts.untracked.slice() }, count: selCount })
        }
        const doDiscardConfirmed = async () => {
          const parts = confirmDiscard && confirmDiscard.byGroup
          setConfirmDiscard(null)
          if (!parts) return
          let allOk = true
          for (const g of ['staged', 'unstaged', 'untracked']) {
            if (parts[g] && parts[g].length > 0 && (await discard(parts[g], g)) !== 'ok') allOk = false
          }
          if (allOk) setSelKeys(new Set())
        }
        const discardPreviewText = (cd) => {
          const names = []
          for (const g of ['staged', 'unstaged', 'untracked']) for (const p of cd.byGroup[g]) names.push(p)
          const MAX = 5
          return names.length > MAX ? names.slice(0, MAX).join('\n') + '\n' + fmt(tr('discardMore'), { n: names.length - MAX }) : names.join('\n')
        }

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
                React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); askDiscard(paths, group) } }, icon('discard')),
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
              const key = rowKey(group, f.path)
              const cls = 'gp-file-row' + (activeKey === key ? ' gp-file-active' : '') + (selKeys.has(key) ? ' gp-file-sel' : '')
              return React.createElement('div', {
                className: cls, key: group + ':' + f.path, title: f.path,
                // 修饰键点击阻止原生文本选区/焦点抢占（Shift 框选会带出蓝色选区）
                onMouseDown: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault() },
                onClick: (e) => onRowClick(e, f, group)
              },
                React.createElement('span', { className: 'gp-file-dot ' + gl.cls }, '•'),
                React.createElement('span', { className: 'gp-file-name' }, base),
                dir ? React.createElement('span', { className: 'gp-file-dir' }, dir) : null,
                f.orig ? React.createElement('span', { className: 'gp-file-orig', title: f.orig }, '← ' + (f.orig.replace(/\/+$/, '').split('/').pop() || f.orig)) : null,
                React.createElement('span', { className: 'gp-spacer' }),
                React.createElement('span', { className: 'gp-row-actions' },
                  React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardFile'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); discardFromRow(key, f.path, group) } }, icon('discard')),
                  isStaged
                    ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstageFromRow(key, f.path) } }, icon('minus'))
                    : React.createElement('button', { className: 'gp-icon-btn', title: tr('stage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stageFromRow(key, f.path) } }, icon('plus'))),
                React.createElement('span', { className: 'gp-file-badge ' + gl.cls }, gl.g))
            }))
        }

        // 批量操作（VS Code 语义，无独立工具栏）：多选后点击任一选中行的
        // 放弃/暂存/取消暂存按钮即作用于全部选中文件；点击未选中行的按钮仅作用于该行
        const inSelection = (key) => selKeys.has(key) && selCount > 0
        const stageFromRow = async (key, path) => {
          if (!inSelection(key)) { stage([path]); return }
          if ((await stage(selParts.unstaged.concat(selParts.untracked))) === 'ok') setSelKeys(new Set())
        }
        const unstageFromRow = async (key, path) => {
          if (!inSelection(key)) { unstage([path]); return }
          if ((await unstage(selParts.staged)) === 'ok') setSelKeys(new Set())
        }
        const discardFromRow = (key, path, group) => {
          if (inSelection(key)) askDiscardSelection()
          else askDiscard([path], group)
        }

        // 放弃更改确认弹窗（单行 / 组全部 / 多选批量统一入口；Esc 由上方分层处理关闭）
        const discardModal = confirmDiscard ? React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); setConfirmDiscard(null) } },
          React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' }, icon('warning', 15), tr('discardTitle')),
            React.createElement('div', { className: 'gp-modal-body' },
              React.createElement('div', { className: 'gp-confirm-summary' },
                fmt(confirmDiscard.count === 1 ? tr('discardConfirm1') : tr('discardConfirmN'), { n: confirmDiscard.count })),
              React.createElement('div', { className: 'gp-confirm-note gp-danger' }, tr('discardIrreversible')),
              confirmDiscard.byGroup.untracked.length > 0 ? React.createElement('div', { className: 'gp-confirm-note' }, tr('discardUntrackedNote')) : null,
              React.createElement('div', { className: 'gp-confirm-files' }, discardPreviewText(confirmDiscard))),
            React.createElement('div', { className: 'gp-modal-foot' },
              React.createElement('button', { className: 'gp-btn', onClick: () => setConfirmDiscard(null) }, tr('cancel')),
              React.createElement('button', { className: 'gp-btn gp-btn-danger', onClick: doDiscardConfirmed }, tr('discardOk'))))) : null

        // 危险操作确认弹窗（Reset / Clean）：结构同放弃更改弹窗，Esc 由上方分层处理关闭
        const DANGER_INFO = {
          'reset-soft': { title: tr('resetSoftTitle'), note: tr('resetSoftNote') },
          'reset-hard': { title: tr('resetHardTitle'), note: tr('resetHardNote') },
          'clean': { title: tr('cleanTitle'), note: tr('cleanNote') }
        }
        const dangerModal = confirmDanger ? React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); setConfirmDanger(null) } },
          React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' }, icon('warning', 15), DANGER_INFO[confirmDanger].title),
            React.createElement('div', { className: 'gp-modal-body' },
              React.createElement('div', { className: 'gp-confirm-note gp-danger' }, DANGER_INFO[confirmDanger].note)),
            React.createElement('div', { className: 'gp-modal-foot' },
              React.createElement('button', { className: 'gp-btn', onClick: () => setConfirmDanger(null) }, tr('cancel')),
              React.createElement('button', { className: 'gp-btn gp-btn-danger', disabled: !!busy, onClick: () => {
                const op = confirmDanger
                setConfirmDanger(null)
                if (op === 'clean') runWrite('clean', () => callRpc('clean', { repoId: repo.id, sessionId }))
                else runWrite('reset', () => callRpc('reset', { repoId: repo.id, mode: op === 'reset-hard' ? 'hard' : 'soft', sessionId }))
              } }, tr('dangerRun'))))) : null

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
              React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash-pop', () => callRpc('stashPop', { repoId: repo.id, ref: null, sessionId })) } }, tr('moreStashPop')),
              React.createElement('div', { className: 'gp-menu-sep' }),
              // 危险操作：弹确认窗（与放弃更改同款），确认后执行
              React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-soft') } }, tr('moreResetSoft')),
              React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-hard') } }, tr('moreResetHard')),
              React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('clean') } }, tr('moreClean'))
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

        // 确认弹窗用 fixed 定位，放在卡片外层（Fragment），避免任何卡片内堆叠上下文干扰
        return React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'gp-repo-card' }, head, body),
          discardModal,
          dangerModal)
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
        // 关闭动效（关闭相位由 diffSel.closing 携带，所有关闭入口统一走 requestCloseDiff）：
        // 标记 closing → 抽屉反向滑出（~240ms）→ finishCloseDiff 才真正卸载；期间点击别的
        // 文件会整体替换 diffSel（closing 复位），finishCloseDiff 检测到非 closing 相位即空操作，
        // 抽屉保持打开直接切换内容（与旧版「关闭中途换文件」的闪断行为说再见）
        const requestCloseDiff = React.useCallback(() => {
          setDiffSel((prev) => (prev && !prev.closing ? { ...prev, closing: true } : prev))
        }, [])
        const finishCloseDiff = React.useCallback(() => {
          setDiffSel((prev) => (prev && prev.closing ? null : prev))
        }, [])
        const [resizing, setResizing] = React.useState(false)
        // 折叠/展开滑动动效（复用 DiffDrawer 的相位模式，与 diff 抽屉同 240ms/曲线）：
        // 点击折叠不立即切换渲染形态，先进过渡相 —— 离场元素 translateX(100%) 右滑出屏、
        // 进场元素从右缘屏外滑入，两者同时在场 ~240ms；动效播完才写入 collapsed
        // （store + localStorage）并卸载离场元素。过渡相内忽略重复点击。
        const [collAnim, setCollAnim] = React.useState(null) // null | { dir: 'collapse' | 'expand', entered: bool }
        const collRafRef = React.useRef(0)
        const resizeRef = React.useRef(false)
        // 扫描请求序列号：丢弃过期响应，防止「初始无 root 的慢扫描」晚到覆盖
        // 「跟随 workspace 的快扫描」的成功结果（竞态会让面板显示错误的空列表）
        const scanSeqRef = React.useRef(0)

        // force=true 时绕过 host 端扫描缓存（手动「重新扫描」按钮）；跟随 workspace
        // 的自动扫描与手动选根目录都允许命中缓存（切换项目秒开的关键路径）
        const doScan = React.useCallback(async (root, force) => {
          const seq = ++scanSeqRef.current
          setScan((x) => ({ ...x, state: 'scanning', error: '' }))
          try {
            const res = await callRpc('scan', root ? (force ? { root, force: true } : { root }) : {})
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

        // 永远跟随当前工作空间：wsPath 变化即重扫（scanSeqRef 防慢扫描晚到竞态）；
        // 无工作空间时不发起扫描，主体渲染「未打开工作空间」空态
        React.useEffect(() => {
          if (wsPath && wsPath !== scan.root) doScan(wsPath)
        }, [wsPath, scan.root, doScan])

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

        // 面板关闭时同步关闭 diff 抽屉，避免下次打开面板时残留上次的 diff 选择
        React.useEffect(() => { if (!s.panelOpen) setDiffSel(null) }, [s.panelOpen])

        // 折叠/展开过渡相：双 rAF 先让进场元素的屏外初始帧完成一次绘制，再置 entered
        // 触发 transition（与 DiffDrawer 入场同法，根治首帧以终态闪现的问题）
        React.useEffect(() => {
          if (!collAnim || collAnim.entered) return
          collRafRef.current = requestAnimationFrame(() => {
            collRafRef.current = requestAnimationFrame(() => setCollAnim((a) => (a ? { ...a, entered: true } : a)))
          })
          return () => cancelAnimationFrame(collRafRef.current)
        }, [collAnim])

        // 过渡相收尾：240ms 滑入/滑出动效播完（对齐 .22s 过渡）才真正切换折叠态
        // （store + localStorage）并卸载离场元素；中途组件卸载则取消，不残留定时器
        React.useEffect(() => {
          if (!collAnim || !collAnim.entered) return
          return timer.timeout(() => {
            const toCollapsed = collAnim.dir === 'collapse'
            saveCollapsed(toCollapsed)
            store.set((st) => ({ ...st, collapsed: toCollapsed }))
            setCollAnim(null)
          }, 240)
        }, [collAnim])

        // 折叠：先关 diff 抽屉（旧语义保留），再进过渡相；过渡相内忽略重复点击
        const startCollapse = () => {
          if (collAnim) return
          setDiffSel(null)
          setCollAnim({ dir: 'collapse', entered: false })
        }
        const startExpand = () => { if (!collAnim) setCollAnim({ dir: 'expand', entered: false }) }

        if (!s.panelOpen) return null
        const diffRepo = diffSel ? scan.repos.find((r) => r.id === diffSel.repoId) : null

        const header = React.createElement('div', { className: 'gp-header' },
          React.createElement('button', { className: 'gp-title gp-title-btn', onClick: startCollapse }, icon('branch', 15), 'Git Panel'),
          wsPath ? React.createElement('span', { className: 'gp-ws-name', title: wsPath }, wsTitle || wsPath.split(/[\\/]/).filter(Boolean).pop()) : null,
          React.createElement('div', { className: 'gp-header-actions' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('rescan'), onClick: () => doScan(wsPath || scan.root, true) }, icon('refresh')),
            React.createElement('button', { className: 'gp-btn-icon', title: tr('openFolder'), disabled: !(wsPath || scan.root), onClick: () => {
              const p = wsPath || scan.root
              if (!p) return
              const failToast = (e) => pushToast('error', fmt(tr('openFolderFailed'), { e: e && e.message ? e.message : String(e) }))
              // 优先插件自己的 host RPC（explorer.exe 开新窗口，避开平台 Invoke-Item 激活
              // 不可见旧窗口的问题）；host 半体未重启仍是旧版时回退平台 workspaces.openPath
              callRpc('openInExplorer', { path: p }).then((r) => {
                if (r && r.ok) return
                if (r && typeof r.error === 'string' && r.error.indexOf('unknown method') === 0) {
                  const ws = workspaces || ctx.get('workspaces')
                  if (ws && typeof ws.openPath === 'function') { ws.openPath(p).catch(failToast); return }
                  pushToast('error', tr('openFolderUnavailable'))
                  return
                }
                pushToast('error', (r && r.error) || tr('openFolderUnavailable'))
              }).catch(failToast)
            } }, icon('folder')),
            React.createElement('button', { className: 'gp-btn-icon', title: tr('close'), onClick: () => store.set((st) => ({ ...st, panelOpen: false })) }, icon('close'))))

        const body = React.createElement('div', { className: 'gp-body' },
          !wsPath ? React.createElement('div', { className: 'gp-empty' }, tr('noWorkspace')) :
            scan.state === 'scanning' || scan.state === 'idle' ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), scan.state === 'idle' ? ' ' + tr('locating') : ' ' + tr('scanning')) :
            scan.state === 'error' ? React.createElement('div', { className: 'gp-empty' }, scan.error) :
              scan.repos.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('noRepos')) :
                scan.repos.map((r) => React.createElement(RepoCard, {
                  key: r.id, repo: r, sessionId, diffSel, onCloseDiff: requestCloseDiff,
                  // 普通点击行 = 单选该行并打开 diff；再次点击同一行（同 repo 同组同路径）=
                  // 进入关闭相位（抽屉滑出动效播完才卸载，见 requestCloseDiff/finishCloseDiff）
                  onOpenDiff: (repo2, f, group) => setDiffSel((prev) => prev && prev.repoId === repo2.id && prev.path === f.path && prev.group === group
                    ? { ...prev, closing: true }
                    : { repoId: repo2.id, path: f.path, group, x: f.x, y: f.y })
                })))

        // 折叠/展开渲染：稳态只渲染一种形态（panelOpen 语义不变，自动刷新轮询继续）；
        // 过渡相内面板与竖条同时在场 —— 离场元素 translateX(100%) 右滑出屏（禁指针），
        // 进场元素从右缘屏外滑入。diff 抽屉在折叠时已关闭（折叠动作里 setDiffSel(null)）。
        const collDir = collAnim ? collAnim.dir : null
        const collOn = !!(collAnim && collAnim.entered)
        const panelOff = collDir === 'collapse' ? collOn : collDir === 'expand' ? !collOn : false
        const railOff = collDir === 'collapse' ? !collOn : collDir === 'expand' ? collOn : false

        const rail = (s.collapsed || collDir === 'collapse') ? React.createElement('button', {
          className: 'gp-rail', title: tr('expandTitle'),
          style: { transform: railOff ? 'translateX(100%)' : 'none', pointerEvents: collDir === 'expand' ? 'none' : undefined },
          onClick: startExpand
        },
          icon('branch', 16),
          React.createElement('span', { className: 'gp-rail-label' }, 'Git Panel')) : null

        const panel = (!s.collapsed || collDir === 'expand') ? React.createElement('div', {
          className: 'gp-panel' + (resizing ? ' gp-noanim' : ''),
          style: { width: s.panelW + 'px', transform: panelOff ? 'translateX(100%)' : 'none', pointerEvents: collDir === 'collapse' ? 'none' : undefined }
        },
          React.createElement('div', {
            className: 'gp-resize' + (resizing ? ' gp-resize-active' : ''),
            title: tr('resizeTitle'),
            onPointerDown: (e) => { e.preventDefault(); resizeRef.current = true; setResizing(true) }
          }),
          header,
          React.createElement('div', { className: 'gp-main' }, body)) : null

        return React.createElement(React.Fragment, null,
          panel,
          rail,
          diffSel && diffRepo ? React.createElement(DiffDrawer, { repo: diffRepo, sel: diffSel, panelW: s.panelW, onClose: finishCloseDiff, onRequestClose: requestCloseDiff }) : null)
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
