# 安装详解

前置要求：目标机器可运行 `npx @deepseek-ai/dsh web`；`git` 在 PATH 中；建议 Windows（两处 Windows 专用探测在非 Windows 上自动降级，不影响核心功能）。

构建产物 `lib/` 由 `scripts/build.mjs` 从 `src/` 生成：
`lib/index.js`（Host 半体，声明 `inject: ['fs','subprocess','connection']`）与
`lib/client.js`（浏览器 ModuleLoader bundle，声明 `inject: ['slots','connection']`）。
Host↔Client 经 `ctx.connection.rpc` 通道（`/git-panel`）通信。

包声明了 `dsh.bundle.patch`（组合包），因此同时支持官方 `dsh plugin` 机制与
无 pnpm 环境的复制式安装，按你的环境任选其一。

## 方式一：`dsh plugin`（官方机制，推荐；需要 pnpm 在 PATH）

> 命令以 `npx @deepseek-ai/dsh` 形式给出（与官方主页一致，无需全局安装 dsh）；
> 已全局安装的可用 `dsh` 替代。

```sh
# 本地目录安装（先构建产物：pnpm 对本地目录是 link，不会自动跑 prepare）
npm run build
npx @deepseek-ai/dsh plugin --profile web add .

# 或 git 仓库安装（pnpm ≥10 会运行 prepare 自动构建；首次需在 profile 的
# pnpm-workspace.yaml 里放行 allowBuilds 后重试，见官方文档）
npx @deepseek-ai/dsh plugin --profile web add github:DashingMonkey/dsh-git-panel

# 或 tarball 安装（pnpm pack 打包后无需任何构建授权）
pnpm pack
npx @deepseek-ai/dsh plugin --profile web add ./dsh-local-git-panel-1.0.0.tgz
```

`dsh plugin` 会把包加进 profile 的依赖并追加到 `dsh.profile.bundles`，其
`cordis.patch.yml` 插件行随组合层自动生效——无需手动改 profile 配置。
卸载：`npx @deepseek-ai/dsh plugin --profile web remove @dsh-local/git-panel`。

> ⚠ 用本方式安装后**不要**用 `./uninstall.sh` 卸载——它只清理复制式安装的落点
> （node_modules 目录 + profile/cordis.patch.yml），pnpm 的依赖与 bundles 记录
> 还在，重启后插件会重新加载；`uninstall.mjs` 会检测到该情况并提示正确命令。

## 方式二：一键脚本（无 pnpm 兜底，复制式）

```sh
./install.sh                    # Windows 请用 Git Bash 或 WSL；macOS/Linux 直接跑
./uninstall.sh                  # 卸载
# 等价于 node scripts/install.mjs / node scripts/uninstall.mjs（逻辑同一份，跨平台）
```

`DSH_PROFILE=/path/to/profile ./install.sh` 可指定非默认 profile。

## 方式三：手动安装（理解机制）

1. 构建：`npm run build`；
2. 复制包到 profile 的 node_modules：
   `robocopy lib "%USERPROFILE%\.dsh\profiles\web\node_modules\@dsh-local\git-panel\lib" /E`
   （并把 `package.json`、`cordis.patch.yml` 一并复制进该目录）；
3. 在 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` 追加（若文件为空/`[]` 则整体替换）：

   ```yaml
   - insert:
       - id: git-panel
         name: '@dsh-local/git-panel'
         config:
           scanMaxDepth: 10
           scanMaxDirs: 2000
           scanMaxRepos: 50
   ```

4. 重启 `npx @deepseek-ai/dsh web`。侧栏底部出现 Git Panel 按钮。

> **注意 1**：`cordis.patch.yml` 的 `scanMaxDepth` / `scanMaxDirs` / `scanMaxRepos`
> 经 `apply(ctx, config)` 第二参传入，默认深度 10 / 2000 目录 / 50 仓库。
>
> **注意 2**：文件态装载依赖 `inject` 等待 `fs`/`subprocess`/`connection` 就绪；
> 不要移除 `lib/index.js` 的 `inject` 声明（否则 loader 可能在服务就绪前执行 apply，
> 插件会降级为空——启动日志出现 `fs/subprocess 服务不可用`）。

## 迁移到另一台机器

- 前置：目标机器可运行 `npx @deepseek-ai/dsh web`；`git` 在 PATH 中；建议 Windows（两处专用探测会自动降级，不影响核心功能）。
- 迁移 = 拷贝本目录，在目标机器执行 `node scripts/install.mjs`（自带构建；或
  `./install.sh`），重启 `npx @deepseek-ai/dsh web`（见上文各安装方式）。
- 可选数据：`$DSH_HOME/git-panel/rules/`（提交规则，缺失会自动重建默认）；`$DSH_HOME/
  git-panel/git-repos.json`（每仓库规则来源偏好，路径 keyed，换机器后需按新路径重建）；
  `$DSH_HOME/git-panel/logs/` 仅留档可不迁移。目标机器的 `$DSH_HOME` 由插件自行推导，无硬编码路径。
