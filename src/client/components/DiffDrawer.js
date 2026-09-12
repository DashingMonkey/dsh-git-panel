/** Diff 抽屉：面板左缘滑出的浮层 diff 查看器（分栏/全文/图片预览/lightbox）。 */
import React from 'react'
import { callRpc } from '../api.js'
import { tr, fmt } from '../i18n.js'
import { getTimer } from '../runtime.js'
import { prefBool, prefInt, savePrefBool, savePrefInt } from '../store.js'
import { icon } from '../icons.js'
import { parseDiff, pairRows, segDiff } from '../lib/diff.js'
import { isImagePath, fmtBytes, splitPath, glyphOf, GROUP_META } from '../lib/util.js'
import { useEnterTransition } from '../hooks/useEnterTransition.js'
import { useWidthDrag } from '../hooks/useWidthDrag.js'
import { useDiffRuler } from '../hooks/useDiffRuler.js'
// DiffDrawer：点击文件后从面板左缘向左滑出的浮层查看器。
//   - 抽屉右缘与面板左缘齐平（覆盖在聊天区上方），文件列表保持可见，点别的文件直接切换；
//   - 遮罩仅覆盖抽屉左侧区域（聊天区），点击遮罩或按 Esc 关闭；
//   - 开/关均为整屉滑入/滑出动效：遮罩是延伸到面板下方的一整块深色（面板滑入后
//     盖住它，即「阴影整体 + 面板遮挡」）；面板自身无投影、无透明度动画，纯位移，
//     初始停在 translateX(100%) —— 被不透明的 Git Panel 完全遮挡，双 rAF 确保
//     初始样式先绘制一帧再开始过渡（根治首帧以终态闪现的问题）；
//   - 关闭相位由父组件写入 sel.closing（所有关闭入口统一走它，含「再次点击文件行」），
//     本组件播完滑出动效（240ms）后回调 onClose 真正卸载；期间切到新文件会取消卸载；
//   - 左缘拖拽调宽，宽度记忆在 localStorage（gp-diff-w）；
//   - 左右分栏（split）视图：左源文件/右修改后，配对修改行带 word 级中段高亮
//     （公共前后缀裁剪），模式记忆在 localStorage（gp-diff-split）；
//   - 全文（full）视图：host 侧 git diff -U1000000 让整个文件进单个 hunk，
//     改动行照常红绿高亮、其余行作上下文灰显，超过 1MB 截断附提示行；
//     模式记忆在 localStorage（gp-diff-full），与 split 可叠加；
//   - 滚动条 overview ruler：滚动条内侧细覆盖条，红/绿色块按
//     「行位置 ÷ 内容总高」比例标出增删位置（渲染后实测 DOM 行位置，与滚动天然
//     同步；分栏修改对拆上半红/下半绿），悬停加宽、点击按比例跳转居中。
//   - 图片预览模式：png/jpg/jpeg/gif/webp/bmp/ico/svg 扩展名不走 fileDiff，
//     改调 imageBlob 取旧/新两版 data URL —— 并排自适应缩略展示；
//     点击任一图片进全屏 lightbox（1:1 原始尺寸、超出屏幕可滚动、
//     左右方向键切换新旧版本）；标签显示实测像素与文件大小；
//     单图上限 8MB（超限显示提示行）；
//     untracked 无旧版、工作区已删除无新版，单版时单图占满（见 buildImageBody）。
// ===== 图片预览模式组件 =====
// 单侧图片格：标签（旧/新 徽标 + 实测像素尺寸 + 文件大小）+ 棋盘格图框。
// 尺寸在 img onLoad 后从 naturalWidth/Height 读取（无需解码库）。
// 无图时显示 note（超限大小 / 无此版本 / 错误信息）；有图可点击进全屏 lightbox。
function ImagePane({ img, note, kind, onZoom }) {
  const [dim, setDim] = React.useState('')
  const onImgLoad = (e) => {
    const el = e && e.target
    if (el && el.naturalWidth) setDim(el.naturalWidth + '×' + el.naturalHeight)
  }
  return React.createElement('div', { className: 'gp-img-cell' },
    React.createElement('div', { className: 'gp-img-label' },
      React.createElement('span', { className: 'gp-img-tag gp-img-tag-' + kind }, tr(kind === 'old' ? 'imgOld' : 'imgNew')),
      dim ? React.createElement('span', { className: 'gp-img-dim' }, dim) : null,
      img && img.bytes ? React.createElement('span', { className: 'gp-img-dim' }, fmtBytes(img.bytes)) : null),
    img
      ? React.createElement('div', { className: 'gp-img-box', title: tr('imgZoomTitle'), onClick: () => { if (onZoom) onZoom(kind) } },
          React.createElement('img', { src: img.dataUrl, alt: '', draggable: false, onLoad: onImgLoad }))
      : React.createElement('div', { className: 'gp-img-note' }, note || tr('imgMissing')))
}

