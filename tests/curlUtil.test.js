/**
 * curlUtil 单元测试
 * 覆盖：cURL 命令生成与解析
 */
import { describe, it, expect } from 'vitest';
import { toCurl, parseCurl } from '../src/utils/curlUtil.js';

describe('toCurl', () => {
  it('生成基本 GET 请求的 cURL', () => {
    const req = {
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      params: [],
      bodyType: 'none',
      body: ''
    };
    const curl = toCurl(req);
    expect(curl).toContain('curl');
    expect(curl).toContain('https://api.example.com/users');
    expect(curl).toContain("-H 'Accept: application/json'");
  });

  it('POST JSON 请求包含 -d 和 Content-Type', () => {
    const req = {
      method: 'POST',
      url: 'https://api.example.com/data',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      params: [],
      bodyType: 'json',
      body: '{"name":"test"}'
    };
    const curl = toCurl(req);
    expect(curl).toContain('-X POST');
    expect(curl).toContain('{"name":"test"}');
  });

  it('禁用的 Header 不出现在输出中', () => {
    const req = {
      method: 'GET',
      url: 'http://x.com',
      headers: [{ key: 'X-Skip', value: 'yes', enabled: false }],
      params: [],
      bodyType: 'none',
      body: ''
    };
    const curl = toCurl(req);
    expect(curl).not.toContain('X-Skip');
  });
});

describe('parseCurl', () => {
  it('解析基本 cURL 命令', () => {
    const cmd = "curl -X POST 'https://api.test.com/login' -H 'Content-Type: application/json' -d '{\"user\":\"admin\"}'";
    const req = parseCurl(cmd);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.test.com/login');
    expect(req.body).toContain('admin');
  });

  it('解析仅含 URL 的简单 cURL', () => {
    const req = parseCurl('curl https://example.com');
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://example.com');
  });

  it('空输入返回合理默认值', () => {
    const req = parseCurl('');
    expect(req).toBeTruthy();
    expect(req.method).toBe('GET');
  });
});
