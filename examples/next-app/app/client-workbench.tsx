"use client";

import type { ParsedDataset } from "hina-js/io";
import { HinaWorkbench } from "hina-js/react";

const dataset: ParsedDataset = {
  name: "next-fixture.csv",
  columns: ["actor", "object", "category"],
  rows: [
    { actor: "Ada", object: "Evidence", category: "Reasoning" },
    { actor: "Ada", object: "Model", category: "Representation" },
    { actor: "Bo", object: "Evidence", category: "Reasoning" },
  ],
  diagnostics: [],
};

export function ClientWorkbench() {
  return (
    <section data-client-workbench="ready" aria-label="Client-side HINA workbench">
      <HinaWorkbench
        defaultDataset={dataset}
        defaultConfig={{
          actorColumn: "actor",
          objectColumn: "object",
          objectAttribute: "category",
          layoutType: "spring",
          seed: 2026,
        }}
      />
    </section>
  );
}
