import { createBipartiteGraph, layoutGraph } from "hina-js";

import { ClientWorkbench } from "./client-workbench";

const serverGraph = createBipartiteGraph(
  [
    { actor: "Ada", object: "Evidence" },
    { actor: "Ada", object: "Model" },
    { actor: "Bo", object: "Evidence" },
  ],
  { studentColumn: "actor", objectColumn: "object" },
).graph;
const serverLayout = layoutGraph(serverGraph, { type: "circular", seed: 2026 });

export default function HomePage() {
  return (
    <main data-next-fixture="hina-js">
      <header className="fixture-header">
        <p>Next.js 16 · real npm tarball · Turbopack</p>
        <h1>hina-js integration fixture</h1>
        <p data-server-import="ready">
          The Server Component imported the portable root and positioned {Object.keys(serverLayout.positions).length} nodes.
        </p>
      </header>
      <ClientWorkbench />
    </main>
  );
}