// 全屏 lightbox：图片按 1:1 原始尺寸显示（小于屏幕居中、超出可滚动），棋盘格底。
// 顶部信息条：版本徽标 + 实测像素 + 文件大小 + 切换提示（两版都在时）+ 关闭按钮。
// Esc / 点遮罩 / 关闭按钮退出；左右方向键在新旧版之间切换（无需退出重进）。
// 键盘监听用 capture 阶段并 stopPropagation——先于 diff 抽屉的 Esc（bubble）
// 触发，lightbox 打开时 Esc 只关 lightbox、不连带关抽屉（与确认弹窗同一模式）。
function ImageLightbox({ img, kind, both, onSwitch, onClose }) {
  const [dim, setDim] = React.useState('')
  const onImgLoad = (e) => {
    const el = e && e.target
    if (el && el.naturalWidth) setDim(el.naturalWidth + '×' + el.naturalHeight)
  }
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (!both) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation()
        onSwitch(kind === 'old' ? 'new' : 'old')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [kind, both, onClose, onSwitch])
  return React.createElement('div', { className: 'gp-lightbox', onClick: onClose },
    React.createElement('div', { className: 'gp-lightbox-head', onClick: (e) => { e.stopPropagation() } },
      React.createElement('span', { className: 'gp-img-tag gp-img-tag-' + kind }, tr(kind === 'old' ? 'imgOld' : 'imgNew')),
      dim ? React.createElement('span', { className: 'gp-img-dim' }, dim) : null,
      img && img.bytes ? React.createElement('span', { className: 'gp-img-dim' }, fmtBytes(img.bytes)) : null,
      both ? React.createElement('span', { className: 'gp-lightbox-switch' }, tr('imgSwitchHint')) : null,
      React.createElement('span', { className: 'gp-lightbox-close' },
        React.createElement('button', { title: tr('imgCloseZoom'), onClick: onClose }, icon('close')))),
    // 点图片本体不关闭（stopPropagation），点 stage 空白区随外层遮罩关闭
    React.createElement('div', { className: 'gp-lightbox-stage' },
      React.createElement('img', { src: img.dataUrl, alt: '', draggable: false, onLoad: onImgLoad, onClick: (e) => { e.stopPropagation() } })))
}

// 图片 diff 主体布局：并排展示各版本（单版时单图占满）；两版皆无 → 说明行
//（超限/读取失败的原因在各自 note 里）。点击任一图片由 DiffDrawer 的 zoom 状态
// 切到全屏 lightbox（imgState 与 lightbox 状态都在 DiffDrawer 层）。
function buildImageBody(img, onZoom) {
  if (!img) return null
  const cells = []
  if (img.old || img.oldNote) cells.push(React.createElement(ImagePane, { key: 'old', img: img.old, note: img.oldNote, kind: 'old', onZoom }))
  if (img.new || img.newNote) cells.push(React.createElement(ImagePane, { key: 'new', img: img.new, note: img.newNote, kind: 'new', onZoom }))
  if (!cells.length) return React.createElement('div', { className: 'gp-img-note' }, tr('imgNoPreview'))
  return React.createElement('div', { className: 'gp-img-row' + (cells.length === 1 ? ' gp-img-row-one' : '') }, cells)
}

