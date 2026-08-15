/**
 * git-panel — Host 半体
 *
 * 职责：git 执行层（数组化参数，绝不拼接 shell）、递归仓库发现、
 * 提交规则读写（$DSH_HOME/git-rules/）、审计日志（$DSH_HOME/git-logs/）、
 * LLM 提交信息生成，以及面向 Client 的 package-private JSON RPC。
 *
 * 依赖的 Host 服务（全部 ctx.get 可选读取）：
 *   subprocess / fs / llm / settings / sandboxPolicy / agentDefaultModel / timer
 *
 * 装载形态：
 *   - 动态 Cordis 包：本文件 `export default function () {` 与结尾 `}` 之间的
 *     函数体即 cordis_define 的 code.host（无 config，扫描上限用默认值）；
 *   - 文件形态（npm 包）：默认导出 Cordis 插件，apply(ctx, config) 的第二参接收
 *     组合行 config（cordis.yml），其中 scanMaxDepth / scanMaxDirs / scanMaxRepos
 *     覆盖扫描上限；Client 半体见 ./client.js（dsh.client 约定）。
 */
export default function () {
  return {
    apply(ctx, cfg) {
      const fs = ctx.get('fs')
      const subprocess = ctx.get('subprocess')
      const llm = ctx.get('llm')
      const settings = ctx.get('settings')
      const sandboxPolicy = ctx.get('sandboxPolicy')
      const defaultModel = ctx.get('agentDefaultModel')
      // timer 服务降级：web profile 通常提供 timer；缺失时退回原生定时器。
      // （动态包沙箱禁用 setTimeout，但动态形态下 timer 必由运行器提供，不会走到这里）
      let timer = ctx.get('timer')
      if (!timer && typeof setTimeout === 'function') {
        timer = { timeout: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) } }
      }

      if (!fs || !subprocess) {
        console.error('[git-panel] fs/subprocess 服务不可用，插件降级为空')
        return
      }

      const repos = new Map()
      let homePromise = null
      // 点前缀目录（.git/.svn/.idea/.venv 等）统一由扫描处的 startsWith('.') 规则跳过，这里只列常规重目录
      const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor', 'venv', '__pycache__', 'bin', 'obj'])

      // 扫描上限：文件形态下由组合行 config（cordis.yml）覆盖；动态包形态无 config，用默认值
      function scanLimit(value, fallback, min, max) {
        const n = Math.floor(Number(value))
        if (!isFinite(n) || n <= 0) return fallback
        return Math.min(max, Math.max(min, n))
      }
      cfg = cfg && typeof cfg === 'object' ? cfg : {}
      const SCAN = {
        maxDepth: scanLimit(cfg.scanMaxDepth, 10, 1, 64),
        maxDirs: scanLimit(cfg.scanMaxDirs, 2000, 1, 200000),
        maxRepos: scanLimit(cfg.scanMaxRepos, 50, 1, 2000)
      }

      // 内置默认规则：中英两版，跟随面板语言（见 builtinRules / ensureDefaultRules）。
      // 用户编辑过的规则文件不因语言切换被覆盖（pristine 检查）；LEGACY_DEFAULT_RULES
      // 收录上一版内置默认，让磁盘上从未编辑过的旧默认文件也能随内置规则升级自动重写。
      const DEFAULT_RULES = {
        zh: {
          system_prompt: '你是一个 Git 提交信息生成器。根据已暂存的变更生成一条提交信息，严格遵循以下规则：\n\n1. 第一行是标题，使用 Conventional Commits 格式：type(scope): 摘要\n   - type 限定为：feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope 用小写英文表示本次变更最核心的模块（如 readme、api、ui），无法确定时省略\n   - 摘要以动词开头，不超过 50 字，结尾不加句号\n2. 标题后空一行，正文为要点列表：\n   - 每一行明细必须以连字符加空格 "- " 开头，这是硬性格式要求\n   - 一条明细对应一个逻辑变更，说明改了什么、为什么改，不要逐文件罗列\n   - 保留关键细节（具体参数、阈值、行为变化等），便于日后追溯\n   - 建议 3~8 条；变更极简单时可省略正文，只保留标题\n3. 禁止使用数字编号、星号、中文顿号或无前缀纯文本作为明细，每条明细前只能是 "- "\n4. footer 仅在必要时输出：不兼容变更标注 BREAKING CHANGE，关联议题用 Closes #编号\n5. 使用中文书写，除非代码库的注释与文档明显是英文\n6. 只描述 diff 中真实存在的变更，不要推测或夸大\n7. 直接输出纯文本提交信息：不要解释、不要任何 Markdown 标记（反引号、星号加粗、下划线、代码围栏都不允许），也不要多余空行；标识符、路径、参数与选项名按原样裸写，不加任何包裹符号\n\n输出示例（仅供格式参考，内容必须基于实际 diff）：\n\nfix(auth): 修复令牌过期后会话未刷新的问题\n\n- 刷新失败时清除本地缓存并引导重新登录，而非静默重试\n- 修复 auth.ts 中 refreshToken 过期判断的边界错误\n- 将令牌提前量从 30 秒提高到 60 秒，避免时钟偏移导致的误判\n- 补充过期场景的单元测试覆盖',
          user_context: '# 当前仓库信息\n仓库名：{repo_name}\n当前分支：{branch}\n\n# 已暂存的文件\n{file_list}\n\n# staged diff\n{staged_diff}\n\n# 任务\n基于以上信息生成一条完整的提交信息：第一行为标题，空一行后正文每行以 "- " 开头。只输出提交信息本身，全文为纯文本，不要使用任何 Markdown 标记。'
        },
        en: {
          system_prompt: 'You are a Git commit message generator. Generate one commit message from the staged changes, following these rules strictly:\n\n1. The first line is the title in Conventional Commits format: type(scope): summary\n   - Allowed types only: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope is lowercase English naming the most central module of the change (e.g. readme, api, ui); omit it when unclear\n   - Summary starts with a verb, no longer than 50 characters, no trailing period\n2. Leave one blank line after the title, then a bulleted body:\n   - Every bullet MUST start with a hyphen followed by a space "- " — this format is mandatory\n   - Each bullet covers one logical change (what and why), not a per-file listing\n   - Keep key details (concrete parameters, thresholds, behavior changes) for future reference\n   - Aim for 3 to 8 bullets; for trivial changes the title alone is enough, skip the body\n3. Never use numbered lists, asterisks, or plain unprefixed lines; each bullet starts with "- " only\n4. Emit a footer only when necessary: BREAKING CHANGE for breaking changes, Closes #issue when related\n5. Write in English, unless the comments and docs of the codebase are clearly in another language\n6. Describe only changes that actually exist in the diff; never speculate or exaggerate\n7. Output the commit message as plain text only: no explanations, no Markdown of any kind (no backticks, bold asterisks, underscores, or code fences), and no extra blank lines; write identifiers, paths, flags and option names bare and verbatim, with no wrapping characters\n\nOutput example (format reference only; content must come from the actual diff):\n\nfix(auth): refresh session when token expires\n\n- Clear local cache and redirect to login on refresh failure instead of silent retry\n- Fix off-by-one in refreshToken expiry check in auth.ts\n- Raise token lead time from 30s to 60s to avoid clock-skew false negatives\n- Add unit test coverage for expiry scenarios',
          user_context: '# Repository info\nRepository: {repo_name}\nBranch: {branch}\n\n# Staged files\n{file_list}\n\n# Staged diff\n{staged_diff}\n\n# Task\nGenerate one complete commit message: title on the first line, then after a blank line a body where every line starts with "- ". Output the commit message only, as plain text with no Markdown formatting.'
        }
      }

      // 历史版本内置默认（原样保留，新→旧排列）：仅用于 ensureDefaultRules 的 pristine
      // 识别，让内置规则升级后未编辑过的旧默认文件自动重写为新版，而非被当成用户文件
      // 永不更新。每次升级默认规则时，把被替换的版本插入数组头部。
      const LEGACY_DEFAULT_RULES = [
        // v3：few-shot 版（禁代码围栏但未禁行内反引号，标识符裸写约束不足）
        {
          zh: {
            system_prompt: '你是一个 Git 提交信息生成器。根据已暂存的变更生成一条提交信息，严格遵循以下规则：\n\n1. 第一行是标题，使用 Conventional Commits 格式：type(scope): 摘要\n   - type 限定为：feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope 用小写英文表示本次变更最核心的模块（如 readme、api、ui），无法确定时省略\n   - 摘要以动词开头，不超过 50 字，结尾不加句号\n2. 标题后空一行，正文为要点列表：\n   - 每一行明细必须以连字符加空格 "- " 开头，这是硬性格式要求\n   - 一条明细对应一个逻辑变更，说明改了什么、为什么改，不要逐文件罗列\n   - 保留关键细节（具体参数、阈值、行为变化等），便于日后追溯\n   - 建议 3~8 条；变更极简单时可省略正文，只保留标题\n3. 禁止使用数字编号、星号、中文顿号或无前缀纯文本作为明细，每条明细前只能是 "- "\n4. footer 仅在必要时输出：不兼容变更标注 BREAKING CHANGE，关联议题用 Closes #编号\n5. 使用中文书写，除非代码库的注释与文档明显是英文\n6. 只描述 diff 中真实存在的变更，不要推测或夸大；代码标识符与路径保持原文\n7. 直接输出提交信息本身：不要解释、不要 Markdown 代码围栏、不要多余空行\n\n输出示例（仅供格式参考，内容必须基于实际 diff）：\n\nfix(auth): 修复令牌过期后会话未刷新的问题\n\n- 刷新失败时清除本地缓存并引导重新登录，而非静默重试\n- 将令牌提前量从 30 秒提高到 60 秒，避免时钟偏移导致的误判\n- 补充过期场景的单元测试覆盖',
            user_context: '# 当前仓库信息\n仓库名：{repo_name}\n当前分支：{branch}\n\n# 已暂存的文件\n{file_list}\n\n# staged diff\n{staged_diff}\n\n# 任务\n基于以上信息生成一条完整的提交信息：第一行为标题，空一行后正文每行以 "- " 开头。只输出提交信息本身。'
          },
          en: {
            system_prompt: 'You are a Git commit message generator. Generate one commit message from the staged changes, following these rules strictly:\n\n1. The first line is the title in Conventional Commits format: type(scope): summary\n   - Allowed types only: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope is lowercase English naming the most central module of the change (e.g. readme, api, ui); omit it when unclear\n   - Summary starts with a verb, no longer than 50 characters, no trailing period\n2. Leave one blank line after the title, then a bulleted body:\n   - Every bullet MUST start with a hyphen followed by a space "- " — this format is mandatory\n   - Each bullet covers one logical change (what and why), not a per-file listing\n   - Keep key details (concrete parameters, thresholds, behavior changes) for future reference\n   - Aim for 3 to 8 bullets; for trivial changes the title alone is enough, skip the body\n3. Never use numbered lists, asterisks, or plain unprefixed lines; each bullet starts with "- " only\n4. Emit a footer only when necessary: BREAKING CHANGE for breaking changes, Closes #issue when related\n5. Write in English, unless the comments and docs of the codebase are clearly in another language\n6. Describe only changes that actually exist in the diff; never speculate or exaggerate; keep code identifiers and paths verbatim\n7. Output the commit message itself only: no explanations, no Markdown code fences, no extra blank lines\n\nOutput example (format reference only; content must come from the actual diff):\n\nfix(auth): refresh session when token expires\n\n- Clear local cache and redirect to login on refresh failure instead of silent retry\n- Raise token lead time from 30s to 60s to avoid clock-skew false negatives\n- Add unit test coverage for expiry scenarios',
            user_context: '# Repository info\nRepository: {repo_name}\nBranch: {branch}\n\n# Staged files\n{file_list}\n\n# Staged diff\n{staged_diff}\n\n# Task\nGenerate one complete commit message: title on the first line, then after a blank line a body where every line starts with "- ". Output the commit message only.'
          }
        },
        // v2：要点列表版（无格式示例）
        {
          zh: {
            system_prompt: '你是一个 Git 提交信息生成器，请根据已暂存的变更生成一条提交信息，严格遵循以下规则：\n\n1. 标题行使用 Conventional Commits 格式：type(scope): 摘要\n   - type 限定为：feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope 用小写英文表示本次变更最核心的模块（如 readme、api、ui），无法确定时省略\n   - 摘要以动词开头，不超过 50 字，结尾不加句号\n2. 标题后空一行，正文用要点列表描述具体变更：\n   - 每条以 "- " 开头，对应一个逻辑变更，说明改了什么、为什么改，不要逐文件罗列\n   - 保留关键细节（具体参数、阈值、行为变化等），便于日后追溯\n   - 建议 3~8 条；变更极简单时可只保留标题行，不写正文\n3. footer 仅在必要时输出：不兼容变更标注 BREAKING CHANGE，关联议题用 Closes #编号\n4. 使用中文书写，除非代码库的注释与文档明显是英文\n5. 只描述 diff 中真实存在的变更，不要推测或夸大；代码标识符与路径保持原文\n6. 直接输出提交信息本身：不要解释、不要 Markdown 代码围栏、不要多余空行',
            user_context: '# 当前仓库信息\n仓库名：{repo_name}\n当前分支：{branch}\n\n# 已暂存的文件\n{file_list}\n\n# staged diff\n{staged_diff}\n\n# 任务\n基于以上信息生成一条完整的提交信息（标题 + 正文，footer 可选），只输出提交信息本身。'
          },
          en: {
            system_prompt: 'You are a Git commit message generator. Generate one commit message from the staged changes, following these rules strictly:\n\n1. Title line in Conventional Commits format: type(scope): summary\n   - Allowed types only: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n   - scope is lowercase English naming the most central module of the change (e.g. readme, api, ui); omit it when unclear\n   - Summary starts with a verb, no longer than 50 characters, no trailing period\n2. Leave one blank line after the title, then describe the changes as bullet points:\n   - Each line starts with "- " and covers one logical change (what and why), not a per-file listing\n   - Keep key details (concrete parameters, thresholds, behavior changes) for future reference\n   - Aim for 3 to 8 bullets; for trivial changes the title alone is enough, skip the body\n3. Emit a footer only when necessary: BREAKING CHANGE for breaking changes, Closes #issue when related\n4. Write in English, unless the comments and docs of the codebase are clearly in another language\n5. Describe only changes that actually exist in the diff; never speculate or exaggerate; keep code identifiers and paths verbatim\n6. Output the commit message itself only: no explanations, no Markdown code fences, no extra blank lines',
            user_context: '# Repository info\nRepository: {repo_name}\nBranch: {branch}\n\n# Staged files\n{file_list}\n\n# Staged diff\n{staged_diff}\n\n# Task\nGenerate one complete commit message (title + body, optional footer) from the information above. Output the commit message only.'
          }
        },
        // v1：初始版
        {
          zh: {
          system_prompt: '你是一个 Git Commit Message 生成助手，请严格遵循以下规则：\n\n1. 使用 Conventional Commits 规范\n2. 输出格式：\n   <type>(<scope>): <subject>\n\n   <body>\n\n   <footer>\n3. 只允许指定的 type：\n   feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n4. subject：\n   - 动词开头\n   - 不超过 50 字\n   - 不加句号\n5. body：\n   - 说明"为什么改"和"改了什么"\n   - 每行 ≤ 72 字\n6. 使用中文（除非代码库本身是英文）\n7. 不要生成多余解释，只输出 commit message\n8. 若变更涉及多个模块，优先选择最核心的 scope',
          user_context: '# 当前仓库信息\n仓库名：{repo_name}\n当前分支：{branch}\n变更文件列表：\n{file_list}\n\n# 当前 staged diff\n{staged_diff}\n\n# 请基于以上信息生成一条符合规则的 commit message。'
        },
        en: {
          system_prompt: 'You are a Git commit message generator. Follow these rules strictly:\n\n1. Use the Conventional Commits specification\n2. Output format:\n   <type>(<scope>): <subject>\n\n   <body>\n\n   <footer>\n3. Allowed types only:\n   feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n4. subject:\n   - Start with a verb\n   - No longer than 50 characters\n   - No trailing period\n5. body:\n   - Explain "why it changed" and "what changed"\n   - Wrap lines at 72 characters\n6. Write in English (unless the codebase itself uses another language)\n7. Output only the commit message, no extra explanation\n8. If the change spans multiple modules, pick the most central scope',
          user_context: '# Repository info\nRepository: {repo_name}\nBranch: {branch}\nChanged files:\n{file_list}\n\n# Staged diff\n{staged_diff}\n\n# Generate a commit message that follows the rules above.'
        }
        }
      ]

      function sanitizeName(name) { return String(name || 'repo').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) }
      // 内部统一返回扁平结构 {ok:true, ...业务字段} / {ok:false, error:<string>}。
      // RPC 出口（registerRpc 的通道包装）统一转成协议信封 {ok:true,value} / {ok:false,error:{code,...}}——
      // dsh-client-connection 的 client 端 zod 会 strip 非标准字段，业务数据必须放 value。
      function ok(data) { return Object.assign({ ok: true }, data === undefined ? {} : data) }
      function fail(error) { return { ok: false, error: String(error) } }
      function toEnvelope(r) {
        if (r && r.ok) {
          const value = {}
          for (const k of Object.keys(r)) if (k !== 'ok') value[k] = r[k]
          return { ok: true, value }
        }
        return { ok: false, error: { code: 'bad-request', message: String((r && r.error) || 'error'), details: { issues: [] } } }
      }

      // 路径拼接：按 base 自身形态选分隔符——POSIX 上反斜杠只是普通文件名字符，
      // 不能像 Windows 那样拼 '\\'（node:path 在 win32 上 '/' 与 '\\' 均可接受）。
      function joinPath(base, ...parts) {
        const sep = base.indexOf('\\') >= 0 ? '\\' : '/'
        let out = base.replace(/[\\/]+$/, '')
        for (const p of parts) out += sep + String(p)
        return out
      }

      // ============ 国际化：跟随面板语言（Client 通过 setLocale RPC 通知） ============
      let currentLocale = 'zh'
      const HTEXTS = {
        zh: {
          errNoRoot: '无法确定 workspace 根目录',
          errBadDir: '无法解析目录: {p}', errNotDir: '不是有效目录: {p}',
          errRepoMissing: '仓库不存在，请重新扫描',
          errNoPath: '缺少 path',
          errNoFilesStage: '缺少要暂存的文件', errNotChanged: '文件不在变更集中: {f}',
          errAdd: 'git add 失败: {e}',
          errNoFilesUnstage: '缺少要取消暂存的文件', errNotStaged: '文件未暂存: {f}',
          errUnstage: '取消暂存失败: {e}',
          errNoFilesDiscard: '缺少要放弃的文件', errDiscard: '放弃更改失败: {e}', discardedN: '已放弃 {n} 个文件的更改',
          errNothingStaged: '没有已暂存的文件，请先点击文件右侧的 + 暂存',
          errCommit: 'git commit 失败: {e}', errNoMessage: '提交信息不能为空',
          errPush: 'push 失败（提交已保留）: {e}', errFetch: 'fetch 失败: {e}', errMerge: 'merge 失败（fetch 已完成）: {e}',
          errBadBranch: '非法分支名', errSwitch: '切换分支失败: {e}',
          errStash: 'stash 失败: {e}', errStashPop: 'stash pop 失败: {e}',
          errReset: 'reset 失败: {e}', errClean: 'clean 失败: {e}',
          errDiff: 'diff 失败: {e}', noDiff: '（无差异）',
          errStatus: '读取状态失败: {e}',
          errNoLlm: '未找到可用的 LLM provider/model', errEmptyGen: '模型未产出内容', errGenAborted: '生成被终止: {m}',
          errGenTruncated: '生成被截断（token 额度不足），请重试',
          errGenMissing: '生成任务不存在或已过期，请重试',
          errGenModelInvalid: '模型配置无效（缺少 provider 或 model）', errNoRulesHome: '无法定位规则/配置目录',
          errTimeout: '进程执行超时（{ms}ms）: {c}', noCommits: '无提交', errGenerateNoFiles: '请先暂存文件（生成基于 staged diff）',
          errBinary: '无法读取文件内容（可能为二进制）',
          errNoYaml: '缺少 yaml', errRules: '规则校验失败: {e}', errNoSys: '缺少 system_prompt 字段', errNoUser: '缺少 user_context 字段',
          errRulesWrite: '写入失败: {p}',
          rulesSaved: '规则已保存到 {p}', rulesReset: '已重置为默认规则',
          copied: '已复制到剪贴板', errCopy: '复制失败: {e}',
          errBranches: '读取分支失败: {e}', errNoBranchName: '缺少分支名',
          errStashList: '读取 stash 失败: {e}', errBadHash: '非法 hash', errBadRef: '非法 stash 引用',
          errCommitDetail: '读取提交失败: {e}', errLog: '读取历史失败: {e}',
          dirLabel: '目录: {p}', truncated: '…（条目过多，已截断）',
          stagedN: '已暂存 {n} 个文件', unstagedN: '已取消暂存 {n} 个文件',
          committedN: '已提交 {n} 个文件', pushed: '推送成功',
          pulled: 'Pull 完成（fetch + merge）',
          switchedCreate: '已创建并切换到 {b}', switched: '已切换到 {b}',
          stashed: '已 stash', stashPopped: 'stash pop 完成',
          resetDone: 'reset --{m} HEAD~1 完成', cleaned: '已清理未跟踪文件'
        },
        en: {
          errNoRoot: 'Cannot determine workspace root directory',
          errBadDir: 'Cannot resolve directory: {p}', errNotDir: 'Not a valid directory: {p}',
          errRepoMissing: 'Repository not found, please rescan',
          errNoPath: 'Missing path',
          errNoFilesStage: 'No files to stage', errNotChanged: 'File is not in the changeset: {f}',
          errAdd: 'git add failed: {e}',
          errNoFilesUnstage: 'No files to unstage', errNotStaged: 'File is not staged: {f}',
          errUnstage: 'Unstage failed: {e}',
          errNoFilesDiscard: 'No files to discard', errDiscard: 'Discard failed: {e}', discardedN: 'Discarded {n} file(s)',
          errNothingStaged: 'No staged files; stage files first with the + on the right',
          errCommit: 'git commit failed: {e}', errNoMessage: 'Commit message cannot be empty',
          errPush: 'push failed (commits kept): {e}', errFetch: 'fetch failed: {e}', errMerge: 'merge failed (fetch already done): {e}',
          errBadBranch: 'Invalid branch name', errSwitch: 'Failed to switch branch: {e}',
          errStash: 'stash failed: {e}', errStashPop: 'stash pop failed: {e}',
          errReset: 'reset failed: {e}', errClean: 'clean failed: {e}',
          errDiff: 'diff failed: {e}', noDiff: '(no differences)',
          errStatus: 'Failed to read status: {e}',
          errNoLlm: 'No LLM provider/model available', errEmptyGen: 'Model produced no output', errGenAborted: 'Generation aborted: {m}',
          errGenTruncated: 'Generation truncated (token budget exhausted), please retry',
          errGenMissing: 'Generation task not found or expired, please retry',
          errGenModelInvalid: 'Invalid model configuration (missing provider or model)', errNoRulesHome: 'Cannot locate rules/config directory',
          errTimeout: 'Process execution timed out ({ms}ms): {c}', noCommits: 'no commits', errGenerateNoFiles: 'Stage files first (generation is based on the staged diff)',
          errBinary: 'Cannot read file content (may be binary)',
          errNoYaml: 'Missing yaml', errRules: 'Rules validation failed: {e}', errNoSys: 'Missing system_prompt field', errNoUser: 'Missing user_context field',
          errRulesWrite: 'Write failed: {p}',
          rulesSaved: 'Rules saved to {p}', rulesReset: 'Reset to default rules',
          copied: 'Copied to clipboard', errCopy: 'Copy failed: {e}',
          errBranches: 'Failed to read branches: {e}', errNoBranchName: 'Missing branch name',
          errStashList: 'Failed to read stash: {e}', errBadHash: 'Invalid hash', errBadRef: 'Invalid stash ref',
          errCommitDetail: 'Failed to read commit: {e}', errLog: 'Failed to read history: {e}',
          dirLabel: 'Directory: {p}', truncated: '…(too many entries, truncated)',
          stagedN: 'Staged {n} file(s)', unstagedN: 'Unstaged {n} file(s)',
          committedN: 'Committed {n} file(s)', pushed: 'Push succeeded',
          pulled: 'Pull complete (fetch + merge)',
          switchedCreate: 'Created and switched to {b}', switched: 'Switched to {b}',
          stashed: 'Changes stashed', stashPopped: 'stash pop complete',
          resetDone: 'reset --{m} HEAD~1 complete', cleaned: 'Untracked files cleaned'
        }
      }
      function tr(key) {
        const t = HTEXTS[currentLocale] || HTEXTS.zh
        return t[key] !== undefined ? t[key] : (HTEXTS.zh[key] !== undefined ? HTEXTS.zh[key] : key)
      }
      function fmt(template, params) {
        let s = template
        for (const k of Object.keys(params || {})) s = s.split('{' + k + '}').join(String(params[k]))
        return s
      }

      // 当前语言的内置默认规则（语言经 setLocale RPC 与 Client 同步）
      function builtinRules() {
        return DEFAULT_RULES[currentLocale] || DEFAULT_RULES.zh
      }

      // ============ 进程执行（git 执行层） ============
      // 所有命令参数数组化；stdin 'ignore' + GIT_TERMINAL_PROMPT=0 防止交互挂起；
      // 输出 collect 模式（有界内存 + spill 文件），超时后树级 terminate。
      function spawnRaw(argv, cwd, opts) {
        return new Promise((resolve, reject) => {
          opts = opts || {}
          let settled = false
          let handle = null
          let disposeTimer = null
          const finish = (v) => { if (!settled) { settled = true; if (disposeTimer) disposeTimer(); resolve(v) } }
          const failP = (e) => { if (!settled) { settled = true; if (disposeTimer) disposeTimer(); if (handle) { try { handle.terminate() } catch (err) {} } reject(e) } }
          try {
            const maxBytes = opts.maxBytes || 4 * 1024 * 1024
            handle = subprocess.spawn({
              argv,
              cwd,
              env: { GIT_TERMINAL_PROMPT: '0' },
              stdio: {
                stdin: opts.stdinData ? { data: opts.stdinData } : 'ignore',
                stdout: { maxBytes, spill: { maxBytes: 64 * 1024 * 1024 } },
                stderr: { maxBytes: 128 * 1024 }
              },
              graceMs: 10000
            })
          } catch (e) { failP(e); return }
          if (timer) disposeTimer = timer.timeout(() => failP(new Error(fmt(tr('errTimeout'), { ms: opts.timeoutMs || 90000, c: argv.join(' ').slice(0, 120) }))), opts.timeoutMs || 90000)
          handle.done.then(async (outcome) => {
            try {
              const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0) : { text: '' }
              const err = handle.collected.stderr ? handle.collected.stderr.readFrom(0) : { text: '' }
              let text = out.text || ''
              if (out.lossy && out.spillPath) {
                try {
                  const target = await fs.resolve(out.spillPath)
                  text = await fs.readText(target)
                } catch (e) { /* 保留截断尾部 */ }
              }
              finish({ code: outcome.exitCode, signal: outcome.signal, text, errText: err.text || '', truncated: !!out.lossy })
            } catch (e) { failP(e) }
          }, failP)
        })
      }

      function gitRun(repoPath, args, opts) {
        return spawnRaw(['git', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat'].concat(args), repoPath, opts)
      }

      // 批量文件参数统一走 --pathspec-from-file=-（NUL 分隔 + stdin），
      // 规避 Windows ~32K 命令行长度上限（与 commit message 走 stdin 同一思路）；
      // 需要 git ≥ 2.26（add/reset/restore/rm/checkout/clean 均支持）。
      // ⚠ git 选项名来自 NUL 字符（ASCII 0），结尾没有 "l"——拼成 null 结尾会被
      // git 报 unknown option、批量操作全部失败。该字符串全文件仅下面常量一处拼写，
      // 使用点一律引用 OPT_PATHSPEC_FILE_NUL，勿内联重写、勿“顺手纠正”；
      // scripts/build.mjs 有构建期守卫，检出错误拼写会直接构建失败。
      const OPT_PATHSPEC_FILE_NUL = '--pathspec-file-nul'
      function gitRunFiles(repoPath, args, files, opts) {
        opts = Object.assign({}, opts, { stdinData: files.join('\u0000') })
        return gitRun(repoPath, args.concat(['--pathspec-from-file=-', OPT_PATHSPEC_FILE_NUL]), opts)
      }

      // commit 的 message 已占 stdin，部分提交的 pathspec 改落 .git 下临时文件
      //（仓库工作区内，fs 写权限可覆盖）；worktree 的 .git 是文件时会失败，回退 argv
      async function writePathspecFile(repo, files) {
        try {
          const p = joinPath(repo.path, '.git', 'git-panel-pathspec')
          await fsWriteText(p, files.join('\u0000'))
          return p
        } catch (e) { return null }
      }

      // ============ 路径 / 审计 ============
      async function dshHome() {
        if (homePromise) return homePromise
        homePromise = (async () => {
          if (settings && typeof settings.prepareDocument === 'function') {
            try {
              const doc = await settings.prepareDocument()
              if (typeof doc === 'string' && doc.length > 0) {
                const i = Math.max(doc.lastIndexOf('\\'), doc.lastIndexOf('/'))
                if (i > 0) return doc.slice(0, i)
              }
            } catch (e) { console.error('[git-panel] prepareDocument 失败', e) }
          }
          // POSIX 兜底：环境变量直取 home（cmd.exe 探测仅适用于 Windows）
          const envHome = process.env.USERPROFILE || process.env.HOME
          if (envHome) return joinPath(envHome, '.dsh')
          try {
            const r = await spawnRaw(['cmd.exe', '/d', '/s', '/c', 'echo %USERPROFILE%'], '.', { timeoutMs: 10000 })
            const line = (r.text || '').split(/\r?\n/)[0].trim()
            if (line && !/%/.test(line)) return joinPath(line, '.dsh')
          } catch (e) { console.error('[git-panel] home 探测失败', e) }
          return null
        })()
        return homePromise
      }

      async function rulesDir() {
        const home = await dshHome()
        if (home) return joinPath(home, 'git-rules')
        const root = (sandboxPolicy && sandboxPolicy.workspaceRoot) || '.'
        return joinPath(root, '.git-panel', 'rules')
      }

      async function fsReadText(path) {
        try {
          const target = await fs.resolve(path)
          return await fs.readText(target)
        } catch (e) { return null }
      }

      async function fsWriteText(path, content) {
        const target = await fs.resolve(path)
        await fs.writeText(target, content)
      }

      // fs 服务带 workspace 写沙箱：面板 RPC 无会话上下文时按部署默认根判定，
      // $DSH_HOME（规则/审计/生成模型配置目录）等常用路径会被拒
      // （file access denied under workspace-write mode）。
      // 先用 fs 写（原子），失败回退 subprocess 直写（subprocess 无写围栏；
      // 参数 100% 数组化、脚本固定字面量，不拼接用户输入）。
      async function writeTextAnywhere(path, content) {
        try { await fsWriteText(path, content); return true } catch (e) { /* fall through */ }
        try {
          const script = "const fs=require('fs');const p=require('path');fs.mkdirSync(p.dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],process.argv[2]);"
          const r = await spawnRaw([process.execPath, '-e', script, path, content], '.', { timeoutMs: 15000 })
          return r.code === 0
        } catch (e) { return false }
      }

      // 审计写入串行化：读全文件+回写是非原子操作，并发操作（如审批门 + git 执行）
      // 同时写会互相覆盖丢行；用 promise 链排队，且失败不影响下一次写入。
      let auditChain = Promise.resolve()
      function audit(entry) {
        auditChain = auditChain.then(() => auditWrite(entry)).catch(() => {})
        return auditChain
      }
      let auditHomeWarned = false
      async function auditWrite(entry) {
        try {
          const home = await dshHome()
          if (!home) {
            // 审计目录无法定位时告警一次（不刷屏），后续静默跳过
            if (!auditHomeWarned) { auditHomeWarned = true; console.error('[git-panel] 无法定位 $DSH_HOME，审计日志停用') }
            return
          }
          const now = new Date().toISOString()
          const day = now.slice(0, 10)
          const parts = []
          for (const key of Object.keys(entry)) parts.push(key + '=' + JSON.stringify(String(entry[key])))
          const line = '[' + now + '] ' + parts.join(' ')
          const path = joinPath(home, 'git-logs', 'git-' + day + '.log')
          // 本地后端（dsh-fs-local）没有 appendText：走下方读改写；writeText 的原子
          // 落盘自带 mkdir(recursive)，缺失父目录会自动创建，无需显式建目录。
          if (typeof fs.appendText === 'function') {
            const target = await fs.resolve(path)
            try { await fs.appendText(target, line + '\n'); return } catch (e) { /* 回退读改写 */ }
          }
          const prev = (await fsReadText(path)) || ''
          await writeTextAnywhere(path, prev + line + '\n')
        } catch (e) { console.error('[git-panel] audit 失败', e) }
      }

      // ============ YAML 迷你编解码（规则文件，schema 固定为两个块标量） ============
      function emitRulesYaml(rules) {
        const indent = (s) => String(s || '').split('\n').map((l) => (l === '' ? '' : '  ' + l)).join('\n')
        return 'system_prompt: |\n' + indent(rules.system_prompt) + '\n\nuser_context: |\n' + indent(rules.user_context) + '\n'
      }

      function parseRulesYaml(text) {
        const out = {}
        const lines = String(text || '').split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(\|[+-]?|\>[+-]?))?\s*(.*)$/.exec(line)
          if (m && m[2] && m[2][0] === '|') {
            const key = m[1]
            const raw = []
            i++
            while (i < lines.length) {
              const l = lines[i]
              if (l.trim() === '') { raw.push(''); i++; continue }
              const mm = /^(\s*)/.exec(l)
              const ind = mm[1].length
              if (ind === 0 && /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l)) break
              raw.push(l)
              i++
            }
            // YAML 块标量：以首条非空行的缩进为块缩进统一剥离，保留内容自身的层级缩进
            let blockInd = 0
            for (const l of raw) { if (l.trim() !== '') { blockInd = /^(\s*)/.exec(l)[1].length; break } }
            const block = raw.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(blockInd, /^(\s*)/.exec(l)[1].length))))
            out[key] = block.join('\n').replace(/\n+$/, '')
          } else if (m) {
            out[m[1]] = m[3]
            i++
          } else { i++ }
        }
        return out
      }

      function validateRules(parsed) {
        if (!parsed || typeof parsed.system_prompt !== 'string' || !parsed.system_prompt.trim()) return tr('errNoSys')
        if (typeof parsed.user_context !== 'string' || !parsed.user_context.trim()) return tr('errNoUser')
        return null
      }

      // ============ 规则读写（每次实时读盘，不缓存） ============
      async function rulesFilePath(repoName, scope) {
        const dir = await rulesDir()
        const file = scope === 'repo' ? sanitizeName(repoName) + '.yaml' : 'default.yaml'
        return joinPath(dir, file)
      }

      async function loadEffectiveRules(repoName) {
        const repoPath = await rulesFilePath(repoName, 'repo')
        const repoTxt = await fsReadText(repoPath)
        if (repoTxt !== null) {
          const parsed = parseRulesYaml(repoTxt)
          if (!validateRules(parsed)) return { source: 'repo', path: repoPath, system_prompt: parsed.system_prompt, user_context: parsed.user_context }
        }
        const defPath = await rulesFilePath(repoName, 'global')
        const defTxt = await fsReadText(defPath)
        if (defTxt !== null) {
          const parsed = parseRulesYaml(defTxt)
          if (!validateRules(parsed)) return { source: 'global', path: defPath, system_prompt: parsed.system_prompt, user_context: parsed.user_context }
        }
        const builtin = builtinRules()
        return { source: 'builtin', path: null, system_prompt: builtin.system_prompt, user_context: builtin.user_context }
      }

      // 确保全局默认规则文件存在；仅当其内容仍是未经修改的内置版本（中或英）时，
      // 才随语言切换重写为当前语言版本——用户编辑过的文件绝不覆盖。
      async function ensureDefaultRules() {
        const defPath = await rulesFilePath('default', 'global')
        const cur = await fsReadText(defPath)
        const want = emitRulesYaml(builtinRules())
        const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim()
        // pristine：内容与任一版内置默认（当前版或 LEGACY 历史版）一致，即视为从未编辑过
        const builtinYamls = []
        for (const set of [DEFAULT_RULES, ...LEGACY_DEFAULT_RULES]) { builtinYamls.push(emitRulesYaml(set.zh), emitRulesYaml(set.en)) }
        const pristine = cur !== null && builtinYamls.some((y) => norm(cur) === norm(y))
        if (cur === null || (pristine && norm(cur) !== norm(want))) {
          try { await writeTextAnywhere(defPath, want) } catch (e) { console.error('[git-panel] 创建默认规则失败', e) }
        }
      }

      // ============ 仓库发现（BFS，跳过重目录，上限防失控） ============
      async function scanRepos(root) {
        repos.clear()
        let rootTarget
        try { rootTarget = await fs.resolve(root) } catch (e) { return fail(fmt(tr('errBadDir'), { p: root })) }
        let info = null
        try { info = await fs.stat(rootTarget) } catch (e) { /* ignore */ }
        if (!info || info.type !== 'directory') return fail(fmt(tr('errNotDir'), { p: root }))
        const found = []
        const queue = [{ target: rootTarget, depth: 0 }]
        let dirCount = 0
        while (queue.length > 0 && dirCount < SCAN.maxDirs && found.length < SCAN.maxRepos) {
          const item = queue.shift()
          dirCount++
          let entries = []
          try { entries = await fs.listDir(item.target) } catch (e) { continue }
          for (const entry of entries) {
            if (entry.name === '.git' && (entry.type === 'directory' || entry.type === 'file')) {
              const p = fs.processPath(item.target)
              found.push({ path: p, name: p.split(/[\\/]/).filter(Boolean).pop() || p })
              continue
            }
            if (entry.type === 'directory' && item.depth < SCAN.maxDepth && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.') && dirCount + queue.length < SCAN.maxDirs) {
              queue.push({ target: entry.target, depth: item.depth + 1 })
            }
          }
        }
        found.sort((a, b) => a.path.localeCompare(b.path))
        const rootNorm = (fs.processPath(rootTarget) || root).replace(/[\\/]+$/, '')
        const seen = new Set()
        for (const r of found) {
          let rel = r.path
          if (r.path === rootNorm) rel = '.'
          else if (r.path.startsWith(rootNorm + '\\') || r.path.startsWith(rootNorm + '/')) rel = r.path.slice(rootNorm.length + 1)
          const id = rel === '.' ? r.name : rel
          if (seen.has(id)) continue
          seen.add(id)
          repos.set(id, { id, name: r.name, path: r.path, rel })
        }
        return ok({ root: rootNorm, count: repos.size, repos: Array.from(repos.values()) })
      }

      // ============ git 状态（porcelain v1 -z） ============
      function parseStatusZ(text) {
        const entries = []
        let i = 0
        while (i < text.length) {
          if (i + 3 > text.length) break
          const x = text[i]
          const y = text[i + 1]
          i += 3
          let path = ''
          while (i < text.length) {
            const c = text[i]
            if (c === '\u0000') { i++; break }
            path += c
            i++
          }
          if (path === '') continue
          let orig = null
          if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
            orig = ''
            while (i < text.length) {
              const c = text[i]
              if (c === '\u0000') { i++; break }
              orig += c
              i++
            }
          }
          entries.push({ x, y, path, orig })
        }
        return entries
      }

      async function repoStatus(repo) {
        // 4 条只读命令互相无依赖，并行执行把状态刷新延迟降到最慢的一条
        const [branchR, headR, statusR, upR] = await Promise.all([
          gitRun(repo.path, ['symbolic-ref', '--short', '-q', 'HEAD'], { maxBytes: 4096, timeoutMs: 30000 }),
          gitRun(repo.path, ['rev-parse', '--short', 'HEAD'], { maxBytes: 4096, timeoutMs: 30000 }),
          gitRun(repo.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { maxBytes: 4 * 1024 * 1024, timeoutMs: 30000 }),
          gitRun(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { maxBytes: 4096, timeoutMs: 30000 })
        ])
        let branch = null
        if (branchR.code === 0) branch = (branchR.text || '').trim()
        if (!branch) branch = headR.code === 0 ? '(detached @' + (headR.text || '').trim() + ')' : '(' + tr('noCommits') + ')'
        const entries = statusR.code === 0 ? parseStatusZ(statusR.text) : []
        const staged = []
        const unstaged = []
        const untracked = []
        for (const e of entries) {
          if (e.x === '?' && e.y === '?') { untracked.push({ path: e.path, x: '?', y: '?', orig: null }); continue }
          if (e.x === '!' && e.y === '!') continue
          if (e.x !== ' ' && e.x !== '?' && e.x !== '!') staged.push({ path: e.path, x: e.x, y: e.y, orig: e.orig })
          if (e.y !== ' ' && e.y !== '?' && e.y !== '!') unstaged.push({ path: e.path, x: e.x, y: e.y, orig: e.orig })
        }
        let upstream = null
        let aheadBehind = null
        if (upR.code === 0 && !/^fatal:/.test(upR.errText)) {
          upstream = (upR.text || '').trim()
          const abR = await gitRun(repo.path, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { maxBytes: 4096, timeoutMs: 30000 })
          if (abR.code === 0) {
            const parts = (abR.text || '').trim().split(/\s+/)
            // --left-right --count 输出 "<左> <右>"：左 = HEAD 独有（领先 ahead），右 = 上游独有（落后 behind）
            if (parts.length === 2) aheadBehind = { ahead: parseInt(parts[0], 10) || 0, behind: parseInt(parts[1], 10) || 0 }
          }
        }
        return ok({ branch, upstream, aheadBehind, staged, unstaged, untracked, statusError: statusR.code === 0 ? null : (statusR.errText || statusR.text).slice(0, 200) })
      }

      // ============ diff（只读） ============
      async function fileDiff(repo, path, group) {
        if (group === 'untracked') {
          const fullPath = repo.path + '/' + path
          let target = null
          try { target = await fs.resolve(fullPath) } catch (e) { /* ignore */ }
          let info = null
          try { info = target ? await fs.stat(target) : null } catch (e) { /* ignore */ }
          if (info && info.type === 'directory') {
            // 未跟踪目录：列出目录树（两层，上限 200 条）
            const lines = []
            lines.push(fmt(tr('dirLabel'), { p: path }))
            lines.push('')
            const queue = [{ target, depth: 0 }]
            let count = 0
            while (queue.length > 0 && count < 200) {
              const item = queue.shift()
              let entries = []
              try { entries = await fs.listDir(item.target) } catch (e) { continue }
              for (const entry of entries) {
                count++
                if (count > 200) { lines.push(tr('truncated')); break }
                const rel = path.replace(/\/+$/, '') + '/' + entry.name
                if (entry.type === 'directory') {
                  lines.push('+' + rel + '/')
                  if (item.depth < 2) queue.push({ target: entry.target, depth: item.depth + 1 })
                } else {
                  lines.push('+' + rel)
                }
              }
              if (count > 200) break
            }
            return ok({ text: lines.join('\n').slice(0, 500 * 1024), kind: 'untracked' })
          }
          const content = await fsReadText(fullPath)
          if (content === null) return ok({ text: tr('errBinary'), kind: 'untracked' })
          const allLines = content.split('\n')
          const capped = allLines.slice(0, 4000).map((l) => '+' + l).join('\n')
          const text = 'diff --git a/' + path + ' b/' + path + '\nnew file mode 100644\n--- /dev/null\n+++ b/' + path + '\n@@ -0,0 +1,' + Math.min(4000, allLines.length) + ' @@\n' + capped
          return ok({ text: text.slice(0, 500 * 1024), kind: 'untracked' })
        }
        const args = group === 'staged' ? ['diff', '--staged', '--', path] : ['diff', '--', path]
        const r = await gitRun(repo.path, args, { maxBytes: 512 * 1024, timeoutMs: 60000 })
        if (r.code !== 0) return fail(fmt(tr('errDiff'), { e: (r.errText || r.text).slice(0, 200) }))
        const text = (r.text || '').trim()
        return ok({ text: text || tr('noDiff'), kind: group })
      }

      // ============ AI 生成提交信息 ============
      // 生成 token 预算：推理模型（reasoning）会先思考再输出正文，正文需要独立额度。
      // 8000 只是上限（正常 commit message 只花几百），并按模型声明的 maxTokens 自动收窄。
      const MAX_GEN_TOKENS = 8000
      // 生成模型配置：$DSH_HOME/git-rules/generate-model.json
      //   {provider, model, reasoningEffort} | null（null = 跟随会话默认）
      // reasoningEffort 取值 off/high/max（adapter 合法值）或 null（跟随默认）；
      // 传非法值会被 adapter 拒绝，host 捕获后回退为不传（跟随默认），绝不报错。
      async function genModelConfigPath() {
        const home = await dshHome()
        return home ? joinPath(home, 'git-rules', 'generate-model.json') : null
      }
      async function loadGenModelConfig() {
        const p = await genModelConfigPath()
        if (!p) return null
        const raw = await fsReadText(p)
        if (!raw) return null
        try {
          const j = JSON.parse(raw)
          if (j && typeof j === 'object' && typeof j.provider === 'string' && j.provider && typeof j.model === 'string' && j.model) {
            const effort = j.reasoningEffort === 'off' || j.reasoningEffort === 'high' || j.reasoningEffort === 'max' ? j.reasoningEffort : null
            return { provider: j.provider, model: j.model, reasoningEffort: effort }
          }
        } catch (e) { /* 损坏配置按未配置处理 */ }
        return null
      }
      async function saveGenModelConfig(cfg) {
        const p = await genModelConfigPath()
        if (!p) return fail(tr('errNoRulesHome'))
        const content = cfg === null ? 'null\n' : JSON.stringify(cfg, null, 2) + '\n'
        const okW = await writeTextAnywhere(p, content)
        if (!okW) return fail(fmt(tr('errRulesWrite'), { p }))
        return ok({ configured: cfg })
      }

      async function modelSelection(ignoreConfig) {
        // 优先级：配置的生成模型 → 会话默认模型 → 首个可用 provider/model
        // ignoreConfig=true 时跳过配置（用于返回「跟随当前会话模型」的真实默认）
        const configured = ignoreConfig ? null : await loadGenModelConfig().catch(() => null)
        let sel = null
        if (configured) sel = { provider: configured.provider, model: configured.model, reasoningEffort: configured.reasoningEffort || null }
        if (!sel && defaultModel && typeof defaultModel.currentSelection === 'function') {
          try {
            const s = defaultModel.currentSelection()
            if (s && s.provider && s.model) sel = { provider: s.provider, model: s.model, reasoningEffort: null }
          } catch (e) { /* ignore */ }
        }
        if (!sel && llm) {
          try {
            const providers = llm.listProviders()
            if (providers && providers.length > 0) {
              const models = await llm.listModels(providers[0].id)
              if (models && models.length > 0) sel = { provider: providers[0].id, model: models[0].id, reasoningEffort: null }
            }
          } catch (e) { /* ignore */ }
        }
        if (!sel) return null
        let maxTokens = null
        try {
          const models = await llm.listModels(sel.provider)
          const m = models && models.find((x) => x.id === sel.model)
          if (m && Number.isSafeInteger(m.maxTokens) && m.maxTokens > 0) maxTokens = m.maxTokens
        } catch (e) { /* ignore */ }
        return { provider: sel.provider, model: sel.model, maxTokens, reasoningEffort: sel.reasoningEffort || null, configured: !!configured }
      }

      // 代码围栏剥离：LLM 常把结果包在 ```...``` 里。流式过程中实时剥前导围栏行，
      // 结束时整体剥离（仅当首尾成对包裹时）。
      function liveCleanFence(raw) {
        if (!raw.startsWith('```')) return raw
        const nl = raw.indexOf('\n')
        if (nl < 0) return ''
        return raw.slice(nl + 1)
      }
      function finalCleanFence(raw) {
        let s = String(raw || '').trim()
        const m = s.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/)
        if (m) s = m[1]
        return s.trim()
      }

      // 生成任务表：generate 立即返回 genId，后台任务累积 chunk，Client 经 generatePoll
      // 增量取回实现流式显示（connection RPC 是请求-响应通道，无法服务端推送）。
      const genTasks = new Map()

      async function prepareGenerate(repo, files) {
        const rules = await loadEffectiveRules(repo.name)
        const status = await repoStatus(repo)
        if (!status.ok) return fail(fmt(tr('errStatus'), { e: status.error }))
        const untrackedSet = new Set(status.untracked.map((f) => f.path))
        const stagedSet = new Set(status.staged.map((f) => f.path))
        // 与写操作同一标准：只接受当前变更集内的文件，防任意路径被当作 diff 目标
        const changedSet = new Set(status.unstaged.map((f) => f.path).concat(Array.from(untrackedSet)).concat(Array.from(stagedSet)))
        for (const f of files) if (!changedSet.has(f)) return fail(fmt(tr('errNotChanged'), { f }))
        // 生成上下文预算：120KB（约 40K tokens）足够覆盖常见多文件改动；
        // 单文件 git diff 的 stdout 上限 64KB（超出会自动 spill 后读全，非硬截断）。
        const DIFF_TOTAL_BUDGET = 120 * 1024
        const DIFF_FILE_MAX = 64 * 1024
        const parts = []
        let total = 0
        let truncatedAny = false
        for (const f of files) {
          if (total >= DIFF_TOTAL_BUDGET) { truncatedAny = true; break }
          let text
          if (untrackedSet.has(f)) text = '# 新文件（未跟踪）: ' + f
          else {
            const r = await gitRun(repo.path, stagedSet.has(f) ? ['diff', '--staged', '--', f] : ['diff', '--', f], { maxBytes: DIFF_FILE_MAX, timeoutMs: 60000 })
            text = (r.text || '').trim() || '# 无差异: ' + f
            if (r.truncated) { text += '\n# ……（该文件 diff 过长，已截断）'; truncatedAny = true }
          }
          // 超出剩余预算时按行截断当前文件，而不是丢掉后续所有文件：
          // 保证每个文件都有代表性子集注入，模型不会只看到文件名列表
          const remain = DIFF_TOTAL_BUDGET - total
          if (text.length > remain) {
            let cut = remain
            while (cut > 0 && text[cut] !== '\n') cut--
            text = cut > 0 ? text.slice(0, cut) : text.slice(0, remain)
            text += '\n# ……（diff 过长，已截断）'
            truncatedAny = true
          }
          total += text.length
          parts.push(text)
        }
        if (truncatedAny) parts.push('# ……（diff 过长，部分内容已截断）')
        const sel = await modelSelection()
        if (!sel) return fail(tr('errNoLlm'))
        const userCtx = (rules.user_context || '')
          .replaceAll('{repo_name}', repo.name)
          .replaceAll('{branch}', status.branch || '(未知)')
          .replaceAll('{file_list}', files.map((f) => '- ' + f).join('\n'))
          .replaceAll('{staged_diff}', parts.join('\n'))
        return ok({ sel, rules, userCtx })
      }

      async function runGenerate(genId, prep) {
        const task = genTasks.get(genId)
        if (!task) return
        const consume = async (opts, onDelta) => {
          let t = ''
          let truncated = false
          const st = llm.stream(opts)
          for await (const chunk of st) {
            if (chunk.type === 'text-delta') { t += chunk.text; if (onDelta) onDelta(t) }
            else if (chunk.type === 'finish') {
              const kind = chunk.reason && chunk.reason.kind
              if (kind === 'error' || kind === 'aborted') {
                const failure = chunk.reason.failure
                return { retry: true, message: failure && failure.message ? failure.message : fmt(tr('errGenAborted'), { m: kind }) }
              }
              if (kind === 'max-tokens' && !t) truncated = true
            }
          }
          return { retry: false, text: t, truncated }
        }
        try {
          const base = {
            provider: prep.sel.provider,
            model: prep.sel.model,
            system: prep.rules.system_prompt || '',
            messages: [{ role: 'user', content: [{ type: 'text', text: prep.userCtx }], id: 'gitp-msg-1', source: { kind: 'user' } }],
            // 推理模型（如 deepseek-v4-pro）会先输出 reasoning 再输出正文；
            // 预算取 8000 与模型声明上限的较小值，避免小模型报错。
            maxTokens: prep.sel.maxTokens ? Math.min(MAX_GEN_TOKENS, prep.sel.maxTokens) : MAX_GEN_TOKENS,
            temperature: 0.2
          }
          const onDelta = (t) => { task.text = t }
          let res
          if (prep.sel.reasoningEffort) {
            // 思考强度：仅当用户显式配置时传递。adapter 不接受该值时会以 finish(error)
            // chunk 结束（如 UNSUPPORTED_REASONING_EFFORT），此时回退为不传强度重试，
            // 其余错误原样上报。
            res = await consume(Object.assign({}, base, { reasoningEffort: prep.sel.reasoningEffort }), onDelta)
            if (res.retry && /reasoning\s*effort|UNSUPPORTED_REASONING_EFFORT/i.test(res.message || '')) {
              res = await consume(base, onDelta)
            }
          } else {
            res = await consume(base, onDelta)
          }
          if (res.retry) throw new Error(res.message)
          if (res.truncated && !res.text) { task.error = tr('errGenTruncated'); task.done = true; return }
          const message = finalCleanFence(res.text || '')
          if (!message) { task.error = tr('errEmptyGen'); task.done = true; return }
          task.text = message
          task.done = true
        } catch (e) {
          task.error = e && e.message ? e.message : String(e)
          task.done = true
        } finally {
          if (timer) timer.timeout(() => genTasks.delete(genId), 60000)
        }
      }

      // ============ 写操作执行 ============
      // 审批体系已整体移除：所有写操作（commit/pull/push/switch/stash/reset/clean/discard）
      // 由面板用户显式点击触发后直接执行（类似 VS Code），仅保留审计记录。
      async function runWriteOp(toolName, repo, op, extra) {
        let res
        try { res = await op() }
        catch (e) { res = fail(e && e.message ? e.message : String(e)) }
        await audit(Object.assign({ op: (res.ok ? 'ok' : 'fail') + ':' + toolName, repo: repo.path, error: res.error || '' }, extra || {}))
        return res
      }

      function repoOf(repoId) {
        const r = repos.get(String(repoId))
        return r || null
      }

      // ============ 写操作 ============
      // 暂存/取消暂存：可逆的本地 index 操作（不写提交、不触网），由面板用户显式点击触发，
      // 不经审批门（否则每次点 ＋ 都会弹确认窗，不可用）；仍写审计日志。commit/push 等不变。
      async function opStage(repo, files) {
        const status = await repoStatus(repo)
        if (!status.ok) return fail(fmt(tr('errStatus'), { e: status.error }))
        const known = new Set(status.unstaged.map((f) => f.path).concat(status.untracked.map((f) => f.path)).concat(status.staged.map((f) => f.path)))
        for (const f of files) if (!known.has(f)) return fail(fmt(tr('errNotChanged'), { f }))
        const r = await gitRunFiles(repo.path, ['add'], files, { maxBytes: 128 * 1024, timeoutMs: 60000 })
        if (r.code !== 0) return fail(fmt(tr('errAdd'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: fmt(tr('stagedN'), { n: files.length }) })
      }

      async function opUnstage(repo, files) {
        const status = await repoStatus(repo)
        if (!status.ok) return fail(fmt(tr('errStatus'), { e: status.error }))
        const stagedSet = new Set(status.staged.map((f) => f.path))
        for (const f of files) if (!stagedSet.has(f)) return fail(fmt(tr('errNotStaged'), { f }))
        const r = await gitRunFiles(repo.path, ['reset', '-q'], files, { maxBytes: 128 * 1024, timeoutMs: 60000 })
        if (r.code !== 0) return fail(fmt(tr('errUnstage'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: fmt(tr('unstagedN'), { n: files.length }) })
      }

      // 提交：只处理已暂存（staged）文件，不再隐式 add/reset。
      // files 为空 = 全部 staged；files 为 staged 子集时用 pathspec 部分提交。
      async function opCommit(repo, files, message) {
        const status = await repoStatus(repo)
        if (!status.ok) return fail(fmt(tr('errStatus'), { e: status.error }))
        const stagedInfo = new Map(status.staged.map((f) => [f.path, f]))
        const stagedPaths = Array.from(stagedInfo.keys())
        if (stagedPaths.length === 0) return fail(tr('errNothingStaged'))
        const requested = files && files.length > 0 ? files : stagedPaths
        // pathspec 目标：rename/copy 的旧路径（orig）必须一并纳入，否则旧路径的删除会留在 index
        const targets = []
        for (const f of requested) {
          if (!stagedInfo.has(f)) return fail(fmt(tr('errNotStaged'), { f }))
          if (targets.indexOf(f) < 0) targets.push(f)
          const orig = stagedInfo.get(f).orig
          if (orig && targets.indexOf(orig) < 0) targets.push(orig)
        }
        const args = ['commit', '-F', '-']
        if (targets.length !== stagedPaths.length) {
          // 提交信息已占 stdin，部分提交的 pathspec 改落临时文件（失败回退 argv）
          const specFile = await writePathspecFile(repo, targets)
          if (specFile) args.push('--pathspec-from-file=' + specFile, OPT_PATHSPEC_FILE_NUL)
          else args.push('--', ...targets)
        }
        // 提交信息走 stdin（-F -），避免 Windows 命令行 ~32K 上限与特殊字符问题
        const rc = await gitRun(repo.path, args, { stdinData: message, maxBytes: 256 * 1024, timeoutMs: 120000 })
        if (rc.code !== 0) return fail(fmt(tr('errCommit'), { e: (rc.errText || rc.text).slice(0, 400) }))
        return ok({ summary: fmt(tr('committedN'), { n: requested.length }), detail: (rc.text || '').trim().slice(0, 400) })
      }

      async function opPush(repo) {
        const r = await gitRun(repo.path, ['push'], { maxBytes: 256 * 1024, timeoutMs: 180000 })
        if (r.code !== 0) return fail(fmt(tr('errPush'), { e: (r.errText || r.text).slice(0, 400) }))
        return ok({ summary: tr('pushed'), detail: (r.text || '').trim().slice(0, 300) })
      }

      async function opPull(repo) {
        const rf = await gitRun(repo.path, ['fetch', '--all', '--prune'], { maxBytes: 256 * 1024, timeoutMs: 180000 })
        if (rf.code !== 0) return fail(fmt(tr('errFetch'), { e: (rf.errText || rf.text).slice(0, 300) }))
        const upR = await gitRun(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { maxBytes: 4096, timeoutMs: 30000 })
        const target = upR.code === 0 && !/^fatal:/.test(upR.errText) ? (upR.text || '').trim() : null
        const rm = await gitRun(repo.path, ['merge', '--no-edit'].concat(target ? [target] : []), { maxBytes: 256 * 1024, timeoutMs: 120000 })
        if (rm.code !== 0) return fail(fmt(tr('errMerge'), { e: (rm.errText || rm.text).slice(0, 400) }))
        return ok({ summary: tr('pulled'), detail: (rm.text || '').trim().slice(0, 300) })
      }

      async function opSwitch(repo, branch, create) {
        const name = String(branch || '').trim()
        // 额外拒绝会被 git 当作选项的 '-' 开头等形态（参数已数组化无注入面，这里是
        // 语义防护）；'..' / '.lock' / '@{' / 控制字符 / 首尾 '.'、'/' 为 git refname
        // 保留或非法形式；允许 Unicode（中文等）分支名
        if (name.length === 0 || name.length > 120 || name.startsWith('-') ||
          name.startsWith('.') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') ||
          name.includes('..') || name.includes('@{') || name.includes('\\') ||
          /[\x00-\x1f\x7f ~^:?*[\]]/.test(name)) return fail(tr('errBadBranch'))
        const args = create ? ['switch', '-c', name] : ['switch', name]
        const r = await gitRun(repo.path, args, { maxBytes: 128 * 1024, timeoutMs: 120000 })
        if (r.code !== 0) return fail(fmt(tr('errSwitch'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: create ? fmt(tr('switchedCreate'), { b: name }) : fmt(tr('switched'), { b: name }), detail: (r.text || '').trim().slice(0, 300) })
      }

      async function opStashPush(repo, message) {
        const r = await gitRun(repo.path, ['stash', 'push', '-m', String(message || 'git-panel stash').slice(0, 200)], { maxBytes: 128 * 1024, timeoutMs: 120000 })
        if (r.code !== 0) return fail(fmt(tr('errStash'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: tr('stashed'), detail: (r.text || '').trim().slice(0, 300) })
      }

      async function opStashPop(repo, ref) {
        const args = ['stash', 'pop']
        // ref 仅接受 stash@{n} 或纯数字形态，防止任意参数被解释为 git 选项
        const refStr = ref === null || ref === undefined ? '' : String(ref)
        if (refStr !== '') {
          if (!/^(stash@\{\d+\}|\d+)$/.test(refStr)) return fail(tr('errBadRef'))
          args.push(refStr)
        }
        const r = await gitRun(repo.path, args, { maxBytes: 128 * 1024, timeoutMs: 120000 })
        if (r.code !== 0) return fail(fmt(tr('errStashPop'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: tr('stashPopped'), detail: (r.text || '').trim().slice(0, 300) })
      }

      async function opReset(repo, mode) {
        const r = await gitRun(repo.path, ['reset', mode === 'hard' ? '--hard' : '--soft', 'HEAD~1'], { maxBytes: 128 * 1024, timeoutMs: 60000 })
        if (r.code !== 0) return fail(fmt(tr('errReset'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: fmt(tr('resetDone'), { m: mode }), detail: (r.text || '').trim().slice(0, 300) })
      }

      async function opClean(repo) {
        const r = await gitRun(repo.path, ['clean', '-fd'], { maxBytes: 256 * 1024, timeoutMs: 120000 })
        if (r.code !== 0) return fail(fmt(tr('errClean'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: tr('cleaned'), detail: (r.text || '').trim().slice(0, 300) })
      }

      // 放弃更改（不可逆，直接执行，仅留审计）：
      //   staged    组 → git restore --staged --worktree（index + 工作区整体恢复到 HEAD）
      //   unstaged  组 → git checkout --（工作区恢复到 index，保留已暂存部分）
      //   untracked 组 → git clean -fd（删除未跟踪文件）
      async function opDiscard(repo, files, group) {
        const status = await repoStatus(repo)
        if (!status.ok) return fail(fmt(tr('errStatus'), { e: status.error }))
        const known = new Set((group === 'staged' ? status.staged : group === 'untracked' ? status.untracked : status.unstaged).map((f) => f.path))
        for (const f of files) if (!known.has(f)) return fail(fmt(tr('errNotChanged'), { f }))
        const run = (args) => gitRunFiles(repo.path, args, files, { maxBytes: 128 * 1024, timeoutMs: 60000 })
        if (group === 'staged') {
          const r = await run(['restore', '--staged', '--worktree'])
          if (r.code === 0) return ok({ summary: fmt(tr('discardedN'), { n: files.length }) })
          // 仓库尚无提交（无 HEAD）时 restore --staged 无法解析 HEAD：
          // 回退 git rm -f（从 index 移除并删除工作区文件）
          const r2 = await run(['rm', '-f'])
          if (r2.code !== 0) return fail(fmt(tr('errDiscard'), { e: (r2.errText || r2.text).slice(0, 300) }))
          return ok({ summary: fmt(tr('discardedN'), { n: files.length }) })
        }
        if (group === 'untracked') {
          const r = await gitRunFiles(repo.path, ['clean', '-fd'], files, { maxBytes: 256 * 1024, timeoutMs: 120000 })
          if (r.code !== 0) return fail(fmt(tr('errDiscard'), { e: (r.errText || r.text).slice(0, 300) }))
          return ok({ summary: fmt(tr('discardedN'), { n: files.length }) })
        }
        const r = await run(['checkout'])
        if (r.code !== 0) return fail(fmt(tr('errDiscard'), { e: (r.errText || r.text).slice(0, 300) }))
        return ok({ summary: fmt(tr('discardedN'), { n: files.length }) })
      }

      // ============ RPC（Client → Host） ============
      // 双形态注册：
      //   - 动态 Cordis 包：harness.handle(method, fn)（动态包运行器注入的内置件）
      //   - 文件态（npm 包 / web profile）：ctx.connection.rpc.handle('/git-panel', ...)
      //     （@deepseek-ai/dsh-client-connection 的通用 RPC 通道，自带浏览器信任围栏；
      //       通道名不得为保留的 /api）
      const dynamicHarness = typeof harness !== 'undefined' ? harness : null
      const connection = ctx.get('connection')
      const rpcHandlers = new Map()
      const registerRpc = (method, fn) => {
        if (dynamicHarness && typeof dynamicHarness.handle === 'function') {
          dynamicHarness.handle(method, async (args) => {
            try { return toEnvelope(await fn(args || {})) } catch (e) { return toEnvelope(fail(e && e.message ? e.message : String(e))) }
          })
          return
        }
        rpcHandlers.set(method, fn)
      }
      if (!dynamicHarness && connection && connection.rpc && typeof connection.rpc.handle === 'function') {
        // 第三参 { authority: 'loopback' } 必传：dsh-client-connection 0.1.0-rc.6 的
        // register(owner, channel, handler, options) 内部直接读 options.authority，
        // 缺省时 options 为 undefined 会抛 TypeError；'loopback' 同时把信任围栏收
        // 到仅本地浏览器（127.0.0.1/localhost）可访问该 RPC 通道。
        connection.rpc.handle('/git-panel', async (endpoint, payload) => {
          const fn = rpcHandlers.get(endpoint)
          if (!fn) return toEnvelope(fail('unknown method: ' + endpoint))
          try { return toEnvelope(await fn(payload || {})) } catch (e) { return toEnvelope(fail(e && e.message ? e.message : String(e))) }
        }, { authority: 'loopback' })
      }
      registerRpc('setLocale', async (args) => {
        const prev = currentLocale
        const l = args && args.locale
        currentLocale = l === 'en' ? 'en' : 'zh'
        // 语言切换后同步默认规则文件（仅 pristine 时重写，见 ensureDefaultRules）
        if (currentLocale !== prev) { try { await ensureDefaultRules() } catch (e) { /* ignore */ } }
        return { ok: true, locale: currentLocale }
      })

      registerRpc('scan', async (args) => {
        args = args || {}
        const root = args.root
        // 无 root 时不再回退 sandboxPolicy.workspaceRoot：在 dsh web 部署里那是
        // 进程启动目录（常见为 C:\Windows\System32），扫描它既慢（数千目录）又无意义，
        // 且其慢速响应晚到会与后续携带 root 的扫描竞态。改为快速失败，由面板
        // 跟随逻辑在就绪后携带明确 root 重试。
        if (!root) return fail(tr('errNoRoot'))
        await audit({ op: 'scan', repo: root })
        const res = await scanRepos(root)
        await ensureDefaultRules()
        return res
      })

      registerRpc('status', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        // 只读且高频（面板 4 秒轮询），不写审计，避免日志噪声海没写操作记录
        return await repoStatus(repo)
      })

      registerRpc('fileDiff', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        if (!args || typeof args.path !== 'string') return fail(tr('errNoPath'))
        // 与写操作同一标准：path 必须属于当前变更集的对应分组（纵深防御，
        // 防止任意 path 被当作 untracked 读取渲染到面板）
        const group = args.group === 'staged' ? 'staged' : args.group === 'untracked' ? 'untracked' : 'unstaged'
        const st = await repoStatus(repo)
        if (!st.ok) return fail(fmt(tr('errStatus'), { e: st.error }))
        const known = new Set(st[group].map((f) => f.path))
        if (!known.has(args.path)) return fail(fmt(tr('errNotChanged'), { f: args.path }))
        await audit({ op: 'diff', repo: repo.path, file: args.path, group })
        return await fileDiff(repo, args.path, group)
      })

      registerRpc('generate', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        if (!args || !Array.isArray(args.files) || args.files.length === 0) return fail(tr('errGenerateNoFiles'))
        await audit({ op: 'generate', repo: repo.path, files: args.files.length })
        const prep = await prepareGenerate(repo, args.files.map(String))
        if (!prep.ok) return prep
        const genId = 'gen-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
        genTasks.set(genId, { genId, text: '', done: false, error: '', ruleSource: prep.rules.source, provider: prep.sel.provider, model: prep.sel.model })
        runGenerate(genId, prep)
        return ok({ genId })
      })

      registerRpc('generatePoll', async (args) => {
        const genId = args && args.genId ? String(args.genId) : ''
        const task = genTasks.get(genId)
        if (!task) return fail(tr('errGenMissing'))
        const out = ok({ text: liveCleanFence(task.text), done: task.done, error: task.error, ruleSource: task.ruleSource, provider: task.provider, model: task.model })
        if (task.done) genTasks.delete(genId)
        return out
      })

      registerRpc('genModelGet', async () => {
        const configured = await loadGenModelConfig().catch(() => null)
        const effective = await modelSelection().catch(() => null)
        // 会话默认模型（不含生成模型配置）——弹窗「跟随当前会话模型」右侧展示用
        const sessionDefault = await modelSelection(true).catch(() => null)
        return ok({ configured, effective, sessionDefault })
      })

      registerRpc('genModelSet', async (args) => {
        args = args || {}
        if (args.configured === null) return await saveGenModelConfig(null)
        const provider = String(args.provider || '').trim()
        const model = String(args.model || '').trim()
        if (!provider || !model) return fail(tr('errGenModelInvalid'))
        const effort = args.reasoningEffort === 'off' || args.reasoningEffort === 'high' || args.reasoningEffort === 'max' ? args.reasoningEffort : null
        return await saveGenModelConfig({ provider, model, reasoningEffort: effort })
      })

      registerRpc('models', async () => {
        if (!llm || typeof llm.listProviders !== 'function') return fail(tr('errNoLlm'))
        try {
          const providers = llm.listProviders() || []
          const out = []
          for (const p of providers) {
            try {
              const models = await llm.listModels(p.id)
              if (models && models.length > 0) out.push({ provider: p.id, models: models.map((m) => ({ id: m.id, maxTokens: Number.isSafeInteger(m.maxTokens) ? m.maxTokens : null })) })
            } catch (e) { /* 单个 provider 失败跳过 */ }
          }
          return ok({ providers: out })
        } catch (e) { return fail(e && e.message ? e.message : String(e)) }
      })

      registerRpc('rulesGet', async (args) => {
        const repo = repoOf(args && args.repoId)
        const name = repo ? repo.name : (args && args.repoName) || 'default'
        const defPath = await rulesFilePath(name, 'global')
        const repoPath = await rulesFilePath(name, 'repo')
        const defYaml = (await fsReadText(defPath)) || emitRulesYaml(builtinRules())
        const repoTxt = await fsReadText(repoPath)
        const effective = await loadEffectiveRules(name)
        return ok({ defaultYaml: defYaml, defaultPath: defPath, repoYaml: repoTxt, repoPath, repoRuleExists: repoTxt !== null, effective })
      })

      registerRpc('rulesSave', async (args) => {
        const repo = repoOf(args && args.repoId)
        const name = repo ? repo.name : (args && args.repoName) || 'default'
        const scope = args && args.scope === 'repo' ? 'repo' : 'global'
        if (!args || typeof args.yaml !== 'string') return fail(tr('errNoYaml'))
        const parsed = parseRulesYaml(args.yaml)
        const err = validateRules(parsed)
        if (err) return fail(fmt(tr('errRules'), { e: err }))
        const path = await rulesFilePath(name, scope)
        const okW = await writeTextAnywhere(path, emitRulesYaml({ system_prompt: parsed.system_prompt, user_context: parsed.user_context }))
        if (!okW) return fail(fmt(tr('errRulesWrite'), { p: path }))
        await audit({ op: 'rules-save', repo: name, scope, path })
        return ok({ summary: fmt(tr('rulesSaved'), { p: path }) })
      })

      registerRpc('rulesReset', async (args) => {
        const repo = repoOf(args && args.repoId)
        const name = repo ? repo.name : (args && args.repoName) || 'default'
        const scope = args && args.scope === 'repo' ? 'repo' : 'global'
        const path = await rulesFilePath(name, scope)
        const yaml = emitRulesYaml(builtinRules())
        const okW = await writeTextAnywhere(path, yaml)
        if (!okW) return fail(fmt(tr('errRulesWrite'), { p: path }))
        await audit({ op: 'rules-reset', repo: name, scope, path })
        return ok({ summary: tr('rulesReset'), yaml })
      })

      registerRpc('rulesCopy', async (args) => {
        const repo = repoOf(args && args.repoId)
        const name = repo ? repo.name : (args && args.repoName) || 'default'
        const effective = await loadEffectiveRules(name)
        const yaml = emitRulesYaml({ system_prompt: effective.system_prompt, user_context: effective.user_context })
        try {
          await spawnRaw(['cmd.exe', '/d', '/s', '/c', 'clip'], '.', { stdinData: yaml, timeoutMs: 15000 })
          return ok({ summary: tr('copied') })
        } catch (e) { return fail(fmt(tr('errCopy'), { e: e && e.message ? e.message : String(e) })) }
      })

      registerRpc('stage', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const files = ((args && args.files) || []).map(String).filter(Boolean)
        if (files.length === 0) return fail(tr('errNoFilesStage'))
        await audit({ op: 'stage', repo: repo.path, files: files.length })
        return await opStage(repo, files)
      })

      registerRpc('unstage', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const files = ((args && args.files) || []).map(String).filter(Boolean)
        if (files.length === 0) return fail(tr('errNoFilesUnstage'))
        await audit({ op: 'unstage', repo: repo.path, files: files.length })
        return await opUnstage(repo, files)
      })

      registerRpc('discard', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const files = ((args && args.files) || []).map(String).filter(Boolean)
        if (files.length === 0) return fail(tr('errNoFilesDiscard'))
        const group = args && args.group === 'staged' ? 'staged' : args && args.group === 'untracked' ? 'untracked' : 'unstaged'
        await audit({ op: 'discard', repo: repo.path, group, files: files.length })
        return await opDiscard(repo, files, group)
      })

      registerRpc('commit', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const files = (args && args.files) || []
        const message = String((args && args.message) || '').trim().slice(0, 64 * 1024)
        if (!message) return fail(tr('errNoMessage'))
        if (files.length === 0) return fail(tr('errNothingStaged'))
        return await runWriteOp('git.commit', repo, () => opCommit(repo, files, message), { files: files.length })
      })

      registerRpc('push', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        return await runWriteOp('git.push', repo, () => opPush(repo))
      })

      registerRpc('pull', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        return await runWriteOp('git.pull', repo, () => opPull(repo))
      })

      registerRpc('branches', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const r = await gitRun(repo.path, ['for-each-ref', '--format=%(refname:short)%00%(HEAD)%00%(objectname:short)%00%(upstream:short)', 'refs/heads'], { maxBytes: 512 * 1024, timeoutMs: 30000 })
        if (r.code !== 0) return fail(fmt(tr('errBranches'), { e: (r.errText || r.text).slice(0, 200) }))
        const branches = []
        let current = null
        for (const line of (r.text || '').split('\n')) {
          if (!line) continue
          const parts = line.split('\u0000')
          if (parts.length < 3) continue
          const isCurrent = parts[1] === '*'
          branches.push({ name: parts[0], current: isCurrent, hash: parts[2], upstream: parts[3] || null })
          if (isCurrent) current = parts[0]
        }
        return ok({ current, branches })
      })

      registerRpc('switchBranch', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const branch = String((args && args.branch) || '').trim()
        const create = !!(args && args.create)
        if (!branch) return fail(tr('errNoBranchName'))
        return await runWriteOp('git.switch', repo, () => opSwitch(repo, branch, create))
      })

      registerRpc('stashList', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const r = await gitRun(repo.path, ['stash', 'list', '--format=%gd%00%H%00%s'], { maxBytes: 512 * 1024, timeoutMs: 30000 })
        if (r.code !== 0) return fail(fmt(tr('errStashList'), { e: (r.errText || r.text).slice(0, 200) }))
        const stashes = []
        for (const line of (r.text || '').split('\n')) {
          if (!line) continue
          const parts = line.split('\u0000')
          if (parts.length >= 3) stashes.push({ ref: parts[0], hash: parts[1], message: parts.slice(2).join('') })
        }
        return ok({ stashes })
      })

      registerRpc('stashPush', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        return await runWriteOp('git.stash', repo, () => opStashPush(repo, args && args.message))
      })

      registerRpc('stashPop', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        return await runWriteOp('git.stash-pop', repo, () => opStashPop(repo, args && args.ref))
      })

      registerRpc('reset', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const mode = args && args.mode === 'hard' ? 'hard' : 'soft'
        return await runWriteOp('git.reset', repo, () => opReset(repo, mode))
      })

      registerRpc('clean', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        return await runWriteOp('git.clean', repo, () => opClean(repo))
      })

      registerRpc('log', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        // 分页读取：--topo-order + --skip/-n，供前端按滚动条动态加载（--graph 不支持 --skip）
        const skip = Math.max(0, Number(args && args.skip) || 0)
        const limit = Math.min(500, Math.max(20, Number(args && args.limit) || 200))
        const r = await gitRun(repo.path, ['log', '--all', '--topo-order', '--date=iso-strict', '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1f%P', '--skip', String(skip), '-n', String(limit)], { maxBytes: 4 * 1024 * 1024, timeoutMs: 60000 })
        if (r.code !== 0) return fail(fmt(tr('errLog'), { e: (r.errText || r.text).slice(0, 200) }))
        const entries = []
        for (const line of (r.text || '').split('\n')) {
          const mark = line.indexOf('\u001e')
          if (mark < 0) {
            if (line.trim() !== '') entries.push({ hash: '', short: '', author: '', date: '', subject: line.trim(), refs: '', parents: [] })
            continue
          }
          const fields = line.slice(mark + 1).split('\u001f')
          entries.push({ hash: fields[0] || '', short: fields[1] || '', author: fields[2] || '', date: fields[3] || '', subject: fields[4] || '', refs: (fields[5] || '').trim(), parents: (fields[6] || '').split(' ').filter(Boolean) })
        }
        return ok({ entries, skip, hasMore: entries.length === limit })
      })

      registerRpc('commitDetail', async (args) => {
        const repo = repoOf(args && args.repoId)
        if (!repo) return fail(tr('errRepoMissing'))
        const hash = String((args && args.hash) || '').trim()
        if (!/^[0-9a-fA-F]{4,64}$/.test(hash)) return fail(tr('errBadHash'))
        // message 与 stat 分开取：原先对单次 show 输出按 4000 字符硬切，
        // message 短时会把 diffstat 切进 message、长时会切断行
        const [msgR, show, meta] = await Promise.all([
          gitRun(repo.path, ['log', '-1', '--format=%B', hash], { maxBytes: 256 * 1024, timeoutMs: 30000 }),
          gitRun(repo.path, ['show', '--stat', '--format=', hash], { maxBytes: 512 * 1024, timeoutMs: 60000 }),
          gitRun(repo.path, ['log', '-1', '--format=%an%x1f%ae%x1f%ad%x1f%s', '--date=iso-strict', hash], { maxBytes: 16384, timeoutMs: 30000 })
        ])
        if (show.code !== 0) return fail(fmt(tr('errCommitDetail'), { e: (show.errText || show.text).slice(0, 200) }))
        const mf = (meta.text || '').trim().split('\u001f')
        return ok({ message: (msgR.text || '').trim().slice(0, 4000), author: mf[0] || '', email: mf[1] || '', date: mf[2] || '', subject: mf[3] || '', stat: (show.text || '').trim().slice(0, 12000) })
      })

      console.log('[git-panel] Host 已就绪')
    }
  }
}
