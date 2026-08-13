/**
 * envUtil 单元测试
 * 覆盖：环境变量创建、合并、{{变量}} 替换
 */
import { describe, it, expect } from 'vitest';
import {
  newEnvironment, buildVarMap, resolveRequest, mergeVariables
} from '../src/utils/envUtil.js';

describe('newEnvironment', () => {
  it('创建带默认名称的环境', () => {
    const env = newEnvironment();
    expect(env.name).toBe('新建环境');
    expect(env.id).toBeTruthy();
    expect(env.variables).toEqual([]);
  });

  it('创建带自定义名称的环境', () => {
    const env = newEnvironment('生产环境');
    expect(env.name).toBe('生产环境');
  });
});

describe('buildVarMap', () => {
  it('将 environment 的 variables 数组转为 key-value map', () => {
    const env = {
      id: 'e1', name: 'dev',
      variables: [
        { key: 'host', value: 'localhost', enabled: true },
        { key: 'port', value: '3000', enabled: true },
        { key: 'disabled', value: 'x', enabled: false }
      ]
    };
    const globals = [{ key: 'token', value: 'abc', enabled: true }];
    const map = buildVarMap(env, globals);
    expect(map.host).toBe('localhost');
    expect(map.port).toBe('3000');
    expect(map.token).toBe('abc');
    expect(map.disabled).toBeUndefined();
  });

  it('globals 被 environment 同名变量覆盖', () => {
    const env = {
      id: 'e1', name: 'dev',
      variables: [{ key: 'x', value: 'env', enabled: true }]
    };
    const globals = [{ key: 'x', value: 'global', enabled: true }];
    const map = buildVarMap(env, globals);
    expect(map.x).toBe('env');
  });

  it('env 为 null 时仅返回 globals', () => {
    const globals = [{ key: 'a', value: '1', enabled: true }];
    const map = buildVarMap(null, globals);
    expect(map.a).toBe('1');
  });
});

describe('resolveRequest', () => {
  it('替换 URL 和 Header 中的 {{变量}}', () => {
    const req = {
      url: 'http://{{host}}:{{port}}/api',
      headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
      params: [],
      body: '',
      bodyType: 'none'
    };
    const varMap = { host: 'example.com', port: '8080', token: 'xyz' };
    const resolved = resolveRequest(req, varMap);
    expect(resolved.url).toBe('http://example.com:8080/api');
    expect(resolved.headers[0].value).toBe('Bearer xyz');
  });

  it('未定义变量保持原样 {{xxx}}', () => {
    const req = { url: '{{undefined_var}}', headers: [], params: [], body: '', bodyType: 'none' };
    const resolved = resolveRequest(req, {});
    expect(resolved.url).toBe('{{undefined_var}}');
  });
});

describe('mergeVariables', () => {
  it('合并变量列表，同名覆盖', () => {
    const existing = [{ key: 'a', value: '1', enabled: true }];
    const incoming = [{ key: 'a', value: '2' }, { key: 'b', value: '3' }];
    const merged = mergeVariables(existing, incoming);
    const aVar = merged.find(v => v.key === 'a');
    expect(aVar.value).toBe('2');
    expect(merged.find(v => v.key === 'b')).toBeTruthy();
  });
});
