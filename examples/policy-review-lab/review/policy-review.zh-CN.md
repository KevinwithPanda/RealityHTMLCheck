# RealityCheck 策略变更审查

门禁：**失败** · 弱化 46 · 加强 0 · 待复核 2

- 之前: `before.config.json` (`sha256:092c5d2a7b43924665a25e64f0a894382d97499aa33da449c6b2374dde8f2e31`)
- 之后: `after-weakened.config.json` (`sha256:5fabc9a80e26bc85e44a3c8347b7a95c49f85b7f2b704e5dd52f524d40cb7d2a`)

## 变更

| 分类 | 类别 | 变更 | 原因 |
| --- | --- | --- | --- |
| weakened | baseline-governance | **POLICY-F83223BCEA** 基线最大期限从 30 调整为 90 | 新的数值限制比以前允许更多风险。 |
| weakened | baseline-governance | **POLICY-61E57210E5** 同策略基线要求已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | checks | **POLICY-0E96512F8B** 移除声明式检查 release-action-visible | 原先声明的要求现在不再覆盖。 |
| weakened | coverage | **POLICY-869AFDE03E** 安全爬取已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | coverage | **POLICY-F300D0250A** 爬取深度从 2 调整为 1 | 新的数值限制比以前允许更多风险。 |
| weakened | coverage | **POLICY-495F65944C** 爬取页面上限从 20 调整为 10 | 新的数值限制比以前允许更多风险。 |
| weakened | coverage | **POLICY-A6D8A45661** 场景模式从 deep 调整为 quick | Quick 模式会移除仅 Deep 提供的证明场景。 |
| weakened | exceptions | **POLICY-02D03521A9** 新增受治理豁免 temporary-release-action | 新增例外可能排除原本有效的发布证据。 |
| weakened | links | **POLICY-A2FF61C4FA** 链接核查上限从 50 调整为 10 | 新的数值限制比以前允许更多风险。 |
| weakened | links | **POLICY-12820F96AA** 允许失效链接数从 0 调整为 3 | 新的数值限制比以前允许更多风险。 |
| weakened | links | **POLICY-913C716E51** 链接问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | metadata | **POLICY-C1FEAF9C48** 元数据规则 forbidNoindex已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | metadata | **POLICY-96F36B56D8** 元数据规则 requireCanonical已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | metadata | **POLICY-68615A65A8** 元数据规则 requireLang已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | metadata | **POLICY-F2E879608D** 元数据规则 requireSingleH1已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | metadata | **POLICY-8579F356F2** 元数据问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | network | **POLICY-6FE4D1252B** 网络限制 maxFailedRequests从 0 调整为 1 | 新的数值限制比以前允许更多风险。 |
| weakened | network | **POLICY-1DE89D585C** 网络限制 maxHttpErrors从 0 调整为 2 | 新的数值限制比以前允许更多风险。 |
| weakened | network | **POLICY-3543261F0E** 网络范围从 all 调整为 api | 现在仅治理类似 API 的请求。 |
| weakened | network | **POLICY-FED886BDB6** 网络问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | performance | **POLICY-DDD6491ED4** 性能限制 cumulativeLayoutShift从 0.1 调整为 0.25 | 新的数值限制比以前允许更多风险。 |
| weakened | performance | **POLICY-7EF09AF1B7** 性能限制 largestContentfulPaintMs从 2500 调整为 4000 | 新的数值限制比以前允许更多风险。 |
| weakened | performance | **POLICY-AD6FEA01A9** 性能问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | privacy | **POLICY-739DCE6669** 隐私预算 maxCookieBytes从 4096 调整为 16384 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-6208653C16** 隐私预算 maxCookies从 10 调整为 30 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-B9B4469D42** 隐私预算 maxLocalStorageBytes从 131072 调整为 524288 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-13AB57BD68** 隐私预算 maxLocalStorageEntries从 20 调整为 80 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-5E6F3C9887** 隐私预算 maxSessionStorageBytes从 65536 调整为 262144 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-56C262AD6E** 隐私预算 maxSessionStorageEntries从 20 调整为 50 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-A252F754FC** 隐私预算 maxThirdPartyCookies从 0 调整为 8 | 新的数值限制比以前允许更多风险。 |
| weakened | privacy | **POLICY-BE61BE4A82** 隐私问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | release-gate | **POLICY-39219F7AC8** 失败阈值从 major 调整为 critical | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | release-gate | **POLICY-C7D60F42E2** 最大有效豁免数从 0 调整为 5 | 新的数值限制比以前允许更多风险。 |
| weakened | release-gate | **POLICY-1C952E808C** 最低覆盖率从 95 调整为 70 | 新的数值限制比以前允许更多风险。 |
| weakened | release-gate | **POLICY-BB2902CDF7** 最低评分从 95 调整为 80 | 新的数值限制比以前允许更多风险。 |
| weakened | responsive | **POLICY-0ADBDEBFD9** 移除响应式核查点 phone-320 | 原先审核过的断点将不再运行或生成证据。 |
| weakened | responsive | **POLICY-C961735E07** phone-390 触控目标检查已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | security | **POLICY-9E6089AE69** 安全规则 forbidMixedContent已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | security | **POLICY-4EFE700AF9** 第三方来源上限从 2 调整为 5 | 新的数值限制比以前允许更多风险。 |
| weakened | security | **POLICY-F43655C5DD** 必需安全响应头已变更 | 新集合比以前允许更多或检查更少。 |
| weakened | security | **POLICY-00E8B95C00** 安全规则 secureForms已停用 | 原先强制执行的保护现在不再要求。 |
| weakened | security | **POLICY-6CD1456FEC** 安全问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| weakened | visual | **POLICY-A282D046BB** 视觉 mask已变更 | 新集合比以前允许更多或检查更少。 |
| weakened | visual | **POLICY-5C99BAF986** 视觉变化像素比例从 0.002 调整为 0.02 | 新的数值限制比以前允许更多风险。 |
| weakened | visual | **POLICY-ECC55399F4** 视觉通道阈值从 28 调整为 40 | 新的数值限制比以前允许更多风险。 |
| weakened | visual | **POLICY-A6731E70ED** 视觉问题严重级别从 major 调整为 minor | 新的严重级别设置更不容易阻止风险证据。 |
| review | coverage | **POLICY-295CDB8938** 爬取路由范围已变更 | 路由 glob 可能重叠，因此范围变化需要人工复核，且不会复制应用路径。 |
| review | responsive | **POLICY-84109B458A** 响应式核查点 tablet-768 更改尺寸 | 不同断点并不天然更强或更弱；请确认它代表受支持的流量与设备。 |

> 策略分类是保守的结构化判断；路由 glob、选择器、设备市场、法律与产品意图仍需人工复核。
