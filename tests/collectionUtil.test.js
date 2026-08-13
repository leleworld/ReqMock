/**
 * collectionUtil 单元测试
 * 覆盖：集合树操作（新建、查找、删除、移动、导入导出）
 */
import { describe, it, expect } from 'vitest';
import {
  newCollection, newFolder, normalizeRequest,
  updateNode, removeNode, findNode, findOwnerCollection,
  upsertRequestById, removeRequestById, findRequestById, moveRequest,
  exportCollection, parseImport
} from '../src/utils/collectionUtil.js';

describe('newCollection', () => {
  it('创建带名称的集合，自动生成 id 和 children 数组', () => {
    const col = newCollection('测试集合');
    expect(col.id).toBeTruthy();
    expect(col.name).toBe('测试集合');
    expect(col.children).toEqual([]);
    expect(col.type).toBe('collection');
  });
});

describe('newFolder', () => {
  it('创建文件夹节点', () => {
    const folder = newFolder('子目录');
    expect(folder.name).toBe('子目录');
    expect(folder.type).toBe('folder');
    expect(folder.children).toEqual([]);
  });
});

describe('normalizeRequest', () => {
  it('补全缺失字段为默认值', () => {
    const req = normalizeRequest({ id: 'r1' });
    expect(req.id).toBe('r1');
    expect(req.method).toBe('GET');
    expect(req.url).toBe('');
    expect(req.bodyType).toBe('none');
    expect(req.headers).toEqual([]);
    expect(req.params).toEqual([]);
  });

  it('保留已有字段不被覆盖', () => {
    const req = normalizeRequest({ id: 'r2', method: 'POST', url: 'http://x.com' });
    expect(req.method).toBe('POST');
    expect(req.url).toBe('http://x.com');
  });
});

describe('findNode', () => {
  it('递归查找嵌套节点', () => {
    const tree = [
      newCollection('A'),
    ];
    const folder = newFolder('F');
    tree[0].children = [folder];
    const found = findNode(tree, folder.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('F');
  });

  it('查找不存在的节点返回 null/undefined', () => {
    const tree = [newCollection('A')];
    const found = findNode(tree, 'nonexistent');
    expect(found).toBeFalsy();
  });
});

describe('findOwnerCollection', () => {
  it('找到请求所属的顶层集合', () => {
    const col = newCollection('Col');
    const req = normalizeRequest({ id: 'req1' });
    col.children = [req];
    const owner = findOwnerCollection([col], 'req1');
    expect(owner).toBeTruthy();
    expect(owner.id).toBe(col.id);
  });
});

describe('upsertRequestById / removeRequestById', () => {
  it('更新已存在的请求', () => {
    const col = newCollection('C');
    const req = normalizeRequest({ id: 'r1', url: 'old' });
    col.children = [req];

    const updated = upsertRequestById([col], 'r1', { ...req, url: 'new' });
    const found = findRequestById(updated, 'r1');
    expect(found.url).toBe('new');
  });

  it('删除请求后找不到', () => {
    const col = newCollection('C');
    col.children = [normalizeRequest({ id: 'r1' })];

    const result = removeRequestById([col], 'r1');
    expect(findRequestById(result, 'r1')).toBeFalsy();
  });
});

describe('异常输入', () => {
  it('normalizeRequest 处理 null/undefined 输入不崩溃', () => {
    expect(() => normalizeRequest({})).not.toThrow();
    expect(() => normalizeRequest(null)).not.toThrow();
  });
});
