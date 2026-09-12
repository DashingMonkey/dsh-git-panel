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
