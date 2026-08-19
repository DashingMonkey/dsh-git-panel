/**
 * install.mjs / uninstall.mjs 的共享工具：profile 定位、YAML 预处理、
 * 本插件注册条目的结构化匹配与组合包检测。装机与卸机两侧必须保持同一
 * 口径（单边漂移会导致漏删或误判已注册），因此收敛在此处。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 结构化匹配：仅命中本插件写入的 id/name 字段行，避免其它插件的
// 注释/配置中恰好含 "git-panel" 字样时被误判/误删。
// m 标志兼容整文件与单行两种 test 用法（单行时 ^$ 锚点行为不变）。
export const RE_ENTRY_ID = /^\s*-\s*id:\s*git-panel\s*$/m
export const RE_PKG_NAME = /^\s*name:\s*['"]?@dsh-local\/git-panel['"]?\s*$/m

export function profileDir() {
  if (process.env.DSH_PROFILE) return process.env.DSH_PROFILE
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

// 去掉注释行与空行（结构化检测的预处理）
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
