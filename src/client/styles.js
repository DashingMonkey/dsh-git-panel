/**
 * 面板全部 CSS（体量最大的一块，独立成文件）+ 样式注入（双形态）。
 * 调整观感只动 PANEL_CSS；注入时机与销毁在 index.js 的 apply 里。
 */

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

export const PANEL_CSS = `
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
/* 转圈必须是正圆 —— 必须显式写 corner-shape: round。
   宿主主题（@deepseek-ai/dsh-client-ui-theme）在支持该属性的浏览器里注入
   「*, :before, :after { corner-shape: var(--dsw-corner-shape) }」且把变量定为
   superellipse(1.5)（方圆/超椭圆，宿主的设计语言）。border-radius:50% 于是被画成
   超椭圆而不是圆 —— 12px 的转圈看上去「不圆」正是这个原因（宿主自己的 spinner
   也写了 corner-shape:round 才保住圆形）。
   本类特异性 (0,1,0) 高于主题的 *(0,0,0)，声明即盖回正圆；不支持 corner-shape 的
   浏览器直接忽略这条声明，border-radius:50% 本来就是正圆，两个方向都安全。 */
.gp-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; corner-shape: round; animation: gp-spin .8s linear infinite; }
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
/* 推送失败弹窗：报错原文直接用 gp-confirm-files 这一块等宽区域整段显示，
   不再有「查看/收起」切换——看到的就是完整的 git 原文 */
.gp-confirm-files { margin-top: 8px; max-height: 150px; overflow-y: auto; border: 1px solid var(--gp-border-1); border-radius: 6px; padding: 6px 9px; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-all; }
.gp-commit-area { padding: 9px 10px 10px; border-bottom: 1px solid var(--gp-border-1); background: var(--dsw-alias-bg-layer-1); }
/* 生成中在提交区顶边扫过一条不高调的光带：整个提交区都在「呼吸」，
   即使文字还没吐出来也能一眼看出在跑（比只在角落放个小圆点明显得多）。
   3px 不影响下面的输入框，is-generating 类只在生成期间挂上。 */
.gp-commit-area.gp-generating::before { content: ''; display: block; height: 2px; margin: -9px -10px 7px; background: linear-gradient(90deg, transparent, var(--dsw-alias-brand-primary), transparent); background-size: 45% 100%; background-repeat: no-repeat; animation: gp-sweep 1.35s linear infinite; }
@keyframes gp-sweep { from { background-position: -45% 0; } to { background-position: 145% 0; } }
.gp-textarea { width: 100%; resize: none; border: 1px solid var(--gp-border-2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding: 7px 9px; font-size: 13px; line-height: 1.5; font-family: inherit; min-height: 58px; max-height: 138px; }
.gp-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.gp-commit-row { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; gap: 8px; }
.gp-left-group { display: flex; gap: 6px; align-items: center; }
.gp-commit-actions { display: flex; gap: 6px; margin-top: 8px; }
.gp-commit-actions .gp-btn { flex: 1; padding: 6px 12px; font-weight: 600; }
.gp-staged-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
/* 终止生成：占位切换（生成中把「生成」换成它），固定最小宽度让两个状态的按钮等宽，
   右侧 .gp-staged-hint 不会随之左右抖动 */
.gp-stop-btn { min-width: 84px; }
/* 生成进行中的存活指示：转圈 + 「生成中 12s」。
   转圈复用 .gp-spinner，和原先「⟳ 生成中…」按钮是同一个视觉语言；
   秒数靠已有的轮询（120ms）刷新，不需要额外定时器 */
.gp-gen-progress { font-size: 11.5px; color: var(--dsw-alias-brand-primary); white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
.gp-history-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; border-top: 1px solid var(--gp-border-1); font-size: 13px; color: var(--dsw-alias-label-secondary); }
.gp-history-head:hover { color: var(--dsw-alias-label-primary); }
.gp-history-body { display: flex; padding: 6px 8px 10px; border-top: 1px solid var(--gp-border-1); height: 470px; }
.gp-graph-wrap { flex: 1 1 auto; min-width: 0; border: 1px solid var(--gp-border-1); border-radius: 6px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; }
.gp-graph-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-bottom: 1px solid var(--gp-border-1); }
.gp-graph-tab { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 12px; padding: 2px 8px; border-radius: 5px; cursor: pointer; }
.gp-graph-tab:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gp-graph-tab-on { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.gp-graph-scroll { position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
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
/* 单选点同理要显式 corner-shape:round：主题的全局 superellipse(1.5) 会把
   border-radius:50% 画成圆角方块（15px 下肉眼一眼可辨）。该属性不继承，
   所以 ::after 的实心点必须自己再声明一次。 */
.gp-layout-opt { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--gp-border-2); border-radius: 8px; padding: 11px 12px; cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; margin-bottom: 8px; font-family: inherit; }
.gp-layout-opt:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gp-layout-opt.gp-layout-on { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.gp-layout-radio { flex: none; width: 15px; height: 15px; border-radius: 50%; corner-shape: round; border: 1.5px solid var(--gp-border-2); margin-top: 2px; position: relative; transition: border-color .12s ease; }
.gp-layout-opt.gp-layout-on .gp-layout-radio { border-color: var(--dsw-alias-brand-primary); }
.gp-layout-opt.gp-layout-on .gp-layout-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-brand-primary); }
.gp-layout-opt-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.gp-layout-opt-title { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.gp-layout-opt-desc { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.gp-layout-default-badge { font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 7px; border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); flex: none; line-height: 1.6; }
.gp-layout-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; margin: 6px 0 0; }
`

export { injectCss }
