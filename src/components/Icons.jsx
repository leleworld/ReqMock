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
import earthSvg from '@jetbrains/icons/earth.svg?raw';
import galaxySvg from '@jetbrains/icons/galaxy.svg?raw';
import archiveSvg from '@jetbrains/icons/archive.svg?raw';
import servicesSvg from '@jetbrains/icons/services.svg?raw';
import puzzleSvg from '@jetbrains/icons/puzzle.svg?raw';
import playSvg from '@jetbrains/icons/play.svg?raw';
import stopSvg from '@jetbrains/icons/stop.svg?raw';
import linkSvg from '@jetbrains/icons/link.svg?raw';
import activitySvg from '@jetbrains/icons/activity.svg?raw';
import terminalSvg from '@jetbrains/icons/terminal.svg?raw';
import quickGuideSvg from '@jetbrains/icons/quick-guide.svg?raw';
import checkmarkSvg from '@jetbrains/icons/checkmark.svg?raw';
import closeSvg from '@jetbrains/icons/close.svg?raw';
import warningSvg from '@jetbrains/icons/warning.svg?raw';
import infoSvg from '@jetbrains/icons/info.svg?raw';
import pencilSvg from '@jetbrains/icons/pencil.svg?raw';
import caretDownSvg from '@jetbrains/icons/caret-down.svg?raw';
import updateSvg from '@jetbrains/icons/update.svg?raw';
import changeSvg from '@jetbrains/icons/change.svg?raw';
import fileSvg from '@jetbrains/icons/file.svg?raw';
import chevronDownSvg from '@jetbrains/icons/chevron-down.svg?raw';
import chevronRightSvg from '@jetbrains/icons/chevron-right.svg?raw';
import chevronLeftSvg from '@jetbrains/icons/chevron-left.svg?raw';
import timeSvg from '@jetbrains/icons/time.svg?raw';
import diceSvg from '@jetbrains/icons/dice.svg?raw';
import compareSvg from '@jetbrains/icons/compare.svg?raw';
import lockSvg from '@jetbrains/icons/lock.svg?raw';
import collapseSvg from '@jetbrains/icons/collapse.svg?raw';
import locateSvg from '@jetbrains/icons/locate.svg?raw';
import moreOptionsSvg from '@jetbrains/icons/more-options.svg?raw';
import doubleChevronRightSvg from '@jetbrains/icons/double-chevron-right.svg?raw';

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
  pin: pinSvg,
  earth: earthSvg,
  galaxy: galaxySvg,
  archive: archiveSvg,
  services: servicesSvg,
  puzzle: puzzleSvg,
  play: playSvg,
  stop: stopSvg,
  link: linkSvg,
  activity: activitySvg,
  terminal: terminalSvg,
  'quick-guide': quickGuideSvg,
  checkmark: checkmarkSvg,
  close: closeSvg,
  warning: warningSvg,
  info: infoSvg,
  pencil: pencilSvg,
  'caret-down': caretDownSvg,
  update: updateSvg,
  change: changeSvg,
  file: fileSvg,
  'chevron-down': chevronDownSvg,
  'chevron-right': chevronRightSvg,
  'chevron-left': chevronLeftSvg,
  time: timeSvg,
  dice: diceSvg,
  compare: compareSvg,
  lock: lockSvg,
  collapse: collapseSvg,
  locate: locateSvg,
  'more-options': moreOptionsSvg,
  'double-chevron-right': doubleChevronRightSvg
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
