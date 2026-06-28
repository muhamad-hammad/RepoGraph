import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportResolver, ImportInput } from '../src/graph/ImportResolver';

const known = new Set(['pkg/models.py', 'pkg/service.py', 'ts/app.tsx', 'ts/util/math.ts']);
const r = new ImportResolver();

const analyze = (imp: ImportInput) => r.analyze(imp, known);

test('python relative import resolves to sibling module with bound names', () => {
  const out = analyze({
    importerRel: 'pkg/service.py',
    language: 'python',
    statements: ['from .models import User, make_user'],
  });
  assert.deepEqual(out, [{ targetRel: 'pkg/models.py', names: ['User', 'make_user'] }]);
});

test('python alias keeps the local binding name', () => {
  const out = analyze({
    importerRel: 'pkg/service.py',
    language: 'python',
    statements: ['from .models import User as U'],
  });
  assert.deepEqual(out, [{ targetRel: 'pkg/models.py', names: ['U'] }]);
});

test('python stdlib import resolves to nothing', () => {
  assert.deepEqual(
    analyze({ importerRel: 'pkg/service.py', language: 'python', statements: ['import os'] }),
    []
  );
});

test('js relative import resolves through extension + binds named imports', () => {
  const out = analyze({
    importerRel: 'ts/app.tsx',
    language: 'typescript',
    statements: ["import { add, Calc } from './util/math';"],
  });
  assert.deepEqual(out, [{ targetRel: 'ts/util/math.ts', names: ['add', 'Calc'] }]);
});

test('js bare module import is skipped', () => {
  assert.deepEqual(
    analyze({ importerRel: 'ts/app.tsx', language: 'typescript', statements: ["import React from 'react';"] }),
    []
  );
});

test('resolve emits a deduped file->file imports edge', () => {
  const edges = r.resolve(
    [{ importerRel: 'pkg/service.py', language: 'python', statements: ['from .models import User'] }],
    known
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].type, 'imports');
  assert.equal(edges[0].sourceId, 'file::pkg/service.py');
  assert.equal(edges[0].targetId, 'file::pkg/models.py');
});
