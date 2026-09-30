/**
 * 行为回归：git 锁竞争（index.lock）识别与重试。
 *
 * 背景（真实事故，有审计日志）：2026-09-30 07:25:22 面板「提交并推送」报
 *   fatal: Unable to create 'D:/MySpace/gitee/dsh-git-panel/.git/index.lock': File exists.
 * 40 秒后原样重试即成功（fail:git.commit → ok:git.commit）。这是**瞬时竞争**，不是
 * 残留锁——用户不该手动重试，也不该看到「有 crashed git 进程要手动删锁」那句原文。
 *
 * 三层验证：
 *   1) 判据真值表（含「权限不足/磁盘满」这类同样带 Unable to create 但**绝不能**重试的样本）；
 *   2) 真机验证：在临时仓库里用真实 git 造出 index.lock，确认退出码/文案与判据吻合，
 *      且拿开锁之后同一条命令能成功（证明"重试"确实能救回来）；
 *   3) 同步断言：src/host.js 把同一段逻辑内联了一份（host.js 刻意零 import，
 *      见那边注释），两处常量/判据必须逐字一致，否则这里测的就不是线上跑的那份。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLockContention, lockRetryDelays, LOCK_MARKERS, LOCK_RETRY_DELAYS_MS } from '../src/gitRetry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const scenario = (name, run) => {
  const checks = run()
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

// 事故原文（逐字取自审计日志，Windows 路径是正斜杠，这点判据必须兼容）
const REAL_FAILURE_STDERR = "fatal: Unable to create 'D:/MySpace/gitee/dsh-git-panel/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository, e.g.\nan editor opened by 'git commit'. Please make sure all processes\nare terminated then try again. If it still fails, a git process\nmay have crashed in this repository earlier:\nremove the file manually to continue.\n"

// 1) 判据真值表
scenario('1 判据真值表', () => {
  return [
    // 该重试的
    eq(isLockContention(128, REAL_FAILURE_STDERR, ''), true, '事故原文 → 判为锁竞争'),
    eq(isLockContention(128, "fatal: Unable to create '/repo/.git/HEAD.lock': File exists.", ''), true, 'HEAD.lock 同样算'),
    eq(isLockContention(128, '', "fatal: Unable to create '/r/.git/index.lock': File exists."), true, 'stdout 里的原文也算（git 版本差异）'),
    // 不该重试的（误判会白等 680ms 且掩盖真因）
    eq(isLockContention(128, "fatal: Unable to create '/repo/.git/index.lock': Permission denied", ''), false, '权限不足不重试'),
    eq(isLockContention(128, "fatal: Unable to create '/repo/.git/index.lock': No space left on device", ''), false, '磁盘满不重试'),
    // 只有 "Unable to create …" 没有锁文件名的泛化文案：git 的锁错误必然带锁文件名，
    // 不带就不是我们认识的那一类，宁漏勿误（真机样本见场景 2）
    eq(isLockContention(128, "fatal: Unable to create 'x': File exists.", ''), false, '无锁文件名的泛化文案不重试（宁漏勿误）'),
    eq(isLockContention(0, REAL_FAILURE_STDERR, ''), false, '成功退出码不重试'),
    eq(isLockContention(1, REAL_FAILURE_STDERR, ''), false, '非 128 退出码不重试'),
    eq(isLockContention(128, '', ''), false, '空输出不重试'),
    eq(isLockContention(128, null, undefined), false, 'null/undefined 不炸'),
    // 排程
    eq(lockRetryDelays().length, 2, '重试次数'),
    eq(lockRetryDelays().reduce((a, b) => a + b, 0) < 1000, true, '累计等待 < 1s（用户无感）'),
    eq(LOCK_MARKERS.indexOf('index.lock') >= 0 && LOCK_MARKERS.indexOf('HEAD.lock') >= 0, true, '锁文件名清单')
  ]
})

// 2) 真机验证：用真 git 造锁，确认判据与"重试能救"这件事都不是纸上谈兵
scenario('2 真机：真 git 造锁 → 判据命中 → 解锁后成功', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-lock-'))
  const git = (args) => {
    try {
      const out = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, text: out, err: '' }
    } catch (e) {
      return { code: e.status == null ? -1 : e.status, text: String(e.stdout || ''), err: String(e.stderr || '') }
    }
  }
  try {
    git(['init', '-q'])
    // 沙箱里没有全局 git 身份，不配的话「解锁后的提交」会以 Author identity unknown
    // 失败，测试就会把「重试能救回来」误判成失败（本机实测踩过）
    git(['config', 'user.email', 'probe@example.com'])
    git(['config', 'user.name', 'probe'])
    writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
    git(['add', 'a.txt'])
    // 造出真实的 index.lock（等价于「另一个 git 正持锁」）
    writeFileSync(join(dir, '.git', 'index.lock'), '', 'utf8')
    const locked = git(['commit', '-m', 'probe'])
    const detected = isLockContention(locked.code, locked.err, locked.text)
    // 拿开锁 = 竞争结束，同一条命令应当成功（这正是"重试能救回来"的实证）
    rmSync(join(dir, '.git', 'index.lock'), { force: true })
    const after = git(['commit', '-m', 'probe'])
    const head = git(['rev-parse', '--short', 'HEAD'])
    return [
      eq(locked.code, 128, '持锁时 git commit 的退出码'),
      eq(detected, true, '真实失败被判为锁竞争（判据与真 git 文案吻合）'),
      eq(locked.err.indexOf('index.lock') >= 0, true, '原文含 index.lock'),
      eq(after.code, 0, '解锁后同一条命令成功（重试确实能救）'),
      eq(head.code === 0 && head.text.trim().length > 0, true, '提交真的落库了')
    ]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 3) 同步断言：host.js 内联的那份必须与参照实现一致（否则测的不是线上那份）
scenario('3 host.js 内联段同步', () => {
  const hostSrc = readFileSync(join(ROOT, 'src', 'host.js'), 'utf8')
  const needle = (s) => hostSrc.indexOf(s) >= 0
  return [
    eq(needle("const LOCK_MARKERS = ['index.lock', 'HEAD.lock']"), true, '锁文件名清单一致'),
    eq(needle('const LOCK_RETRY_DELAYS_MS = [180, 500]'), true, '重试等待排程一致'),
    eq(needle("if (exitCode !== 128) return false"), true, '退出码判据一致'),
    eq(needle("if (text.indexOf('File exists') < 0) return false"), true, '"File exists" 判据一致'),
    eq(needle('function isLockContention(exitCode, stderrText, stdoutText)'), true, '函数签名一致'),
    eq(needle("if (opts.readOnly) env.GIT_OPTIONAL_LOCKS = '0'"), true, '既有的 GIT_OPTIONAL_LOCKS 开关还在（消掉面板自己这一路竞争）'),
    eq(needle('readOnly: true }),'), true, 'repoStatus 的 git status 仍标了 readOnly'),
    eq(needle('isLockContention(r.code, r.errText, r.text)'), true, 'gitRun 真的用了判据做重试'),
    // ⚠ 重试等待必须**异步**：曾经用 Atomics.wait 做同步等待，把宿主事件循环整个冻住
    // 680ms，同进程的定时器全被推迟，锁的释放反而被自己的等待拖后（端到端测试实测：
    // 锁持有者到 1059ms 才被调度，而重试 1007ms 就放弃了）。这两条是那次事故的防回归。
    eq(needle('Atomics.wait('), false, '重试等待不得用 Atomics.wait（会冻住宿主事件循环）'),
    eq(needle('timer.timeout(resolve, ms)'), true, '重试等待走 timer 服务的异步等待'),
    // host.js 零 import 是刻意的（见其文件头与 gitRun 处注释）：文件态复制出去单独装载、
    // 动态 Cordis 包把函数体拼进 code.host，两种形态下 import 都要断。
    eq(/^\s*import\s/m.test(hostSrc), false, 'host.js 仍保持零 import（否则两种装载形态都会断）')
  ]
})

const failedAll = results.filter((r) => r.failed.length > 0)
console.log('')
console.log(failedAll.length === 0
  ? `✓ git 锁竞争 真值表 ${results.length}/${results.length} 全部符合预期（含真机造锁验证与 host 内联同步）`
  : `✗ 真值表 ${results.length - failedAll.length}/${results.length} 通过，失败场景见上`)
process.exit(failedAll.length ? 1 : 0)
