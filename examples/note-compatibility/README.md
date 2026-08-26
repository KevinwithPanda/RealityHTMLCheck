# Representative export fixtures / 合成代表性导出夹具

For separately preserved HTML emitted by an actual local exporter—with command, hashes, reproduction, privacy, and license provenance—see [`../real-export-evidence`](../real-export-evidence/README.md). 实际工具生成的分层证据见 [`../real-export-evidence`](../real-export-evidence/README.md)。

This directory contains invented, repository-owned HTML packages used to test RealityCheck's note workflow. The fixtures model selected file and dependency shapes commonly associated with one-page exports, linked knowledge notes, executable notebooks, and nested publishing libraries.

本目录包含完全虚构、由本仓库自行维护的 HTML 文件包，用于测试 RealityCheck 的笔记核查流程。夹具只模拟单页导出、互链知识笔记、可执行笔记本和嵌套发布依赖中的部分常见结构。

Important evidence boundary:

- These are synthetic representative fixtures, not downloaded or copied vendor exports.
- The `Notion-like`, `Obsidian-like`, `Jupyter-like`, and `Quarto-like` labels describe package shapes only.
- No result is an official compatibility claim, certification, endorsement, or guarantee for a product or version.
- The matrix proves deterministic static rules on the checked-in bytes. It does not prove browser rendering, factual correctness, plugin compatibility, or every real export variant.

重要证据边界：

- 这些是合成代表性夹具，不是下载或复制的厂商导出文件。
- `Notion-like`、`Obsidian-like`、`Jupyter-like`、`Quarto-like` 仅用于描述文件包结构。
- 任何结果都不是对具体产品或版本的官方兼容声明、认证、背书或保证。
- 矩阵只证明确定性静态规则在当前提交字节上的结果，不证明浏览器渲染、事实正确性、插件兼容性或所有真实导出变体。

Regenerate the checked-in evidence after an intentional fixture or detector change:

```powershell
node scripts/note-compatibility-evidence.mjs --write
```

Verify that every score, rule, fixture digest, decision case, JSON artifact, and public page matches a fresh analysis:

```powershell
node scripts/note-compatibility-evidence.mjs --verify
```

The authoritative machine-readable result is [`compatibility-matrix.json`](compatibility-matrix.json). Fixture hashes cover relative file names and exact bytes, so a changed sample cannot silently retain an old result.
