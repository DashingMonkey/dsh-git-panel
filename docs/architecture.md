# 架构与设计

## 架构与设计约束

插件分 Host / Client 两个半体，经 `/git-panel` HTTP RPC 通道通信：

- **Host 半体**（`src/host.js`）：git 执行层、仓库发现（BFS + 内存/磁盘两级扫描缓存，
  命中即回、后台静默重扫 self-heal）、规则读写、审计日志、LLM 生成、
  面向 Client 的 JSON RPC；
- **Client 半体**（`src/client/`，多模块；源码不再有单文件 `src/client.js`）：面板全部 UI
  （`React.createElement`，无 JSX），Slot 注入 + 样式 + zh/en 文案。

传输层（`registerHttpChannel`）：Host 半体用 `ctx.effect(() => registerHttpChannel(...))`
直接占用 `webServer` 的 `/git-panel` 前缀路由；浏览器信任围栏与会话 cookie 校验复用
`ctx.get('connection').requestRejection(req)`；请求/响应信封与
`dsh-client-connection` 的 `rpcFetchHandler` 一致
（入 `{type:'client-request', rpcId, method, payload}`，出 `{type:'server-response', rpcId, result}`），
因此 Client 侧 `ctx.connection.rpc.call('/git-panel', method, args)` 无需任何适配。

围栏一律 **fail closed**：`connection` 服务或 `requestRejection` 不可用、以及围栏自身抛错
三种情况都返回 403。DSH 内部 API 变更时若放行，`/git-panel` 会静默变成无鉴权端点。

相对参考实现（`rpcFetchHandler` + `bridge`）的有意差异（都写在 `registerHttpChannel` 头部注释里）：
围栏**先行**于 method / content-type / 端点判断（未认证请求不该从 405/415/404 的差异里推断出端点存在）、
非 POST 答 405（参考实现在 fetch 层答 404）、413 附 `connection: close` 并销毁请求、
入站体积上限 32MB（参考实现默认 300MB，而本通道只收小型 JSON 请求）；
保持一致的是：content-type 必须 `application/json`（否则 415）、body 不是 JSON 答 400、
**信封不合法答 200 + 错误信封**（浏览器端 `rpc.call` 对非 2xx 一律抛传输错误，只有信封才能
把"请求不合法"作为可读错误交回调用方）。

> **不要改回 `connection.rpc.handle('/git-panel', handler)`**：该实现内部是
> `owner.effect(() => owner.webServer.register(route))`，其中的 `owner` 是 cordis 给
> connection 服务实例的 shadow 上下文，其 `fiber` 指向 connection 插件自己的 fiber
> （store 为 `connection/credentials/webRuntime`），而非本插件的 fiber（store 里有
> `webServer`）。在 DSH 0.1.5-alpha.1 的 cordis 上实测：装载期整棵插件树被判
> `failed to load`（报错 `cannot get property "webServer" without inject`），
> **dsh 直接启动失败**（本插件 inject 里加 `webServer` 也无效——被读的不是本插件的上下文）。

针对 DSH Web 环境的设计取舍：

- **UI 注入面是 Slot 系统**（无 `ctx.registerUIComponent()`）：本插件注入
  `sidebar.footer.action`（侧栏底部开关按钮）与 `shell.overlay`（右浮面板 + Toast 栈，
  overlay 层 click-through，面板根节点 `pointer-events: auto` 恢复交互）。
- **无全局 toast 服务** → 自建 Toast 栈（overlay 注册项 + `timer` 服务自动消失）。
- **不经过 JSX 编译** → 纯 JS + `React.createElement`；代码不依赖浏览器全局
  （`document`/`window`/`setTimeout` 等按需探测）→ 剪贴板由 Host 经 `cmd /c clip` 写入，
  定时器优先用 `timer` 服务、缺失时退回原生定时器。
