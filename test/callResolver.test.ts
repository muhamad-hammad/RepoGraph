import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallResolver, CallFileData } from '../src/graph/CallResolver';
import { ImportResolver } from '../src/graph/ImportResolver';
import { DefIndexEntry } from '../src/graph/NodeBuilder';

const def = (graphId: string, name: string, type: DefIndexEntry['type']): DefIndexEntry => ({
  tsNodeId: 0,
  graphId,
  name,
  type,
});

function resolve(files: CallFileData[], known: string[]) {
  const cr = new CallResolver(new ImportResolver());
  for (const f of files) {
    cr.addFile(f);
  }
  return cr
    .resolve(new Set(known))
    .map((e) => `${e.sourceId}->${e.targetId}`)
    .sort();
}

test('same-file call resolves to the local definition', () => {
  const edges = resolve(
    [
      {
        fileRel: 'a.py',
        fileId: 'file::a.py',
        language: 'python',
        defIndex: [def('file::a.py::foo@1', 'foo', 'function')],
        callSites: [{ callerId: 'file::a.py', calleeName: 'foo' }],
        importStatements: [],
      },
    ],
    ['a.py']
  );
  assert.deepEqual(edges, ['file::a.py->file::a.py::foo@1']);
});

test('imported symbol resolves to its source file definition', () => {
  const edges = resolve(
    [
      {
        fileRel: 'b.py',
        fileId: 'file::b.py',
        language: 'python',
        defIndex: [def('file::b.py::bar@1', 'bar', 'function')],
        callSites: [],
        importStatements: [],
      },
      {
        fileRel: 'a.py',
        fileId: 'file::a.py',
        language: 'python',
        defIndex: [def('file::a.py::run@1', 'run', 'function')],
        callSites: [{ callerId: 'file::a.py::run@1', calleeName: 'bar' }],
        importStatements: ['from .b import bar'],
      },
    ],
    ['a.py', 'b.py']
  );
  assert.deepEqual(edges, ['file::a.py::run@1->file::b.py::bar@1']);
});

test('ambiguous name with no same-file/imported match is skipped', () => {
  const edges = resolve(
    [
      {
        fileRel: 'b.py',
        fileId: 'file::b.py',
        language: 'python',
        defIndex: [def('file::b.py::baz@1', 'baz', 'function')],
        callSites: [],
        importStatements: [],
      },
      {
        fileRel: 'c.py',
        fileId: 'file::c.py',
        language: 'python',
        defIndex: [def('file::c.py::baz@1', 'baz', 'function')],
        callSites: [],
        importStatements: [],
      },
      {
        fileRel: 'a.py',
        fileId: 'file::a.py',
        language: 'python',
        defIndex: [],
        callSites: [{ callerId: 'file::a.py', calleeName: 'baz' }],
        importStatements: [],
      },
    ],
    ['a.py', 'b.py', 'c.py']
  );
  assert.deepEqual(edges, []);
});

test('self-call (caller === callee) produces no edge', () => {
  const edges = resolve(
    [
      {
        fileRel: 'a.py',
        fileId: 'file::a.py',
        language: 'python',
        defIndex: [def('file::a.py::foo@1', 'foo', 'function')],
        callSites: [{ callerId: 'file::a.py::foo@1', calleeName: 'foo' }],
        importStatements: [],
      },
    ],
    ['a.py']
  );
  assert.deepEqual(edges, []);
});
