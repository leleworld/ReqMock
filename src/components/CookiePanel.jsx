import React, { useState } from 'react';
import { JbIcon } from './Icons.jsx';
import { formatDate } from '../utils/toolboxUtil.js';
import EmptyGuide from './EmptyGuide.jsx';

/**
 * Cookie 管理面板：自动记录的 Cookie 按域名分组展示 + 全局开关 + 手动添加/删除/按域清空
 */
export default function CookiePanel({ jar, cookiesEnabled, onChangeJar, onToggleEnabled }) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState({}); // domain -> 是否折叠

  const list = jar.filter((c) =>
    !filter ||
    c.domain.includes(filter) ||
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  // 按域名分组（组顺序按首次出现）
  const groups = [];
  for (const c of list) {
    let g = groups.find((x) => x.domain === c.domain);
    if (!g) { g = { domain: c.domain, items: [] }; groups.push(g); }
    g.items.push(c);
  }

  const removeAt = (cookie) => {
    onChangeJar(jar.filter((c) => c !== cookie));
  };

  /** 清空指定域名下全部 Cookie */
  const clearDomain = (domain) => {
    onChangeJar(jar.filter((c) => c.domain !== domain));
  };

  const handleAdd = () => {
    onChangeJar([...jar, {
      name: 'name', value: 'value', domain: 'localhost', hostOnly: true,
      path: '/', expires: null, secure: false, createdAt: Date.now()
    }]);
  };

  const update = (cookie, field, value) => {
    onChangeJar(jar.map((c) => (c === cookie ? { ...c, [field]: value } : c)));
  };

  return (
    <div className="cookie-panel">
      <div className="mock-control-bar">
        <span className="mock-title">Cookie 管理器</span>
        <label className="inline-label">
          <input type="checkbox" checked={cookiesEnabled} onChange={(e) => onToggleEnabled(e.target.checked)} />
          自动记录并携带 Cookie
        </label>
        <span className="flex-spacer" />
        <input
          className="url-input cookie-filter"
          placeholder="按域名 / 名称过滤"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn-secondary" onClick={handleAdd}>+ 添加</button>
        <button className="btn-secondary btn-danger" disabled={jar.length === 0} onClick={() => onChangeJar([])}>
          清空全部
        </button>
      </div>

      <div className="cookie-body">
        {list.length === 0 && (
          jar.length === 0 ? (
            <EmptyGuide
              title="还没有 Cookie"
              desc={cookiesEnabled
                ? '发送请求后，响应里的 Set-Cookie 会自动存到这里，并在后续同域请求中自动携带；也可以从浏览器导出后粘贴进来。'
                : '自动记录当前是关闭的，响应里的 Set-Cookie 不会被保存。开启后即可在这里查看和管理各域名的 Cookie。'}
              actions={cookiesEnabled ? [] : [{ label: '开启自动记录', onClick: onToggleEnabled }]}
            />
          ) : (
            <div className="empty-hint">无匹配的 Cookie，清空上方搜索框可查看全部</div>
          )
        )}
        {list.length > 0 && groups.map((g) => (
          <div key={g.domain} className="cookie-group">
            <div
              className="history-group-head cookie-group-head"
              onClick={() => setCollapsed((prev) => ({ ...prev, [g.domain]: !prev[g.domain] }))}
            >
              <span className="tree-arrow"><JbIcon name={collapsed[g.domain] ? 'chevron-right' : 'chevron-down'} size={12} /></span>
              <span className="item-name">{g.domain}</span>
              <span className="tree-count">{g.items.length}</span>
              <span className="flex-spacer" />
              <button
                className="btn-text btn-danger"
                title={`清空 ${g.domain} 下全部 Cookie`}
                onClick={(e) => { e.stopPropagation(); clearDomain(g.domain); }}
              >清空该域</button>
            </div>
            {!collapsed[g.domain] && (
              <table className="headers-table cookie-table">
                <thead>
                  <tr>
                    <th>名称</th><th>值</th><th>路径</th><th>过期时间</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((c, i) => (
                    <tr key={i}>
                      <td className="header-key">
                        <input className="cookie-cell-input" value={c.name} onChange={(e) => update(c, 'name', e.target.value)} />
                      </td>
                      <td className="header-value">
                        <input className="cookie-cell-input" value={c.value} onChange={(e) => update(c, 'value', e.target.value)} />
                      </td>
                      <td>{c.path}{c.secure && <span className="kv-lock-icon" title="Secure Cookie"> <JbIcon name="lock" size={11} /></span>}</td>
                      <td className="meta">{c.expires === null ? '会话' : formatDate(new Date(c.expires))}</td>
                      <td>
                        <span className="item-delete cookie-delete" onClick={() => removeAt(c)}>×</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
