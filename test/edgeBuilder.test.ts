import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeBuilder } from '../src/graph/EdgeBuilder';
import { GraphNode } from '../src/shared/types';

const node = (id: string, parentId: string | null): GraphNode => ({
  id,
  type: 'function',
  label: id,
  filePath: '',
  lineRange: null,
  parentId,
  language: 'python',
});

test('buildContains emits one edge per parented node, none for roots', () => {
  const edges = new EdgeBuilder().buildContains([
    node('file::a', null),
    node('file::a::C', 'file::a'),
    node('file::a::C::m', 'file::a::C'),
  ]);
  assert.equal(edges.length, 2);
  assert.deepEqual(
    edges.map((e) => `${e.sourceId}->${e.targetId}`),
    ['file::a->file::a::C', 'file::a::C->file::a::C::m']
  );
  assert.ok(edges.every((e) => e.type === 'contains'));
});

test('buildContains ignores a node whose parentId is null', () => {
  assert.equal(new EdgeBuilder().buildContains([node('file::a', null)]).length, 0);
});
