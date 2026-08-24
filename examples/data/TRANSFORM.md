# Yu HINA practice dataset transformation

This directory intentionally contains both the original practice workbook and
a deterministic long-form derivative suitable for HINA analysis. The user has
confirmed that the practice data contains no private information and may be
published.

## Files and provenance

| File | Purpose |
| --- | --- |
| `Yu_ena_coded_data_0712.xlsx` | Original workbook, preserved byte-for-byte |
| `yu-hina-long.csv` | UTF-8, RFC 4180-compatible long-form interactions |
| `yu-hina-long.xlsx` | The same long-form interactions in one `HINA Long` sheet |

SHA-256 of the original workbook:

```text
f2132f8dc3e147609169472594a2031130be23eab4a2ac0fb9adcb6d9d667042
```

## Deterministic transformation

Source range: `Sheet1!A1:J175`, containing 174 observations with columns
`Group`, `Lesson`, `Name`, `EC`, `ICT`, `MCO`, `NI`, `SR`, `SC`, and `ATT`.

1. Trim surrounding whitespace from `Lesson`.
2. Create the display identifier `StudentId = Group + "::" + Name` so students
   with the same name in different groups are not merged.
3. Unpivot `EC`, `ICT`, `MCO`, `NI`, `SR`, `SC`, and `ATT`.
4. Keep only cells whose numeric value is exactly `1`; a zero does not represent
   an interaction edge.
5. Emit `StudentId,Name,Group,Lesson,Code,Value` with `Value = 1`.

The expected result is exactly 391 interaction rows. Twelve source
actor/lesson rows have all seven code fields equal to zero and therefore do not
appear in the interaction table; they remain present in the original workbook.
No observation is invented or imputed.

Rebuild the derivative with:

```bash
npm run data:build
```

The script refuses to write output if the source headers, original SHA-256,
interaction count, all-zero row count, or allowed code values do not match the
documented contract.

## Recommended HINA configurations

### Bipartite

- Object1: `StudentId`
- Object2: `Code`
- Object3: `None`
- Object1 Attribute: `Group`
- Object2 Attribute: `None`

### Tripartite

- Object1: `StudentId`
- Object2: `Code`
- Object3: `Lesson`
- Object1 Attribute: `Group`
- Object2 Attribute: `None`

When demonstrating two communities, select a fixed community count of `2`.
The data is not altered to manufacture a particular cluster result.
