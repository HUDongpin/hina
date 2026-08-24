# Architecture and runtime boundaries

```text
tabular rows
    |
    v
construction -> JSON-safe HinaGraph -> individual / dyad / mesoscale
                                  |             |
                                  v             v
                           projection/layout   result tables
                                  |             |
                                  +------> React workbench
                                  |
                                  +------> JSON/GML/GEXF/GraphML
```

The root module and scientific subpaths are pure TypeScript and do not import
React, DOM globals, Node built-ins, or the XLSX implementation. `hina-js/io`
loads XLSX dynamically. `hina-js/react` owns the `"use client"` boundary and
creates Cytoscape only in an effect. `hina-js/node` is the only file-writing
entry point.

All public scientific structures are acyclic plain objects and arrays. Internal
`Map` and `Set` instances are temporary implementation details and never cross a
public result boundary.
