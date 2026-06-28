// webview/CytoscapeManager.ts
// Force-directed (fcose) Logseq-style view over the collapse/expand model.
// Elements are added lazily: only file nodes + their import edges up front; a
// node's children are materialized the first time it is expanded, so a large
// repo's canvas only ever holds what the user has drilled into.

import cytoscape, { Core, NodeSingular, ElementDefinition, Collection } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { RepoGraph, GraphNode, GraphEdge } from '../src/shared/types';

cytoscape.use(fcose);

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

// Ambient "constellation" tuning — gathered here so the look is easy to retune.
const AMBIENT_BG = '#050505';
const NODE_SIZE = 5;
const FILE_NODE_SIZE = 10;
const LAYOUT_NODE_REPULSION = 12000;
const LAYOUT_IDEAL_EDGE_LENGTH = 130;
const LAYOUT_GRAVITY = 0.03;
const LAYOUT_NODE_SEPARATION = 12;
const LAYOUT_ANIMATION_DURATION = 1500;
const DRIFT_INTERVAL_MS = 60;
const DRIFT_AMPLITUDE = 0.5; // px per tick, per axis
const DRIFT_RESUME_MS = 300; // idle gap before drift resumes after interaction

/** One step in a node's ancestor path (file ▸ class ▸ method). */
export interface BreadcrumbItem {
  id: string;
  label: string;
  type: string;
}

/** Persisted UI state (survives refresh and webview reload). */
export interface ViewState {
  expanded: string[];
  importsVisible: boolean;
  callsVisible: boolean;
}

export interface ManagerOptions {
  onSelect?: (path: BreadcrumbItem[]) => void;
  onStateChange?: (state: ViewState) => void;
}

export class CytoscapeManager {
  private cy: Core;

  // Full graph data (plain objects), indexed for lazy element creation.
  private nodeById = new Map<string, GraphNode>();
  private childrenByParent = new Map<string, GraphNode[]>();
  private edgesByEndpoint = new Map<string, GraphEdge[]>();
  private orderById = new Map<string, number>(); // global check order (1-based)

  private added = new Set<string>();
  private addedEdges = new Set<string>();

  /** Node IDs whose children are currently shown. Files collapsed by default. */
  private expanded = new Set<string>();
  private importsVisible = true;
  private callsVisible = false;

  private readonly onSelect?: (path: BreadcrumbItem[]) => void;
  private readonly onStateChange?: (state: ViewState) => void;

  // Ambient idle drift: nudges nodes continuously once the layout has settled.
  private driftTimer: number | null = null;
  private resumeTimer: number | null = null;
  private interacting = false;

