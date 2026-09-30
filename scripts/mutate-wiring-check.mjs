/**
 * 变异测试（mutation test）：验证「场景 8 接线断言」在接线真的断掉时会变红。
 * 不会失败的断言等于没有——本脚本把 RepoCard 里每一处决定草稿存活的接线逐个改坏，
 * 逐个跑 test-message-draft.mjs，要求它 exit != 0。
 *
 * 实现要点：**不碰真源码**。改坏后的文本写进系统临时目录，用 GP_WIRING_SRC 指给
 * 测试脚本读（见那边的说明）。曾经用 PowerShell 往返读写真文件来做变异，外壳把
 * UTF-8 中文改成了乱码、把 LF 换成 CRLF，源码当场坏掉——所以这里全程 node:fs。
 *
 * 用法：node scripts/mutate-wiring-check.mjs（默认不在 npm test 链路里：它是给
 * 「改了测试脚本/改了接线」时手工核对的工具，不是每次构建都要跑的门）。
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client', 'components', 'RepoCard', 'index.js')
const TEST = join(ROOT, 'scripts', 'test-message-draft.mjs')

const original = readFileSync(SRC, 'utf8')

// 每一处都是「草稿会因此静默失效」的真实回归写法（都是本功能实现过程中出现过或极易出现的）
const MUTATIONS = [
  ['M1 CommitArea prop 传裸 setMessage', 'setMessage: updateMessage', 'setMessage: setMessage'],
  ['M2 updateMessage 不写草稿', 'const updateMessage = (v) => { setMessage(v); setMessageDraft(repo.path, v) }', 'const updateMessage = (v) => { setMessage(v) }'],
  ['M3 提交成功清空绕开写入口', "s.refreshTick > 0) updateMessage('')", "s.refreshTick > 0) setMessage('')"],
  ['M4 状态初值不再读草稿', 'const d = getMessageDraft(repo.path)\n    setMessageDraft(repo.path, d)\n    return d', "return ''"],
  ['M5 删掉跨仓库恢复 effect', 'const d = getMessageDraft(repo.path)\n    setMessage(d)\n    setMessageDraft(repo.path, d)', ''],
  ['M6 草稿 key 换成 repo.id', 'setMessageDraft(repo.path, v)', 'setMessageDraft(repo.id, v)']
]

const dir = mkdtempSync(join(tmpdir(), 'gp-wiring-mut-'))
const mutatedFile = join(dir, 'RepoCard.js')
// 换行无关：本仓库在 Windows 上经 git autocrlf 落盘的是 CRLF，而本脚本的 find 串按
// 可读性写成 \n——直接 indexOf 会「变异点未命中」。两边都归一成 \n 再比对。
const norm = (s) => s.replace(/\r\n/g, '\n')
const sourceNorm = norm(original)
let bad = 0
try {
  for (const [name, find, repl] of MUTATIONS) {
    if (sourceNorm.indexOf(norm(find)) < 0) {
      console.error('✗ ' + name + '：变异点未命中（源码改了？请同步更新本脚本的 find 串）')
      bad++
      continue
    }
    writeFileSync(mutatedFile, sourceNorm.replace(norm(find), norm(repl)), 'utf8')
    let code = 0
    let out = ''
    try {
      out = execFileSync(process.execPath, [TEST], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GP_WIRING_SRC: mutatedFile } })
    } catch (e) {
      code = e.status == null ? 1 : e.status
      out = String(e.stdout || '') + String(e.stderr || '')
    }
    const caught = code !== 0
    if (!caught) bad++
    const which = (out.match(/^\s+(.+?)（期望 true/gm) || []).map((l) => l.trim().replace('（期望 true', ''))
    console.log((caught ? '✓ ' : '✗ ') + name + ' → ' + (caught ? '被断言拦下' : '**没被拦住**（断言失效）') +
      (caught && which.length ? '：' + which.join('；') : ''))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// 反向基线：未变异的源码必须通过（否则上面的"拦住"可能只是脚本本身坏了）
let baselineOk = true
try {
  execFileSync(process.execPath, [TEST], { cwd: ROOT, encoding: 'utf8' })
} catch (e) { baselineOk = false }
console.log((baselineOk ? '✓ ' : '✗ ') + '基线：未变异源码仍然全绿' + (baselineOk ? '' : '（测试脚本自身就有问题）'))
if (!baselineOk) bad++

console.log('')
console.log(bad === 0
  ? `✓ 变异测试通过：${MUTATIONS.length} 处接线断链全部被断言拦下，基线全绿`
  : `✗ 有 ${bad} 项未达预期（见上）`)
process.exit(bad ? 1 : 0)
