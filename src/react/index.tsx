"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  Core as CytoscapeCore,
  ElementDefinition,
  StylesheetJson,
} from "cytoscape";

import {
  createBipartiteGraph,
  createTripartiteGraph,
} from "../construction";
import { pruneEdges, type PruneEdgesResult } from "../dyad";
import { HinaValidationError } from "../errors";
import { analyzeIndividuals } from "../individual";
import {
  exportResultsXlsx,
  parseCsv,
  parseXlsx,
  type HinaResultsBundle,
  type ParsedDataset,
} from "../io";
import {
  detectCommunities,
  type CommunityResult,
} from "../mesoscale";
import { serializeGraph } from "../serialization";
import type {
  HinaDiagnostic,
  HinaGraph,
  IndividualResult,
  JsonValue,
  TabularRow,
} from "../types";
import {
  layoutGraph,
  projectGraph,
  toCytoscapeElements,
  type LayoutResult,
  type LayoutType,
  type ProjectionResult,
} from "../visualization";

export interface HinaWorkbenchConfig {
  readonly actorColumn: string;
  readonly objectColumn: string;
  readonly object2Column: string | null;
  readonly actorAttribute: string | null;
  readonly objectAttribute: string | null;
  readonly layoutType: LayoutType;
  readonly seed: number;
  readonly fixedCommunityCount: number | null;
  readonly pruningEnabled: boolean;
  readonly alpha: number;
  readonly fixedPartition: string | null;
  readonly projectionEnabled: boolean;
  readonly projectionTarget: "actor" | "object";
  readonly hideZeroSimilarity: boolean;
  readonly showLabels: boolean;
  readonly showWeights: boolean;
  readonly scaleNodesByQuantity: boolean;
  readonly nodeScale: number;
  readonly actorColor: string;
  readonly objectColor: string;
  readonly compositeColor: string;
  readonly edgeColor: string;
}

export interface HinaAnalysisResult {
  readonly graph: HinaGraph;
  readonly analyzedGraph: HinaGraph;
  readonly individuals: IndividualResult;
  readonly pruning?: PruneEdgesResult;
  readonly communities?: CommunityResult;
  readonly projection?: ProjectionResult;
  readonly layout: LayoutResult;
  readonly diagnostics: readonly HinaDiagnostic[];
}

export interface UseHinaAnalysisState {
  readonly status: "idle" | "running" | "success" | "error";
  readonly result: HinaAnalysisResult | null;
  readonly error: Error | null;
  readonly run: () => Promise<HinaAnalysisResult | null>;
}

const DEFAULT_CONFIG: HinaWorkbenchConfig = {
  actorColumn: "",
  objectColumn: "",
  object2Column: null,
  actorAttribute: null,
  objectAttribute: null,
  layoutType: "bipartite",
  seed: 0,
  fixedCommunityCount: null,
  pruningEnabled: false,
  alpha: 0.05,
  fixedPartition: null,
  projectionEnabled: false,
  projectionTarget: "actor",
  hideZeroSimilarity: false,
  showLabels: true,
  showWeights: false,
  scaleNodesByQuantity: true,
  nodeScale: 1,
  actorColor: "#2563EB",
  objectColor: "#D97706",
  compositeColor: "#7C3AED",
  edgeColor: "#94A3B8",
};

function diagnosticsFromError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function jsonValueLabel(value: JsonValue | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

interface CytoscapeNodeTarget {
  id(): string;
  data(name: string): unknown;
}

function isCytoscapeNodeTarget(value: unknown): value is CytoscapeNodeTarget {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly id?: unknown; readonly data?: unknown };
  return typeof candidate.id === "function" && typeof candidate.data === "function";
}

function configuredGraph(
  rows: readonly TabularRow[],
  config: HinaWorkbenchConfig,
): { readonly graph: HinaGraph; readonly diagnostics: readonly HinaDiagnostic[] } {
  if (config.actorColumn.length === 0 || config.objectColumn.length === 0) {
    throw new HinaValidationError(
      "MISSING_COLUMN",
      "Choose both Object1 (actor) and Object2 before running HINA.",
    );
  }

  if (config.object2Column !== null && config.object2Column.length > 0) {
    return createTripartiteGraph(rows, {
      studentColumn: config.actorColumn,
      object1Column: config.objectColumn,
      object2Column: config.object2Column,
      groupColumn: config.actorAttribute,
      conflictStrategy: "error",
    });
  }

  return createBipartiteGraph(rows, {
    studentColumn: config.actorColumn,
    objectColumn: config.objectColumn,
    attributeColumn: config.objectAttribute,
    groupColumn: config.actorAttribute,
    conflictStrategy: "error",
  });
}

