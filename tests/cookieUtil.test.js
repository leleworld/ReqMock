/**
 * cookieUtil 单元测试
 * 覆盖：Set-Cookie 解析、Cookie 匹配、Cookie 头构建
 */
import { describe, it, expect } from 'vitest';
import {
  parseSetCookie, upsertCookies, pruneCookies, buildCookieHeader
} from '../src/utils/cookieUtil.js';

describe('parseSetCookie', () => {
  it('解析标准 Set-Cookie 头', () => {
    const raw = 'session=abc123; Path=/; Domain=.example.com; HttpOnly; Secure';
    const cookie = parseSetCookie(raw, 'https://www.example.com/api');
    expect(cookie.name).toBe('session');
    expect(cookie.value).toBe('abc123');
    expect(cookie.domain).toContain('example.com');
    expect(cookie.path).toBe('/');
    expect(cookie.secure).toBe(true);
  });

  it('无 Domain 属性时从请求 URL 推断', () => {
    const raw = 'token=xyz; Path=/app';
    const cookie = parseSetCookie(raw, 'https://api.test.com/login');
    expect(cookie.name).toBe('token');
    expect(cookie.domain).toContain('api.test.com');
  });

  it('空字符串或 null 返回 null', () => {
    expect(parseSetCookie('', 'http://x.com')).toBeNull();
    expect(parseSetCookie(null, 'http://x.com')).toBeNull();
  });
});

describe('upsertCookies', () => {
  it('新增 Cookie 到空罐', () => {
    const jar = [];
    const newCookie = {
      name: 'a', value: '1', domain: '.example.com', path: '/',
      secure: false, hostOnly: false, createdAt: Date.now()
    };
    const updated = upsertCookies(jar, [newCookie]);
    expect(updated.length).toBe(1);
    expect(updated[0].name).toBe('a');
  });

  it('同名同域 Cookie 覆盖旧值', () => {
    const jar = [{ name: 'a', value: 'old', domain: '.example.com', path: '/' }];
    const newCookie = { name: 'a', value: 'new', domain: '.example.com', path: '/' };
    const updated = upsertCookies(jar, [newCookie]);
    expect(updated.length).toBe(1);
    expect(updated[0].value).toBe('new');
  });
});

describe('buildCookieHeader', () => {
  it('按域名和路径匹配构建 Cookie 头', () => {
    const jar = [
      { name: 'a', value: '1', domain: '.example.com', path: '/', secure: false },
      { name: 'b', value: '2', domain: '.other.com', path: '/', secure: false }
    ];
    const header = buildCookieHeader(jar, 'http://www.example.com/api/test');
    expect(header).toContain('a=1');
    expect(header).not.toContain('b=2');
  });

  it('空罐返回空字符串', () => {
    expect(buildCookieHeader([], 'http://x.com')).toBe('');
  });
});

describe('pruneCookies', () => {
  it('移除已过期的 Cookie', () => {
    const jar = [
      { name: 'alive', value: '1', domain: '.x.com', path: '/', expires: Date.now() + 999999 },
      { name: 'dead', value: '2', domain: '.x.com', path: '/', expires: Date.now() - 999999 }
    ];
    const pruned = pruneCookies(jar);
    expect(pruned.length).toBe(1);
    expect(pruned[0].name).toBe('alive');
  });
});
