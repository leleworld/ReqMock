import React from 'react';
// JetBrains 官方图标库（IDEA / Ring UI 同款设计语言），Vite ?raw 内联 SVG 源码
import searchSvg from '@jetbrains/icons/search.svg?raw';
import wrapSvg from '@jetbrains/icons/wrap.svg?raw';
import copySvg from '@jetbrains/icons/copy.svg?raw';
import downloadSvg from '@jetbrains/icons/download.svg?raw';
import folderSvg from '@jetbrains/icons/folder.svg?raw';
import parametersSvg from '@jetbrains/icons/parameters.svg?raw';
import cloudSvg from '@jetbrains/icons/cloud.svg?raw';
import dataSvg from '@jetbrains/icons/data.svg?raw';
import historySvg from '@jetbrains/icons/history.svg?raw';
import magicWandSvg from '@jetbrains/icons/magic-wand.svg?raw';
import bellSvg from '@jetbrains/icons/bell.svg?raw';
import themeSvg from '@jetbrains/icons/theme.svg?raw';
import newWindowSvg from '@jetbrains/icons/new-window.svg?raw';
import settingsSvg from '@jetbrains/icons/settings.svg?raw';
import importSvg from '@jetbrains/icons/import.svg?raw';
import exportSvg from '@jetbrains/icons/export.svg?raw';
import addSvg from '@jetbrains/icons/add.svg?raw';
import eyeSvg from '@jetbrains/icons/eye.svg?raw';
import eyeCrossedSvg from '@jetbrains/icons/eye-crossed.svg?raw';
import trashSvg from '@jetbrains/icons/trash.svg?raw';
import pinSvg from '@jetbrains/icons/pin-filled.svg?raw';

/** 图标名 -> SVG 源码映射，新增图标时在此登记 */
export const ICONS = {
  search: searchSvg,
  wrap: wrapSvg,
  copy: copySvg,
  download: downloadSvg,
  folder: folderSvg,
  parameters: parametersSvg,
  cloud: cloudSvg,
  data: dataSvg,
  history: historySvg,
  'magic-wand': magicWandSvg,
  bell: bellSvg,
  theme: themeSvg,
  'new-window': newWindowSvg,
  settings: settingsSvg,
  import: importSvg,
  export: exportSvg,
  add: addSvg,
  eye: eyeSvg,
  'eye-crossed': eyeCrossedSvg,
  trash: trashSvg,
  pin: pinSvg
};

/**
 * JetBrains 图标渲染器：SVG 以 currentColor 填充，
 * 颜色随所在元素文字色/主题自动变化。
 * @param name ICONS 中登记的图标名
 * @param size 显示尺寸（原始网格 16px）
 */
export function JbIcon({ name, size = 16, className = '' }) {
  const svg = ICONS[name];
  if (!svg) return null;
  return (
    <span
      className={`jb-icon ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
