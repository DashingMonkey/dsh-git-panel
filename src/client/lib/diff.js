/** unified diff 解析与分栏配对纯算法（parseDiff / pairRows / segDiff）。 */
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
export { parseDiff, pairRows, segDiff }