- **进程执行安全**：所有 git 命令参数 100% 数组化绝不拼接 shell；批量文件操作经
  stdin 传 pathspec（`--pathspec-from-file=-`，规避 Windows ~32K 命令行上限，需 git ≥ 2.26；
  例外：`git clean` 至今不支持该选项，放弃未跟踪文件改走普通 argv pathspec 分片）；
  `stdin: 'ignore'` + `GIT_TERMINAL_PROMPT=0` 防交互挂起（无凭据时快速失败）；
  stdout 有界收集 + spill 文件；超时后树级 terminate。

## 双环境适配：Web（命令行）与桌面版

同一份插件同时适配 `dsh web` 与 DeepSeek Harness 桌面版。**宿主侧机制完全同构**，差别只在
profile 与安装路径，因此代码层面零分叉——两者的差异全部收敛在安装脚本里。

| 维度 | 命令行版 web | 桌面版 desktop |
| --- | --- | --- |
| profile 目录 | `$DSH_HOME/profiles/web` | `$DSH_HOME/profiles/desktop`（应用首次启动时创建） |
| DSH 运行时 | npm 安装的 `@deepseek-ai/dsh` | 应用自带 `resources\app.asar\dsh`（版本随应用，独立于命令行版） |
| Client 外壳 | `dsh-web-app` | `dsh-web-app`（**同一个 Web 外壳**，Electron 用 `dsh-app://` 承载并由 Host 注入 cookie） |
| 插件面 | `dsh.client.platform: "web"` + `dsh.bundle.patch` | 同上（DSH 只认 `"web"` 这一个 platform 值，非 web 声明会被静默忽略） |
| 可用服务 | `fs`/`subprocess`/`connection`/`webServer` | 同名服务齐备（`webServer.register({kind:'prefix'})`、`connection.requestRejection` 实测在 0.2.0-rc.2 一致） |
| 数据目录 | `<profile>/git-panel/`（规则/缓存/审计） | 同左，但**位于 desktop profile 下**，与 web 那份互不相通 |
| 安装方式 | 复制式（写 `node_modules` + patch 行） | 组合包式（应用自带 CLI 登记 `link:` 依赖 + `dsh.profile.bundles`） |
| 生效方式 | 重启 `dsh web`（链接落点则刷新即可） | 完全退出应用后重新打开 |

### 为什么桌面版不能走复制式

DSH 把 `desktop` 列为**保留 profile 名**：`dsh --profile desktop` 的启动与配置导出会被直接
拒绝（`profile "desktop" is managed exclusively by the Electron application`），插件管理也只
有带 `manageDesktopProfile` 权限的**桌面应用自带 CLI** 才放行。它额外要求 profile 已由应用
初始化，并在操作期间对 `profile/package.json` 加文件锁。

运行时解析同样是两级的：`resolveBundleDir` 依次用 `[应用安装锚点, <profile>/package.json]`
解析 bundle，profile 的 `node_modules` 由应用自带 pnpm 维护（`nodeLinker: hoisted`）。
绕过 pnpm 直接复制文件会同时丢掉依赖记录与 bundles 登记，loader 根本不会装载它——所以
`install.mjs` 在 desktop 分支改为调用应用自带 CLI：

```
<应用安装目录>\resources\runtime\cli\bin\dsh.cmd  plugin --profile desktop add <本仓库路径>
```

**探测桌面应用安装目录不能靠 `existsSync`**：`app.asar` 是单文件归档，
`existsSync('...app.asar/dsh')` 在普通 Node 进程里恒为 `false`（只有 Electron 打过 asar
补丁的 fs 才能穿透，本项目首版探测就是这么失效的）。`scripts/lib/profile.mjs` 的
`asarEntryExists()` 自行解析归档头（16 字节 pickle + JSON 目录树）判断内部路径存在，
再配合候选路径表（安装脚本向上 8 层 + `%LOCALAPPDATA%\Programs` + 各盘符
`Program Files\DeepSeek Harness\resources` + `DSH_DESKTOP_RESOURCES` 显式指定）定位。

### 残留与清理

- desktop profile 的 patch 层由应用维护，本插件**不往里面写** `- insert:` 行；
  卸载走 `plugin --profile desktop remove`（`uninstall.mjs` 会自动调用）。
