/**
 * 主题系统：明暗模式 + 强调色
 * 通过 documentElement 的 data-theme / data-accent 属性驱动 CSS 变量
 */

/* IDEA 预置主题：Islands 系列 + 经典系列，dark 标记用于明暗图标 */
export const THEMES = [
  { value: 'islands-dark', label: 'Islands Dark', dark: true },
  { value: 'islands-light', label: 'Islands Light', dark: false },
  { value: 'islands-darcula', label: 'Islands Darcula', dark: true },
  { value: 'high-contrast', label: 'High Contrast', dark: true },
  { value: 'dark', label: 'Dark', dark: true },
  { value: 'light', label: 'Light', dark: false },
  { value: 'light-header', label: 'Light with Light Header', dark: false },
  { value: 'darcula', label: 'Darcula', dark: true }
];

export const ACCENTS = [
  { value: 'blue', label: '蓝', color: '#4a8cf7' },
  { value: 'green', label: '绿', color: '#4caf7d' },
  { value: 'purple', label: '紫', color: '#a06fd6' },
  { value: 'orange', label: '橙', color: '#e0a04f' },
  { value: 'red', label: '红', color: '#e05f5f' },
  { value: 'cyan', label: '青', color: '#3fb6b2' }
];

export const LAYOUTS = [
  { value: 'vertical', label: '上下分栏' },
  { value: 'horizontal', label: '左右分栏' }
];

/** 数值型设置项归一：非法值回退默认，并限制在合法区间内 */
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(s) {
  const settings = s || {};
  return {
    theme: THEMES.some((t) => t.value === settings.theme) ? settings.theme : 'dark',
    accent: ACCENTS.some((a) => a.value === settings.accent) ? settings.accent : 'blue',
    layout: LAYOUTS.some((l) => l.value === settings.layout) ? settings.layout : 'vertical',
    cookiesEnabled: settings.cookiesEnabled !== false,
    // 可拖拽布局：侧栏宽度 / 请求响应分栏比例（上下布局取高度%，左右布局取宽度%）
    sidebarWidth: clampNum(settings.sidebarWidth, 200, 420, 264),
    splitV: clampNum(settings.splitV, 25, 75, 45),
    splitH: clampNum(settings.splitH, 25, 75, 50)
  };
}

/** 把主题设置应用到文档根元素 */
export function applyTheme(settings) {
  const { theme, accent } = normalizeSettings(settings);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
}
