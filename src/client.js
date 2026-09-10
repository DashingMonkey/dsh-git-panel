/**
 * git-panel — Client 半体
 *
 * 浏览器端 UI，全部使用 React.createElement（动态包不经过 JSX/TS 编译）。
 * 单文件形态约束：本文件被 scripts/build.mjs 按文本 marker 截取函数体打包
 * （动态包与 npm 包同源取用），因此保持单文件、单默认导出函数，不拆模块。
 *
 * 核心交互约定：
 *   - 全部图标为 16×16 扁平 SVG（stroke/fill + currentColor），无 emoji；
 *   - 「暂存即选择」：无 checkbox，文件行/分组行右侧悬停出现 ＋（暂存）/－（取消暂存），
 *     生成 / 提交 / 提交并推送只处理已暂存（Staged）的文件；
 *   - 变更分组最左侧 chevron 展开/收起，最右侧「放弃全部/放弃单个」+「暂存/取消暂存」；
 *     放弃更改（Discard，「U 形回旋曲箭头」填充图标，与刷新圆箭头明显区分）为不可逆
 *     操作：单文件/整组/多选批量统一先弹确认框（含文件数与预览），确认后执行（留审计）；
 *   - 提交区位于仓库卡片顶部；历史区图谱按 lane 循环配色、合并线为圆角肘形曲线，
 *     悬停行显示提交详情浮层，点击行内展开该提交的变更文件列表（手风琴式单开，
 *     可变行高虚拟滚动：前缀和 + 二分定位），点击文件复用 diff 抽屉看提交内差异；
 *   - diff 抽屉从面板左缘滑出（覆盖在聊天区上方，文件列表保持可见可直接切换文件）：
 *     双列行号、整行柔和红绿底色、sticky 分段头、+增/−删统计徽标、恒定自动换行；
 *     左右分栏（split）模式左右源/改后对照、配对修改行带 word 级中段高亮；全文（full）
 *     模式展示整个文件（改动行照常高亮、其余作上下文）；滚动条内侧 overview ruler
 *     红/绿色块按文档比例标出增删位置（悬停加宽、点击跳转居中）；左缘可拖拽调宽，
 *     Esc / 点遮罩关闭，开/关均为滑入/滑出动效（双 rAF 入场防首帧闪现）；
 *   - diff 抽屉图片预览：图片扩展名（png/jpg/gif/webp 等）改调 imageBlob 取旧/新两版
 *     data URL 并排自适应展示；点击任一图片进全屏 lightbox（1:1 原始尺寸、超出屏幕
 *     可滚动、棋盘格透明底、左右方向键切换新旧版本）；标签显示实测像素与文件大小；
 *     单图 8MB 上限；
 *   - 文件行多选：Ctrl/⌘+点击增删、Shift+点击按可见顺序范围选择（按仓库隔离），
 *     修饰键点击不切换 diff；多选后点任一选中行的 放弃/暂存/取消暂存 即作用于全部
 *     选中文件（放弃仍弹确认）；选中行带品牌色选中盒；操作成功或移组后自动剪枝；
 *   - 面板左缘可拖拽调整整体宽度；点击标题折叠为右侧 44px 竖条、点击竖条展开
 *     （面板与竖条交叉滑入/滑出，动效播完才切换形态）；
 *   - 布局模式（localStorage gp-layout，默认 dock）：dock 停靠 = 面板挂在对话右侧、
 *     对话区收窄让位（:has() 选中 [data-shell-overlay] 父级 frame 加 padding-right，
 *     :has() 缺失时 JS 几何写路径兜底，见 applyDockGeometry）；overlay 浮窗 = 覆盖
 *     对话上方不改变布局（旧版行为）；窄视口(<1200px)停靠临时退化浮窗；
 *     折叠竖条在宽视口复用同一挤压通道以 44px 让位（mini-dock，两种模式同此），
 *     避免盖住对话列右缘（会话头部 Session log 按钮等）；窄视口竖条维持覆盖；
 *     标题栏齿轮按钮打开「面板设置」弹窗即时切换；
 *   - 写操作（commit/pull/push/switch/stash/reset/clean）由用户点击直接执行
 *     （无审批门），仅 host 侧留审计记录。
 *   - 视图偏好（分栏/全文/抽屉宽/面板宽/折叠态）记忆在 localStorage，键名见各读写点。
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
 *     保住最深层目录），文件名仅自身超长才封顶省略；悬停 title 显示完整路径。
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
      //     （@deepseek-ai/dsh-client-connection 的通用 RPC 通道；Host 半体不再用
      //       connection.rpc.handle 注册，而是按 dsh-client-connection 挂 /api 的方式
      //       直接占用 webServer 的 /git-panel 前缀路由，信封与信任围栏完全一致，
      //       见 src/host.js 的 registerHttpChannel）
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

      const disposeCss = injectCss(`
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
   观感深浅改下方取值即可。
   声明必须挂 body 而非 :root：var() 代换发生在声明元素上，而宿主把 --dsw-* token
   定义在 body 层 —— 挂 :root 时代换取不到 token，--gp-pop-bg 解析为空值，亮色下
   三个弹层背景全部回落成 transparent（深色恰因挂在 body[data-ds-dark-theme] 上
   取得到 token 而幸免）。 */
