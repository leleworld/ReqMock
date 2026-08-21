export const SCRIPT_TEMPLATES = [
  { 
    category: '变量操作',
    templates: [
      { name: '提取响应字段到环境变量', code: `// 从响应 JSON 提取 token 存入环境变量\nconst data = rm.response.json();\nrm.env.set('token', data.token);` },
      { name: '设置请求头 Token', code: `// 从环境变量读取 token 设为请求头\nconst token = rm.env.get('token');\nrm.request.headers.add('Authorization', 'Bearer ' + token);` },
    ]
  },
  {
    category: '断言',
    templates: [
      { name: '断言状态码 200', code: `rm.test('状态码应为 200', () => {\n  rm.expect(rm.response.status).toBe(200);\n});` },
      { name: '断言响应包含字段', code: `rm.test('响应包含 data 字段', () => {\n  const body = rm.response.json();\n  rm.expect(body.data).toBeDefined();\n});` },
      { name: '断言响应时间', code: `rm.test('响应时间 < 500ms', () => {\n  rm.expect(rm.response.time).toBeLessThan(500);\n});` },
    ]
  },
  {
    category: '数据处理',
    templates: [
      { name: '生成随机字符串', code: `const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';\nlet result = '';\nfor (let i = 0; i < 16; i++) result += chars[Math.floor(Math.random() * chars.length)];\nrm.env.set('randomStr', result);` },
      { name: 'MD5 签名（示例）', code: `// 示例：拼接参数生成签名\nconst params = rm.request.url.searchParams;\nconst sorted = [...params.entries()].sort((a,b) => a[0].localeCompare(b[0]));\nconst str = sorted.map(([k,v]) => k + '=' + v).join('&');\n// rm.env.set('sign', md5(str)); // 需要引入 md5 库` },
    ]
  },
  {
    category: '流程控制',
    templates: [
      { name: '条件跳过请求', code: `// 如果环境变量 skipNext 为 true 则跳过\nif (rm.env.get('skipNext') === 'true') {\n  rm.execution.skip();\n}` },
      { name: '打印调试日志', code: `console.log('请求 URL:', rm.request.url);\nconsole.log('响应状态:', rm.response.status);\nconsole.log('响应体:', rm.response.text());` },
    ]
  }
];
