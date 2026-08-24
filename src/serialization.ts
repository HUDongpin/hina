import { HinaValidationError } from "./errors";
import { assertValidGraph } from "./internal/graph";
import type { HinaEdge, HinaGraph, HinaNode, JsonValue } from "./types";

export type GraphSerializationFormat = "json" | "gml" | "gexf" | "graphml";

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedNodes(graph: HinaGraph): readonly HinaNode[] {
  return [...graph.nodes].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function sortedEdges(graph: HinaGraph): readonly HinaEdge[] {
  return [...graph.edges].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function canonicalEndpoints(edge: HinaEdge): readonly [string, string] {
  return compareText(edge.source, edge.target) <= 0
    ? [edge.source, edge.target]
    : [edge.target, edge.source];
}

function canonicalizeJson(
  value: JsonValue,
  ancestors = new Set<object>(),
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HinaValidationError(
        "INVALID_ARGUMENT",
        "Graph serialization requires finite JSON numbers.",
        { value: String(value) },
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Graph serialization encountered a non-JSON value.",
      { valueType: typeof value },
    );
  }
  if (ancestors.has(value)) {
    throw new HinaValidationError(
      "INVALID_ARGUMENT",
      "Graph serialization does not support cyclic JSON values.",
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const arrayValue = value as readonly JsonValue[];
      return arrayValue.map((item) => canonicalizeJson(item, ancestors));
    }

    const objectValue = value as Readonly<Record<string, JsonValue>>;
    return Object.fromEntries(
      Object.keys(objectValue)
        .sort(compareText)
        .map((key) => [key, canonicalizeJson(objectValue[key]!, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalGraphValue(graph: HinaGraph): JsonValue {
  const partitions = [...graph.partitions]
    .sort((left, right) => compareText(left.id, right.id))
    .map((partition) => ({
      id: partition.id,
      label: partition.label,
      role: partition.role,
      sourceColumns: [...partition.sourceColumns],
    }));
  const nodes = sortedNodes(graph).map((node) => ({
    id: node.id,
    label: node.label,
    value: node.value,
    ...(node.rawValue === undefined ? {} : { rawValue: node.rawValue }),
    ...(node.components === undefined
      ? {}
      : { components: node.components }),
    partition: node.partition,
    attributes: node.attributes,
  }));
  const edges = sortedEdges(graph).map((edge) => {
    const [source, target] = canonicalEndpoints(edge);
    return {
      id: edge.id,
      source,
      target,
      weight: edge.weight,
      attributes: edge.attributes,
    };
  });

  return canonicalizeJson({
    kind: graph.kind,
    directed: graph.directed,
    multigraph: graph.multigraph,
    partitions,
    nodes,
    edges,
  });
}

function compactJson(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function gmlEscape(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return Array.from(escaped, (character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : character;
  }).join("");
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new HinaValidationError(
      "INVALID_WEIGHT",
      "Graph serialization requires finite edge weights.",
      { weight: String(value) },
    );
  }
  return Object.is(value, -0) ? "0" : String(value);
}

function serializeJson(graph: HinaGraph): string {
  return `${JSON.stringify(canonicalGraphValue(graph), null, 2)}\n`;
}

function serializeGml(graph: HinaGraph): string {
  const nodes = sortedNodes(graph);
  const edges = sortedEdges(graph);
  const numericIdByNode = new Map(
    nodes.map((node, index) => [node.id, index] as const),
  );
  const lines = [
    'Creator "hina-js"',
    "Version 1",
    "graph [",
    "  directed 0",
    `  kind "${gmlEscape(graph.kind)}"`,
    "  multigraph 0",
  ];

  nodes.forEach((node, index) => {
    lines.push(
      "  node [",
      `    id ${index}`,
      `    hina_id "${gmlEscape(node.id)}"`,
      `    label "${gmlEscape(node.label)}"`,
      `    value_json "${gmlEscape(compactJson(node.value))}"`,
    );
    if (node.rawValue !== undefined) {
      lines.push(
        `    raw_value_json "${gmlEscape(compactJson(node.rawValue))}"`,
      );
    }
    if (node.components !== undefined) {
      lines.push(
        `    components_json "${gmlEscape(compactJson(node.components))}"`,
      );
    }
    lines.push(
      `    partition "${gmlEscape(node.partition)}"`,
      `    attributes_json "${gmlEscape(compactJson(node.attributes))}"`,
      "  ]",
    );
  });

  for (const edge of edges) {
    const [source, target] = canonicalEndpoints(edge);
    lines.push(
      "  edge [",
      `    hina_id "${gmlEscape(edge.id)}"`,
      `    source ${numericIdByNode.get(source)!}`,
      `    target ${numericIdByNode.get(target)!}`,
      `    weight ${numberText(edge.weight)}`,
      `    attributes_json "${gmlEscape(compactJson(edge.attributes))}"`,
      "  ]",
    );
  }
  lines.push("]");
  return `${lines.join("\n")}\n`;
}

function serializeGexf(graph: HinaGraph): string {
  const nodes = sortedNodes(graph);
  const edges = sortedEdges(graph);
  const externalIdByNode = new Map(
    nodes.map((node, index) => [node.id, `n${index}`] as const),
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" version="1.3">',
    "  <meta>",
    "    <creator>hina-js</creator>",
    `    <description>${xmlEscape(`${graph.kind} HINA graph`)}</description>`,
    "  </meta>",
    '  <graph mode="static" defaultedgetype="undirected">',
    '    <attributes class="node">',
    '      <attribute id="n0" title="hina_id" type="string"/>',
    '      <attribute id="n1" title="partition" type="string"/>',
    '      <attribute id="n2" title="value_json" type="string"/>',
    '      <attribute id="n3" title="attributes_json" type="string"/>',
    '      <attribute id="n4" title="raw_value_json" type="string"/>',
    '      <attribute id="n5" title="components_json" type="string"/>',
    "    </attributes>",
    '    <attributes class="edge">',
    '      <attribute id="e0" title="hina_id" type="string"/>',
    '      <attribute id="e1" title="attributes_json" type="string"/>',
    "    </attributes>",
    "    <nodes>",
  ];

  nodes.forEach((node, index) => {
    lines.push(
      `      <node id="n${index}" label="${xmlEscape(node.label)}">`,
      "        <attvalues>",
      `          <attvalue for="n0" value="${xmlEscape(node.id)}"/>`,
      `          <attvalue for="n1" value="${xmlEscape(node.partition)}"/>`,
      `          <attvalue for="n2" value="${xmlEscape(compactJson(node.value))}"/>`,
      `          <attvalue for="n3" value="${xmlEscape(compactJson(node.attributes))}"/>`,
    );
    if (node.rawValue !== undefined) {
      lines.push(
        `          <attvalue for="n4" value="${xmlEscape(compactJson(node.rawValue))}"/>`,
      );
    }
    if (node.components !== undefined) {
      lines.push(
        `          <attvalue for="n5" value="${xmlEscape(compactJson(node.components))}"/>`,
      );
    }
    lines.push("        </attvalues>", "      </node>");
  });
  lines.push("    </nodes>", "    <edges>");

  edges.forEach((edge, index) => {
    const [source, target] = canonicalEndpoints(edge);
    lines.push(
      `      <edge id="e${index}" source="${externalIdByNode.get(source)!}" target="${externalIdByNode.get(target)!}" weight="${numberText(edge.weight)}">`,
      "        <attvalues>",
      `          <attvalue for="e0" value="${xmlEscape(edge.id)}"/>`,
      `          <attvalue for="e1" value="${xmlEscape(compactJson(edge.attributes))}"/>`,
      "        </attvalues>",
      "      </edge>",
    );
  });
  lines.push("    </edges>", "  </graph>", "</gexf>");
  return `${lines.join("\n")}\n`;
}

function serializeGraphml(graph: HinaGraph): string {
  const nodes = sortedNodes(graph);
  const edges = sortedEdges(graph);
  const externalIdByNode = new Map(
    nodes.map((node, index) => [node.id, `n${index}`] as const),
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
    '  <key id="g_kind" for="graph" attr.name="kind" attr.type="string"/>',
    '  <key id="n_id" for="node" attr.name="hina_id" attr.type="string"/>',
    '  <key id="n_label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="n_partition" for="node" attr.name="partition" attr.type="string"/>',
    '  <key id="n_value" for="node" attr.name="value_json" attr.type="string"/>',
    '  <key id="n_attributes" for="node" attr.name="attributes_json" attr.type="string"/>',
    '  <key id="n_raw_value" for="node" attr.name="raw_value_json" attr.type="string"/>',
    '  <key id="n_components" for="node" attr.name="components_json" attr.type="string"/>',
    '  <key id="e_id" for="edge" attr.name="hina_id" attr.type="string"/>',
    '  <key id="e_weight" for="edge" attr.name="weight" attr.type="double"/>',
    '  <key id="e_attributes" for="edge" attr.name="attributes_json" attr.type="string"/>',
    '  <graph id="G" edgedefault="undirected">',
    `    <data key="g_kind">${xmlEscape(graph.kind)}</data>`,
  ];

  nodes.forEach((node, index) => {
    lines.push(
      `    <node id="n${index}">`,
      `      <data key="n_id">${xmlEscape(node.id)}</data>`,
      `      <data key="n_label">${xmlEscape(node.label)}</data>`,
      `      <data key="n_partition">${xmlEscape(node.partition)}</data>`,
      `      <data key="n_value">${xmlEscape(compactJson(node.value))}</data>`,
      `      <data key="n_attributes">${xmlEscape(compactJson(node.attributes))}</data>`,
    );
    if (node.rawValue !== undefined) {
      lines.push(
        `      <data key="n_raw_value">${xmlEscape(compactJson(node.rawValue))}</data>`,
      );
    }
    if (node.components !== undefined) {
      lines.push(
        `      <data key="n_components">${xmlEscape(compactJson(node.components))}</data>`,
      );
    }
    lines.push("    </node>");
  });

  edges.forEach((edge, index) => {
    const [source, target] = canonicalEndpoints(edge);
    lines.push(
      `    <edge id="e${index}" source="${externalIdByNode.get(source)!}" target="${externalIdByNode.get(target)!}">`,
      `      <data key="e_id">${xmlEscape(edge.id)}</data>`,
      `      <data key="e_weight">${numberText(edge.weight)}</data>`,
      `      <data key="e_attributes">${xmlEscape(compactJson(edge.attributes))}</data>`,
      "    </edge>",
    );
  });

  lines.push("  </graph>", "</graphml>");
  return `${lines.join("\n")}\n`;
}

/** Serialize a graph without mutating or depending on its input array order. */
export function serializeGraph(
  graph: HinaGraph,
  format: GraphSerializationFormat,
): string {
  assertValidGraph(graph);
  switch (format) {
    case "json":
      return serializeJson(graph);
    case "gml":
      return serializeGml(graph);
    case "gexf":
      return serializeGexf(graph);
    case "graphml":
      return serializeGraphml(graph);
    default: {
      const unsupported: never = format;
      throw new HinaValidationError(
        "UNSUPPORTED_FORMAT",
        `Unsupported graph serialization format: ${String(unsupported)}`,
        { format: String(unsupported) },
      );
    }
  }
}
