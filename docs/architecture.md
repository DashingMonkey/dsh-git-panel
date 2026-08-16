# 架构与设计

## 架构与设计约束

插件分 Host / Client 两个半体，经 `ctx.connection.rpc` 通道（`/git-panel`）通信：

- **Host 半体**（`src/host.js`）：git 执行层、仓库发现、规则读写、审计日志、
  LLM 生成、面向 Client 的 JSON RPC；
- **Client 半体**（`src/client.js`）：面板全部 UI（`React.createElement`，无 JSX），
  Slot 注入 + 样式 + zh/en 文案。

针对 DSH Web 环境的设计取舍：

- **UI 注入面是 Slot 系统**（无 `ctx.registerUIComponent()`）：本插件注入
  `sidebar.footer.action`（侧栏底部开关按钮）与 `shell.overlay`（右浮面板 + Toast 栈，
  overlay 层 click-through，面板根节点 `pointer-events: auto` 恢复交互）。
- **无全局 toast 服务** → 自建 Toast 栈（overlay 注册项 + `timer` 服务自动消失）。
- **不经过 JSX 编译** → 纯 JS + `React.createElement`；代码不依赖浏览器全局
  （`document`/`window`/`setTimeout` 等按需探测）→ 剪贴板由 Host 经 `cmd /c clip` 写入，
  定时器优先用 `timer` 服务、缺失时退回原生定时器。
- **进程执行安全**：所有 git 命令参数 100% 数组化绝不拼接 shell；批量文件操作经
  stdin 传 pathspec（`--pathspec-from-file=-`，规避 Windows ~32K 命令行上限，需 git ≥ 2.26）；
  `stdin: 'ignore'` + `GIT_TERMINAL_PROMPT=0` 防交互挂起（无凭据时快速失败）；
  stdout 有界收集 + spill 文件；超时后树级 terminate。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `src/host.js` | Host 半体：git 执行层（参数 100% 数组化、批量 pathspec 走 stdin）、BFS 仓库发现、提交规则读写、审计日志、LLM 生成、面向 Client 的 JSON RPC |
| `src/client.js` | Client 半体：面板全部 UI（`React.createElement`，无 JSX），Slot 注入 + 样式 + zh/en 文案 |
| `src/index.js` | 文件形态 Host 入口（re-export `src/host.js` 默认导出；`./client` 子路径导出 Client 半体） |
| `scripts/build.mjs` | 构建：生成 `lib/index.js`（对象形态 host 入口 + inject）、`lib/client.js`（ModuleLoader bundle） |
| `scripts/install.mjs` / `uninstall.mjs` | 一键安装/卸载到 web profile（跨平台，不依赖 pnpm） |
| `install.sh` / `uninstall.sh` | bash 包装：`exec node scripts/{install,uninstall}.mjs`（Git Bash / WSL / macOS / Linux） |
| `cordis.patch.yml` | 组合包补丁层（`- insert:` 插件行，`dsh.bundle.patch` 引用） |
| `cordis.yml` | 动态 Cordis 包 / `dsh web --patch` 装载示例（文件形态安装请用 `cordis.patch.yml`） |
| `package.json` | 组合包 manifest：`dsh.client`（platform web）+ `dsh.bundle.patch`（见[安装详解](install.md)） |

Client 内主要组件：`GitPanelMain`（主面板/扫描/工作空间跟随/拖拽调宽）、
`RepoCard`（仓库卡片 + 分支/更多菜单）、`CommitArea`（提交区）、`RuleEditorModal`
（规则编辑器）、`GitGraphView`（历史图谱）、`DiffDrawer`（面板左缘滑出的浮层 diff
查看器：双列行号 + 整行底色 + sticky 分段头），以及确认弹窗与
Toast 通知栈。

## 运行时依赖

运行时全部使用 DSH 内置服务，**零新增 npm 依赖**：
Host `subprocess / fs / llm / settings / sandboxPolicy / agentDefaultModel / timer /
connection`（`fs`/`subprocess`/`connection` 为文件态 inject 硬依赖，其余 `ctx.get`
可选读取，缺失时插件降级）；Client `slots / connection / workspaces / locale / timer`
（`slots`/`connection` 为 bundle inject 硬依赖）；主题走 `--dsw-*` CSS 变量。

## 本地开发

```sh
node scripts/install.mjs   # 自动先构建 lib/ 再安装（或 ./install.sh），重启 dsh web 生效
```

源码为「头部注释 + 单个默认导出函数」形态（`src/host.js` / `src/client.js`），该形态
同时是动态 Cordis 包（`cordis.yml`）的取法来源；`scripts/build.mjs` 只做文本级封装，
零第三方依赖。
