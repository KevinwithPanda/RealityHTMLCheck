# RealityCheck policy change review

Gate: **FAILED** · 38 weakened · 0 strengthened · 2 review

- Before: `before.config.json` (`sha256:8fa3136aff605f5b98e5ef5e0b1dac43d336203c8ffc4c3c4cb58cdcd4865841`)
- After: `after-weakened.config.json` (`sha256:9ffecba4dc3e0b0a2869fd2e0b3ca94bb0e9dc4fad3fbd837c61ce7339e594a1`)

## Changes

| Class | Category | Change | Why it matters |
| --- | --- | --- | --- |
| weakened | baseline-governance | **POLICY-F83223BCEA** Baseline maximum age changed from 30 to 90 | The new numeric limit allows more risk than before. |
| weakened | baseline-governance | **POLICY-61E57210E5** Same-policy baseline requirement was disabled | A previously enforced protection is no longer required. |
| weakened | checks | **POLICY-0E96512F8B** Declarative check release-action-visible was removed | A previously declared requirement is no longer covered. |
| weakened | coverage | **POLICY-869AFDE03E** Safe crawl was disabled | A previously enforced protection is no longer required. |
| weakened | coverage | **POLICY-F300D0250A** Crawl depth changed from 2 to 1 | The new numeric limit allows more risk than before. |
| weakened | coverage | **POLICY-495F65944C** Crawl page limit changed from 20 to 10 | The new numeric limit allows more risk than before. |
| weakened | coverage | **POLICY-A6D8A45661** Scenario mode changed from deep to quick | Quick mode removes Deep-only proving scenarios. |
| weakened | exceptions | **POLICY-02D03521A9** Governed waiver temporary-release-action was added | A new exception can suppress otherwise active release evidence. |
| weakened | links | **POLICY-A2FF61C4FA** Checked-link cap changed from 50 to 10 | The new numeric limit allows more risk than before. |
| weakened | links | **POLICY-12820F96AA** Allowed broken links changed from 0 to 3 | The new numeric limit allows more risk than before. |
| weakened | links | **POLICY-913C716E51** Link finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| weakened | metadata | **POLICY-C1FEAF9C48** Metadata rule forbidNoindex was disabled | A previously enforced protection is no longer required. |
| weakened | metadata | **POLICY-96F36B56D8** Metadata rule requireCanonical was disabled | A previously enforced protection is no longer required. |
| weakened | metadata | **POLICY-68615A65A8** Metadata rule requireLang was disabled | A previously enforced protection is no longer required. |
| weakened | metadata | **POLICY-F2E879608D** Metadata rule requireSingleH1 was disabled | A previously enforced protection is no longer required. |
| weakened | metadata | **POLICY-8579F356F2** Metadata finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| weakened | network | **POLICY-6FE4D1252B** Network limit maxFailedRequests changed from 0 to 1 | The new numeric limit allows more risk than before. |
| weakened | network | **POLICY-1DE89D585C** Network limit maxHttpErrors changed from 0 to 2 | The new numeric limit allows more risk than before. |
| weakened | network | **POLICY-3543261F0E** Network scope changed from all to api | Only API-like requests remain governed. |
| weakened | network | **POLICY-FED886BDB6** Network finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| weakened | performance | **POLICY-DDD6491ED4** Performance limit cumulativeLayoutShift changed from 0.1 to 0.25 | The new numeric limit allows more risk than before. |
| weakened | performance | **POLICY-7EF09AF1B7** Performance limit largestContentfulPaintMs changed from 2500 to 4000 | The new numeric limit allows more risk than before. |
| weakened | performance | **POLICY-AD6FEA01A9** Performance finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| weakened | release-gate | **POLICY-39219F7AC8** Failure threshold changed from major to critical | The new severity setting is less likely to block risky evidence. |
| weakened | release-gate | **POLICY-C7D60F42E2** Maximum active waivers changed from 0 to 5 | The new numeric limit allows more risk than before. |
| weakened | release-gate | **POLICY-1C952E808C** Minimum coverage changed from 95 to 70 | The new numeric limit allows more risk than before. |
| weakened | release-gate | **POLICY-BB2902CDF7** Minimum score changed from 95 to 80 | The new numeric limit allows more risk than before. |
| weakened | responsive | **POLICY-0ADBDEBFD9** Responsive checkpoint phone-320 was removed | A previously reviewed breakpoint will no longer run or produce evidence. |
| weakened | responsive | **POLICY-C961735E07** phone-390 touch-target checks was disabled | A previously enforced protection is no longer required. |
| weakened | security | **POLICY-9E6089AE69** Security rule forbidMixedContent was disabled | A previously enforced protection is no longer required. |
| weakened | security | **POLICY-4EFE700AF9** Third-party origin limit changed from 2 to 5 | The new numeric limit allows more risk than before. |
| weakened | security | **POLICY-F43655C5DD** Required security headers changed | The new set permits or checks less than before. |
| weakened | security | **POLICY-00E8B95C00** Security rule secureForms was disabled | A previously enforced protection is no longer required. |
| weakened | security | **POLICY-6CD1456FEC** Security finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| weakened | visual | **POLICY-A282D046BB** Visual masks changed | The new set permits or checks less than before. |
| weakened | visual | **POLICY-5C99BAF986** Visual changed-pixel ratio changed from 0.002 to 0.02 | The new numeric limit allows more risk than before. |
| weakened | visual | **POLICY-ECC55399F4** Visual channel threshold changed from 28 to 40 | The new numeric limit allows more risk than before. |
| weakened | visual | **POLICY-A6731E70ED** Visual finding severity changed from major to minor | The new severity setting is less likely to block risky evidence. |
| review | coverage | **POLICY-295CDB8938** Crawl route scope changed | Route globs can overlap, so scope changes require human review and are reported without copying application paths. |
| review | responsive | **POLICY-84109B458A** Responsive checkpoint tablet-768 changed dimensions | A different breakpoint is not inherently stronger or weaker; confirm it represents supported traffic and devices. |

> Policy classification is conservative and structural; route-glob, selector, device-market, legal, and product intent still require human review.
