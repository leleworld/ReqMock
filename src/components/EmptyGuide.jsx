import React from 'react';

/**
 * 带行动引导的空态。
 *
 * 一句话的 `empty-hint` 只说明「这里现在没有东西」，首次使用的用户还需要知道
 * 「下一步做什么」。这里复用集合树已有的 .empty-guide 样式：标题 + 说明 + 整宽动作按钮。
 *
 * @param title    一句话状态名（必填）
 * @param desc     为什么是空的 / 下一步做什么
 * @param actions  [{ label, onClick, title? }]，渲染成整宽按钮；无可执行动作时传空数组
 */
export default function EmptyGuide({ title, desc, actions = [] }) {
  return (
    <div className="empty-guide">
      <div className="empty-guide-title">{title}</div>
      {desc && <div className="empty-guide-desc">{desc}</div>}
      {actions.map((a) => (
        <button key={a.label} className="btn-block" title={a.title} onClick={a.onClick}>{a.label}</button>
      ))}
    </div>
  );
}
