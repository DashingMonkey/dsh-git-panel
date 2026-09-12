/** 规则 YAML 的极简解析/序列化（与 host.js 的同名函数逐字对齐，两端约定一致）。 */
function parseRulesYaml(text) {
  const out = {}
  const lines = String(text || '').split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(\|[+-]?|\>[+-]?))?\s*(.*)$/.exec(lines[i])
    if (m && m[2] && m[2][0] === '|') {
      const key = m[1]
      const raw = []
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === '') { raw.push(''); i++; continue }
        const ind = /^(\s*)/.exec(l)[1].length
        if (ind === 0 && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l)) break
        raw.push(l)
        i++
      }
      // YAML 块标量：以首条非空行的缩进为块缩进统一剥离，保留内容自身的层级缩进
      let blockInd = 0
      for (const l of raw) { if (l.trim() !== '') { blockInd = /^(\s*)/.exec(l)[1].length; break } }
      const block = raw.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(blockInd, /^(\s*)/.exec(l)[1].length))))
      out[key] = block.join('\n').replace(/\n+$/, '')
    } else if (m) { out[m[1]] = m[3]; i++ } else { i++ }
  }
  return out
}
// 与 host.js 的 emitRulesYaml 完全一致：两个块标量、内容统一缩进 2 空格
function emitRulesYaml(rules) {
  const indent = (s) => String(s || '').split('\n').map((l) => (l === '' ? '' : '  ' + l)).join('\n')
  return 'system_prompt: |\n' + indent(rules.system_prompt) + '\n\nuser_context: |\n' + indent(rules.user_context) + '\n'
}
export { parseRulesYaml, emitRulesYaml }
