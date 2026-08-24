# HINA website comparison record

This record is deliberately separate from scientific parity. The fixed Python
source, the paper formulas, and the checked JSON fixtures are the correctness
baseline. The website is only a manual workflow and presentation reference and
is never called by the package or CI.

## 2026-08-24 (Asia/Shanghai)

Status: `BLOCKED_SITE_RUNTIME`

The existing signed-in Chrome session at <https://www.hina-network.com/> was
successfully inspected before starting the comparison. It showed the uploaded
original practice workbook and an existing degenerate `Name` / `ICT` mapping;
that mapping was not accepted as a scientific example.

The intended full-data comparisons used
`examples/data/yu-hina-long.xlsx` (391 interactions) with these exact settings:

| Run | Object1 | Object2 | Object3 | Object1 attribute | Object2 attribute | Communities |
| --- | --- | --- | --- | --- | --- | --- |
| Bipartite | `StudentId` | `Code` | `None` | `Group` | `None` | fixed `B=2` |
| Tripartite | `StudentId` | `Code` | `Lesson` | `Group` | `None` | fixed `B=2` |

The full workbook upload/configuration action was started, but the website tab
did not return within the 180-second browser operation. After waiting, even a
DOM snapshot, viewport screenshot, reload, close, and a new tab in the same
signed-in Chrome browser failed to respond within 15–60 seconds. No website
export or screenshot was produced, so none is claimed or committed as evidence.
The data was not reduced or altered to manufacture a successful comparison.

This external-site block does not change the local scientific result:

- Python 3.11 recomputation at the pinned upstream commit produces the checked
  golden fixture;
- the 391-row dataset passes bipartite, tripartite, individual, pruning,
  community, and projection parity tests; and
- the published package candidate passes real Chromium tests through an
  isolated Next.js production installation.

## Retry procedure

After the Chrome HINA tab is responsive again, repeat both rows from the table
above without changing the dataset, record the start/end time, capture the
visible configuration and result shape, and save the website exports and
screenshots only under an ignored local evidence directory. Website artifacts
must not enter the npm tarball or automated CI. Any differences must be labelled
as scientific, deterministic-stability, or display-only differences.
