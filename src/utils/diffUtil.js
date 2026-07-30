/**
 * 文本 Diff 工具：基于行级 LCS 的对比
 * diffLines 返回 [{ type: 'same'|'add'|'del', text }]
 */

const MAX_DP_LINES = 3000;

export function diffLines(aText, bText) {
  const a = String(aText ?? '').split('\n');
  const b = String(bText ?? '').split('\n');

  // 先剥离公共前缀/后缀，缩小 DP 规模
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const result = [];
  for (let i = 0; i < start; i++) result.push({ type: 'same', text: a[i] });

  if (midA.length > MAX_DP_LINES || midB.length > MAX_DP_LINES) {
    // 超大文本降级：中间部分直接视为整体替换
    for (const line of midA) result.push({ type: 'del', text: line });
    for (const line of midB) result.push({ type: 'add', text: line });
  } else {
    result.push(...lcsDiff(midA, midB));
  }

  for (let i = endA; i < a.length; i++) result.push({ type: 'same', text: a[i] });
  return result;
}

/** 标准 LCS 动态规划 + 回溯 */
function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

/** 统计 diff 结果的增删行数 */
export function diffStats(diff) {
  let added = 0, removed = 0;
  for (const d of diff) {
    if (d.type === 'add') added++;
    else if (d.type === 'del') removed++;
  }
  return { added, removed };
}
