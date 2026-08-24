import { analyzeQuantity, createBipartiteGraph } from "hina-js";

export const runtime = "nodejs";

export function GET() {
  const graph = createBipartiteGraph(
    [
      { actor: "Ada", object: "Evidence" },
      { actor: "Ada", object: "Model" },
      { actor: "Bo", object: "Evidence" },
    ],
    { studentColumn: "actor", objectColumn: "object" },
  ).graph;
  const quantity = analyzeQuantity(graph);

  return Response.json({
    runtime,
    graphKind: graph.kind,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    totalWeight: quantity.totalWeight,
  });
}
