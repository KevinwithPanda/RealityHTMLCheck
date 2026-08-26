# RealityCheck

> **AI 生成的 HTML，使用和分享前先体检。**

RealityCheck 现在首先是一款面向普通用户的本地 HTML 笔记体检工具，同时保留面向 Codex、开发者和产品团队的真实浏览器 Web 核查能力。笔记检查无需账号、无需服务器，不会上传文件；专业 Web 核查则继续提供压力场景、证据、修复任务和修复前后证明。

当前版本：`v0.8.0 Beta`。笔记源文件绝不会被覆盖；未执行的 Web 场景会明确标记为 `unsupported` 或 `skipped`，绝不会伪装成通过。

## 一分钟内获得价值：检查 HTML 笔记

直接打开[免安装 HTML 笔记检查器](https://kevinwithpanda.github.io/RealityHTMLCheck/note.html)，选择一个 `.html` 文件或整个笔记文件夹。所有分析都发生在当前浏览器中：

- 不注册账号，不上传笔记，也不需要启动服务器；
- 选择文件夹后检查丢失的本地图片、样式、附件和关联笔记，并沿着实际引用递归核验外部 CSS、`@import`、CSS 图片/字体与跨笔记锚点；
- 检查编码、标题、标题大纲、重复 ID、失效目录、图片替代文本和表格；
- 检查仅本机可用路径、文件名大小写、远程依赖、脚本和内联事件；
- 检查手机 viewport、固定宽布局、超长文本和未完成的 AI 占位内容；
- 先给出“暂不建议分享 / 分享前请复核 / 本次检查未发现阻断项”，文件夹采用最低文件分避免平均值掩盖坏文件；
- 生成中英文证据、可复制修复任务、JSON 结果、可分享离线 HTML 报告、单 HTML 安全副本，以及保留全部所选资源结构的安全元数据文件夹 ZIP。

自动修复刻意限制为三项明确修改：补充 HTML5 doctype、声明文档语言和补充 UTF-8 元数据。单文件按钮会显示原文件夹分数、资源未打包的“单 HTML 得分”和问题变化；它只下载一个 HTML，请移回原相对目录，或改用文件夹 ZIP。浏览器绝不会覆盖源文件，也不会把图片描述、标题结构等需要判断的问题伪装成已修复。

选择真实文件夹后，**联合复检并生成 ZIP** 会对所有可安全处理的 HTML 同时应用这三项修改，再对累计候选运行一次完整 HTML/CSS/文件包复检。用户必须先检查完整所选清单并确认构建；ZIP 会在新 wrapper 中保留原根目录，逐字节复制全部浏览器所选图片、样式和附件，因此 `../notes/assets/x.png` 这类跨根引用仍保持原目录语义。它会写入本地 after report 与 proof，并在下载前回读核对 entry 路径、大小、CRC32 和 SHA-256。界面、报告、JSON 与 proof 还会显示同一个可复制候选 ID，用 SHA-256 绑定实际分析的 HTML/CSS 文本、范围、修改、摘要与问题状态；打包前还会重新读取所选 HTML/CSS，且修复映射必须与声明的修改文件完全一致。构建完成后还要再次明确点击才会下载。

该 ZIP 是“已验证的安全元数据工作副本”，不是“全部修好”或“可直接发布”证明。它不会虚构缺失文件、下载远程资源或修复结构/内容/脚本；空目录、符号链接和浏览器没有提供的隐藏文件也无法保留。若发现路径冲突、`.env`/密钥/`.git`/`node_modules`/`.realitycheck` 等潜在敏感内容、超过 4,998 个所选文件、单文件超过 32 MiB 或所选字节超过 62 MiB，打包会失败关闭而不会静默漏文件；普通静态分析还限制浏览器所选文件不超过 5,000 个、HTML 总解码字节不超过 32 MiB、可读 CSS 不超过 16 MiB。需要更广泛且依赖判断的修改时，仍应使用 Skill 工作流。

需要批量检查整个笔记文件夹时，无需克隆仓库或全局安装：

```bash
npx --yes --package="github:KevinwithPanda/RealityHTMLCheck#v0.8.0" \
  realityhtmlcheck note ./我的笔记
# 打开 .realitycheck/notes/latest.html
```

生成保守修复副本，但保持所有源文件逐字节不变：

```bash
npx --yes --package="github:KevinwithPanda/RealityHTMLCheck#v0.8.0" \
  realityhtmlcheck note ./我的笔记 --fix-safe
```

持续导出时，可把同一检查器放进 GitHub Actions；note 模式不启动服务器、不安装浏览器依赖，也不执行笔记脚本：

```yaml
- uses: KevinwithPanda/RealityHTMLCheck@v0.8.0
  with:
    kind: note
    path: exported-notes
    fail-on: error
    summary-language: zh-CN
```

可直接复制[完整工作流模板](https://github.com/KevinwithPanda/RealityHTMLCheck/blob/main/examples/github-actions/html-note-gate.yml)，其中已经包含触发条件、只读权限、checkout、artifact 命名和可选的不可变 baseline 路径。

RealityCheck 不上传源笔记。启用 artifact 时，工作流会保存生成报告，其中可能包含有限证据摘录；把 artifact 公开前仍应复核。

第二次及后续导出可以与一份不可变的历史报告比较：

```bash
npx --yes --package="github:KevinwithPanda/RealityHTMLCheck#v0.8.0" \
  realityhtmlcheck note ./我的笔记 \
  --baseline .realitycheck/notes/历史运行/report.json \
  --fail-on error
```

差异报告区分“新增、已解决、恶化、仍存在、未核验”。基线模式只按所选级别阻止新增、恶化和未核验回归；历史中持续存在的问题仍会展示，但不会让 CI 永久失败。删除 HTML 或缩小文件包范围只能判为未核验，不能伪装成修复。

如果一个文件夹同时包含已发布笔记与归档/草稿，可重复使用 `--exclude-html "archive/**"`，或在 Action 的 `exclude-html` 输入中逐行填写规则。被排除的 HTML 只退出逐文件检测：它仍是已知文件包条目，可继续作为跨笔记目标，也仍会进入 stylesheet/CSS 图；但不会运行该文件自身的逐文件图片/媒体规则。可视报告显示规则、数量和有限路径预览，JSON 保留完整命中路径。若相对旧基线首次新增排除，门禁会以 `html-scope-newly-excluded` 失败一次，避免通过缩小范围隐藏错误；审核并有意接受新基线后，相同排除不会让后续 CI 永久失败。达到 HTML 或 10,000 文件发现上限时会直接返回运行错误，绝不会只检查前半部分却给出绿色报告。

如果在 Codex 中要求 `$realitycheck` “检查并修复”，Skill 会使用 `--prepare-repair` 把有上限的完整笔记文件夹、图片、样式、附件和关联笔记复制到证据目录，再由 Codex 直接修改该工作副本并复检。用户会在同一个任务中得到修复前报告、修复版 HTML 文件夹、修复后报告和仍需判断的问题，不需要把静态报告里的提示词再次粘贴回 Codex。

如果要在导出流水线中阻止错误，可添加 `--fail-on error` 或 `--fail-on warning`。原有 URL 网页核查仍用于响应式交互、接口恢复、可访问性、性能、安全响应头、隐私预算和发布治理。

无需安装也可以打开[产品首页](https://kevinwithpanda.github.io/RealityHTMLCheck/)；[代表性导出兼容证据](https://kevinwithpanda.github.io/RealityHTMLCheck/compatibility.html)公开 4 个由真实 Pandoc 3.8.2.1 按固定命令生成并可逐字节重放的导出、7 个明确标注为 `-like` 的代表性夹具、4 个修复/决策案例和完整证据边界。真实导出覆盖 standalone、嵌入本地 CSS/SVG、目录/脚注/MathML 以及多 Markdown 合并；它们是有限证据，不是官方全兼容声明。仓库内的[演示中心](../examples/index.html)还包含真实浏览器夹具、修复证明、产物目录、风险台账、组合门禁和签名决策。

## 安装前先看实际效果

下面是一次真实 Chrome 核查提交的双语报告界面，不是设计稿。它展示安全门禁得分 80/100，以及 5 个带测量证据的主要问题。

<p align="center"><img src="assets/report-preview.png" alt="RealityCheck 中文报告概览，显示 80 分门禁和 5 个主要问题" width="100%" /></p>

<details>
<summary><strong>查看从证据到修复任务的界面</strong></summary>

每个问题会解释违反的规则与证明场景，可加入批量修复，并可复制“修复并验证任务”。静态报告本身不会修改源码。

<p align="center"><img src="assets/finding-preview.png" alt="RealityCheck 中文问题卡片，包含具体说明、批量选择和复制修复并验证任务按钮" width="100%" /></p>
</details>

## 一句话使用

一次安装后，只需要告诉 Codex：

```text
使用 $realitycheck 核查当前应用，修复高置信度的主要问题，并证明每项修复真的有效。
```

如果当前仓库有可识别的启动脚本或已有本地服务，不必提供网址。RealityCheck 会自动：

1. 找到或启动应用；
2. 在安全边界内发现配置路由，并用真实浏览器和独立上下文执行压力场景；
3. 保存 DOM 测量值与截图；
4. 仅修复你已授权且证据充分的应用根因；
5. 用原检测器复跑，输出修复前后对比。

只核查、不改源码：

```text
使用 $realitycheck 核查当前应用，不要修改源码。
```

## 安装 skill

在克隆后的仓库中运行一次：

```bash
git clone --depth 1 https://github.com/KevinwithPanda/RealityHTMLCheck.git
cd RealityHTMLCheck
python scripts/install-skill.py
python scripts/install-skill.py --status
```

第二条命令应显示 `installed and current`。如果 Codex 没有自动刷新 skill 列表，请重新加载。RealityCheck 不是常驻后台程序：安装后，Codex 启动时会发现它的元数据；只有请求匹配时才加载完整流程，显式输入 `$realitycheck` 则会立即调用。再次执行安装命令会先把旧版本保存到 Codex 主目录下独立的 `skill-backups/realitycheck`，避免备份被误识别为第二个同名 Skill。

## 一条命令体验真实核查

第一次运行不需要准备应用、配置或第二个终端：

```bash
npm install
npm run demo
```

npm registry 的 `realityhtmlcheck` 首发仍需维护者完成可信发布引导；在此之前，HTML 笔记命令使用上面的带版本 GitHub 包。`demo` 与完整 Web 审计目前仍从仓库源码运行。`npm run demo` 会在随机端口启动只监听回环地址的内置故障页，用真实 Chrome 核查，把双语报告写入 `.realitycheck/demo`，然后关闭服务器。报告会如实显示 Major 门禁失败；因为这些夹具问题是预期结果，Demo 命令本身返回成功，但浏览器、渲染器或证据故障仍返回运行错误。

## 为什么报告可信

RealityCheck 不会只看截图就主观评价“好不好”。计分问题必须包含检测规则、稳定元素定位、测量值、复现步骤和证据，并与无压力的桌面基线比较：

- `existing`：基线已经存在；
- `new`：只在压力场景出现；
- `worsened`：相比基线可测量地变严重；
- `resolved`：同一稳定指纹在成功完成的证明场景中不再复现。

低置信度观察不会扣分，也不会让 CI 失败。如果证明场景被跳过、不受支持或运行失败，结果只能是“未验证”，不能冒充“已解决”。

## 独立 CLI

不通过 Codex 也可以直接运行真实浏览器核查：

```bash
npm install
npm run audit -- http://localhost:3000
```

环境要求：Node.js 20+、Python 3.11+，以及已经安装的 Chrome、Edge 或 Chromium。项目只安装固定版本的 Playwright Core，不会偷偷下载浏览器。

深度核查和修复前后验证：

```bash
npm run audit -- http://localhost:3000 --mode deep --fail-on major
npm run audit -- http://localhost:3000 --compare .realitycheck/runs/修复前/report.json
npm run audit -- http://localhost:3000 --baseline .realitycheck/baseline/report.json
npm run realitycheck -- audit --config realitycheck.config.json
```

### 运行前先看懂核查计划

如果项目策略看起来过于抽象，可以在打开浏览器前先解析它：

```bash
npm run realitycheck -- plan --config realitycheck.config.json \
  --output .realitycheck/audit-plan
```

`plan` 会校验最终生效的配置，并生成 `audit-plan.json`、中英文 Markdown 和一个可离线切换语言的 `audit-plan.html`。预览会明确展示页面上限、每页场景、最大场景执行次数、12 类检测器的启用/未启用状态、治理规则、安全边界、数据保留范围，以及可复制的正式核查命令。它不会启动浏览器，也不会请求目标网站；查询参数值、路由模式、选择器、认证文件路径、Cookie/存储内容和密钥都不会复制到产物中。仓库内的 [301 次执行示例](../examples/audit-plan-lab/audit-plan.html) 展示了启用全部检测器类别的 Deep 策略。

第二条命令会生成新报告，以及 `verification.json`、中英双语 `verification.md` 和可视化 `verification.html`。退出码 `1` 表示命中了质量门禁，不代表报告生成失败。

无需把证据发送给外部 API，也可以把已校验报告转换为有上限的 GitHub 作业摘要和安全转义的工作流注释：

```bash
npm run realitycheck -- github-summary .realitycheck/runs \
  --output .realitycheck/github-summary.md \
  --max-annotations 20 \
  --language zh-CN
```

每个精确目标只使用最新报告：URL query 不进入输出，已豁免问题保留计数但不生成注释，较新的通过报告会让旧问题退出摘要，报告中的不可信文本也会在 GitHub 解析前被规范化。复用 Action 会自动完成这一步；可通过 `summary-language: zh-CN` 选择中文，并从 `github-summary-path` 输出获取 Markdown 路径。

首次配置或排查环境时可以运行：

```bash
npm run realitycheck -- profiles
npm run realitycheck -- init --profile product --base-url http://localhost:3000
npm run realitycheck -- plan --config realitycheck.config.json
npm run realitycheck -- doctor
npm run realitycheck -- visual-approve .realitycheck/runs/运行ID/report.json
```

三个经过配置校验的预设解决“第一次面对空配置无从下手”的问题：

| 预设 | 适用场景 | 已包含策略 |
| --- | --- | --- |
| `starter` | 第一次核查、个人项目 | Quick 场景、一个 375px 视口、25 个安全链接、基础元数据和宽松门禁 |
| `product` | 持续迭代的产品团队 | Deep 场景、360px 手机 + 768px 平板、有限爬取、性能、API、元数据、安全、存储聚合隐私和治理 |
| `strict` | 成熟发布流水线 | 320px + 390px 手机与 768px 平板、更严格的性能/存储预算、全资源可靠性、响应头语义 + SRI 和零有效豁免 |

`init` 默认使用 `starter`。预设只是透明、可编辑的起点，不是合规认证；接入 CI 前仍需审核阈值与安全排除路径。

## 全站核查与项目规则

`realitycheck.config.json` 可以把单页检查升级成有边界的项目质量策略。命令行参数优先于配置；配置中的相对路径以配置文件所在目录为准。

```json
{
  "$schema": "./node_modules/realityhtmlcheck/realitycheck/assets/config.schema.json",
  "baseUrl": "http://127.0.0.1:3000/",
  "mode": "quick",
  "failOn": "major",
  "viewports": [
    { "id": "phone-320", "width": 320, "height": 700, "touch": true },
    { "id": "phone-390", "width": 390, "height": 844, "touch": true },
    { "id": "tablet-768", "width": 768, "height": 1024, "touch": true }
  ],
  "qualityGate": {
    "minimumScore": 90,
    "minimumCoveragePercent": 90,
    "maxWaivedFindings": 2
  },
  "baselinePolicy": {
    "maxAgeDays": 30,
    "requireSamePolicy": true
  },
  "owners": [
    {
      "id": "web-platform",
      "name": "Web Platform",
      "ruleIds": ["custom-primary-navigation-named"],
      "include": ["/app/**"]
    }
  ],
  "crawl": {
    "enabled": true,
    "maxPages": 20,
    "maxDepth": 2,
    "include": ["/app/**"],
    "exclude": ["/logout/**", "/checkout/**"]
  },
  "checks": [
    {
      "id": "primary-navigation-named",
      "selector": "nav",
      "assertion": "accessible-name",
      "severity": "major"
    }
  ],
  "journeys": [
    {
      "id": "settings-notifications",
      "startPath": "/app/settings",
      "severity": "major",
      "steps": [
        { "action": "press", "selector": "[role=tab][aria-controls=general]", "key": "ArrowRight" },
        { "action": "assert", "selector": "#notifications", "assertion": "visible" },
        { "action": "goto", "path": "/app/profile" },
        { "action": "assert-url", "path": "/app/profile" }
      ]
    }
  ],
  "budgets": {
    "navigationMs": 2500,
    "ttfbMs": 800,
    "firstContentfulPaintMs": 1800,
    "largestContentfulPaintMs": 2500,
    "cumulativeLayoutShift": 0.1,
    "requests": 80,
    "transferKb": 1500,
    "domNodes": 1800,
    "severity": "major"
  },
  "network": {
    "scope": "api",
    "maxHttpErrors": 0,
    "maxFailedRequests": 0,
    "slowRequestMs": 1000,
    "maxSlowRequests": 1,
    "maxThirdPartyRequests": 2,
    "severity": "major"
  },
  "links": {
    "maxFailures": 0,
    "maxChecked": 50,
    "timeoutMs": 5000,
    "severity": "major"
  },
  "metadata": {
    "titleMinLength": 10,
    "titleMaxLength": 70,
    "descriptionMinLength": 50,
    "descriptionMaxLength": 180,
    "requireCanonical": true,
    "requireViewport": true,
    "requireLang": true,
    "forbidNoindex": true,
    "requireSingleH1": true,
    "severity": "major"
  },
  "visual": {
    "baselineDirectory": ".realitycheck/visual-baselines",
    "maxDiffRatio": 0.002,
    "pixelThreshold": 28,
    "masks": [".current-time", "[data-dynamic]"],
    "severity": "major"
  },
  "security": {
    "requiredHeaders": ["content-security-policy", "x-content-type-options", "referrer-policy"],
    "headerPolicies": {
      "contentSecurityPolicy": {
        "requiredDirectives": ["default-src", "base-uri", "form-action", "frame-ancestors"],
        "forbiddenTokens": ["'unsafe-eval'", "*", "http:"]
      },
      "strictTransportSecurity": {
        "minMaxAgeSeconds": 31536000,
        "requireIncludeSubDomains": true
      },
      "xContentTypeOptions": { "requireNosniff": true },
      "referrerPolicy": {
        "allowedValues": ["no-referrer", "strict-origin-when-cross-origin"]
      },
      "permissionsPolicy": {
        "disabledFeatures": ["camera", "microphone", "geolocation", "payment", "usb"]
      }
    },
    "requireSubresourceIntegrity": true,
    "secureForms": true,
    "maxThirdPartyOrigins": 3,
    "allowedThirdPartyOrigins": ["https://cdn.example.com"],
    "severity": "major"
  },
  "privacy": {
    "maxCookies": 20,
    "maxCookieBytes": 8192,
    "maxThirdPartyCookies": 5,
    "maxLocalStorageEntries": 50,
    "maxLocalStorageBytes": 262144,
    "maxSessionStorageEntries": 30,
    "maxSessionStorageBytes": 131072,
    "severity": "major"
  },
  "waivers": [
    {
      "id": "legacy-toolbar-web-42",
      "ruleId": "custom-toolbar-minimum-size",
      "reason": "替换工作由 WEB-42 跟踪",
      "owner": "Web Platform",
      "expires": "2027-01-31",
      "include": ["/app/legacy/**"]
    }
  ]
}
```

`viewports` 可配置 1～6 个名称与尺寸都唯一的核查点。每个尺寸都在独立浏览器上下文中运行，生成自己的场景状态与截图，并测量横向溢出、桌面可见但在该尺寸不可达的控件；当 `touch` 为 `true` 时，还会启用严重小于 24px 的触控目标检查。该标记只控制目标尺寸启发式，不会冒充某个品牌设备、移动 UA 或手势环境。不配置时继续使用原来的 `mobile-375`。

成对的 [`examples/viewport-lab`](../examples/viewport-lab) 直接证明了价值：固定 375px 会漏掉这个缺陷，而 320px/390px/768px 矩阵只在 320px 找到发布按钮不可达的一个 Major（**92/100**）；修复页全部通过并得到 **100/100**。

爬虫只跟随同源页面链接，会去掉查询参数和片段，不点击控件、不提交表单，并默认拒绝退出、购买、删除与 OAuth 等危险路径。每个页面都在隔离浏览器上下文中执行；单页运行失败不会抹掉其他页面的证据。

自定义检查仅允许声明式断言：`exists`、`visible`、`enabled`、`accessible-name`、`attribute`、`count`、`no-horizontal-overflow`、`minimum-size`，并可用路由 glob 限定范围。声明式旅程可以跨同源导航、标签页、折叠面板、仅导航用途的键盘操作和路径断言复用这些规则，每一步都有截图；运行器会拒绝表单提交、激活/文本输入键、可编辑的按键目标、危险文案、排除路由、匹配多个元素的点击和未明确标记的业务按钮。URL 断言不会保留查询或片段值，任意 JavaScript 都会被拒绝。可直接运行 [`examples/journey-lab`](../examples/journey-lab) 的成功与失败配置。

网络可靠性策略可以独立约束“仅 API”或“全部资源”流量：限制 HTTP 错误、传输失败、慢请求及第三方请求数量。证据只保留有上限且已移除凭据、片段和查询参数值的端点样本，绝不保存响应正文。成对的 [`examples/network-lab`](../examples/network-lab) 会让缺失一个 API 的页面得到 **96/100**，恢复接口后得到 **100/100**。

链接完整性策略只通过 `HEAD` 核查有上限的同源锚点，不激活链接、不下载响应正文，最多跟随五次同源重定向，并复用爬虫对退出、购买、删除和 OAuth 路径的排除规则。成对的 [`examples/link-lab`](../examples/link-lab) 证明缺失指南时得到 **96/100**，修复后得到 **100/100**，查询参数值不会进入证据。

发布元数据策略由项目显式启用，可以要求标题和描述处于审核过的长度范围、唯一绝对 canonical、响应式 viewport、有效文档语言、允许索引的 robots 指令，以及恰好一个主标题。检测证据只保存计数、长度、指令与 canonical 的来源/路径，不保存标题或描述正文，也不保留 canonical 查询参数和片段。成对的 [`examples/metadata-lab`](../examples/metadata-lab) 会让故障页得到七项可解释问题和 **75/100**，修复页得到 **100/100**。

视觉回归策略会捕获确定性的桌面全页快照，并与按 URL 路径命名的已批准 PNG 比较。`maxDiffRatio` 限制在逐通道 `pixelThreshold` 处理后发生变化的像素比例；最多 20 个声明式 CSS `masks` 可排除已经审核过的动态区域。缺少基线时门禁会明确失败并生成 `visual-current.png`。人工复核后，`visual-approve <report.json>` 会记录 PNG、SHA-256 摘要、来源运行和批准时间。若已存在不同基线，除非审核者显式添加 `--replace-baseline`，否则绝不会覆盖。出现回归时，报告会同时保留当前图、批准图和洋红差异图。[`examples/visual-regression-lab`](../examples/visual-regression-lab) 在时间戳被 mask 后稳定得到 **100/100**，当 **18.920%** 像素变化时得到 **96/100**。

基线批准与后续比较应使用一致的浏览器、操作系统和字体环境，通常放在同一 CI 镜像中。像素一致只能证明渲染稳定，不能证明获批设计本身可用或正确。只 mask 已知动态区域；不要为了通过门禁而 mask 原因不明的失败或提高阈值。

安全基线必须由项目显式配置，因此普通 localhost 不会自动被生产响应头要求误伤。策略可要求响应头，核查有限的 CSP 指令/来源标记类别，强制 HSTS max-age、子域和 preload 语义，要求精确的 `nosniff`，只允许经过复核的 Referrer-Policy 值，要求受控高风险 Permissions-Policy 功能使用空允许列表，并要求跨来源脚本与样式具有 SRI；还可禁止混合内容、阻止不安全密码表单、限制第三方来源数量，并只允许精确 HTTPS 来源。每个语义问题会把受控机器代码翻译成中英文解释和针对具体值的修复步骤，例如直接列出缺失的 CSP 指令或仍需设置为 `()` 的浏览器功能。SRI 证据只保留聚合数量、资源类型和来源，不保留资源路径、查询值、内容或完整性 hash；响应头语义证据也不保留原始值、允许来源、CSP nonce 或 hash。HTTP 文档即使返回 HSTS 也会失败，因为浏览器会忽略它。它们是项目发布规则，不是完整安全评估；实施 CSP、SRI 和功能限制前应在预发布环境验证行为。可复现的 [`examples/security-header-lab`](../examples/security-header-lab) 对照会得到四个值级问题和一个 SRI 缺失（80/100），修复对照达到 100/100，并证明夹具中的私有来源、资源路径、内容和 hash 没有进入证据。原有 [`examples/security-lab`](../examples/security-lab) 另外证明三个缺失响应头和一个 GET 密码表单问题，全程不提交表单。

浏览器存储聚合隐私预算同样由项目显式启用。它可以限制 Cookie 总数/UTF-8 字节、第三方 Cookie 数量，以及 localStorage/sessionStorage 的条目数和字节总量。报告只保留可用状态、数量、字节和阈值，绝不保留 Cookie 名称/值、Web Storage 键/值或浏览器异常正文；配置的存储面无法测量时会明确失败，不会把未知当作 0。成对的 [`examples/privacy-lab`](../examples/privacy-lab) 会让故障页产生六项针对性问题并得到 **76/100**，同时证明夹具标记没有泄漏到 `report.json`；相同预算下的修复页得到 **100/100**。这只是项目定义的存储预算，不是同意管理、追踪器分类、保留期限、数据流或法律合规证明；RealityCheck 也不会自动清除状态。

性能预算除导航、DOMContentLoaded、请求数、传输量和 DOM 数量外，现已覆盖 TTFB、首次内容绘制、最大内容绘制和累积布局偏移。需要登录的应用仍可通过 `--storage-state` 或 `REALITYCHECK_STORAGE_STATE` 加载 Playwright 登录状态；路径、Cookie、Token 和具体值都不会进入报告。

受治理的豁免可以处理企业里的已知欠账，但不会隐藏问题。每条豁免必须指定精确规则、原因和到期日，也可以限定负责人、选择器和路由。报告仍保留问题、截图、修复建议和豁免元数据，只在有效期内把它排除出评分与门禁；`doctor` 会阻止过期策略，SARIF 会写入外部抑制，JUnit 则保留证据但不让该场景失败。

发布策略不只是一条严重级别阈值。`qualityGate` 可以要求最低确定性评分、成功完成场景的最低比例，以及最多允许的有效豁免数。每一项失败条件都会写入 JSON、由 CLI 打印，并在单页报告中用中英文解释。严格对比和“只拦新增回归”的基线流程都会保留这些策略限制，不能借进入验证流程绕过。`policy.config.json` 夹具故意设置 `failOn: "never"`，但评分 **96/100** 仍低于要求的 **100**，因此门禁失败。

问题责任归属会把证据变成可落实的工作，又不会根据页面文案猜团队。`owners` 可同时匹配精确规则 ID 和路由 glob；只有一个匹配时，稳定团队 ID 与名称才会进入单页/全站报告、前后对比、修复计划和证据目录。若多个团队重叠匹配，问题会保持未分配并产生警告，避免把工作静默派错。它与豁免负责人不是一回事：问题归属回答“谁来处理”，豁免负责人记录“谁接受了临时例外”。

回归基线也可以过期。`baselinePolicy.maxAgeDays` 限制 `--baseline` 容忍已知欠账的有效期；`requireSamePolicy` 则防止删除自定义检查、改变预算、切换场景模式或检测器版本后，把“检测器变了”伪装成“问题修好了”。每次独立核查都会记录非敏感检测策略的 SHA-256 指纹。RealityCheck 仍会完整生成单页/全站验证，再写入 `baseline-age` 或 `policy-drift` 违规。该策略只约束回归门禁基线；显式 `--compare` 仍可用于历史分析。

合成的 [`examples/authenticated-app`](../examples/authenticated-app) 夹具端到端证明了这条边界：匿名运行因管理面板规则未满足而得到 96/100；同一页面加载仅限回环地址的合成状态后得到 100/100。CI 还会断言状态路径和合成值都没有进入 `report.json`。

成对的 [`examples/accessibility-lab`](../examples/accessibility-lab) 夹具用于验证 Quick 模式的保守基线规则。负例会产生 5 个实测问题：缺少语言、缺少标题、重复 ID、标题跳级和无名称图标控件，得分 **93/100**。Deep 模式还会运行内置 axe-core 4.12.1，核查 WCAG A/AA 与最佳实践，并把每条规则的证据限制为最多 5 个节点。这些检查扩大了覆盖，但不声称 WCAG 合规。

[`examples/waiver-lab`](../examples/waiver-lab) 可以直接演示治理效果。使用 `unwaived.config.json` 核查时，缺失的导出控件会得到 **96/100** 并触发 Major 门禁；改用 `realitycheck.config.json` 后，同一个问题仍完整显示，但命名豁免让结果变为 **100/100** 且门禁通过。报告会明确展示负责人、原因和到期日，不会假装缺陷已经消失。

多页面核查会额外生成 `site-report.json`、`site-report.md` 和双语 `site-report.html`。把旧的 `site-report.json` 传给 `--baseline`，即可容忍已知欠账，同时阻止全站范围内的新增、恶化或未验证回归。

## 默认场景

| 场景 | Quick | 核查目标 |
| --- | :---: | --- |
| Baseline | 是 | 运行时/资源问题、语义、自定义规则、核心体验/网络/链接/存储隐私预算和配置的安全策略 |
| 配置的响应式视口（默认 375×812） | 是 | 特定断点的离屏操作、固定宽度、横向溢出和严重触控目标损失 |
| 长文本 | 是 | 中文、emoji、无空格长串造成的新截断或恶化 |
| RTL 阿拉伯语 | 是 | 物理方向 CSS 和对齐假设 |
| 图片失败 | 是 | 替代文本缺失和媒体失败韧性 |
| 键盘 Tab | 是 | 不触发业务操作的焦点可达性与可见性 |
| 减少动态 | Deep | 用户请求减少动态后仍持续运行的非进度动画 |
| 深色模式 | Deep | 按计算前景色/背景色近似核查已声明深色主题的文字对比度 |
| 慢接口 | Deep | 有边界的同源请求延迟与恢复 |
| 接口错误 | Deep | 安全同源 GET 请求返回 503 后是否提供可见恢复反馈 |
| 空数据 | Deep | 安全 JSON 数组变为空后的空状态 |
| 200% 页面缩放 | Deep | 仅在适配器支持真实缩放时运行 |
| axe-core | Deep | 内置 WCAG A/AA 与最佳实践规则，每条最多保留 5 个证据节点 |

Quick 场景总数为“5 + 配置视口数”。每个视口都单独归因，而不是合并成模糊的“手机端问题”；场景仍会明确记录通过、发现问题、跳过、不支持或失败。

## 可操作报告

每次运行默认保存在目标仓库：

```text
.realitycheck/runs/<run-id>/
├── audit-input.json
├── report.json
├── report.md
├── report.html
├── report.sarif
├── report.junit.xml
├── repair-plan.json
├── repair-plan.md
├── evidence-manifest.json
└── screenshots/
```

输出根目录还会生成稳定的 `latest.json` 与双语 `latest.html` 入口。只有单页/全站报告以及用户要求的前后对比完整写出后，它们才会更新，并用可移植相对路径指向带时间戳的产物。历史运行不会被覆盖，而看板和书签也不用再猜运行 ID。门禁未通过但完整生成的核查会成为最新证据；中途失败的半成品不会。

`evidence-manifest.json` 会记录完整运行中的每个文件，包括可移植路径、字节数、媒体类型和 SHA-256 摘要。`realitycheck validate` 会重新计算摘要，因此报告或截图缺失、截断或后来被修改时都会失败，而不会继续伪装成原始证据。可选的 `attest` 命令会先复核整包完整性，再用 Ed25519 私钥签署清单；产物只包含公钥、稳定 `sha256:` 密钥 ID 和签名，不包含私钥。稳定 `latest` 入口只会在验签及配置的签名者授权都通过后挂载签名凭证。

签名有效只证明持有对应私钥，并不自动代表组织授权。企业归档应把 [`examples/evidence-trust.example.json`](../examples/evidence-trust.example.json) 复制为独立版本化的信任注册表，在其中维护可信/已撤销密钥和生效窗口，再生成可供人审阅的中英双语决策：

```bash
npm run realitycheck -- attest .realitycheck/runs/RUN/evidence-manifest.json \
  --private-key ci-ed25519.pem
npm run realitycheck -- validate .realitycheck/runs/RUN \
  --trust-policy evidence-trust.json
npm run realitycheck -- trust-report .realitycheck/runs/RUN/evidence-manifest.json \
  --trust-policy evidence-trust.json
```

`trust-report` 会分别判断文件完整性、Ed25519 签名和签名者授权；即使全部密钥被紧急撤销或签名文件损坏，也会保留带明确原因的 `REJECTED` 报告，而验证和签名命令继续 fail-closed。

执行前后对比后，还会增加 `verification.json`、中英双语 `verification.md`，以及可切换语言的独立 `verification.html` 看板。每次单页渲染还会输出通过 Schema 校验的 JSON 与 Markdown 修复交接清单，其中包含稳定指纹、证明场景、修复建议和验收条件。全站核查会生成站点看板；趋势聚合会生成 `trend.json`、`trend.md` 与双语 `trend.html`。产物目录可把这些结果汇总成一个可搜索、可筛选的双语入口，不依赖数据库或在线服务。

HTML 报告完全离线，可切换中文/英文，不加载远程资源。每个有效问题都有“复制修复并验证任务”按钮，任务会直接带上稳定规则 ID、证明场景和当前语言的具体修复建议；也可以先筛选问题、选择当前显示项，再一次复制带有同等上下文的批量修复计划。内嵌建议会规范空白、限制长度，并明确标为“待核实证据”，不能覆盖安全边界。这些操作只准备有边界的 Codex 任务，静态页面本身不会绕过授权直接修改源码。

可以查看仓库中的[可视化参考报告](../examples/reference-run/report.html)和 [Markdown 报告](../examples/reference-run/report.md)。它们用于演示渲染器与 CI 合同；判断其他应用前必须重新运行核查。

## 运行故障 Demo

零配置方式：

```bash
npm run demo
```

如果需要查看和编辑完整夹具源码，可显式启动服务并核查同一个稳定网址：

```bash
python -m http.server 4173 --bind 127.0.0.1 --directory examples/demo-broken
npm run audit -- http://127.0.0.1:4173 --fail-on never
```

两种 Demo 都故意包含固定宽度、手机端操作不可达、长文本截断、图片替代文本缺失、控制台错误和弱焦点样式；可编辑夹具还支持更深的空数据对照。默认 Quick 会运行六个真实浏览器场景；自定义矩阵会为每个审核过的视口增加独立场景、截图和修复交接产物。

[`examples/demo-fixed`](../examples/demo-fixed) 包含对应的应用层修复。CI 会让故障版和修正版使用同一个网址，分别执行全新的真实浏览器核查；只要旧问题仍能复现，或出现新增/未验证问题，流程就失败。v0.2 开发时的本地证明结果为：评分从 **69 提升到 100**，**7 个已解决、0 个仍存在、0 个新增、0 个未验证**。

### 运行 Deep 韧性实验室

先从仓库根目录启动静态服务，再核查成对夹具：

```bash
python -m http.server 4175 --bind 127.0.0.1 --directory .
npm run audit -- http://127.0.0.1:4175/examples/scenario-lab/broken.html --mode deep --fail-on never
npm run audit -- http://127.0.0.1:4175/examples/scenario-lab/fixed.html --mode deep --fail-on major
```

负例会稳定暴露持续动态、深色模式低对比度、缺少 503 恢复反馈、缺少空状态四类问题；正例修复同样四个条件。v0.3 本地实测结果为：故障版 **86/100、4 个问题**，修复版 **100/100、0 个问题**。

## 安全边界

- 默认只允许 localhost、回环地址和私网；公网必须明确确认授权。
- 核查不会点击购买、删除、发布、发送、登录、同意或提交动作。
- 报告会脱敏敏感字段、查询参数、Bearer Token 和类似 JWT 的文本。
- 网络压力只在独立上下文中作用于安全的同源请求。
- Audit 模式只读；只有明确的修复或加固请求才允许修改源码。
- 无云服务、无遥测、无隐藏模型调用、无隐藏浏览器下载。

只对你拥有或获准测试的应用使用 RealityCheck。

## CI 与底层工具

Python 报告工具不依赖第三方包。每次渲染都会同时输出 HTML、Markdown、JSON、SARIF 2.1.0 与 JUnit XML：

```bash
python realitycheck/scripts/report.py validate \
  .realitycheck/runs/<run-id>/report.json \
  --fail-on major

python realitycheck/scripts/report.py compare \
  .realitycheck/runs/<before>/report.json \
  .realitycheck/runs/<after>/report.json \
  --fail-on major

python realitycheck/scripts/report.py trend .realitycheck/runs \
  --output .realitycheck/trends

npm run realitycheck -- validate .realitycheck/runs

npm run realitycheck -- catalog .realitycheck/runs \
  --output .realitycheck/catalog

npm run realitycheck -- risk-register .realitycheck/runs \
  --output .realitycheck/risks \
  --max-open-age-days 30 \
  --max-open-risks 20 \
  --max-recurring-risks 10

npm run realitycheck -- policy-review \
  policy/main.config.json realitycheck.config.json \
  --output .realitycheck/policy-review

npm run realitycheck -- issue-drafts .realitycheck/runs \
  --output .realitycheck/issue-drafts

npm run realitycheck -- release-decision .realitycheck \
  --require audit,policy,trust,risk \
  --max-age-hours 24 \
  --output .realitycheck/release-decision
```

`validate` 会使用标准兼容的 JSON Schema 校验器，递归验证项目配置、报告、修复/验证产物、趋势、目录、最新入口、完整性清单、风险台账与策略审查。`catalog` 会先校验发现的每份源产物，明确警告并跳过不兼容旧文件，再生成可搜索的产物目录。`risk-register` 按精确目标与稳定指纹聚合页面问题，记录首次/最近出现时间和重复次数，再结合最新证明场景与可用策略指纹保守地区分开放、已豁免、已解决与未验证风险；场景缺失或策略漂移都会明确保持未验证。开放风险总数、最长开放天数和反复风险总数均可设为组合门禁，失败时仍保留全部 JSON、双语 HTML、Markdown 和防公式注入 CSV 证据。

`policy-review` 会先验证前后两份配置，再比较实际生效的结构化约束，并输出通过 Schema 校验的 JSON、英文/中文 Markdown 与可搜索双语 HTML。删除视口、检查或安全响应头，Deep 改 Quick，放宽性能/存储隐私/评分门禁，新增视觉 mask 或豁免等会归类为 `weakened`；证据写完后返回退出码 `1`。无法自动判断强弱的路由 glob、选择器或断点尺寸变化会归类为 `review`，不会强行猜测。产物只保存文件名、策略指纹、安全 ID/计数与有界解释，不保存 base URL、选择器、应用路由、豁免原因或本机路径。[`examples/policy-review-lab`](../examples/policy-review-lab) 提供 48 项变化的可运行示例。

`issue-drafts` 会把一份或多份已验证的 `repair-plan.json` 变成本地、复核优先的 GitHub 工单交接。它按稳定指纹去重，但保留每次运行/场景的证据链接；移除 URL 查询参数和片段，阻断意外 `@` 提及，把低置信度问题单独放入待复核，并继续明确展示已豁免证据。命令输出通过 Schema 校验的 JSON、中英文 Markdown、CSV 和带复制按钮的可搜索双语看板。它不会调用 GitHub，也不会自动创建工单。[`examples/issue-drafts-lab`](../examples/issue-drafts-lab) 提供由参考核查生成的六份真实草稿。

`release-decision` 会把最新有效的质量门禁、前后验证、策略审查、证据信任结果、风险台账与修复复核队列汇总为一份保守的发布审批包。`--require` 指定必须存在的控制，`--max-age-hours` 会拒绝过期的必需证据；每个所选来源都用 SHA-256 绑定，但不会把目标 URL、页面标题、问题正文、豁免理由或截图复制进决策。命令输出 JSON、中英文 Markdown 和交互式双语 HTML；退出码 `0` 表示可发布，`1` 表示不可发布，`3` 表示待人工复核，`2` 表示运行或证据错误。它只记录决策，绝不会部署或批准发布。[`examples/release-decision-lab`](../examples/release-decision-lab) 提供一份真实的三控制项“不可发布”决策包。

本仓库也可直接作为复合 GitHub Action 使用。Action 在打开浏览器前会先生成经过校验的中英双语有效核查计划，把它加入任务摘要与待上传证据；`audit-plan-path` 指向离线 HTML，`plan-exit-code` 会让无效预检在诊断证据保留后关闭门禁。随后 Action 执行页面/全站核查，可选地签署清单、评估信任、比较 `policy-before` 与 `policy-after`，自动生成绝不外发的工单草稿看板，再生成长期风险台账、发布决策与完整产物目录；所有证据会在计划、页面、策略、组合风险、信任或发布门禁生效前上传。Action 暴露 `issue-drafts-path`、`policy-review-path` / `policy-exit-code`，以及 `release-decision-path`、`release-decision` / `release-decision-exit-code`。通过 `release-required-controls` 和 `release-max-age-hours` 可以把缺失或过期证据变成“不可发布”；“待复核”会留给人处理，而不会伪装成工具故障。参考 [`examples/github-actions/quality-gate.yml`](../examples/github-actions/quality-gate.yml) 可建立只阻止新增回归的门禁。

项目目前仍以 Codex 为主要交互入口，但独立 CLI 和报告工具可以直接在克隆仓库中使用。路线图、贡献和安全说明见 [`ROADMAP.md`](../ROADMAP.md)、[`CONTRIBUTING.md`](../CONTRIBUTING.md) 与 [`SECURITY.md`](../SECURITY.md)。项目采用 [MIT License](../LICENSE)。
