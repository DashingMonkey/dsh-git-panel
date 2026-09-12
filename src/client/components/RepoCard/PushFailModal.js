/**
 * 推送失败弹窗（提交成功、推送失败时的收尾出口），从 RepoCard 拆出的独立组件：
 * props 进出、无跨层状态写入——现场（pushFail）与忙态由 RepoCard 持有，动作经
 * onAct('retry' | 'undo' | 'close') 上抛，由 RepoCard 的 pushAct 延迟转发给
 * CommitArea 写入 pushFailActions ref 的实现。
 */
import React from 'react'
import { tr, fmt } from '../../i18n.js'
import { icon } from '../../icons.js'

// 弹窗里那个框要显示什么文本。规则：优先 git 自己的输出（Host 的 fail(...).detail →
// 信封 error.details.detail → unwrapRpc 摊平成 res.detail）；没有原文时（无上游那条路径
// 有意不给）退回 Host 定稿的建议命令，最后才退到占位符——保证框里永远有可执行的下一步，
// 而不是空白。建议命令优先用 **Host 实测出来的那一条**（opPush 把
// `git push -u <remote> <branch>` 放进了信封的 details.command）。remote 取自
// branch.<b>.remote、缺失才回落 origin，所以客户端不能自己拼 origin——那会在 remote
// 不是 origin 的仓库里给出与面板正文不一致的命令；取不到 command 时才退回按 branch 拼
//（老 Host / 异常路径）。
function pushFailText(pushFail) {
  if (pushFail.raw) return pushFail.raw
  if (pushFail.command) return pushFail.command
  return 'git push -u origin ' + (pushFail.branch || '<branch>')
}

// 三个按钮：重试推送 / 取消上次提交 / 关闭——关掉只是先不管，本地提交仍在，
// 之后可以从「更多操作 → Push」再推（推送成功会自动关掉本弹窗，见 RepoCard 的
// handleWriteResult）。报错原文用一个等宽框直接整段显示，不做展开收起、也没有复制出口：
// 屏幕先要给出「失败、提交还在、有哪几条路」这个结论，而 git 原文要看就能看到。
// ⚠ 遮罩点击的「无事发生」判定（busy 时不关窗）在 RepoCard 侧的 onAct('close') 实现。
export function PushFailModal({ pushFail, busy, pushRetrying, onAct }) {
  return React.createElement('div', { className: 'gp-modal-backdrop', onClick: (e) => { e.stopPropagation(); if (!busy) onAct('close') } },
    React.createElement('div', { className: 'gp-modal gp-modal-sm', onClick: (e) => e.stopPropagation() },
      React.createElement('div', { className: 'gp-modal-head' }, icon('warning', 15), tr('pushFailTitle')),
      React.createElement('div', { className: 'gp-modal-body' },
        React.createElement('div', { className: 'gp-confirm-summary' }, fmt(tr('pushFailKept'), { b: pushFail.branch || '(?)' })),
        // 无 upstream 的失败是「重试也不会好」的那一类：换一条建议文案（框里那条命令就是
        // 按它执行的那条）。其余失败不再给任何解释性文案——那本就是 git 自己要说的话。
        pushFail.noUpstream
          ? React.createElement('div', { className: 'gp-confirm-note gp-danger' }, tr('pushFailNoUpstream'))
          : null,
        // 报错原文直接显示，不再有「查看原文 / 查看面板提示」切换与复制出口
        React.createElement('div', { className: 'gp-confirm-files' }, pushFailText(pushFail))),
      React.createElement('div', { className: 'gp-modal-foot' },
        // 重试推送放最左：这是本弹窗里最常见、也最可能成功的下一步
        React.createElement('button', { className: 'gp-btn gp-btn-primary', disabled: !!busy || pushRetrying, onClick: () => onAct('retry') },
          pushRetrying ? React.createElement('span', { className: 'gp-spinner' }) : icon('arrowUp'),
          pushRetrying ? tr('pushing') : tr('pushFailRetry')),
        // 撤销走自实现的锁（busy = 'reset'）：期间转圈并全禁用，避免连点两次把 HEAD
        // 又往下撤一个提交；成功才收窗，失败时弹窗留着
        React.createElement('button', { className: 'gp-btn gp-btn-danger', disabled: !!busy || pushRetrying, onClick: () => onAct('undo') },
          busy === 'reset' ? React.createElement('span', { className: 'gp-spinner' }) : null,
          busy === 'reset' ? tr('pushFailUndoing') : tr('pushFailUndo')),
        React.createElement('button', { className: 'gp-btn', disabled: !!busy, onClick: () => onAct('close') }, tr('close')))))
}
