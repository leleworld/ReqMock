import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, placeholder as cmPlaceholder, Decoration, ViewPlugin } from '@codemirror/view';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
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
 * 3. 性能优化：基于行扫描（非字符扫描），大文件时限制最大扫描行数
 */
const FOLD_MAX_LINES = 50000; // 超过此行数不进行折叠计算
const jsonBracketFold = foldService.of((state, lineStart, lineEnd) => {
  if (state.doc.lines > FOLD_MAX_LINES) return null;
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  const trimmed = text.trimEnd();
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== '{' && lastChar !== '[') return null;
  const closeChar = lastChar === '{' ? '}' : ']';
  // 基于行扫描匹配括号（快速：仅统计每行的开闭括号数，跳过字符串内容）
  let depth = 1;
  const totalLines = state.doc.lines;
  let lineNo = line.number + 1;
  while (lineNo <= totalLines && depth > 0) {
    const ln = state.doc.line(lineNo);
    const t = ln.text;
    let inStr = false;
    for (let i = 0, len = t.length; i < len; i++) {
      const ch = t[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === lastChar) depth++;
        else if (ch === closeChar) {
          depth--;
          if (depth === 0) {
            // 闭括号保留在独立行，折叠范围到其前一行末尾
            const foldEnd = ln.from - 1;
            if (foldEnd <= line.to) return null;
            return { from: line.to, to: foldEnd };
          }
        }
      }
    }
    lineNo++;
  }
  return null;
});

/** 搜索高亮装饰：普通命中 */
const hitDeco = Decoration.mark({ class: 'cm-search-hit' });
/** 搜索高亮装饰：当前活跃命中 */
const activeHitDeco = Decoration.mark({ class: 'cm-search-hit-active' });

/** 搜索查询状态字段：{ query: RegExp | null, activeIdx: number, positions: Array<{from:number,to:number}> | null } */
const setSearchQueryEffect = StateEffect.define();
const searchQueryField = StateField.define({
  create: () => ({ query: null, activeIdx: -1, positions: null }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchQueryEffect)) return e.value;
    }
    return value;
  }
});

/** 搜索高亮 ViewPlugin：根据 searchQueryField 生成装饰 */
const searchHighlightPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
  }
  update(update) {
    if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQueryEffect)))) {
      this.decorations = this.buildDecorations(update.view);
    }
  }
  buildDecorations(view) {
    const { query, activeIdx, positions } = view.state.field(searchQueryField);
    if (!query || !positions) return Decoration.none;
    const builder = [];
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const deco = i === activeIdx ? activeHitDeco : hitDeco;
      builder.push(deco.range(pos.from, pos.to));
    }
    return Decoration.set(builder, true);
  }
}, {
  decorations: (v) => v.decorations
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
export default function CodeEditor({ value, onChange, language = 'text', placeholder = '', readOnly = false, lineWrap = true, className = '', searchQuery }) {
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
      foldGutter({ openText: '\u25BE', closedText: '\u25B8' }),
      bracketMatching(),
      search({ top: true }),
      highlightSelectionMatches(),
      syntaxHighlighting(themeHighlight),
      searchQueryField,
      searchHighlightPlugin,
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

  // 外部搜索查询变化时同步到 CodeMirror 装饰，并滚动到当前命中
  const searchQueryRef = useRef(null);
  searchQueryRef.current = searchQuery;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const sq = searchQuery || { query: null, activeIdx: -1 };
    // 计算匹配位置
    let positions = null;
    if (sq.query) {
      positions = [];
      const text = view.state.doc.toString();
      const re = new RegExp(sq.query.source, sq.query.flags.includes('g') ? sq.query.flags : sq.query.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        positions.push({ from: m.index, to: m.index + m[0].length });
        if (positions.length > 5000) break;
      }
    }
    view.dispatch({ effects: setSearchQueryEffect.of({ ...sq, positions }) });
    // 延迟滚动：等 CodeMirror 渲染完装饰后再滚动到当前命中位置
    if (sq.activeIdx >= 0 && positions && positions[sq.activeIdx]) {
      const pos = positions[sq.activeIdx];
      setTimeout(() => {
        if (viewRef.current) {
          viewRef.current.dispatch({
            effects: EditorView.scrollIntoView(pos.from, { y: 'center' })
          });
        }
      }, 50);
    }
  }, [searchQuery]);

  return <div className={`code-editor ${className}`} ref={hostRef} />;
}
