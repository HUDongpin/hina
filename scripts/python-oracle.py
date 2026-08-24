#!/usr/bin/env python3
"""Generate or verify parity fixtures from the pinned upstream HINA source.

This runner deliberately imports the scientific modules straight from a local
checkout of the pinned commit.  It does not import ``hina.__init__`` (which also
loads the dashboard stack), so the oracle needs only NumPy, pandas, SciPy and
NetworkX.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import platform
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Iterable, Mapping


UPSTREAM_REPOSITORY = "https://github.com/SHF-NAILResearchGroup/HINA"
UPSTREAM_COMMIT = "f7bb3df3609aa6b0b6d5c98108e940f662053bb5"
UPSTREAM_VERSION = "0.7.2"
EXPECTED_PYTHON_VERSION = (3, 11)
SCHEMA_VERSION = 1

UPSTREAM_MODULES = {
    "construction": "hina/construction/network_construct.py",
    "quantity": "hina/individual/quantity.py",
    "diversity": "hina/individual/diversity.py",
    "dyad": "hina/dyad/significant_edges.py",
    "mesoscale": "hina/mesoscale/clustering.py",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_module(path: Path, module_name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load upstream module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def verified_upstream_root(path: Path) -> Path:
    root = path.resolve()
    actual_commit = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if actual_commit != UPSTREAM_COMMIT:
        raise RuntimeError(
            "Upstream checkout mismatch: "
            f"expected {UPSTREAM_COMMIT}, received {actual_commit}"
        )
    missing = [relative for relative in UPSTREAM_MODULES.values() if not (root / relative).is_file()]
    if missing:
        raise RuntimeError(f"Pinned checkout is missing oracle modules: {missing}")
    return root


def json_number(value: Any) -> int | float:
    number = float(value)
    if not math.isfinite(number):
        raise RuntimeError(f"Oracle produced a non-finite number: {value!r}")
    return int(number) if number.is_integer() else number


def canonical_weighted_edges(
    graph: Any,
    actor_partition: str | None = None,
    edges: Iterable[tuple[Any, Any, Any]] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    source_edges = graph.edges(data=True) if edges is None else edges
    for raw_source, raw_target, raw_weight in source_edges:
        source = str(raw_source)
        target = str(raw_target)
        if isinstance(raw_weight, Mapping):
            weight = raw_weight["weight"]
        else:
            weight = raw_weight

        if actor_partition is not None:
            source_is_actor = graph.nodes[raw_source].get("bipartite") == actor_partition
            target_is_actor = graph.nodes[raw_target].get("bipartite") == actor_partition
            if source_is_actor == target_is_actor:
                raise RuntimeError(
                    "Expected exactly one edge endpoint in partition "
                    f"{actor_partition!r}: {(source, target)!r}"
                )
            if target_is_actor:
                source, target = target, source
        elif target < source:
            source, target = target, source

        records.append(
            {"source": source, "target": target, "weight": json_number(weight)}
        )
    return sorted(records, key=lambda item: (item["source"], item["target"]))


def graph_summary(graph: Any, actor_partition: str) -> dict[str, Any]:
    actor_nodes = sorted(
        str(node)
        for node, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") == actor_partition
    )
    object_nodes = sorted(str(node) for node in graph.nodes if str(node) not in set(actor_nodes))
    return {
        "nodeCount": graph.number_of_nodes(),
        "edgeCount": graph.number_of_edges(),
        "totalWeight": json_number(
            sum(attributes["weight"] for _, _, attributes in graph.edges(data=True))
        ),
        "actorCount": len(actor_nodes),
        "objectCount": len(object_nodes),
        "actors": actor_nodes,
        "objects": object_nodes,
        "edges": canonical_weighted_edges(graph, actor_partition),
    }


def individual_summary(
    graph: Any,
    actor_partition: str,
    quantity_function: Callable[..., Any],
    diversity_function: Callable[..., Any],
    group: str,
) -> dict[str, Any]:
    quantity_result, _ = quantity_function(graph, group=group)
    diversity_result, _ = diversity_function(graph)
    actors = sorted(
        str(node)
        for node, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") == actor_partition
    )
    rows = []
    for actor in actors:
        rows.append(
            {
                "actor": actor,
                "quantity": json_number(quantity_result["quantity"][actor]),
                "normalizedQuantity": json_number(
                    quantity_result["normalized_quantity"][actor]
                ),
                "normalizedQuantityByGroup": json_number(
                    quantity_result["normalized_quantity_by_group"][actor]
                ),
                "diversity": json_number(diversity_result[actor]),
            }
        )
    return {
        "categoryCount": len(
            {
                str(node)
                for node, attributes in graph.nodes(data=True)
                if attributes.get("bipartite") != actor_partition
            }
        ),
        "rows": rows,
    }


def threshold_record(scope: str, trials: int, probability: float, threshold: Any) -> dict[str, Any]:
    return {
        "scope": scope,
        "trials": int(trials),
        "probability": json_number(probability),
        "threshold": json_number(threshold),
    }


def pruning_summary(
    graph: Any,
    actor_partition: str,
    prune_function: Callable[..., Any],
    scipy_stats: Any,
    *,
    alpha: float,
    fixed: bool,
) -> dict[str, Any]:
    fixed_partition = actor_partition if fixed else None
    result = prune_function(graph, fix_deg=fixed_partition, alpha=alpha)
    significant = canonical_weighted_edges(
        graph,
        actor_partition,
        result["significant edges"],
    )
    total_weight = int(sum(data["weight"] for _, _, data in graph.edges(data=True)))
    object_count = sum(
        1
        for _, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") != actor_partition
    )

    if fixed:
        thresholds = [
            threshold_record(
                str(node),
                int(graph.degree(node, weight="weight")),
                1.0 / object_count,
                scipy_stats.binom.ppf(
                    1 - alpha,
                    int(graph.degree(node, weight="weight")),
                    1.0 / object_count,
                ),
            )
            for node, attributes in sorted(graph.nodes(data=True), key=lambda item: str(item[0]))
            if attributes.get("bipartite") == actor_partition
        ]
    else:
        actor_count = sum(
            1
            for _, attributes in graph.nodes(data=True)
            if attributes.get("bipartite") == actor_partition
        )
        probability = 1.0 / (actor_count * object_count)
        thresholds = [
            threshold_record(
                "global",
                total_weight,
                probability,
                scipy_stats.binom.ppf(1 - alpha, total_weight, probability),
            )
        ]

    return {
        "alpha": alpha,
        "fixedPartition": actor_partition if fixed else None,
        "thresholds": thresholds,
        "significantEdges": significant,
    }


def canonical_partition(
    node_communities: Mapping[Any, Any],
) -> tuple[list[list[str]], dict[Any, int]]:
    grouped: dict[Any, list[str]] = defaultdict(list)
    for node, community in node_communities.items():
        grouped[community].append(str(node))
    ordered = sorted(
        ((community, sorted(members)) for community, members in grouped.items()),
        key=lambda item: json.dumps(item[1], ensure_ascii=False, separators=(",", ":")),
    )
    return [members for _, members in ordered], {
        old_community: index
        for index, (old_community, _) in enumerate(ordered)
    }


def log_choose(scipy_special: Any, n: int, k: int) -> float:
    return float(
        scipy_special.loggamma(n + 1)
        - scipy_special.loggamma(k + 1)
        - scipy_special.loggamma(n - k + 1)
    )


def log_multiset(scipy_special: Any, n: int, k: int) -> float:
    return log_choose(scipy_special, n + k - 1, k)


def baseline_description_length(graph: Any, actor_partition: str, scipy_special: Any) -> float:
    actors = [
        node
        for node, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") == actor_partition
    ]
    objects = [
        node
        for node, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") != actor_partition
    ]
    actor_count = len(actors)
    object_count = len(objects)
    total_weight = int(sum(data["weight"] for _, _, data in graph.edges(data=True)))
    object_weights = [int(graph.degree(node, weight="weight")) for node in objects]
    constant = (
        math.log(actor_count)
        + log_choose(scipy_special, actor_count - 1, 0)
        + float(scipy_special.loggamma(actor_count))
        + log_multiset(scipy_special, object_count, total_weight)
    )
    cluster_term = -float(scipy_special.loggamma(actor_count)) + sum(
        log_multiset(scipy_special, actor_count, weight)
        for weight in object_weights
    )
    return constant + cluster_term


def community_summary(
    graph: Any,
    actor_partition: str,
    community_function: Callable[..., Any],
    scipy_special: Any,
    *,
    fixed_community_count: int,
    include_object_projections: bool,
) -> dict[str, Any]:
    result = community_function(graph.copy(), fix_B=fixed_community_count)
    partition, label_map = canonical_partition(result["node communities"])
    baseline = baseline_description_length(graph, actor_partition, scipy_special)
    compression = float(result["community quality (compression ratio)"])
    summary: dict[str, Any] = {
        "fixedCommunityCount": fixed_community_count,
        "communityCount": int(result["number of communities"]),
        "partition": partition,
        "compressionRatio": json_number(compression),
        "descriptionLength": json_number(compression * baseline),
        "baselineDescriptionLength": json_number(baseline),
    }

    if include_object_projections:
        projections = []
        for old_community, projection in result[
            "object-object graphs for each community"
        ].items():
            projection_edges = canonical_weighted_edges(projection)
            projections.append(
                {
                    "community": label_map[old_community],
                    "nodeCount": projection.number_of_nodes(),
                    "edgeCount": projection.number_of_edges(),
                    "totalWeight": json_number(
                        sum(
                            attributes["weight"]
                            for _, _, attributes in projection.edges(data=True)
                        )
                    ),
                    "edges": projection_edges,
                }
            )
        summary["objectProjections"] = sorted(
            projections, key=lambda item: item["community"]
        )
    return summary


def cosine_projection(graph: Any, target_partition: str) -> dict[str, Any]:
    targets = sorted(
        node
        for node, attributes in graph.nodes(data=True)
        if attributes.get("bipartite") == target_partition
    )
    similarities = []
    for left_index, left in enumerate(targets):
        left_vector = {
            neighbor: float(graph.edges[left, neighbor]["weight"])
            for neighbor in graph.neighbors(left)
        }
        for right in targets[left_index + 1 :]:
            right_vector = {
                neighbor: float(graph.edges[right, neighbor]["weight"])
                for neighbor in graph.neighbors(right)
            }
            left_norm = math.sqrt(math.fsum(weight * weight for weight in left_vector.values()))
            right_norm = math.sqrt(math.fsum(weight * weight for weight in right_vector.values()))
            dot_product = math.fsum(
                weight * right_vector.get(neighbor, 0.0)
                for neighbor, weight in left_vector.items()
            )
            similarity = 0.0 if left_norm == 0 or right_norm == 0 else dot_product / (left_norm * right_norm)
            similarities.append(
                {
                    "source": str(left),
                    "target": str(right),
                    "similarity": json_number(similarity),
                }
            )
    return {
        "targetPartition": target_partition,
        "metric": "cosine-l2",
        "similarities": similarities,
    }


def dataset_summary(dataframe: Any, source_path: Path) -> dict[str, Any]:
    return {
        "source": "examples/data/yu-hina-long.csv",
        "sha256": sha256_file(source_path),
        "rowCount": len(dataframe),
        "columns": list(dataframe.columns),
        "uniqueStudents": int(dataframe["StudentId"].nunique()),
        "uniqueCodes": int(dataframe["Code"].nunique()),
        "uniqueLessons": int(dataframe["Lesson"].nunique()),
    }


def generate_fixture(input_path: Path, upstream_root: Path) -> dict[str, Any]:
    import networkx  # pylint: disable=import-outside-toplevel
    import numpy
    import pandas
    import scipy
    from scipy import special as scipy_special
    from scipy import stats as scipy_stats

    modules = {
        name: load_module(upstream_root / relative, f"hina_oracle_{name}")
        for name, relative in UPSTREAM_MODULES.items()
    }
    dataframe = pandas.read_csv(input_path)
    bipartite = modules["construction"].get_bipartite(
        dataframe.copy(),
        student_col="StudentId",
        object_col="Code",
        group_col="Group",
    )
    tripartite = modules["construction"].get_tripartite(
        dataframe.copy(),
        student_col="StudentId",
        object1_col="Code",
        object2_col="Lesson",
        group_col="Group",
    )

    alpha = 0.05
    return {
        "schemaVersion": SCHEMA_VERSION,
        "provenance": {
            "upstreamRepository": UPSTREAM_REPOSITORY,
            "upstreamCommit": UPSTREAM_COMMIT,
            "upstreamVersion": UPSTREAM_VERSION,
            "pythonVersion": platform.python_version(),
            "pythonHashSeed": os.environ["PYTHONHASHSEED"],
            "dependencies": {
                "networkx": networkx.__version__,
                "numpy": numpy.__version__,
                "pandas": pandas.__version__,
                "scipy": scipy.__version__,
            },
            "upstreamFileSha256": {
                relative: sha256_file(upstream_root / relative)
                for relative in sorted(UPSTREAM_MODULES.values())
            },
            "generator": "scripts/python-oracle.py",
        },
        "dataset": dataset_summary(dataframe, input_path),
        "bipartite": {
            "graph": graph_summary(bipartite, "StudentId"),
            "individual": individual_summary(
                bipartite,
                "StudentId",
                modules["quantity"].quantity,
                modules["diversity"].diversity,
                "Group",
            ),
            "pruning": {
                "global": pruning_summary(
                    bipartite,
                    "StudentId",
                    modules["dyad"].prune_edges,
                    scipy_stats,
                    alpha=alpha,
                    fixed=False,
                ),
                "fixedActor": pruning_summary(
                    bipartite,
                    "StudentId",
                    modules["dyad"].prune_edges,
                    scipy_stats,
                    alpha=alpha,
                    fixed=True,
                ),
            },
            "communities": community_summary(
                bipartite,
                "StudentId",
                modules["mesoscale"].hina_communities,
                scipy_special,
                fixed_community_count=2,
                include_object_projections=False,
            ),
            "projection": cosine_projection(bipartite, "Code"),
        },
        "tripartite": {
            "graph": graph_summary(tripartite, "StudentId"),
            "individual": individual_summary(
                tripartite,
                "StudentId",
                modules["quantity"].quantity,
                modules["diversity"].diversity,
                "Group",
            ),
            "communities": community_summary(
                tripartite,
                "StudentId",
                modules["mesoscale"].hina_communities,
                scipy_special,
                fixed_community_count=2,
                include_object_projections=True,
            ),
        },
    }


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate or verify the pinned upstream HINA parity fixture."
    )
    parser.add_argument("--input", required=True, type=Path, help="Long-form CSV input")
    parser.add_argument(
        "--upstream-root",
        required=True,
        type=Path,
        help="Local checkout at the pinned upstream commit",
    )
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument("--output", type=Path, help="Write a canonical fixture")
    destination.add_argument("--check", type=Path, help="Verify an existing fixture")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if sys.version_info[:2] != EXPECTED_PYTHON_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_PYTHON_VERSION)
        actual = ".".join(str(part) for part in sys.version_info[:2])
        raise RuntimeError(
            f"The parity oracle requires Python {expected}; received Python {actual}."
        )
    hash_seed = os.environ.get("PYTHONHASHSEED")
    if hash_seed is None or hash_seed.lower() == "random":
        raise RuntimeError(
            "Set PYTHONHASHSEED to an explicit integer before starting the oracle."
        )

    upstream_root = verified_upstream_root(arguments.upstream_root)
    fixture = generate_fixture(arguments.input.resolve(), upstream_root)
    rendered = json.dumps(
        fixture,
        allow_nan=False,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"

    if arguments.check is not None:
        expected = arguments.check.read_text(encoding="utf-8")
        if expected != rendered:
            print(
                f"Parity fixture differs: {arguments.check}",
                file=sys.stderr,
            )
            return 1
        print(f"Parity fixture verified: {arguments.check}")
        return 0

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(rendered, encoding="utf-8")
    print(f"Parity fixture written: {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
