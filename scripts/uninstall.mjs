/**
 * git-panel 卸载脚本（跨平台 Node）。
 *
 * 用法：node scripts/uninstall.mjs                 # 自动探测（只有一个 profile 时直接卸）
 *       node scripts/uninstall.mjs web             # 命令行版
 *       node scripts/uninstall.mjs desktop         # 桌面版（DeepSeek Harness 应用）
 *       DSH_PROFILE=/path/to/profile node scripts/uninstall.mjs
 *
 * 适用范围：本脚本只清理「复制式」安装（install.sh / install.mjs 写下的状态）——
 *   node_modules 里的包目录 + profile/cordis.patch.yml 的插件行。
 * 若插件是经 pnpm / `dsh plugin add` 安装的（组合包机制，
 *   profile/package.json 的 dependencies 与 dsh.profile.bundles 里有记录），
 *   请改用：dsh plugin --profile <web|desktop> remove @dsh-local/git-panel
 *   （桌面版必须先完全退出应用，再由 install.mjs 定位到的应用自带 CLI 执行；
 *     本脚本会检测到该情况并给出可直接复制的命令）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  desktopCliCommand,
  findDesktopInstall,
  isBundledInstalled,
  RE_ENTRY_ID,
  RE_PKG_NAME,
  resolveTarget,
  stripComment,
} from './lib/profile.mjs'

const PKG_NAME = '@dsh-local/git-panel'
const PKG_DIR = join('node_modules', ...PKG_NAME.split('/'))

let target
try {
  target = resolveTarget()
} catch (e) {
  console.error('✗ ' + e.message)
  process.exit(1)
}
const profile = target.dir
console.log(`▶ 目标 profile：${target.name}（${profile}）${target.explicit ? '' : '［自动探测］'}`)

const dest = join(profile, PKG_DIR)
const patch = join(profile, 'cordis.patch.yml')
const pkgJsonPath = join(profile, 'package.json')

// 0) 检测 pnpm / dsh plugin 安装痕迹：profile/package.json 的依赖或 bundles 列表
const pnpmInstalled = isBundledInstalled(pkgJsonPath, PKG_NAME)

// 0b) 桌面版：组合包式登记必须用应用自带 CLI 撤销（pnpm 的依赖与链接由它维护）
// 只删目录 + patch 行是不够的：package.json 的 dependencies / dsh.profile.bundles 里
// 仍有记录，重启后 loader 会重新装载它（表现为"卸载了但按钮还在"）。
if (target.name === 'desktop' && pnpmInstalled) {
  const install = findDesktopInstall()
  if (!install) {
    console.error('✗ 检测到桌面版为组合包式安装，但找不到桌面应用安装目录，无法调用其自带 CLI。')
    console.error('  请先完全退出桌面应用，再手工执行（把 <应用安装目录> 换成实际路径）：')
    console.error('    & "<应用安装目录>\\DeepSeek Harness.exe" --expose-internals "<应用安装目录>\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" plugin --profile desktop remove ' + PKG_NAME)
    console.error('  或用 DSH_DESKTOP_RESOURCES=<应用 resources 目录> 重跑本脚本。')
    process.exit(1)
  }
  console.log('▶ 使用桌面应用自带 CLI 撤销登记 ...')
  console.log('  ⚠ 建议先完全退出 DeepSeek Harness 桌面应用：应用运行中也能撤销登记，但插件图在 Host')
  console.log('     启动时解析，运行中撤销通常要重启才真正卸载。')
  const pnpmArgs = ['remove', PKG_NAME]
  try {
    execFileSync(install.exe, ['--expose-internals', install.cliEntry, 'plugin', '--profile', 'desktop', ...pnpmArgs], {
      cwd: profile,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
  } catch (e) {
    console.error('✗ 桌面应用自带 CLI 执行失败（见上方 pnpm 输出）。常见原因：桌面应用仍在运行。')
    console.error('  可手工重试：' + desktopCliCommand(install, pnpmArgs))
    process.exit(1)
  }
  if (isBundledInstalled(pkgJsonPath, PKG_NAME)) {
    console.error('✗ CLI 已退出但 profile/package.json 里仍有本包记录，请检查上面的输出。')
    process.exit(1)
  }
  console.log('  ✓ 已从 profile/package.json 撤销登记（dependencies + dsh.profile.bundles）')
  // 桌面 profile 的 patch 行不由本插件写入，但历史版本/手工安装可能留下过，一并清理
  const patchCur = existsSync(patch) ? stripComment(readFileSync(patch, 'utf8')) : ''
  if (RE_ENTRY_ID.test(patchCur) || RE_PKG_NAME.test(patchCur)) removePatchEntry(patch)
  console.log('')
  console.log('✅ 桌面版卸载完成！完全退出并重新打开 DeepSeek Harness 桌面应用后生效。')
  process.exit(0)
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
  // 存在性检测用结构化行（去注释后整体匹配），与 install.mjs 的 registered 判定同口径
  if (RE_ENTRY_ID.test(stripComment(cur)) || RE_PKG_NAME.test(stripComment(cur))) {
    removePatchEntry(patch)
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
  console.log(`    npx @deepseek-ai/dsh plugin --profile ${target.name} remove ${PKG_NAME}`)
  console.log('')
} else {
  console.log(`✅ 卸载完成（profile: ${target.name}）！重启后侧栏的 Git Panel 按钮消失。`)
  console.log(target.name === 'desktop'
    ? '   完全退出 DeepSeek Harness 桌面应用后重新打开即可。'
    : '   重启 dsh web 即可。')
}

/** 从 cordis.patch.yml 移除本插件的 `- insert:` 块（连带 install.mjs 写的标记注释），先备份。 */
function removePatchEntry(patchPath) {
  const cur = readFileSync(patchPath, 'utf8')
  const bak = patchPath + '.bak.' + Date.now()
  writeFileSync(bak, cur)
  // 移除本插件（id/name 字段行命中）的整个 `- insert:` 块
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
        // 同缩进的新列表项是下一个块（可能是其它插件的 - insert:）的开始，
        // 必须终止收集，否则相邻的其它插件块会被并入本块而遭误删
        if (nxt.startsWith(indent + '-')) break
        if (nxt.trim() === '' || nxt.startsWith(indent + '  ')) {
          block.push(nxt)
          j++
        } else break
      }
      if (!block.some((l) => RE_ENTRY_ID.test(l) || RE_PKG_NAME.test(l))) out.push(...block)
      i = j
    } else {
      out.push(lines[i])
      i++
    }
  }
  // 连同 install.mjs 写入的标记注释一起移除（精确前缀匹配，不动其它插件注释）
  let body = out
    .filter((l) => !l.trim().startsWith('# @dsh-local/git-panel'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (body === '') body = '[]'
  writeFileSync(patchPath, body + '\n')
  console.log('✓ 已从 cordis.patch.yml 移除插件行（原配置已备份为 ' + bak + '）')
}
