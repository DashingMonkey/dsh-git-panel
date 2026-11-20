// 生成模型配置弹窗：跟随会话默认 / 按 provider 分组选择模型 + 思考强度。
// 跟随会话时思考强度也随会话走（见下方 effort 区域的三态切换）。
import React from 'react'
import { callRpc } from '../api.js'
import { tr, fmt } from '../i18n.js'
import { pushToast } from '../store.js'
import { icon } from '../icons.js'
import { fmtTokens } from '../lib/util.js'
// 生成模型配置弹窗：跟随会话默认 / 按 provider 分组选择模型 + 思考强度 + 生成用量开关。
// 跟随会话时思考强度也随会话走（见下方 effort 区域的三态切换）。
function GenModelModal({ onClose, onSaved }) {
  const [st, setSt] = React.useState({ loading: true, providers: [], configured: null, sessionDefault: null, selected: null, effort: null, saving: false, error: '', genUsage: { enabled: false, calls: 0, total: 0 }, usageSaving: false })
  const refreshGenUsage = async () => {
    const r = await callRpc('genUsageGet', {}).catch(() => null)
    if (r && r.ok) setSt((s) => ({ ...s, genUsage: { enabled: !!r.enabled, calls: r.calls || 0, total: r.total || 0 } }))
  }
  React.useEffect(() => {
    let alive = true
    Promise.all([callRpc('genModelGet', {}).catch(() => null), callRpc('models', {}).catch(() => null), callRpc('genUsageGet', {}).catch(() => null)]).then(([gm, ms, gu]) => {
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
        error: (gm && gm.ok && ms && ms.ok) ? '' : tr('genModelLoadFailed'),
        genUsage: { enabled: !!(gu && gu.ok && gu.enabled), calls: (gu && gu.ok && gu.calls) || 0, total: (gu && gu.ok && gu.total) || 0 }
      }))
    })
    return () => { alive = false }
  }, [])

  // 生成用量开关（默认关闭）：开启后每次生成消耗的 token 计入本地账本与审计日志；
  // 关闭后停止写新行、历史账本保留且仍可读。切换即时生效（下一次生成即按新状态记账）。
  // 失败必须显式提示：宿主半体没重启时这两个 RPC 不存在，callRpc 会静默失败——
  // 没有这句 toast，用户看到的就是「点了没反应」（本轮真实故障形态）。
  const toggleGenUsage = async (enabled) => {
    if (st.usageSaving) return
    setSt((s) => ({ ...s, usageSaving: true }))
    const r = await callRpc('genUsageSet', { enabled }).catch(() => null)
    if (!(r && r.ok)) {
      pushToast('error', tr('gpUsageRpcFailed'))
    } else {
      await refreshGenUsage()
    }
    setSt((s) => ({ ...s, usageSaving: false }))
  }

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
          // 三态：跟随会话 → 展示会话实际思考强度（不可独立设）；选定模型 → 独立按钮组
          st.selected === null
            ? (st.sessionDefault && st.sessionDefault.reasoningEffort
              ? React.createElement('span', { className: 'gp-genmodel-effort-follow' }, fmt(tr('genModelEffortSession'), { e: st.sessionDefault.reasoningEffort === 'off' ? tr('genModelEffortOff') : st.sessionDefault.reasoningEffort === 'high' ? tr('genModelEffortHigh') : tr('genModelEffortMax') }))
              : React.createElement('span', { className: 'gp-genmodel-effort-follow' }, tr('genModelEffortSessionPlain')))
            : React.createElement(React.Fragment, null,
                effortBtn(null, tr('genModelEffortFollow')),
                effortBtn('off', tr('genModelEffortOff')),
                effortBtn('high', tr('genModelEffortHigh')),
                effortBtn('max', tr('genModelEffortMax')))),
        st.error ? React.createElement('div', { className: 'gp-empty gp-danger' }, st.error) : null,
        // 生成用量开关 + 累计行（默认关闭）：开启后每次生成的 token 计入账本与审计日志，
        // 本弹窗底部即开合入口；关闭态只显示一行说明，不显示任何数字。
        React.createElement('div', { className: 'gp-genmodel-usage' },
          React.createElement('span', { className: 'gp-genmodel-effort-label' }, tr('gpUsageLabel')),
          React.createElement('span', { className: 'gp-genmodel-effort-follow' + (st.genUsage.enabled ? ' gp-usage-on-text' : '') },
            st.genUsage.enabled ? fmt(tr('gpUsageCumulative'), { n: st.genUsage.calls, t: fmtTokens(st.genUsage.total) }) : tr('gpUsageOffDesc')),
          React.createElement('button', { className: 'gp-btn gp-btn-sm' + (st.genUsage.enabled ? '' : ' gp-btn-primary'), disabled: !!st.usageSaving, onClick: () => toggleGenUsage(!st.genUsage.enabled) },
            st.usageSaving ? tr('gpUsageSaving') : (st.genUsage.enabled ? tr('gpUsageToggleOn') : tr('gpUsageToggleOff'))))),
      React.createElement('div', { className: 'gp-modal-foot' },
        React.createElement('button', { className: 'gp-btn', onClick: onClose, disabled: st.saving }, tr('cancel')),
        React.createElement('button', { className: 'gp-btn gp-btn-primary', onClick: save, disabled: st.saving || st.loading }, st.saving ? tr('saving') : tr('save')))))
}
export { GenModelModal }