/** Run the complete local HINA workflow without a server request. */
export function useHinaAnalysis(
  dataset: ParsedDataset | null,
  config: HinaWorkbenchConfig,
): UseHinaAnalysisState {
  const [status, setStatus] = useState<UseHinaAnalysisState["status"]>("idle");
  const [result, setResult] = useState<HinaAnalysisResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(async (): Promise<HinaAnalysisResult | null> => {
    if (dataset === null) {
      const nextError = new HinaValidationError(
        "UNSUPPORTED_FILE",
        "Choose a CSV or XLSX dataset before running HINA.",
      );
      setError(nextError);
      setStatus("error");
      return null;
    }

    setStatus("running");
    setError(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    try {
      const build = configuredGraph(dataset.rows, config);
      const individuals = analyzeIndividuals(build.graph, {
        attribute: config.objectAttribute,
        diversityAttribute: config.objectAttribute,
        group: config.actorAttribute,
      });
      const pruning = config.pruningEnabled
        ? pruneEdges(build.graph, {
            alpha: config.alpha,
            fixedPartition: config.fixedPartition,
          })
        : undefined;
      const graphAfterPruning = pruning?.graph ?? build.graph;
      const actorCount = graphAfterPruning.nodes.filter(
        (node) => node.partition === config.actorColumn,
      ).length;
      const hasPositiveEdge = graphAfterPruning.edges.some(
        (edge) => edge.weight > 0,
      );
      const communityDiagnostics: HinaDiagnostic[] =
        actorCount > 0 && !hasPositiveEdge
          ? [{
              code: "COMMUNITY_ANALYSIS_SKIPPED",
              severity: "warning",
              message: "Community analysis was skipped because no positive-weight edge remained.",
              details: { actorPartition: config.actorColumn },
            }]
          : [];
      const communities = actorCount > 0 && hasPositiveEdge
        ? detectCommunities(graphAfterPruning, {
            ...(config.fixedCommunityCount === null
              ? {}
              : { fixedCommunityCount: config.fixedCommunityCount }),
            targetPartition: config.actorColumn,
          })
        : undefined;
      const projectionTarget = config.projectionTarget === "actor"
        ? config.actorColumn
        : graphAfterPruning.partitions.find(
            (partition) => partition.id !== config.actorColumn,
          )?.id;
      const projection = config.projectionEnabled && projectionTarget !== undefined
        ? projectGraph(graphAfterPruning, {
            targetPartition: projectionTarget,
            includeZeroSimilarity: !config.hideZeroSimilarity,
          })
        : undefined;
      const analyzedGraph = projection?.graph ?? graphAfterPruning;
      const layout = layoutGraph(analyzedGraph, {
        type: config.layoutType,
        seed: config.seed,
        ...(communities === undefined || projection !== undefined
          ? {}
          : { communities }),
      });
      const diagnostics = [
        ...build.diagnostics,
        ...individuals.diagnostics,
        ...(pruning?.diagnostics ?? []),
        ...(communities?.diagnostics ?? []),
        ...communityDiagnostics,
      ];
      const nextResult: HinaAnalysisResult = {
        graph: build.graph,
        analyzedGraph,
        individuals,
        ...(pruning === undefined ? {} : { pruning }),
        ...(communities === undefined ? {} : { communities }),
        ...(projection === undefined ? {} : { projection }),
        layout,
        diagnostics,
      };
      setResult(nextResult);
      setStatus("success");
      return nextResult;
    } catch (cause) {
      const nextError = diagnosticsFromError(cause);
      setError(nextError);
      setStatus("error");
      return null;
    }
  }, [config, dataset]);

  return { status, result, error, run };
}

export interface HinaNetworkProps {
  readonly graph: HinaGraph;
  readonly layout?: LayoutResult;
  readonly showLabels?: boolean;
  readonly showWeights?: boolean;
  readonly nodeSizes?: Readonly<Record<string, number>>;
  readonly nodeScale?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onNodeSelect?: (nodeId: string | null) => void;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
}

/** Accessible Cytoscape renderer; Cytoscape is instantiated only in an effect. */
export function HinaNetwork({
  graph,
  layout,
  showLabels = true,
  showWeights = false,
  nodeSizes = {},
  nodeScale = 1,
  className,
  style,
  onNodeSelect,
}: HinaNetworkProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cytoscapeRef = useRef<CytoscapeCore | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const resolvedNodeScale = Number.isFinite(nodeScale) && nodeScale > 0
    ? nodeScale
    : 1;

  useEffect(() => {
    let disposed = false;
    let instance: CytoscapeCore | null = null;
    const initialize = async (): Promise<void> => {
      if (containerRef.current === null) return;
      const module = await import("cytoscape");
      if (disposed || containerRef.current === null) return;
      const rootStyle = getComputedStyle(containerRef.current);
      const actorColor = rootStyle.getPropertyValue("--hina-actor-color").trim() || "#2563EB";
      const objectColor = rootStyle.getPropertyValue("--hina-object-color").trim() || "#D97706";
      const compositeColor = rootStyle.getPropertyValue("--hina-composite-color").trim() || "#7C3AED";
      const edgeColor = rootStyle.getPropertyValue("--hina-edge-color").trim() || "#94A3B8";
      const raw = toCytoscapeElements(graph, {
        ...(layout === undefined ? {} : { positions: layout.positions }),
      });
      const elements = raw.map((element) => {
        if (element.group === "nodes") {
          return {
            ...element,
            data: {
              ...element.data,
              size: nodeSizes[element.data.id] ?? 1,
            },
          };
        }
        return element;
      }) as unknown as ElementDefinition[];
      const styles: StylesheetJson = [
        {
          selector: "node",
          style: {
            "background-color": objectColor,
            "border-color": "#FFFFFF",
            "border-width": 1,
            height: `mapData(size, 0, 1, ${18 * resolvedNodeScale}, ${54 * resolvedNodeScale})`,
            label: showLabels ? "data(label)" : "",
            "font-size": 11,
            "min-zoomed-font-size": 7,
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.82,
            "text-background-padding": "2px",
            "text-valign": "bottom",
            "text-margin-y": 5,
            width: `mapData(size, 0, 1, ${18 * resolvedNodeScale}, ${54 * resolvedNodeScale})`,
          },
        },
        {
          selector: 'node[partitionRole = "actor"]',
          style: { "background-color": actorColor },
        },
        {
          selector: 'node[partitionRole = "composite"]',
          style: { "background-color": compositeColor },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "line-color": edgeColor,
            label: showWeights ? "data(weight)" : "",
            "font-size": 10,
            "line-opacity": 0.72,
            width: "mapData(weight, 0, 10, 1, 7)",
          },
        },
        {
          selector: ":selected",
          style: {
            "border-color": "#0F172A",
            "border-width": 3,
            "line-color": "#0F172A",
          },
        },
      ];
      instance = module.default({
        container: containerRef.current,
        elements,
        layout: { name: "preset", fit: true, padding: 24 },
        minZoom: 0.1,
        maxZoom: 5,
        style: styles,
        wheelSensitivity: 0.25,
      });
      const roles = new Map(graph.partitions.map((partition) => [partition.id, partition.role]));
      instance.nodes().forEach((node) => {
        node.data("partitionRole", roles.get(String(node.data("partition"))) ?? "object");
      });
      instance.on("tap", "node", (event) => {
        const target: unknown = event.target;
        if (!isCytoscapeNodeTarget(target)) return;
        const id = target.id();
        const rawLabel = target.data("label");
        const label = typeof rawLabel === "string" ? rawLabel : id;
        setSelectedLabel(label);
        onNodeSelect?.(id);
      });
      instance.on("tap", (event) => {
        if (event.target === instance) {
          setSelectedLabel("");
          onNodeSelect?.(null);
        }
      });
      cytoscapeRef.current = instance;
    };
    void initialize();
    return () => {
      disposed = true;
      instance?.destroy();
      if (cytoscapeRef.current === instance) cytoscapeRef.current = null;
    };
  }, [graph, layout, nodeSizes, onNodeSelect, resolvedNodeScale, showLabels, showWeights]);

  const exportPng = useCallback(() => {
    const image = cytoscapeRef.current?.png({ full: true, output: "blob", scale: 2 });
    if (image instanceof Blob) downloadBlob(image, "hina-network.png");
  }, []);

  return (
    <section className={["hina-network", className].filter(Boolean).join(" ")} style={style}>
      <div className="hina-network__toolbar" aria-label="Network view controls">
        <button type="button" onClick={() => cytoscapeRef.current?.zoom(cytoscapeRef.current.zoom() * 1.2)}>
          Zoom in
        </button>
        <button type="button" onClick={() => cytoscapeRef.current?.zoom(cytoscapeRef.current.zoom() / 1.2)}>
          Zoom out
        </button>
        <button type="button" onClick={() => cytoscapeRef.current?.fit(undefined, 24)}>
          Reset view
        </button>
        <button type="button" onClick={exportPng}>Export PNG</button>
      </div>
      <div
        ref={containerRef}
        className="hina-network__canvas"
        role="img"
        aria-label={`HINA network with ${graph.nodes.length} nodes and ${graph.edges.length} edges`}
      />
      <p className="hina-network__summary">
        {graph.nodes.length} nodes · {graph.edges.length} edges
      </p>
      <p className="hina-sr-only" aria-live="polite">
        {selectedLabel.length > 0 ? `Selected node: ${selectedLabel}` : "No node selected"}
      </p>
      <details className="hina-network__accessible-list">
        <summary>Accessible network summary</summary>
        <ul>
          {graph.nodes.slice(0, 100).map((node) => (
            <li key={node.id}>{node.label} — {node.partition}</li>
          ))}
        </ul>
        {graph.nodes.length > 100 ? <p>Showing the first 100 nodes.</p> : null}
      </details>
    </section>
  );
}

