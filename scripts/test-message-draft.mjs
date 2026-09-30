/**
 * 行为回归：提交信息草稿（src/client/messageDraft.js）真值表 + RepoCard 接线检查。
 *
 * 动机：草稿从 RepoCard 的组件状态搬到模块级 Map 之后，「卸载重挂后还在」是这套
 * 方案的全部价值，而它的语义有三个容易踩的坑，必须钉在测试里：
 *   1) 空串是**合法内容**——提交成功后清空输入框必须真的把草稿也清掉，
 *      否则下次挂载会把刚提交的那段话倒灌回输入框（比丢草稿更糟）；
 *   2) 两个仓库互不影响（键是绝对路径，不是相对 repo.id）；
 *   3) 淘汰只按**写入**序，超上限时最久没写过的先出局，且不会无限增长。
 *
 * 场景 1–7 直接 import 真模块（它不依赖 react/store），不需要 vm 打桩；
 * 场景 8 做**源码接线检查**（acorn AST 结构断言，不是字符串匹配）——草稿能不能活下来
 * 取决于「读回/写回」这几处是否还在原位，这类断链不抛错、只静默退回丢草稿的老毛病。
 * npm test 一部分；非 0 退出 = 失败。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'
import {
  getMessageDraft,
  setMessageDraft,
  messageDrafts
} from '../src/client/messageDraft.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const scenario = (name, run) => {
  const checks = run()
  const failed = checks.filter((c) => !c.ok)
  results.push({ name, failed })
  console.log((failed.length ? '✗ ' : '✓ ') + name + (failed.length ? '\n    ' + failed.map((f) => f.msg).join('\n    ') : ''))
}
const eq = (actual, expected, msg) => ({ ok: actual === expected, msg: msg + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）` })

const A = 'D:\\ws-a\\proj'
const B = 'D:\\ws-b\\proj' // 与 A 不同工作空间、但同名（repo.id 会撞，path 不会）

// 每个场景自建 key 前缀，避免相互干扰（map 是模块级单例，不提供 clear）
const k = (n) => 'D:\\test-' + n + '\\repo'

// 1) 未写入 → 空串（挂载时读到空输入框），且读取不产生条目
scenario('1 未写入读回空串', () => {
  const before = messageDrafts.size
  return [
    eq(getMessageDraft(k(1)), '', '未写入的路径'),
    eq(getMessageDraft(undefined), '', 'undefined 路径'),
    eq(getMessageDraft(''), '', '空路径'),
    eq(messageDrafts.size, before, '读取不新增条目')
  ]
})

// 2) 写入 → 读回同一文本
scenario('2 写入读回', () => {
  setMessageDraft(k(2), 'feat(ui): 保留提交信息草稿')
  return [eq(getMessageDraft(k(2)), 'feat(ui): 保留提交信息草稿', '读回内容')]
})

// 3) 空串是合法内容：提交成功后清空，不能回落到上一版文本
scenario('3 空串清空（提交成功语义）', () => {
  setMessageDraft(k(3), 'wip: 先写一半')
  const mid = getMessageDraft(k(3))
  setMessageDraft(k(3), '')
  return [
    eq(mid, 'wip: 先写一半', '清空前可读回'),
    eq(getMessageDraft(k(3)), '', '清空后为空串'),
    eq(messageDrafts.has(k(3)), true, '清空后仍留有条目（区分「空内容」与「没写过」）')
  ]
})

// 4) 跨仓库隔离：A 与 B 只差一个父目录，内容互不污染
scenario('4 跨仓库隔离', () => {
  setMessageDraft(A, 'A 的提交信息')
  setMessageDraft(B, 'B 的提交信息')
  return [
    eq(getMessageDraft(A), 'A 的提交信息', 'A 的内容'),
    eq(getMessageDraft(B), 'B 的提交信息', 'B 的内容')
  ]
})

// 5) 非字符串入参归一为字符串（textarea 传来的一定是串，这里只防手滑）
scenario('5 入参归一', () => {
  setMessageDraft(k(5), null)
  const nullCase = getMessageDraft(k(5))
  setMessageDraft(k(5), 42)
  return [
    eq(nullCase, '', 'null 归一为空串'),
    eq(getMessageDraft(k(5)), '42', '数字归一为字符串')
  ]
})

// 6) 容量上限：写 60 条后只留最近 50 条，最早的 10 条被淘汰
scenario('6 容量上限 50', () => {
  for (let i = 0; i < 60; i++) setMessageDraft(k('cap-' + i), 'msg-' + i)
  const kept = []
  for (let i = 0; i < 60; i++) kept.push(getMessageDraft(k('cap-' + i)))
  const first10 = kept.slice(0, 10).every((v) => v === '')
  const last50 = kept.slice(10).every((v, i) => v === 'msg-' + (i + 10))
  return [
    eq(messageDrafts.size <= 50, true, '条目数不超过上限（实际 ' + messageDrafts.size + '）'),
    eq(first10, true, '最早写入的 10 条被淘汰'),
    eq(last50, true, '最近写入的 50 条仍在')
  ]
})

// 7) 淘汰只按写入序：重写一条旧键会把它移到最近写入端，下一个出局的是更早的那条。
// ⚠ 先垫 50 条「填满名额」的旁路键：淘汰是全局空间，前面的场景已经在 map 里留了
// 几十条条目，不先占满名额的话存活与否取决于它们，断言就成了碰运气（第一版正是
// 这么写错的）。垫满后，churn 的 50 次写入恰好只能挤出 filler + 那条未重写的旧键。
scenario('7 重写刷新写入序', () => {
  // 起点：map 里已有的条目全部在「最旧端」之前，先写满 50 条 filler 把名额占满，
  // 让 map 恰好处于满员态（多写一条必挤掉一条）
  for (let i = 0; i < 50; i++) setMessageDraft(k('lru-filler-' + i), 'filler-' + i)
  const full = messageDrafts.size
  const oldest = k('lru-oldest')
  const second = k('lru-second')
  setMessageDraft(oldest, 'oldest')            // 满员态 → 挤掉最旧的 filler
  setMessageDraft(second, 'second')            // 再挤掉一条 filler
  setMessageDraft(oldest, 'oldest-rewritten')  // 重写：oldest 移到最近写入端
  // 到这里 map = 48 条 filler + [second, oldest-rewritten]（此顺序即淘汰顺序）。
  // 再写 49 条：出局顺序 = 48 filler → second → 到此正好 49 条出局，oldest-rewritten
  // 留在末尾存活。49 是刻意算出来的数：若重写没有刷新写入序，出局的就会是
  // oldest（排在 second 之前），本场景断言随即失败——这正是它要守的性质。
  for (let i = 0; i < 49; i++) setMessageDraft(k('lru-churn-' + i), 'churn-' + i)
  return [
    eq(full, 50, '起点为满员态（前置场景遗留条目数不影响本断言）'),
    eq(getMessageDraft(oldest), 'oldest-rewritten', '被重写的键仍在（内容是最新的）'),
    eq(getMessageDraft(second), '', '未被重写的更旧键出局'),
    eq(messageDrafts.size, 50, '全程维持在上限内')
  ]
})

// ===== 场景 8：RepoCard / GitPanelMain 接线检查（AST 结构断言） =====
// RepoCard 的几处「读回/写回」少任何一处，草稿就会静默退回老毛病（卸载重挂即丢，
// 或提交成功后把刚提交的话倒灌回输入框）：不抛错、浏览器里也看不出来。所以在这里
// 用**结构**断言钉住。
// ⚠ 刻意不用源码字符串匹配（第一版是 `src.includes('…一行长代码…')`）：那种写法对
// 重排换行、改变量名、跑一次格式化都会误报，而代码其实没错——误报几次后整段检查
// 就会被删掉。改走 acorn AST（与 test-write-result.mjs 同一套工具），断的是
// 「调用关系/初值来源/依赖数组」这些真正决定行为的结构。
const parseModule = (rel) => parse(readFileSync(join(ROOT, rel), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })

// 场景 8 的变异测试挂钩：setCases 脚本把**改坏接线**的源码写进临时文件，用 GP_WIRING_SRC
// 指过来，验证这些断言在接线断掉时真的会红（断言不会失败的测试等于没有）。默认读真源码。
// 走环境变量而不是改真文件：改真文件需要外壳往返读写，编码/换行一旦被外壳改写就会把
// 源码里的中文全部损坏（本项目实测踩过），临时文件既安全又能反复跑。
const WIRING_OVERRIDE = process.env.GP_WIRING_SRC || ''
const repoSrcText = WIRING_OVERRIDE
  ? readFileSync(WIRING_OVERRIDE, 'utf8')
  : readFileSync(join(ROOT, 'src', 'client', 'components', 'RepoCard', 'index.js'), 'utf8')
const parseSource = (text) => parse(text, { ecmaVersion: 'latest', sourceType: 'module' })

// 深度优先遍历：找到第一个满足 pred 的节点，并带上它的祖先链。
// 链是必要的——「useState 的初值里调了 getMessageDraft」这类断言要判的是**包含关系**
// （外层调用必须先被匹配到），而「先找到一个就返回」的纯 find 只能匹配最外层节点
//（第一版就栽在这：React.useState 是外层、getMessageDraft 是内层，从外到内遍历时
// 内层谓词被跳过，断言莫名其妙地红）。
const findNode = (root, pred) => {
  let hit = null
  const visit = (node, chain) => {
    if (hit || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((n) => visit(n, chain)); return }
    if (typeof node.type !== 'string') return
    const next = chain.concat([node])
    if (pred(node)) { hit = { node, chain: next }; return }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue
      visit(node[key], next)
    }
  }
  visit(root, [])
  return hit
}
const nodeOnly = (hit) => (hit ? hit.node : null)
// 祖先链里是否存在满足 pred 的节点（默认排除节点自身）
const chainHas = (hit, pred) => !!hit && hit.chain.slice(0, -1).some(pred)
// 成员调用识别：handle === 'updateMessage' || handle === 'React.useState'
const isCallTo = (node, handle) => !!node &&
  node.type === 'CallExpression' &&
  ((node.callee && node.callee.type === 'Identifier' && node.callee.name === handle) ||
   (node.callee && node.callee.type === 'MemberExpression' && !node.callee.computed &&
    node.callee.object && node.callee.object.type === 'Identifier' &&
    node.callee.object.name + '.' + node.callee.property.name === handle))
// 实参里出现某个标识符（如 getMessageDraft / setMessageDraft / repo.path 对象）
const argHasIdentifier = (call, name) => !!call && !!call.arguments && call.arguments.some((a) => a && a.type === 'Identifier' && a.name === name)
// 实参里出现 repo.path 这样的成员表达式
const argHasMember = (call, object, property) => !!call && !!call.arguments && call.arguments.some((a) => a && a.type === 'MemberExpression' &&
  a.object && a.object.type === 'Identifier' && a.object.name === object && a.property && a.property.name === property)
// 对象字面量里某键的值（prop: updateMessage / key: {…}）
const propValue = (objNode, keyName) => {
  if (!objNode || objNode.type !== 'ObjectExpression') return null
  const p = objNode.properties.find((x) => x.type === 'Property' && !x.computed && x.key && x.key.name === keyName)
  return p ? p.value : null
}
const isIdentifier = (node, name) => !!node && node.type === 'Identifier' && node.name === name
// 节点体（含子树）里是否存在满足 pred 的调用
const bodyHasCall = (hit, pred) => {
  if (!hit) return false
  let found = false
  const visit = (node) => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (typeof node.type !== 'string') return
    if (pred(node)) { found = true; return }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue
      visit(node[key])
    }
  }
  visit(hit.node)
  return found
}
// 依赖数组（useEffect 第二参）里含 repo.path
const depsHaveRepoPath = (node) => !!node && node.arguments && node.arguments.length > 1 && (() => {
  const deps = node.arguments[1]
  if (!deps || deps.type !== 'ArrayExpression') return false
  return deps.elements.some((el) => el && el.type === 'MemberExpression' &&
    el.object && el.object.type === 'Identifier' && el.object.name === 'repo' && el.property && el.property.name === 'path')
})()

scenario('8 RepoCard 接线（AST）', () => {
  const repoAst = WIRING_OVERRIDE ? parseSource(repoSrcText) : parseModule('src/client/components/RepoCard/index.js')
  const panelAst = parseModule('src/client/components/GitPanelMain.js')

  // 8a 草稿模块的两个函数都必须被 import 进来（漏了就退回组件状态的行为）
  const draftImport = nodeOnly(findNode(repoAst, (n) => n.type === 'ImportDeclaration' && typeof n.source.value === 'string' && n.source.value.indexOf('messageDraft') >= 0))
  const importedNames = []
  if (draftImport) for (const s of draftImport.specifiers) importedNames.push(s.local.name)
  // 8b 输入框状态：getMessageDraft 的调用必须**发生在**某次 React.useState 的实参里
  //（= 状态初值取自草稿）。判包含关系，不判同一节点。
  const readCall = findNode(repoAst, (n) => isCallTo(n, 'getMessageDraft'))
  const insideUseState = chainHas(readCall, (n) => isCallTo(n, 'React.useState'))
  // 8c 提交成功清空：必须调 updateMessage('') —— 不是 setMessage('')
  const updateCall = findNode(repoAst, (n) => isCallTo(n, 'updateMessage'))
  // 8d 唯一写入口：updateMessage 函数体里 setMessage + setMessageDraft(repo.path, …) 都在
  const updateDecl = nodeOnly(findNode(repoAst, (n) => n.type === 'VariableDeclarator' && n.id && n.id.name === 'updateMessage'))
  const updateCalls = { setMessage: false, setMessageDraft: false }
  if (updateDecl && updateDecl.init) {
    const visitCalls = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(visitCalls); return }
      if (typeof node.type !== 'string') return
      if (isCallTo(node, 'setMessage')) updateCalls.setMessage = true
      if (isCallTo(node, 'setMessageDraft') && argHasMember(node, 'repo', 'path')) updateCalls.setMessageDraft = true
      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue
        visitCalls(node[key])
      }
    }
    visitCalls(updateDecl.init)
  }
  // 8e 跨仓库复用兜底 effect：既要在 repo.path 变化时重跑，函数体里也要真的重新读草稿
  //（⚠ 只查依赖数组是不够的：把函数体清空、换成 no-op 照样能过——变异测试的 M5 抓到过）
  const pathEffect = findNode(repoAst, (n) => isCallTo(n, 'React.useEffect') && depsHaveRepoPath(n))
  const pathEffectRestores = bodyHasCall(pathEffect, (n) => isCallTo(n, 'getMessageDraft'))
  // 8f CommitArea 的 setMessage prop 必须拿到 updateMessage（生成/撤销恢复也才同步草稿）
  const commitArea = nodeOnly(findNode(repoAst, (n) => n.type === 'CallExpression' && n.callee && n.callee.type === 'MemberExpression' &&
    n.callee.property && n.callee.property.name === 'createElement' &&
    n.arguments[0] && n.arguments[0].type === 'Identifier' && n.arguments[0].name === 'CommitArea'))
  // 8g 卡片 key 必须含 r.path（同 id 仓库不串草稿）
  const repoCard = nodeOnly(findNode(panelAst, (n) => n.type === 'CallExpression' && n.callee && n.callee.type === 'MemberExpression' &&
    n.callee.property && n.callee.property.name === 'createElement' &&
    n.arguments[0] && n.arguments[0].type === 'Identifier' && n.arguments[0].name === 'RepoCard'))
  const keyValue = repoCard ? propValue(repoCard.arguments[1], 'key') : null
  const keyHasRepoPath = !!keyValue && keyValue.type === 'BinaryExpression' && keyValue.operator === '+' && (() => {
    const visitKey = (node) => {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some(visitKey)
      if (typeof node.type !== 'string') return false
      if (node.type === 'MemberExpression' && node.object && node.object.type === 'Identifier' && node.object.name === 'r' && node.property && node.property.name === 'path') return true
      return Object.keys(node).some((k) => k !== 'loc' && k !== 'range' && visitKey(node[k]))
    }
    return visitKey(keyValue)
  })()

  return [
    eq(importedNames.indexOf('getMessageDraft') >= 0 && importedNames.indexOf('setMessageDraft') >= 0, true, 'RepoCard 已 import 草稿模块的两个函数（实际：' + importedNames.join(', ') + '）'),
    eq(!!readCall, true, '存在 getMessageDraft(...) 调用'),
    eq(insideUseState, true, '读草稿发生在 React.useState 初值里（挂载时读回草稿）'),
    eq(readCall ? argHasMember(readCall.node, 'repo', 'path') : false, true, '读回草稿用的 key 是 repo.path'),
    eq(updateCalls.setMessage, true, 'updateMessage 会写界面状态 setMessage(...)'),
    eq(updateCalls.setMessageDraft, true, 'updateMessage 会写草稿 setMessageDraft(repo.path, ...)'),
    eq(!!updateCall, true, '提交成功清空走 updateMessage（不是裸 setMessage）'),
    eq(pathEffectRestores, true, '依赖 [repo.path] 的 effect 里真的重新读回草稿（跨仓库复用兜底）'),
    eq(!!propValue(commitArea ? commitArea.arguments[1] : null, 'setMessage') && isIdentifier(propValue(commitArea.arguments[1], 'setMessage'), 'updateMessage'), true, 'CommitArea 的 setMessage 拿到 updateMessage（生成/撤销恢复同步草稿）'),
    eq(keyHasRepoPath, true, '卡片 key 含 r.path（同 id 仓库不串草稿）')
  ]
})

const failedAll = results.filter((r) => r.failed.length > 0)
console.log('')
console.log(failedAll.length === 0
  ? `✓ 提交信息草稿真值表 8/8 全部符合预期（含 RepoCard/GitPanelMain 接线 AST 检查）`
  : `✗ 真值表 ${results.length - failedAll.length}/${results.length} 通过，失败场景见上`)
process.exit(failedAll.length ? 1 : 0)
