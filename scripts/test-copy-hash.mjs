/**
 * 行为回归（静态接线守卫）：提交详情浮层的「点击复制完整哈希」。
 *
 * 覆盖点：
 *   1) icons.js 有 copy 图标（剪贴板两段 path）；
 *   2) GitGraphView 的 CommitDetailPop：整行 onClick 调 copyFullHash、剪贴板图标在、
 *      复制走 Async Clipboard API + execCommand 双通道、成功 toast 回声；
 *   3) styles.js 有 gp-hash-copy 可点样式；
 *   4) i18n 中英双语键齐全；
 *   5) 构建产物 lib/client.js 含新逻辑（防源码/产物漂移）。
 *
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = (p) => readFileSync(join(ROOT, p), 'utf8')
const results = []
const scenario = (name, checks) => {
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const has = (hay, needle, msg) => ({ ok: String(hay).includes(String(needle)), msg })

scenario('copy 图标', [
  has(R('src/client/icons.js'), "copy: { f:", 'icons.js 定义 copy 图标'),
  has(R('src/client/icons.js'), "'M5.5 1H10.5V4H5.5Z'", '顶扣 path'),
  has(R('src/client/icons.js'), "'M2.5 4H4Q5.5 4", '剪贴板本体 path（圆角）')
])

scenario('CommitDetailPop 复制入口', [
  has(R('src/client/components/GitGraphView.js'), "import { tr, fmt } from '../i18n.js'", '导入 fmt（成功 toast 文案带短哈希）'),
  has(R('src/client/components/GitGraphView.js'), "import { pushToast, useStore } from '../store.js'", '导入 pushToast'),
  has(R('src/client/components/GitGraphView.js'), 'const copyFullHash = async () =>', '定义 copyFullHash 异步函数'),
  has(R('src/client/components/GitGraphView.js'), 'const clip = window.navigator && window.navigator.clipboard', '主通道：Async Clipboard API（经 window 取用，符合 lint 全局白名单约定）'),
  has(R('src/client/components/GitGraphView.js'), "if (clip && clip.writeText) { await clip.writeText(text); ok = true }", '写剪贴板'),
  has(R('src/client/components/GitGraphView.js'), "document.execCommand('copy')", '回退通道：execCommand（旧浏览器/非安全上下文）'),
  has(R('src/client/components/GitGraphView.js'), 'ta.style.left = \'-9999px\'', '隐藏 textarea 兜底（fixed 屏外）'),
  has(R('src/client/components/GitGraphView.js'), "pushToast(ok ? 'success' : 'error'", '成功/失败都 toast 回声'),
  has(R('src/client/components/GitGraphView.js'), "fmt(tr('copiedHash'), { s: short })", '成功文案带短哈希'),
  has(R('src/client/components/GitGraphView.js'), "className: 'gp-cd-sec gp-cd-hashrow gp-hash-copy'", '哈希行挂可点类名'),
  has(R('src/client/components/GitGraphView.js'), 'onClick: () => { void copyFullHash() }', '整行点击触发复制'),
  has(R('src/client/components/GitGraphView.js'), "icon('copy', 12)", '剪贴板图标给可点 affordance')
])

scenario('旧展示形态已移除', [
  { ok: R('src/client/components/GitGraphView.js').indexOf("title: hover.hash") < 0, msg: 'title 已从「显示原文」改为动作提示（tr copyHashTip）' },
  { ok: R('src/client/components/GitGraphView.js').indexOf("React.createElement('div', { className: 'gp-cd-sec gp-cd-hashrow', title: hover.hash }, short))") < 0, msg: '旧的纯展示哈希行（无点击、title=原文）已移除' }
])

scenario('样式与文案', [
  has(R('src/client/styles.js'), '.gp-cd-hashrow.gp-hash-copy {', '可点行样式（cursor/hover 高亮）'),
  has(R('src/client/styles.js'), ".gp-cd-hashrow.gp-hash-copy:hover", 'hover 高亮提示可点'),
  has(R('src/client/i18n.js'), "copyHashTip: '点击复制完整提交哈希'", '中文键 copyHashTip'),
  has(R('src/client/i18n.js'), 'copiedHash: \'已复制完整哈希 {s}\'', '中文键 copiedHash'),
  has(R('src/client/i18n.js'), "copyFailed: '复制失败'", '中文键 copyFailed（复用规则编辑器同文键）'),
  has(R('src/client/i18n.js'), "copyHashTip: 'Click to copy the full commit hash'", '英文键 copyHashTip'),
  has(R('src/client/i18n.js'), 'copiedHash: \'Copied full hash {s}\'', '英文键 copiedHash'),
  has(R('src/client/i18n.js'), "copyFailed: 'Copy failed'", '英文键 copyFailed（复用）')
])

scenario('构建产物防漂移', [
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'copyFullHash', 'bundle 内有 copyFullHash'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'gp-hash-copy', 'bundle 内有 gp-hash-copy 类'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'navigator.clipboard', 'bundle 内有 clipboard 调用链'),
  has(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), 'copiedHash:', 'bundle 内有 copiedHash 文案')
])

const failed = results.filter((r) => r.failed.length > 0)
console.log('\n' + (failed.length === 0
  ? `✓ 提交哈希复制接线：${results.length} 组全部通过`
  : `✗ 提交哈希复制接线：${failed.length}/${results.length} 组失败\n` + failed.map((f) => '  - ' + f.name + '\n    ' + f.failed.map((x) => x.msg).join('\n    ')).join('\n')))
process.exit(failed.length === 0 ? 0 : 1)