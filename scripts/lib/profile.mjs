/**
 * install.mjs / uninstall.mjs 的共享工具：profile 定位、桌面版（Electron）profile 探测、
 * YAML 预处理、本插件注册条目的结构化匹配与组合包检测。装机与卸机两侧必须保持同一
 * 口径（单边漂移会导致漏删或误判已注册），因此收敛在此处。
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 结构化匹配：仅命中本插件写入的 id/name 字段行，避免其它插件的
// 注释/配置中恰好含 "git-panel" 字样时被误判/误删。
// m 标志兼容整文件与单行两种 test 用法（单行时 ^$ 锚点行为不变）。
export const RE_ENTRY_ID = /^\s*-\s*id:\s*git-panel\s*$/m
export const RE_PKG_NAME = /^\s*name:\s*['"]?@dsh-local\/git-panel['"]?\s*$/m

/** DSH_HOME（默认 ~/.dsh）：$DSH_HOME 优先，与 DSH 自身口径一致。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 默认 profile：`dsh web` 用的 `web`；DSH_PROFILE / DSH_PROFILE_DIR 可整体覆盖。 */
export function webProfileDir() {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE
  return join(dshHome(), 'profiles', 'web')
}

/**
 * 兼容旧入口：历史脚本只认 web profile，这里保持原语义（DSH_PROFILE 优先）。
 * @deprecated 新代码请用 resolveTarget()，它按参数/环境/探测结果选择 profile。
 */
export function profileDir() {
  return webProfileDir()
}

export const PROFILE_NAMES = ['web', 'desktop']

/**
 * 解析本次要操作的 profile。
 *
 * 优先级：显式参数 > DSH_PROFILE > 自动探测。
 * 自动探测：**桌面版 profile 存在就选它**（`~/.dsh/profiles/desktop` 由桌面应用首次启动
 * 时创建；命令行版的 web profile 不一定存在）。两者都在的环境（本机就是）必须显式指定，
 * 避免"以为装到 A、其实写到 B"。
 *
 * @param argv process.argv（取第 2 个参数作为 profile 名）
 * @returns {{ name: string, dir: string, explicit: boolean }}
 * @throws {Error} profile 名不合法，或未显式指定且两者都存在/都不存在
 */
export function resolveTarget(argv = process.argv) {
  const arg = argv[2] && !argv[2].startsWith('-') ? argv[2] : null
  const envProfile = process.env.DSH_PROFILE ? process.env.DSH_PROFILE : null
  const home = dshHome()
  const dirs = { web: join(home, 'profiles', 'web'), desktop: join(home, 'profiles', 'desktop') }

  if (arg) {
    if (PROFILE_NAMES.includes(arg)) return { name: arg, dir: dirs[arg], explicit: true }
    // 非内置名当作自定义 profile 目录名（DSH 支持任意 profile）
    if (/^[A-Za-z0-9._-]+$/.test(arg)) return { name: arg, dir: join(home, 'profiles', arg), explicit: true }
    throw new Error(`profile 名不合法：${JSON.stringify(arg)}`)
  }
  if (envProfile) {
    // DSH_PROFILE 既接受绝对/相对**路径**，也接受内置 **profile 名**（DSH 在会话 shell 里
    // 就把它设成 "desktop" 这样的裸名字，并另设 DSH_PROFILE_DIR 给出绝对目录）。
    // 裸名字必须映射成 profile 目录，否则会被当成相对路径、解析成 <cwd>/desktop 这种不存在的落点。
    if (PROFILE_NAMES.includes(envProfile)) return { name: envProfile, dir: dirs[envProfile], explicit: true }
    const abs = resolve(envProfile)
    const name = abs === resolve(dirs.desktop) ? 'desktop' : abs === resolve(dirs.web) ? 'web' : basename(abs)
    return { name, dir: envProfile, explicit: true }
  }
  // DSH_PROFILE_DIR：DSH 自己发布的当前 profile 绝对目录（比裸名更准）
  const envDir = process.env.DSH_PROFILE_DIR
  if (envDir) {
    const abs = resolve(envDir)
    const name = abs === resolve(dirs.desktop) ? 'desktop' : abs === resolve(dirs.web) ? 'web' : basename(abs)
    return { name, dir: envDir, explicit: true }
  }

  const hasWeb = existsSync(dirs.web)
  const hasDesktop = existsSync(dirs.desktop)
  if (hasDesktop && !hasWeb) return { name: 'desktop', dir: dirs.desktop, explicit: false }
  if (hasWeb && !hasDesktop) return { name: 'web', dir: dirs.web, explicit: false }
  if (hasWeb && hasDesktop) {
    throw new Error(
      '同时存在 web 与 desktop 两个 profile，必须显式指定装到哪个：\n' +
      `  node scripts/install.mjs web        # 命令行版（${dirs.web}）\n` +
      `  node scripts/install.mjs desktop    # 桌面版（${dirs.desktop}）\n` +
      '  （DSH_PROFILE=<profile 路径> 也可指定非默认 profile）'
    )
  }
  throw new Error(
    `找不到任何 dsh profile（web: ${dirs.web}，desktop: ${dirs.desktop}）。\n` +
    '  桌面版请先启动一次 DeepSeek Harness 桌面应用（它会创建 profile），再重跑本脚本；\n' +
    '  命令行版请先跑一次 `npx @deepseek-ai/dsh web`；\n' +
    '  或用 DSH_PROFILE=<profile 路径> 显式指定。'
  )
}

