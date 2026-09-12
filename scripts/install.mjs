/**
 * git-panel 一键安装脚本（跨平台 Node，Windows/macOS/Linux 通用）。
 *
 * 用法：
 *   node scripts/install.mjs
 *   DSH_PROFILE=/path/to/profile node scripts/install.mjs   # 指定 profile
 *
 * 步骤（复制式方案：构建产物直接复制进 profile，不依赖 pnpm）：
 *   1. 构建 lib/（确保产物最新）
 *   2. 复制 lib/ + package.json + cordis.patch.yml 到 <profile>/node_modules/@dsh-local/git-panel
 *   3. 在 <profile>/cordis.patch.yml 注册 `- insert:` 插件行（已注册则跳过，先备份）
 *   4. 从 profile 目录验证 loader 能解析该包
 *   5. 提示重启 `dsh web` 生效
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBundledInstalled, profileDir, RE_ENTRY_ID, RE_PKG_NAME, stripComment } from './lib/profile.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = '@dsh-local/git-panel'
const PKG_DIR = join('node_modules', ...PKG_NAME.split('/'))
const ENTRY_ID = 'git-panel'

/** 落点是不是「指向别处」的链接（junction / symlink）。
 *  组合包式安装的 profile 里，这条依赖由 pnpm 按 `link:` 建成链接——此时落盘只是
 *  往仓库里写产物，不需要（也不该）复制；纯复制式安装的 profile 里它才是实体目录。
 *  2026-09-12 审查发现实机就卡在这个矛盾上：package.json 写 `link:`，落点却是实体副本，
 *  于是每次 `npm run build` 之后 DSH 仍在跑那份旧副本（表现为「改了代码没反应」）。 */
function isLinked(dest) {
  try {
    const st = lstatSync(dest)
    return st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())
  } catch (e) {
    return false
  }
}

function fail(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

// ---- 1) 构建 ----
console.log('▶ 构建 lib/ ...')
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, stdio: 'inherit' })

// ---- 2) 先判定注册方式，再决定要不要落盘 ----
// 顺序教训（2026-09-12 审查）：原先先做破坏性复制（rm -rf dest + 拷贝），之后才检查
// 「是否已由组合包方式注册」。后果是——在 pnpm 管理的 profile 上，本脚本会把 `link:`
// 依赖悄悄换成一个实体副本目录（安装方式被静默改变），而且只有换完之后才打印
// 「如需改为复制式安装，请先 remove」。更糟的是：此后每次 `npm run build` 只更新本仓库的
// lib/，profile 里那份实体副本不再跟着变，页面会一直跑旧 bundle。
// 所以：**先判定，再落盘**；检测到组合包方式就直接退出，不碰 profile。
const profile = profileDir()
if (!existsSync(profile)) fail(`找不到 dsh profile：${profile}（可用 DSH_PROFILE 指定）`)
const dest = join(profile, PKG_DIR)
const patch = join(profile, 'cordis.patch.yml')

// 组合包方式（pnpm / `dsh plugin add`）的注册记录在 profile/package.json 的
// dependencies / dsh.profile.bundles 里，与 patch 行二选一；两者共存会导致
// loader 报 duplicate loader entry id
const bundled = isBundledInstalled(join(profile, 'package.json'), PKG_NAME)
const patchExists = existsSync(patch)
const patchCur = patchExists ? readFileSync(patch, 'utf8') : ''
const patchClean = patchExists ? stripComment(patchCur) : ''
// 幂等检测匹配结构化行（去注释后的 id/name 字段），避免文件中其它插件
// 的注释或配置里恰好含 "git-panel" 字样时被误判为已注册；
// 正则容忍前导缩进与单/双引号，以匹配本脚本写入的列表项格式
const registered = RE_ENTRY_ID.test(patchClean) || RE_PKG_NAME.test(patchClean)

