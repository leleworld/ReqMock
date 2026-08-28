/**
 * 键盘可达性垫片（过渡方案）
 *
 * 现状：全项目有上百处用 div/span + onClick 实现的点击控件（标签项、标签关闭、
 * 集合树行、树内图标、列表项、右键菜单项、分组牌…），它们既不能 Tab 聚焦，
 * 也不响应 Enter/Space —— 读屏器里只暴露为「无名称的 Group」。
 *
 * 为什么用垫片而不是逐个换成原生 <button>：
 *   原生 button 自带 padding/border/font/background 重置，这批控件的布局 CSS
 *   是按 div/span 写的，逐个替换会牵动上百处样式，回归风险远大于收益。
 *   这里集中补齐三件事：role="button"、tabIndex=0、Enter/Space 触发 click。
 *   焦点环由 styles.css 里已有的 `[tabindex]:focus-visible` 规则自动接管。
 *
 * 新增组件请直接使用原生 <button>，不要依赖本垫片。
 */

// 已知的「div/span 点击控件」类名。列表可以放宽：原生可交互元素会在 upgrade() 里被跳过
const SELECTOR = [
  '.tab-item', '.tab-close', '.tab-group-chip', '.tab-rename-input',
  '.ctx-item', '.ctx-color',
  '.tree-row', '.tree-action', '.item-delete', '.kv-ghost-pad',
  '.list-item', '.panel-collapse', '.history-group-head',
  '.welcome-link', '.welcome-card', '.env-quick-switch-item',
  '.notice-item', '.sp-item-row', '.tool-list-item',
].join(',');

// 原生可交互元素：已由浏览器负责键盘行为，不要重复接管
const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/;

/** 是否处于可编辑上下文（避免在重命名输入框里按 Enter 误触发外层控件） */
function isEditable(el) {
  if (!el || !el.tagName) return true;
  if (NATIVE.test(el.tagName) && el.tagName !== 'A') return true;
  return el.isContentEditable === true;
}

function upgrade(el) {
  if (el.dataset.a11yClick) return;
  if (NATIVE.test(el.tagName)) return;
  el.dataset.a11yClick = '1';
  if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
}

/**
 * 初始化垫片。必须在用户第一次按键前调用；返回取消函数。
 * @param {ParentNode} root 扫描根，默认 document
 */
export function initA11yClicks(root = document) {
  root.querySelectorAll(SELECTOR).forEach(upgrade);

  // 动态渲染（菜单展开、树节点增删、列表刷新）时增量升级新节点。
  // 注意：不要套 requestAnimationFrame 做去抖——后台标签页里 rAF 被节流，
  // 菜单/弹层节点会永远得不到升级（MutationObserver 回调本身已由浏览器批处理）。
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches(SELECTOR)) upgrade(n);
        if (n.querySelectorAll) n.querySelectorAll(SELECTOR).forEach(upgrade);
      }
    }
  });
  mo.observe(root === document ? document.body : root, { childList: true, subtree: true });

  // Enter / Space 激活当前聚焦的自定义控件（Space 要阻止默认滚动）
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (isEditable(t)) return; // 输入框内的 Enter 归输入框自己
    const el = t.closest && t.closest(SELECTOR);
    if (!el || NATIVE.test(el.tagName)) return;
    e.preventDefault();
    el.click();
  };
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    mo.disconnect();
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
