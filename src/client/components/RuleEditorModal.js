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
  const [defaults, setDefaults] = React.useState({ sysPrompt: '', userCtx: '' })
  const [paths, setPaths] = React.useState({ global: '', repo: '' })
  const [repoExists, setRepoExists] = React.useState(false)
  // scope 初始为 null：等 rulesGet 返回后跟随当前生效来源（ruleScope 偏好 +
  // 仓库文件存在性，见 Host loadEffectiveRules），加载完成前切换禁用，避免闪跳
  const [scope, setScope] = React.useState(null)
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)
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
        setDefaults({ sysPrompt: g.system_prompt || '', userCtx: g.user_context || '' })
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
  const onRestoreDefault = () => {
    patchBuf({ sysPrompt: defaults.sysPrompt, userCtx: defaults.userCtx })
    pushToast('info', tr('restoredDefaults'))
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
    React.createElement('button', { className: 'gp-btn', onClick: onRestoreDefault }, tr('restoreDefaults')),
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
