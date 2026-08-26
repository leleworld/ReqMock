/**
 * 文本 Diff 工具：行级 LCS + 字符级高亮 + 分栏对齐
 */

const MAX_DP_LINES = 3000;

/**
 * 行级 diff — 返回 [{ type: 'same'|'add'|'del', text }]
 * @param {string} aText
 * @param {string} bText
 * @param {object} opts - { ignoreWhitespace: bool }
 */
export function diffLines(aText, bText, opts = {}) {
  const normalize = opts.ignoreWhitespace ? (s) => s.trim().replace(/\s+/g, ' ') : (s) => s;
  const a = String(aText ?? '').split('\n');
  const b = String(bText ?? '').split('\n');

  // 先剥离公共前缀/后缀，缩小 DP 规模
  let start = 0;
  while (start < a.length && start < b.length && normalize(a[start]) === normalize(b[start])) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && normalize(a[endA - 1]) === normalize(b[endB - 1])) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const result = [];
  for (let i = 0; i < start; i++) result.push({ type: 'same', text: a[i] });

  if (midA.length > MAX_DP_LINES || midB.length > MAX_DP_LINES) {
    for (const line of midA) result.push({ type: 'del', text: line });
    for (const line of midB) result.push({ type: 'add', text: line });
  } else {
    result.push(...lcsDiff(midA, midB, normalize));
  }

  for (let i = endA; i < a.length; i++) result.push({ type: 'same', text: a[i] });
  return result;
}

/** 标准 LCS 动态规划 + 回溯 */
function lcsDiff(a, b, normalize) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = normalize(a[i]) === normalize(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (normalize(a[i]) === normalize(b[j])) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

/** 统计 diff 结果的增删行数 */
export function diffStats(diff) {
  let added = 0, removed = 0, same = 0;
  for (const d of diff) {
    if (d.type === 'add') added++;
    else if (d.type === 'del') removed++;
    else same++;
  }
  return { added, removed, same, total: added + removed + same };
}

/** 计算相似度百分比（基于 LCS same 行占比） */
export function similarity(diff) {
  const s = diffStats(diff);
  if (s.total === 0) return 100;
  return Math.round((s.same / (s.same + Math.max(s.added, s.removed))) * 100);
}

/**
 * 字符级 diff — 对两行文本做字符级对比
 * 返回 [{ type: 'same'|'add'|'del', text }]
 */
export function diffChars(aLine, bLine) {
  const a = String(aLine ?? '');
  const b = String(bLine ?? '');
  if (a === b) return [{ type: 'same', text: a }];
  if (!a) return [{ type: 'add', text: b }];
  if (!b) return [{ type: 'del', text: a }];

  // 公共前后缀优化
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffA = a.length, suffB = b.length;
  while (suffA > prefix && suffB > prefix && a[suffA - 1] === b[suffB - 1]) { suffA--; suffB--; }

  const result = [];
  if (prefix > 0) result.push({ type: 'same', text: a.slice(0, prefix) });
  const midA = a.slice(prefix, suffA);
  const midB = b.slice(prefix, suffB);
  if (midA) result.push({ type: 'del', text: midA });
  if (midB) result.push({ type: 'add', text: midB });
  if (suffA < a.length) result.push({ type: 'same', text: a.slice(suffA) });
  return result;
}

/**
 * 将 diffLines 结果转为分栏对齐格式
 * 返回 [{ left: {lineNo, text, type, chars?}, right: {lineNo, text, type, chars?} }]
 * 相邻的 del+add 行配对显示为"修改行"（左删右增 + 字符级高亮）
 */
export function alignSideBySide(diff) {
  const rows = [];
  let leftNo = 0, rightNo = 0;
  let i = 0;

  while (i < diff.length) {
    const d = diff[i];

    if (d.type === 'same') {
      leftNo++;
      rightNo++;
      rows.push({
        left: { lineNo: leftNo, text: d.text, type: 'same' },
        right: { lineNo: rightNo, text: d.text, type: 'same' }
      });
      i++;
    } else if (d.type === 'del') {
      // 收集连续 del
      const dels = [];
      while (i < diff.length && diff[i].type === 'del') { dels.push(diff[i]); i++; }
      // 收集后续 add
      const adds = [];
      while (i < diff.length && diff[i].type === 'add') { adds.push(diff[i]); i++; }

      const maxLen = Math.max(dels.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        const delItem = dels[k];
        const addItem = adds[k];
        const left = delItem
          ? { lineNo: ++leftNo, text: delItem.text, type: addItem ? 'mod' : 'del', chars: addItem ? diffChars(delItem.text, addItem.text) : null }
          : { lineNo: null, text: '', type: 'empty' };
        const right = addItem
          ? { lineNo: ++rightNo, text: addItem.text, type: delItem ? 'mod' : 'add', chars: delItem ? diffChars(delItem.text, addItem.text) : null }
          : { lineNo: null, text: '', type: 'empty' };
        rows.push({ left, right });
      }
    } else {
      // standalone add (shouldn't happen in valid LCS output but handle gracefully)
      rightNo++;
      rows.push({
        left: { lineNo: null, text: '', type: 'empty' },
        right: { lineNo: rightNo, text: d.text, type: 'add' }
      });
      i++;
    }
  }

  return rows;
}
