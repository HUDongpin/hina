import { createBipartiteGraph, layoutGraph } from "hina-js";

export const runtime = "edge";

export function GET() {
  const graph = createBipartiteGraph(
    [
      { actor: "Ada", object: "Evidence" },
      { actor: "Ada", object: "Model" },
      { actor: "Bo", object: "Evidence" },
    ],
    { studentColumn: "actor", objectColumn: "object" },
  ).graph;
  const layout = layoutGraph(graph, { type: "bipartite", seed: 2026 });

  return Response.json({
    runtime,
    graphKind: graph.kind,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    positionedNodes: Object.keys(layout.positions).length,
  });
}
