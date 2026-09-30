/**
 * 提交信息草稿（按仓库绝对路径记忆输入框内容）。
 *
 * 动机：RepoCard 会在两条正常路径上卸载重挂——面板折叠/展开（isCollapsed 时 body
 * 整棵为 null）、切换工作空间/会话（重扫后 scan.repos 换列表）。草稿若留在组件
 * 状态里，用户写了一半的提交信息在这两种情况下必丢。
 *
 * 键取仓库**绝对路径**（host 的 scan 返回 repo.path），不用 repo.id：id 是 root 内
 * 相对路径，两个工作空间里同名的子仓库会撞在一起（见 host.js 的 activateRepos 注释）。
 *
 * 只记内存（与 scanResultsByRoot 同形态：模块级单例，插件重装载即清零），不写
 * localStorage——提交信息可能含敏感内容，且本次要解决的只是「不因卸载而丢」。
 */

// 容量上限：与 Host 端 SCAN.maxRepos（50）同量级——正常使用下不会触发淘汰。
const DRAFT_CAP = 50

// repo.path → 草稿文本。Map 的插入序即最近写入序（重写前先 delete 再 set，见下）。
const drafts = new Map()

// 读草稿：缺失返回空串。⚠ 刻意**不**刷新写入序（读取不改状态，淘汰只看写入），
// 因此它是「最近写入」而非严格 LRU——本模块只被本仓库的面板读写，够用且更好解释。
export function getMessageDraft(path) {
  if (!path) return ''
  const v = drafts.get(path)
  return typeof v === 'string' ? v : ''
}

// 写草稿：空串是合法内容（提交成功后清空输入框必须真的把草稿也清掉，
// 否则下次挂载会把旧内容倒灌回输入框）。
export function setMessageDraft(path, text) {
  if (!path) return
  drafts.delete(path) // 先删再插：重写等价于「移到最近写入端」
  drafts.set(path, text == null ? '' : String(text))
  while (drafts.size > DRAFT_CAP) drafts.delete(drafts.keys().next().value)
}

// 对账出口：测试脚本读 size 验证淘汰行为，手动排查时可查看当前记忆了哪些仓库。
export { drafts as messageDrafts }
