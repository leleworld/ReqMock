/**
 * 应用内实时调用千问（OpenAI 兼容端点，默认 DashScope compatible-mode）。
 * 主进程用 Node 全局 fetch 流式读取 SSE，逐段回调渲染层，实现边生成边显示。
 * 连接参数来自 store.settings.ai = { enabled, baseUrl, apiKey, model }，在 设置→AI 分析 配置。
 */
const active = new Map(); // id -> AbortController

/**
 * 流式对话。
 * @param {object} p {id, baseUrl, apiKey, model, messages, onDelta(text)}
 * @returns {Promise<{ok:boolean, text?:string, error?:string, aborted?:boolean}>}
 */
async function chatStream({ id, baseUrl, apiKey, model, messages, onDelta }) {
  const ac = new AbortController();
  if (id) active.set(id, ac);
  const url = String(baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '') + '/chat/completions';
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (apiKey || '') },
      body: JSON.stringify({ model: model || 'qwen-plus', messages, stream: true })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 240)}` };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const o = JSON.parse(payload);
          const d = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
          if (d) { full += d; if (onDelta) onDelta(d); }
        } catch { /* 非完整 JSON 片段，忽略 */ }
      }
    }
    return { ok: true, text: full };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    if (id) active.delete(id);
  }
}

function abortChat(id) {
  const ac = active.get(id);
  if (ac) { ac.abort(); active.delete(id); }
}

module.exports = { chatStream, abortChat };
