# 使用说明

## 仓库发现与面板布局

- **自动跟随当前工作空间**：面板经 Slot 标准 props（`useSessions` / `useWorkspaces`）
  推导「当前会话 → 所属工作空间 → 路径」（回退 `recentWorkspaceId`），切换工作空间/
  会话时自动重新扫描；标题栏显示「跟随: \<工作空间名\>」。
- 点击文件夹图标（`workspaces.pickDirectory`）手动选择扫描根后进入手动模式（不再自动
  跟随），标题栏出现「跟随工作空间」按钮一键恢复；刷新图标始终重扫当前根。
- 扫描根默认跟随当前工作空间路径（面板主动携带 root 调用，Host 不再回退
  `sandboxPolicy.workspaceRoot`——在 dsh web 部署里那可能是无意义的进程启动目录）；
  BFS 递归发现嵌套 Git 仓库（含 worktree 的 `.git` 文件形态）；跳过 `node_modules`/
  `dist`/`build` 等重目录；上限：深度 10 / 2000 目录 / 50 仓库（文件形态下可经组合行
  config 的 `scanMaxDepth`/`scanMaxDirs`/`scanMaxRepos` 覆盖，见[安装详解](install.md)）。
- **扫描结果两级缓存**：扫描结果按根目录缓存在内存中，并持久化到
  `$DSH_HOME/git-panel/scan-cache.json`（上限 50 个根、7 天过期）。切换项目再切回、
  或重启 dsh web 后首次打开，直接秒回缓存列表；命中时会并行校验每个仓库的 `.git`
  是否仍存在（过滤已删除的仓库），并在后台静默重扫一次自我修正（新克隆的仓库在
  下次切换/扫描时出现）。标题栏的刷新图标始终绕过缓存全量重扫，是兜底刷新手段。
- 每个仓库一张可折叠卡片：仓库名、当前分支、staged/unstaged/untracked 彩色圆点计数、
  ↓↑ 落后/领先，以及刷新、Pull、分支、⋯ 更多按钮。
- **面板宽度可拖拽调整**：拖动左缘实时改宽（380px ~ 96vw），宽度记忆在 localStorage
  （`gp-panel-w`）。
- **中英双语**：跟随 DSH 语言设置（`locale` 服务 + `locale/change` 事件），Host 文案
  经 `setLocale` RPC 同步切换。
- 所有图标为扁平 SVG 线性图标（stroke + currentColor，类 VS Code codicon），无 emoji。

## 文件变更列表（VS Code Source Control 风格）

- 分组 Staged Changes / Changes / Untracked Changes（大写小标题 + 计数 pill）；每行
  左侧彩色状态圆点 + 文件名（basename，悬停 title 显示完整路径）+ 目录 + 重命名来源 +
  右侧状态字母徽标（M/A/D/R/U/C/T 着色）。
- **暂存即选择（无 checkbox）**：文件行悬停出现 ＋（暂存）；Staged 组悬停出现 －
  （取消暂存）；分组标题悬停可批量操作整组。
- 所有下拉菜单（分支/更多/规则）带全局透明遮罩，点击面板外任意区域自动关闭。
- 点击文件名从面板左缘滑出浮层 diff 抽屉（覆盖在聊天区上方，文件列表保持可见，点别的
  文件直接切换）：双列旧/新行号、整行柔和红绿底色、sticky @@ 分段头、文件头带状态
  徽标与 +增/−删 统计；支持自动换行开关、左缘拖拽调宽（`gp-diff-w`）、Esc / 点遮罩关闭。
  untracked 文件渲染为全新增（≤4000 行），untracked 目录渲染为两层目录树（≤200 条）。

## 顶部提交区（仅处理已暂存文件）

```
┌──────────────────────────────────────────────────────────┐
│  提交信息输入框（自动撑高 2–6 行，Ctrl+Enter 提交）        │
│  [✦ 生成] [⚙ 规则▾]                      已暂存 N 个文件  │
│  [✓ 提交            ] [↑ 提交并推送            ]          │
└──────────────────────────────────────────────────────────┘
```

- **生成 / 提交 / 提交并推送都只处理 Staged 文件**：Host 端 `commit` 不隐式
  `git add`/`git reset`，只提交当前 index（部分提交用 pathspec 限定）；提交信息经
  stdin（`commit -F -`）传入，规避 Windows 命令行长度与特殊字符问题。
