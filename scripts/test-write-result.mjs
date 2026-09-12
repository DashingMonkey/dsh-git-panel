/**
 * 行为回归：RepoCard.handleWriteResult 真值表（8 场景：提交成功 / 提交后推送成功 /
 * 更多操作 Push 成功 / 撤销成功(带 undoCommit) / 撤销失败(HEAD 已前移) / 撤销失败(拿不到 hash)
 * / 暂存成功(不关窗) / 推送失败；撤销成功时 toast 需含被撤掉的短 hash）。
 *
 * handleWriteResult 是所有写操作（提交/推送/撤销/暂存…）的收尾汇聚点，「提交成功、
 * 推送失败」弹窗的关窗时机也由它决定——历史上撤销成功被报成失败的事故就出在这条链上。
 * 提取方式：acorn AST 定位 VariableDeclarator（不猜括号配对），函数体放进 node:vm，
 * 配真实 i18n（tr/fmt）与真实 store，打桩 pushToast / applyPushFail。
 * 8 个场景：
 *   1 提交成功            2 提交后推送成功（关弹窗）
 *   3 更多操作 Push 成功（关弹窗）   4 撤销成功(带 undoCommit，toast 含短 hash，关弹窗)
 *   5 撤销失败(HEAD 已前移，弹窗保留) 6 撤销失败(拿不到 hash，弹窗保留)
 *   7 暂存成功(不关窗)     8 推送失败(弹窗保留)
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { parse } from 'acorn'
import { tr, fmt } from '../src/client/i18n.js'
import { store, resetStore } from '../src/client/store.js'
import { initClientServices } from '../src/client/runtime.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- AST 提取 handleWriteResult ----
const src = readFileSync(join(ROOT, 'src', 'client', 'components', 'RepoCard', 'index.js'), 'utf8')
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
let declarator = null
const visit = (node) => {
  if (!node || typeof node !== 'object' || declarator) return
  if (Array.isArray(node)) { node.forEach(visit); return }
  if (typeof node.type === 'string') {
    if (node.type === 'VariableDeclarator' && node.id && node.id.name === 'handleWriteResult') { declarator = node; return }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue
      visit(node[key])
    }
  }
}
visit(ast)
if (!declarator) {
  console.error('✗ 未能在 RepoCard/index.js 中定位 handleWriteResult（函数被改名/移走？请同步更新本脚本）')
  process.exit(1)
}
const fnSource = src.slice(declarator.start, declarator.end) // "handleWriteResult = (res, label) => { … }"

// ---- 运行环境：真实 i18n/store/runtime + 打桩 pushToast/applyPushFail ----
initClientServices({ get: () => null }, { timeout: (fn, ms) => () => {} })
const toastLog = []
const pushToast = (kind, text) => { toastLog.push({ kind, text: String(text) }) }
const applyPushFailCalls = []
const applyPushFail = (v, opts) => { applyPushFailCalls.push({ v, opts }) }
const repo = { id: 'repo-1' }
const handleWriteResult = vm.runInNewContext(
  '(function () { const ' + fnSource + '\n; return handleWriteResult })()',
  { tr, fmt, pushToast, store, repo, applyPushFail, console },
  { filename: 'handleWriteResult.vm.js' }
)

const results = []
const scenario = (name, run) => {
  toastLog.length = 0
  applyPushFailCalls.length = 0
  resetStore()
  const checks = run()
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

// 1) 提交成功：成功 toast + store 记 commit，弹窗无关（applyPushFail 不被调）
scenario('1 提交成功', () => {
  const ret = handleWriteResult({ ok: true, summary: '已提交' }, 'COMMIT')
  return [
    eq(ret, 'ok', '返回值'),
    eq(toastLog.length, 1, 'toast 条数'),
    eq(toastLog[0] && toastLog[0].kind, 'success', 'toast 类型'),
    eq(toastLog[0] && toastLog[0].text, '已提交', 'toast 文本'),
    eq(store.get().lastOp, 'commit', 'store.lastOp'),
    eq(store.get().lastOpRepoId, 'repo-1', 'store.lastOpRepoId'),
    eq(store.get().refreshTick, 1, 'store.refreshTick'),
    eq(applyPushFailCalls.length, 0, 'applyPushFail 调用次数')
  ]
})

// 2) 提交后推送成功：label PUSH（大写）→ 关推送失败弹窗
scenario('2 提交后推送成功', () => {
  const ret = handleWriteResult({ ok: true, summary: '已推送' }, 'PUSH')
  return [
    eq(ret, 'ok', '返回值'),
    eq(applyPushFailCalls.length, 1, 'applyPushFail 调用次数'),
    eq(applyPushFailCalls[0] && applyPushFailCalls[0].v, null, 'applyPushFail 参数（关窗）'),
    eq(toastLog[0] && toastLog[0].kind, 'success', 'toast 类型'),
    eq(store.get().lastOp, 'write', 'store.lastOp')
  ]
})

// 3) 更多操作 Push 成功：label 小写 push，同样关弹窗（label 大小写不统一，按小写比对）
scenario('3 更多操作 Push 成功', () => {
  const ret = handleWriteResult({ ok: true, summary: 'PUSH完成' }, 'push')
  return [
    eq(ret, 'ok', '返回值'),
    eq(applyPushFailCalls.length, 1, 'applyPushFail 调用次数'),
    eq(applyPushFailCalls[0] && applyPushFailCalls[0].v, null, 'applyPushFail 参数（关窗）')
  ]
})

// 4) 撤销成功（带 undoCommit）：toast 含被撤掉的短 hash，关弹窗
scenario('4 撤销成功(带 undoCommit)', () => {
  const ret = handleWriteResult({ ok: true, undoCommit: 'abc1234' }, 'reset')
  const expectSummary = (res2) => (res2.summary || tr('pushFailUndoDone')) + ' · ' + fmt(tr('pushFailUndoHash'), { h: 'abc1234' })
  return [
    eq(ret, 'ok', '返回值'),
    eq(toastLog[0] && toastLog[0].kind, 'success', 'toast 类型'),
    eq(toastLog[0] && toastLog[0].text, expectSummary({}), 'toast 文本（含短 hash）'),
    eq(toastLog[0] && toastLog[0].text.includes('abc1234'), true, 'toast 含被撤掉的短 hash'),
    eq(applyPushFailCalls.length, 1, 'applyPushFail 调用次数'),
    eq(store.get().lastOp, 'write', 'store.lastOp')
  ]
})

// 5) 撤销失败（HEAD 已前移）：错误 toast，弹窗保留（applyPushFail 不被调）
scenario('5 撤销失败(HEAD 已前移)', () => {
  const ret = handleWriteResult({ ok: false, error: 'HEAD 已前移，拒绝撤销' }, 'reset')
  return [
    eq(ret, 'error', '返回值'),
    eq(toastLog.length, 1, 'toast 条数'),
    eq(toastLog[0] && toastLog[0].kind, 'error', 'toast 类型'),
    eq(toastLog[0] && toastLog[0].text, 'HEAD 已前移，拒绝撤销', 'toast 文本'),
    eq(applyPushFailCalls.length, 0, 'applyPushFail 未被调（弹窗保留）')
  ]
})

// 6) 撤销失败（拿不到 hash）：同样错误收尾、弹窗保留
scenario('6 撤销失败(拿不到 hash)', () => {
  const ret = handleWriteResult({ ok: false, error: tr('pushFailNoHash') }, 'reset')
  return [
    eq(ret, 'error', '返回值'),
    eq(toastLog[0] && toastLog[0].text, tr('pushFailNoHash'), 'toast 文本'),
    eq(applyPushFailCalls.length, 0, 'applyPushFail 未被调（弹窗保留）')
  ]
})

// 7) 暂存成功：成功 toast，但不关推送失败弹窗（暂存与推送失败现场无关）
scenario('7 暂存成功(不关窗)', () => {
  const ret = handleWriteResult({ ok: true, summary: '已暂存' }, 'stage')
  return [
    eq(ret, 'ok', '返回值'),
    eq(toastLog[0] && toastLog[0].kind, 'success', 'toast 类型'),
    eq(applyPushFailCalls.length, 0, 'applyPushFail 未被调（弹窗保留）'),
    eq(store.get().lastOp, 'write', 'store.lastOp')
  ]
})

// 8) 推送失败：错误 toast，弹窗保留
scenario('8 推送失败', () => {
  const ret = handleWriteResult({ ok: false, error: '! [rejected] main -> main' }, 'PUSH')
  return [
    eq(ret, 'error', '返回值'),
    eq(toastLog.length, 1, 'toast 条数'),
    eq(toastLog[0] && toastLog[0].kind, 'error', 'toast 类型'),
    eq(toastLog[0] && toastLog[0].text, '! [rejected] main -> main', 'toast 文本'),
    eq(applyPushFailCalls.length, 0, 'applyPushFail 未被调（弹窗保留）')
  ]
})

const failedAll = results.filter((r) => r.failed.length > 0)
console.log('')
console.log(failedAll.length === 0
  ? `✓ handleWriteResult 真值表 8/${results.length} 全部符合预期`
  : `✗ 真值表 ${results.length - failedAll.length}/${results.length} 通过，失败场景见上`)
process.exit(failedAll.length ? 1 : 0)
