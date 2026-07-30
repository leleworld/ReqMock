import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { codeFolding, foldGutter, foldKeymap, foldService, bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { tags } from '@lezer/highlight';

/**
 * 自定义 JSON 折叠服务（Reqable 风格）：
 * 1. 确保所有层级（含根对象/顶层属性）都能折叠
 * 2. 折叠后闭合括号保留在独立行并显示原始行号
 */
const jsonBracketFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  const trimmed = text.trimEnd();
  // 行尾为 { 或 [ 时尝试找到匹配的闭括号
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== '{' && lastChar !== '[') return null;
  const openChar = lastChar;
  const closeChar = openChar === '{' ? '}' : ']';
  // 从该括号之后开始向下扫描匹配
  let depth = 1;
  let pos = line.to + 1; // 跳过换行符
  const docLen = state.doc.length;
  let inStr = false;
  while (pos < docLen && depth > 0) {
    const ch = state.doc.sliceString(pos, pos + 1);
    if (inStr) {
      if (ch === '\\') { pos += 2; continue; }
      if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          // Reqable 风格：折叠范围到闭括号行前的换行符之前，
          // 使闭括号保留在独立行并显示其原始行号
          const closeLine = state.doc.lineAt(pos);
          const foldEnd = closeLine.from - 1; // 换行符位置
          if (foldEnd <= line.to) return null; // 相邻行无需折叠
          return { from: line.to, to: foldEnd };
        }
      }
    }
    pos++;
  }
  return null;
});

/** 语法高亮映射到全局 .tok-* 类，随 8 套主题的 CSS 变量自动换色 */
const themeHighlight = HighlightStyle.define([
  { tag: tags.propertyName, class: 'tok-key' },
  { tag: tags.string, class: 'tok-string' },
  { tag: [tags.number, tags.regexp], class: 'tok-number' },
  { tag: tags.bool, class: 'tok-boolean' },
  { tag: tags.null, class: 'tok-null' },
  { tag: [tags.keyword, tags.operatorKeyword], class: 'tok-boolean' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-key' },
  { tag: tags.comment, class: 'tok-comment' }
]);

/**
 * 基于 CodeMirror 6 的代码编辑器/查看器
 * 内置：行号、层级折叠、括号匹配、Ctrl+F 搜索、撤销历史、JSON/JS 语法高亮
 * @param language 'json' | 'javascript' | 'text'
 * @param readOnly 只读模式（响应 Pretty 视图）
 * @param lineWrap 自动换行（关闭后横向滚动）
 */
export default function CodeEditor({ value, onChange, language = 'text', placeholder = '', readOnly = false, lineWrap = true, className = '' }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  // 回调与初始文档走 ref，避免重建编辑器或闭包过期
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const extensions = [
      codeFolding({ placeholderText: '\u22EF' }),
      lineNumbers(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      bracketMatching(),
      search({ top: true }),
      highlightSelectionMatches(),
      syntaxHighlighting(themeHighlight),
      keymap.of([...defaultKeymap, ...foldKeymap, ...searchKeymap])
    ];
    if (language === 'json' || language === 'text') extensions.push(jsonBracketFold);
    if (lineWrap) extensions.push(EditorView.lineWrapping);
    if (language === 'json') extensions.push(json());
    if (language === 'javascript') extensions.push(javascript());
    if (placeholder) extensions.push(cmPlaceholder(placeholder));
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    } else {
      extensions.push(
        history(),
        indentOnInput(),
        closeBrackets(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...closeBracketsKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChangeRef.current) onChangeRef.current(u.state.doc.toString());
        })
      );
    }
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: valueRef.current || '', extensions })
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [language, readOnly, placeholder, lineWrap]);

  // 外部 value 变化（切换标签/响应更新）时同步文档，避免光标位置丢失只在内容确实不同步时替换
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if ((value || '') !== cur) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value || '' } });
    }
  }, [value]);

  return <div className={`code-editor ${className}`} ref={hostRef} />;
}
