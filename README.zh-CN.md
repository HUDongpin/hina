# hina-js

面向 TypeScript、JavaScript、React 与 Next.js 的确定性、JSON-safe
异质交互网络分析（HINA）实现。

`hina-js` 是对 [HINA Python 项目](https://github.com/SHF-NAILResearchGroup/HINA)
的独立 TypeScript 移植，科学基线固定为上游提交
[`f7bb3df3609aa6b0b6d5c98108e940f662053bb5`](https://github.com/SHF-NAILResearchGroup/HINA/tree/f7bb3df3609aa6b0b6d5c98108e940f662053bb5)。
它不是原研究团队发布或背书的官方 JavaScript 版本。

本包不依赖 Python 运行时、服务器、账号、遥测、原生扩展或数据上传。
核心图和分析结果都只包含普通对象与数组，可安全 JSON 往返、
`structuredClone`，并跨越 Next.js Server/Client 边界。

> 当前版本：[`hina-js@0.1.1`](https://www.npmjs.com/package/hina-js/v/0.1.1)，
> 对应的
> [GitHub Release](https://github.com/HUDongpin/hina/releases/tag/v0.1.1)
> 与 npm 版本指向同一发布；首发 `0.1.0` 继续保留在发布历史中。
> 各版本变化见 [CHANGELOG.md](./CHANGELOG.md)。

## 能力范围

- 加权二部图与结构化三部图构建。
- Quantity、Normalized Quantity、按类别 Quantity、组内归一化与
  Normalized Shannon Diversity。
- 与 SciPy 离散分位数边界对齐的 binomial 显著边剪枝。
- 支持自动或固定社区数、且 tie-break 确定的 MDL 社区发现。
- L2 cosine projection、确定性布局与 Cytoscape 元素转换。
- CSV、多 sheet XLSX 导入以及完整 XLSX 分析结果导出。
- GML、GEXF、GraphML、JSON 序列化与 Node 专用文件写入。
- 可直接嵌入 Next.js App Router 的 Client Component 工作台。

## 安装

Node.js 消费端要求 `20.9` 或更高版本。只有使用 `hina-js/react` 时才需要
React 与 React DOM `>=18.2 <20`。

```bash
npm install hina-js
```

包同时提供 ESM、CommonJS、source map 与 TypeScript 声明。根入口不会加载
React、DOM、`node:fs` 或 XLSX 实现。

## 五分钟核心示例

```ts
import {
  analyzeIndividuals,
  createBipartiteGraph,
  detectCommunities,
  layoutGraph,
  projectGraph,
  pruneEdges,
} from "hina-js";

const rows = [
  { StudentId: "A::01", Group: "A", Code: "EC" },
  { StudentId: "A::01", Group: "A", Code: "EC" },
  { StudentId: "A::01", Group: "A", Code: "ICT" },
  { StudentId: "B::01", Group: "B", Code: "ICT" },
];

const { graph, diagnostics } = createBipartiteGraph(rows, {
  studentColumn: "StudentId",
  objectColumn: "Code",
  groupColumn: "Group",
});

// 重复的 A::01–EC 行被聚合为一条 weight=2 的边。
const individuals = analyzeIndividuals(graph, { group: "Group" });
const pruning = pruneEdges(graph, { alpha: 0.05 });
const communities = detectCommunities(graph, {
  fixedCommunityCount: 2,
  targetPartition: "StudentId",
});
const projection = projectGraph(graph, { targetPartition: "StudentId" });
const layout = layoutGraph(graph, { type: "spring", seed: 42 });

console.log({ diagnostics, individuals, pruning, communities, projection, layout });
```

所有分析函数都按不可变契约处理输入。

## 数据与算法语义

二部图把重复 `(actor, object)` 行聚合为整数权重；空 actor 行被丢弃并返回
带行号的诊断；缺失 object、attribute、group 值显示为 `"NA"`。

三部图表示 actor 对结构化 `(object1, object2)` 复合对象的交互。类似
`"EC**Lesson 1"` 的文字仅用于显示，内部 ID 保存有类型的组件，因此原值
即使包含 `"**"` 也不会冲突。

节点 ID 同时编码分区、标量类型与规范值，所以 actor `"1"`、object
`"1"`、数值 `1`、字符串 `"01"` 与布尔值 `true` 不会被误合并。节点属性
冲突默认抛出 `ATTRIBUTE_CONFLICT`；只有显式指定
`conflictStrategy: "first"` 或 `"last"` 时才采用兼容策略。

对 actor \(i\)，Quantity 是加权度数：

\[
q_i = \sum_j w_{ij}.
\]

全局归一化为 \(q_i / \sum_{uv}w_{uv}\)，组内归一化以同组 actor 的
Quantity 总和为分母。分母为零时返回 `0`，不会返回 `NaN`。

Diversity 使用全局类别数 \(N\) 的归一化 Shannon entropy：

\[
D_i = -\frac{\sum_c p_{ic}\log p_{ic}}{\log N}.
\]

当 \(N \le 1\) 或 actor 总权重为零时，结果明确定义为 `0`。

显著边剪枝保持固定 Python 基线的 binomial PPF 规则，`alpha` 仅允许
`[0,1]`。MDL 社区发现使用纯 TypeScript 的 `logGamma`、`logChoose` 与
`logMultiset`；相同 merge 代价以规范节点 ID 决胜，社区编号固定为连续的
`0..B-1`。投影使用 L2 cosine similarity，并默认保留零相似度边。

完整兼容策略、精度标准与有意修复见 [UPSTREAM.md](./UPSTREAM.md) 和
[docs/PARITY.md](./docs/PARITY.md)。

## CSV / XLSX

```ts
import { exportResultsXlsx, parseCsv, parseXlsx } from "hina-js/io";

const csv = parseCsv("Actor,Code\n01,EC\n1,ICT\n");
// `01` 与 `1` 仍是不同字符串。

const workbook = await parseXlsx(await file.arrayBuffer());
const selectedSheet = workbook.sheets[0];

const bytes = await exportResultsXlsx({
  graph,
  individuals,
  pruning,
  communities,
});
```

CSV 始终关闭自动类型推断。XLSX 只从 `/io` 或 React 工作台动态加载；不会
执行公式，只读取缓存值。导出结果按 Metadata、个体指标、显著边、社区与
Diagnostics 等工作表组织。

## React 与 Next.js

`hina-js/react` 是 Client Component 入口，导出 `HinaWorkbench`、
`HinaNetwork`、`HinaResultsPanel` 与 `useHinaAnalysis`。

```tsx
"use client";

import { HinaWorkbench } from "hina-js/react";
import "hina-js/react/styles.css";

export default function AnalysisClient() {
  return (
    <HinaWorkbench
      defaultConfig={{
        actorColumn: "StudentId",
        objectColumn: "Code",
        actorAttribute: "Group",
        fixedCommunityCount: 2,
      }}
    />
  );
}
```

工作台在浏览器本地解析文件，不上传到 HINA 官网或任何服务器。它支持
CSV/XLSX、多 sheet、二部/三部映射、剪枝、固定/自动社区、投影、四种
布局、筛选、可访问状态与语义化结果表，以及 JSON、PNG、XLSX 下载。
中性默认样式通过 `--hina-*` CSS variables 覆盖。

Server Component 与 Edge route 只导入核心入口：

```ts
import { analyzeQuantity, createBipartiteGraph } from "hina-js";

export const runtime = "edge";

export function GET() {
  const graph = createBipartiteGraph(
    [{ actor: "a", object: "x" }],
    { studentColumn: "actor", objectColumn: "object" },
  ).graph;
  return Response.json(analyzeQuantity(graph));
}
```

仓库中的 `examples/next-app` 会安装 `npm pack --json` 返回的真实
`hina-js-<version>.tgz`，而不是依赖 monorepo symlink，从而一起验证
exports、CSS、声明文件、Server、Client、Edge 与 Next 生产构建。

## 范例数据

`examples/data` 同时保留用户确认可公开的练习原始工作簿（字节不变）与
确定性长表。转换会清理 `Lesson` 两端空白，构造
`StudentId = Group + "::" + Name`，展开七个 `0/1` 编码列，并只保留值为
`1` 的 interaction。结果精确为 391 行；12 条全零 actor/lesson 记录仍保留
在原始 XLSX 中。

```bash
npm run data:check  # 核验源文件哈希与已提交派生文件
npm run data:build  # 确定性重建 CSV 与 XLSX
```

来源、哈希、字段、丢弃规则与推荐映射见
[examples/data/TRANSFORM.md](./examples/data/TRANSFORM.md)。

## Python API 对照

| Python HINA | `hina-js` |
| --- | --- |
| `get_bipartite` | `createBipartiteGraph` |
| `get_tripartite` | `createTripartiteGraph` |
| `quantity` | `analyzeQuantity` |
| `diversity` | `analyzeDiversity` |
| `prune_edges` | `pruneEdges` |
| `hina_communities` | `detectCommunities` |
| `plot_hina` | `layoutGraph` + `HinaNetwork` |
| `plot_hina_projection` | `projectGraph` + `HinaNetwork` |
| `plot_bipartite_clusters` | `detectCommunities` + `HinaNetwork` |
| `save_network` | `serializeGraph` 或 `saveGraphFile` |

不额外导出 Python snake_case 别名。

## 多入口边界

| 入口 | 内容 | 运行时 |
| --- | --- | --- |
| `hina-js` | 类型、构图、分析、投影、布局、序列化 | Browser、Node、Edge |
| `hina-js/construction` | 二部图/三部图构建 | Browser、Node、Edge |
| `hina-js/individual` | Quantity 与 Diversity | Browser、Node、Edge |
| `hina-js/dyad` | 显著边剪枝 | Browser、Node、Edge |
| `hina-js/mesoscale` | MDL 社区发现 | Browser、Node、Edge |
| `hina-js/visualization` | 布局、投影与 Cytoscape 元素 | Browser、Node、Edge |
| `hina-js/io` | CSV/XLSX 输入与 XLSX 结果 | Browser、Node |
| `hina-js/react` | React 工作台 | React Client Component |
| `hina-js/react/styles.css` | 可选默认样式 | Browser |
| `hina-js/node` | 网络与 XLSX 结果文件写入 | 仅 Node |

可恢复问题以 `HinaDiagnostic[]` 返回，不调用 `console.warn`。不可恢复问题
抛出可 JSON 序列化的 `HinaValidationError`；稳定 code 包括
`MISSING_COLUMN`、`INVALID_ALPHA`、`INVALID_PARTITION`、
`INVALID_COMMUNITY_COUNT`、`ATTRIBUTE_CONFLICT`、`INVALID_WEIGHT` 与
`UNSUPPORTED_FILE`。

## 性能定位与非目标

构图和个体指标随 interaction 数量线性增长；投影随目标分区节点数平方增长；
确定性 greedy MDL 社区发现会成为较大 actor 集合的主要耗时与内存来源。
`0.1.x` 面向研究规模数据，并记录练习数据和 10,000 interaction 合成数据的
非阻断性能报告；不承诺无限规模、实时流式分析。

本项目不包含独立网站、登录、数据库、上传服务、API 服务器、CLI、
Python/WASM 运行时或云端部署。

## 开发与验收

```bash
npm ci
npm run data:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:next
npm run test:e2e
npm run check:licenses
npm run check:secrets
```

CI 覆盖 Node `20.9`、`22`、`24`。日常 CI 使用已提交的 Python 黄金 fixture，
不安装 Python，也不联网拉取上游。Oracle 重建和发布门槛见
[CONTRIBUTING.md](./CONTRIBUTING.md)。固定上游的 47 个 pytest 场景已在
[上游测试矩阵](https://github.com/HUDongpin/hina/blob/main/docs/UPSTREAM_TEST_MATRIX.md)
中逐项映射。
各版本变化记录在 [CHANGELOG.md](./CHANGELOG.md)。

## 引用与许可证

研究使用时请同时引用本 port 与原始论文：

> Feng, S., He, B., & Kirkley, A. (2025). HINA: A Learning Analytics Tool for
> Heterogenous Interaction Network Analysis in Python. *Journal of Open Source
> Software*. <https://doi.org/10.21105/joss.08299>

新增 TypeScript 代码使用 MIT License，版权为
`Copyright (c) 2026 HUDongpin contributors`。上游许可证原样保存在
[LICENSE.upstream](./LICENSE.upstream)，另见 [NOTICE.md](./NOTICE.md) 与
[CITATION.cff](./CITATION.cff)。
