// Converts a RepoGraph into Cytoscape element definitions. Containment is
// expressed through compound nesting (the `parent` data field) rather than as
// explicit edges; import edges are emitted as real edges.

import type { ElementDefinition } from 'cytoscape';
import type { RepoGraph } from '../src/shared/types';

export function toElements(graph: RepoGraph): ElementDefinition[] {
  const elements: ElementDefinition[] = [];

  for (const node of graph.nodes) {
    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.label,
        type: node.type,
        // Compound parent: drives visual nesting (file > class > function).
        parent: node.parentId ?? undefined,
        filePath: node.filePath,
        startLine: node.lineRange?.start ?? null,
        endLine: node.lineRange?.end ?? null,
      },
    });
  }

  for (const edge of graph.edges) {
    // 'contains' is represented by compound nesting, so skip those edges.
    if (edge.type === 'contains') {
      continue;
    }
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
        label: edge.label ?? '',
      },
    });
  }

  return elements;
}
