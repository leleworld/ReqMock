import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { JbIcon } from './Icons.jsx';

/**
 * 右侧上下文工具条（Apifox/IDEA 式竖条）：
 * - 代码 / cURL：请求标签下直接触发生成代码弹窗、复制 cURL
 * - 文档 / 变量：以内嵌抽屉展开接口文档编辑与激活变量预览
 */
export default function UtilBar({
  isRequestTab, request, onChangeRequest,
  onCodegen, onCopyCurl, varMap, activeEnvName
}) {
  // 当前展开的抽屉：'doc' | 'vars' | null
  const [drawer, setDrawer] = useState(null);
  const toggle = (key) => setDrawer(drawer === key ? null : key);

  const varEntries = Object.entries(varMap || {});

  return (
    <>
      <AnimatePresence initial={false}>
        {drawer && (
          <motion.div
            className="util-drawer"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="util-drawer-inner">
              <div className="util-drawer-head">
                <span>{drawer === 'doc' ? '接口文档' : '变量预览'}</span>
                <span className="flex-spacer" />
                <button className="btn-text" onClick={() => setDrawer(null)}><JbIcon name="close" size={12} /></button>
              </div>
              {drawer === 'doc' && (
                isRequestTab && request ? (
                  <textarea
                    className="util-doc-textarea"
                    placeholder="接口说明（支持在导出 Markdown 文档时一并输出）…"
                    value={request.doc || ''}
                    onChange={(e) => onChangeRequest({ ...request, doc: e.target.value })}
                  />
                ) : (
                  <div className="empty-hint" style={{ padding: 12 }}>切换到请求标签后可编辑接口文档</div>
                )
              )}
              {drawer === 'vars' && (
                <div className="util-vars">
                  <div className="env-hint">
                    {activeEnvName ? `激活环境：${activeEnvName}（含全局变量）` : '未激活环境，仅全局变量生效'}
                  </div>
                  {varEntries.length === 0 && <div className="empty-hint">暂无可用变量</div>}
                  {varEntries.map(([k, v]) => (
                    <div key={k} className="util-var-row" title={`{{${k}}}`}>
                      <span className="util-var-key">{k}</span>
                      <span className="util-var-val">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="util-bar">
        <button
          className="util-btn"
          disabled={!isRequestTab}
          title={isRequestTab ? '生成多语言调用代码' : '仅请求标签可用'}
          onClick={onCodegen}
        >
          <span className="util-icon">{'</>'}</span>
          <span className="util-label">代码</span>
        </button>
        <button
          className="util-btn"
          disabled={!isRequestTab}
          title={isRequestTab ? '复制为 cURL 命令' : '仅请求标签可用'}
          onClick={onCopyCurl}
        >
          <span className="util-icon">⧉</span>
          <span className="util-label">cURL</span>
        </button>
        <button
          className={`util-btn ${drawer === 'doc' ? 'active' : ''}`}
          title="接口文档"
          onClick={() => toggle('doc')}
        >
          <span className="util-icon">¶</span>
          <span className="util-label">文档</span>
        </button>
        <button
          className={`util-btn ${drawer === 'vars' ? 'active' : ''}`}
          title="激活环境变量预览"
          onClick={() => toggle('vars')}
        >
          <span className="util-icon"><JbIcon name="galaxy" size={14} /></span>
          <span className="util-label">变量</span>
        </button>
      </div>
    </>
  );
}
