// Wraps workspace.findFiles; returns supported source files grouped by grammar key.

import * as vscode from 'vscode';
import { GrammarKey, grammarKeyForPath } from './LanguageRegistry';

export interface WalkedFile {
  uri: vscode.Uri;
  key: GrammarKey;
}

export interface WalkResult {
  root: vscode.WorkspaceFolder;
  files: WalkedFile[];
}

const SUPPORTED_GLOB = '**/*.{py,js,jsx,mjs,cjs,ts,mts,cts,tsx}';

export class FileWalker {
  /**
   * Walk the first workspace folder (multi-root not designed out — plan §7).
   * @returns null when no workspace is open.
   */
  static async walk(): Promise<WalkResult | null> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    const root = folders[0];

    const config = vscode.workspace.getConfiguration('repoGraph');
    const excludes = config.get<string[]>('exclude', []);
    const maxFiles = config.get<number>('maxFiles', 2000);
    const excludeGlob = excludes.length ? `{${excludes.join(',')}}` : undefined;

    const include = new vscode.RelativePattern(root, SUPPORTED_GLOB);
    const uris = await vscode.workspace.findFiles(include, excludeGlob, maxFiles);

    const files: WalkedFile[] = [];
    for (const uri of uris) {
      const key = grammarKeyForPath(uri.fsPath);
      if (key) {
        files.push({ uri, key });
      }
    }
    return { root, files };
  }
}
