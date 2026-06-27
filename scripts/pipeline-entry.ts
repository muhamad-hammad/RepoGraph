// Headless exercise of the pure analysis pipeline (no vscode). Bundled + run by
// pipeline-test.mjs. Validates grammar/query node types and prints a RepoGraph
// summary so the host pipeline is testable without launching VSCode.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { LanguageRegistry, grammarKeyForPath } from '../src/parser/LanguageRegistry';
import { GraphAssembler, SourceFile } from '../src/graph/GraphAssembler';

const projectRoot = process.env.PROJECT_ROOT!;
const fixturesDir = process.env.FIXTURES_DIR!;
const grammarsDir = path.join(projectRoot, 'dist', 'grammars');
const queriesDir = path.join(projectRoot, 'queries');

async function walk(dir: string, root: string, acc: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, acc);
    } else if (grammarKeyForPath(full)) {
      acc.push(full);
    }
  }
}

async function main(): Promise<void> {
  const registry = new LanguageRegistry(grammarsDir);

  // --- sexp dump: validate node type names used by the queries -----------
  const pyParser = await registry.getParser('python');
  const pyTree = pyParser.parse('import os\nclass A:\n  def m(self):\n    pass\ndef f():\n  pass\n');
  console.log('--- python sexp ---');
  console.log(pyTree!.rootNode.toString());

  const tsxParser = await registry.getParser('tsx');
  const tsxTree = tsxParser.parse(
    "import {x} from './y';\nexport class C { m(){} }\nconst g = () => 1;\nfunction h(){}\n"
  );
  console.log('--- tsx sexp ---');
  console.log(tsxTree!.rootNode.toString());

  // --- full assemble -----------------------------------------------------
  const querySources = new Map<string, string>();
  for (const name of ['python', 'javascript', 'typescript']) {
    querySources.set(name, await fs.readFile(path.join(queriesDir, `${name}.scm`), 'utf8'));
  }

  const absPaths: string[] = [];
  await walk(fixturesDir, fixturesDir, absPaths);
  const files: SourceFile[] = [];
  for (const abs of absPaths) {
    files.push({
      absPath: abs,
      relPath: path.relative(fixturesDir, abs).split(path.sep).join('/'),
      key: grammarKeyForPath(abs)!,
      content: await fs.readFile(abs, 'utf8'),
    });
  }

  const assembler = new GraphAssembler(registry, querySources);
  await assembler.prime(files);
  const graph = await assembler.assemble(fixturesDir, files, undefined, false);

  console.log('\n--- nodes ---');
  for (const n of graph.nodes) {
    console.log(`${n.type.padEnd(8)} ${n.label.padEnd(16)} id=${n.id} parent=${n.parentId ?? '-'}`);
  }
  console.log('\n--- edges ---');
  for (const e of graph.edges) {
    console.log(`${e.type.padEnd(9)} ${e.sourceId}  ->  ${e.targetId}`);
  }

  const counts = graph.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const importEdges = graph.edges.filter((e) => e.type === 'imports').length;
  const containsEdges = graph.edges.filter((e) => e.type === 'contains').length;
  const callsEdges = graph.edges.filter((e) => e.type === 'calls').length;
  console.log('\n--- summary ---');
  console.log(JSON.stringify({ counts, containsEdges, importEdges, callsEdges }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