function DiffDrawer({ repo, sel, panelW, onClose, onRequestClose }) {
  const [state, setState] = React.useState({ loading: true, text: '', error: '' })
  // 分栏（split）视图：左源文件/右修改后；记忆在 localStorage（gp-diff-split）
  const [split, setSplit] = React.useState(() => prefBool('gp-diff-split', false))
  // 全文（full）视图：-U1000000 超大上下文让整个文件进单个 hunk，
  // 改动行照常红绿高亮、其余行作上下文灰显；记忆在 localStorage（gp-diff-full）
  const [full, setFull] = React.useState(() => prefBool('gp-diff-full', false))
  // 图片预览模式：isImagePath 命中即启用（跳过 fileDiff，改调 imageBlob）。
  // imgState = { old, new, oldNote, newNote }（img = {dataUrl, bytes}）；
  // zoom = { kind } 时全屏 lightbox 展示对应版本（点击图片格进入）
  const isImg = isImagePath(sel.path)
  const [imgState, setImgState] = React.useState(null)
  const [zoom, setZoom] = React.useState(null)
  const [drawerW, setDrawerW] = React.useState(() => prefInt('gp-diff-w', 380, 2400, 0) || Math.min(760, Math.max(440, Math.round(window.innerWidth * 0.42))))
  const [resizing, setResizing] = React.useState(false)
  // 滑入/滑出相位：off（未入场 / sel.closing）时整屉平移到面板正后方且全透明
  const [entered, setEntered] = React.useState(false)
  const closing = sel.closing === true
  const closeTimerRef = React.useRef(null)

  // 入场：双 rAF 让「面板后方 + 全透明」的初始样式先完成一次绘制，再切到终态触发 transition
  useEnterTransition(true, () => setEntered(true))

  // 关闭相位：滑出动效播完（240ms）后回调 onClose 真正卸载；期间切到新文件
  // （父组件整体替换 diffSel、closing 复位为 false）→ effect 清理自动取消卸载
  React.useEffect(() => {
    if (!closing) return
    closeTimerRef.current = getTimer().timeout(() => onClose(), 240)
    return () => { if (closeTimerRef.current) { closeTimerRef.current(); closeTimerRef.current = null } }
  }, [closing, onClose])

  // Esc / X / 遮罩：请求进入关闭相位（由父组件统一标记，防止与文件切换竞态）
  const requestClose = () => { if (!closing && onRequestClose) onRequestClose() }

  React.useEffect(() => {
    let alive = true
    setState({ loading: true, text: '', error: '' })
    // 图片文件：unified diff 对二进制无意义，不走 fileDiff；并行请求旧/新两版
    //（untracked 无旧版；服务端按组解析版本来源，见 host imageBlob）
    if (isImg) {
      setImgState(null)
      setZoom(null)
      const jobs = []
      if (sel.group !== 'untracked') {
        jobs.push(callRpc('imageBlob', { repoId: repo.id, path: sel.path, orig: sel.orig || undefined, group: sel.group, hash: sel.hash || undefined, side: 'old' }).then((r) => ({ side: 'old', r })))
      }
      jobs.push(callRpc('imageBlob', { repoId: repo.id, path: sel.path, group: sel.group, hash: sel.hash || undefined, side: 'new' }).then((r) => ({ side: 'new', r })))
      Promise.all(jobs).then((results) => {
        if (!alive) return
        const out = { old: null, new: null, oldNote: '', newNote: '' }
        for (let i = 0; i < results.length; i++) {
          const res = results[i]
          if (!res || !res.r) continue
          if (res.r.ok && res.r.image) { out[res.side] = res.r.image; continue }
          if (res.r.ok && res.r.oversize) out[res.side + 'Note'] = fmt(tr('imgTooLarge'), { s: fmtBytes(res.r.size) })
          else if (!res.r.ok) out[res.side + 'Note'] = res.r.error || tr('loadFailed')
        }
        setImgState(out)
        setState({ loading: false, text: '', error: '' })
      }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
      return () => { alive = false }
    }
    callRpc('fileDiff', { repoId: repo.id, path: sel.path, group: sel.group, hash: sel.hash || undefined, full: full || undefined }).then((r) => {
      if (!alive) return
      if (r && r.ok) setState({ loading: false, text: r.text || '', error: '' })
      else setState({ loading: false, text: '', error: (r && r.error) || tr('loadFailed') })
    }).catch((e) => { if (alive) setState({ loading: false, text: '', error: e && e.message ? e.message : String(e) }) })
    return () => { alive = false }
  }, [repo.id, sel.path, sel.group, sel.hash, sel.orig, full, isImg])

  // ===== 滚动条 overview ruler（测量逻辑见 useDiffRuler；图片模式无行标记，停用）=====
  const ruler = useDiffRuler(!isImg && !state.loading && !state.error, (split ? 's:' : 'u:') + state.text)

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 依赖有意只挂 closing/onClose：requestClose 读的是最新的组件闭包
  }, [closing, onClose])

  // 抽屉左缘拖拽调宽：宽度 = 视口宽 − 面板宽 − 指针 x（钳到 [380, 视口−面板−48]），
  // 松手时持久化
  const dragApply = (e) => {
    const max = Math.max(320, Math.round(window.innerWidth - panelW - 48))
    const w = Math.min(max, Math.max(380, Math.round(window.innerWidth - panelW - e.clientX)))
    setDrawerW((prev) => (prev === w ? prev : w))
    return w
  }
  const widthDrag = useWidthDrag(dragApply, (w) => savePrefInt('gp-diff-w', 380, 2400, w), () => setResizing(false))

  const parsed = React.useMemo(() => parseDiff(state.text, sel.group === 'conflicted'), [state.text, sel.group])
  // 分栏配对按 block 缓存（保留 @@ 分段头边界）；仅 split 模式惰性计算
  const splitPairs = React.useMemo(() => (split ? parsed.blocks.map((b) => ({ hunk: b.hunk, pairs: pairRows([b]) })) : null), [parsed, split])
  // 冲突组与列表行同口径：未合并条目在 porcelain 里是 UU/AA/DD…，直接喂 glyphOf 会得到
  // 「红色 U」「绿色 A」「红色 D」等与列表行（warn 色 U）不一致的观感
  const gl = sel.group === 'conflicted' ? { g: 'U', cls: 'gp-g-conflict' } : glyphOf(sel.x, sel.y)
  const { base, dir } = splitPath(sel.path)
  // 面板调宽/窗口变窄时保持抽屉不越过视口左缘
  const wEff = Math.min(drawerW, Math.max(320, Math.round(window.innerWidth - panelW - 48)))

  const renderRow = (r, i) => React.createElement('div', { key: i, className: 'gp-diff-row gp-dr-' + r.t },
    React.createElement('span', { className: 'gp-diff-ln' }, r.o == null ? '' : r.o),
    React.createElement('span', { className: 'gp-diff-ln' }, r.n == null ? '' : r.n),
    React.createElement('span', { className: 'gp-diff-code' },
      React.createElement('span', { className: 'gp-diff-sign' }, r.t === 'add' ? '+' : r.t === 'del' ? '-' : r.t === 'ctx' ? ' ' : ''),
      r.x))

  // 分栏行：左半（旧行号+旧文本，del 红）| 中缝 | 右半（新行号+新文本，add 绿）。
  // 着色/符号只看 pr.mod：掐头去尾得到的「内容相同的 del+add 对」按普通上下文
  // 渲染（无红绿、无 +/− 符号），只有中段配对与单边行才着色；
  // 修改对带 word 级中段高亮（公共前后缀之外的部分）。
  const renderSplitRow = (pr, i) => {
    if (pr.note) return React.createElement('div', { key: i, className: 'gp-diff-row ' + (pr.mark ? 'gp-dr-mark' : 'gp-dr-note') },
      React.createElement('span', { className: 'gp-diff-code' }, pr.note))
    const l = pr.l, r = pr.r
    const sgd = pr.mod && l && r ? segDiff(l.x, r.x) : null
    const lDel = !!(l && l.t === 'del' && pr.mod)
    const rAdd = !!(r && r.t === 'add' && pr.mod)
    const lCode = !l ? '' : sgd ? [sgd.pre, React.createElement('span', { key: 'm', className: 'gp-diff-hl-del' }, sgd.midA), sgd.post] : l.x
    const rCode = !r ? '' : sgd ? [sgd.pre, React.createElement('span', { key: 'm', className: 'gp-diff-hl-add' }, sgd.midB), sgd.post] : r.x
    return React.createElement('div', { key: i, className: 'gp-diff-row' + (!lDel && !rAdd ? ' gp-dr-ctx' : '') },
      React.createElement('span', { className: 'gp-diff-half' + (lDel ? ' gp-dh-del' : '') },
        React.createElement('span', { className: 'gp-diff-ln' }, l && l.o != null ? l.o : ''),
        React.createElement('span', { className: 'gp-diff-code' },
          React.createElement('span', { className: 'gp-diff-sign' }, l ? (lDel ? '-' : ' ') : ''),
          lCode)),
      React.createElement('span', { className: 'gp-diff-mid' }),
      React.createElement('span', { className: 'gp-diff-half' + (rAdd ? ' gp-dh-add' : '') },
        React.createElement('span', { className: 'gp-diff-ln' }, r && r.n != null ? r.n : ''),
        React.createElement('span', { className: 'gp-diff-code' },
          React.createElement('span', { className: 'gp-diff-sign' }, r ? (rAdd ? '+' : ' ') : ''),
          rCode)))
  }

  // 头部布局：glyph | 标题框（flex:1 吃掉全部剩余空间）| +增/−删统计 | 组徽标 |
  // 分栏切换 | 关闭。不设 spacer —— 标题框的 flex-grow 已把右侧
  // 元素整体推到最右（统计居右），若再放 flex:1 的 spacer 会与标题框平分剩余空间。
  const head = React.createElement('div', { className: 'gp-diff-head' },
    React.createElement('span', { className: 'gp-diff-glyph ' + gl.cls }, gl.g),
    React.createElement('div', { className: 'gp-diff-title', title: sel.path },
      React.createElement('span', { className: 'gp-diff-name' }, base),
      dir ? React.createElement('span', { className: 'gp-diff-dir' }, dir) : null),
    !state.loading && !state.error && (parsed.adds > 0 || parsed.dels > 0) ? React.createElement('span', { className: 'gp-diff-stats' },
      parsed.adds > 0 ? React.createElement('span', { className: 'gp-diff-stat-add' }, '+' + parsed.adds) : null,
      parsed.dels > 0 ? React.createElement('span', { className: 'gp-diff-stat-del' }, '−' + parsed.dels) : null) : null,
    // 组徽标：工作区三组显示组名；提交文件显示提交短 hash（悬停看完整 hash）
    React.createElement('span', { className: 'gp-chip', title: sel.hash || undefined }, sel.group === 'commit' ? (sel.short || String(sel.hash || '').slice(0, 7)) : (GROUP_META[sel.group] ? tr(GROUP_META[sel.group].titleKey) : sel.group)),
    // 全文切换：开启后整个文件进单个 hunk（改动行红绿高亮、其余作上下文灰显）；
    // 激活态高亮与分栏切换一致（gp-on）；图片模式无 hunk，两个视图按钮均隐藏
    isImg ? null : React.createElement('button', { className: 'gp-btn-icon' + (full ? ' gp-on' : ''), title: full ? tr('diffChangesOnly') : tr('diffFullFile'), onClick: () => setFull((v) => { savePrefBool('gp-diff-full', !v); return !v }) }, icon('fullDoc')),
    isImg ? null : React.createElement('button', { className: 'gp-btn-icon', title: split ? tr('unifiedDiffTitle') : tr('splitDiffTitle'), onClick: () => setSplit((v) => { savePrefBool('gp-diff-split', !v); return !v }) }, icon(split ? 'unified' : 'split')),
    React.createElement('button', { className: 'gp-btn-icon', title: tr('closeDiff'), onClick: requestClose }, icon('close')))

  // ruler 覆盖条：浮在原生滚动条内侧（right = 滚动条宽 + 3px 间隙），
  // 色块按文档比例定位，与滚动位置天然同步
  const rulerEl = ruler.marks ? React.createElement('div', {
    className: 'gp-diff-ruler', style: { right: (ruler.sbw + 3) + 'px' }, onClick: ruler.onRulerClick
  },
    ruler.marks.map((m, i) => React.createElement('div', {
      key: i, className: 'gp-diff-ruler-mark gp-drm-' + m.t,
      style: { top: (m.top * 100) + '%', height: (m.h * 100) + '%' }
    }))) : null

  const body = React.createElement('div', { className: 'gp-diff-body-wrap' },
    React.createElement('div', { className: 'gp-diff-body', ref: ruler.bodyRef },
      state.loading
        ? React.createElement('div', { className: 'gp-scanning' }, React.createElement('span', { className: 'gp-spinner' }), ' ' + tr(isImg ? 'imgLoading' : 'loadingDiff'))
        : state.error
          ? React.createElement('div', { className: 'gp-empty' }, state.error)
          : isImg
            ? React.createElement('div', { className: 'gp-img-wrap' }, buildImageBody(imgState, (kind) => setZoom({ kind })))
            : React.createElement('div', { className: 'gp-diff-table' },
                parsed.meta.length ? React.createElement('div', { className: 'gp-diff-meta' }, parsed.meta.join('\n')) : null,
                split
                  ? splitPairs.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                      b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                      b.pairs.map(renderSplitRow)))
                  : parsed.blocks.map((b, bi) => React.createElement(React.Fragment, { key: 'b' + bi },
                      b.hunk ? React.createElement('div', { className: 'gp-diff-hrow' }, b.hunk) : null,
                      b.rows.map(renderRow))))),
    rulerEl)

  // 滑入/滑出相位：off = 未入场或正在关闭 → 整屉藏到不透明的 Git Panel 正后方。
  // 遮罩是一整块（right: panelW，延伸到本面板下方，由面板滑入后盖住）；
  // 面板只做纯位移（无投影、无透明度动画），起点被 Git Panel 完全遮挡。
  const off = !entered || closing
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'gp-diff-backdrop', style: { right: panelW + 'px', opacity: off ? 0 : 1 }, onClick: requestClose }),
    React.createElement('div', {
      className: 'gp-diff-drawer',
      style: { right: panelW + 'px', width: wEff + 'px', transform: off ? 'translateX(100%)' : 'none' }
    },
      React.createElement('div', {
        className: 'gp-diff-resize' + (resizing ? ' gp-diff-resize-active' : ''),
        title: tr('resizeTitle'),
        onPointerDown: (e) => { e.preventDefault(); widthDrag.begin(); setResizing(true) }
      }),
      head,
      body),
    // 全屏 lightbox：图片模式点击图片格后浮于整个页面之上（z-index 420）；
    // 对应版本无图（超限/缺失）不会进入（onZoom 只在有图的格上触发）
    zoom && imgState && imgState[zoom.kind]
      ? React.createElement(ImageLightbox, {
          img: imgState[zoom.kind], kind: zoom.kind,
          both: !!(imgState.old && imgState.new),
          onSwitch: (kind) => setZoom({ kind }),
          onClose: () => setZoom(null)
        })
      : null)
}
export { DiffDrawer }
