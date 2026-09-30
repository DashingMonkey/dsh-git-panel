# 安装详解

前置要求：`git` 在 PATH 中；建议 Windows（两处 Windows 专用探测在非 Windows 上自动降级，不影响核心功能）。
目标环境二选一（或都装，互不影响）：

| 目标 | profile 目录 | 前置条件 |
| --- | --- | --- |
| 命令行版 | `$DSH_HOME/profiles/web` | `npx @deepseek-ai/dsh web` 可运行 |
| 桌面版 | `$DSH_HOME/profiles/desktop` | 已安装 DeepSeek Harness 桌面应用，且**至少启动过一次**（profile 由应用首次启动时创建） |

构建产物 `lib/` 由 `scripts/build.mjs` 从 `src/` 生成：
`lib/index.js`（Host 半体，声明 `inject: ['fs','subprocess','connection','webServer']`）与
`lib/client.js`（浏览器 ModuleLoader bundle，声明 `inject: ['slots','connection','workspaces','uiWorkspace']`；
Client 源码为 `src/client/` 多模块，经 esbuild 打包成单文件，react 由宿主模块表提供）。
Host↔Client 经 `/git-panel` HTTP RPC 通道通信：Host 半体直接占用 `webServer` 的
`/git-panel` 前缀路由（见 `src/host.js` 的 `registerHttpChannel`），浏览器信任围栏与会话
cookie 校验复用 `connection.requestRejection`，Client 侧仍走
`ctx.connection.rpc.call('/git-panel', method, args)`（信封一致，无需适配）。

包声明了 `dsh.bundle.patch`（组合包），因此同时支持官方 `dsh plugin` 机制与
无 pnpm 环境的复制式安装，按你的环境任选其一。

> **构建后要不要重跑安装？取决于落点是链接还是副本**（2026-09-12 审查踩到的坑）：
> - 组合包式（`dsh plugin add .`）登记为 `link:<仓库路径>`，落点是**链接** → 直接指向本仓库，
>   `npm run build` 之后浏览器刷新即生效，**不需要**再跑安装脚本（桌面版同理；必要时重载窗口）；
> - 复制式安装（`install.sh` / 手动 robocopy）的落点是**实体副本** → 每次 `npm run build`
>   之后都必须重跑一次安装脚本，否则 DSH 一直在跑那份旧副本（症状：改了代码"没反应"）。
>
> `scripts/install.mjs` 会自己判定这两种情形并如实报告；若检测到「声明是 `link:`、落点却是
> 实体副本」这种自相矛盾的状态，它会**打印修法后拒绝复制**，不再默默掩盖问题。

## 两个 profile 的安装方式为什么不同

DSH 的 `desktop` 是**保留 profile 名**：`dsh --profile desktop`（启动/导出配置）会被直接拒绝——

```
error: profile "desktop" is managed exclusively by the Electron application
```

插件管理同样受限：普通 `dsh plugin --profile desktop ...` 会被拒绝，只有**桌面应用自带的 CLI**
才带 `manageDesktopProfile` 权限（它额外要求 profile 已由应用初始化、并在操作期间对
`profile/package.json` 加文件锁）。因此：

- **命令行版（web）**：复制式。产物直接复制进 `<profile>/node_modules/@dsh-local/git-panel`，
  并在 `<profile>/cordis.patch.yml` 追加 `- insert:` 插件行——不依赖 pnpm、不需要网络。
- **桌面版（desktop）**：组合包式。profile 的 `node_modules` 与应用自带的 pnpm 状态是一体的
  （`nodeLinker: hoisted`），**不能**靠复制文件绕过：DSH 的运行时解析按「应用安装包 →
  profile 依赖」两级解析插件，且 `package.json` 的 `dsh.profile.bundles` 必须同时登记。
  所以安装脚本改为调用应用自带 CLI：

  ```
  <应用安装目录>\resources\runtime\cli\bin\dsh.cmd  plugin --profile desktop add <本仓库路径>
  ```

  `scripts/install.mjs` 会自动定位应用安装目录（解析 `app.asar` 归档头判断，**不是**靠
  `existsSync('...app.asar/dsh')`——普通 Node 进程穿透不了 asar），并在完成后校验
  `dependencies` 与 `dsh.profile.bundles` 都写入了才报成功。找不到应用时可用
  `DSH_DESKTOP_RESOURCES=<应用的 resources 目录>` 指定。

