/**
 * apply 运行时服务持有层（ctx / timer）。
 *
 * 拆模块后，组件文件无法再像旧单文件那样闭包引用 apply(ctx) 里的局部量；
 * callRpc（要 ctx.get('connection')）、toast/动效定时（要 timer）、GitPanelMain
 * （要 ctx.get('locale' / 'workspaces')）统一经本模块读取，apply 入口负责注入。
 * 单 Client bundle 每页面只装载一次、apply 每次激活重新注入（重装载覆盖旧值）。
 */
let currentCtx = null
let currentTimer = null

// shell.overlay 槽位捕获的快照钩子（useSessions / useWorkspaces）：原生侧栏模式的页签正文
// 没有这份 slot props，而工作区解析又必须拿到它（GitPanelMain.resolveWorkspace）。所以在
// overlay 注册回调里把 props 原样暂存到这里——注册始终执行（无论当前布局模式），native
// 模式的页签正文经这里取钩子；native 下 overlay 实例返回 null，不双渲染。模块级持有：
// bundle 重装载才清零，与 scanResultsByRoot 同生命周期。
const overlayHooks = { useSessions: null, useWorkspaces: null }
export function stashOverlayHooks(useSessions, useWorkspaces) {
  overlayHooks.useSessions = typeof useSessions === 'function' ? useSessions : null
  overlayHooks.useWorkspaces = typeof useWorkspaces === 'function' ? useWorkspaces : null
}
export function takeOverlayHooks() {
  return overlayHooks
}

export function initClientServices(ctx, timer) {
  currentCtx = ctx
  currentTimer = timer
}

export function getClientCtx() {
  return currentCtx
}

export function getTimer() {
  return currentTimer
}