- 两个环境共用同一份 `src/`/`lib/`，但**各自独立加载**：改代码后
  `npm run build` 对 `link:` 落点的两个 profile 同时生效（刷新/重启各自生效）。
- 应用侧的兜底恢复：崩溃对话框的「Disable third-party plugins」会把 profile 的
  `cordis.patch.yml` 改名备份并把 `dsh.profile.bundles` 重置回模板（第三方插件全部停用）。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `src/host.js` | Host 半体：git 执行层（参数 100% 数组化、批量 pathspec 走 stdin）、BFS 仓库发现 + 两级扫描缓存（内存 + `$DSH_HOME/git-panel/scan-cache.json`）、提交规则读写 + 每仓库生效来源偏好注册表（`git-repos.json`，权威配置非缓存）、审计日志、LLM 生成、面向 Client 的 JSON RPC |
| `src/client/` | Client 半体：面板全部 UI（`React.createElement`，无 JSX），模块化拆分——`index.js`（装配层：apply(ctx) + Slot 注入 + 样式注入）、`runtime.js`（apply 时注入 ctx/timer 供各模块读取）、`api.js`（RPC 摊平）、`i18n.js`、`store.js`（store/toast/偏好）、`messageDraft.js`（提交信息草稿：按仓库绝对路径记忆，抵抗卡片卸载重挂）、`styles.js`（全部 CSS）、`icons.js`、`lib/`（diff/图谱/rulesYaml 等纯算法）、`hooks/`、`components/`（GitPanelMain、RepoCard 家族含 PushFailModal、DiffDrawer、GitGraphView、各弹窗） |
| `src/index.js` | 文件形态 Host 入口（re-export `src/host.js` 默认导出；`./client` 子路径导出 Client 半体） |
| `scripts/build.mjs` | 构建：生成 `lib/index.js`（对象形态 host 入口 + inject）、`lib/client.js`（esbuild 打包 `src/client/` 为 ModuleLoader bundle，react external） |
| `scripts/lint-client.mjs` | 构建前守卫：ESLint `no-undef`（内存内 Linter），拦截模块内部漏 import/拼错名 |
| `scripts/test-write-result.mjs` / `test-message-draft.mjs` / `test-git-lock-retry.mjs` / `check-client-bundle.mjs` | 行为回归（handleWriteResult 8 场景真值表 / 提交信息草稿 7 场景 + RepoCard·GitPanelMain 接线 AST 断言 / git 锁竞争判据+排程 与 host 内联段同步断言，含真机造锁样本）与产物冒烟（vm 装载 bundle → apply → 卸载），`npm test` |
| `scripts/test-git-lock-e2e.mjs` | 手工核对（不在 `npm test`）：抽出 host.js 真实的 `gitRun`，配忠实实现 `spawnRaw` 契约的桩，让另一个进程真的持 `.git/index.lock` 一段时间——验证生产代码能自愈瞬时锁竞争（而非只是判据正确），且锁不放手时如实失败不吞错 |
| `scripts/mutate-wiring-check.mjs` | 手工核对的变异测试（不在 `npm test` 链路）：把 RepoCard 里 6 处「草稿存活性接线」逐个改坏，要求接线断言如实变红——断言不会失败的测试等于没有。改写了接线或接线断言后跑一次；改坏后的源码只写进系统临时目录（`GP_WIRING_SRC` 指路），**绝不动真源码** |
| `scripts/install.mjs` / `uninstall.mjs` | 一键安装/卸载；按 profile 分流：web 走复制式（不依赖 pnpm），desktop 调用桌面应用自带 CLI 走组合包登记（见下节） |
| `scripts/lib/profile.mjs` | 装机/卸机共享工具：profile 解析（参数 > `DSH_PROFILE`/`DSH_PROFILE_DIR` > 探测）、asar 归档头探测（定位桌面应用安装）、patch 行结构化匹配 |
| `install.sh` / `uninstall.sh` | bash 包装：`exec node scripts/{install,uninstall}.mjs`（Git Bash / WSL / macOS / Linux） |
| `cordis.patch.yml` | 组合包补丁层（`- insert:` 插件行，`dsh.bundle.patch` 引用） |
| `package.json` | 组合包 manifest：`dsh.client`（platform web）+ `dsh.bundle.patch`（见[安装详解](install.md)） |

