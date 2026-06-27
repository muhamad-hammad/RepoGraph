// Owns the Cytoscape instance: a Logseq-style force-directed look (fcose
// layout, degree-sized circular leaves, hover-focus that highlights a node's
// neighborhood and dims the rest) layered on the collapse/expand model.

import cytoscape, { Core, NodeSingular, ElementDefinition, Collection } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import type { RepoGraph } from '../src/shared/types';
import { toElements } from './GraphAdapter';

cytoscape.use(fcose);

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

export class CytoscapeManager {
  private cy: Core;
  /** Node IDs whose children are currently shown. Files collapsed by default. */
  private expanded = new Set<string>();
  private importsVisible = true;
  private callsVisible = false;

  constructor(container: HTMLElement) {
    this.cy = cytoscape({
      container,
      style: this.buildStyle(),
      wheelSensitivity: 0.2,
      minZoom: 0.05,
      maxZoom: 4,
    });

    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      if (node.isParent()) {
        this.toggle(node.id());
      }
    });

    // Logseq-style hover focus: spotlight the hovered node's neighborhood.
    this.cy.on('mouseover', 'node', (evt) => this.focus(evt.target as NodeSingular));
    this.cy.on('mouseout', 'node', () => this.clearFocus());
  }

  /** Replace the graph: start fully collapsed (file-level nodes only). */
  setGraph(graph: RepoGraph): void {
    const elements = toElements(graph);
    this.cy.elements().remove();
    this.cy.add(elements as ElementDefinition[]);
    // Size leaves by connectivity (degree) — the Logseq signature look.
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        n.data('deg', n.degree(false));
      });
    });
    this.expanded.clear();
    this.applyVisibility();
    this.relayout(true);
  }

  expandAll(): void {
    this.cy.nodes().forEach((n) => {
      if (n.isParent()) {
        this.expanded.add(n.id());
      }
    });
    this.applyVisibility();
    this.relayout(true);
  }

  collapseAll(): void {
    this.expanded.clear();
    this.applyVisibility();
    this.relayout(true);
  }

  setImportsVisible(visible: boolean): void {
    this.importsVisible = visible;
    this.cy.edges('[type = "imports"]').style('display', visible ? 'element' : 'none');
  }

  setCallsVisible(visible: boolean): void {
    this.callsVisible = visible;
    this.cy.edges('[type = "calls"]').style('display', visible ? 'element' : 'none');
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
    }
    this.applyVisibility();
    this.relayout(false);
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
        n.style('display', this.isVisible(n) ? 'element' : 'none');
      });
      this.cy
        .edges('[type = "imports"]')
        .style('display', this.importsVisible ? 'element' : 'none');
      this.cy
        .edges('[type = "calls"]')
        .style('display', this.callsVisible ? 'element' : 'none');
    });
  }

  private isVisible(node: NodeSingular): boolean {
    let parent = node.data('parent') as string | undefined;
    while (parent) {
      if (!this.expanded.has(parent)) {
        return false;
      }
      parent = this.cy.getElementById(parent).data('parent') as string | undefined;
    }
    return true;
  }

  private relayout(fit: boolean): void {
    const visible = this.cy.elements(':visible');
    visible
      .layout({
        name: 'fcose',
        quality: 'default',
        animate: false,
        randomize: true,
        fit,
        padding: 50,
        nodeSeparation: 90,
        idealEdgeLength: () => 90,
        nodeRepulsion: () => 6000,
        gravity: 0.25,
        gravityCompound: 1.0,
        nestingFactor: 0.1,
        packComponents: true,
      } as cytoscape.LayoutOptions)
      .run();
    if (fit) {
      this.cy.fit(undefined, 50);
    }
  }

  private buildStyle(): cytoscape.StylesheetStyle[] {
    const fg = themeColor('--vscode-foreground', '#ccc');
    const bg = themeColor('--vscode-editor-background', '#1e1e1e');
    const border = themeColor('--vscode-panel-border', '#555');
    const fileColor = themeColor('--vscode-charts-blue', '#4daafc');
    const classColor = themeColor('--vscode-charts-orange', '#e2a45e');
    const fnColor = themeColor('--vscode-charts-green', '#89d185');
    const methodColor = themeColor('--vscode-charts-purple', '#b180d7');
    const importColor = themeColor('--vscode-charts-foreground', '#8a8a8a');

    // Degree -> diameter mapping for leaf nodes (Logseq-style sizing).
    const sizeByDegree = 'mapData(deg, 0, 10, 14, 46)';

    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: fg,
          'font-size': 10,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 3,
          'text-wrap': 'ellipsis',
          'text-max-width': '140px',
          'text-outline-width': 2,
          'text-outline-color': bg,
          'text-outline-opacity': 0.9,
          'border-width': 0,
          width: sizeByDegree,
          height: sizeByDegree,
        },
      },
      {
        selector: 'node[type = "file"]',
        style: { shape: 'ellipse', 'background-color': fileColor },
      },
      {
        selector: 'node[type = "class"]',
        style: { shape: 'ellipse', 'background-color': classColor },
      },
      {
        selector: 'node[type = "function"]',
        style: { shape: 'ellipse', 'background-color': fnColor },
      },
      {
        selector: 'node[type = "method"]',
        style: { shape: 'ellipse', 'background-color': methodColor },
      },
      {
        // Expanded container nodes: faint hull around children, label on top.
        selector: ':parent',
        style: {
          shape: 'round-rectangle',
          'background-opacity': 0.07,
          'background-color': fg,
          'border-width': 1,
          'border-color': border,
          'border-opacity': 0.4,
          'text-valign': 'top',
          'font-size': 11,
          'font-weight': 'bold',
          padding: '16px',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1,
          'line-color': importColor,
          'line-opacity': 0.5,
          'curve-style': 'bezier',
          'target-arrow-color': importColor,
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
        },
      },
      {
        // calls edges: red dashed, distinct from imports.
        selector: 'edge[type = "calls"]',
        style: {
          'line-color': '#e06c75',
          'line-style': 'dashed',
          'target-arrow-color': '#e06c75',
        },
      },
      // Hover-focus states.
      {
        selector: '.dim',
        style: { opacity: 0.12 },
      },
      {
        selector: 'node.focus',
        style: { 'border-width': 2, 'border-color': fileColor, 'border-opacity': 1 },
      },
      {
        selector: 'edge.focus',
        style: { width: 2, 'line-opacity': 1, 'line-color': fileColor, 'target-arrow-color': fileColor },
      },
    ];
  }
}
