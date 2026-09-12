/** 面板通用纯函数：状态字母徽标、多选行键、路径拆分、图片扩展名、字节格式化。 */
const GROUP_META = {
  conflicted: { titleKey: 'groupConflicted' },
  staged: { titleKey: 'groupStaged' },
  unstaged: { titleKey: 'groupChanges' },
  untracked: { titleKey: 'groupUntracked' }
}
// 状态字母徽标：未跟踪显示 U
function glyphOf(x, y) {
  const code = x !== ' ' && x !== '?' ? x : y
  if (code === '?') return { g: 'U', cls: 'gp-g-added' }
  if (code === 'A') return { g: 'A', cls: 'gp-g-added' }
  if (code === 'M') return { g: 'M', cls: 'gp-g-modified' }
  if (code === 'D') return { g: 'D', cls: 'gp-g-deleted' }
  if (code === 'R') return { g: 'R', cls: 'gp-g-modified' }
  if (code === 'C') return { g: 'C', cls: 'gp-g-modified' }
  if (code === 'U') return { g: 'U', cls: 'gp-g-deleted' }
  if (code === 'T') return { g: 'T', cls: 'gp-g-modified' }
  return { g: '?', cls: '' }
}

// 多选行键：'group\u0000path'——同一文件可同时出现在 staged/unstaged 两组，须带组判定
const rowKey = (group, path) => group + '\u0000' + path

// 路径展示拆分：seg = 尾段名；base = 文件名（目录保留尾斜杠）；dir = 目录
//（去尾分隔符；无目录时为空串）。目录省略号在左侧（rtl）保住最深层目录，
// 文件名仅自身超长才封顶省略（见 .gp-file-dir / .gp-diff-name 的收缩策略）。
function splitPath(p) {
  const trimmed = p.replace(/\/+$/, '')
  const seg = trimmed.split('/').pop() || p
  const base = p.endsWith('/') ? seg + '/' : seg
  const dir = trimmed.length > seg.length ? trimmed.slice(0, trimmed.length - seg.length).replace(/\/+$/, '') : ''
  return { base, dir, seg }
}

// 图片扩展名（与 host 侧 IMAGE_MIMES 同表）：命中即 diff 抽屉进图片预览模式
//（跳过 fileDiff，改调 imageBlob 取旧/新两版 data URL）
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const isImagePath = (p) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(p || ''))
  return !!(m && IMAGE_EXTS.has(m[1].toLowerCase()))
}
// 字节数人性化显示（图片标签处用）
const fmtBytes = (n) => {
  const v = Number(n)
  if (!isFinite(v) || v < 0) return ''
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(2) + ' MB'
}
export { GROUP_META, glyphOf, rowKey, splitPath, isImagePath, fmtBytes }