## 方式一：一键脚本（推荐，复制式 / 桌面式自动分流）

```sh
node scripts/install.mjs desktop    # 桌面版（先完全退出桌面应用）
node scripts/install.mjs web        # 命令行版
node scripts/install.mjs            # 自动探测；两个 profile 都存在时要求显式指定
./install.sh [web|desktop]          # 等价壳脚本（Git Bash / WSL / macOS / Linux）
./uninstall.sh [web|desktop]        # 卸载
```

环境变量：`DSH_HOME`（默认 `~/.dsh`）、`DSH_PROFILE`（profile 名或路径）、
`DSH_PROFILE_DIR`（profile 绝对目录，DSH 会话内会自带）、`DSH_DESKTOP_RESOURCES`（桌面应用
resources 目录）。注意在 DSH 会话的 shell 里 `DSH_PROFILE=desktop` 是**预置值**，命令行参数
优先级高于它——想装命令行版就显式写 `web`。

## 方式二：`dsh plugin`（官方机制，需要 pnpm 在 PATH）

> 命令以 `npx @deepseek-ai/dsh` 形式给出（与官方主页一致，无需全局安装 dsh）；
> 已全局安装的可用 `dsh` 替代。

```sh
# 命令行版：本地目录安装（先构建产物：pnpm 对本地目录是 link，不会自动跑 prepare）
npm run build
npx @deepseek-ai/dsh plugin --profile web add .

# 桌面版：必须用桌面应用自带的 CLI（普通 dsh 会拒绝保留 profile desktop）
# 先完全退出桌面应用，再执行（把 <应用安装目录> 换成实际路径）：
& "<应用安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add .

# 或 git 仓库安装（pnpm ≥10 会运行 prepare 自动构建；首次需在 profile 的
# pnpm-workspace.yaml 里放行 allowBuilds 后重试，见官方文档）
npx @deepseek-ai/dsh plugin --profile web add github:DashingMonkey/dsh-git-panel

# 或 tarball 安装（pnpm pack 打包后无需任何构建授权）
pnpm pack
npx @deepseek-ai/dsh plugin --profile web add ./dsh-local-git-panel-1.0.0.tgz
```

`dsh plugin` 会把包加进 profile 的依赖并追加到 `dsh.profile.bundles`，其
`cordis.patch.yml` 插件行随组合层自动生效——无需手动改 profile 配置。
卸载：`... plugin --profile <web|desktop> remove @dsh-local/git-panel`。

> ⚠ 用本方式安装后**不要**用 `./uninstall.sh` 卸载——它只清理复制式安装的落点
> （node_modules 目录 + profile/cordis.patch.yml），pnpm 的依赖与 bundles 记录
> 还在，重启后插件会重新加载；`uninstall.mjs` 会检测到该情况并提示正确命令
> （桌面版则直接代你调用应用自带 CLI 撤销登记）。

## 方式二之补：桌面版图形入口（侧栏 Plugins 页）

桌面版自带插件管理页（侧栏 **Plugins**，内部经 `pluginManager` Remote 调 Host 自带 pnpm），
「Add plugin」接受包名（可带版本）、Git 地址、tarball 或**本地绝对路径**——填本仓库路径即可
安装/卸载，不需要终端。它与 `dsh plugin` 走同一套组合包机制，因此限制也相同：装完需要
重启应用（或按应用提示重载窗口），且 profile 由应用独占管理、不能用复制式绕过。

## 方式三：手动安装（理解机制）

### 命令行版（复制式）

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

### 桌面版（组合包式）

