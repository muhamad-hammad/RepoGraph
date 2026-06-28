# Repo Graph

A VSCode extension that draws an interactive graph of your code structure.

Parses Python and JavaScript/TypeScript with `web-tree-sitter` and renders
file → class → function nesting plus `imports` edges in a Cytoscape webview.
Pure static analysis — no AI, no runtime instrumentation.

## Usage

1. Open a folder.
2. Run **Show Repo Graph** from the Command Palette.
3. The graph opens at file level. Click a node to expand its children.

Toolbar: **Refresh**, **Expand all**, **Collapse all**, toggle
**imports**/**calls** edges, **search** by name, and **export** to PNG/PDF.
Clicking a node fills the breadcrumb (file ▸ class ▸ method) and opens a source
panel beside the graph. Search highlights and auto-expands matches; hover
spotlights a node's neighbors.

## Develop

```sh
npm install
npm run build    # bundle host + webview into dist/
npm run watch    # rebuild on change
npm test         # headless tests
npm run package  # build a .vsix
```

Press **F5** to launch an Extension Development Host, then run the command there.

## Architecture

```
Host (Node):  FileWalker → QueryRunner → Node/EdgeBuilder → RepoGraph (JSON)
                  ↓ postMessage
Webview:      GraphAdapter → CytoscapeManager (compound nesting, fcose layout)
```

Containment uses Cytoscape compound nesting (not edges); `imports` edges are
drawn. The pipeline under `src/parser/*` and `src/graph/*` has no vscode
dependency, so it runs headless.

## Limitations

- **Import resolution is best-effort** — barrel files, re-exports, and dynamic
  `import()` may be skipped.
- **`calls` edges are a naive hint, not a real call graph.** Off by default.
- **First workspace folder only.**
- Whole graph builds up front; large repos show a progress notification.

## Tech

`web-tree-sitter` · `tree-sitter-wasms` · `cytoscape` + `cytoscape-fcose` · `esbuild`.
