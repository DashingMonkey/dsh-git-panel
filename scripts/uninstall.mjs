/**
 * git-panel 卸载脚本（跨平台 Node）。
 *
 * 用法：node scripts/uninstall.mjs
 *       DSH_PROFILE=/path/to/profile node scripts/uninstall.mjs
 *
 * 适用范围：本脚本只清理「复制式」安装（install.sh / install.mjs）留下的状态——
 *   node_modules 里的包目录 + profile/cordis.patch.yml 的插件行。
 * 若插件是经 pnpm / `dsh plugin --profile web add` 安装的（组合包机制，
 *   profile/package.json 的 dependencies 与 dsh.profile.bundles 里有记录），
 *   请改用：dsh plugin --profile web remove @dsh-local/git-panel
 *   （本脚本会检测到该情况并给出提示）。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PKG_NAME = '@dsh-local/git-panel'
const PKG_DIR = join('node_modules', ...PKG_NAME.split('/'))
const ENTRY_ID = 'git-panel'

function profileDir() {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

const profile = profileDir()
const dest = join(profile, PKG_DIR)
const patch = join(profile, 'cordis.patch.yml')
const pkgJsonPath = join(profile, 'package.json')

// 0) 检测 pnpm / dsh plugin 安装痕迹：profile/package.json 的依赖或 bundles 列表
let pnpmInstalled = false
if (existsSync(pkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const deps = pkg.dependencies || {}
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    pnpmInstalled = Object.prototype.hasOwnProperty.call(deps, PKG_NAME) || bundles.includes(PKG_NAME)
  } catch { /* 解析失败则按复制式处理 */ }
}

// 1) 删除插件包（pnpm 安装时这里只是符号链接，删除链接本身不影响源仓库）
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true })
  console.log('✓ 已删除插件包 ' + dest)
} else {
  console.log('（插件包不存在，跳过）')
}

// 2) 从 cordis.patch.yml 移除 git-panel 的 insert 块
if (existsSync(patch)) {
  const cur = readFileSync(patch, 'utf8')
  if (cur.includes(PKG_NAME) || cur.includes(ENTRY_ID)) {
    const bak = patch + '.bak.' + Date.now()
    writeFileSync(bak, cur)
    // 移除包含 ENTRY_ID/PKG_NAME 的整个 `- insert:` 块
    const lines = cur.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const m = /^(\s*)- insert:\s*$/.exec(lines[i])
      if (m) {
        const indent = m[1]
        const block = [lines[i]]
        let j = i + 1
        while (j < lines.length) {
          const nxt = lines[j]
          if (nxt.trim() === '' || nxt.startsWith(indent + '  ') || nxt.startsWith(indent + '-')) {
            block.push(nxt)
            j++
          } else break
        }
        if (!block.some((l) => l.includes(ENTRY_ID) || l.includes(PKG_NAME))) out.push(...block)
        i = j
      } else {
        out.push(lines[i])
        i++
      }
    }
    // 连同标记注释一起移除（如 "# @dsh-local/git-panel - installed by ..."）
    let body = out
      .filter((l) => !(l.trim().startsWith('#') && (l.includes(ENTRY_ID) || l.includes(PKG_NAME))))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (body === '') body = '[]'
    writeFileSync(patch, body + '\n')
    console.log('✓ 已从 cordis.patch.yml 移除插件行（原配置已备份为 ' + bak + '）')
  } else {
    console.log('（cordis.patch.yml 中无该插件，跳过）')
  }
} else {
  console.log('（无 cordis.patch.yml，跳过）')
}

console.log('')
if (pnpmInstalled) {
  console.log('⚠ 检测到该插件是经 pnpm / `dsh plugin add` 安装的（组合包机制）：')
  console.log('  profile/package.json 的 dependencies 与 dsh.profile.bundles 仍有记录，')
  console.log('  重启后插件可能重新加载。请改用官方卸载命令彻底移除：')
  console.log('')
  console.log('    npx @deepseek-ai/dsh plugin --profile web remove @dsh-local/git-panel')
  console.log('')
} else {
  console.log('✅ 卸载完成！重启 dsh web 后面板消失。')
}