type ResultTab =
  | "quantity"
  | "diversity"
  | "normalized"
  | "category"
  | "group"
  | "edges"
  | "clusters"
  | "communities";

const RESULT_TABS: readonly { readonly id: ResultTab; readonly label: string }[] = [
  { id: "quantity", label: "Quantity" },
  { id: "diversity", label: "Diversity" },
  { id: "normalized", label: "Normalized Quantity" },
  { id: "category", label: "Quantity by Category" },
  { id: "group", label: "Normalized by Group" },
  { id: "edges", label: "Significant Edges" },
  { id: "clusters", label: "Cluster Labels" },
  { id: "communities", label: "Community Summary" },
];

interface ResultsTableProps {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}

function ResultsTable({ caption, headers, rows }: ResultsTableProps): ReactNode {
  if (rows.length === 0) return <p className="hina-empty">No results for this view.</p>;
  return (
    <div className="hina-table-wrap">
      <table className="hina-table">
        <caption>{caption}</caption>
        <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${caption}-${rowIndex}`}>
              {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface HinaResultsPanelProps {
  readonly result: HinaAnalysisResult;
  readonly className?: string;
}

/** Semantic tabular presentation of every scientific result family. */
export function HinaResultsPanel({ result, className }: HinaResultsPanelProps): ReactNode {
  const [tab, setTab] = useState<ResultTab>("quantity");
  const tabsId = useId();
  const rows = result.individuals.rows;
  const activeIndex = RESULT_TABS.findIndex((item) => item.id === tab);
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % RESULT_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + RESULT_TABS.length) % RESULT_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RESULT_TABS.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = RESULT_TABS[nextIndex]!;
    setTab(nextTab.id);
    const tabElements = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    );
    tabElements?.[nextIndex]?.focus();
  };
  let table: ReactNode;
  switch (tab) {
    case "quantity":
      table = <ResultsTable caption="Quantity" headers={["Node", "Quantity"]} rows={rows.map((row) => [row.label, row.quantity])} />;
      break;
    case "diversity":
      table = <ResultsTable caption="Diversity" headers={["Node", "Diversity"]} rows={rows.map((row) => [row.label, row.diversity.toFixed(6)])} />;
      break;
    case "normalized":
      table = <ResultsTable caption="Normalized Quantity" headers={["Node", "Normalized quantity"]} rows={rows.map((row) => [row.label, row.normalizedQuantity.toFixed(6)])} />;
      break;
    case "category":
      table = <ResultsTable caption="Quantity by Category" headers={["Node", "Category", "Quantity"]} rows={rows.flatMap((row) => Object.entries(row.quantityByCategory ?? {}).map(([category, value]) => [row.label, category, value]))} />;
      break;
    case "group":
      table = <ResultsTable caption="Normalized by Group" headers={["Node", "Normalized quantity by group"]} rows={rows.map((row) => [row.label, row.normalizedQuantityByGroup?.toFixed(6) ?? "—"])} />;
      break;
    case "edges":
      table = <ResultsTable caption="Significant Edges" headers={["Source", "Target", "Weight"]} rows={(result.pruning?.significantEdges ?? []).map((edge) => [edge.source, edge.target, edge.weight])} />;
      break;
    case "clusters":
      table = <ResultsTable caption="Cluster Labels" headers={["Node ID", "Community"]} rows={(result.communities?.nodeCommunities ?? []).map((row) => [row.nodeId, row.community])} />;
      break;
    case "communities":
      table = <ResultsTable caption="Community Summary" headers={["Community", "Members", "Compression ratio"]} rows={(result.communities?.communities ?? []).map((community) => [community.id, community.members.length, result.communities?.compressionRatio.toFixed(6) ?? "—"])} />;
      break;
  }

  return (
    <section className={["hina-results", className].filter(Boolean).join(" ")}>
      <div className="hina-results__tabs" role="tablist" aria-label="HINA results">
        {RESULT_TABS.map((item, index) => (
          <button
            key={item.id}
            id={`${tabsId}-${item.id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${tabsId}-${item.id}-panel`}
            className={tab === item.id ? "is-active" : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id={`${tabsId}-${RESULT_TABS[activeIndex]!.id}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${RESULT_TABS[activeIndex]!.id}-tab`}
        className="hina-results__panel"
      >
        {table}
      </div>
    </section>
  );
}

export interface HinaWorkbenchProps {
  readonly dataset?: ParsedDataset | null;
  readonly defaultDataset?: ParsedDataset | null;
  readonly config?: Partial<HinaWorkbenchConfig>;
  readonly defaultConfig?: Partial<HinaWorkbenchConfig>;
  readonly onDatasetChange?: (dataset: ParsedDataset | null) => void;
  readonly onConfigChange?: (config: HinaWorkbenchConfig) => void;
  readonly onAnalysisComplete?: (result: HinaAnalysisResult) => void;
  readonly onError?: (error: Error) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function inferredConfig(
  dataset: ParsedDataset | null,
  input: Partial<HinaWorkbenchConfig>,
): HinaWorkbenchConfig {
  const columns = dataset?.columns ?? [];
  return {
    ...DEFAULT_CONFIG,
    actorColumn: input.actorColumn ?? columns[0] ?? "",
    objectColumn: input.objectColumn ?? columns[1] ?? "",
    ...input,
  };
}

function downloadText(value: string, type: string, name: string): void {
  downloadBlob(new Blob([value], { type }), name);
}

/** Full local-file analysis workbench intended for direct Next.js embedding. */
export function HinaWorkbench({
  dataset: controlledDataset,
  defaultDataset = null,
  config: controlledConfig,
  defaultConfig = {},
  onDatasetChange,
  onConfigChange,
  onAnalysisComplete,
  onError,
  className,
  style,
}: HinaWorkbenchProps): ReactNode {
  const id = useId();
  const [internalDataset, setInternalDataset] = useState<ParsedDataset | null>(defaultDataset);
  const [internalConfig, setInternalConfig] = useState<HinaWorkbenchConfig>(() => inferredConfig(defaultDataset, defaultConfig));
  const [workbookSheets, setWorkbookSheets] = useState<readonly ParsedDataset[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [communityFilter, setCommunityFilter] = useState<string>("");
  const dataset = controlledDataset === undefined ? internalDataset : controlledDataset;
  const config = controlledConfig === undefined
    ? internalConfig
    : inferredConfig(dataset, controlledConfig);
  const analysis = useHinaAnalysis(dataset, config);

  const setDataset = useCallback((next: ParsedDataset | null) => {
    if (controlledDataset === undefined) setInternalDataset(next);
    onDatasetChange?.(next);
    if (next !== null && controlledConfig === undefined) {
      setInternalConfig((current) => inferredConfig(next, {
        ...current,
        actorColumn: next.columns.includes(current.actorColumn) ? current.actorColumn : next.columns[0] ?? "",
        objectColumn: next.columns.includes(current.objectColumn) ? current.objectColumn : next.columns[1] ?? "",
      }));
    }
  }, [controlledConfig, controlledDataset, onDatasetChange]);

  const setConfig = useCallback((patch: Partial<HinaWorkbenchConfig>) => {
    const next = { ...config, ...patch };
    if (controlledConfig === undefined) setInternalConfig(next);
    onConfigChange?.(next);
  }, [config, controlledConfig, onConfigChange]);

  const handleFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = parseCsv(await file.text(), { name: file.name });
        setWorkbookSheets([parsed]);
        setDataset(parsed);
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbook = await parseXlsx(file);
        setWorkbookSheets(workbook.sheets);
        setDataset(workbook.sheets[0] ?? null);
      } else {
        throw new HinaValidationError(
          "UNSUPPORTED_FILE",
          "Only .csv and .xlsx files are supported.",
          { fileName: file.name },
        );
      }
    } catch (cause) {
      onError?.(diagnosticsFromError(cause));
    } finally {
      event.target.value = "";
    }
  }, [onError, setDataset]);

  const run = useCallback(async () => {
    const next = await analysis.run();
    if (next !== null) onAnalysisComplete?.(next);
    else if (analysis.error !== null) onError?.(analysis.error);
  }, [analysis, onAnalysisComplete, onError]);

  useEffect(() => {
    if (analysis.status === "error" && analysis.error !== null) onError?.(analysis.error);
  }, [analysis.error, analysis.status, onError]);

  const actorPartition = config.actorColumn;
  const groupValues = useMemo(() => {
    if (analysis.result === null || config.actorAttribute === null) return [];
    return [...new Set(analysis.result.graph.nodes
      .filter((node) => node.partition === actorPartition)
      .map((node) => jsonValueLabel(node.attributes[config.actorAttribute!], "NA")))]
      .sort();
  }, [actorPartition, analysis.result, config.actorAttribute]);

  const filteredGraph = useMemo((): HinaGraph | null => {
    if (analysis.result === null) return null;
    const graph = analysis.result.analyzedGraph;
    if (groupFilter.length === 0 && communityFilter.length === 0) return graph;
    const communityByNode = new Map(
      (analysis.result.communities?.nodeCommunities ?? []).map((row) => [row.nodeId, String(row.community)]),
    );
    const actorNodes = graph.nodes.filter(
      (node) => node.partition === actorPartition,
    );
    if (actorNodes.length === 0) return graph;
    const actorIds = new Set(actorNodes.map((node) => node.id));
    const keep = new Set(actorNodes
      .filter((node) => {
        const groupMatches = groupFilter.length === 0 || jsonValueLabel(node.attributes[config.actorAttribute ?? ""], "") === groupFilter;
        const communityMatches = communityFilter.length === 0 || communityByNode.get(node.id) === communityFilter;
        return groupMatches && communityMatches;
      })
      .map((node) => node.id));
    for (const edge of graph.edges) {
      const sourceIsActor = actorIds.has(edge.source);
      const targetIsActor = actorIds.has(edge.target);
      if (sourceIsActor && !targetIsActor && keep.has(edge.source)) keep.add(edge.target);
      if (targetIsActor && !sourceIsActor && keep.has(edge.target)) keep.add(edge.source);
    }
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => keep.has(node.id)),
      edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    };
  }, [actorPartition, analysis.result, communityFilter, config.actorAttribute, groupFilter]);

  const nodeSizes = useMemo(() => {
    if (!config.scaleNodesByQuantity || analysis.result === null) return {};
    const values = analysis.result.individuals.rows.map((row) => row.quantity);
    const maximum = Math.max(1, ...values);
    return Object.fromEntries(
      analysis.result.individuals.rows.map((row) => [row.nodeId, row.quantity / maximum]),
    );
  }, [analysis.result, config.scaleNodesByQuantity]);

  const exportXlsx = useCallback(async () => {
    if (analysis.result === null) return;
    const bundle: HinaResultsBundle = {
      graph: analysis.result.graph,
      individuals: analysis.result.individuals,
      ...(analysis.result.pruning === undefined ? {} : { pruning: analysis.result.pruning }),
      ...(analysis.result.communities === undefined ? {} : { communities: analysis.result.communities }),
      diagnostics: analysis.result.diagnostics,
    };
    const bytes = await exportResultsXlsx(bundle);
    downloadBlob(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "hina-results.xlsx",
    );
  }, [analysis.result]);

  const columns = dataset?.columns ?? [];
  const communityValues = analysis.result?.communities?.communities.map((community) => String(community.id)) ?? [];
  const selectColumn = (
    label: string,
    value: string | null,
    onChange: (value: string | null) => void,
    optional = false,
  ): ReactNode => (
    <label>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value.length === 0 ? null : event.target.value)}>
        {optional ? <option value="">None</option> : null}
        {columns.map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
    </label>
  );

  return (
    <section className={["hina-workbench", className].filter(Boolean).join(" ")} style={style}>
      <header className="hina-workbench__header">
        <div>
          <p className="hina-eyebrow">Local analysis · no upload</p>
          <h2>HINA Workbench</h2>
          <p>Load CSV/XLSX, configure partitions, run HINA, inspect the network, and export results.</p>
        </div>
        <label className="hina-file-button" htmlFor={`${id}-file`}>Choose CSV/XLSX</label>
        <input id={`${id}-file`} className="hina-sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => void handleFile(event)} />
      </header>

      {workbookSheets.length > 1 ? (
        <label className="hina-sheet-picker">
          <span>Worksheet</span>
          <select value={dataset?.name ?? ""} onChange={(event) => setDataset(workbookSheets.find((sheet) => sheet.name === event.target.value) ?? null)}>
            {workbookSheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
          </select>
        </label>
      ) : null}

      <div className="hina-workbench__grid">
        <aside className="hina-controls" aria-label="HINA configuration">
          <fieldset>
            <legend>Data mapping</legend>
            {selectColumn("Object1 / actor", config.actorColumn, (value) => setConfig({ actorColumn: value ?? "" }))}
            {selectColumn("Object2", config.objectColumn, (value) => setConfig({ objectColumn: value ?? "" }))}
            {selectColumn("Object3", config.object2Column, (value) => setConfig({ object2Column: value }), true)}
            {selectColumn("Object1 attribute", config.actorAttribute, (value) => setConfig({ actorAttribute: value }), true)}
            {selectColumn("Object2 attribute", config.objectAttribute, (value) => setConfig({ objectAttribute: value }), true)}
          </fieldset>

          <fieldset>
            <legend>Analysis</legend>
            <label><span>Layout</span><select value={config.layoutType} onChange={(event) => setConfig({ layoutType: event.target.value as LayoutType })}>
              <option value="bipartite">Bipartite</option><option value="circular">Circular</option><option value="spring">Spring</option><option value="cluster">Cluster</option>
            </select></label>
            <label><span>Fixed communities</span><input type="number" min={1} value={config.fixedCommunityCount ?? ""} placeholder="Auto" onChange={(event) => setConfig({ fixedCommunityCount: event.target.value.length === 0 ? null : Number(event.target.value) })} /></label>
            <label><span>Seed</span><input type="number" value={config.seed} onChange={(event) => setConfig({ seed: Number(event.target.value) })} /></label>
            <label className="hina-check"><input type="checkbox" checked={config.pruningEnabled} onChange={(event) => setConfig({ pruningEnabled: event.target.checked })} /><span>Prune insignificant edges</span></label>
            {config.pruningEnabled ? <>
              <label><span>Alpha</span><input type="number" min={0} max={1} step={0.01} value={config.alpha} onChange={(event) => setConfig({ alpha: Number(event.target.value) })} /></label>
              <label><span>Fixed partition</span><select value={config.fixedPartition ?? ""} onChange={(event) => setConfig({ fixedPartition: event.target.value || null })}><option value="">None</option><option value={config.actorColumn}>{config.actorColumn || "Actor"}</option><option value={config.object2Column ? `(${config.objectColumn},${config.object2Column})` : config.objectColumn}>{config.objectColumn || "Object"}</option></select></label>
            </> : null}
            <label className="hina-check"><input type="checkbox" checked={config.projectionEnabled} onChange={(event) => setConfig({ projectionEnabled: event.target.checked })} /><span>Show one-mode projection</span></label>
            {config.projectionEnabled ? <>
              <label><span>Projection target</span><select value={config.projectionTarget} onChange={(event) => setConfig({ projectionTarget: event.target.value as "actor" | "object" })}><option value="actor">Actor</option><option value="object">Object</option></select></label>
              <label className="hina-check"><input type="checkbox" checked={config.hideZeroSimilarity} onChange={(event) => setConfig({ hideZeroSimilarity: event.target.checked })} /><span>Hide zero-similarity edges</span></label>
            </> : null}
          </fieldset>

          <fieldset>
            <legend>Display</legend>
            <label className="hina-check"><input type="checkbox" checked={config.showLabels} onChange={(event) => setConfig({ showLabels: event.target.checked })} /><span>Node labels</span></label>
            <label className="hina-check"><input type="checkbox" checked={config.showWeights} onChange={(event) => setConfig({ showWeights: event.target.checked })} /><span>Edge weights</span></label>
            <label className="hina-check"><input type="checkbox" checked={config.scaleNodesByQuantity} onChange={(event) => setConfig({ scaleNodesByQuantity: event.target.checked })} /><span>Scale actor nodes by quantity</span></label>
            <label><span>Node size</span><input type="range" min={0.5} max={2} step={0.1} value={config.nodeScale} onChange={(event) => setConfig({ nodeScale: Number(event.target.value) })} /></label>
            <label><span>Actor color</span><input type="color" value={config.actorColor} onChange={(event) => setConfig({ actorColor: event.target.value })} /></label>
            <label><span>Object color</span><input type="color" value={config.objectColor} onChange={(event) => setConfig({ objectColor: event.target.value })} /></label>
            <label><span>Composite color</span><input type="color" value={config.compositeColor} onChange={(event) => setConfig({ compositeColor: event.target.value })} /></label>
            <label><span>Edge color</span><input type="color" value={config.edgeColor} onChange={(event) => setConfig({ edgeColor: event.target.value })} /></label>
          </fieldset>

          <button className="hina-run" type="button" disabled={analysis.status === "running" || dataset === null} onClick={() => void run()}>
            {analysis.status === "running" ? "Running HINA…" : "Run HINA"}
          </button>
          <p className="hina-status" role="status" aria-live="polite">
            {dataset === null ? "Choose a dataset to begin." : `${dataset.name}: ${dataset.rows.length} rows · ${dataset.columns.length} columns`}
          </p>
          {analysis.error !== null ? <div className="hina-error" role="alert"><strong>Analysis failed.</strong><p>{analysis.error.message}</p></div> : null}
        </aside>

        <main className="hina-output">
          {analysis.result === null || filteredGraph === null ? (
            <div className="hina-placeholder"><p>The network and result tables will appear here after analysis.</p></div>
          ) : (
            <>
              <div className="hina-output__filters" aria-label="Result filters">
                <label><span>Group</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">All</option>{groupValues.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label><span>Community</span><select value={communityFilter} onChange={(event) => setCommunityFilter(event.target.value)}><option value="">All</option>{communityValues.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <button type="button" onClick={() => downloadText(serializeGraph(analysis.result!.graph, "json"), "application/json", "hina-network.json")}>Export JSON</button>
                <button type="button" onClick={() => void exportXlsx()}>Export XLSX</button>
              </div>
              <HinaNetwork
                graph={filteredGraph}
                layout={analysis.result.layout}
                showLabels={config.showLabels}
                showWeights={config.showWeights}
                nodeSizes={nodeSizes}
                nodeScale={config.nodeScale}
                style={{
                  "--hina-actor-color": config.actorColor,
                  "--hina-object-color": config.objectColor,
                  "--hina-composite-color": config.compositeColor,
                  "--hina-edge-color": config.edgeColor,
                } as CSSProperties}
              />
              {analysis.result.diagnostics.length > 0 ? (
                <details className="hina-diagnostics"><summary>{analysis.result.diagnostics.length} diagnostics</summary><ul>{analysis.result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><strong>{diagnostic.code}</strong>: {diagnostic.message}</li>)}</ul></details>
              ) : null}
              <HinaResultsPanel result={analysis.result} />
            </>
          )}
        </main>
      </div>
    </section>
  );
}
