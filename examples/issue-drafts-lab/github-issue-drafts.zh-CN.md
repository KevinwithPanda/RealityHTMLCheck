# RealityCheck GitHub 工单草稿

草稿 **6** · 可执行 **5** · 待复核 **1** · 已豁免 **0** · 已合并重复 **0**

> 草稿不会自动提交。创建外部工单前，请人工复核范围、责任归属、保密性、标签和重复状态。

## [major] 移动端视口内无法看到结账审核按钮

ISSUE-920864929A96 · `realitycheck` `severity:major` `disposition:actionable` `rule:offscreen-critical-control`

## 问题

移动端视口内无法看到结账审核按钮

- 严重级别：`major`
- 置信度：`high`
- 规则：`offscreen-critical-control`

## 修复建议

移除应用外壳的固定最小宽度，并在手机断点把主操作排列到标题下方。

- 用响应式网格约束替换 min-width: 1040px。
- 在窄屏上允许主要操作换行到标题下方。

## 验收标准

- 重新运行 `baseline`, `mobile-375`。
- 稳定指纹 `920864929a9614a5de5d92b964db6d1ed6a07ac7ccbfe092a558884e75ac3170` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · mobile-375](../reference-run/report.html#RC-920864929A) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

## [major] 超长客户名称被截断，用户无法访问完整内容

ISSUE-FB7751933E1D · `realitycheck` `severity:major` `disposition:actionable` `rule:element-text-clipping`

## 问题

超长客户名称被截断，用户无法访问完整内容

- 严重级别：`major`
- 置信度：`high`
- 规则：`element-text-clipping`

## 修复建议

在保持卡片布局的同时，让用户能够访问完整客户名称。

- 允许名称换行，或增加支持键盘和读屏器的展开/提示机制。

## 验收标准

- 重新运行 `baseline`, `long-text`。
- 稳定指纹 `fb7751933e1dae1692cc806f39622186159c5007c87abbe0320050ee6c23d572` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · long-text](../reference-run/report.html#RC-FB7751933E) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

## [minor] 状态标签仍固定在物理右侧

ISSUE-02B9DF270A7A · `realitycheck` `severity:minor` `disposition:actionable` `rule:rtl-physical-spacing`

## 问题

状态标签仍固定在物理右侧

- 严重级别：`minor`
- 置信度：`high`
- 规则：`rtl-physical-spacing`

## 修复建议

使用逻辑方向的间距属性，使状态标签跟随书写方向对齐。

- 将 margin-left: auto 替换为 margin-inline-start: auto。

## 验收标准

- 重新运行 `baseline`, `rtl-arabic`。
- 稳定指纹 `02b9df270a7ab58db15af335bfcc3292ac41e099604da53ffa54af73bf9baa98` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · rtl-arabic](../reference-run/report.html#RC-02B9DF270A) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

## [minor] 页面在初始化时输出错误

ISSUE-7AEAC80E106F · `realitycheck` `severity:minor` `disposition:actionable` `rule:console-error`

## 问题

页面在初始化时输出错误

- 严重级别：`minor`
- 置信度：`high`
- 规则：`console-error`

## 修复建议

处理可选分析服务的初始化失败，不要在生产控制台中输出错误。

- 对于可选集成，使用可恢复的警告或明确的功能状态结果。

## 验收标准

- 重新运行 `baseline`。
- 稳定指纹 `7aeac80e106f68fc401a23305947ffa0751bfafb0a4020a59cfe79f6d9f08af7` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · baseline](../reference-run/report.html#RC-7AEAC80E10) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

## [minor] 客户头像没有文本替代内容

ISSUE-831A358F9422 · `realitycheck` `severity:minor` `disposition:actionable` `rule:image-alt`

## 问题

客户头像没有文本替代内容

- 严重级别：`minor`
- 置信度：`high`
- 规则：`image-alt`

## 修复建议

明确头像属于装饰性图片，或者提供简洁的替代文本。

- 如果旁边的客户名称已经表达了相同信息，请使用 alt=""。

## 验收标准

- 重新运行 `baseline`, `image-failure`。
- 稳定指纹 `831a358f94229cb373fe4ba69cd7c49f2eb6572d703bfc916c7ff61328a9572e` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · image-failure](../reference-run/report.html#RC-831A358F94) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

## [minor] 交互控件可能没有可见的键盘焦点指示

ISSUE-3E80D0B7409A · `realitycheck` `severity:minor` `disposition:review` `rule:keyboard-focus-visibility`

## 问题

交互控件可能没有可见的键盘焦点指示

- 严重级别：`minor`
- 置信度：`low`
- 规则：`keyboard-focus-visibility`

## 修复建议

恢复高对比度的 focus-visible 样式。

- 使用 :focus-visible，并设置两像素轮廓和适当的 outline-offset。

## 验收标准

- 重新运行 `baseline`, `keyboard-tab`。
- 稳定指纹 `3e80d0b7409a7389cebefb4da36ff78d5ef5e64d912cd713fb72037acda7d7d9` 不再出现。
- 基线场景保持健康，且不得出现同级或更严重的新回归。

## 证据

- [reference-demo-v0.4.0 · keyboard-tab](../reference-run/report.html#RC-3E80D0B740) · http://127.0.0.1:4173/

> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。

---

