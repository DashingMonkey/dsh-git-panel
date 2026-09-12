/**
 * RPC 纯函数层：信封摊平（unwrapRpc）+ 通道选择（callRpc）+ 业务判据（isPushNoUpstream）。
 * 所有 RPC 错误都经 unwrapRpc 这一个边界摊平/剥内部标记，下游组件只读业务字段。
 */
import { getClientCtx } from './runtime.js'
// 双形态 RPC：
//   - 动态 Cordis 包：host.call(method, args)（运行器注入的内置件）
//   - 文件态：ctx.connection.rpc.call('/git-panel', method, args)
//     （@deepseek-ai/dsh-client-connection 的通用 RPC 通道；Host 半体不再用
//       connection.rpc.handle 注册，而是按 dsh-client-connection 挂 /api 的方式
//       直接占用 webServer 的 /git-panel 前缀路由，信封与信任围栏完全一致，
//       见 src/host.js 的 registerHttpChannel）
// 协议信封为 {ok:true, value} / {ok:false, error:{code,message,details}}；
// 这里统一摊平为 {ok:true, ...value} / {ok:false, error:<string>, detail?/reason?/command?}，
// 下游组件保持读业务字段的旧约定，无需逐处适配。
// 失败信封的 error.details 里带着业务字段（连接库的 rpcErrorSchema.details 是
// record(string, unknown)，两端都原样保留；Host 侧见 toEnvelope）：
//   detail  = 业务原文（如今只有 push 失败会塞 git 原文，见 host.js 的 opPush），
//             「查看/复制报错原文」读的就是摊平后的 res.detail
//   reason  = 结构化判据（'no-upstream'），供 Client 认「无上游」这条失败
//   command = Host 定稿的建议命令，Client 直接照搬（不必自己猜 remote）
// ⚠ 内部标记必须在这里剥掉：这是**所有** RPC 错误的唯一汇聚点，而带标记的失败不止走弹窗
//（「更多操作 → Push」与弹窗内「重试推送」都经 runWrite → handleWriteResult 直接进 toast）。
// 收敛到这一处，就不必在每个展示点各剥一次、也不会再漏。调用方要分流请读 res.reason
//（不是 error 文本——标记在这里已经被剥掉了）；标记本身不会出现在任何用户可见文案里。
const RP_MARK_PUSH_NO_UPSTREAM = '[push-no-upstream]'
const stripRpcMarks = (s) => {
  if (typeof s !== 'string' || s.indexOf(RP_MARK_PUSH_NO_UPSTREAM) < 0) return s
  return s.split(RP_MARK_PUSH_NO_UPSTREAM).join('').trim()
}
const unwrapRpc = (p) => p.then((res) => {
  if (res && res.ok === true) {
    if (res.value !== null && typeof res.value === 'object') return Object.assign({ ok: true }, res.value)
    return { ok: true, value: res.value }
  }
  if (res && res.ok === false && res.error && typeof res.error === 'object') {
    const err = { ok: false, error: stripRpcMarks(res.error.message || res.error.code || 'error') }
    const d = res.error.details
    // 业务字段（Host 的 toEnvelope 放进来）：detail = git 原文，reason/command = 无上游
    // 失败的结构化判据与定稿建议命令。逐字段显式搬运，不整体展开 details——那是协议字段，
    // 摊平进业务层会污染下游对 res 的读取。
    if (d && typeof d === 'object') {
      if (typeof d.detail === 'string' && d.detail) err.detail = d.detail
      if (typeof d.reason === 'string' && d.reason) err.reason = d.reason
      if (typeof d.command === 'string' && d.command) err.command = d.command
    }
    return err
  }
  return res
})
const callRpc = (method, args) => {
  if (typeof host !== 'undefined' && host && typeof host.call === 'function') return unwrapRpc(host.call(method, args))
  const conn = getClientCtx().get('connection')
  if (conn && conn.rpc && typeof conn.rpc.call === 'function') return unwrapRpc(conn.rpc.call('/git-panel', method, args))
  return Promise.reject(new Error('git-panel: no RPC channel available'))
}

// 这次失败是不是「分支没有上游」。判据取 unwrapRpc 摊平出来的结构化字段 reason
// （Host 侧 opPush 里写 'no-upstream'，含义见 host.js），不去匹配文案——那句话一改语言或
// 措辞就失效。
// ⚠ 放在**文件作用域**（工厂内、组件外），不是某个组件里：CommitArea 与 RepoCard 都要用
// 它。这是纯函数，谁都可以读；反过来，把它塞进某个组件、再从另一个组件调，就是跨作用域
// ReferenceError（本项目已因这类错误崩过四次）。
const isPushNoUpstream = (res) => !!(res && res.reason === 'no-upstream')
// 仅供本模块内部使用（unwrapRpc 在 callRpc 里、stripRpcMarks 在 unwrapRpc 里），不对外导出：
// 导出它们只会给出"下游可以自行摊平信封"的错误暗示——摊平必须只在这一个边界发生。
export { callRpc, isPushNoUpstream }
