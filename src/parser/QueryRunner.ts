// Executes a .scm query against a parsed tree and returns structured captures.

import { Query, Language, Node, Tree } from 'web-tree-sitter';

export type CaptureKind = 'function' | 'class' | 'method' | 'import' | 'call';

export interface Capture {
  kind: CaptureKind;
  name: string | null; // identifier text for defs/calls; null for imports
  node: Node; // definition / import statement / call-name node (range + nesting)
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  text: string; // raw text of the captured node (used by ImportResolver)
}

const DEF_PREFIX = 'definition.';
const NAME_PREFIX = 'name.';

export class QueryRunner {
  // Query objects are bound to a specific Language, so cache by grammar key.
  private queries = new Map<string, Query>();

  /**
   * @param tree parsed syntax tree
   * @param language the Language the tree was parsed with
   * @param source the `.scm` query text
   * @param cacheKey grammar key used to cache the compiled Query
   */
  run(tree: Tree, language: Language, source: string, cacheKey: string): Capture[] {
    let query = this.queries.get(cacheKey);
    if (!query) {
      query = new Query(language, source);
      this.queries.set(cacheKey, query);
    }

    const out: Capture[] = [];
    for (const match of query.matches(tree.rootNode)) {
      let defNode: Node | null = null;
      let kind: CaptureKind | null = null;
      let name: string | null = null;

      for (const cap of match.captures) {
        if (cap.name === 'import') {
          defNode = cap.node;
          kind = 'import';
        } else if (cap.name === 'call') {
          defNode = cap.node;
          kind = 'call';
          name = cap.node.text;
        } else if (cap.name.startsWith(DEF_PREFIX)) {
          defNode = cap.node;
          kind = cap.name.slice(DEF_PREFIX.length) as CaptureKind;
        } else if (cap.name.startsWith(NAME_PREFIX)) {
          name = cap.node.text;
        }
      }

      if (!defNode || !kind) {
        continue;
      }
      out.push({
        kind,
        name,
        node: defNode,
        startLine: defNode.startPosition.row + 1,
        endLine: defNode.endPosition.row + 1,
        text: defNode.text,
      });
    }
    return out;
  }
}