- **✦ 生成**：实时读当前生效规则 + 已暂存文件的 staged diff（总长 ≤120KB 截断）注入
  LLM（`llm.stream`；模型优先取面板配置的生成模型，缺省取 `agentDefaultModel.currentSelection()`，
  再回退第一个 provider/model；maxTokens 8000 / temperature 0.2），结果**只填入不提交**；
  失败保留原内容并 toast 报错；生成中显示 spinner。
- **⚙ 规则 ▾**：编辑全局规则 / 为当前仓库单独设置 / 重置全局默认 / 重置仓库专属 /
  复制生效规则到剪贴板（Host 经 `clip` 写入）/ 显示当前生效来源（仓库专属 > 全局 >
  内置默认）。
- **提交 / 提交并推送**：整行按钮组，禁用态覆盖所有边界（消息为空、无暂存文件、任一
  操作进行中）。提交并推送 = 提交成功后自动追加 push；push 失败 toast 错误并保留 commit。

## 提交规则系统

- 存储：`$DSH_HOME/git-rules/default.yaml`（全局）+ `{repo-name}.yaml`（仓库专属，
  覆盖全局）；首次扫描自动创建默认文件。`$DSH_HOME` 定位顺序：
  `settings.prepareDocument()` 返回路径推导 → `%USERPROFILE%\.dsh` 探测 → workspace
  根 `.git-panel/rules` 兜底。
- 每次点击 ✦ 生成**实时读盘**，规则修改下次生成立即生效，无需重启。
- 编辑器弹窗：左 = `system_prompt` / `user_context` 双独立编辑框（键名固定展示不可编辑，
  从根上避免误删 YAML 键），右 = 实时预览（占位符 `{repo_name}`/`{branch}`/`{file_list}`/
  `{staged_diff}` 已替换），底部 = 保存 / 取消 / 恢复默认 +「仓库专属」开关。
- 内置默认规则内置于 `src/host.js`（**中英两版，跟随面板语言**）：Conventional Commits
  标题（type 白名单、scope 小写可省略、摘要动词开头 ≤50 字不加句号）、正文为要点式逻辑
  变更清单（每行强制 "- " 前缀、一条一个改动点、保留参数/阈值等关键细节，3~8 条，
  极简变更可只有标题；提示词内置 few-shot 格式示例防格式漂移）、footer 仅必要时输出、
  消息语言跟随面板语言（除非代码库本身是其他语言）、只输出纯文本 commit message
  （无解释、无任何 Markdown 标记，标识符/路径裸写不加反引号）等；未编辑过的旧版默认
  文件会随内置规则升级自动重写。
- **语言切换语义**：已创建的全局 `default.yaml` 仅当内容仍是未经修改的内置版本（中或
  英）时才随语言切换重写为当前语言版；**用户编辑过的规则文件（全局/仓库专属）绝不因
  语言切换被覆盖**；需要另一语言的默认版可用「重置全局默认」。仓库专属规则不受语言
  影响。

## Git 历史（每卡片可折叠）

- 「历史」默认折叠；展开后为 SVG 图谱 + 无限滚动列表：Host 端 `git log --all
  --topo-order` 分页（每页 200 条，`--skip`/`-n`，滚动到底部前 800px 预取下一页），
  Client 端自行计算 lane 布局（≤8 条 lane 循环配色、合并/分支线为圆角肘形曲线、HEAD
  节点外加光环、其余 lane 降透明度），面板高度 470px、行高 26px、字号 13。
- **悬停浮层**（VS Code hover 风格）显示提交详情：subject / author / email / date /
  完整 message / diff stat，结果按 hash 缓存；离开行或浮层后延迟关闭，滚动立即关闭。

## 其他操作

- Pull = `git fetch --all --prune` + `git merge --no-edit @{u}`（无上游则只 fetch）。
- 切换分支：下拉列表（含当前标记/上游）+ 新建分支（创建并切换，分支名校验）。
- ⋯ 更多：推送、Stash push / pop（列表展示已有 stash）、Reset `--soft|--hard HEAD~1`、
  Clean untracked。

## 审计日志

- **无审批门**：写操作（commit/pull/push/switch/stash/reset/clean/discard）由面板用户
  显式点击触发后直接执行（类似 VS Code），无额外放行条件、不弹确认窗。
- 写操作与其结果（ok/fail）写入 `$DSH_HOME/git-logs/git-YYYY-MM-DD.log`
  （`[ISO时间] key=value` 格式；写入经 promise 链串行化防并发丢行；条目含 scan /
  diff / generate / rules-save / rules-reset / ok:git.* / fail:git.* 等）。
- 高频只读轮询（status/log）**不写审计**，避免日志噪声淹没写操作记录；`$DSH_HOME`
  无法定位时打印一次告警后跳过审计，不影响功能。
