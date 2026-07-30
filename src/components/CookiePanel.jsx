import React, { useState } from 'react';
import { formatDate } from '../utils/toolboxUtil.js';

/**
 * Cookie 管理面板：自动记录的 Cookie 列表 + 全局开关 + 手动添加/删除
 */
export default function CookiePanel({ jar, cookiesEnabled, onChangeJar, onToggleEnabled }) {
  const [filter, setFilter] = useState('');

  const list = jar.filter((c) =>
    !filter ||
    c.domain.includes(filter) ||
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  const removeAt = (cookie) => {
    onChangeJar(jar.filter((c) => c !== cookie));
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
          <div className="empty-hint">
            {jar.length === 0
              ? '暂无 Cookie。开启自动记录后，响应中的 Set-Cookie 会存入这里，并在后续同域请求中自动携带。'
              : '无匹配的 Cookie'}
          </div>
        )}
        {list.length > 0 && (
          <table className="headers-table cookie-table">
            <thead>
              <tr>
                <th>域名</th><th>名称</th><th>值</th><th>路径</th><th>过期时间</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={i}>
                  <td className="cookie-domain">{c.hostOnly ? '' : '.'}{c.domain}{c.secure ? ' 🔒' : ''}</td>
                  <td className="header-key">
                    <input className="cookie-cell-input" value={c.name} onChange={(e) => update(c, 'name', e.target.value)} />
                  </td>
                  <td className="header-value">
                    <input className="cookie-cell-input" value={c.value} onChange={(e) => update(c, 'value', e.target.value)} />
                  </td>
                  <td>{c.path}</td>
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
    </div>
  );
}
