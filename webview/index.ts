import './styles.css';
import { jsPDF } from 'jspdf';
import { CytoscapeManager, BreadcrumbItem, ViewState } from './CytoscapeManager';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, CodeSnippet } from '../src/shared/types';

interface VsCodeApi {
  postMessage(msg: WebviewToExtensionMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Restored across webview reloads; merged with the live graph on each refresh.
let savedState: Partial<ViewState> = vscode.getState() ?? {};

function post(msg: WebviewToExtensionMessage): void {
  vscode.postMessage(msg);
}

function saveState(state: ViewState): void {
  savedState = state;
  vscode.setState(state);
}

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
  }
}

const container = document.getElementById('cy');
if (!container) {
  throw new Error('missing #cy container');
}

const breadcrumbEl = document.getElementById('breadcrumb');
function renderBreadcrumb(path: BreadcrumbItem[]): void {
  if (!breadcrumbEl) {
    return;
  }
  breadcrumbEl.replaceChildren();
  if (path.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'crumb-hint';
    hint.textContent = 'click a node to see its path';
    breadcrumbEl.appendChild(hint);
    return;
  }
  path.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '▸';
      breadcrumbEl.appendChild(sep);
    }
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = `crumb crumb-${item.type}`;
    crumb.textContent = item.label;
    crumb.addEventListener('click', () => manager.centerOn(item.id));
    breadcrumbEl.appendChild(crumb);
  });
}

const snippetEl = document.getElementById('snippet');
const snippetTitle = document.getElementById('snippet-title');
const snippetCode = document.querySelector('#snippet-code code');

function showSnippet(s: CodeSnippet): void {
  if (!snippetEl || !snippetTitle || !snippetCode) {
    return;
  }
  snippetTitle.textContent = `${s.label} · ${s.relPath}:${s.startLine}-${s.endLine}`;
  snippetCode.textContent = s.code;
  snippetEl.hidden = false;
  document.body.classList.add('snippet-open');
  manager.resize();
}

function hideSnippet(): void {
  if (snippetEl) {
    snippetEl.hidden = true;
  }
  document.body.classList.remove('snippet-open');
  manager.resize();
}

document.getElementById('snippet-close')?.addEventListener('click', hideSnippet);

// Selecting a definition node requests its source; selecting a file clears it.
function handleSelect(path: BreadcrumbItem[]): void {
  renderBreadcrumb(path);
  const selected = path[path.length - 1];
  if (selected && selected.type !== 'file') {
    post({ type: 'requestSnippet', nodeId: selected.id });
  } else {
    hideSnippet();
  }
}

const manager = new CytoscapeManager(container, {
  onSelect: handleSelect,
  onStateChange: saveState,
});
renderBreadcrumb([]);

const importsToggle = document.getElementById('imports-toggle') as HTMLInputElement | null;
const callsToggle = document.getElementById('calls-toggle') as HTMLInputElement | null;
if (importsToggle && savedState.importsVisible !== undefined) {
  importsToggle.checked = savedState.importsVisible;
}
if (callsToggle && savedState.callsVisible !== undefined) {
  callsToggle.checked = savedState.callsVisible;
}

document.getElementById('refresh')?.addEventListener('click', () => {
  setStatus('refreshing…');
  post({ type: 'requestRefresh' });
});
document.getElementById('expand-all')?.addEventListener('click', () => manager.expandAll());
document.getElementById('collapse-all')?.addEventListener('click', () => manager.collapseAll());
document.querySelectorAll<HTMLButtonElement>('#export-menu button[data-format]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const format = btn.dataset.format === 'png' ? 'png' : 'pdf';
    const full = btn.dataset.scope === 'full';
    const menu = document.getElementById('export-menu') as HTMLDetailsElement | null;
    if (menu) {
      menu.open = false;
    }
    void runExport(format, full);
  });
});

// For PDF, wrap the captured PNG on a single page sized to the image's own
// aspect ratio so nothing is scaled or cropped.
async function runExport(format: 'pdf' | 'png', full: boolean): Promise<void> {
  setStatus(`exporting ${format.toUpperCase()}…`);
  try {
    const uri = manager.exportPng({ scale: 3, full });
    if (format === 'png') {
      post({ type: 'exportFile', data: stripDataUri(uri), ext: 'png' });
      setStatus('');
      return;
    }
    const img = await loadImage(uri);
    // px → pt at 96dpi (PDF user units are 1/72 inch).
    const wPt = (img.naturalWidth * 72) / 96;
    const hPt = (img.naturalHeight * 72) / 96;
    const doc = new jsPDF({
      orientation: wPt >= hPt ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [wPt, hPt],
    });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.addImage(uri, 'PNG', 0, 0, pw, ph);
    post({ type: 'exportFile', data: stripDataUri(doc.output('datauristring')), ext: 'pdf' });
    setStatus('');
  } catch (err) {
    setStatus(`export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function stripDataUri(uri: string): string {
  return uri.slice(uri.indexOf('base64,') + 7);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode graph image'));
    img.src = src;
  });
}
document.getElementById('imports-toggle')?.addEventListener('change', (e) => {
  manager.setImportsVisible((e.target as HTMLInputElement).checked);
});
document.getElementById('calls-toggle')?.addEventListener('change', (e) => {
  manager.setCallsVisible((e.target as HTMLInputElement).checked);
});

let searchTimer: ReturnType<typeof setTimeout> | undefined;
document.getElementById('search')?.addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => manager.search(value), 180);
});

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'graph': {
      const { nodes, edges } = msg.payload;
      manager.setGraph(msg.payload, savedState);
      const files = nodes.filter((n) => n.type === 'file').length;
      setStatus(`${files} files · ${nodes.length} nodes · ${edges.length} edges`);
      break;
    }
    case 'snippet':
      showSnippet(msg.payload);
      break;
    case 'error':
      setStatus(msg.payload);
      break;
  }
});

// Handshake: signal the host we're ready before it sends the first graph.
post({ type: 'ready' });
