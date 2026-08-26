---
title: Structured Research Note
lang: en
---

## Reproducible measurements

This repository-authored document exercises Pandoc's real table of contents, numbered sections, footnotes, and MathML output in one standalone HTML note.

### Model

For a bounded example, define the arithmetic mean as

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i.
$$

The equation is illustrative rather than a scientific claim. The workflow records inputs before interpreting results.[^audit]

#### Recorded values

| Stage | Evidence retained | Decision |
|:--|:--|:--|
| Capture | Source bytes and command | Continue |
| Verify | Output hashes and fresh checks | Review |
| Share | Bounded compatibility statement | Publish |

### Interpretation boundary

The export proves that this exact source and command produced the captured HTML. It does not establish compatibility for every Pandoc extension, template, version, or platform.

[^audit]: The footnote exists to exercise Pandoc's native endnote structure in the generated HTML.
