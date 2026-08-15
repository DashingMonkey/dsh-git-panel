/**
 * git-panel 一键安装脚本（跨平台 Node，Windows/macOS/Linux 通用）。
 *
 * 用法：
 *   node scripts/install.mjs
 *   DSH_PROFILE=/path/to/profile node scripts/install.mjs   # 指定 profile
 *
 * 步骤（参照 dsh-pet install.sh 的复制式方案，不依赖 pnpm）：
 *   1. 构建 lib/（确保产物最新）
 *   2. 复制 lib/ + package.json + cordis.patch.yml 到 <profile>/node_modules/@dsh-local/git-panel
 *   3. 在 <profile>/cordis.patch.yml 注册 `- insert:` 插件行（已注册则跳过，先备份）
 *   4. 从 profile 目录验证 loader 能解析该包
 *   5. 提示重启 `dsh web` 生效
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = '@dsh-local/git-panel'
const PKG_DIR = join('node_modules', ...PKG_NAME.split('/'))
const ENTRY_ID = 'git-panel'

function profileDir() {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

function fail(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

// ---- 1) 构建 ----
console.log('▶ 构建 lib/ ...')
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, stdio: 'inherit' })

// ---- 2) 复制包 ----
const profile = profileDir()
if (!existsSync(profile)) fail(`找不到 dsh profile：${profile}（可用 DSH_PROFILE 指定）`)
const dest = join(profile, PKG_DIR)
console.log(`▶ 安装插件包到 ${dest} ...`)
rmSync(dest, { recursive: true, force: true })
mkdirSync(dirname(dest), { recursive: true })
mkdirSync(dest, { recursive: true })
cpSync(join(ROOT, 'lib'), join(dest, 'lib'), { recursive: true })
copyFileSync(join(ROOT, 'package.json'), join(dest, 'package.json'))
copyFileSync(join(ROOT, 'cordis.patch.yml'), join(dest, 'cordis.patch.yml'))
console.log('  ✓ 包已就位（lib/ + package.json + cordis.patch.yml）')

// ---- 3) 注册 patch 行 ----
const patch = join(profile, 'cordis.patch.yml')
const insertBlock = `# @dsh-local/git-panel - installed by scripts/install.mjs
- insert:
    - id: ${ENTRY_ID}
      name: '${PKG_NAME}'
      config:
        scanMaxDepth: 10
        scanMaxDirs: 2000
        scanMaxRepos: 50
`
const stripComment = (s) => s.split('\n').filter((l) => {
  const t = l.trim()
  return t !== '' && !t.startsWith('#')
}).join('\n')

// 组合包方式（pnpm / `dsh plugin add`）的注册记录在 profile/package.json 的
// dependencies / dsh.profile.bundles 里，与 patch 行二选一；两者共存会导致
// loader 报 duplicate loader entry id
let bundled = false
const pkgJsonPath = join(profile, 'package.json')
if (existsSync(pkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const deps = pkg.dependencies || {}
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    bundled = Object.prototype.hasOwnProperty.call(deps, PKG_NAME) || bundles.includes(PKG_NAME)
  } catch { /* 解析失败按无冲突处理 */ }
}

if (existsSync(patch)) {
  const cur = readFileSync(patch, 'utf8')
  const clean = stripComment(cur)
  // 幂等检测匹配结构化行（去注释后的 id/name 字段），避免文件中其它插件
  // 的注释或配置里恰好含 "git-panel" 字样时被误判为已注册；
  // 正则容忍前导缩进与单/双引号，以匹配本脚本写入的列表项格式
  const registered = /^\s*-\s*id:\s*git-panel\s*$/m.test(clean) ||
    /^\s*name:\s*['"]?@dsh-local\/git-panel['"]?\s*$/m.test(clean)
  if (registered && bundled) {
    fail(`插件同时注册在 package.json（bundles/dependencies）与 cordis.patch.yml 中，` +
      `会导致 loader 报 duplicate loader entry id。请二选一清理：` +
      `\n  npx @deepseek-ai/dsh plugin --profile web remove ${PKG_NAME}（改为复制式）` +
      `\n  或手动删除 cordis.patch.yml 中的 git-panel insert 块（保留组合包式）`)
  }
  if (registered) {
    console.log('▶ cordis.patch.yml 已注册过该插件，跳过')
  } else if (bundled) {
    console.log('▶ 检测到 package.json 已通过 bundles/dependencies 注册该插件（组合包方式），跳过 patch 注册以免重复')
    console.log('  如需改为复制式安装，先执行：npx @deepseek-ai/dsh plugin --profile web remove ' + PKG_NAME)
  } else {
    console.log('▶ 注册插件行到 cordis.patch.yml ...')
    writeFileSync(patch + '.bak.' + Date.now(), cur)
    // 文件只剩注释（clean 为空）时走追加保留原注释；显式空配置 '[]' 才整体替换
    const body = clean.trim() === '[]'
      ? insertBlock
      : cur.replace(/\s*$/, '\n') + '\n' + insertBlock
    writeFileSync(patch, body)
    console.log('  ✓ 已注册（原配置已备份为 cordis.patch.yml.bak.*）')
  }
} else if (bundled) {
  console.log('▶ 检测到 package.json 已通过 bundles/dependencies 注册该插件（组合包方式），跳过创建 cordis.patch.yml 以免重复')
  console.log('  如需改为复制式安装，先执行：npx @deepseek-ai/dsh plugin --profile web remove ' + PKG_NAME)
} else {
  console.log('▶ 创建 cordis.patch.yml ...')
  writeFileSync(patch, insertBlock)
  console.log('  ✓ 已创建')
}

// ---- 4) 验证 loader 解析 ----
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
