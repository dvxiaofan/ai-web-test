# Phase 6 测试用例记录（安全自愈 + 长期运营）

> 配套代码：`src/healing/`（安全自愈）、`src/history/`（长期运营）
> 关联方案：`AI测试工具最终合并执行方案-codex.md` · Phase 6

## 状态图例

| 标记 | 含义 |
| ---- | ---- |
| ✅ PASS | 用例通过 |
| ❌ FAIL | 用例失败 |
| ⏭ SKIP | 用例被跳过 |

## 运行信息

- 运行命令：`npx vitest run tests/healing tests/history`
- 运行环境：vitest v3.2.7 / macOS（darwin）
- 运行时间：2026-07-28 10:43:51
- 结果：**Test Files 6 passed (6) · Tests 50 passed (50)**

## 汇总（按文件）

| 测试文件 | 套件数 | 用例数 | 结果 |
| -------- | -----: | -----: | ---- |
| `tests/healing/classifier.test.ts` | 2 | 13 | ✅ PASS |
| `tests/healing/semantic-diff.test.ts` | 1 | 12 | ✅ PASS |
| `tests/healing/policy.test.ts` | 2 | 7 | ✅ PASS |
| `tests/healing/assertion-guard.test.ts` | 1 | 7 | ✅ PASS |
| `tests/history/trends.test.ts` | 3 | 6 | ✅ PASS |
| `tests/history/retention.test.ts` | 1 | 5 | ✅ PASS |
| **合计** | **10** | **50** | **✅ 50/50 PASS** |

## 详细用例清单

### 1. `tests/healing/classifier.test.ts`（确定性失败分类，13 例）

**`classifyFailure`**
- ✅ PASS · returns undefined for passed scenarios
- ✅ PASS · classifies cleanup failures with top priority even when other markers exist
- ✅ PASS · classifies browser infrastructure failures
- ✅ PASS · classifies authentication failures from HTTP 401 evidence
- ✅ PASS · classifies permission failures from HTTP 403 evidence
- ✅ PASS · classifies navigation failures when the failing step is navigate
- ✅ PASS · classifies locator failures from resolution errors
- ✅ PASS · classifies assertion failures from failed assert steps
- ✅ PASS · classifies api failures from 5xx responses
- ✅ PASS · classifies test-data failures from record markers
- ✅ PASS · falls back to environment with low confidence
- ✅ PASS · attaches runtime evidence referencing the failure

**`classifyRunFailures`**
- ✅ PASS · classifies only failed scenarios

### 2. `tests/healing/semantic-diff.test.ts`（场景语义 Diff，12 例）

**`diffScenarios`**
- ✅ PASS · reports identical scenarios as having no changes
- ✅ PASS · flags removed assertions as assertion-removed (not step-removed)
- ✅ PASS · flags weakened comparators as assertion-weakened
- ✅ PASS · flags dropped expected values as assertion-weakened
- ✅ PASS · flags changed expected values as assertion-changed (approval, not forbidden)
- ✅ PASS · classifies same-host URL changes as url-path-updated and cross-host as host-expanded
- ✅ PASS · classifies testId locator updates as test-id-updated
- ✅ PASS · classifies same-role name changes as accessible-name-updated
- ✅ PASS · detects wait adjustments
- ✅ PASS · detects role changes, risk increases and skip flags
- ✅ PASS · detects removed cleanup steps as cleanup-removed
- ✅ PASS · detects guard removal and test-data strategy changes

### 3. `tests/healing/policy.test.ts`（自动修复白名单，7 例）

**`verdictForChange`**
- ✅ PASS · whitelists equivalent-intent maintenance
- ✅ PASS · requires approval for meaning-shifting changes
- ✅ PASS · forbids weakening changes

**`evaluateHealingChanges`**
- ✅ PASS · auto-applies when all changes are whitelisted
- ✅ PASS · the worst verdict wins: one forbidden change forbids the whole set
- ✅ PASS · requires approval when the set contains approval-level changes but nothing forbidden
- ✅ PASS · treats an empty change set as auto-apply (no-op)

### 4. `tests/healing/assertion-guard.test.ts`（断言防护 / 可审计回滚，7 例）

**`assertion guard — AI cannot go green by weakening tests`**
- ✅ PASS · rejects proposals that delete assertions, keeping the original scenario active
- ✅ PASS · rejects proposals that weaken assertions or add skip
- ✅ PASS · rejected proposals cannot be approved afterwards
- ✅ PASS · auto-applies equivalent locator updates and keeps a rollback path
- ✅ PASS · routes meaning-shifting changes through manual approval
- ✅ PASS · supports explicit rejection with an audit note
- ✅ PASS · honours requireApproval even for whitelisted changes

### 5. `tests/history/trends.test.ts`（历史趋势，6 例）

**`toTrendPoint`**
- ✅ PASS · computes pass rate and aggregates failure categories
- ✅ PASS · handles zero executed scenarios without dividing by zero

**`buildTrendReport`**
- ✅ PASS · sorts points by startedAt and computes deltas against the previous run
- ✅ PASS · omits delta with fewer than two runs

**`findFlakyScenarios`**
- ✅ PASS · flags scenarios with mixed pass/fail outcomes inside the window
- ✅ PASS · respects the window: old outcomes outside the window are ignored

### 6. `tests/history/retention.test.ts`（Artifact 保留策略，5 例）

**`applyRetentionPolicy`**
- ✅ PASS · keeps the newest maxRuns and removes the rest
- ✅ PASS · removes runs older than maxAgeDays
- ✅ PASS · never removes pinned runs
- ✅ PASS · dry run reports removals without deleting anything
- ✅ PASS · returns an empty report when no runs exist

## 全仓回归对照

- 全量运行（`npx vitest run`）：**Test Files 70 passed | 1 skipped (71) · Tests 357 passed | 2 skipped (359)**
- 跳过项：`tests/e2e/sample-app.test.ts`（2 例，e2e 样例，按配置 skip，非失败）

## 关键验收点（对应方案 13.6）

1. ✅ 删断言 / 弱断言 / 加 skip → `forbidden` 拒绝（`assertion-guard.test.ts` 覆盖）
2. ✅ 每个提案含 classification（证据）+ 语义 Diff + 策略裁决
3. ✅ 可审批、可回滚、可追踪（rejected 留痕，不可二次审批）
4. ✅ 分类与裁决纯确定性（同输入恒等输出）
5. ✅ `buildTrendReport` 对比历史覆盖率与失败趋势
6. ✅ `applyRetentionPolicy` 按策略自动清理（maxRuns / maxAgeDays / pinned / dryRun）
