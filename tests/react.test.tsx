// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBipartiteGraph } from "../src/construction";
import type { PruneEdgesResult } from "../src/dyad";
import { analyzeIndividuals } from "../src/individual";
import type { ParsedDataset } from "../src/io";
import type { CommunityResult } from "../src/mesoscale";
import {
  HinaNetwork,
  HinaResultsPanel,
  HinaWorkbench,
  type HinaAnalysisResult,
} from "../src/react/index";
import { layoutGraph } from "../src/visualization";

const cytoscapeMock = vi.hoisted(() => {
  const destroy = vi.fn();
  const instance = {
    destroy,
    fit: vi.fn(),
    nodes: vi.fn(() => ({ forEach: vi.fn() })),
    on: vi.fn(),
    png: vi.fn(() => new Blob(["png"], { type: "image/png" })),
    zoom: vi.fn((value?: number) => value ?? 1),
  };
  return {
    destroy,
    factory: vi.fn(() => instance),
  };
});

vi.mock("cytoscape", () => ({ default: cytoscapeMock.factory }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SOURCE_ROWS = [
  { student: "Alice", object: "Ask", group: "A", category: "question" },
  { student: "Alice", object: "Explain", group: "A", category: "explanation" },
  { student: "Bob", object: "Ask", group: "B", category: "question" },
] as const;

function sampleResult(): HinaAnalysisResult {
  const build = createBipartiteGraph(SOURCE_ROWS, {
    studentColumn: "student",
    objectColumn: "object",
    groupColumn: "group",
    attributeColumn: "category",
  });
  const individuals = analyzeIndividuals(build.graph, {
    attribute: "category",
    diversityAttribute: "category",
    group: "group",
  });
  const actorIds = build.graph.nodes
    .filter((node) => node.partition === "student")
    .map((node) => node.id);
  const pruning: PruneEdgesResult = {
    graph: build.graph,
    significantEdges: build.graph.edges.slice(0, 1),
    removedEdges: build.graph.edges.slice(1),
    thresholds: [],
    diagnostics: [],
  };
  const communities: CommunityResult = {
    communityCount: 1,
    nodeCommunities: actorIds.map((nodeId) => ({ nodeId, community: 0 })),
    communities: [{ id: 0, members: actorIds }],
    compressionRatio: 0.5,
    descriptionLength: 12.25,
    graph: build.graph,
    subgraphs: [],
    diagnostics: [],
  };
  return {
    graph: build.graph,
    analyzedGraph: build.graph,
    individuals,
    pruning,
    communities,
    layout: layoutGraph(build.graph, { type: "bipartite" }),
    diagnostics: build.diagnostics,
  };
}

function sampleDataset(): ParsedDataset {
  return {
    name: "sample.csv",
    columns: ["student", "object", "group", "category"],
    rows: SOURCE_ROWS,
    diagnostics: [],
  };
}

describe("HinaResultsPanel", () => {
  it("exposes every result family through semantic, labelled tabs", async () => {
    const user = userEvent.setup();
    render(<HinaResultsPanel result={sampleResult()} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(8);
    expect(screen.getByRole("tab", { name: "Quantity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("table", { name: "Quantity" })).toBeVisible();

    const expectedTables = [
      "Diversity",
      "Normalized Quantity",
      "Quantity by Category",
      "Normalized by Group",
      "Significant Edges",
      "Cluster Labels",
      "Community Summary",
    ] as const;
    for (const label of expectedTables) {
      await user.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("table", { name: label })).toBeVisible();
      expect(screen.getByRole("tabpanel")).toHaveAccessibleName(label);
    }
  });

  it("supports arrow, Home, and End keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<HinaResultsPanel result={sampleResult()} />);
    const quantity = screen.getByRole("tab", { name: "Quantity" });

    quantity.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Diversity" })).toHaveFocus();
    expect(screen.getByRole("table", { name: "Diversity" })).toBeVisible();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Community Summary" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Quantity" })).toHaveFocus();
  });
});

describe("HinaNetwork", () => {
  it("mounts the browser renderer lazily and exposes accessible controls", async () => {
    const result = sampleResult();
    const { unmount } = render(
      <HinaNetwork graph={result.graph} layout={result.layout} />,
    );

    expect(
      screen.getByRole("img", {
        name: `HINA network with ${result.graph.nodes.length} nodes and ${result.graph.edges.length} edges`,
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export PNG" })).toBeEnabled();
    await waitFor(() => expect(cytoscapeMock.factory).toHaveBeenCalledOnce());

    unmount();
    expect(cytoscapeMock.destroy).toHaveBeenCalledOnce();
  });

  it("keeps exported Blob URLs alive until the browser has started the download", async () => {
    vi.useFakeTimers();
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    );
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
    );
    const createObjectUrl = vi.fn(() => "blob:hina-network");
    const revokeObjectUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      const result = sampleResult();
      render(<HinaNetwork graph={result.graph} layout={result.layout} />);
      await vi.waitFor(() => expect(cytoscapeMock.factory).toHaveBeenCalledOnce());

      fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));

      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(anchorClick).toHaveBeenCalledOnce();
      expect(revokeObjectUrl).not.toHaveBeenCalled();
      expect(document.querySelector('a[download="hina-network.png"]')).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:hina-network");
      expect(document.querySelector('a[download="hina-network.png"]')).toBeNull();
    } finally {
      if (originalCreateObjectUrl === undefined) {
        Reflect.deleteProperty(URL, "createObjectURL");
      } else {
        Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
      }
      if (originalRevokeObjectUrl === undefined) {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      } else {
        Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
      }
      anchorClick.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("HinaWorkbench", () => {
  it("parses a user-selected local CSV without uploading it", async () => {
    const user = userEvent.setup();
    const onDatasetChange = vi.fn();
    render(<HinaWorkbench onDatasetChange={onDatasetChange} />);
    const csv = "student,object,group,category\nAlice,Ask,A,question\nBob,Explain,B,explanation\n";
    const file = new File([csv], "local.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: vi.fn(() => Promise.resolve(csv)),
    });

    await user.upload(screen.getByLabelText("Choose CSV/XLSX"), file);

    await waitFor(() => expect(onDatasetChange).toHaveBeenCalledOnce());
    expect(onDatasetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "local.csv",
        columns: ["student", "object", "group", "category"],
        rows: [
          { student: "Alice", object: "Ask", group: "A", category: "question" },
          { student: "Bob", object: "Explain", group: "B", category: "explanation" },
        ],
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "local.csv: 2 rows · 4 columns",
    );
    expect(screen.getByRole("combobox", { name: "Object1 / actor" })).toHaveValue(
      "student",
    );
    expect(screen.getByRole("combobox", { name: "Object2" })).toHaveValue(
      "object",
    );
  });

  it("runs the local analysis and exposes network and export results", async () => {
    const user = userEvent.setup();
    const onAnalysisComplete = vi.fn();
    render(
      <HinaWorkbench
        defaultDataset={sampleDataset()}
        defaultConfig={{
          actorAttribute: "group",
          objectAttribute: "category",
        }}
        onAnalysisComplete={onAnalysisComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run HINA" }));

    await waitFor(() => expect(onAnalysisComplete).toHaveBeenCalledOnce());
    expect(screen.getByRole("img", { name: /HINA network with \d+ nodes and \d+ edges/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export XLSX" })).toBeEnabled();
    expect(screen.getByRole("tablist", { name: "HINA results" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Quantity" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "Node size" })).toHaveValue("1");
    expect(screen.getByLabelText("Actor color")).toHaveValue("#2563eb");
  });

  it("filters actors by group without reintroducing them through object edges", async () => {
    const user = userEvent.setup();
    render(
      <HinaWorkbench
        defaultDataset={sampleDataset()}
        defaultConfig={{
          actorAttribute: "group",
          objectAttribute: "category",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run HINA" }));
    await screen.findByRole("img", {
      name: "HINA network with 4 nodes and 3 edges",
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Group" }),
      "A",
    );

    expect(
      screen.getByRole("img", {
        name: "HINA network with 3 nodes and 2 edges",
      }),
    ).toBeVisible();
  });
});