if (registered && bundled) {
  fail(`插件同时注册在 package.json（bundles/dependencies）与 cordis.patch.yml 中，` +
    `会导致 loader 报 duplicate loader entry id。请二选一清理：` +
    `\n  npx @deepseek-ai/dsh plugin --profile web remove ${PKG_NAME}（改为复制式）` +
    `\n  或手动删除 cordis.patch.yml 中的 git-panel insert 块（保留组合包式）`)
}
if (bundled) {
  // 组合包方式：依赖由 pnpm 管理。若落点是链接（`link:` 的正常形态），落盘 = 往仓库写产物，
  // 不需要复制——复制反而会把链接换成实体副本，从此每次构建都留下「profile 里是旧产物」的坑。
  if (isLinked(dest)) {
    console.log(`▶ ${PKG_NAME} 已由组合包方式注册，且落点是指向本仓库的链接`)
    console.log('  → 产物已就位（链接直接指向 ' + ROOT + '），无需复制、无需重启')
    process.exit(0)
  }
  console.log(`▶ 检测到 ${PKG_NAME} 已由组合包方式注册（profile/package.json 的 dependencies / dsh.profile.bundles）`)
  console.log(`  ⚠ 但落点 ${dest} 是实体副本，不是链接——这与 dependencies 里的 \`link:\` 不一致。`)
  console.log('     后果：此后每次 `npm run build` 只更新本仓库 lib/，DSH 仍读这份旧副本（改了代码没反应）。')
  console.log('     修法（二选一）：')
  console.log('       a) 交回 pnpm 管理：删掉该目录后执行 `npx @deepseek-ai/dsh plugin --profile web add <本仓库路径>`，')
  console.log('          由 pnpm 重建为链接；此后 build 即生效。')
  console.log('       b) 明确走复制式：先 `npx @deepseek-ai/dsh plugin --profile web remove ' + PKG_NAME + '`，')
  console.log('          再重跑本脚本（它会把 patch 行写好），此后每次构建后都要重跑本脚本。')
  console.log('  → 本次不复制，避免继续掩盖这个矛盾；请按上面任一条处理。')
  process.exit(0)
}

// ---- 3) 复制包（仅复制式安装路径） ----
console.log(`▶ 安装插件包到 ${dest} ...`)
rmSync(dest, { recursive: true, force: true })
mkdirSync(dirname(dest), { recursive: true })
mkdirSync(dest, { recursive: true })
cpSync(join(ROOT, 'lib'), join(dest, 'lib'), { recursive: true })
copyFileSync(join(ROOT, 'package.json'), join(dest, 'package.json'))
copyFileSync(join(ROOT, 'cordis.patch.yml'), join(dest, 'cordis.patch.yml'))
console.log('  ✓ 包已就位（lib/ + package.json + cordis.patch.yml）')

// ---- 4) 注册 patch 行 ----
const insertBlock = `# @dsh-local/git-panel - installed by scripts/install.mjs
- insert:
    - id: ${ENTRY_ID}
      name: '${PKG_NAME}'
      config:
        scanMaxDepth: 10
        scanMaxDirs: 2000
        scanMaxRepos: 50
`

if (patchExists) {
  if (registered) {
    console.log('▶ cordis.patch.yml 已注册过该插件，跳过')
  } else {
    console.log('▶ 注册插件行到 cordis.patch.yml ...')
    writeFileSync(patch + '.bak.' + Date.now(), patchCur)
    // 文件只剩注释（clean 为空）时走追加保留原注释；显式空配置 '[]' 才整体替换
    const body = patchClean.trim() === '[]'
      ? insertBlock
      : patchCur.replace(/\s*$/, '\n') + '\n' + insertBlock
    writeFileSync(patch, body)
    console.log('  ✓ 已注册（原配置已备份为 cordis.patch.yml.bak.*）')
  }
} else {
  console.log('▶ 创建 cordis.patch.yml ...')
  writeFileSync(patch, insertBlock)
  console.log('  ✓ 已创建')
}

// ---- 5) 验证 loader 解析 ----
console.log('▶ 验证 loader 解析 ...')
try {
  const probe = `import('${PKG_NAME}').then(m => { console.log('  ✓ RESOLVE_OK apply=' + typeof (m.default && m.default.apply)); process.exit(0) }).catch(e => { console.error('  ✗ ' + e.message.split(String.fromCharCode(10))[0]); process.exit(1) })`
  execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: profile, stdio: 'inherit' })
} catch {
  fail('解析失败，请检查上面的错误')
}

console.log('')
console.log('✅ 安装完成！请重启 dsh web 生效：')
console.log('   dsh web')
console.log('')
console.log('   重启后：侧栏底部出现 Git Panel 按钮，点击打开面板。')