1. 先启动一次桌面应用，再**完全退出**（含托盘）——profile 由应用首次启动时创建；
2. 执行应用自带 CLI（`<应用安装目录>` 换成实际路径，注意 `resources\runtime\cli\bin\dsh.cmd`
   是官方随应用安装的命令包装）：

   ```powershell
   & "<应用安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本仓库绝对路径>"
   ```

   等价写法（不依赖该 shim 是否存在）：

   ```powershell
   $env:ELECTRON_RUN_AS_NODE = "1"
   & "<应用安装目录>\DeepSeek Harness.exe" --expose-internals `
     "<应用安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
     plugin --profile desktop add "<本仓库绝对路径>"
   ```

3. 校验：`%USERPROFILE%\.dsh\profiles\desktop\package.json` 应同时出现
   `dependencies["@dsh-local/git-panel"] = "link:..."` 与
   `dsh.profile.bundles` 里的 `@dsh-local/git-panel`；
   `node_modules\@dsh-local\git-panel` 是指向本仓库的 junction。
4. 重新打开桌面应用。侧栏底部出现 Git Panel 按钮。

> **注意 1**：`cordis.patch.yml` 的 `scanMaxDepth` / `scanMaxDirs` / `scanMaxRepos`
> 经 `apply(ctx, config)` 第二参传入，默认深度 10 / 2000 目录 / 50 仓库。桌面版走组合包登记，
> 这一层的 config 由包内 `cordis.patch.yml` 提供（同样是 10 / 2000 / 50）。
>
> **注意 2**：文件态装载依赖 `inject` 等待 `fs`/`subprocess`/`connection`/`webServer` 就绪；
> 不要移除 `lib/index.js` 的 `inject` 声明（否则 loader 可能在服务就绪前执行 apply，
> 插件会降级为空——启动日志出现 `fs/subprocess 服务不可用`）。

## 验证是否装好

- **命令行版**：`npx @deepseek-ai/dsh web` 的启动日志出现 `[git-panel] Host 已就绪`；
  侧栏底部有 Git Panel 按钮。
- **桌面版**：重新打开应用后侧栏底部有按钮；插件的审计日志也会立刻出现首次扫描记录：
  `%USERPROFILE%\.dsh\profiles\desktop\git-panel\logs\git-<日期>.log`。
  Host 侧日志随 Electron 主进程输出，出问题时看
  `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 下的崩溃报告。
- **两版的数据目录是各自独立的**（`$DSH_HOME` 本身按 profile 解析）：
  命令行版 `~/.dsh/git-panel/`、桌面版 `~/.dsh/profiles/desktop/git-panel/`
  （规则 / 扫描缓存 / 审计日志都在其中）。**排查问题时别只看一个**——实测踩过：
  在 `~/.dsh/git-panel/logs/` 里翻半天没找到日志，其实当天那批操作全在
  `~/.dsh/profiles/desktop/git-panel/logs/git-<日期>.log`，白绕了一圈。
  副作用：两版各自维护一份提交规则与扫描缓存，切换环境不会自动同步（需要就手工拷贝）。

## 迁移到另一台机器

- 前置：目标机器可运行 `npx @deepseek-ai/dsh web` 或已安装桌面应用；`git` 在 PATH 中；
  建议 Windows（两处专用探测会自动降级，不影响核心功能）。
- 迁移 = 拷贝本目录，在目标机器执行 `node scripts/install.mjs web`（或 `desktop`，桌面版需
  先启动过一次应用并完全退出），重启对应环境（见上文各安装方式）。
- 可选数据：`$DSH_HOME/git-panel/rules/`（提交规则，缺失会自动重建默认）；`$DSH_HOME/
  git-panel/git-repos.json`（每仓库规则来源偏好，路径 keyed，换机器后需按新路径重建）；
  `$DSH_HOME/git-panel/logs/` 仅留档可不迁移。目标机器的 `$DSH_HOME` 由插件自行推导，无硬编码路径。
- 两个 profile 的数据目录互不相通（各自在自己的 profile 下 `git-panel/`），迁移时按目标环境取对应那份。
