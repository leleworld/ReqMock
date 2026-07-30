/**
 * JSON 格式化 Web Worker
 * 将 JSON.parse + JSON.stringify 卸载到独立线程，避免阻塞 UI
 * 只返回 pretty 文本（不传 parsed 对象），避免 structured clone 序列化开销
 * Tree 视图按需从原始 body 懒解析，整体仍比原来少 2 次 parse
 */
self.onmessage = function (e) {
  const { id, body } = e.data;
  try {
    const parsed = JSON.parse(body);
    const pretty = JSON.stringify(parsed, null, 2);
    self.postMessage({ id, ok: true, pretty });
  } catch (_err) {
    self.postMessage({ id, ok: false });
  }
};
