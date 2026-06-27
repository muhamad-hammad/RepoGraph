// Loads and caches web-tree-sitter parsers + grammars per language.
// No vscode dependency so it can run in a headless test harness.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Parser, Language } from 'web-tree-sitter';

/** Grammar keys map 1:1 to a bundled `.wasm` file. */
export type GrammarKey = 'python' | 'javascript' | 'typescript' | 'tsx';

const WASM_FILE: Record<GrammarKey, string> = {
  python: 'tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
};

export class LanguageRegistry {
  private initialized = false;
  private languages = new Map<GrammarKey, Language>();
  private parsers = new Map<GrammarKey, Parser>();

  /** @param grammarsDir directory holding tree-sitter.wasm + grammar wasm files */
  constructor(private readonly grammarsDir: string) {}

  private async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await Parser.init({
      locateFile: (file: string) => path.join(this.grammarsDir, file),
    });
    this.initialized = true;
  }

  /** Lazily load + cache the Language for a grammar key. */
  async getLanguage(key: GrammarKey): Promise<Language> {
    await this.init();
    const cached = this.languages.get(key);
    if (cached) {
      return cached;
    }
    const wasmPath = path.join(this.grammarsDir, WASM_FILE[key]);
    const bytes = await fs.readFile(wasmPath);
    const language = await Language.load(bytes);
    this.languages.set(key, language);
    return language;
  }

  /** Lazily create + cache a Parser configured for a grammar key. */
  async getParser(key: GrammarKey): Promise<Parser> {
    const cached = this.parsers.get(key);
    if (cached) {
      return cached;
    }
    const language = await this.getLanguage(key);
    const parser = new Parser();
    parser.setLanguage(language);
    this.parsers.set(key, parser);
    return parser;
  }
}

/** Map a file path to its grammar key (or null if unsupported). */
export function grammarKeyForPath(filePath: string): GrammarKey | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.py':
      return 'python';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    default:
      return null;
  }
}

/** Display language for a grammar key (matches GraphNode.language values). */
export function displayLanguage(key: GrammarKey): string {
  if (key === 'tsx') {
    return 'typescript';
  }
  return key;
}

/** Which `.scm` query a grammar key uses (tsx reuses the typescript query). */
export function queryNameForKey(key: GrammarKey): 'python' | 'javascript' | 'typescript' {
  if (key === 'tsx') {
    return 'typescript';
  }
  return key;
}
