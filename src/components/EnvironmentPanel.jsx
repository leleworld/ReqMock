import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { JbIcon } from './Icons.jsx';
import KeyValueEditor from './KeyValueEditor.jsx';
import { buildVarMap } from '../utils/envUtil.js';

/** 环境警示色候选：切换器色点 + 请求栏色条，避免发错环境（典型：红=生产，绿=测试） */
const ENV_COLORS = ['#e5534b', '#e8a03e', '#3fb28f', '#4f8cf7', '#a06bd8', '#d85f9c'];

/**
 * 解析 .env 文件内容为 [{key, value}] 数组
 * 规则：忽略空行和 # 注释行；KEY=value 格式；支持双引号/单引号包裹值（去引号）
 */
function parseDotEnv(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // 去掉引号包裹
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.push({ key, value });
  }
  return result;
}

/**
 * 将环境变量数组序列化为 .env 格式文本
 */
function serializeDotEnv(variables) {
  return (variables || [])
    .filter((v) => v.enabled !== false && v.key)
    .map((v) => {
      const val = v.value || '';
      // 含空格或特殊字符时用双引号包裹
      const needsQuote = /\s/.test(val);
      return `${v.key}=${needsQuote ? `"${val}"` : val}`;
    })
    .join('\n');
}

/** 生成唯一 id */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 环境编辑面板（主区域）：环境名称 + 警示色 + 变量键值表；isGlobal 时为全局变量模式
 * 生效预览：展示与全局变量/激活环境合并后最终生效的变量值及来源
 */
export default function EnvironmentPanel({ environment, isActive, isGlobal, globals = [], activeEnv = null, onChange, onDelete, onActivate, onExport }) {
  const [showPreview, setShowPreview] = useState(false);

  if (!environment) {
    return (
      <div className="env-panel">
        <div className="response-placeholder">在左侧选择或新建一个环境</div>
      </div>
    );
  }

  // 生效预览：全局页 = 全局变量与激活环境合并；环境页 = 该环境激活时与全局变量合并
  const previewEnv = isGlobal ? activeEnv : environment;
  const previewGlobals = isGlobal ? environment.variables : globals;
  const finalMap = buildVarMap(previewEnv, previewGlobals);
  const envKeys = new Set(
    ((previewEnv && previewEnv.variables) || []).filter((v) => v.enabled !== false && v.key).map((v) => v.key)
  );
  const globalKeys = new Set(
    (previewGlobals || []).filter((v) => v.enabled !== false && v.key).map((v) => v.key)
  );
  const previewEntries = Object.entries(finalMap).map(([k, v]) => ({
    key: k,
    value: v,
    source: envKeys.has(k) ? (globalKeys.has(k) ? 'override' : 'env') : 'global'
  }));
  const sourceLabel = {
    env: isGlobal ? (previewEnv ? previewEnv.name : '环境') : '环境',
    global: '全局',
    override: isGlobal ? `被「${previewEnv ? previewEnv.name : '环境'}」覆盖` : '覆盖全局'
  };

  return (
    <div className="env-panel">
      <div className="env-header">
        {isGlobal ? (
          <span className="env-name-input env-name-static"><JbIcon name="galaxy" size={13} /> 全局变量</span>
        ) : (
          <input
            className="env-name-input"
            value={environment.name}
            onChange={(e) => onChange({ ...environment, name: e.target.value })}
            placeholder="环境名称"
          />
        )}
        {!isGlobal && (isActive
          ? <span className="env-active-badge">当前激活</span>
          : <button className="btn-secondary" onClick={() => onActivate(environment.id)}>设为激活</button>)}
        {!isGlobal && (
          <span className="env-color-picker" title="环境警示色：显示在顶栏切换器与请求栏，避免发错环境">
            {ENV_COLORS.map((c) => (
              <span
                key={c}
                className={`ctx-color ${environment.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => onChange({ ...environment, color: environment.color === c ? '' : c })}
              />
            ))}
          </span>
        )}
        <span className="flex-spacer" />
        <button
          className={`btn-secondary ${showPreview ? 'btn-toggled' : ''}`}
          title="预览与全局变量合并后的最终生效值"
          onClick={() => setShowPreview((v) => !v)}
        >生效预览</button>
        {onExport && (
          <button className="btn-secondary" title="导出为 JSON 文件" onClick={() => onExport(environment)}>导出</button>
        )}
        <button
          className="btn-secondary btn-env-file"
          title="导入 .env 文件，合并到当前环境变量（同名覆盖）"
          onClick={async () => {
            const res = await window.api.importFile({ filters: [{ name: '.env', extensions: ['env', 'txt', '*'] }] });
            if (!res || !res.content) return;
            const parsed = parseDotEnv(res.content);
            if (parsed.length === 0) return;
            const vars = [...(environment.variables || [])];
            for (const item of parsed) {
              const idx = vars.findIndex((v) => v.key === item.key);
              if (idx >= 0) {
                vars[idx] = { ...vars[idx], value: item.value, enabled: true };
              } else {
                vars.push({ id: uid(), key: item.key, value: item.value, enabled: true });
              }
            }
            onChange({ ...environment, variables: vars });
          }}
        >导入 .env</button>
        <button
          className="btn-secondary btn-env-file"
          title="导出当前环境变量为 .env 格式文件"
          onClick={async () => {
            const content = serializeDotEnv(environment.variables);
            const defaultName = `${environment.name || 'env'}.env`;
            await window.api.exportFile({ content, defaultName, filters: [{ name: '.env', extensions: ['env'] }] });
          }}
        >导出 .env</button>
        {!isGlobal && (
          <button className="btn-secondary btn-danger" onClick={() => onDelete(environment.id)}>删除环境</button>
        )}
      </div>
      <div className="env-hint">
        {isGlobal
          ? <>全局变量对所有环境生效，无需激活；与激活环境同名时以环境变量为准</>
          : <>变量在请求的 URL / Params / Headers / Body 中以 <code>{'{{变量名}}'}</code> 引用，仅激活环境生效</>}
      </div>
      <AnimatePresence initial={false}>
        {showPreview && (
          <motion.div
            className="env-preview"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="env-preview-title">
              {isGlobal
                ? (previewEnv ? `与激活环境「${previewEnv.name}」合并后的最终生效值` : '未激活环境，以下为当前生效的全局变量')
                : `该环境激活时，与全局变量合并后的最终生效值${isActive ? '（当前即此结果）' : ''}`}
            </div>
            {previewEntries.length === 0 && <div className="empty-hint">暂无启用的变量</div>}
            {previewEntries.map((e) => (
              <div key={e.key} className="env-preview-row" title={`{{${e.key}}}`}>
                <span className="env-preview-key">{e.key}</span>
                <span className="env-preview-val">{String(e.value) || '（空）'}</span>
                <span className={`env-preview-src env-preview-src-${e.source}`}>{sourceLabel[e.source]}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="env-vars">
        <KeyValueEditor
          rows={environment.variables}
          onChange={(rows) => onChange({ ...environment, variables: rows })}
          keyPlaceholder="变量名"
          valuePlaceholder="变量值"
        />
      </div>
    </div>
  );
}
