/** 生成模型配置弹窗：跟随会话默认 / 按 provider 分组选择模型 + 思考强度。 */
import React from 'react'
import { callRpc } from '../api.js'
import { tr, fmt } from '../i18n.js'
import { pushToast } from '../store.js'
import { icon } from '../icons.js'
// 生成模型配置弹窗：跟随会话默认 / 按 provider 分组选择模型 + 思考强度
function GenModelModal({ onClose, onSaved }) {
  const [st, setSt] = React.useState({ loading: true, providers: [], configured: null, sessionDefault: null, selected: null, effort: null, saving: false, error: '' })
  React.useEffect(() => {
    let alive = true
    Promise.all([callRpc('genModelGet', {}).catch(() => null), callRpc('models', {}).catch(() => null)]).then(([gm, ms]) => {
      if (!alive) return
      const configured = gm && gm.ok ? gm.configured : null
      const sessionDefault = gm && gm.ok ? gm.sessionDefault : null
      setSt((s) => ({
        ...s,
        loading: false,
        providers: ms && ms.ok && Array.isArray(ms.providers) ? ms.providers : [],
        configured,
        sessionDefault,
        selected: configured ? { provider: configured.provider, model: configured.model } : null,
        effort: configured ? configured.reasoningEffort : null,
        error: (gm && gm.ok && ms && ms.ok) ? '' : tr('genModelLoadFailed')
      }))
    })
    return () => { alive = false }
  }, [])

  const save = async () => {
    setSt((s) => ({ ...s, saving: true }))
    try {
      const payload = st.selected ? { provider: st.selected.provider, model: st.selected.model, reasoningEffort: st.effort } : { configured: null }
      const r = await callRpc('genModelSet', payload)
      if (r && r.ok) { pushToast('success', tr('genModelSaved')); if (onSaved) onSaved(); onClose() }
      else pushToast('error', (r && r.error) || tr('saveFailed'))
    } catch (e) { pushToast('error', fmt(tr('saveFailedWith'), { e: e && e.message ? e.message : String(e) })) }
    finally { setSt((s) => ({ ...s, saving: false })) }
  }

  const effortBtn = (val, label) => React.createElement('button', {
    className: 'gp-btn gp-btn-sm ' + (st.effort === val ? 'gp-btn-primary' : ''),
    onClick: () => setSt((s) => ({ ...s, effort: val }))
  }, label)

  const listBody = st.loading ? React.createElement('div', { className: 'gp-empty' }, tr('loading')) :
    st.providers.length === 0 ? React.createElement('div', { className: 'gp-empty' }, tr('genModelEmpty')) :
      React.createElement('div', { className: 'gp-genmodel-scroll' },
        React.createElement('button', { className: 'gp-genmodel-item' + (st.selected === null ? ' gp-genmodel-selected' : ''), onClick: () => setSt((s) => ({ ...s, selected: null })) },
          React.createElement('span', null, tr('genModelFollowDefault')),
          st.sessionDefault ? React.createElement('span', { className: 'gp-genmodel-meta' }, st.sessionDefault.provider + ' / ' + st.sessionDefault.model) : null),
        st.providers.map((g) => React.createElement('div', { key: g.provider, className: 'gp-genmodel-group' },
          React.createElement('div', { className: 'gp-genmodel-group-title' }, g.provider),
          g.models.map((m) => React.createElement('button', { key: m.id, className: 'gp-genmodel-item' + (st.selected && st.selected.provider === g.provider && st.selected.model === m.id ? ' gp-genmodel-selected' : ''), onClick: () => setSt((s) => ({ ...s, selected: { provider: g.provider, model: m.id } })) }, m.id)))))

  return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); if (!st.saving) onClose() } },
    React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'gp-modal-head' }, icon('sparkles', 15), tr('genModelConfig')),
      React.createElement('div', { className: 'gp-modal-body' },
        listBody,
        React.createElement('div', { className: 'gp-genmodel-effort' },
          React.createElement('span', { className: 'gp-genmodel-effort-label' }, tr('genModelEffort')),
          effortBtn(null, tr('genModelEffortFollow')),
          effortBtn('off', tr('genModelEffortOff')),
          effortBtn('high', tr('genModelEffortHigh')),
          effortBtn('max', tr('genModelEffortMax'))),
        st.error ? React.createElement('div', { className: 'gp-empty gp-danger' }, st.error) : null),
      React.createElement('div', { className: 'gp-modal-foot' },
        React.createElement('button', { className: 'gp-btn', onClick: onClose, disabled: st.saving }, tr('cancel')),
        React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: save, disabled: st.saving || st.loading }, st.saving ? tr('saving') : tr('save')))))
}
export { GenModelModal }
