import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  RepoGraph,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../shared/types';
import { GraphBuilder } from '../graph/GraphBuilder';

export class GraphPanel {
  static current: GraphPanel | undefined;
  private static readonly viewType = 'repoGraph.panel';

  private readonly panel: vscode.WebviewPanel;
  private readonly distUri: vscode.Uri;
  private readonly builder: GraphBuilder;
  private readonly disposables: vscode.Disposable[] = [];

  private latestGraph: RepoGraph | null = null;
  private webviewReady = false;

  static async show(context: vscode.ExtensionContext): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(column);
      await GraphPanel.current.refresh();
      return;
    }

    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(
      GraphPanel.viewType,
      'Repo Graph',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distUri],
      }
    );

    GraphPanel.current = new GraphPanel(panel, context, distUri);
    await GraphPanel.current.refresh();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    distUri: vscode.Uri
  ) {
    this.panel = panel;
    this.distUri = distUri;
    this.builder = new GraphBuilder(context.extensionPath);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this.onMessage(msg),
      null,
      this.disposables
    );

    // Render the shell. The webview signals 'ready' once its script boots,
    // at which point we push the graph (handshake before first send).
    void this.renderHtml();
  }

  /** Rebuild the graph and (if the webview is ready) push it. */
  async refresh(): Promise<void> {
    try {
      const graph = await this.builder.build();
      if (!graph) {
        this.post({
          type: 'error',
          payload: 'No workspace folder is open. Open a folder and try again.',
        });
        return;
      }
      this.latestGraph = graph;
      if (this.webviewReady) {
        this.post({ type: 'graph', payload: graph });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[repo-graph] build failed:', err);
      this.post({ type: 'error', payload: `Failed to build graph: ${message}` });
    }
  }

  private onMessage(msg: WebviewToExtensionMessage): void {
    switch (msg.type) {
      case 'ready':
        this.webviewReady = true;
        if (this.latestGraph) {
          this.post({ type: 'graph', payload: this.latestGraph });
        }
        break;
      case 'requestRefresh':
        void this.refresh();
        break;
      case 'requestSnippet':
        void this.sendSnippet(msg.nodeId);
        break;
    }
  }

  /** Read the source lines for a definition node and push them to the webview. */
  private async sendSnippet(nodeId: string): Promise<void> {
    const graph = this.latestGraph;
    if (!graph) {
      return;
    }
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || !node.lineRange) {
      return; // only definition nodes (not files) have a line range
    }
    try {
      const content = await fs.readFile(node.filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      const { start, end } = node.lineRange;
      const code = lines.slice(start - 1, end).join('\n');
      const relPath = path.relative(graph.rootPath, node.filePath).split(path.sep).join('/');
      this.post({
        type: 'snippet',
        payload: { nodeId, label: node.label, relPath, startLine: start, endLine: end, code },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'error', payload: `Could not read source for ${node.label}: ${message}` });
    }
  }

  private post(message: ExtensionToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async renderHtml(): Promise<void> {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.distUri, 'webview.css'));
    const nonce = makeNonce();

    const templatePath = path.join(this.distUri.fsPath, 'webview.html');
    const template = await fs.readFile(templatePath, 'utf8');

    this.panel.webview.html = template
      .replaceAll('${cspSource}', webview.cspSource)
      .replaceAll('${nonce}', nonce)
      .replaceAll('${scriptUri}', scriptUri.toString())
      .replaceAll('${styleUri}', styleUri.toString());
  }

  private dispose(): void {
    GraphPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
