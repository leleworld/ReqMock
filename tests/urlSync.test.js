/**
 * urlSync 单元测试
 * 覆盖：URL query 与键值表格的双向同步
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeOpenedRequest, parseQueryFromUrl, buildUrlFromParams
} from '../src/utils/urlSync.js';

describe('parseQueryFromUrl', () => {
  it('从 URL 解析 query 参数为键值数组', () => {
    const params = parseQueryFromUrl('https://api.com/path?name=hello&page=1');
    expect(params.length).toBe(2);
    expect(params[0]).toMatchObject({ key: 'name', value: 'hello' });
    expect(params[1]).toMatchObject({ key: 'page', value: '1' });
  });

  it('无 query 参数返回空数组', () => {
    const params = parseQueryFromUrl('https://api.com/path');
    expect(params).toEqual([]);
  });

  it('处理编码字符', () => {
    const params = parseQueryFromUrl('http://x.com?q=%E4%B8%AD%E6%96%87');
    expect(params[0].value).toBe('中文');
  });

  it('处理空值参数 (key=)', () => {
    const params = parseQueryFromUrl('http://x.com?empty=&has=val');
    expect(params[0]).toMatchObject({ key: 'empty', value: '' });
    expect(params[1]).toMatchObject({ key: 'has', value: 'val' });
  });
});

describe('buildUrlFromParams', () => {
  it('将基础 URL + 参数数组拼接为完整 URL', () => {
    const url = buildUrlFromParams('https://api.com/path', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true }
    ]);
    expect(url).toContain('a=1');
    expect(url).toContain('b=2');
    expect(url).toMatch(/\?.*&/);
  });

  it('禁用的参数不拼接', () => {
    const url = buildUrlFromParams('http://x.com', [
      { key: 'skip', value: 'me', enabled: false },
      { key: 'keep', value: 'yes', enabled: true }
    ]);
    expect(url).not.toContain('skip');
    expect(url).toContain('keep=yes');
  });

  it('空参数列表返回原 URL', () => {
    const url = buildUrlFromParams('http://x.com/api', []);
    expect(url).toBe('http://x.com/api');
  });
});

describe('normalizeOpenedRequest', () => {
  it('URL 中的 query 与 params 表格双向同步', () => {
    const req = {
      url: 'http://x.com?existing=1',
      params: [],
      method: 'GET',
      headers: [],
      bodyType: 'none',
      body: ''
    };
    const normalized = normalizeOpenedRequest(req);
    // params 表格应包含从 URL 解析出的参数
    expect(normalized.params.length).toBeGreaterThanOrEqual(1);
    expect(normalized.params[0].key).toBe('existing');
  });
});
