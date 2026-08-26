# Real HTML export evidence / 真实 HTML 导出证据

This directory is intentionally separate from `examples/note-compatibility`, which contains repository-authored representative shapes. The Markdown source here is minimal and repository-owned, but the checked-in HTML was emitted by an actual locally installed export tool. It was not hand-written to resemble that tool's output and contains no imported user note or personal data.

本目录刻意与 `examples/note-compatibility` 中的合成代表性结构分开。这里的 Markdown 源文档由本仓库编写且内容最小化，但随仓库提交的 HTML 是由本机真实安装的导出工具生成，而不是手写成类似该工具的样子；其中不含外部用户笔记或个人信息。

## Captured sample / 已取证样本

| Generator | Version | Source | Generated output | RealityCheck observation |
|---|---:|---|---|---|
| Pandoc | 3.8.2.1 | `pandoc-3.8.2.1/source/note.md` | `pandoc-3.8.2.1/generated/note.html` | 100/100, ready, 0 errors, 0 warnings |

Exact command, tool-binary SHA-256, source/output SHA-256 values, line-ending profile, and bounded product expectation are recorded in [`manifest.json`](manifest.json).

精确命令、工具二进制 SHA-256、源文件与输出文件 SHA-256、换行格式以及有限的产品预期均记录在 [`manifest.json`](manifest.json) 中。

## Verify without Pandoc / 无需 Pandoc 即可验证

The default check validates the frozen bytes, both raw and cross-platform-normalized hashes, provenance fields, the generator marker, privacy boundary, and a fresh RealityCheck analysis. It does not invoke an exporter:

```powershell
node scripts/real-export-evidence.mjs --verify
```

## Reproduce with the exact exporter / 使用同版导出器复现

When Pandoc 3.8.2.1 is available, the verifier copies only the source into a temporary directory, executes the recorded command, and compares the regenerated HTML. It accepts CRLF/LF differences only through a separately recorded canonical-LF digest; all other byte changes fail:

```powershell
node scripts/real-export-evidence.mjs --reproduce
```

Recorded command:

```powershell
pandoc source/note.md --from=gfm --to=html5 --standalone --output=generated/note.html
```

## Evidence and license boundary / 证据与许可边界

- This proves one local Pandoc 3.8.2.1 export with the recorded command and bytes. It is not an official Pandoc certification and does not cover every Pandoc option, template, version, browser, or operating system.
- The source prose is repository-authored and contains no third-party user content. RealityCheck statically inspected the generated HTML; it did not execute or upload it.
- The Pandoc executable is GPL-2.0-or-later and is **not** redistributed here.
- The generated HTML includes Pandoc's default template/style material. Pandoc's installed copyright notice dual-licenses its templates under GPL-2.0-or-later or BSD-3-Clause; this evidence uses the BSD-3-Clause option for those portions. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- A 100/100 static result means no enabled deterministic blocker was found in this one sample. It does not prove factual accuracy, comprehensive accessibility, browser compatibility, or absence of malicious behavior in arbitrary exports.

- 这只证明一个采用已记录命令与字节的本机 Pandoc 3.8.2.1 导出，不是 Pandoc 官方认证，也不覆盖全部参数、模板、版本、浏览器或操作系统。
- 源文档由本仓库编写，不含第三方用户内容。RealityCheck 只静态检查生成的 HTML，没有执行或上传它。
- Pandoc 可执行程序采用 GPL-2.0-or-later，且**未**随本目录再分发。
- 生成的 HTML 含 Pandoc 默认模板/样式材料。已安装 Pandoc 的版权声明将模板以 GPL-2.0-or-later 或 BSD-3-Clause 双重许可；本证据对这些部分选择 BSD-3-Clause，详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 100/100 只表示这个样本未触发已启用的确定性阻断项，不代表事实正确、完整无障碍、全面浏览器兼容或任意导出都不存在恶意行为。