body { --gp-pop-bg: var(--dsw-alias-bg-overlay); }
body[data-ds-dark-theme] { --gp-pop-bg: color-mix(in srgb, var(--dsw-alias-bg-overlay) 40%, #000); }
.gp-panel, .gp-panel * { box-sizing: border-box; }
/* UI 控件禁用文本选择（双击/拖动扩选在列表行上很丑）：
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
/* 工具栏 hover：图标不变色，周围垫一块更深的方形底色把图标扩住 */
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
/* 冲突计数：与提示条同色系，收起/折叠状态下也能一眼看出仓库处于冲突中 */
.gp-count-conflict { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
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
/* 悬停浮起（树列表行样式，section-title 与 file-row 同款）：背景高亮 + 细描边 + 柔和投影 */
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
/* 同 .gp-section-title 悬停策略 */
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
/* 冲突（未合并）状态：用 warn 色而非删除色——它等待用户决策，不是既成事实的删除 */
.gp-file-dot.gp-g-conflict, .gp-file-badge.gp-g-conflict { color: var(--dsw-alias-state-warn-primary); opacity: 1; }
/* 与抽屉头部同策略：文件名不先收缩（超长才被 max-width 封顶），目录独自让路；
   direction:rtl 让目录省略号落左侧，保留最深层目录（…lib/components）。 */
.gp-file-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto; max-width: 58%; color: #333333; }
body[data-ds-dark-theme] .gp-file-name { color: #e6e6e6; }
/* D（删除）类型文件：文件名加删除线，直观示意该文件将被删除（暂存/未暂存组均适用） */
.gp-file-name.gp-file-name-del { text-decoration: line-through; }
.gp-file-dir { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; direction: rtl; text-align: left; }
.gp-file-orig { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ===== 多选（Ctrl/Shift）与激活（diff 打开）行高亮：选中盒 =====
   1px 品牌色边框（box-shadow inset 实现，不占布局）+ 浅品牌底色，视觉明确且悬停不闪；
   置于 .gp-file-row:hover 规则之后：等特异性下后者胜出。 */
.gp-file-row.gp-file-sel, .gp-file-row.gp-file-active { background: var(--dsw-alias-interactive-bg-hover); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
/* 危险操作按钮（放弃更改确认） */
.gp-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: #ffffff; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
/* 深色错误色偏浅，白字不可读 —— 与 .gp-btn-primary / .gp-genmodel-selected 的深色覆盖同策略换深字 */
body[data-ds-dark-theme] .gp-btn-danger { color: #16181d; text-shadow: none; }
/* 悬停必须重新声明背景：按钮同时挂 .gp-btn 基类，其 :hover 灰底（特异性 0,3,0）
   会压过本类纯色底（0,1,0），灰底撞静态字色两主题都不可读。与 .gp-btn-primary
   的 hover 同构：底色锁定错误色，仅 filter 提亮。 */
.gp-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary); filter: brightness(1.12); }
/* 冲突提示条（仓库卡片内，置顶于变更分组之前）：说明解决动作 + 「完成合并 / 中止合并」出口。
   底色/描边用 warn 色低透明度叠层，与 .gp-btn-danger 的实心危险按钮形成层级：
   提示条是「正在发生的状态」，按钮是「会丢东西的动作」。
   color-mix 前各留一条普通声明兜底（同全文件其余 color-mix 用法）：不支持时仅退化为
   无叠层，若只写 color-mix 则底色与描边会一起消失、横幅语义整个丢掉。 */
.gp-conflict-bar { display: flex; align-items: center; gap: 7px; margin: 6px 8px; padding: 7px 9px; border-radius: 6px; font-size: 12.5px; line-height: 1.45; color: var(--dsw-alias-state-warn-primary); background: rgba(215,166,72,.12); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); box-shadow: inset 0 0 0 1px rgba(215,166,72,.38); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, transparent); }
.gp-conflict-text { flex: 1 1 auto; min-width: 0; }
.gp-conflict-abort, .gp-conflict-finish { flex: 0 0 auto; padding: 3px 8px; font-size: 12px; }
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
/* ===== 历史行内展开：展开行的内容列（顶栏 + 文件列表） ===== */
.gp-grow-col { flex: 1 1 auto; min-width: 0; align-self: stretch; display: flex; flex-direction: column; }
.gp-grow-bar { display: flex; align-items: center; gap: 6px; height: 26px; flex: 0 0 auto; min-width: 0; }
.gp-grow-files { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 4px 6px 2px; display: flex; flex-direction: column; }
.gp-grow-files-note { display: flex; align-items: center; gap: 6px; margin: auto 0; padding: 4px 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
/* 展开区文件行：状态徽标（复用 gp-diff-glyph 配色）+ 名称/目录 + 增删统计 */
.gp-gfile { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 6px 0 2px; border-radius: 4px; cursor: pointer; min-width: 0; }
.gp-gfile:hover { background: var(--dsw-alias-bg-layer-2); }
/* 与变更树文件行同款选中盒：当前 diff 抽屉打开的正是该提交文件时 */
.gp-gfile.gp-gfile-active { background: var(--dsw-alias-interactive-bg-hover); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.gp-gfile .gp-diff-glyph { width: 18px; height: 18px; font-size: 10px; }
.gp-gfile-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
.gp-gfile-dir { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
.gp-gfile-orig { font-size: 11px; color: var(--dsw-alias-label-tertiary); flex: 0 0 auto; }
.gp-gfile-stats { display: inline-flex; gap: 6px; flex: 0 0 auto; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 11px; font-variant-numeric: tabular-nums; }
.gp-gf-add { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.gp-gf-del { color: var(--dsw-alias-state-error-primary); font-weight: 600; }
/* ===== 提交详情悬浮卡：分段卡片，段间细线分隔 ===== */
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
.gp-diff-body-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.gp-diff-body { flex: 1; min-width: 0; min-height: 0; overflow: auto; position: relative; }
/* ===== diff 滚动条 overview ruler：滚动条内侧细条，
   红/绿色块按「行位置 ÷ 内容总高」比例标出增删行位置（比例天然与滚动同步）；
   悬停加宽便于点击，点击跳转到对应位置；色块最小 2px 保证可见 ===== */
.gp-diff-ruler { position: absolute; top: 2px; bottom: 2px; width: 4px; border-radius: 2px; z-index: 3; cursor: pointer; transition: width .12s ease; }
.gp-diff-ruler:hover { width: 9px; }
.gp-diff-ruler-mark { position: absolute; left: 0; right: 0; min-height: 2px; border-radius: 1px; opacity: .9; }
.gp-drm-add { background: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 85%, transparent); }
.gp-drm-del { background: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 85%, transparent); }
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
/* 冲突标记行（<<<<<<< / ======= / >>>>>>>）：冲突组是整文件合成的新增 diff，标记行与正文
   同为绿色就找不到冲突块边界。warn 色 + 浅底，让它从成片绿里跳出来（前一条灰声明兜底）。 */
.gp-diff-row.gp-dr-mark { background: rgba(215,166,72,.10); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.gp-diff-row.gp-dr-mark .gp-diff-code { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.gp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 400; pointer-events: auto; }
.gp-modal { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--gp-border-2); border-radius: 10px; width: 1180px; max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.gp-modal-sm { width: 440px; }
.gp-genmodel-scroll { max-height: 42vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 2px; }
.gp-genmodel-group { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.gp-genmodel-group-title { font-size: 11px; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em; padding: 4px 8px 2px; }
.gp-genmodel-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border-radius: 7px; background: none; border: none; color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; }
.gp-genmodel-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-genmodel-item.gp-genmodel-selected { background: var(--dsw-alias-brand-primary); color: #ffffff; }
/* 深色品牌主色偏浅，白字不可读 —— 与 .gp-btn-primary 的深色覆盖同策略换深字 */
body[data-ds-dark-theme] .gp-genmodel-item.gp-genmodel-selected { color: #16181d; }
.gp-genmodel-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.gp-genmodel-item.gp-genmodel-selected .gp-genmodel-meta { color: rgba(255,255,255,.78); }
body[data-ds-dark-theme] .gp-genmodel-item.gp-genmodel-selected .gp-genmodel-meta { color: rgba(22,24,29,.72); }
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
/* ===== diff 抽屉：图片预览模式 =====
   棋盘格透明底（两层 45° 渐变拼 16px 格）供 png/gif/webp 透明区域可见；
   并排缩略视图自适应宽度，点击任一图片进全屏 lightbox 看 1:1 原始尺寸。 */
:root { --gp-checker: linear-gradient(45deg, rgba(128,128,128,.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.16) 75%), linear-gradient(45deg, rgba(128,128,128,.16) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.16) 75%); }
.gp-img-wrap { padding: 12px; }
.gp-img-row { display: flex; gap: 10px; align-items: flex-start; }
.gp-img-row-one .gp-img-cell { flex: 1 1 auto; max-width: 100%; }
.gp-img-cell { flex: 1 1 50%; min-width: 0; }
.gp-img-label { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 6px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.gp-img-tag { flex: none; font-weight: 700; font-size: 10.5px; line-height: 1.7; padding: 0 6px; border-radius: 4px; }
.gp-img-tag-old { color: var(--dsw-alias-state-error-primary); background: rgba(248,81,73,.14); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.gp-img-tag-new { color: var(--dsw-alias-state-success-primary); background: rgba(46,160,67,.16); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); }
.gp-img-dim { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.gp-img-note { padding: 8px 10px; border: 1px dashed var(--gp-border-1); border-radius: 6px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; background: var(--dsw-alias-bg-layer-2); overflow-wrap: anywhere; }
.gp-img-box { border: 1px solid var(--gp-border-1); border-radius: 6px; padding: 8px; display: flex; justify-content: center; background-color: var(--dsw-alias-bg-layer-2); background-image: var(--gp-checker); background-size: 16px 16px; background-position: 0 0, 8px 8px; cursor: zoom-in; }
.gp-img-box img { max-width: 100%; height: auto; display: block; }
/* 全屏 lightbox：fixed 覆盖层（z-index 高于 modal 400，低于 toast 500）；
   图片 1:1 原始尺寸（max-width:none），小于屏幕时 flex+margin:auto 居中、
   超出时滚动容器滚动；棋盘格底贯穿；顶部信息条含版本徽标与关闭按钮 */
.gp-lightbox { position: fixed; inset: 0; z-index: 420; background: rgba(0,0,0,.62); display: flex; flex-direction: column; }
.gp-lightbox-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; color: #fff; }
.gp-lightbox-head .gp-img-dim { color: rgba(255,255,255,.72); }
.gp-lightbox-switch { font-size: 11.5px; color: rgba(255,255,255,.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-lightbox-close { margin-left: auto; flex: none; }
.gp-lightbox-close button { background: rgba(255,255,255,.14); border: none; border-radius: 6px; color: #fff; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.gp-lightbox-close button:hover { background: rgba(255,255,255,.26); }
.gp-lightbox-stage { flex: 1; min-height: 0; overflow: auto; display: flex; background-image: var(--gp-checker); background-size: 16px 16px; background-position: 0 0, 8px 8px; }
.gp-lightbox-stage img { display: block; max-width: none; width: auto; height: auto; margin: auto; }
/* ===== 布局模式：侧边栏停靠（dock）挤压对话区 =====
   DSH 外壳 AppFrame 是三栏 grid（sidebar | center | details），CSS-module hash 类名
   跨版本不稳定，但其 frame 内覆盖层带稳定属性 [data-shell-overlay]（ui-layout 产物）
   —— frame 即它的直接父级。:has() 选中 frame 加 padding-right，grid 内容区收窄、
   minmax(0,1fr) 的对话列自动让位（VS Code Secondary Sidebar 式 layout push）。
   box-sizing 必须显式声明：frame 为 height:100% 的块级元素，若处 content-box，
   水平 padding 会把总宽撑出视口（frame overflow:hidden 会裁掉左侧 sidebar）。
   transition 必须合并声明：直接写 transition 会整体覆盖 frame 自带的
   grid-template-columns 过渡。padding 动画期间逐帧重排 → 对话列跟随连续收缩。
   :has() 不可用的环境由 JS 兜底（applyDockGeometry），本组属性照常由 body 驱动。
   折叠竖条（.gp-rail，fixed 全高覆盖层）复用同一挤压通道：折叠稳态/收进相以
   --gp-dock-w=44px（RAIL_W）顶替面板宽让位，否则竖条会盖住对话列右缘（会话头部
   Session log 等操作、消息与输入框右段）。折叠稳态下面板不渲染，下面两条
   data-gp-dock 附属规则（去投影、Toast 避让）只影响过渡相与 Toast 位置（折叠时
   Toast 落到竖条左侧 58px 处，正合预期）。 */
body[data-gp-dock="1"] div:has(> [data-shell-overlay]) {
  box-sizing: border-box;
  padding-right: var(--gp-dock-w, 520px);
  transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out), padding-right .22s cubic-bezier(.2, .8, .2, 1);
}
/* 拖拽调宽期间关闭 padding 过渡（对齐 .gp-noanim 惯例，避免跟手延迟） */
body[data-gp-dock-noanim="1"] div:has(> [data-shell-overlay]) { transition: none !important; }
/* 停靠态面板是布局的一部分：去投影（浮窗模式保留投影提供深度感） */
body[data-gp-dock="1"] .gp-panel { box-shadow: none; }
/* 停靠态 Toast 栈避开面板，落到面板左侧 */
body[data-gp-dock="1"] .gp-toast-stack { right: calc(var(--gp-dock-w, 520px) + 14px); }
/* ===== 布局模式设置弹窗：单选卡片（纯 CSS 圆形单选点，无嵌套交互元素） ===== */
.gp-layout-opt { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--gp-border-2); border-radius: 8px; padding: 11px 12px; cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; margin-bottom: 8px; font-family: inherit; }
.gp-layout-opt:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-layout-opt.gp-layout-on { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.gp-layout-radio { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--gp-border-2); margin-top: 2px; position: relative; transition: border-color .12s ease; }
.gp-layout-opt.gp-layout-on .gp-layout-radio { border-color: var(--dsw-alias-brand-primary); }
.gp-layout-opt.gp-layout-on .gp-layout-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }
.gp-layout-opt-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.gp-layout-opt-title { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.gp-layout-opt-desc { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.gp-layout-default-badge { font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 7px; border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); flex: none; line-height: 1.6; }
.gp-layout-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; margin: 6px 0 0; }
`)

      // ============ 图标集：VS Code codicons 官方填充字形（fill: currentColor） ============
      // 来源：https://github.com/microsoft/vscode-codicons （许可 CC-BY-4.0）。
      // 全套统一为 codicon 填充字形 —— 此前混用三种画法（codicon 细线填充的 refresh/discard、
      // 1.5px 描边的 folder 等、实心填充的 gear/person），标题栏「重新扫描 / 打开工作空间 /
      // 设置」粗细依次递减明显不齐；codicon 整套同网格设计，视觉粗细天然一致。
      // 无完全对应官方图形的语义映射：pull→repo-pull、split→split-horizontal、
      // unified→list-flat、fullDoc→file、sparkles→sparkle。
      // vb：官方源非 16×16 网格时的 viewBox（仅 gear/settings-gear 为 24×24）。
      // f: 填充 path；渲染器保留 p（stroke）/ c（circle）能力，供后续自定义图标使用。
      const ICONS = {
        plus: { f: ['M8 1.5C8 1.22386 7.77614 1 7.5 1C7.22386 1 7 1.22386 7 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7V13.5C7 13.7761 7.22386 14 7.5 14C7.77614 14 8 13.7761 8 13.5V8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H8V1.5Z'] },
        minus: { f: ['M1 7.5C1 7.22386 1.22386 7 1.5 7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H1.5C1.22386 8 1 7.77614 1 7.5Z'] },
        chevronRight: { f: ['M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z'] },
        chevronDown: { f: ['M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z'] },
        close: { f: ['M13.85 13.1502C14.05 13.3502 14.05 13.6602 13.85 13.8602C13.75 13.9602 13.62 14.0102 13.5 14.0102C13.38 14.0102 13.24 13.9602 13.15 13.8602L8 8.71023L2.85 13.8602C2.75 13.9602 2.62 14.0102 2.5 14.0102C2.38 14.0102 2.24 13.9602 2.15 13.8602C1.95 13.6602 1.95 13.3502 2.15 13.1502L7.3 8.00023L2.15 2.85023C1.95 2.65023 1.95 2.34023 2.15 2.14023C2.35 1.94023 2.66 1.94023 2.86 2.14023L8.01 7.29023L13.16 2.14023C13.36 1.94023 13.67 1.94023 13.87 2.14023C14.07 2.34023 14.07 2.65023 13.87 2.85023L8.72 8.00023L13.87 13.1502H13.85Z'] },
        check: { f: ['M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z'] },
        refresh: { f: ['M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z'] },
        folder: { f: ['M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V11.5C15 12.8807 13.8807 14 12.5 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM2 7V11.5C2 12.3284 2.67157 13 3.5 13H12.5C13.3284 13 14 12.3284 14 11.5V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2Z'] },
        ellipsis: { f: ['M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z'] },
        dot: { f: ['M8 4C8.36719 4 8.72135 4.04818 9.0625 4.14453C9.40365 4.23828 9.72135 4.3724 10.0156 4.54688C10.3125 4.72135 10.582 4.93099 10.8242 5.17578C11.069 5.41797 11.2786 5.6875 11.4531 5.98438C11.6276 6.27865 11.7617 6.59635 11.8555 6.9375C11.9518 7.27865 12 7.63281 12 8C12 8.36719 11.9518 8.72135 11.8555 9.0625C11.7617 9.40365 11.6276 9.72266 11.4531 10.0195C11.2786 10.3138 11.069 10.5833 10.8242 10.8281C10.582 11.0703 10.3125 11.2786 10.0156 11.4531C9.72135 11.6276 9.40365 11.763 9.0625 11.8594C8.72135 11.9531 8.36719 12 8 12C7.63281 12 7.27865 11.9531 6.9375 11.8594C6.59635 11.763 6.27734 11.6276 5.98047 11.4531C5.6862 11.2786 5.41667 11.0703 5.17188 10.8281C4.92969 10.5833 4.72135 10.3138 4.54688 10.0195C4.3724 9.72266 4.23698 9.40365 4.14062 9.0625C4.04688 8.72135 4 8.36719 4 8C4 7.63281 4.04688 7.27865 4.14062 6.9375C4.23698 6.59635 4.3724 6.27865 4.54688 5.98438C4.72135 5.6875 4.92969 5.41797 5.17188 5.17578C5.41667 4.93099 5.6862 4.72135 5.98047 4.54688C6.27734 4.3724 6.59635 4.23828 6.9375 4.14453C7.27865 4.04818 7.63281 4 8 4Z'] },
        branch: { f: ['M14 5.5C14 4.121 12.879 3 11.5 3C10.121 3 9 4.121 9 5.5C9 6.682 9.826 7.669 10.93 7.928C10.744 8.546 10.177 9 9.5 9H6.5C5.935 9 5.419 9.195 5 9.512V4.949C6.14 4.717 7 3.707 7 2.5C7 1.121 5.879 0 4.5 0C3.121 0 2 1.121 2 2.5C2 3.708 2.86 4.717 4 4.949V11.05C2.86 11.282 2 12.292 2 13.499C2 14.878 3.121 15.999 4.5 15.999C5.879 15.999 7 14.878 7 13.499C7 12.317 6.174 11.33 5.07 11.071C5.256 10.453 5.823 9.999 6.5 9.999H9.5C10.723 9.999 11.74 9.115 11.954 7.953C13.116 7.738 14 6.723 14 5.5ZM3 2.5C3 1.673 3.673 1 4.5 1C5.327 1 6 1.673 6 2.5C6 3.327 5.327 4 4.5 4C3.673 4 3 3.327 3 2.5ZM6 13.5C6 14.327 5.327 15 4.5 15C3.673 15 3 14.327 3 13.5C3 12.673 3.673 12 4.5 12C5.327 12 6 12.673 6 13.5ZM11.5 7C10.673 7 10 6.327 10 5.5C10 4.673 10.673 4 11.5 4C12.327 4 13 4.673 13 5.5C13 6.327 12.327 7 11.5 7Z'] },
        person: { f: ['M6 5C6 3.89543 6.89543 3 8 3C9.10457 3 10 3.89543 10 5C10 6.10457 9.10457 7 8 7C6.89543 7 6 6.10457 6 5ZM5.49998 8L10.5 8C11.3284 8 12 8.67157 12 9.5C12 10.6161 11.541 11.5103 10.7879 12.1148C10.0466 12.7098 9.05308 13 8 13C6.94692 13 5.95342 12.7098 5.21215 12.1148C4.45897 11.5103 4 10.6161 4 9.5C4 8.67161 4.67156 8 5.49998 8ZM8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0ZM1 8C1 4.13401 4.13401 1 8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8Z'] },
        gear: { f: ['M12 9C10.3425 9 9.00002 10.3425 9.00002 12C9.00002 13.6575 10.3425 15 12 15C13.6575 15 15 13.6575 15 12C15 10.3425 13.6575 9 12 9ZM12 13.5C11.172 13.5 10.5 12.828 10.5 12C10.5 11.172 11.172 10.5 12 10.5C12.828 10.5 13.5 11.172 13.5 12C13.5 12.828 12.828 13.5 12 13.5ZM21.8475 14.5725L19.9185 12.942C19.8675 12.8985 19.8195 12.8505 19.776 12.7995C19.332 12.279 19.3965 11.5005 19.9185 11.058L21.8475 9.4275C22.0395 9.2655 22.113 9.0045 22.0365 8.766C21.579 7.3545 20.823 6.06 19.8285 4.962C19.7085 4.83 19.5405 4.758 19.368 4.758C19.2975 4.758 19.227 4.77 19.1595 4.794L16.779 5.6415C16.716 5.664 16.65 5.682 16.584 5.694C16.509 5.7075 16.434 5.715 16.3605 5.715C15.7725 5.715 15.2505 5.298 15.141 4.701L14.6865 2.223C14.6415 1.977 14.451 1.782 14.205 1.7295C13.485 1.5765 12.7485 1.5 12.0015 1.5C11.2545 1.5 10.5165 1.578 9.79652 1.7295C9.55052 1.782 9.36002 1.977 9.31502 2.223L8.86202 4.701C8.85002 4.767 8.83202 4.8315 8.80952 4.8945C8.62802 5.4 8.15102 5.715 7.64102 5.715C7.50302 5.715 7.36202 5.691 7.22402 5.643L4.84352 4.7955C4.77602 4.7715 4.70402 4.7595 4.63502 4.7595C4.46252 4.7595 4.29452 4.8315 4.17452 4.9635C3.17852 6.0615 2.42402 7.356 1.96502 8.7675C1.88702 9.006 1.96202 9.267 2.15402 9.429L4.08302 11.0595C4.13402 11.103 4.18202 11.151 4.22552 11.202C4.66952 11.7225 4.60502 12.501 4.08302 12.9435L2.15402 14.574C1.96202 14.736 1.88852 14.997 1.96502 15.2355C2.42252 16.647 3.17852 17.9415 4.17452 19.0395C4.29452 19.1715 4.46252 19.2435 4.63502 19.2435C4.70552 19.2435 4.77602 19.2315 4.84352 19.2075L7.22402 18.36C7.28702 18.3375 7.35302 18.3195 7.41902 18.3075C7.49402 18.294 7.56902 18.288 7.64252 18.288C8.23052 18.288 8.75252 18.705 8.86202 19.302L9.31502 21.78C9.36002 22.026 9.55052 22.221 9.79652 22.2735C10.5165 22.4265 11.2545 22.503 12.0015 22.503C12.7485 22.503 13.4865 22.425 14.205 22.2735C14.451 22.221 14.6415 22.026 14.6865 21.78L15.141 19.302C15.153 19.236 15.171 19.1715 15.1935 19.1085C15.375 18.603 15.852 18.288 16.362 18.288C16.5 18.288 16.641 18.312 16.779 18.36L19.158 19.2075C19.227 19.2315 19.2975 19.2435 19.3665 19.2435C19.539 19.2435 19.707 19.1715 19.827 19.0395C20.823 17.9415 21.5775 16.647 22.035 15.2355C22.113 14.997 22.038 14.736 21.846 14.574L21.8475 14.5725ZM19.092 17.589L17.2815 16.944C16.9845 16.839 16.6755 16.785 16.362 16.785C15.2085 16.785 14.1705 17.514 13.782 18.5985C13.731 18.738 13.6935 18.882 13.6665 19.029L13.3215 20.9055C12.8865 20.9685 12.444 21 12.0015 21C11.559 21 11.1165 20.9685 10.68 20.904L10.3365 19.0275C10.098 17.727 8.96552 16.7835 7.64252 16.7835C7.48052 16.7835 7.31552 16.7985 7.14902 16.8285C7.00352 16.8555 6.86102 16.893 6.72002 16.9425L4.90952 17.5875C4.35752 16.896 3.91652 16.1385 3.59102 15.321L5.05202 14.0865C5.61152 13.614 5.95202 12.951 6.01202 12.222C6.07202 11.493 5.84252 10.785 5.36702 10.227C5.27102 10.1145 5.16452 10.008 5.05202 9.912L3.59102 8.6775C3.91652 7.86 4.35752 7.101 4.90952 6.411L6.72002 7.056C7.01702 7.161 7.32602 7.215 7.64102 7.215C8.79452 7.215 9.83252 6.486 10.221 5.4015C10.272 5.2605 10.3095 5.1165 10.3365 4.971L10.68 3.0945C11.1165 3.0315 11.559 2.9985 12.0015 2.9985C12.444 2.9985 12.8865 3.03 13.3215 3.093L13.665 4.9695C13.9035 6.27 15.036 7.2135 16.359 7.2135C16.521 7.2135 16.686 7.1985 16.851 7.1685C16.9965 7.1415 17.1405 7.104 17.2815 7.0545L19.092 6.4095C19.644 7.0995 20.085 7.8585 20.4105 8.676L18.951 9.9105C18.3915 10.383 18.0495 11.046 17.991 11.775C17.931 12.504 18.1605 13.2135 18.636 13.77C18.7335 13.884 18.8385 13.989 18.9525 14.085L20.4135 15.3195C20.088 16.137 19.647 16.896 19.095 17.586L19.092 17.589Z'], vb: '0 0 24 24' },
        sparkles: { f: ['M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM4.00746 6.26448L3.15246 5.99948L4.01646 5.71848C4.41071 5.58184 4.76826 5.35637 5.06146 5.05948C5.35281 4.76039 5.57294 4.39943 5.70546 4.00348L5.97046 3.14448L6.25046 4.00648C6.38349 4.40638 6.60809 4.76969 6.90636 5.06744C7.20463 5.36519 7.56833 5.58915 7.96846 5.72148L8.84846 5.99048L7.98746 6.27048C7.58707 6.40272 7.22321 6.62691 6.92505 6.92507C6.62689 7.22324 6.4027 7.58709 6.27046 7.98748L6.00546 8.84448L5.72646 7.98548C5.63026 7.69329 5.48483 7.41968 5.29646 7.17648C5.22699 7.08766 5.15254 7.00286 5.07346 6.92248C4.7738 6.62366 4.4089 6.39842 4.00746 6.26448ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515ZM9.62035 11.0585L9.44235 10.9995L9.62635 10.9355C9.92811 10.8305 10.2018 10.6578 10.4264 10.4305C10.6528 10.2015 10.8238 9.92374 10.9264 9.61848L10.9844 9.44048L11.0434 9.62148C11.1453 9.92819 11.3175 10.2069 11.5461 10.4353C11.7748 10.6638 12.0536 10.8357 12.3604 10.9375L12.5554 11.0005L12.3754 11.0595C12.068 11.1617 11.7888 11.3344 11.5601 11.5637C11.3314 11.7931 11.1596 12.0728 11.0584 12.3805L10.9994 12.5615L10.9414 12.3805C10.84 12.0721 10.6676 11.7919 10.4382 11.5623C10.2088 11.3326 9.92863 11.1601 9.62035 11.0585Z'] },
        arrowUp: { f: ['M13.854 7.14576L8.85401 2.14576C8.65901 1.95076 8.34201 1.95076 8.14701 2.14576L3.14601 7.14576C2.95101 7.34076 2.95101 7.65776 3.14601 7.85276C3.34101 8.04776 3.65801 8.04776 3.85301 7.85276L7.99901 3.70676V13.4998C7.99901 13.7758 8.22301 13.9998 8.49901 13.9998C8.77501 13.9998 8.99901 13.7758 8.99901 13.4998V3.70676L13.145 7.85276C13.243 7.95076 13.371 7.99876 13.499 7.99876C13.627 7.99876 13.755 7.94976 13.853 7.85276C14.048 7.65776 14.048 7.34076 13.853 7.14576H13.854Z'] },
        arrowDown: { f: ['M13.854 8.146C13.659 7.951 13.342 7.951 13.147 8.146L9.00096 12.292V2.5C9.00096 2.224 8.77696 2 8.50096 2C8.22496 2 8.00096 2.224 8.00096 2.5V12.293L3.85496 8.147C3.65996 7.952 3.34296 7.952 3.14796 8.147C2.95296 8.342 2.95296 8.659 3.14796 8.854L8.14796 13.854C8.24596 13.952 8.37396 14 8.50196 14C8.62996 14 8.75796 13.951 8.85596 13.854L13.856 8.854C14.051 8.659 14.051 8.342 13.856 8.147L13.854 8.146Z'] },
        pull: { f: ['M4.85 6.15C4.755 6.05 4.627 6 4.5 6C4.372 6 4.245 6.05 4.15 6.15C4.05 6.245 4 6.373 4 6.5C4 6.627 4.05 6.755 4.15 6.85L7.15 9.85C7.245 9.95 7.372 10 7.5 10C7.628 10 7.755 9.95 7.85 9.85L10.85 6.85C10.95 6.755 11 6.628 11 6.5C11 6.372 10.95 6.245 10.85 6.15C10.755 6.05 10.627 6 10.5 6C10.373 6 10.245 6.05 10.15 6.15L8 8.29V1.5C8 1.22 7.78 1 7.5 1C7.22 1 7 1.22 7 1.5V8.29L4.85 6.15Z', 'M9.95 13H12.5C12.78 13 13 13.22 13 13.5C13 13.78 12.78 14 12.5 14H9.95C9.72 15.14 8.71 16 7.5 16C6.29 16 5.28 15.14 5.05 14H2.5C2.22 14 2 13.78 2 13.5C2 13.22 2.22 13 2.5 13H5.05C5.28 11.86 6.29 11 7.5 11C8.71 11 9.72 11.86 9.95 13ZM6.09 14C6.29 14.58 6.85 15 7.5 15C8.15 15 8.71 14.58 8.91 14C8.97 13.84 9 13.68 9 13.5C9 13.32 8.97 13.16 8.91 13C8.71 12.42 8.15 12 7.5 12C6.85 12 6.29 12.42 6.09 13C6.03 13.16 6 13.32 6 13.5C6 13.68 6.03 13.84 6.09 14Z'] },
        history: { f: ['M7.99909 3C10.7605 3 12.9991 5.23858 12.9991 8C12.9991 10.7614 10.7605 13 7.99909 13C5.39117 13 3.2491 11.003 3.0195 8.45512C2.99471 8.1801 2.75167 7.97723 2.47664 8.00202C2.20161 8.0268 1.99875 8.26985 2.02353 8.54488C2.29916 11.6035 4.86898 14 7.99909 14C11.3128 14 13.9991 11.3137 13.9991 8C13.9991 4.68629 11.3128 2 7.99909 2C6.20656 2 4.59815 2.78613 3.49909 4.03138V2.5C3.49909 2.22386 3.27524 2 2.99909 2C2.72295 2 2.49909 2.22386 2.49909 2.5V5.5C2.49909 5.77614 2.72295 6 2.99909 6H3.08812C3.09498 6.00014 3.10184 6.00014 3.10868 6H5.99909C6.27524 6 6.49909 5.77614 6.49909 5.5C6.49909 5.22386 6.27524 5 5.99909 5H3.99863C4.91128 3.78495 6.36382 3 7.99909 3ZM7.99909 5.5C7.99909 5.22386 7.77524 5 7.49909 5C7.22295 5 6.99909 5.22386 6.99909 5.5V8.5C6.99909 8.77614 7.22295 9 7.49909 9H9.49909C9.77524 9 9.99909 8.77614 9.99909 8.5C9.99909 8.22386 9.77524 8 9.49909 8H7.99909V5.5Z'] },
        warning: { f: ['M14.831 11.965L9.206 1.714C8.965 1.274 8.503 1 8 1C7.497 1 7.035 1.274 6.794 1.714L1.169 11.965C1.059 12.167 1 12.395 1 12.625C1 13.383 1.617 14 2.375 14H13.625C14.383 14 15 13.383 15 12.625C15 12.395 14.941 12.167 14.831 11.965ZM13.625 13H2.375C2.168 13 2 12.832 2 12.625C2 12.561 2.016 12.5 2.046 12.445L7.671 2.195C7.736 2.075 7.863 2 8 2C8.137 2 8.264 2.075 8.329 2.195L13.954 12.445C13.984 12.501 14 12.561 14 12.625C14 12.832 13.832 13 13.625 13ZM8.75 11.25C8.75 11.664 8.414 12 8 12C7.586 12 7.25 11.664 7.25 11.25C7.25 10.836 7.586 10.5 8 10.5C8.414 10.5 8.75 10.836 8.75 11.25ZM7.5 9V5.5C7.5 5.224 7.724 5 8 5C8.276 5 8.5 5.224 8.5 5.5V9C8.5 9.276 8.276 9.5 8 9.5C7.724 9.5 7.5 9.276 7.5 9Z'] },
        discard: { f: ['M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z'] },
        // diff 抽屉头部视图切换：分栏 / 单栏 / 全文
        split: { f: ['M12.5 1H3.5C2.122 1 1 2.122 1 3.5V12.5C1 13.878 2.122 15 3.5 15H12.5C13.878 15 15 13.878 15 12.5V3.5C15 2.122 13.878 1 12.5 1ZM2 12.5V3.5C2 2.673 2.673 2 3.5 2H7.5V14H3.5C2.673 14 2 13.327 2 12.5ZM14 12.5C14 13.327 13.327 14 12.5 14H8.5V2H12.5C13.327 2 14 2.673 14 3.5V12.5Z'] },
        unified: { f: ['M2 3.5C2 3.224 2.224 3 2.5 3H10.5C10.776 3 11 3.224 11 3.5C11 3.776 10.776 4 10.5 4H2.5C2.224 4 2 3.776 2 3.5ZM13.5 6H2.5C2.224 6 2 6.224 2 6.5C2 6.776 2.224 7 2.5 7H13.5C13.776 7 14 6.776 14 6.5C14 6.224 13.776 6 13.5 6ZM9.5 9H2.5C2.224 9 2 9.224 2 9.5C2 9.776 2.224 10 2.5 10H9.5C9.776 10 10 9.776 10 9.5C10 9.224 9.776 9 9.5 9Z', 'M2.5 12H11.5C11.776 12 12 12.224 12 12.5C12 12.776 11.776 13 11.5 13H2.5C2.224 13 2 12.776 2 12.5C2 12.224 2.224 12 2.5 12Z'] },
        fullDoc: { f: ['M5 1C3.89543 1 3 1.89543 3 3V13C3 14.1046 3.89543 15 5 15H11C12.1046 15 13 14.1046 13 13V5.41421C13 5.01639 12.842 4.63486 12.5607 4.35355L9.64645 1.43934C9.36514 1.15804 8.98361 1 8.58579 1H5ZM4 3C4 2.44772 4.44772 2 5 2H8V4.5C8 5.32843 8.67157 6 9.5 6H12V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V3ZM11.7929 5H9.5C9.22386 5 9 4.77614 9 4.5V2.20711L11.7929 5Z'] }
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
        return React.createElement('svg', { width: size, height: size, viewBox: spec.vb || '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: '0 0 auto' } }, children)
      }
      const icon = (name, size, sw) => React.createElement(Icon, { name, size, sw })

      // localStorage 偏好读写：数值带 [min, max] 钳制（写入端同样钳制，防止读取端
      // 丢弃越界值）；布尔以 '1'/'0' 记忆；字符串白名单校验；异常（隐私模式等）
      // 静默退默认值。
      // 键名：gp-panel-w（面板宽）/ gp-diff-w（抽屉宽）/ gp-diff-split（分栏）/
      // gp-diff-full（全文）/ gp-collapsed（折叠态）/ gp-layout（布局模式：dock 停靠 / overlay 浮窗）
      const prefInt = (key, min, max, def) => {
        try {
          const v = parseInt(window.localStorage.getItem(key), 10)
          if (v >= min && v <= max) return v
        } catch (e) { /* ignore */ }
        return def
      }
      const savePrefInt = (key, min, max, v) => {
        try { window.localStorage.setItem(key, String(Math.min(max, Math.max(min, v)))) } catch (e) { /* ignore */ }
      }
      const prefBool = (key, def) => {
        try {
          const v = window.localStorage.getItem(key)
          return v === null ? def : v === '1'
        } catch (e) { return def }
      }
      const savePrefBool = (key, v) => {
        try { window.localStorage.setItem(key, v ? '1' : '0') } catch (e) { /* ignore */ }
      }
      // 字符串偏好：值必须落在白名单内（防手改 localStorage 注入任意值），否则退默认
      const prefStr = (key, allowed, def) => {
        try {
          const v = window.localStorage.getItem(key)
          if (allowed.indexOf(v) >= 0) return v
        } catch (e) { /* ignore */ }
        return def
      }
      const savePrefStr = (key, v) => {
        try { window.localStorage.setItem(key, v) } catch (e) { /* ignore */ }
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
      const LAYOUT_MODES = ['dock', 'overlay']
      const store = createStore({ panelOpen: false, toasts: [], refreshTick: 0, lastOp: null, lastOpRepoId: null, panelW: prefInt('gp-panel-w', 380, 2400, 520), collapsed: prefBool('gp-collapsed', false), layout: prefStr('gp-layout', LAYOUT_MODES, 'dock') })

      // ============ 国际化：跟随 DSH 语言设置（locale.preference）自动切换 中文 / English ============
      const localeSvc = ctx.get('locale')
      let lang = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale().active : 'zh'
      if (lang !== 'en') lang = 'zh'
      const TEXTS = {
        zh: {
          groupStaged: '暂存的更改', groupChanges: '更改', groupUntracked: '未跟踪的更改', groupConflicted: '冲突（未解决）', history: '历史',
          rulesLoadFailed: '读取规则失败', reading: '(读取中…)', saved: '已保存', saveFailed: '保存失败', saveFailedWith: '保存失败: {e}',
          scopeSwitchFailed: '切换规则来源失败',
          validationNoSys: '校验失败: 缺少 system_prompt', validationNoUser: '校验失败: 缺少 user_context',
          restoredDefaults: '已恢复为内置默认内容（未保存）', globalRules: '全局规则', repoRules: '仓库专属规则', scopeSaveTo: '保存到: {p}', scopeNewFile: '（文件不存在，保存时创建）',
          rulesContent: '规则内容', sysPromptLabel: '系统提示词（必填）', userCtxLabel: '用户上下文（必填）',
          livePreview: '实时预览（最终注入 LLM 的 prompt）', userCtxTitle: 'USER CONTEXT（占位符已替换）', userCtxPlaceholder: '（占位符已替换）',
          empty: '(空)', missingUserCtx: '(缺少 user_context)', stagedPlaceholder: '<已暂存的文件，生成时实时注入>',
          stagedDiffPlaceholder: '<点击「生成」时实时注入的 staged diff>', restoreDefaults: '恢复默认', cancel: '取消',
          saving: '保存中…', save: '保存', ruleEditorTitle: '提交规则编辑器', close: '关闭',
          loadFailed: '读取失败', loadingDiff: '加载 diff…',
          closeDiff: '关闭 diff（Esc）',
          splitDiffTitle: '分栏对比', unifiedDiffTitle: '单栏对比',
          diffFullFile: '显示完整文件（含未变更行）', diffChangesOnly: '仅显示变更行',
          imgOld: '旧', imgNew: '新', imgLoading: '加载图片…',
          imgTooLarge: '图片过大（{s}），超出预览上限', imgMissing: '（无此版本）', imgNoPreview: '无法预览图片',
          imgZoomTitle: '点击查看原图（1:1）', imgCloseZoom: '关闭全屏预览（Esc）', imgSwitchHint: '←/→ 切换旧/新版本',
          historyLoadFailed: '读取历史失败', loadingHistory: '加载历史…', graphHint: '点击行查看提交详情', loadingDetail: '加载详情…',
          loadingFiles: '加载文件…', commitNoFiles: '该提交无文件变更（合并提交无合并差异）',
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
          conflictBar: '有 {n} 个文件存在冲突，解决后点该行的 ＋ 标记为已解决。',
          conflictBarResolved: '冲突已全部标记为已解决，可以提交以完成本次合并。',
          conflictBarNoStaged: '冲突已全部解决，且解决结果与 HEAD 一致（没有暂存内容）。点「完成合并」提交本次合并。',
          // 有未暂存改动时不能说「与 HEAD 一致」：那种状态下最可能是「解决完又取消了暂存」，
          // 解决结果正躺在工作区里没进 index——此时点「完成合并」提交出的合并提交不含它。
          conflictBarUnstaged: '冲突已全部解决，但当前索引没有可提交的内容（解决结果尚未暂存，或暂存后又被取消暂存）。先点该行的 ＋ 再提交；若按当前索引收尾合并，点「完成合并」——工作区里未暂存的改动不会被本次提交包含。',
          // rebase / cherry-pick / revert：冲突同样进冲突组，但收尾出口不在面板里
          conflictBarOtherOp: '有 {n} 个文件存在冲突，且当前进行的是 {op}（不是合并）：解决后点该行的 ＋ 标记为已解决，收尾请回终端执行 git {op} --continue（或 git {op} --abort）。',
          conflictBarOtherOpResolved: '冲突已全部标记为已解决，但当前进行的是 {op}：收尾请回终端执行 git {op} --continue（面板里的「提交」会被 git 当作该 {op} 的提交，并替换掉原提交信息）。',
          resolveFile: '标记为已解决（git add）', resolveAll: '全部标记为已解决',
          mergeAbortMenu: '中止合并（放弃本次合并）', mergeAbortTitle: '中止合并',
          mergeAbortNote: '将放弃本次合并，工作区恢复到合并前状态，冲突标记一并清除。若已解决的文件内容是必要改动，请先自行备份。',
          mergeAbortOk: '中止合并', mergeAbortDone: '已中止合并', conflictedNTitle: '冲突 {n} 个文件',
          mergeFinishTitle: '完成合并', mergeFinishDone: '已提交本次合并',
          // 完成合并用的提交信息取自 .git/MERGE_MSG（git 自己写好的合并摘要），
          // 悬停即可看到将要提交的那句话
          mergeFinishTitleWith: '完成合并（提交信息：{m}）',
          titleResolveFirst: '还有 {n} 个文件未解决，先解决并标记为已解决再提交',
          titleOtherOp: '{op} 进行中：提交会被 git 当作该 {op} 的提交并替换原提交信息，收尾建议回终端 git {op} --continue',
          loadingMore: '加载更多…', emptyHistory: '暂无提交记录',
          failedWith: '{label}失败: {e}',
          rescan: '重新扫描（并刷新所有仓库状态）', openFolder: '在文件资源管理器中打开工作空间', openFolderFailed: '打开文件夹失败: {e}', openFolderUnavailable: '文件管理器服务不可用',
          locating: '正在定位工作空间…', scanning: '正在扫描 Git 仓库…', scanFailed: '扫描失败',
          noWorkspace: '未打开工作空间', noRepos: '当前工作空间内未发现 Git 仓库。', resizeTitle: '拖拽调整面板宽度',
          toastsLabel: 'Git Panel 通知', panelLabel: 'Git Panel 面板', toggleTitle: 'Git Panel',
          expandTitle: '展开 Git Panel',
          panelSettings: '面板设置',
          modeDock: '侧边栏模式', modeDockDesc: '面板停靠在对话右侧，对话区域自动收窄让位', modeDockBadge: '默认',
          modeOverlay: '浮窗模式', modeOverlayDesc: '面板浮在对话区域上方，不改变对话布局',
          layoutNarrowHint: '窗口较窄时，侧边栏模式会临时按浮窗显示，拉宽窗口后自动恢复。'
        },
        en: {
          groupStaged: 'Staged Changes', groupChanges: 'Changes', groupUntracked: 'Untracked Changes', groupConflicted: 'Merge Conflicts', history: 'History',
          rulesLoadFailed: 'Failed to load rules', reading: '(loading…)', saved: 'Saved', saveFailed: 'Save failed', saveFailedWith: 'Save failed: {e}',
          scopeSwitchFailed: 'Failed to switch rules source',
          validationNoSys: 'Validation failed: missing system_prompt', validationNoUser: 'Validation failed: missing user_context',
          restoredDefaults: 'Restored to built-in defaults (not saved)', globalRules: 'Global rules', repoRules: 'Repo-specific rules', scopeSaveTo: 'Saved to: {p}', scopeNewFile: ' (file does not exist, will be created on save)',
          rulesContent: 'Rule content', sysPromptLabel: 'system prompt (required)', userCtxLabel: 'user context (required)',
          livePreview: 'Live preview (the final prompt injected into the LLM)', userCtxTitle: 'USER CONTEXT (placeholders replaced)', userCtxPlaceholder: '(placeholders replaced)',
          empty: '(empty)', missingUserCtx: '(missing user_context)', stagedPlaceholder: '<staged files, injected live at generation>',
          stagedDiffPlaceholder: '<staged diff injected live when you click Generate>', restoreDefaults: 'Restore Defaults', cancel: 'Cancel',
          saving: 'Saving…', save: 'Save', ruleEditorTitle: 'Commit Rule Editor', close: 'Close',
          loadFailed: 'Failed to load', loadingDiff: 'Loading diff…',
          closeDiff: 'Close diff (Esc)',
          splitDiffTitle: 'Split view', unifiedDiffTitle: 'Unified view',
          diffFullFile: 'Show full file (including unchanged lines)', diffChangesOnly: 'Show changed lines only',
          imgOld: 'Old', imgNew: 'New', imgLoading: 'Loading image…',
          imgTooLarge: 'Image too large ({s}); exceeds the preview limit', imgMissing: '(no such version)', imgNoPreview: 'Cannot preview image',
          imgZoomTitle: 'Click to view at actual size (1:1)', imgCloseZoom: 'Close fullscreen preview (Esc)', imgSwitchHint: '←/→ switch old/new',
          historyLoadFailed: 'Failed to load history', loadingHistory: 'Loading history…', graphHint: 'Click a row to view commit details', loadingDetail: 'Loading details…',
          loadingFiles: 'Loading files…', commitNoFiles: 'No file changes in this commit (merge without combined diff)',
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
          conflictBar: '{n} file(s) have conflicts. Resolve them, then press + on the row to mark resolved.',
          conflictBarResolved: 'All conflicts are marked resolved; commit to complete this merge.',
          conflictBarNoStaged: 'All conflicts are resolved and the result matches HEAD, so nothing is staged. Press "Complete Merge" to commit this merge.',
          conflictBarUnstaged: 'All conflicts are resolved, but the index has nothing to commit (the resolution was never staged, or staged and then unstaged). Press + on the row first; to finish the merge with the current index press "Complete Merge" — unstaged worktree changes are not part of this commit.',
          conflictBarOtherOp: '{n} file(s) have conflicts and a {op} (not a merge) is in progress: resolve them, then press + on the row to mark resolved, and finish in a terminal with git {op} --continue (or git {op} --abort).',
          conflictBarOtherOpResolved: 'All conflicts are marked resolved, but a {op} is in progress: finish it in a terminal with git {op} --continue (the panel\'s Commit would be taken as that {op}\'s commit and replace its original message).',
          resolveFile: 'Mark as resolved (git add)', resolveAll: 'Mark all as resolved',
          mergeAbortMenu: 'Abort merge (discard this merge)', mergeAbortTitle: 'Abort Merge',
          mergeAbortNote: 'Discards this merge and restores the worktree to its pre-merge state, clearing the conflict markers. Back up any resolved content you still need first.',
          mergeAbortOk: 'Abort Merge', mergeAbortDone: 'Merge aborted', conflictedNTitle: '{n} conflicted file(s)',
          mergeFinishTitle: 'Complete Merge', mergeFinishDone: 'Merge committed',
          mergeFinishTitleWith: 'Complete Merge (message: {m})',
          titleResolveFirst: '{n} file(s) are still unresolved; resolve and mark them before committing',
          titleOtherOp: 'A {op} is in progress: committing is taken as that {op}\'s commit and replaces its original message; prefer git {op} --continue in a terminal',
          loadingMore: 'Loading more…', emptyHistory: 'No commits yet',
          failedWith: '{label} failed: {e}',
          rescan: 'Rescan (also refreshes all repository statuses)', openFolder: 'Open workspace in file explorer', openFolderFailed: 'Failed to open folder: {e}', openFolderUnavailable: 'File manager service unavailable',
          locating: 'Locating workspace…', scanning: 'Scanning for Git repositories…', scanFailed: 'Scan failed',
          noWorkspace: 'No workspace open', noRepos: 'No Git repositories found in the current workspace.', resizeTitle: 'Drag to resize the panel width',
          toastsLabel: 'Git Panel notifications', panelLabel: 'Git Panel panel', toggleTitle: 'Git Panel',
          expandTitle: 'Expand Git Panel',
          panelSettings: 'Panel Settings',
          modeDock: 'Side panel', modeDockDesc: 'The panel docks to the right of the conversation, which narrows to make room', modeDockBadge: 'Default',
          modeOverlay: 'Floating overlay', modeOverlayDesc: 'The panel floats above the conversation without changing its layout',
          layoutNarrowHint: 'On narrow windows the side-panel mode temporarily behaves as floating; it restores automatically once the window is widened.'
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
      // 语言跟随：apply 阶段只做一次初始同步（此时 locale 服务可能尚未就绪）；
      // 运行期切换由 GitPanelMain 挂载时的 locale 订阅驱动（见其 effect 注释）
      callRpc('setLocale', { locale: lang }).catch(() => {})

      function pushToast(kind, text) {
        const id = 'gp-t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        store.set((s) => ({ ...s, toasts: s.toasts.concat([{ id, kind, text: String(text), exiting: false }]).slice(-5) }))
        timer.timeout(() => removeToast(id), 4600)
      }
      // 两段式移除：先标记 exiting（播放消失动画），动画时长过后真正移除
      function removeToast(id) {
        store.set((s) => ({ ...s, toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)) }))
        timer.timeout(() => store.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 300)
      }

      function useStore() {
        const [, force] = React.useState(0)
        React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
        return store.get()
      }

      const GROUP_META = {
        conflicted: { titleKey: 'groupConflicted' },
        staged: { titleKey: 'groupStaged' },
        unstaged: { titleKey: 'groupChanges' },
        untracked: { titleKey: 'groupUntracked' }
      }
      // 状态字母徽标：未跟踪显示 U
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
      // 冲突标记行（<<<<<<< / ======= / >>>>>>>）：冲突组给的是工作区文件全文的合成 diff，
      // 整份文件都是新增行，标记行若与正文同色就找不到冲突块的边界在哪。只在 conflicted
      // 组启用（普通 diff 里 `=======` 可能是 Markdown 下划线之类的正文），单列成 mark 类型。
      const CONFLICT_MARKER_RE = /^(<{7}|={7}|>{7})/
      function parseDiff(text, conflicted) {
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
            if (raw.startsWith('+')) {
              const x = raw.slice(1)
              // mark 行的行号与 add 一致（冲突标记就是文件里的第 n 行），仍计入 adds：
              // 那是"这份合成 diff 有多少新增行"的口径，与文件行数保持一致
              if (conflicted && CONFLICT_MARKER_RE.test(x)) cur.rows.push({ t: 'mark', o: null, n: newNo++, x })
              else cur.rows.push({ t: 'add', o: null, n: newNo++, x })
              adds++
            } else if (raw.startsWith('-')) { cur.rows.push({ t: 'del', o: oldNo++, n: null, x: raw.slice(1) }); dels++ }
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
            // 冲突标记行在分栏视图里同样自成整行（左半右半都会被 + 前缀重复一次，
            // 合成成一对反而看不出边界），保留 mark 标记交给渲染端着色
            if (r.t === 'mark') { out.push({ note: r.x, mark: true }); i++; continue }
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

      // 多选行键：'group\u0000path'——同一文件可同时出现在 staged/unstaged 两组，须带组判定
      const rowKey = (group, path) => group + '\u0000' + path

      // 路径展示拆分：seg = 尾段名；base = 文件名（目录保留尾斜杠）；dir = 目录
      //（去尾分隔符；无目录时为空串）。目录省略号在左侧（rtl）保住最深层目录，
      // 文件名仅自身超长才封顶省略（见 .gp-file-dir / .gp-diff-name 的收缩策略）。
      function splitPath(p) {
        const trimmed = p.replace(/\/+$/, '')
        const seg = trimmed.split('/').pop() || p
        const base = p.endsWith('/') ? seg + '/' : seg
        const dir = trimmed.length > seg.length ? trimmed.slice(0, trimmed.length - seg.length).replace(/\/+$/, '') : ''
        return { base, dir, seg }
      }

      // 图片扩展名（与 host 侧 IMAGE_MIMES 同表）：命中即 diff 抽屉进图片预览模式
      //（跳过 fileDiff，改调 imageBlob 取旧/新两版 data URL）
      const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
      const isImagePath = (p) => {
        const m = /\.([a-z0-9]+)$/i.exec(String(p || ''))
        return !!(m && IMAGE_EXTS.has(m[1].toLowerCase()))
      }
      // 字节数人性化显示（图片标签处用）
      const fmtBytes = (n) => {
        const v = Number(n)
        if (!isFinite(v) || v < 0) return ''
        if (v < 1024) return v + ' B'
        if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
        return (v / 1024 / 1024).toFixed(2) + ' MB'
      }

      // 双 rAF 入场：先让屏外/初始样式完成一次绘制，再触发 transition 切到终态
      //（根治首帧以终态闪现的问题）。active 由 false 变 true 时启动；返回前可取消。
      function useEnterTransition(active, onReady) {
        const rafRef = React.useRef(0)
        const cbRef = React.useRef(onReady)
        cbRef.current = onReady
        React.useEffect(() => {
          if (!active) return
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = requestAnimationFrame(() => cbRef.current())
          })
          return () => cancelAnimationFrame(rafRef.current)
        }, [active])
      }

      // 左缘拖拽调宽（面板 / diff 抽屉共用）：begin() 由拖拽手柄 pointerdown 调用，
      // move 期间按公式实时写宽度（含视口钳制，公式在调用方的 apply 里），松手持久化，
      // 并回调 onEnd 让调用方复位拖拽态（如激活样式、禁动画标记）。
      function useWidthDrag(apply, persist, onEnd) {
        const resizeRef = React.useRef(false)
        const wRef = React.useRef(0)
        const applyRef = React.useRef(apply)
        const persistRef = React.useRef(persist)
        const onEndRef = React.useRef(onEnd)
        applyRef.current = apply
        persistRef.current = persist
        onEndRef.current = onEnd
        React.useEffect(() => {
          const onMove = (e) => {
            if (!resizeRef.current) return
            wRef.current = applyRef.current(e)
          }
          const onUp = () => {
            if (!resizeRef.current) return
            resizeRef.current = false
            persistRef.current(wRef.current)
            if (onEndRef.current) onEndRef.current()
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
        }, [])
        return { begin: () => { resizeRef.current = true } }
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

      // diff 滚动条 overview ruler（详见 CSS 区 .gp-diff-ruler 注释）：渲染后实测每个
      // diff 行的 offsetTop/offsetHeight（自动换行下行高不固定，只能实测 DOM），按
      // 「行位置 ÷ 内容总高」生成红/绿色块，比例与滚动位置无关、滚动天然同步；
      // 分栏修改对（左红右绿）拆为上半红/下半绿。active=内容就绪，refreshKey 变化
      //（切换文件 / split / 全文）时重测：同步一次 + 下一帧校一次（防字体晚加载改
      // 行高）；宽度变化（拖拽/窗口缩放）由 ResizeObserver 兜底重算。
      function useDiffRuler(active, refreshKey) {
        const [marks, setMarks] = React.useState(null)
        const [sbw, setSbw] = React.useState(0)
        const bodyRef = React.useRef(null)
        const measureRuler = React.useCallback(() => {
          const el = bodyRef.current
          if (!el) return
          const w = el.offsetWidth - el.clientWidth
          setSbw((v) => (v === w ? v : w))
          const H = el.scrollHeight
          if (H <= el.clientHeight) { setMarks(null); return }
          const out = []
          let cur = null
          const push = (t, top, bot) => {
            if (cur && cur.t === t && top <= cur.bot + 0.002) { cur.bot = bot; cur.h = bot - cur.top }
            else { cur = { t, top, bot, h: bot - top }; out.push(cur) }
          }
          el.querySelectorAll('.gp-diff-row').forEach((row) => {
            const top = row.offsetTop / H
            const bot = (row.offsetTop + row.offsetHeight) / H
            if (row.classList.contains('gp-dr-add')) push('add', top, bot)
            else if (row.classList.contains('gp-dr-del')) push('del', top, bot)
            else if (row.classList.contains('gp-dr-note')) cur = null
            else {
              // 分栏行：修改对半行带 gp-dh-add / gp-dh-del；上下文行两者皆无
              const ha = row.querySelector('.gp-dh-add') != null
              const hd = row.querySelector('.gp-dh-del') != null
              if (ha && hd) { push('del', top, (top + bot) / 2); push('add', (top + bot) / 2, bot) }
              else if (ha) push('add', top, bot)
              else if (hd) push('del', top, bot)
              else cur = null
            }
          })
          setMarks(out.length ? out : null)
        }, [])
        React.useEffect(() => {
          if (!active) return
          measureRuler()
          const raf = requestAnimationFrame(() => measureRuler())
          return () => cancelAnimationFrame(raf)
        }, [active, refreshKey, measureRuler])
        React.useEffect(() => {
          if (typeof ResizeObserver === 'undefined') return
          const ro = new ResizeObserver(() => measureRuler())
          if (bodyRef.current) ro.observe(bodyRef.current)
          return () => ro.disconnect()
        }, [measureRuler])
        // 点击 ruler 按比例跳转（目标行居中到视口）
        const onRulerClick = (e) => {
          const el = bodyRef.current
          if (!el) return
          const r = e.currentTarget.getBoundingClientRect()
          const ratio = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
          el.scrollTop = Math.max(0, Math.round(ratio * el.scrollHeight - el.clientHeight / 2))
        }
        return { marks, sbw, bodyRef, onRulerClick }
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
      //     （公共前后缀裁剪），模式记忆在 localStorage（gp-diff-split）；
      //   - 全文（full）视图：host 侧 git diff -U1000000 让整个文件进单个 hunk，
      //     改动行照常红绿高亮、其余行作上下文灰显，超过 1MB 截断附提示行；
      //     模式记忆在 localStorage（gp-diff-full），与 split 可叠加；
      //   - 滚动条 overview ruler：滚动条内侧细覆盖条，红/绿色块按
      //     「行位置 ÷ 内容总高」比例标出增删位置（渲染后实测 DOM 行位置，与滚动天然
      //     同步；分栏修改对拆上半红/下半绿），悬停加宽、点击按比例跳转居中。
      //   - 图片预览模式：png/jpg/jpeg/gif/webp/bmp/ico/svg 扩展名不走 fileDiff，
      //     改调 imageBlob 取旧/新两版 data URL —— 并排自适应缩略展示；
      //     点击任一图片进全屏 lightbox（1:1 原始尺寸、超出屏幕可滚动、
      //     左右方向键切换新旧版本）；标签显示实测像素与文件大小；
      //     单图上限 8MB（超限显示提示行）；
      //     untracked 无旧版、工作区已删除无新版，单版时单图占满（见 buildImageBody）。
      // ===== 图片预览模式组件 =====
      // 单侧图片格：标签（旧/新 徽标 + 实测像素尺寸 + 文件大小）+ 棋盘格图框。
      // 尺寸在 img onLoad 后从 naturalWidth/Height 读取（无需解码库）。
      // 无图时显示 note（超限大小 / 无此版本 / 错误信息）；有图可点击进全屏 lightbox。
      function ImagePane({ img, note, kind, onZoom }) {
        const [dim, setDim] = React.useState('')
        const onImgLoad = (e) => {
          const el = e && e.target
          if (el && el.naturalWidth) setDim(el.naturalWidth + '×' + el.naturalHeight)
        }
        return React.createElement('div', { className: 'gp-img-cell' },
          React.createElement('div', { className: 'gp-img-label' },
            React.createElement('span', { className: 'gp-img-tag gp-img-tag-' + kind }, tr(kind === 'old' ? 'imgOld' : 'imgNew')),
            dim ? React.createElement('span', { className: 'gp-img-dim' }, dim) : null,
            img && img.bytes ? React.createElement('span', { className: 'gp-img-dim' }, fmtBytes(img.bytes)) : null),
          img
            ? React.createElement('div', { className: 'gp-img-box', title: tr('imgZoomTitle'), onClick: () => { if (onZoom) onZoom(kind) } },
                React.createElement('img', { src: img.dataUrl, alt: '', draggable: false, onLoad: onImgLoad }))
            : React.createElement('div', { className: 'gp-img-note' }, note || tr('imgMissing')))
      }

      // 全屏 lightbox：图片按 1:1 原始尺寸显示（小于屏幕居中、超出可滚动），棋盘格底。
      // 顶部信息条：版本徽标 + 实测像素 + 文件大小 + 切换提示（两版都在时）+ 关闭按钮。
      // Esc / 点遮罩 / 关闭按钮退出；左右方向键在新旧版之间切换（无需退出重进）。
      // 键盘监听用 capture 阶段并 stopPropagation——先于 diff 抽屉的 Esc（bubble）
      // 触发，lightbox 打开时 Esc 只关 lightbox、不连带关抽屉（与确认弹窗同一模式）。
      function ImageLightbox({ img, kind, both, onSwitch, onClose }) {
        const [dim, setDim] = React.useState('')
        const onImgLoad = (e) => {
          const el = e && e.target
          if (el && el.naturalWidth) setDim(el.naturalWidth + '×' + el.naturalHeight)
        }
        React.useEffect(() => {
          const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
            if (!both) return
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.stopPropagation()
              onSwitch(kind === 'old' ? 'new' : 'old')
            }
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [kind, both, onClose, onSwitch])
        return React.createElement('div', { className: 'gp-lightbox', onClick: onClose },
          React.createElement('div', { className: 'gp-lightbox-head', onClick: (e) => { e.stopPropagation() } },
            React.createElement('span', { className: 'gp-img-tag gp-img-tag-' + kind }, tr(kind === 'old' ? 'imgOld' : 'imgNew')),
            dim ? React.createElement('span', { className: 'gp-img-dim' }, dim) : null,
            img && img.bytes ? React.createElement('span', { className: 'gp-img-dim' }, fmtBytes(img.bytes)) : null,
            both ? React.createElement('span', { className: 'gp-lightbox-switch' }, tr('imgSwitchHint')) : null,
            React.createElement('span', { className: 'gp-lightbox-close' },
              React.createElement('button', { title: tr('imgCloseZoom'), onClick: onClose }, icon('close')))),
          // 点图片本体不关闭（stopPropagation），点 stage 空白区随外层遮罩关闭
          React.createElement('div', { className: 'gp-lightbox-stage' },
            React.createElement('img', { src: img.dataUrl, alt: '', draggable: false, onLoad: onImgLoad, onClick: (e) => { e.stopPropagation() } })))
      }

      // 图片 diff 主体布局：并排展示各版本（单版时单图占满）；两版皆无 → 说明行
      //（超限/读取失败的原因在各自 note 里）。点击任一图片由 DiffDrawer 的 zoom 状态
      // 切到全屏 lightbox（imgState 与 lightbox 状态都在 DiffDrawer 层）。
      function buildImageBody(img, onZoom) {
        if (!img) return null
        const cells = []
        if (img.old || img.oldNote) cells.push(React.createElement(ImagePane, { key: 'old', img: img.old, note: img.oldNote, kind: 'old', onZoom }))
        if (img.new || img.newNote) cells.push(React.createElement(ImagePane, { key: 'new', img: img.new, note: img.newNote, kind: 'new', onZoom }))
        if (!cells.length) return React.createElement('div', { className: 'gp-img-note' }, tr('imgNoPreview'))
        return React.createElement('div', { className: 'gp-img-row' + (cells.length === 1 ? ' gp-img-row-one' : '') }, cells)
      }

      function DiffDrawer({ repo, sel, panelW, onClose, onRequestClose }) {
        const [state, setState] = React.useState({ loading: true, text: '', error: '' })
        // 分栏（split）视图：左源文件/右修改后；记忆在 localStorage（gp-diff-split）
        const [split, setSplit] = React.useState(() => prefBool('gp-diff-split', false))
        // 全文（full）视图：-U1000000 超大上下文让整个文件进单个 hunk，
        // 改动行照常红绿高亮、其余行作上下文灰显；记忆在 localStorage（gp-diff-full）
        const [full, setFull] = React.useState(() => prefBool('gp-diff-full', false))
        // 图片预览模式：isImagePath 命中即启用（跳过 fileDiff，改调 imageBlob）。
        // imgState = { old, new, oldNote, newNote }（img = {dataUrl, bytes}）；
        // zoom = { kind } 时全屏 lightbox 展示对应版本（点击图片格进入）
        const isImg = isImagePath(sel.path)
        const [imgState, setImgState] = React.useState(null)
        const [zoom, setZoom] = React.useState(null)
        const [drawerW, setDrawerW] = React.useState(() => prefInt('gp-diff-w', 380, 2400, 0) || Math.min(760, Math.max(440, Math.round(window.innerWidth * 0.42))))
        const [resizing, setResizing] = React.useState(false)
        // 滑入/滑出相位：off（未入场 / sel.closing）时整屉平移到面板正后方且全透明
        const [entered, setEntered] = React.useState(false)
        const closing = sel.closing === true
        const closeTimerRef = React.useRef(null)

        // 入场：双 rAF 让「面板后方 + 全透明」的初始样式先完成一次绘制，再切到终态触发 transition
        useEnterTransition(true, () => setEntered(true))

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
          // 图片文件：unified diff 对二进制无意义，不走 fileDiff；并行请求旧/新两版
          //（untracked 无旧版；服务端按组解析版本来源，见 host imageBlob）
          if (isImg) {
            setImgState(null)
            setZoom(null)
            const jobs = []
            if (sel.group !== 'untracked') {
              jobs.push(callRpc('imageBlob', { repoId: repo.id, path: sel.path, orig: sel.orig || undefined, group: sel.group, hash: sel.hash || undefined, side: 'old' }).then((r) => ({ side: 'old', r })))
            }
            jobs.push(callRpc('imageBlob', { repoId: repo.id, path: sel.path, group: sel.group, hash: sel.hash || undefined, side: 'new' }).then((r) => ({ side: 'new', r })))
            Promise.all(jobs).then((results) => {
              if (!alive) return
              const out = { old: null, new: null, oldNote: '', newNote: '' }
              for (let i = 0; i < results.length; i++) {
                const res = results[i]
                if (!res || !res.r) continue
                if (res.r.ok && res.r.image) { out[res.side] = res.r.image; continue }
                if (res.r.ok && res.r.oversize) out[res.side + 'Note'] = fmt(tr('imgTooLarge'), { s: fmtBytes(res.r.size) })
                else if (!res.r.ok) out[res.side + 'Note'] = res.r.error || tr('loadFailed')
              }
              setImgState(out)
              setState({ loading: false, text: '', error: '' })
            }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
            return () => { alive = false }
          }
          callRpc('fileDiff', { repoId: repo.id, path: sel.path, group: sel.group, hash: sel.hash || undefined, full: full || undefined }).then((r) => {
            if (!alive) return
            if (r && r.ok) setState({ loading: false, text: r.text || '', error: '' })
            else setState({ loading: false, text: '', error: (r && r.error) || tr('loadFailed') })
          }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
          return () => { alive = false }
        }, [repo.id, sel.path, sel.group, sel.hash, sel.orig, full, isImg])

        // ===== 滚动条 overview ruler（测量逻辑见 useDiffRuler；图片模式无行标记，停用）=====
        const ruler = useDiffRuler(!isImg && !state.loading && !state.error, (split ? 's:' : 'u:') + state.text)

        React.useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') requestClose() }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [closing, onClose])

        // 抽屉左缘拖拽调宽：宽度 = 视口宽 − 面板宽 − 指针 x（钳到 [380, 视口−面板−48]），
        // 松手时持久化
        const dragApply = (e) => {
          const max = Math.max(320, Math.round(window.innerWidth - panelW - 48))
          const w = Math.min(max, Math.max(380, Math.round(window.innerWidth - panelW - e.clientX)))
          setDrawerW((prev) => (prev === w ? prev : w))
          return w
        }
        const widthDrag = useWidthDrag(dragApply, (w) => savePrefInt('gp-diff-w', 380, 2400, w), () => setResizing(false))

        const parsed = React.useMemo(() => parseDiff(state.text, sel.group === 'conflicted'), [state.text, sel.group])
        // 分栏配对按 block 缓存（保留 @@ 分段头边界）；仅 split 模式惰性计算
        const splitPairs = React.useMemo(() => (split ? parsed.blocks.map((b) => ({ hunk: b.hunk, pairs: pairRows([b]) })) : null), [parsed, split])
        // 冲突组与列表行同口径：未合并条目在 porcelain 里是 UU/AA/DD…，直接喂 glyphOf 会得到
        // 「红色 U」「绿色 A」「红色 D」等与列表行（warn 色 U）不一致的观感
        const gl = sel.group === 'conflicted' ? { g: 'U', cls: 'gp-g-conflict' } : glyphOf(sel.x, sel.y)
        const { base, dir } = splitPath(sel.path)
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
          if (pr.note) return React.createElement('div', { key: i, className: 'gp-diff-row ' + (pr.mark ? 'gp-dr-mark' : 'gp-dr-note') },
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
          // 组徽标：工作区三组显示组名；提交文件显示提交短 hash（悬停看完整 hash）
          React.createElement('span', { className: 'gp-chip', title: sel.hash || undefined }, sel.group === 'commit' ? (sel.short || String(sel.hash || '').slice(0, 7)) : (GROUP_META[sel.group] ? tr(GROUP_META[sel.group].titleKey) : sel.group)),
          // 全文切换：开启后整个文件进单个 hunk（改动行红绿高亮、其余作上下文灰显）；
          // 激活态高亮与分栏切换一致（gp-on）；图片模式无 hunk，两个视图按钮均隐藏
          isImg ? null : React.createElement('button', { className: 'gp-btn-icon' + (full ? ' gp-on' : ''), title: full ? tr('diffChangesOnly') : tr('diffFullFile'), onClick: () => setFull((v) => { savePrefBool('gp-diff-full', !v); return !v }) }, icon('fullDoc')),
          isImg ? null : React.createElement('button', { className: 'gp-btn-icon', title: split ? tr('unifiedDiffTitle') : tr('splitDiffTitle'), onClick: () => setSplit((v) => { savePrefBool('gp-diff-split', !v); return !v }) }, icon(split ? 'unified' : 'split')),
          React.createElement('button', { className: 'gp-btn-icon', title: tr('closeDiff'), onClick: requestClose }, icon('close')))

        // ruler 覆盖条：浮在原生滚动条内侧（right = 滚动条宽 + 3px 间隙），
        // 色块按文档比例定位，与滚动位置天然同步
        const rulerEl = ruler.marks ? React.createElement('div', {
          className: 'gp-diff-ruler', style: { right: (ruler.sbw + 3) + 'px' }, onClick: ruler.onRulerClick
        },
          ruler.marks.map((m, i) => React.createElement('div', {
            key: i, className: 'gp-diff-ruler-mark gp-drm-' + m.t,
            style: { top: (m.top * 100) + '%', height: (m.h * 100) + '%' }
          }))) : null

        const body = React.createElement('div', { className: 'gp-diff-body-wrap' },
          React.createElement('div', { className: 'gp-diff-body', ref: ruler.bodyRef },
            state.loading
              ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), ' ' + tr(isImg ? 'imgLoading' : 'loadingDiff'))
              : state.error
                ? React.createElement('div', { className: 'gp-empty' }, state.error)
                : isImg
                  ? React.createElement('div', { className: 'gp-img-wrap' }, buildImageBody(imgState, (kind) => setZoom({ kind })))
                  : React.createElement('div', { className: 'gp-diff-table' },
                      parsed.meta.length ? React.createElement('div', { className: 'gp-diff-meta' }, parsed.meta.join('\n')) : null,
                      split
                        ? splitPairs.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                            b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                            b.pairs.map(renderSplitRow)))
                        : parsed.blocks.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                            b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                            b.rows.map(renderRow))))),
          rulerEl)

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
              onPointerDown: (e) => { e.preventDefault(); widthDrag.begin(); setResizing(true) }
            }),
            head,
            body),
          // 全屏 lightbox：图片模式点击图片格后浮于整个页面之上（z-index 420）；
          // 对应版本无图（超限/缺失）不会进入（onZoom 只在有图的格上触发）
          zoom && imgState && imgState[zoom.kind]
            ? React.createElement(ImageLightbox, {
                img: imgState[zoom.kind], kind: zoom.kind,
                both: !!(imgState.old && imgState.new),
                onSwitch: (kind) => setZoom({ kind }),
                onClose: () => setZoom(null)
              })
            : null)
      }

      // 简易 lane 图算法：按行计算提交所在的 lane、合并连线与活跃 lane 区间
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

      // lane 循环配色：按 lane 序号取色，多分支时颜色循环复用
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

      // 可变行高虚拟滚动（历史区）：普通行高 ROWH，展开行 = ROWH + 文件列表高度
      //（loading/错误/空 = 一行提示的高度，文件列表载入前后不同，靠 filesVer 触发重算）。
      // tops 为前缀和（tops[i] = 第 i 行纵坐标，tops[len] = 内容总高），供绝对定位与
      // 二分定位；syncWindow 用二分框出可视窗口（±15 行 overscan）并兼做触底分页。
      function useVariableRows(entries, expandedIdx, filesCache, filesVer, listRef, stateRef, loadPage, ROWH, FILEH, MAXVIS) {
        const heights = React.useMemo(() => {
          const hs = new Array(entries.length)
          for (let i = 0; i < entries.length; i++) {
            if (i !== expandedIdx) { hs[i] = ROWH; continue }
            const d = filesCache.current.get(entries[i].hash)
            const n = !d || d.loading || d.error || !d.files ? 1 : Math.min(d.files.length, MAXVIS)
            hs[i] = ROWH + n * FILEH + 8
          }
          return hs
        }, [entries, expandedIdx, filesVer])
        const tops = React.useMemo(() => {
          const t = new Array(entries.length + 1)
          t[0] = 0
          for (let i = 0; i < entries.length; i++) t[i + 1] = t[i] + (heights[i] || ROWH)
          return t
        }, [heights])
        const topsRef = React.useRef(tops)
        topsRef.current = tops
        const [win, setWin] = React.useState({ first: 0, last: 40 })
        const syncWindow = React.useCallback(() => {
          const el = listRef.current
          if (!el) return
          const t = topsRef.current
          const len = stateRef.current.entries.length
          // 二分找首个「底边超过滚动位置」的行（含跨过视口顶端的行），再留 15 行 overscan
          let lo = 0, hi = len
          while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid + 1] > el.scrollTop) hi = mid; else lo = mid + 1 }
          const first = Math.max(0, lo - 15)
          // 二分找首个「顶边到达视口底」的行（不含），再留 15 行 overscan
          const y2 = el.scrollTop + el.clientHeight
          lo = 0; hi = len
          while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] >= y2) hi = mid; else lo = mid + 1 }
          const last = Math.min(len, lo + 15)
          setWin((w) => (w.first === first && w.last === last ? w : { first, last }))
          if (stateRef.current.hasMore && !stateRef.current.loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 800) {
            loadPage(stateRef.current.entries.length, true)
          }
        }, [loadPage])
        return { heights, tops, win, syncWindow }
      }

      // 展开区内容：loading / 错误 / 空（合并提交）提示，或文件列表（点击复用 DiffDrawer）
      function CommitFilesPanel({ e, repo, filesCache, diffSel, onOpenDiff }) {
        const d = filesCache.current.get(e.hash)
        if (!d || d.loading) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note' }, React.createElement('span', { className: 'gp-spinner' }), tr('loadingFiles'))
        if (d.error) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note gp-danger' }, d.error)
        if (d.files.length === 0) return React.createElement('div', { className: 'gp-grow-files gp-grow-files-note' }, tr('commitNoFiles'))
        return React.createElement('div', { className: 'gp-grow-files' },
          d.files.map((f) => {
            const gl = glyphOf(f.status, ' ')
            const { seg, dir } = splitPath(f.path)
            return React.createElement('div', {
              key: f.path, className: 'gp-gfile' + (diffSel && !diffSel.closing && diffSel.repoId === repo.id && diffSel.group === 'commit' && diffSel.hash === e.hash && diffSel.path === f.path ? ' gp-gfile-active' : ''),
              title: f.path + (f.oldPath ? '  ←  ' + f.oldPath : ''),
              onClick: (ev) => { ev.stopPropagation(); onOpenDiff(repo, { path: f.path, x: f.status, y: ' ', hash: e.hash, short: e.short, orig: f.oldPath || undefined }, 'commit') }
            },
              React.createElement('span', { className: 'gp-diff-glyph ' + gl.cls }, gl.g),
              React.createElement('span', { className: 'gp-gfile-name' }, seg),
              dir ? React.createElement('span', { className: 'gp-gfile-dir' }, dir) : null,
              f.oldPath ? React.createElement('span', { className: 'gp-gfile-orig', title: f.oldPath }, '← ' + (f.oldPath.replace(/\/+$/, '').split('/').pop() || f.oldPath)) : null,
              React.createElement('span', { className: 'gp-spacer' }),
              React.createElement('span', { className: 'gp-gfile-stats' },
                f.adds != null && f.adds > 0 ? React.createElement('span', { className: 'gp-gf-add' }, '+' + f.adds) : null,
                f.dels != null && f.dels > 0 ? React.createElement('span', { className: 'gp-gf-del' }, '−' + f.dels) : null))
          }))
      }

      // 悬停提交详情浮层：定位在行左侧（上下不越视口），可移入浮层内查看；
      // 数据来自 detailCache（ensureDetail 懒加载，载入完成由 bumpHover 触发重渲染）
      function CommitDetailPop({ hover, detailCache, onMouseEnter, onMouseLeave }) {
        const d = detailCache.current.get(hover.hash)
        const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
        const POPW = 480
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
        return React.createElement('div', { className: 'gp-cd-pop', style: { left, top }, onMouseEnter, onMouseLeave }, inner)
      }

      function GitGraphView({ repo, onOpenDiff, diffSel }) {
        const [state, setState] = React.useState({ loading: true, entries: [], error: '', hasMore: true, loadingMore: false })
        const [hover, setHover] = React.useState(null)
        const [, bumpHover] = React.useReducer((c) => c + 1, 0)
        // 行内展开：手风琴式，expanded 为当前展开提交的 hash
        const [expanded, setExpanded] = React.useState(null)
        const [filesVer, bumpFiles] = React.useReducer((c) => c + 1, 0)
        const stateRef = React.useRef(state)
        stateRef.current = state
        const listRef = React.useRef(null)
        const hoverHashRef = React.useRef(null)
        const hideRef = React.useRef(null)
        const detailCache = React.useRef(new Map())
        // hash → {loading} | {files} | {error}：文件列表缓存（首次展开才请求）
        const filesCache = React.useRef(new Map())
        const expandedRef = React.useRef(null)
        expandedRef.current = expanded
        const ROWH = 26
        const PAGE = 200
        const FILEH = 26   // 展开区文件行行高（含内边距）
        const MAXVIS = 8   // 展开区可见文件数上限（超出转内部滚动）

        const loadPage = React.useCallback(async (skip, append, soft) => {
          if (append) setState((s) => ({ ...s, loadingMore: true }))
          else if (!soft) setState((s) => ({ ...s, loading: true, error: '' }))
          try {
            const r = await callRpc('log', { repoId: repo.id, skip, limit: PAGE })
            if (r && r.ok) {
              const list = append ? stateRef.current.entries.concat(r.entries || []) : (r.entries || [])
              setState({ loading: false, loadingMore: false, error: '', entries: list, hasMore: !!r.hasMore })
            } else setState((s) => ({ ...s, loading: false, loadingMore: false, error: (r && r.error) || tr('historyLoadFailed') }))
          } catch (e) { setState((s) => ({ ...s, loading: false, loadingMore: false, error: e && e.message ? e.message : String(e) })) }
        }, [repo.id])

        React.useEffect(() => { loadPage(0, false) }, [loadPage])

        // 写操作（commit/push/pull 等）后定向刷新历史：订阅 refreshTick，命中本仓库时
        // 静默重拉第一页（soft 模式不闪 loading）；滚动回顶部让新提交进入视口；
        // 清空悬停详情缓存（push 后远程 ref 位置变化，旧缓存的 refs 已过期）
        const s = useStore()
        const lastTickRef = React.useRef(s.refreshTick)
        React.useEffect(() => {
          if (s.refreshTick === lastTickRef.current) return
          lastTickRef.current = s.refreshTick
          if (s.lastOpRepoId != null && s.lastOpRepoId !== repo.id) return
          detailCache.current.clear()
          if (listRef.current) listRef.current.scrollTop = 0
          loadPage(0, false, true)
        }, [s.refreshTick, s.lastOpRepoId, repo.id, loadPage])

        // 可变行高：展开行 = ROWH + 展开区高度（文件列表载入前后不同）。
        // heights/tops 前缀和/可视窗口二分定位/触底分页，见 useVariableRows
        const expandedIdx = React.useMemo(() => state.entries.findIndex((e) => e.hash === expanded), [state.entries, expanded])
        const { heights, tops, win, syncWindow } = useVariableRows(state.entries, expandedIdx, filesCache, filesVer, listRef, stateRef, loadPage, ROWH, FILEH, MAXVIS)

        // 滚动加载：到底部前 800px 预取下一页；数据追加后若仍靠近底部则继续加载；
        // tops 变化（展开/收起改变行高）后同样重算窗口
        React.useEffect(() => { syncWindow() }, [state.entries, state.hasMore, state.loading, state.loadingMore, syncWindow, tops])

        const graph = React.useMemo(() => computeGraph(state.entries), [state.entries])

        // 展开后若文件区超出视口底部则滚动补齐（文件列表异步载入后高度变化也会再校正一次）
        React.useEffect(() => {
          if (expandedIdx < 0) return
          const el = listRef.current
          if (!el) return
          const bottom = tops[expandedIdx] + (heights[expandedIdx] || ROWH)
          if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
        }, [expandedIdx, tops, heights])

        // 悬停详情：离开行/弹层后短暂延迟关闭，滚动立即关闭
        const cancelHide = () => { if (hideRef.current) { hideRef.current(); hideRef.current = null } }
        const scheduleHide = () => {
          cancelHide()
          hideRef.current = timer.timeout(() => { hoverHashRef.current = null; setHover(null); hideRef.current = null }, 160)
        }
        const closeHover = () => { cancelHide(); if (hoverHashRef.current) { hoverHashRef.current = null; setHover(null) } }
        // 首次访问才请求的懒加载缓存（detail 与 files 共用模式）：守卫 → 置 loading →
        // RPC → 写结果 → 通知刷新；成功条目形状由 pick 决定，失败统一 { error }
        const ensureCached = (cache, hash, method, pick, onDone) => {
          if (cache.current.has(hash)) return
          cache.current.set(hash, { loading: true })
          callRpc(method, { repoId: repo.id, hash }).then((r) => {
            cache.current.set(hash, r && r.ok ? pick(r) : { loading: false, error: (r && r.error) || tr('loadFailed') })
            onDone()
          }).catch((e) => {
            cache.current.set(hash, { loading: false, error: e && e.message ? e.message : String(e) })
            onDone()
          })
        }
        // 提交详情：悬停行懒加载；载入完成且仍在悬停同一提交时刷新浮层
        const ensureDetail = (hash) => ensureCached(detailCache, hash, 'commitDetail', (r) => ({ loading: false, data: r }), () => { if (hoverHashRef.current === hash) bumpHover() })
        const showDetail = (hash, el, refs, short) => {
          cancelHide()
          const rect = el.getBoundingClientRect()
          hoverHashRef.current = hash
          setHover({ hash, top: rect.top, left: rect.left, refs: refs || '', short: short || '' })
          ensureDetail(hash)
        }

        // 行内展开的文件列表：首次展开才请求（bumpFiles 触发展开区行高重算）
        const ensureFiles = (hash) => ensureCached(filesCache, hash, 'commitFiles', (r) => ({ loading: false, files: r.files || [] }), bumpFiles)
        const toggleExpand = (hash) => {
          closeHover()
          const opening = expandedRef.current !== hash
          setExpanded((cur) => (cur === hash ? null : hash))
          if (opening) ensureFiles(hash)
        }

        const total = tops[state.entries.length]
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
          const isOpen = i === expandedIdx
          const rowH = heights[i] || ROWH
          const els = []
          const skipVert = new Set()
          // 分支/合并连线：平滑 S 形贝塞尔曲线，在行的上/下边缘与竖线无缝衔接；
          // 展开行的下缘端点按整行高延伸，lane 在展开区继续下行（图形不断线）
          for (const m of merges) {
            const x1 = X(m), x2 = X(lane)
            if (graph.laneLast[m] === i) {
              // 该 lane 在本行汇入提交节点：从行顶弯入节点
              skipVert.add(m)
              els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x1 + ' -1 C ' + x1 + ' ' + (MID - 7) + ' ' + x2 + ' ' + (MID - 7) + ' ' + x2 + ' ' + MID, fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
            } else {
              // 从提交节点分出新 lane / 并入途经 lane：从节点弯向行底
              if (graph.laneSince[m] === i) skipVert.add(m)
              els.push(React.createElement('path', { key: 'm' + m, d: 'M ' + x2 + ' ' + MID + ' C ' + x2 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (MID + 7) + ' ' + x1 + ' ' + (rowH + 1), fill: 'none', stroke: laneColor(m), strokeWidth: 1.5, strokeLinecap: 'round' }))
            }
          }
          // 垂直 lane 线：贯穿整行；根提交的 lane 止于节点；已由曲线接管的 lane 不再画竖线
          for (const l of active) {
            if (skipVert.has(l)) continue
            const y2 = l === lane && (e.parents || []).length === 0 ? MID : rowH + 1
            els.push(React.createElement('line', { key: 'v' + l, x1: X(l), y1: -1, x2: X(l), y2, stroke: laneColor(l), strokeWidth: 1.5, strokeLinecap: 'round' }))
          }
          // 提交节点：以背景色描边镂空穿过节点的连线
          els.push(React.createElement('circle', { key: 'd', cx: X(lane), cy: MID, r: 4, fill: laneColor(lane), stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 2 }))
          // HEAD 外环：紧贴内球的细空心环，外缘 5.9+0.7=6.6 < 左缘 8px
          if (isHead) els.push(React.createElement('circle', { key: 'h', cx: X(lane), cy: MID, r: 5.9, fill: 'none', stroke: laneColor(lane), strokeWidth: 1.4 }))
          // 行内只展示一个主要分支标签（当前分支高亮），远程分支等完整 refs 放入悬浮详情
          const refs = parseRefs(e.refs)
          const refEls = []
          const primary = refs.current || refs.branches[0] || refs.remotes[0]
          if (primary) refEls.push(React.createElement('span', { key: 'p', className: refs.current ? 'gp-grow-ref gp-grow-ref-cur' : 'gp-grow-ref' }, primary))
          refs.tags.forEach((t, ti) => refEls.push(React.createElement('span', { key: 't' + ti, className: 'gp-grow-ref gp-grow-ref-tag' }, t)))
          const subjectEl = React.createElement('span', { className: 'gp-grow-subject' }, e.subject)
          const refsEl = refEls.length > 0 ? React.createElement('span', { className: 'gp-grow-refs' }, refEls) : null
          const metaEl = React.createElement('span', { className: 'gp-grow-meta' }, (e.author || '') + ' · ' + (e.date || '').slice(0, 10))
          // 展开行：SVG 拉高使 lane 贯穿，右侧为「顶栏 + 文件列表」纵向列；普通行保持原平铺。
          // 展开态复用 gp-grow-sel（选中样式：品牌色左边条 + 浅底）
          rows.push(React.createElement('div', {
            key: e.hash, className: 'gp-grow' + (isOpen ? ' gp-grow-sel' : ''), style: { top: tops[i], height: rowH },
            onClick: () => toggleExpand(e.hash),
            onMouseEnter: (ev) => { if (!isOpen) showDetail(e.hash, ev.currentTarget, e.refs, e.short) },
            onMouseLeave: scheduleHide
          },
            React.createElement('svg', { width: W, height: rowH, viewBox: '0 0 ' + W + ' ' + rowH, style: { display: 'block', flex: '0 0 auto' } }, els),
            isOpen
              ? React.createElement('div', { className: 'gp-grow-col' },
                  React.createElement('div', { className: 'gp-grow-bar' }, subjectEl, refsEl, metaEl),
                  React.createElement(CommitFilesPanel, { e, repo, filesCache, diffSel, onOpenDiff }))
              : null,
            isOpen ? null : subjectEl,
            isOpen ? null : refsEl,
            isOpen ? null : metaEl))
        }

        const body = state.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingHistory')) :
          state.error ? React.createElement('div', { className: 'gp-empty' }, state.error) :
            state.entries.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('emptyHistory')) :
              React.createElement('div', { className: 'gp-graph-scroll', ref: listRef, onScroll: () => { closeHover(); syncWindow() } },
                React.createElement('div', { style: { position: 'relative', height: total + (state.hasMore ? ROWH : 0) } },
                  rows,
                  state.loadingMore ? React.createElement('div', { className: 'gp-grow-more', style: { top: total, height: ROWH } }, React.createElement('span', { className: 'gp-spinner' }), tr('loadingMore')) : null))

        // 悬停唤出的提交详情浮层（见 CommitDetailPop），可移入浮层内查看
        const pop = hover ? React.createElement(CommitDetailPop, { hover, detailCache, onMouseEnter: cancelHide, onMouseLeave: scheduleHide }) : null

        return React.createElement('div', { className: 'gp-history-body' },
          React.createElement('div', { className: 'gp-graph-wrap' }, body),
          pop)
      }

      // 提交区：仅处理已暂存（staged）文件——生成 / 提交 / 提交并推送都基于 stagedPaths。
      // conflictedCount > 0 时提交按钮禁用：git 自己也会拒绝（"Committing is not possible
      // because you have unmerged files"，实测 exit 128），面板提前把原因写在按钮提示里。
      // otherOp 不拦提交（实测 rebase / cherry-pick 冲突解决后 git 接受该提交并据此收尾），
      // 只在提示里说明它会成为该操作的提交、并替换掉原提交信息。
      function CommitArea({ repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus, conflictedCount, otherOp }) {
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
        const canCommit = message.trim() !== '' && stagedPaths.length > 0 && busy === null && !conflictedCount
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
          React.createElement('div', { className: 'gp-menu-note' }, fmt(tr('effectiveRules'), { s: rulesInfo ? (rulesInfo.source === 'repo' ? tr('repoRules') : rulesInfo.source === 'global' ? tr('globalRules') : tr('ruleBuiltin')) : tr('loading') })),
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
            React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: () => doCommit(false), disabled: !canCommit, title: conflictedCount > 0 ? fmt(tr('titleResolveFirst'), { n: conflictedCount }) : otherOp ? fmt(tr('titleOtherOp'), { op: otherOp }) : stagedPaths.length === 0 ? tr('titleStageFirst') : fmt(tr('commitTitle'), { n: stagedPaths.length }) },
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

      // 布局模式设置弹窗：dock（停靠挤压对话）/ overlay（浮窗覆盖）二选一，点击卡片
      // 即生效并记忆 localStorage（gp-layout），无保存按钮；底部提示窄视口自动回退。
      // 单选点是纯 CSS 绘制的圆点（无 input 嵌套 button 的非法交互结构）。
      function LayoutSettingsModal({ onClose }) {
        const s = useStore()
        const pick = (mode) => {
          if (mode !== s.layout) {
            store.set((st) => (st.layout === mode ? st : { ...st, layout: mode }))
            savePrefStr('gp-layout', mode)
          }
          onClose()
        }
        const opt = (mode, titleKey, descKey, badgeKey) => React.createElement('button', {
          className: 'gp-layout-opt' + (s.layout === mode ? ' gp-layout-on' : ''),
          onClick: () => pick(mode)
        },
          React.createElement('span', { className: 'gp-layout-radio', 'aria-hidden': true }),
          React.createElement('span', { className: 'gp-layout-opt-text' },
            React.createElement('span', { className: 'gp-layout-opt-title' }, tr(titleKey), badgeKey ? React.createElement('span', { className: 'gp-layout-default-badge' }, tr(badgeKey)) : null),
            React.createElement('span', { className: 'gp-layout-opt-desc' }, tr(descKey))))
        return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); onClose() } },
          React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' }, icon('gear', 15), tr('panelSettings')),
            React.createElement('div', { className: 'gp-modal-body' },
              opt('dock', 'modeDock', 'modeDockDesc', 'modeDockBadge'),
              opt('overlay', 'modeOverlay', 'modeOverlayDesc', null),
              React.createElement('div', { className: 'gp-layout-hint' }, tr('layoutNarrowHint')))))
      }

      // 小型确认弹窗骨架（放弃更改 / Reset / Clean / 中止合并 共用）：warning 图标标题 +
      // 自定义 body + 取消/危险确认按钮；backdrop 点击关闭，Esc 分层由调用方处理
      function ConfirmModal({ title, body, okLabel, busy, onCancel, onOk }) {
        return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); onCancel() } },
          React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'gp-modal-head' }, icon('warning', 15), title),
            React.createElement('div', { className: 'gp-modal-body' }, body),
            React.createElement('div', { className: 'gp-modal-foot' },
              React.createElement('button', { className: 'gp-btn', onClick: onCancel }, tr('cancel')),
              React.createElement('button', { className: 'gp-btn gp-btn-danger', disabled: !!busy, onClick: onOk }, okLabel))))
      }

      // 文件列表多选状态机（Ctrl/⌘ 增删、Shift 范围，按 'group\u0000path' 键、按仓库隔离）：
      // 普通点击 = 单选激活行（打开/关闭 diff）并清空多选；Shift 以锚点（或激活行）为
      // 起点按可见顺序取范围；修饰键点击不切换 diff（多选只为批量操作服务）。
      // status 刷新后自动剪掉已消失的选中项（移组/放弃后），锚点失效则重置。
      function useMultiSelect(data, groupsOpen, activeKey, onOpenRow) {
        const [selKeys, setSelKeys] = React.useState(() => new Set())
        const anchorRef = React.useRef(null)
        // 可见的扁平顺序（staged → unstaged → untracked，收起的组跳过）：Shift 范围选择按它取区间。
        // 冲突行不在其中：它不参与多选（未合并路径的批量放弃语义不明，见 onRowClick）
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
        // 剪枝按「全部行」（含收起组）校验：收起组里的选中项仍是有效文件，不应被误剪
        React.useEffect(() => {
          if (!data) return
          const valid = new Set((() => {
            const out = []
            for (const g of ['staged', 'unstaged', 'untracked']) for (const f of data[g] || []) out.push(rowKey(g, f.path))
            return out
          })())
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
        // 文件行点击：普通 = 单选并打开/关闭 diff（同一行再次点击 = 取消选中并关闭抽屉）；
        // Ctrl/⌘ = 增删多选；Shift = 锚点到当前行的范围多选。修饰键点击阻止原生文本
        // 选区/焦点抢占（Shift 框选会带出蓝色选区，在 renderGroup 的 onMouseDown 处理）
        const onRowClick = (e, f, group) => {
          const key = rowKey(group, f.path)
          // 冲突行不参与多选：批量放弃对未合并路径没有确定语义（批量暂存才是「全部标记
          // 已解决」，已由分组标题的 ＋ 提供），避免选中后静默无效的假状态。
          // 修饰键下也不切抽屉——其余分组的 Ctrl/⌘/Shift 点击只做多选、不动抽屉，这里保持一致
          if (group === 'conflicted') {
            setSelKeys(new Set())
            if (!(e.ctrlKey || e.metaKey || e.shiftKey)) onOpenRow(f, group)
            return
          }
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
          onOpenRow(f, group)
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
        return { selKeys, setSelKeys, flatKeys, onRowClick, selParts, selCount }
      }

      function RepoCard({ repo, sessionId, onOpenDiff, diffSel, onCloseDiff }) {
        const [status, setStatus] = React.useState({ loading: true, data: null, error: '' })
        const [isCollapsed, setCollapsed] = React.useState(false)
        const [historyOpen, setHistoryOpen] = React.useState(false)
        const [branchMenu, setBranchMenu] = React.useState({ open: false, loading: false, data: null, error: '', creating: false, newName: '' })
        const [moreMenu, setMoreMenu] = React.useState({ open: false })
        const [busy, setBusy] = React.useState(null)
        const [message, setMessage] = React.useState('')
        // 放弃更改确认弹窗：null 或 { byGroup: {staged:[], unstaged:[], untracked:[]}, count }
        const [confirmDiscard, setConfirmDiscard] = React.useState(null)
        // 危险操作确认弹窗（Reset / Clean）：null | 'reset-soft' | 'reset-hard' | 'clean'
        const [confirmDanger, setConfirmDanger] = React.useState(null)
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
        // 完成合并：冲突已全部解决、且解决结果与 HEAD 一致（无暂存差异）时的收尾出口。
        // 与提交同级（只写一个提交、非破坏性），走直接执行 + toast，不弹确认窗。
        const finishMerge = () => runWrite('merge-commit', async () => {
          const res = await callRpc('mergeCommit', { repoId: repo.id, sessionId })
          if (res && res.ok && !res.summary) res.summary = tr('mergeFinishDone')
          return res
        })
        // 分组展开/收起（最左侧 chevron）
        const [groupsOpen, setGroupsOpen] = React.useState({ conflicted: true, staged: true, unstaged: true, untracked: true })
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
        const totalConflicted = data && data.conflicted ? data.conflicted.length : 0
        const mergeInProgress = !!(data && data.mergeInProgress)
        // rebase / cherry-pick / revert 进行中（host 只在「有冲突」或「HEAD detached」时探测，
        // 见 repoStatus）：这三者的冲突同样进冲突组，但收尾出口不在面板里，提示条与提交
        // 按钮的文案都要区分开，否则会把用户引到「提交即完成合并」这条错路上。
        const otherOp = (data && data.otherOp) || null
        // 完成合并将使用的提交信息（host 读 .git/MERGE_MSG 的第一行非注释内容）
        const mergeMessage = (data && data.mergeMessage) || null
        // 合并已无冲突、但解决结果与 HEAD 一致（无可提交的暂存差异）：此时只有「完成合并」能收尾
        const finishMergeOnly = mergeInProgress && totalConflicted === 0 && totalStaged === 0

        // ===== 多选 / 激活行 / 放弃确认（均需 data，置于其后） =====
        // 激活行 = diff 抽屉正展示的行（同一文件可同时出现在 staged/unstaged 两组，须带组判定）。
        // 多选状态机见 useMultiSelect：修饰键点击不切换 diff（多选只为批量操作服务，
        // diff 抽屉保持当前文件不动）
        const activeKey = diffSel && diffSel.repoId === repo.id ? rowKey(diffSel.group, diffSel.path) : null
        const { selKeys, setSelKeys, onRowClick, selParts, selCount } = useMultiSelect(data, groupsOpen, activeKey, (f, group) => onOpenDiff(repo, f, group))

        // 激活行随操作移组/消失时自动关闭 diff 抽屉，避免抽屉展示过期内容；
        // 提交内 diff（group='commit'）的目标来自历史而非工作区变更集，不适用此守卫
        React.useEffect(() => {
          if (!data || !diffSel || diffSel.repoId !== repo.id) return
          if (diffSel.group === 'commit') return
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
          // 「更改」为空时仍保留标题行（占位提示）；其余分组（含冲突组）为空时整组隐藏
          if (list.length === 0 && group !== 'unstaged') return null
          const meta = GROUP_META[group]
          const paths = list.map((f) => f.path)
          const open = groupsOpen[group] !== false
          const isStaged = group === 'staged'
          // 冲突组：该行的 ＋ 语义是「标记为已解决」（host 对未合并路径执行 git add），
          // 而放弃更改对未合并路径没有确定语义（--ours/--theirs 对用户是歧义），
          // 因此冲突行不给放弃按钮，整体出口由下方提示条的「中止合并」提供。
          const isConflicted = group === 'conflicted'
          const hasItems = list.length > 0
          return React.createElement('div', { className: 'gp-section', key: group },
            React.createElement('div', { className: 'gp-section-title', onClick: () => toggleGroup(group) },
              React.createElement('button', { className: 'gp-chev', onClick: (e) => { e.stopPropagation(); toggleGroup(group) } }, icon(open ? 'chevronDown' : 'chevronRight', 13)),
              React.createElement('span', { className: 'gp-section-label' }, tr(meta.titleKey)),
              React.createElement('span', { className: 'gp-spacer' }),
              hasItems ? React.createElement('span', { className: 'gp-row-actions' },
                isConflicted ? null : React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); askDiscard(paths, group) } }, icon('discard')),
                isStaged
                  ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstageAll'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstage(paths) } }, icon('minus'))
                  : React.createElement('button', { className: 'gp-icon-btn', title: isConflicted ? tr('resolveAll') : fmt(tr('stageAll'), { n: list.length }), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stage(paths) } }, icon('plus'))) : null,
              hasItems ? React.createElement('span', { className: 'gp-group-count', title: fmt(tr('groupCount'), { n: list.length }) }, list.length) : null),
            !open ? null : list.map((f) => {
              // DD（双方都删）冲突的解决结果就是删除，保留删除线；其余冲突码上的 U 只是
              // 「未合并」标记，加删除线会误导（DU/UD 的文件仍带着内容）
              const gl = isConflicted ? { g: 'U', cls: 'gp-g-conflict', del: f.x === 'D' && f.y === 'D' } : glyphOf(f.x, f.y)
              const { base, dir } = splitPath(f.path)
              const key = rowKey(group, f.path)
              const cls = 'gp-file-row' + (activeKey === key ? ' gp-file-active' : '') + (selKeys.has(key) ? ' gp-file-sel' : '')
              return React.createElement('div', {
                className: cls, key: group + ':' + f.path, title: f.path,
                // 修饰键点击阻止原生文本选区/焦点抢占（Shift 框选会带出蓝色选区）
                onMouseDown: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault() },
                onClick: (e) => onRowClick(e, f, group)
              },
                React.createElement('span', { className: 'gp-file-dot ' + gl.cls }, '•'),
                // D（删除）类型文件：文件名加删除线（见 .gp-file-name-del）；暂存/未暂存组均适用，
                // 未跟踪组状态恒为 U 不受影响；冲突组仅 DD（双方都删）命中
                React.createElement('span', { className: 'gp-file-name' + (gl.del || gl.g === 'D' ? ' gp-file-name-del' : '') }, base),
                dir ? React.createElement('span', { className: 'gp-file-dir' }, dir) : null,
                f.orig ? React.createElement('span', { className: 'gp-file-orig', title: f.orig }, '← ' + (f.orig.replace(/\/+$/, '').split('/').pop() || f.orig)) : null,
                React.createElement('span', { className: 'gp-spacer' }),
                React.createElement('span', { className: 'gp-row-actions' },
                  isConflicted ? null : React.createElement('button', { className: 'gp-icon-btn gp-icon-btn-discard', title: tr('discardFile'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); discardFromRow(key, f.path, group) } }, icon('discard')),
                  isStaged
                    ? React.createElement('button', { className: 'gp-icon-btn', title: tr('unstage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); unstageFromRow(key, f.path) } }, icon('minus'))
                    : React.createElement('button', { className: 'gp-icon-btn', title: isConflicted ? tr('resolveFile') : tr('stage'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); stageFromRow(key, f.path) } }, icon('plus'))),
                React.createElement('span', { className: 'gp-file-badge ' + gl.cls }, gl.g))
            }))
        }

        // 批量操作（无独立工具栏）：多选后点击任一选中行的
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
        const discardModal = confirmDiscard ? React.createElement(ConfirmModal, {
          title: tr('discardTitle'),
          body: React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'gp-confirm-summary' },
              fmt(confirmDiscard.count === 1 ? tr('discardConfirm1') : tr('discardConfirmN'), { n: confirmDiscard.count })),
            React.createElement('div', { className: 'gp-confirm-note gp-danger' }, tr('discardIrreversible')),
            confirmDiscard.byGroup.untracked.length > 0 ? React.createElement('div', { className: 'gp-confirm-note' }, tr('discardUntrackedNote')) : null,
            React.createElement('div', { className: 'gp-confirm-files' }, discardPreviewText(confirmDiscard))),
          okLabel: tr('discardOk'), busy,
          onCancel: () => setConfirmDiscard(null),
          onOk: doDiscardConfirmed
        }) : null

        // 危险操作确认弹窗（Reset / Clean / 中止合并）：结构同放弃更改弹窗，Esc 由上方分层处理关闭
        const DANGER_INFO = {
          'reset-soft': { title: tr('resetSoftTitle'), note: tr('resetSoftNote') },
          'reset-hard': { title: tr('resetHardTitle'), note: tr('resetHardNote') },
          'clean': { title: tr('cleanTitle'), note: tr('cleanNote') },
          'merge-abort': { title: tr('mergeAbortTitle'), note: tr('mergeAbortNote') }
        }
        const dangerModal = confirmDanger ? React.createElement(ConfirmModal, {
          title: DANGER_INFO[confirmDanger].title,
          body: React.createElement('div', { className: 'gp-confirm-note gp-danger' }, DANGER_INFO[confirmDanger].note),
          okLabel: confirmDanger === 'merge-abort' ? tr('mergeAbortOk') : tr('dangerRun'), busy,
          onCancel: () => setConfirmDanger(null),
          onOk: () => {
            const op = confirmDanger
            setConfirmDanger(null)
            if (op === 'clean') runWrite('clean', () => callRpc('clean', { repoId: repo.id, sessionId }))
            else if (op === 'merge-abort') runWrite('merge-abort', async () => {
              const res = await callRpc('mergeAbort', { repoId: repo.id, sessionId })
              if (res && res.ok && !res.summary) res.summary = tr('mergeAbortDone')
              return res
            })
            else runWrite('reset', () => callRpc('reset', { repoId: repo.id, mode: op === 'reset-hard' ? 'hard' : 'soft', sessionId }))
          }
        }) : null

        // 分支菜单：切换已有分支 + 新建分支（首次打开才加载分支列表）
        const branchMenuEl = branchMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
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
        ) : null

        // 更多操作菜单：Pull / Push / Stash + 危险操作（Reset / Clean，弹确认窗）
        const moreMenuEl = moreMenu.open ? React.createElement('div', { className: 'gp-menu', onClick: (e) => e.stopPropagation() },
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, tr('morePull')),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('push', () => callRpc('push', { repoId: repo.id, sessionId })) } }, tr('morePush')),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash', () => callRpc('stashPush', { repoId: repo.id, message: 'stash @ ' + new Date().toLocaleString(), sessionId })) } }, tr('moreStash')),
          React.createElement('button', { className: 'gp-menu-item', onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); runWrite('stash-pop', () => callRpc('stashPop', { repoId: repo.id, ref: null, sessionId })) } }, tr('moreStashPop')),
          React.createElement('div', { className: 'gp-menu-sep' }),
          // 合并进行中才出现：pull 冲突后「中止合并」是唯一出口，但它同样会丢弃已解决的
          // 内容，仍走确认弹窗（与 Reset/Clean 同级）
          mergeInProgress ? React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('merge-abort') } }, tr('mergeAbortMenu')) : null,
          // 危险操作：弹确认窗（与放弃更改同款），确认后执行
          React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-soft') } }, tr('moreResetSoft')),
          React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('reset-hard') } }, tr('moreResetHard')),
          React.createElement('button', { className: 'gp-menu-item', disabled: !!busy, onClick: () => { setMoreMenu((x) => ({ ...x, open: false })); setConfirmDanger('clean') } }, tr('moreClean'))
        ) : null

        const head = React.createElement('div', { className: 'gp-repo-head', onClick: () => setCollapsed((c) => !c) },
          React.createElement('button', { className: 'gp-btn-icon', onClick: (e) => { e.stopPropagation(); setCollapsed((c) => !c) } }, icon(isCollapsed ? 'chevronRight' : 'chevronDown')),
          React.createElement('span', { className: 'gp-repo-name', title: repo.path }, repo.name),
          data ? React.createElement('span', { className: 'gp-branch' }, icon('branch', 12), data.branch) : null,
          data && data.aheadBehind ? React.createElement('span', { className: 'gp-count', title: fmt(tr('behindAhead'), { b: data.aheadBehind.behind, a: data.aheadBehind.ahead }) }, icon('arrowDown', 12), data.aheadBehind.behind, ' ', icon('arrowUp', 12), data.aheadBehind.ahead) : null,
          data && totalStaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-staged', title: fmt(tr('stagedNTitle'), { n: totalStaged }) }, icon('dot', 7), totalStaged) : null,
          // 冲突计数放在三组计数之前：折叠面板时它是唯一还能看见的冲突信号
          data && totalConflicted > 0 ? React.createElement('span', { className: 'gp-count gp-count-conflict', title: fmt(tr('conflictedNTitle'), { n: totalConflicted }) }, icon('warning', 12), totalConflicted) : null,
          data && totalUnstaged > 0 ? React.createElement('span', { className: 'gp-count gp-count-unstaged', title: fmt(tr('unstagedNTitle'), { n: totalUnstaged }) }, icon('dot', 7), totalUnstaged) : null,
          data && totalUntracked > 0 ? React.createElement('span', { className: 'gp-count gp-count-untracked', title: fmt(tr('untrackedNTitle'), { n: totalUntracked }) }, icon('dot', 7), totalUntracked) : null,
          React.createElement('span', { className: 'gp-spacer' }),
          /* 仓库级「刷新状态」按钮已移除：状态刷新统一由顶部「重新扫描」（全量）+ 自动轮询（定向）触发；
             加载期间在原位置放一个等宽 spinner 占位，保留加载反馈且不抖动布局 */
          status.loading ? React.createElement('span', { className: 'gp-btn-icon', style: { cursor: 'default' } }, React.createElement('span', { className: 'gp-spinner' })) : null,
          React.createElement('button', { className: 'gp-btn-icon', title: tr('pullTitle'), disabled: !!busy, onClick: (e) => { e.stopPropagation(); runWrite('pull', () => callRpc('pull', { repoId: repo.id, sessionId })) } }, busy === 'pull' ? React.createElement('span', { className: 'gp-spinner' }) : icon('pull')),
          React.createElement('div', { className: 'gp-menu-wrap' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('switchBranch'), onClick: (e) => { e.stopPropagation(); openBranchMenu() } }, icon('branch')),
            branchMenuEl),
          React.createElement('div', { className: 'gp-menu-wrap' },
            React.createElement('button', { className: 'gp-btn-icon', title: tr('moreActions'), onClick: (e) => { e.stopPropagation(); openMoreMenu() } }, icon('ellipsis')),
            moreMenuEl),
          (branchMenu.open || moreMenu.open) ? React.createElement('div', { className: 'gp-menu-backdrop', onClick: (e) => { e.stopPropagation(); closeAllMenus() } }) : null)

        const body = isCollapsed ? null :
          React.createElement('div', null,
            status.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loadingStatus')) : status.error ? React.createElement('div', { className: 'gp-empty' }, status.error) :
              React.createElement('div', null,
                React.createElement(CommitArea, { repo, sessionId, stagedPaths, message, setMessage, busy, setBusy, handleWriteResult, refreshStatus: loadStatus, conflictedCount: totalConflicted, otherOp }),
                data && data.statusError ? React.createElement('div', { className: 'gp-empty gp-danger' }, fmt(tr('gitStatusFailed'), { e: data.statusError })) : null,
                // 冲突提示条：未解决冲突 / 合并进行中 / rebase 等进行中时出现，给出动作说明 + 出口按钮。
                // 「完成合并」只在「合并进行中且冲突已全部解决、暂存为空」时出现——那种状态下解决
                // 结果与 HEAD 一致，git status 完全为空（文件既不在冲突组也不在暂存组），提交按钮
                // 因此点不下去，而 git 本身允许直接 commit 收尾（见 host opMergeCommit）。
                // 同一状态还有第二种来路：解决后又取消了暂存——此时解决结果在工作区却没进 index，
                // 所以文案要按 totalUnstaged 分流，不能一律宣称「与 HEAD 一致」。
                // rebase / cherry-pick / revert 冲突（otherOp）不给「完成合并」也不给「中止合并」：
                // 它们的收尾出口（--continue / --skip / --abort）不在面板里，只做指引。
                (totalConflicted > 0 || mergeInProgress || otherOp) ? React.createElement('div', { className: 'gp-conflict-bar' },
                  icon('warning', 14),
                  React.createElement('span', { className: 'gp-conflict-text' },
                    totalConflicted > 0
                      ? (otherOp ? fmt(tr('conflictBarOtherOp'), { n: totalConflicted, op: otherOp }) : fmt(tr('conflictBar'), { n: totalConflicted }))
                      : otherOp ? fmt(tr('conflictBarOtherOpResolved'), { op: otherOp })
                        : finishMergeOnly ? (totalUnstaged > 0 ? tr('conflictBarUnstaged') : tr('conflictBarNoStaged'))
                          : tr('conflictBarResolved')),
                  finishMergeOnly ? React.createElement('button', { className: 'gp-btn gp-btn-primary gp-conflict-finish', title: mergeMessage ? fmt(tr('mergeFinishTitleWith'), { m: mergeMessage }) : tr('mergeFinishTitle'), disabled: !!busy, onClick: finishMerge }, busy === 'merge-commit' ? tr('mergeFinishTitle') + '…' : tr('mergeFinishTitle')) : null,
                  mergeInProgress ? React.createElement('button', { className: 'gp-btn gp-btn-danger gp-conflict-abort', title: tr('mergeAbortMenu'), disabled: !!busy, onClick: () => setConfirmDanger('merge-abort') }, busy === 'merge-abort' ? tr('mergeAbortTitle') + '…' : tr('mergeAbortTitle')) : null) : null,
                !(data && data.statusError) && totalStaged + totalUnstaged + totalUntracked + totalConflicted === 0 ? React.createElement('div', { className: 'gp-empty', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 } }, icon('check', 13), tr('treeClean')) : null,
                // 冲突组置顶：它决定后续能不能提交，优先于常规三组
                renderGroup('conflicted', data && data.conflicted),
                renderGroup('staged', data && data.staged),
                renderGroup('unstaged', data && data.unstaged),
                renderGroup('untracked', data && data.untracked)),
            React.createElement('div', { className: 'gp-history-head', onClick: () => setHistoryOpen((o) => !o) },
              icon(historyOpen ? 'chevronDown' : 'chevronRight', 12),
              icon('history'),
              tr('history')),
            historyOpen ? React.createElement(GitGraphView, { repo, onOpenDiff, diffSel }) : null)

        // 确认弹窗用 fixed 定位，放在卡片外层（Fragment），避免任何卡片内堆叠上下文干扰
        return React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'gp-repo-card' }, head, body),
          discardModal,
          dangerModal)
      }

      // 折叠/展开滑动动效（复用 DiffDrawer 的相位模式，同 240ms/曲线）：点击不立即
      // 切换渲染形态，先进过渡相——离场元素 translateX(100%) 右滑出屏、进场元素从
      // 右缘屏外滑入，两者同时在场 ~240ms；动效播完才写入 collapsed（store +
      // localStorage）并卸载离场元素。过渡相内忽略重复点击。onBeforeCollapse 在
      // 折叠开始前调用（面板用于先关 diff 抽屉）。
      function useCollapseAnimation(onBeforeCollapse) {
        const [collAnim, setCollAnim] = React.useState(null) // null | { dir, entered }
        // 过渡相：双 rAF 先让进场元素的屏外初始帧完成一次绘制，再置 entered 触发
        // transition（根治首帧以终态闪现的问题）
        useEnterTransition(!!collAnim && !collAnim.entered, () => setCollAnim((a) => (a ? { ...a, entered: true } : a)))
        // 收尾：动效播完（对齐 .22s 过渡）才真正切换折叠态并卸载离场元素；
        // 中途组件卸载则取消，不残留定时器
        React.useEffect(() => {
          if (!collAnim || !collAnim.entered) return
          return timer.timeout(() => {
            const toCollapsed = collAnim.dir === 'collapse'
            savePrefBool('gp-collapsed', toCollapsed)
            store.set((st) => ({ ...st, collapsed: toCollapsed }))
            setCollAnim(null)
          }, 240)
        }, [collAnim])
        const startCollapse = () => {
          if (collAnim) return
          if (onBeforeCollapse) onBeforeCollapse()
          setCollAnim({ dir: 'collapse', entered: false })
        }
        const startExpand = () => { if (!collAnim) setCollAnim({ dir: 'expand', entered: false }) }
        return { collAnim, startCollapse, startExpand }
      }

      function workspaceOfSession(st, sessionId) {
        if (!st || !Array.isArray(st.items)) return null
        const items = st.items
        let w = null
        if (sessionId) w = items.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.indexOf(sessionId) >= 0) || null
        if (!w && st.recentWorkspaceId) w = items.find((x) => x.workspaceId === st.recentWorkspaceId) || null
        return w
      }

      // ===== 布局模式（dock 停靠 / overlay 浮窗）几何写路径 =====
      // 主路径纯 CSS：body[data-gp-dock] 属性 + div:has(> [data-shell-overlay]) 选择器
      // （见样式段注释）。:has() 不可用的老环境走 JS 兜底：直接给 frame
      // （[data-shell-overlay] 的父级）写内联 padding-right。React 重渲染只 diff 自己
      // 管理的 style 键，内联 paddingRight 不会被抹掉；frame 整体重挂载时由 body 级
      // MutationObserver 重涂（DSH-better-sidebar「panel host + 几何写路径」路线的
      // 极简版）。锚点 [data-shell-overlay] 属 ui-layout 产物，版本升级若移除需同步
      // 更新此处与样式段选择器（better-sidebar 对 DSH 版本敏感的前车之鉴）。
      let dockW = 520
      let dockObserver = null
      // 折叠竖条宽度（px）：与样式段 .gp-rail 的 width 保持一致，折叠态并入停靠
      // 挤压通道时以此值顶替面板宽（见 GitPanelMain 的 railPush/pushW）
      const RAIL_W = 44
      const DOCK_CSS_OK = (() => {
        try { return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('selector(div:has(*))') } catch (e) { return false }
      })()
      const dockFrameEl = () => {
        try {
          const layer = document.querySelector('[data-shell-overlay]')
          return (layer && layer.parentElement) || null
        } catch (e) { return null }
      }
      const dockInline = (w) => {
        const el = dockFrameEl()
        if (!el) return
        if (el.style.paddingRight !== w + 'px') el.style.paddingRight = w + 'px'
        if (el.style.boxSizing !== 'border-box') el.style.boxSizing = 'border-box'
      }
      const dockInlineClear = () => {
        const el = dockFrameEl()
        if (el) { el.style.removeProperty('padding-right'); el.style.removeProperty('box-sizing') }
      }
      // 停靠几何总入口：写 body 属性/CSS 变量（驱动 CSS 主路径），必要时启停 JS 兜底；
      // active=false 清除全部痕迹（模式切换 / 面板关闭 / 卸载热重载共用）。
      const applyDockGeometry = (active, w, noanim) => {
        if (typeof document === 'undefined' || !document.body) return
        dockW = w
        const body = document.body
        if (active) {
          body.setAttribute('data-gp-dock', '1')
          body.style.setProperty('--gp-dock-w', w + 'px')
          if (noanim) body.setAttribute('data-gp-dock-noanim', '1')
          else body.removeAttribute('data-gp-dock-noanim')
        } else {
          body.removeAttribute('data-gp-dock')
          body.removeAttribute('data-gp-dock-noanim')
          body.style.removeProperty('--gp-dock-w')
        }
        if (DOCK_CSS_OK) {
          dockInlineClear()
          if (dockObserver) { dockObserver.disconnect(); dockObserver = null }
          return
        }
        if (active) {
          dockInline(w)
          if (!dockObserver && typeof MutationObserver !== 'undefined') {
            dockObserver = new MutationObserver(() => { if (document.body.hasAttribute('data-gp-dock')) dockInline(dockW) })
            dockObserver.observe(body, { childList: true, subtree: true })
          }
        } else {
          if (dockObserver) { dockObserver.disconnect(); dockObserver = null }
          dockInlineClear()
        }
      }

      // 停靠几何同步组件（渲染 null）：DockSync 挂载期间每次渲染后同步
      // 「是否挤压 + 挤压宽（面板宽或折叠竖条 RAIL_W）+ 拖拽态」；卸载（面板关闭/
      // 插件卸载）时清除全部痕迹。on/w 由调用方计算（含折叠动画相位与窄视口守卫），
      // 此处只负责写。
      function DockSync({ on, w, noanim }) {
        React.useEffect(() => { applyDockGeometry(on, w, !!noanim) })
        React.useEffect(() => () => { applyDockGeometry(false, 0, false) }, [])
        return null
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
        // 面板设置弹窗（布局模式 dock/overlay）开关
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        // 停靠窄视口守卫（见 dockActive 计算）：跟踪窗口宽度
        const [innerW, setInnerW] = React.useState(() => (typeof window === 'undefined' ? 9999 : window.innerWidth))
        React.useEffect(() => {
          if (typeof window === 'undefined') return
          const onRz = () => setInnerW(window.innerWidth)
          window.addEventListener('resize', onRz)
          return () => window.removeEventListener('resize', onRz)
        }, [])
        // 折叠/展开滑动动效（见 useCollapseAnimation）：折叠开始前先关 diff 抽屉
        const { collAnim, startCollapse, startExpand } = useCollapseAnimation(() => setDiffSel(null))
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
              // 扫描完成后联动刷新所有仓库状态（重扫 + 全量状态刷新）。
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
        // untracked/conflicted/mergeInProgress/otherOp），有变化则触发对应仓库的定向刷新（bump refreshTick）。
        // conflicted 与 mergeInProgress 必须入指纹：冲突发生时 staged/unstaged 可能全为空，
        // 只有这两个字段变化（外部终端里 pull/merge 出冲突正是该场景）；otherOp 同理——
        // rebase 冲突被外部解决后 conflicted 变空、而 rebase 仍在进行，只有它能反映这段过渡。
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
                const fp = [res.branch, res.aheadBehind, res.staged, res.unstaged, res.untracked, res.conflicted, res.mergeInProgress, res.otherOp]
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

        // 面板左缘拖拽调宽：宽度 = 视口宽 − 指针 x（钳到 [380, 视口 96%]），
        // 松手时持久化到 localStorage
        const dragApply = (e) => {
          const w = Math.min(Math.round(window.innerWidth * 0.96), Math.max(380, Math.round(window.innerWidth - e.clientX)))
          store.set((st) => (st.panelW === w ? st : { ...st, panelW: w }))
          return w
        }
        const widthDrag = useWidthDrag(dragApply, (w) => savePrefInt('gp-panel-w', 380, 2400, w), () => setResizing(false))

        // 面板关闭时同步关闭 diff 抽屉，避免下次打开面板时残留上次的 diff 选择
        React.useEffect(() => { if (!s.panelOpen) setDiffSel(null) }, [s.panelOpen])

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
            React.createElement('button', { className: 'gp-btn-icon', title: tr('panelSettings'), onClick: () => setSettingsOpen(true) }, icon('gear')),
            React.createElement('button', { className: 'gp-btn-icon', title: tr('close'), onClick: () => store.set((st) => ({ ...st, panelOpen: false })) }, icon('close'))))

        const body = React.createElement('div', { className: 'gp-body' },
          !wsPath ? React.createElement('div', { className: 'gp-empty' }, tr('noWorkspace')) :
            scan.state === 'scanning' || scan.state === 'idle' ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), scan.state === 'idle' ? ' ' + tr('locating') : ' ' + tr('scanning')) :
            scan.state === 'error' ? React.createElement('div', { className: 'gp-empty' }, scan.error) :
              scan.repos.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('noRepos')) :
                scan.repos.map((r) => React.createElement(RepoCard, {
                  key: r.id, repo: r, sessionId, diffSel, onCloseDiff: requestCloseDiff,
                  // 普通点击行 = 单选该行并打开 diff；再次点击同一行（同 repo 同组同路径，
                  // 提交文件还须同 hash）= 进入关闭相位（抽屉滑出动效播完才卸载，见
                  // requestCloseDiff/finishCloseDiff）
                  onOpenDiff: (repo2, f, group) => setDiffSel((prev) => prev && prev.repoId === repo2.id && prev.path === f.path && prev.group === group && (prev.hash || null) === (f.hash || null)
                    ? { ...prev, closing: true }
                    : { repoId: repo2.id, path: f.path, group, x: f.x, y: f.y, hash: f.hash || null, short: f.short || '', orig: f.orig || null })
                })))

        // 折叠/展开渲染：稳态只渲染一种形态（panelOpen 语义不变，自动刷新轮询继续）；
        // 过渡相内面板与竖条同时在场 —— 离场元素 translateX(100%) 右滑出屏（禁指针），
        // 进场元素从右缘屏外滑入。diff 抽屉在折叠时已关闭（折叠动作里 setDiffSel(null)）。
        const collDir = collAnim ? collAnim.dir : null
        const collOn = !!(collAnim && collAnim.entered)
        const panelOff = collDir === 'collapse' ? collOn : collDir === 'expand' ? !collOn : false
        const railOff = collDir === 'collapse' ? !collOn : collDir === 'expand' ? collOn : false

        // 停靠生效条件：偏好 dock + 视口 ≥1200px（窄窗临时退化浮窗——DSH 自身
        // sidebar 在 1024px 也会自动折叠，停靠挤压在窄窗会把对话列压死）+ 面板可见
        // （打开 + 未折叠 + 非离场相位）。面板离场（panelOff）即解除挤压，
        // padding 过渡与面板滑出/滑入同步（同曲线同时长）。
        const panelVisible = s.panelOpen && (!s.collapsed || collDir === 'expand')
        const dockActive = s.layout === 'dock' && innerW >= 1200 && panelVisible && !panelOff

        // 折叠竖条并入同一挤压通道（mini-dock）：竖条是 fixed 全高覆盖层，不在布局上
        // 让位会盖住对话列右缘（会话头部 Session log 按钮、消息与输入框右段）。折叠
        // 稳态与收进相（rail 滑入）以 RAIL_W 顶替面板宽——padding 从 panelW 平滑收到
        // 44px；展开相（rail 滑出）目标取 0：dock 模式下一帧即被 dockActive 接管
        // （44→panelW），overlay 模式 padding 随竖条滑出同步收 0（若保持 44 到竖条
        // 卸载，收尾帧会无过渡跳变）。宽视口守卫与 dock 同阈值；窄窗维持覆盖不挤压。
        const railMounted = s.collapsed || collDir === 'collapse'
        const railPush = railMounted && innerW >= 1200
        const pushOn = dockActive || railPush
        const pushW = dockActive ? s.panelW : (collDir === 'expand' ? 0 : RAIL_W)

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
            onPointerDown: (e) => { e.preventDefault(); widthDrag.begin(); setResizing(true) }
          }),
          header,
          React.createElement('div', { className: 'gp-main' }, body)) : null

        return React.createElement(React.Fragment, null,
          React.createElement(DockSync, { on: pushOn, w: pushW, noanim: resizing }),
          panel,
          rail,
          settingsOpen ? React.createElement(LayoutSettingsModal, { onClose: () => setSettingsOpen(false) }) : null,
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

      // 插件卸载/热重载时移除文件态注入的 <style>（动态包形态由宿主 styles 服务管理）
      // 并清除停靠几何痕迹（body 属性/CSS 变量/兜底内联样式），防止页面残留挤压
      return () => {
        if (disposeCss) disposeCss()
        applyDockGeometry(false, 0, false)
      }
    }
  }
}
