import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { urlDecode } from '../utils/toolboxUtil.js';
import VarInput from './VarInput.jsx';
import { JbIcon } from './Icons.jsx';

/**
 * 通用键值对编辑器（Params / Headers / Form 共用）
 * rows: [{key, value, enabled}]
 * 功能：
 *   - 工具栏：隐藏/显示锁定行、{} 批量编辑、复制全部、新增行、清空全部
 *   - lockedRows：自动生成的锁定行内联置顶展示（带锁图标，值为空时显示"默认自动生成"占位）
 *   - 幽灵尾行：在末尾灰色空行直接输入即自动追加新行（免点"+ 添加"）
 *   - key 可挂 datalist 补全，value 支持 {{变量}} 补全与 chip 高亮
 */
export default function KeyValueEditor({
  rows, onChange,
  keyPlaceholder = 'Key', valuePlaceholder = 'Value',
  keySuggestions = [], varNames = [], varMap = null, allowBulk = true,
  label = '', lockedRows = [], toolbarExtra = null
}) {
  const [bulk, setBulk] = useState(false);
  const [showLocked, setShowLocked] = useState(true);
  const [copied, setCopied] = useState(false);
  const listId = useId();
  const [encMenu, setEncMenu] = useState(null); // { x, y, index, start, end, text }
  const bodyRef = useRef(null);
  // 幽灵行输入后待聚焦的目标 { index, field }
  const focusReq = useRef(null);

  // 幽灵行输入创建新行后，把焦点移交给新生成的真实行输入框
  useEffect(() => {
    if (!focusReq.current || !bodyRef.current) return;
    const { index, field } = focusReq.current;
    focusReq.current = null;
    const rowEl = bodyRef.current.querySelector(`.kv-row[data-idx="${index}"]`);
    const input = rowEl && rowEl.querySelector(field === 'key' ? '.kv-key' : '.kv-value');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [rows]);

  const update = (index, field, value) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    onChange(next);
  };

  const remove = (index) => {
    onChange(rows.filter((r, i) => i !== index));
  };

  const add = () => {
    onChange([...rows, { key: '', value: '', enabled: true }]);
    focusReq.current = { index: rows.length, field: 'key' };
  };

  /** 幽灵行输入 → 追加真实行并转移焦点 */
  const ghostInput = (field, value) => {
    onChange([...rows, { key: field === 'key' ? value : '', value: field === 'value' ? value : '', enabled: true }]);
    focusReq.current = { index: rows.length, field };
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(rowsToBulkText(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) { /* 剪贴板不可用时静默 */ }
  };

  const hasContent = rows.some((r) => r.key || r.value);

  /** 右键菜单：对选中文本进行 URL 编解码 */
  const handleValueContext = (e, index) => {
    const input = e.target;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === end) return; // 无选区不弹菜单
    e.preventDefault();
    const text = String(input.value).slice(start, end);
    setEncMenu({ x: e.clientX, y: e.clientY, index, start, end, text });
  };

  const applyEnc = (fn) => {
    if (!encMenu) return;
    const { index, start, end, text } = encMenu;
    try {
      const result = fn(text);
      const val = rows[index].value;
      const newVal = val.slice(0, start) + result + val.slice(end);
      update(index, 'value', newVal);
    } catch (e) { /* 转换失败静默 */ }
    setEncMenu(null);
  };

  // 点击外部关闭菜单
  useEffect(() => {
    if (!encMenu) return;
    const close = () => setEncMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [encMenu]);

  return (
    <div className="kv-editor">
      <div className="kv-toolbar">
        {label && <span className="kv-toolbar-label">{label}</span>}
        {toolbarExtra}
        <span className="flex-spacer" />
        {lockedRows.length > 0 && !bulk && (
          <button
            className={`icon-btn ${showLocked ? '' : 'on'}`}
            title={showLocked ? '隐藏自动生成项' : '显示自动生成项'}
            onClick={() => setShowLocked((v) => !v)}
          >
            <JbIcon name={showLocked ? 'eye' : 'eye-crossed'} size={14} />
          </button>
        )}
        {allowBulk && (
          <button
            className={`icon-btn kv-bulk-btn ${bulk ? 'on' : ''}`}
            title={bulk ? '返回表格编辑' : '批量文本编辑'}
            onClick={() => setBulk((v) => !v)}
          >{'{}'}</button>
        )}
        <button className="icon-btn" title="复制全部为文本" disabled={!hasContent} onClick={copyAll}>
          {copied ? <span className="kv-copied"><JbIcon name="checkmark" size={12} /></span> : <JbIcon name="copy" size={14} />}
        </button>
        {!bulk && (
          <button className="icon-btn" title="新增一行" onClick={add}>
            <JbIcon name="add" size={14} />
          </button>
        )}
        <button className="icon-btn" title="清空全部" disabled={!hasContent} onClick={() => onChange([])}>
          <JbIcon name="trash" size={14} />
        </button>
      </div>

      {bulk ? (
        <>
          <textarea
            className="body-textarea kv-bulk-textarea"
            placeholder={'每行一条：key: value\n以 # 开头的行为禁用项'}
            value={rowsToBulkText(rows)}
            onChange={(e) => onChange(bulkTextToRows(e.target.value))}
            spellCheck={false}
          />
          <div className="env-hint">格式：<code>key: value</code>，行首加 <code>#</code> 表示禁用该行</div>
        </>
      ) : (
        <div ref={bodyRef}>
          {keySuggestions.length > 0 && (
            <datalist id={listId}>
              {keySuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          )}
          <AnimatePresence initial={false}>
            {showLocked && lockedRows.length > 0 && (
              <motion.div
                key="locked"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.13, ease: 'easeOut' }}
              >
                {lockedRows.map((row) => (
                  <div key={row.key} className="kv-row kv-locked" title={row.hint || '由 ReqMock 在发送时自动生成'}>
                    <input type="checkbox" checked disabled />
                    <span className="kv-locked-key">
                      {row.key}
                      <span className="kv-lock-icon" aria-hidden="true">{row.mark ? <JbIcon name={row.mark} size={12} /> : <JbIcon name="lock" size={12} />}</span>
                    </span>
                    {row.value
                      ? <span className="kv-locked-value">{row.value}</span>
                      : <span className="kv-locked-value kv-locked-auto">默认自动生成</span>}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          {rows.map((row, i) => (
            <div key={i} className="kv-row" data-idx={i}>
              <input
                type="checkbox"
                checked={row.enabled !== false}
                onChange={(e) => update(i, 'enabled', e.target.checked)}
              />
              <input
                className="kv-key"
                placeholder={keyPlaceholder}
                value={row.key}
                list={keySuggestions.length > 0 ? listId : undefined}
                onChange={(e) => update(i, 'key', e.target.value)}
              />
              <VarInput
                className="kv-value"
                placeholder={valuePlaceholder}
                value={row.value}
                varNames={varNames}
                varMap={varMap}
                highlight="vars"
                onChange={(v) => update(i, 'value', v)}
                onContextMenu={(e) => handleValueContext(e, i)}
              />
              <span className="item-delete" title="删除此行" onClick={() => remove(i)}>×</span>
            </div>
          ))}
          <div className="kv-row kv-ghost">
            <input type="checkbox" checked={false} disabled />
            <input
              className="kv-key"
              placeholder={`${keyPlaceholder} ${rows.length + 1}`}
              value=""
              onChange={(e) => ghostInput('key', e.target.value)}
            />
            <input
              className="kv-value"
              placeholder={`${valuePlaceholder} ${rows.length + 1}`}
              value=""
              onChange={(e) => ghostInput('value', e.target.value)}
            />
            <span className="item-delete kv-ghost-pad">×</span>
          </div>
        </div>
      )}
      {encMenu && (
        <div
          className="kv-encode-menu"
          style={{ left: encMenu.x, top: encMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="kv-encode-menu-title">选中: {encMenu.text.length > 30 ? encMenu.text.slice(0, 30) + '…' : encMenu.text}</div>
          <button className="kv-encode-menu-item" onClick={() => applyEnc(encodeURI)}>URL Encode</button>
          <button className="kv-encode-menu-item" onClick={() => applyEnc(urlDecode)}>URL Decode</button>
          <button className="kv-encode-menu-item" onClick={() => applyEnc(encodeURIComponent)}>URL Encode (严格)</button>
          <button className="kv-encode-menu-item" onClick={() => applyEnc(decodeURIComponent)}>URL Decode (严格)</button>
        </div>
      )}
    </div>
  );
}

/** 键值行 → 批量文本（禁用行加 # 前缀） */
export function rowsToBulkText(rows) {
  return (rows || [])
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled === false ? '#' : ''}${r.key}: ${r.value ?? ''}`)
    .join('\n');
}

/** 批量文本 → 键值行 */
export function bulkTextToRows(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      let enabled = true;
      let s = line;
      if (s.trimStart().startsWith('#')) {
        enabled = false;
        s = s.trimStart().slice(1);
      }
      const ci = s.indexOf(':');
      if (ci < 0) return { key: s.trim(), value: '', enabled };
      return { key: s.slice(0, ci).trim(), value: s.slice(ci + 1).trim(), enabled };
    });
}
