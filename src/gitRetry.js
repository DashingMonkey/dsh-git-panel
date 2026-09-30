/**
 * git 锁竞争（index.lock / HEAD.lock）识别与重试排程。
 *
 * ⚠ 本文件是 src/host.js 里 `isLockContention` / `LOCK_RETRY_DELAYS_MS` 的**参照实现**，
 * 两者必须逐字一致（scripts/test-git-lock-retry.mjs 会做同步断言）。为什么不在 host 里
 * import 它：host.js 刻意保持**零 import**——文件态 npm 包把它原样复制出去单独装载，
 * 动态 Cordis 包则把它的函数体拼进 code.host，import 都要断。所以逻辑只能内联一份，
 * 这里留一份可单独跑测试的拷贝来守住判据与排程。
 *
 * 为什么需要它：`git commit` 抢不到 `.git/index.lock` 时直接以 exit 128 失败，原文是
 * "fatal: Unable to create '…/.git/index.lock': File exists."。这个竞争**天然是瞬时的**
 * ——抢锁的对方（我们自己的只读 `git status` 刷新 index、别的编辑器、杀毒软件、上一个
 * 被终止的 git 进程尚未释放句柄）通常在几十到几百毫秒内放手。实测本仓库面板：
 * 07:25:22 第一次「提交并推送」报 index.lock 失败，07:26:02 原样重试就成功
 * （审计日志 fail:git.commit → ok:git.commit，之间没有任何 git 写操作）。用户不该为
 * 这种瞬时竞争手动重试，也不该看到一条让人误以为「有 crashed git 进程要手动删锁」的原文。
 */

// 锁竞争判据（三条同时成立，宁可漏判也不误判）：
//   ① exit 128 —— git 的 fatal 退出码；锁竞争必然是 fatal。
//   ② 文案含锁文件名 —— 见 git 的 emit_lock_file_error。
//   ③ 文案含 "File exists" —— 只有「锁已存在」这一种 fatal 带这句；同一位置的
//      "Unable to create …" 在权限不足/磁盘满时也会出现，但那两种重试一万次也没用，必须排除。
// 锁文件在原文里是整条路径、Windows 上还是正斜杠（'D:/a/b/.git/index.lock'），
// 所以不能写「包含 .git/index.lock」，只认文件名。
const LOCK_MARKERS = ['index.lock', 'HEAD.lock']
// 重试等待（两次）：累计 680ms，覆盖常见的瞬时占用，又不让人等出感觉
const LOCK_RETRY_DELAYS_MS = [180, 500]

export function isLockContention(exitCode, stderrText, stdoutText) {
  if (exitCode !== 128) return false
  const text = String(stderrText || '') + '\n' + String(stdoutText || '')
  if (text.indexOf('File exists') < 0) return false
  for (const marker of LOCK_MARKERS) if (text.indexOf(marker) >= 0) return true
  return false
}

// 重试排程：第 1..N 次重试前各等多久（拷贝，调用方改不到本体）
export function lockRetryDelays() {
  return LOCK_RETRY_DELAYS_MS.slice()
}

export { LOCK_MARKERS, LOCK_RETRY_DELAYS_MS }
