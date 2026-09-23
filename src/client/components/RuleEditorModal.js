/** 提交规则编辑器弹窗（system_prompt / user_context 双编辑框 + 实时预览）。 */
import React from 'react'
import { callRpc } from '../api.js'
import { tr, fmt } from '../i18n.js'
import { pushToast } from '../store.js'
import { icon } from '../icons.js'
import { parseRulesYaml, emitRulesYaml } from '../lib/rulesYaml.js'
function RuleEditorModal({ repo, onClose }) {
  // 双缓冲：全局 / 仓库各一套编辑内容；scope 单选即生效来源（切换走 rulesSetScope，
  // 切到仓库时缓冲区以 Host 返回的仓库文件内容为准）
  const [buffers, setBuffers] = React.useState({ global: { sysPrompt: '', userCtx: '' }, repo: { sysPrompt: '', userCtx: '' } })
  const [paths, setPaths] = React.useState({ global: '', repo: '' })
  const [repoExists, setRepoExists] = React.useState(false)
  // scope 初始为 null：等 rulesGet 返回后跟随当前生效来源（ruleScope 偏好 +
  // 仓库文件存在性，见 Host loadEffectiveRules），加载完成前切换禁用，避免闪跳
  const [scope, setScope] = React.useState(null)
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [branch, setBranch] = React.useState(tr('reading'))

  React.useEffect(() => {
    callRpc('rulesGet', { repoId: repo.id }).then((r) => {
      if (r && r.ok) {
        const g = parseRulesYaml(r.defaultYaml)
        const rp = parseRulesYaml(r.repoYaml || r.defaultYaml)
        setBuffers({
          global: { sysPrompt: g.system_prompt || '', userCtx: g.user_context || '' },
          repo: { sysPrompt: rp.system_prompt || '', userCtx: rp.user_context || '' }
        })
        setPaths({ global: r.defaultPath || '', repo: r.repoPath || '' })
        setRepoExists(!!r.repoRuleExists)
        setScope(r.effective && r.effective.source === 'repo' ? 'repo' : 'global')
        setLoaded(true)
      } else pushToast('error', (r && r.error) || tr('rulesLoadFailed'))
    }).catch((e) => pushToast('error', tr('rulesLoadFailed') + ': ' + (e && e.message ? e.message : String(e))))
    callRpc('status', { repoId: repo.id }).then((r) => { if (r && r.ok && r.branch) setBranch(r.branch) }).catch(() => {})
  }, [repo.id])

  const curScope = scope || 'global'
  const buf = buffers[curScope]
  const patchBuf = (p) => setBuffers((b) => ({ ...b, [curScope]: { ...b[curScope], ...p } }))

  const previewUser = (buf.userCtx || tr('missingUserCtx'))
    .replaceAll('{repo_name}', repo.name)
    .replaceAll('{branch}', branch)
    .replaceAll('{file_list}', '- ' + tr('stagedPlaceholder'))
    .replaceAll('{staged_diff}', tr('stagedDiffPlaceholder'))

  const onSave = async () => {
    if (!buf.sysPrompt.trim()) { pushToast('error', tr('validationNoSys')); return }
    if (!buf.userCtx.trim()) { pushToast('error', tr('validationNoUser')); return }
    setSaving(true)
    try {
      const yaml = emitRulesYaml({ system_prompt: buf.sysPrompt, user_context: buf.userCtx })
      const r = await callRpc('rulesSave', { repoId: repo.id, scope: curScope, yaml })
      if (r && r.ok) { pushToast('success', r.summary || tr('saved')); onClose() }
      else pushToast('error', (r && r.error) || tr('saveFailed'))
    } catch (e) { pushToast('error', fmt(tr('saveFailedWith'), { e: e && e.message ? e.message : String(e) })) }
    finally { setSaving(false) }
  }
  // 恢复默认 = 真重置（rulesReset RPC，直接写盘），不是「把缓冲区填回默认值」。
  // 旧实现只把读盘读到的**当前全局文件内容**当默认值回填缓冲区，用户改坏的正是
  // 那个文件——点一下等于把坏内容原样再填一遍，看着毫无效果；而 Host 侧能真正
  // 重置的 rulesReset 客户端从来没调用过（见 docs/usage.md 的按钮说明）。
  // 现在的语义（用户选定）：按钮即重置并落盘，编辑器随后以 Host 返回的权威内容刷新；
  //   全局 → default.yaml 写回内置默认；
  //   仓库专属 → 删除该仓库规则文件并显式回退全局（Host 侧 rulesReset 已实现）。
  const onRestoreDefault = async () => {
    if (resetting || !loaded) return
    setResetting(true)
    try {
      const r = await callRpc('rulesReset', { repoId: repo.id, scope: curScope })
      if (!r || !r.ok) { pushToast('error', (r && r.error) || tr('saveFailed')); return }
      // 仓库专属被重置后不再有文件、偏好已回退全局：编辑范围跟随生效来源，
      // 否则用户会以为「重置的是我正在看的这个 scope」。显式比较而非依赖闭包里的
      // loaded：重置把规则拉回可用状态后，切范围本身是合法的。
      let next = curScope
      if (r.effective && r.effective.source === 'global' && curScope === 'repo') next = 'global'
      const rg = await callRpc('rulesGet', { repoId: repo.id })
      if (rg && rg.ok) {
        const g = parseRulesYaml(rg.defaultYaml)
        const rp = parseRulesYaml(rg.repoYaml || rg.defaultYaml)
        setBuffers({
          global: { sysPrompt: g.system_prompt || '', userCtx: g.user_context || '' },
          repo: { sysPrompt: rp.system_prompt || '', userCtx: rp.user_context || '' }
        })
        setPaths({ global: rg.defaultPath || '', repo: rg.repoPath || '' })
        setRepoExists(!!rg.repoRuleExists)
      }
      setScope(next)
      pushToast('success', r.summary || tr('restoredDefaults'))
    } catch (e) {
      pushToast('error', fmt(tr('failedWith'), { label: tr('restoreDefaults'), e: e && e.message ? e.message : String(e) }))
    } finally { setResetting(false) }
  }

  // scope 单选 = 真实切换生效来源（rulesSetScope 写入 git-repos.json 偏好）：
  // 切到仓库专属时 Host 会以当前生效规则为底创建文件（若不存在）；
  // 切回全局保留仓库文件，之后可再切回。保存仍是显式动作（onSave）。
  const onScopeChange = async (next) => {
    if (next === curScope || switching || !loaded) return
    setSwitching(true)
    try {
      const r = await callRpc('rulesSetScope', { repoId: repo.id, scope: next })
      if (r && r.ok) {
        if (next === 'repo' && typeof r.repoYaml === 'string') {
          const rp = parseRulesYaml(r.repoYaml)
          setBuffers((b) => ({ ...b, repo: { sysPrompt: rp.system_prompt || '', userCtx: rp.user_context || '' } }))
        }
        if (r.repoPath) setPaths((p) => ({ ...p, repo: r.repoPath }))
        setRepoExists(!!r.repoRuleExists)
        setScope(next)
        pushToast('success', r.summary || tr('saved'))
      } else pushToast('error', (r && r.error) || tr('scopeSwitchFailed'))
    } catch (e) { pushToast('error', tr('scopeSwitchFailed') + ': ' + (e && e.message ? e.message : String(e))) }
    finally { setSwitching(false) }
  }

  const fieldEditor = (keyName, label, value, setValue) =>
    React.createElement('div', { className: 'gp-rule-field' },
      React.createElement('div', { className: 'gp-rule-field-head' },
        React.createElement('code', { className: 'gp-rule-field-key' }, keyName),
        React.createElement('span', { className: 'gp-rule-field-label' }, label)),
      React.createElement('textarea', { className: 'gp-rule-input', value, spellCheck: false, onChange: (e) => setValue(e.target.value) }))

  const body = React.createElement('div', { className: 'gp-modal-body' },
    React.createElement('div', { className: 'gp-rule-scope' },
      React.createElement('label', { title: tr('globalRules') },
        React.createElement('input', { type: 'radio', name: 'gp-rule-scope', disabled: !loaded || switching, checked: curScope === 'global', onChange: () => onScopeChange('global') }),
        React.createElement('span', null, tr('globalRules'))),
      React.createElement('label', { title: tr('repoRules') },
        React.createElement('input', { type: 'radio', name: 'gp-rule-scope', disabled: !loaded || switching, checked: curScope === 'repo', onChange: () => onScopeChange('repo') }),
        React.createElement('span', null, tr('repoRules'))),
      switching ? React.createElement('span', { className: 'gp-spinner' }) : null),
    React.createElement('div', { className: 'gp-rule-scope-hint', title: paths[curScope] },
      fmt(tr('scopeSaveTo'), { p: paths[curScope] || tr('loading') }),
      curScope === 'repo' && !repoExists ? tr('scopeNewFile') : null),
    React.createElement('div', { className: 'gp-rule-cols' },
      React.createElement('div', { className: 'gp-rule-col' },
        React.createElement('div', { className: 'gp-rule-col-title' }, tr('rulesContent')),
        React.createElement('div', { className: 'gp-rule-fields' },
          fieldEditor('system_prompt', tr('sysPromptLabel'), buf.sysPrompt, (v) => patchBuf({ sysPrompt: v })),
          fieldEditor('user_context', tr('userCtxLabel'), buf.userCtx, (v) => patchBuf({ userCtx: v })))),
      React.createElement('div', { className: 'gp-rule-col' },
        React.createElement('div', { className: 'gp-rule-col-title' }, tr('livePreview')),
        React.createElement('div', { className: 'gp-rule-preview' },
          React.createElement('div', { className: 'gp-rule-preview-title' }, 'SYSTEM PROMPT'),
          buf.sysPrompt || tr('empty'),
          React.createElement('div', { className: 'gp-rule-preview-title' }, tr('userCtxTitle')),
          previewUser))))

  const foot = React.createElement('div', { className: 'gp-modal-foot' },
    React.createElement('button', { className: 'gp-btn', onClick: onRestoreDefault, disabled: !loaded || resetting, title: tr('restoreDefaults') }, resetting ? tr('restoring') : tr('restoreDefaults')),
    React.createElement('button', { className: 'gp-btn', onClick: onClose }, tr('cancel')),
    React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: onSave, disabled: saving || !loaded }, saving ? tr('saving') : tr('save')))

  return React.createElement('div', { className: 'gp-modal-backdrop', onClick: onClose },
    React.createElement('div', { className: 'gp-modal', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'gp-modal-head' },
        icon('gear', 15),
        React.createElement('span', { className: 'gp-spacer' }, tr('ruleEditorTitle')),
        React.createElement('button', { className: 'gp-btn-icon', onClick: onClose, title: tr('close') }, icon('close'))),
      body,
      foot))
}
export { RuleEditorModal }
