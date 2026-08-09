/**
 * framer-motion 统一动效参数（克制微动：120–200ms、4–8px 位移）
 * 所有组件从这里取预设，保证全应用动效节奏一致
 */

/** 全应用统一减速曲线（Material standard decelerate）：起步快、收尾柔，消除线性机械感 */
export const paneEase = [0.32, 0.72, 0, 1];

/** 主区页面/响应内容入场：轻微上移淡入 */
export const pageIn = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: paneEase }
};

/** 弹窗遮罩淡入淡出 */
export const maskFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.13 }
};

/** 弹窗主体缩放入场 */
export const modalPop = {
  initial: { opacity: 0, scale: 0.97, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 6 },
  transition: { duration: 0.16, ease: 'easeOut' }
};

/** Toast 底部上滑（x 固定 -50% 保持水平居中，避免覆盖 CSS 定位） */
export const toastSlide = {
  initial: { opacity: 0, y: 12, x: '-50%' },
  animate: { opacity: 1, y: 0, x: '-50%' },
  exit: { opacity: 0, y: 8, x: '-50%' },
  transition: { duration: 0.18, ease: 'easeOut' }
};

/** 通知中心弹层升起 */
export const popoverRise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: 0.16, ease: 'easeOut' }
};

/** 导航面板展开/收起：宽度过渡（内容层固定宽度避免文字回流） */
export const panelSlide = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 264, opacity: 1 },
  exit: { width: 0, opacity: 0 },
  transition: { duration: 0.18, ease: 'easeOut' }
};

/** 未读角标弹簧（唯一使用弹簧的地方，突出新消息） */
export const badgeSpring = {
  initial: { scale: 0.5 },
  animate: { scale: 1 },
  transition: { type: 'spring', stiffness: 500, damping: 24 }
};

/** 页签/面板内容切换：比 pageIn 更短更轻，频繁切换不打断操作节奏 */
export const tabIn = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.16, ease: paneEase }
};

/**
 * 主区面板方向滑动 + 交叉淡出：配合 AnimatePresence(mode="sync") 与 custom={dir} 使用
 * dir=1 新面板从右滑入、旧面板向左淡出；dir=-1 反之
 * 容器需为 grid（子项 grid-area:1/1 叠放），旧面板退场不占位
 */
export const paneSlide = {
  variants: {
    enter: (dir) => ({ opacity: 0, x: (dir || 1) * 14 }),
    center: { opacity: 1, x: 0 },
    exit: (dir) => ({ opacity: 0, x: (dir || 1) * -8, pointerEvents: 'none', transition: { duration: 0.12, ease: paneEase } })
  },
  initial: 'enter',
  animate: 'center',
  exit: 'exit',
  transition: { duration: 0.18, ease: paneEase }
};

/** 页签左右抽拉切换：配合 custom={dir} 使用，dir=1 从右滑入、-1 从左滑入 */
export const tabSlide = {
  variants: {
    enter: (dir) => ({ opacity: 0, x: (dir || 1) * 28 }),
    center: { opacity: 1, x: 0 }
  },
  initial: 'enter',
  animate: 'center',
  transition: { duration: 0.16, ease: 'easeOut' }
};
