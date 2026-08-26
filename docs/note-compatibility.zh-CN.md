# HTML 笔记兼容性证据：我们实际测试了什么

RealityCheck 不把“支持某某工具”写成没有证据的口号。本仓库提交了 7 个合成代表性文件包，并用线上检查器和 CLI 共用的正式分析器重新计算结果。

机器可读结果位于 [`examples/note-compatibility/compatibility-matrix.json`](../examples/note-compatibility/compatibility-matrix.json)，生成与验证逻辑位于 [`scripts/note-compatibility-evidence.mjs`](../scripts/note-compatibility-evidence.mjs)。公开页面由同一份结果生成，而不是单独手写一套数字。

## 证据边界

这些夹具不是 Notion、Obsidian、Jupyter 或 Quarto 的官方导出文件，也没有复制厂商模板、商标视觉或用户内容。名称中的 `-like` 只表示“结构类似”：

- Notion-like：单个 HTML 与同级资源文件夹；
- Obsidian-like：多个 HTML 笔记、相对链接与章节锚点；
- Jupyter-like：可阅读的静态正文加本地可执行交互；
- Quarto-like：HTML 引用嵌套 `site_libs` 样式依赖。

因此，目前可以严谨地说“这些代表性结构与故障已经被自动测试”，不能说“官方支持上述产品的所有版本”。本证据也不覆盖浏览器运行效果、笔记事实是否正确、第三方插件、主题全集或所有真实导出变体。

## 与合成夹具分层的真实工具导出

仓库另行保存了四个由本机 **Pandoc 3.8.2.1** 实际生成的 HTML，而不是手写成 Pandoc 风格。场景覆盖默认 standalone、CSS/SVG 自包含、目录 + 编号章节 + 脚注 + MathML，以及两份 Markdown 合并导出。全部 Markdown、CSS 和 SVG 输入均由本仓库编写，不含第三方用户内容或个人信息；清单逐项记录了精确命令、所有输入/输出 SHA-256、Pandoc 可执行文件 SHA-256、换行格式和第三方模板许可边界。

四份真实导出经当前 RealityCheck 重新核查均为 **100/100、0 错误、0 警告**，并已用同版 Pandoc 全部逐字节复现。它们只证明这四条命令、这一版本和这四份输出，不构成 Pandoc 官方认证，也不代表所有参数、模板、平台或版本都兼容。证据位于 [`examples/real-export-evidence`](../examples/real-export-evidence/README.md)，可运行：

```powershell
node scripts/real-export-evidence.mjs --verify
```

## 当前可复现结果

| 代表性结构 | 夹具 | 实测判断 | 被证明的能力 |
| --- | --- | --- | --- |
| Notion-like | before 93 → after 100 | 暂不分享 → 未发现确定性阻断项 | 发现同级资源文件夹中的缺失图片；恢复准确相对文件后复检通过 |
| Obsidian-like | before 93 → after 100 | 暂不分享 → 未发现确定性阻断项 | 目标 HTML 存在时仍检查跨笔记章节 ID；修正片段后复检通过 |
| Jupyter-like | review 98 | 分享前复核 | 披露本地可执行脚本，不在不理解交互用途时盲目删除 |
| Quarto-like | before 91 → after 100 | 暂不分享 → 未发现确定性阻断项 | 递归进入嵌套 CSS，发现缺失 `@import` 与手机端固定宽度；补全依赖并改为流式宽度后复检通过 |

文件夹就绪度使用最低 HTML 文件分，不使用平均分掩盖最差文件。每个夹具结果还包含其全部文件名与字节的 SHA-256 摘要；夹具发生变化后，旧矩阵会在验证时失败。

## 四个可审查案例

1. 同级图片缺失：before 报告 `missing-local-file`，修复副本补回 `export_assets/workflow.svg`，after 得分从 93 变为 100。
2. 跨笔记章节失效：before 报告 `broken-cross-document-fragment`，把 `#results` 修正为目标笔记真实存在的 `#result`，after 从 93 变为 100。
3. 笔记本包含脚本：报告 `executable-script` 并给出“分享前复核”，不把可能维持交互所需的脚本伪装成可安全自动删除项。
4. 嵌套发布样式失效：before 同时报告缺失 CSS `@import` 与手机端固定宽度，补全主题并改为流式宽度后，两条规则在 after 中均不再复现。

这些案例分别证明“应当修复”“修复后确实不再复现”“依赖图能够追踪二级样式”和“不能武断自动修改”等不同产品行为。

## 如何复现

在仓库根目录运行：

```powershell
node scripts/note-compatibility-evidence.mjs --verify
```

验证过程会：

1. 重新读取每个文件包的所有 HTML、CSS 与附件清单；
2. 用正式 `note-analyzer`、`note-package` 和最低文件分逻辑重新计算；
3. 核对每个夹具声明的状态与必需规则；
4. 核对四个 before/after 或人工决策案例；
5. 将重新生成的 JSON 和公开 HTML 与提交产物逐字节比较。

只有全部一致时才返回成功。未来若要声称更广泛的真实产品兼容，应增加经许可、去隐私化、按版本标注的真实导出样本，并单独进行浏览器视觉与交互验证。

如果你愿意贡献真实导出结构，请使用仓库的 **HTML export compatibility sample** Issue 模板。它要求注明导出工具版本与平台，并确认样本已经去除个人、凭据、账号及专有内容；被接受的样本仍只证明对应版本和结构，不升级为厂商官方兼容声明。