Client 内主要组件：`GitPanelMain`（主面板/扫描/工作空间跟随/拖拽调宽）、
`RepoCard`（仓库卡片 + 分支/更多菜单）、`CommitArea`（提交区）、`RuleEditorModal`
（规则编辑器）、`GitGraphView`（历史图谱）、`DiffDrawer`（面板左缘滑出的浮层 diff
查看器：双列行号 + 整行底色 + sticky 分段头），以及确认弹窗与
Toast 通知栈。

## 运行时依赖

运行时全部使用 DSH 内置服务，**零新增 npm 依赖**：
Host `subprocess / fs / llm / settings / sandboxPolicy / agentDefaultModel / timer /
connection / webServer`（`fs`/`subprocess`/`connection`/`webServer` 为文件态 inject 硬依赖，
其余 `ctx.get` 可选读取，缺失时插件降级）；Client `slots / connection / workspaces / locale / timer`
（`slots`/`connection` 为 bundle inject 硬依赖）；主题走 `--dsw-*` CSS 变量。

### git 执行层：锁竞争重试与 `GIT_OPTIONAL_LOCKS`

`git commit` 抢不到 `.git/index.lock` 时直接 `exit 128` 失败，原文是
`fatal: Unable to create '…/.git/index.lock': File exists.`（后面还跟着一句容易误导的
「a git process may have crashed… remove the file manually」）。这个竞争**天然是瞬时的**
——2026-09-30 实测本仓库面板：07:25:22 第一次「提交并推送」就栽在它上面，07:26:02 原样
重试即成功（审计日志 `fail:git.commit` → `ok:git.commit`，两次之间**没有任何 git 写操作**）。
所以 `gitRun` 有两层处理：

- **消掉面板自己这一路**：只读命令（目前是 `repoStatus` 里的 `git status`）带
  `readOnly: true` → `GIT_OPTIONAL_LOCKS=0`。`git status` 默认会「顺手刷新并写回 index」
  （纯优化），那就要抢 index.lock；面板每 4s 自动轮询一次 status，正是与提交互撞的来源。
  关掉它输出完全一样。
- **兜住外部竞争**：`gitRun` 在退出码 128 且文案含锁文件名 + `File exists` 时重试两次
  （等 180ms / 500ms，累计 680ms）。判据严格（权限不足、磁盘满同样会带
  `Unable to create` 但不带 `File exists`，**不重试**）。重试等待必须**异步**——曾用
  `Atomics.wait` 做同步等待，把宿主事件循环冻住 680ms，同进程的定时器全被推迟、锁的释放
  反而被自己的等待拖后（端到端测试实测到这一点）。

⚠ 判据与排程在 `src/host.js` 内联了一份、`src/gitRetry.js` 留了一份**参照实现**：
host.js 刻意保持**零 import**（文件态 npm 包把它原样复制出去单独装载，动态 Cordis 包把它的
函数体拼进 `code.host`，两种形态下 import 都要断），所以不能 import 那个模块。
`scripts/test-git-lock-retry.mjs` 会断言两处逐字一致，并断言 host.js 仍然零 import。

### 陷阱：宿主主题的全局 `corner-shape` 会把圆画成「方圆」

`@deepseek-ai/dsh-client-ui-theme` 在支持该属性的浏览器（Chrome ≥139）里注入：

```css
@supports (corner-shape: superellipse(1.5)) {
  :root { --dsw-corner-shape: superellipse(1.5); }
  *, :before, :after { corner-shape: var(--dsw-corner-shape); }
}
```

`superellipse(1.5)` 是宿主的方圆/超椭圆设计语言。后果是**任何 `border-radius: 50%`
都不再是正圆**：12px 的转圈（`.gp-spinner`，见「生成中」存活指示）看上去「不圆」、
15px 的单选点（`.gp-layout-radio`）变成圆角方块，都是这条全局规则造成的。宿主自己的
组件（含官方 spinner）都额外写 `corner-shape: round` 才保住圆形。