/**
 * 读 asar 归档头，判断打包内部路径是否存在。
 *
 * app.asar 是单文件归档：**普通 Node 进程里 `existsSync('...app.asar/dsh')` 恒为 false**
 * （只有 Electron 打过 asar 补丁的 fs 才能穿透，本项目实测正是如此——这是首版探测
 * 直接失效的原因）。asar 头是「16 字节 pickle + JSON 目录树」，自己解析即可，
 * 零依赖、只读一次文件头。
 *
 * @param asarPath app.asar 路径
 * @param innerPath 归档内路径（以 / 分隔，如 'dsh/node_modules/@deepseek-ai/dsh'）
 * @returns 该路径在归档里是否存在（文件或目录）
 */
export function asarEntryExists(asarPath, innerPath) {
  let fd
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, 16, 0) !== 16) return false
    const jsonLength = head.readUInt32LE(12)
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) return false
    const jsonBuf = Buffer.alloc(jsonLength)
    if (readSync(fd, jsonBuf, 0, jsonLength, 16) !== jsonLength) return false
    let node = JSON.parse(jsonBuf.toString('utf8'))
    for (const seg of innerPath.split('/').filter(Boolean)) {
      if (!node || typeof node !== 'object' || !node.files || !node.files[seg]) return false
      node = node.files[seg]
    }
    return true
  } catch (e) {
    return false
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch (e) { /* 已关闭 */ }
    }
  }
}

/**
 * 定位桌面版（Electron）应用资源目录。
 *
 * 桌面版不自带独立的 node 运行时：它的 CLI / Host 都跑在
 * `<安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\`，
 * 用 `ELECTRON_RUN_AS_NODE=1` + 应用 exe 启动（等价于官方 `dsh` 命令）。
 * 这里从若干锚点向上找 `app.asar\dsh`：优先本仓库所在路径（仓库常紧邻应用放置），
 * 其次常见安装位置，最后是显式环境变量。app.asar 内部的存在性走 asarEntryExists。
 *
 * @returns {{ resources, appAsar, runtimeDir, exe, cliEntry, pnpmEntry, binDir } | null}
 */
export function findDesktopInstall() {
  const candidates = []
  const push = (p) => { if (p) candidates.push(resolve(p)) }

  // 1) 调用方显式指定优先
  push(process.env.DSH_DESKTOP_RESOURCES)
  push(process.env.DSH_DESKTOP_ROOT && join(process.env.DSH_DESKTOP_ROOT, 'resources'))
  // 2) 安装脚本所在路径向上 8 层（仓库常放在应用安装目录旁边或其中）
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  for (let dir = scriptDir, i = 0; i < 8 && dir && dir !== dirname(dir); i++, dir = dirname(dir)) {
    push(join(dir, 'resources'))
  }
  // 3) 常见安装位置
  if (process.platform === 'win32') {
    // 逐个固定盘符尝试（应用可装在任意盘的 Program Files，如 D:\Program Files\...）；
    // 不枚举目录树，只拼固定候选路径，代价是几次 stat。
    const localPrograms = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources')
    push(localPrograms)
    push(join(process.env.ProgramFiles || 'C:\\Program Files', 'DeepSeek Harness', 'resources'))
    push(join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'DeepSeek Harness', 'resources'))
    for (const letter of 'CDEFGH') {
      push(join(`${letter}:\\`, 'Program Files', 'DeepSeek Harness', 'resources'))
      push(join(`${letter}:\\`, 'Program Files (x86)', 'DeepSeek Harness', 'resources'))
    }
  } else if (process.platform === 'darwin') {
    push('/Applications/DeepSeek Harness.app/Contents/Resources')
  }

  for (const resources of candidates) {
    const appAsar = join(resources, 'app.asar')
    if (!existsSync(appAsar)) continue
    // 归档内部路径无法用 existsSync 探（见 asarEntryExists 注释）
    if (!asarEntryExists(appAsar, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')) continue
    if (!asarEntryExists(appAsar, 'dsh/node_modules/@deepseek-ai/dsh/package.json')) continue
    const root = dirname(resources)
    const exe = process.platform === 'win32'
      ? join(root, 'DeepSeek Harness.exe')
      : process.platform === 'darwin'
        ? join(root, 'MacOS', 'DeepSeek Harness')
        : join(root, 'deepseek-harness')
    if (!existsSync(exe)) continue
    return {
      resources,
      appAsar,
      runtimeDir: join(appAsar, 'dsh'),
      exe,
      cliEntry: join(appAsar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
      pnpmEntry: join(resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
      binDir: join(resources, 'runtime', 'bin'),
    }
  }
  return null
}

/**
 * 可复制给用户的桌面版 `dsh` 命令（PowerShell），失败时作为兜底提示。
 * @param install findDesktopInstall() 的返回值
 * @param pnpmArgs 转发给 pnpm 的参数（如 ['add', 'D:\\repo']）
 */
export function desktopCliCommand(install, pnpmArgs) {
  const quoted = pnpmArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  return `& "${install.exe}" --expose-internals "${install.cliEntry}" plugin --profile desktop ${quoted}`
}

/** 去掉注释行与空行（结构化检测的预处理） */
export const stripComment = (s) => s.split('\n').filter((l) => {
  const t = l.trim()
  return t !== '' && !t.startsWith('#')
}).join('\n')

// 组合包检测（pnpm / `dsh plugin add`）：profile/package.json 的
// dependencies / dsh.profile.bundles 里有本包记录；解析失败按未安装处理
export function isBundledInstalled(pkgJsonPath, pkgName) {
  if (!existsSync(pkgJsonPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const deps = pkg.dependencies || {}
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
    return Object.prototype.hasOwnProperty.call(deps, pkgName) || bundles.includes(pkgName)
  } catch { return false }
}