  constructor(container: HTMLElement, opts: ManagerOptions = {}) {
    this.onSelect = opts.onSelect;
    this.onStateChange = opts.onStateChange;

    container.style.background = AMBIENT_BG;

    this.cy = cytoscape({
      container,
      style: this.buildStyle(),
      wheelSensitivity: 0.2,
      minZoom: 0.05,
      maxZoom: 4,
    });

    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      this.select(node);
      if (this.childrenByParent.has(node.id())) {
        this.toggle(node.id());
      }
    });

    this.cy.on('mouseover', 'node', (evt) => this.focus(evt.target as NodeSingular));
    this.cy.on('mouseout', 'node', () => this.clearFocus());

    // Hold the drift while the user drags, pans, or zooms; resume once idle.
    this.cy.on('mousedown grab drag pan zoom', () => this.suspendDrift());
  }

  /** Replace the graph. Restores prior expand/toggle state when provided. */
  setGraph(graph: RepoGraph, saved?: Partial<ViewState>): void {
    this.index(graph);

    if (saved?.importsVisible !== undefined) {
      this.importsVisible = saved.importsVisible;
    }
    if (saved?.callsVisible !== undefined) {
      this.callsVisible = saved.callsVisible;
    }
    // Keep only expanded ids that still exist (stable-id match across refresh).
    const wanted = new Set((saved?.expanded ?? [...this.expanded]).filter((id) => this.nodeById.has(id)));

    this.cy.elements().remove();
    this.added.clear();
    this.addedEdges.clear();
    this.expanded.clear();

    this.cy.startBatch();
    for (const node of this.nodeById.values()) {
      if (node.parentId === null) {
        this.addNode(node);
      }
    }
    // Restore expansion (parents before children: sort by ancestor depth).
    for (const id of [...wanted].sort((a, b) => this.depth(a) - this.depth(b))) {
      this.expanded.add(id);
      this.ensureChildren(id);
    }
    this.cy.endBatch();

    this.applyVisibility();
    this.relayout(true, false, true); // instant, randomized first render
    this.onSelect?.([]);
    this.notifyState();
  }

  expandAll(): void {
    this.cy.startBatch();
    for (const parentId of this.childrenByParent.keys()) {
      this.expanded.add(parentId);
      this.ensureChildren(parentId);
    }
    this.cy.endBatch();
    this.applyVisibility();
    this.relayout(true, true, true);
    this.notifyState();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.applyVisibility();
    this.relayout(true, true, true);
    this.notifyState();
  }

  /** Recompute viewport after the container is resized (e.g. snippet split). */
  resize(): void {
    this.cy.resize();
  }

  /** Render to a base64 PNG. `full` captures the whole graph (not just the
   * viewport); `scale` oversamples so the image stays sharp, capped to stay
   * within browser canvas limits. */
  exportPng(opts: { scale?: number; full?: boolean } = {}): string {
    const { scale = 3, full = false } = opts;
    return this.cy.png({
      output: 'base64uri',
      bg: AMBIENT_BG,
      full,
      scale,
      maxWidth: 12000,
      maxHeight: 12000,
    });
  }

  setImportsVisible(visible: boolean): void {
    this.importsVisible = visible;
    this.cy.edges('[type = "imports"]').style('display', visible ? 'element' : 'none');
    this.notifyState();
  }

  setCallsVisible(visible: boolean): void {
    this.callsVisible = visible;
    this.cy.edges('[type = "calls"]').style('display', visible ? 'element' : 'none');
    this.notifyState();
  }

  /** Highlight a node by id, reveal it (adding + expanding ancestors), center. */
  centerOn(id: string): void {
    if (!this.nodeById.has(id)) {
      return;
    }
    this.reveal(id);
    this.applyVisibility();
    this.relayout(false, false);
    const node = this.cy.getElementById(id);
    this.select(node);
    this.cy.animate({ center: { eles: node }, zoom: Math.max(this.cy.zoom(), 0.8) }, { duration: 400 });
  }

  /** Substring search over the full graph: reveal + highlight matches, dim rest. */
  search(term: string): void {
    this.cy.elements().removeClass('search-hit search-dim');
    const t = term.trim().toLowerCase();
    if (!t) {
      return;
    }
    const matchIds: string[] = [];
    for (const node of this.nodeById.values()) {
      if (node.label.toLowerCase().includes(t)) {
        matchIds.push(node.id);
      }
    }
    if (matchIds.length === 0) {
      this.cy.nodes().addClass('search-dim');
      return;
    }
    this.cy.startBatch();
    for (const id of matchIds) {
      this.reveal(id);
    }
    this.cy.endBatch();
    this.applyVisibility();
    this.relayout(false, false);

    let matches = this.cy.collection();
    for (const id of matchIds) {
      matches = matches.union(this.cy.getElementById(id));
    }
    this.cy.batch(() => {
      this.cy.elements().addClass('search-dim');
      matches.union(matches.ancestors()).removeClass('search-dim');
      matches.addClass('search-hit');
    });
    this.cy.animate({ fit: { eles: matches, padding: 60 } }, { duration: 400 });
    this.notifyState();
  }

  // ---- lazy element creation ------------------------------------------

  private index(graph: RepoGraph): void {
    this.nodeById.clear();
    this.childrenByParent.clear();
    this.edgesByEndpoint.clear();
    this.orderById.clear();

    for (const node of graph.nodes) {
      this.nodeById.set(node.id, node);
      if (node.parentId) {
        const arr = this.childrenByParent.get(node.parentId);
        if (arr) {
          arr.push(node);
        } else {
          this.childrenByParent.set(node.parentId, [node]);
        }
      }
    }

    // Number every node in one global "check this next" sequence: walk files in
    // graph order, and within each file its definitions top-to-bottom by line.
    const defsByFile = new Map<string, GraphNode[]>();
    for (const node of this.nodeById.values()) {
      if (node.parentId === null || !node.lineRange) {
        continue; // file roots are numbered inline below
      }
      const fileId = this.fileRootOf(node.id);
      const arr = defsByFile.get(fileId);
      if (arr) {
        arr.push(node);
      } else {
        defsByFile.set(fileId, [node]);
      }
    }
    let order = 0;
    for (const node of graph.nodes) {
      if (node.parentId !== null) {
        continue;
      }
      this.orderById.set(node.id, ++order);
      const defs = defsByFile.get(node.id);
      if (defs) {
        defs.sort((a, b) => a.lineRange!.start - b.lineRange!.start);
        for (const def of defs) {
          this.orderById.set(def.id, ++order);
        }
      }
    }

    for (const edge of graph.edges) {
      if (edge.type === 'contains') {
        continue;
      }
      pushEdge(this.edgesByEndpoint, edge.sourceId, edge);
      pushEdge(this.edgesByEndpoint, edge.targetId, edge);
    }
  }

  private addNode(node: GraphNode): void {
    if (this.added.has(node.id)) {
      return;
    }
    const order = this.orderById.get(node.id);
    this.cy.add({
      group: 'nodes',
      data: {
        id: node.id,
        label: order ? `${order}. ${node.label}` : node.label,
        type: node.type,
        parent: node.parentId ?? undefined,
        filePath: node.filePath,
        startLine: node.lineRange?.start ?? null,
        endLine: node.lineRange?.end ?? null,
      },
    } as ElementDefinition);
    this.added.add(node.id);

    // Add any edges whose other endpoint is already present.
    for (const edge of this.edgesByEndpoint.get(node.id) ?? []) {
      const other = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
      if (this.added.has(other)) {
        this.addEdge(edge);
      }
    }
  }

  private addEdge(edge: GraphEdge): void {
    if (this.addedEdges.has(edge.id)) {
      return;
    }
    const visible = edge.type === 'calls' ? this.callsVisible : this.importsVisible;
    this.cy.add({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
        label: edge.label ?? '',
      },
      style: visible ? undefined : { display: 'none' },
    } as ElementDefinition);
    this.addedEdges.add(edge.id);
  }

  private ensureChildren(parentId: string): void {
    for (const child of this.childrenByParent.get(parentId) ?? []) {
      this.addNode(child);
    }
  }

  /** Add elements + expand ancestors so node `id` becomes visible. */
  private reveal(id: string): void {
    const chain: string[] = [];
    let cur: string | null = id;
    while (cur) {
      chain.unshift(cur);
      cur = this.nodeById.get(cur)?.parentId ?? null;
    }
    // Walk root -> id, expanding + materializing children along the way.
    for (let i = 0; i < chain.length; i++) {
      this.addNode(this.nodeById.get(chain[i])!);
      if (i < chain.length - 1) {
        this.expanded.add(chain[i]);
        this.ensureChildren(chain[i]);
      }
    }
  }

  private fileRootOf(id: string): string {
    let cur: GraphNode | undefined = this.nodeById.get(id);
    while (cur && cur.parentId) {
      cur = this.nodeById.get(cur.parentId);
    }
    return cur ? cur.id : id;
  }

  private depth(id: string): number {
    let d = 0;
    let cur = this.nodeById.get(id)?.parentId ?? null;
    while (cur) {
      d++;
      cur = this.nodeById.get(cur)?.parentId ?? null;
    }
    return d;
  }

  // ---- interaction -----------------------------------------------------

  private toggle(id: string): void {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
      this.ensureChildren(id);
    }
    this.applyVisibility();
    this.relayout(false);
    this.notifyState();
  }

  private select(node: NodeSingular): void {
    this.cy.nodes('.selected').removeClass('selected');
    node.addClass('selected');
    this.emitBreadcrumb(node.id());
  }

  private emitBreadcrumb(id: string): void {
    const path: BreadcrumbItem[] = [];
    let cur: string | null = id;
    while (cur) {
      const node = this.nodeById.get(cur);
      if (!node) {
        break;
      }
      path.unshift({ id: node.id, label: node.label, type: node.type });
      cur = node.parentId;
    }
    this.onSelect?.(path);
  }

  private focus(node: NodeSingular): void {
    const hood: Collection = node
      .closedNeighborhood()
      .union(node.ancestors())
      .union(node.descendants());
    this.cy.batch(() => {
      this.cy.elements().addClass('dim');
      hood.removeClass('dim').addClass('focus');
    });
  }

  private clearFocus(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('dim focus');
    });
  }

  /** A node is visible iff every ancestor is expanded. */
  private applyVisibility(): void {
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        n.style('display', this.isVisible(n.id()) ? 'element' : 'none');
      });
      this.cy.edges('[type = "imports"]').style('display', this.importsVisible ? 'element' : 'none');
      this.cy.edges('[type = "calls"]').style('display', this.callsVisible ? 'element' : 'none');
    });
  }

  private isVisible(id: string): boolean {
    let parent = this.nodeById.get(id)?.parentId ?? null;
    while (parent) {
      if (!this.expanded.has(parent)) {
        return false;
      }
      parent = this.nodeById.get(parent)?.parentId ?? null;
    }
    return true;
  }

  private relayout(fit: boolean, animate = true, randomize = false): void {
    this.stopDrift();
    const layout = this.cy.elements(':visible').layout({
      name: 'fcose',
      quality: 'default',
      animate,
      animationDuration: LAYOUT_ANIMATION_DURATION,
      animationEasing: 'ease-out',
      randomize,
      fit,
      padding: 60,
      // Loose, evenly-spread cloud at the top level, but each compound hugs its
      // children: strong compound gravity + tight tiling/nesting/separation pull
      // a file's defs together so boxes are only as big as their contents.
      nodeSeparation: LAYOUT_NODE_SEPARATION,
      idealEdgeLength: () => LAYOUT_IDEAL_EDGE_LENGTH,
      nodeRepulsion: () => LAYOUT_NODE_REPULSION,
      gravity: LAYOUT_GRAVITY,
      gravityCompound: 30.0,
      gravityRangeCompound: 1.2,
      nestingFactor: 0.06,
      tile: true,
      tilingPaddingVertical: 4,
      tilingPaddingHorizontal: 4,
      packComponents: false,
    } as cytoscape.LayoutOptions);
    layout.one('layoutstop', () => this.startDrift());
    layout.run();
  }

  // ---- ambient idle drift ----------------------------------------------

  private startDrift(): void {
    this.stopDrift();
    this.driftTimer = window.setInterval(() => {
      if (this.interacting) {
        return;
      }
      this.cy.batch(() => {
        this.cy.nodes(':visible').forEach((n) => {
          if (!n.isChildless() || n.grabbed()) {
            return; // drift only the leaf "stars"; parents follow their children
          }
          const p = n.position();
          n.position({
            x: p.x + (Math.random() - 0.5) * 2 * DRIFT_AMPLITUDE,
            y: p.y + (Math.random() - 0.5) * 2 * DRIFT_AMPLITUDE,
          });
        });
      });
    }, DRIFT_INTERVAL_MS);
  }

  private stopDrift(): void {
    if (this.driftTimer !== null) {
      clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
  }

  private suspendDrift(): void {
    this.interacting = true;
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
    }
    this.resumeTimer = window.setTimeout(() => {
      this.interacting = false;
      this.resumeTimer = null;
    }, DRIFT_RESUME_MS);
  }

  private notifyState(): void {
    this.onStateChange?.({
      expanded: [...this.expanded],
      importsVisible: this.importsVisible,
      callsVisible: this.callsVisible,
    });
  }

  private buildStyle(): cytoscape.StylesheetStyle[] {
    const fileColor = themeColor('--vscode-charts-blue', '#4daafc');
    const classColor = themeColor('--vscode-charts-orange', '#e2a45e');
    const fnColor = themeColor('--vscode-charts-green', '#89d185');
    const methodColor = themeColor('--vscode-charts-purple', '#b180d7');
    const hitColor = themeColor('--vscode-charts-yellow', '#e2c08d');

    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: '#dfe3ee',
          'font-size': 9,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-wrap': 'ellipsis',
          'text-max-width': '140px',
          'text-outline-width': 2,
          'text-outline-color': AMBIENT_BG,
          'text-outline-opacity': 1,
          shape: 'ellipse',
          'background-color': fileColor,
          'background-opacity': 1,
          'border-width': 0,
          width: NODE_SIZE,
          height: NODE_SIZE,
        },
      },
      {
        selector: 'node[type = "file"]',
        style: { 'background-color': fileColor, width: FILE_NODE_SIZE, height: FILE_NODE_SIZE },
      },
      { selector: 'node[type = "class"]', style: { 'background-color': classColor } },
      { selector: 'node[type = "function"]', style: { 'background-color': fnColor } },
      { selector: 'node[type = "method"]', style: { 'background-color': methodColor } },
      {
        selector: ':parent',
        style: {
          shape: 'round-rectangle',
          'background-opacity': 0.04,
          'background-color': '#ffffff',
          'border-width': 1,
          'border-color': 'rgba(255,255,255,0.12)',
          'text-valign': 'top',
          'font-size': 10,
          'font-weight': 'bold',
          padding: '6px',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 0.6,
          'line-color': 'rgba(255,255,255,0.18)',
          'curve-style': 'straight',
          'target-arrow-shape': 'none',
        },
      },
      {
        selector: 'edge[type = "calls"]',
        style: { 'line-color': 'rgba(255,180,180,0.18)', 'line-style': 'dashed' },
      },
      { selector: '.dim', style: { opacity: 0.12 } },
      {
        selector: 'node.focus',
        style: { 'background-opacity': 1, 'border-width': 1, 'border-color': fileColor, 'border-opacity': 0.9 },
      },
      {
        selector: 'edge.focus',
        style: { width: 1.2, 'line-color': fileColor, 'line-opacity': 0.9 },
      },
      {
        selector: 'node:selected, node.selected',
        style: { 'background-opacity': 1, 'border-width': 2, 'border-color': fileColor, 'border-opacity': 1 },
      },
      { selector: '.search-dim', style: { opacity: 0.06 } },
      {
        selector: 'node.search-hit',
        style: {
          'background-opacity': 1,
          'border-width': 2,
          'border-color': hitColor,
          'border-opacity': 1,
          'z-index': 100,
        },
      },
    ];
  }
}

function pushEdge(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const arr = map.get(key);
  if (arr) {
    arr.push(edge);
  } else {
    map.set(key, [edge]);
  }
}