约定：面板内**凡是必须是正圆的元素都自己声明 `corner-shape: round`**（类选择器
0,1,0 压过主题的 `*` 0,0,0；不支持该属性的浏览器忽略此声明，`border-radius:50%`
本来就是正圆，两个方向都安全）。该属性不继承，`::after` 这类伪元素必须各自再写一次。
当前三处：`.gp-spinner`、`.gp-layout-radio`、`.gp-layout-radio::after`。其余圆角
（卡片/按钮/pill）沿用宿主设计语言，**不要**整体覆盖成 round。

## 本地开发

```sh
npm run build             # 构建（内含 no-undef 守卫；原子构建：先写 .build-stage 再整体换上 lib/）
npm run lint              # 只跑 no-undef 守卫
npm test                  # pretest 会自动构建 → handleWriteResult 真值表 + 产物冒烟
node scripts/install.mjs web       # 先构建再安装到命令行版 profile（或 desktop）
```

Host 半体源码为「头部注释 + 单个默认导出函数」形态；Client 半体源码为 `src/client/`
多模块 ESM（跨组件引用走 import/export，写错在打包期报错），由 esbuild 打包成单文件
ModuleLoader bundle——对外形态与官方 `dsh-client-ui-*` 插件一致（产物置于 factory 闭包内，
`require("react")` 由宿主模块表解析）。构建期依赖（esbuild/eslint/acorn/react）全部是
devDependencies，运行时依旧零新增依赖。

**构建后要不要重启，取决于 profile 的落点是"链接"还是"副本"**：
`dsh plugin add .` 登记的是 `link:`，落点是指向本仓库的链接 → 构建即生效（web 刷新浏览器、
桌面版重载窗口即可）；复制式安装（`install.sh` / 手动 robocopy）的落点是实体副本 → 每次构建后
都要重跑安装脚本，否则 DSH 一直读那份旧副本（症状：改了代码"没反应"）。
`scripts/install.mjs` 会判定并如实报告，检测到「声明 `link:` 但落点是副本」这种自相矛盾
状态时**打印修法并拒绝复制**。

### Client 模块化：为什么不再用单文件闭包

2026-09 之前 Client 是 `src/client.js`——**3521 行、一个巨型闭包 + 16 个组件函数**，所有 UI
挤在同一作用域。跨组件引用局部函数或 state 时**语法完全合法**、`node --check` 查不出，
只有渲染到那一行才抛 `ReferenceError`，后果是整个 `shell.overlay` slot 崩掉、面板打不开。
四个月内崩了四次，全是同一个病（详见下节）。现已拆成 `src/client/` 多模块：跨组件引用一律走
`import`/`export`，写错在打包期就报错，到不了运行期。

**四次崩溃与成立至今的两条规矩**：

| # | 报错 | 真实成因 |
|---|---|---|
| 1 | `pushDetailOpen is not defined` | `RepoCard` 引用了自己**已删除的 state**，但漏删了传给 `CommitArea` 的 prop |
| 2 | `pushFailText is not defined` | `RepoCard`（弹窗渲染方）调用了定义在 `CommitArea` 里的局部函数 |
| 3 | `applyPushFail is not defined` | 同 2；更糟的是它发生在**撤销成功之后**，于是成功的操作被 catch 成「reset 失败」 |
| 4 | `isPushNoUpstream is not defined` | 反方向：`CommitArea` 调用了定义在 `RepoCard` 里的局部函数，点「提交并推送」直接报「提交失败」（提交其实成功了） |

1. **共用逻辑放独立模块**（如 `api.js` 的 `isPushNoUpstream`、`lib/util.js` 的纯函数），
   别塞进某个组件再从另一个组件引用；
2. **状态只在持有它的那一层写**——以推送失败现场为例：`pushFail` 只在 `RepoCard` 写，
   `CommitArea` 只经 `onPushFail` / `onPushRetryFail` 回调上报；父层给子层的判断依据是
   **只读查询**（`getPushRetryToken` / `isPushRetryStale`），不暴露 ref。
   （已知漂移：`CommitArea` 仍持有父层的 `setMessage`/`setBusy`/`setPushRetrying` 三个 setter，
   属该规矩的例外，改动那一片时留神。）

