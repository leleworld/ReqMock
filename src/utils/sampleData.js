import { newCollection, normalizeRequest } from './collectionUtil.js';
import { newEnvironment } from './envUtil.js';

function uuid() {
  return crypto.randomUUID();
}

/**
 * 首次启动种子数据：一个可真实发送的示例集合 + 示例环境。
 * 目标地址使用公开测试 API（jsonplaceholder），用户打开即可体验完整链路。
 */
export function buildSampleWorkspace() {
  const col = newCollection('示例集合');
  col.doc = '这是 ReqMock 为你准备的示例集合，包含真实可发送的请求、环境变量与后置测试脚本。';
  col.requests = [
    normalizeRequest({
      id: uuid(),
      name: '获取文章列表',
      method: 'GET',
      url: '{{baseUrl}}/posts',
      params: [{ key: '_limit', value: '3', enabled: true }],
      postScript: [
        "rm.test('状态码为 200', () => {",
        "  rm.assert(rm.response.status === 200, `期望 200，实际 ${rm.response.status}`);",
        '});',
        "rm.test('返回了文章数组', () => {",
        '  const data = rm.response.json();',
        '  rm.assert(Array.isArray(data) && data.length > 0, \'响应不是非空数组\');',
        '});'
      ].join('\n')
    }),
    normalizeRequest({
      id: uuid(),
      name: '获取单条评论',
      method: 'GET',
      url: '{{baseUrl}}/posts/1/comments',
      postScript: [
        "rm.test('响应时间小于 5 秒', () => {",
        '  rm.assert(rm.response.timeMs < 5000, `耗时 ${rm.response.timeMs}ms`);',
        '});'
      ].join('\n')
    }),
    normalizeRequest({
      id: uuid(),
      name: '创建文章',
      method: 'POST',
      url: '{{baseUrl}}/posts',
      bodyType: 'json',
      body: JSON.stringify({ title: 'ReqMock 示例', body: '通过 ReqMock 创建', userId: 1 }, null, 2),
      postScript: [
        "rm.test('创建成功（201）', () => {",
        "  rm.assert(rm.response.status === 201, `期望 201，实际 ${rm.response.status}`);",
        '});'
      ].join('\n')
    })
  ];

  const env = newEnvironment('示例环境');
  env.variables = [
    { key: 'baseUrl', value: 'https://jsonplaceholder.typicode.com', enabled: true }
  ];

  return { collections: [col], environments: [env], activeEnvId: env.id };
}