**构建期守卫为什么是 ESLint 而不是自研**：曾自研 AST 守卫查"跨作用域引用"，先后写错三版、
**两次给出假安全**（v1 正则把任意缩进的 `const` 当成文件级可用 → 漏掉第 3、4 例；
v2 只查"引用了父组件局部"→ 查不到"谁都没定义"；自检脚本本身也错过两次）。结论：
这类检查用现成标准工具。现在 `scripts/lint-client.mjs` 用 ESLint `no-undef` 兜住**模块内部**的
漏 import/拼错名，esbuild 兜住**跨模块**的漏导出（打包期报 "No matching export"）。

### 开发环境已知坑（都踩过）

1. **`dsh web` 重启问题**见上：链接落点不用重启，实体副本落点必须重装；
2. **PowerShell 5.1 读 UTF-8 无 BOM 会变 ANSI 乱码**（脚本里的中文会破坏字符串字面量）：
   写文件用 `[System.IO.File]::WriteAllText(path, s, New-Object System.Text.UTF8Encoding($false))`；
   注意反过来——`Set-Content -Encoding utf8` 在 PS 5.1 会**加 BOM**，而带 BOM 的
   `package.json` 会让 `JSON.parse` 直接失败（本项目安装/构建都按无 BOM 读取）；
3. **`git show > file` 会写成 UTF-16**：取历史版本比对同样要用 .NET 写；
4. **`pwsh` 在这台开发机上不存在**（只有 Windows PowerShell 5.1）；`&&` 不可用；
5. **git 测试钩子必须有 shebang**（`#!/usr/bin/env node`），否则 Windows 上 git 报
   `cannot spawn hooks/pre-receive`——看起来像"拒绝推送"，实际钩子根本没跑；
6. **临时脚本不要放 `%TEMP%` 再 import 仓库依赖**：Node 从文件所在目录解析模块，
   `import 'acorn'` 会 `ERR_MODULE_NOT_FOUND`；放仓库根或用绝对路径；
7. **仓库 `core.autocrlf=true`**：工作区是 CRLF，别被 `git diff` 的"全文件改动"误导；
8. **面板只扫当前会话的工作空间**：测试仓库必须放在工作空间内（`.gp-test/`），
   面板没有手选目录入口。

### Client 产物出口形态（改动前必读）

`factory(require)` 的返回值必须是**裸插件对象** `{ apply, inject }`，不能是 esbuild
`__toCommonJS` 生成的 ESM 命名空间（`{ __esModule: true, default: 工厂函数, ... }`）。
DSH Client 的 cordis 浏览器 loader 用 `unwrapExports()` 判定插件定义，**判别位是 `__esModule`**：

```js
unwrapExports(t) {
  if (t == null) return t
  t = t.default ?? t
  if (!t.__esModule) return t
  return t.default ?? t
}
```

命名空间形态因此一路走到 `t.default ?? t`——`default` 是工厂**函数**而非插件对象，
于是交给 cordis 的定义成了函数：fiber 照常进入 active（启动自检、入口状态全"正常"），
**插件对象的 `apply()` 却永不执行**。症状是侧栏底部按钮消失、面板打不开，且浏览器控制台
一条报错都没有（1.3.0 切换 esbuild 构建后正是这样静默失活的）。因此 `scripts/build.mjs`
在 factory 末尾显式 `index_default()` 取回插件对象并返回裸对象；
`scripts/check-client-bundle.mjs` 有对应反向断言（`__esModule` → `default` → 自有键集合
恰为 `apply,inject`，另有 `Symbol.toStringTag` 的出口面收窄检查），`npm test` 不过
就是产物出口又漂了。

> 注意 `Symbol.toStringTag` 只是**伴随特征**，不是判别位：官方产物
> （如 `dsh-client-ui-sidebar-files`）本身就带 `Symbol.toStringTag: "Module"` 且工作正常。
> 真正会致命的只有 `__esModule`。

