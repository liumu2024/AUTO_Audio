# 审查开发回路制度

目标：让“审查规则反复改、仍老有遗漏或后端拒绝导致无改动”变成可追溯、可归因、可回归的流程，而不是靠手感。

## 1. 失败必须登记（失败语料台账）

每次 live 评测、真实交互或 smoke 失败，必须在 `backend/evals/v2-agent/review-regression-ledger.v1.json` 登记一条（或归入已有根因组），字段：

- `turns`：caseId + turn 列表；
- `rootCause`：枚举——`backend_rule_too_strict` / `server_target_binding` / `model_intent` / `model_scope_choice` / `model_requirement_memory_mix` / `model_memory_write` / `model_render_refusal` / `dataset_expectation` / `eval_exact_match` / `eval_harness` / `judge_rubric` / `recovery_semantics` / `retrieval_limit`；
- `fixType`：`rule_relaxed` / `server_binding` / `prompt` / `dataset` / `eval_semantic` / `eval_harness` / `judge_rubric` / `known_limit`；
- `status`：`fixed_this_round`（有确定性验证） / `needs_live_rerun`（只有 live 能证明） / `needs_real_media` / `deferred`；
- `verification`：验证入口（smoke 名或 live）。

## 2. 根因分类先于修复

同一失败先回答“是谁的问题”：后端规则太严 / 服务端绑定缺失 / 模型行为 / 数据集期望 / 评测口径 / judge 口径 / 已知能力上限。分类决定修在哪一层，禁止跳过分类直接加规则。

## 3. 规则分层三问

新增或修改任何审查，先回答：

1. 这是**不变量**（修订不可变、越界字段丢弃、零差异、授权、系统字段）？→ 必须硬，fail-closed。
2. 这是**协议**（工具参数形状、scope/sceneId 合法性）？→ 输入宽松：只拦会破坏状态或越权的输入，允许模型自然表达；目标解析放服务端。
3. 这是**语义**（改得对不对、回复是否切题、要求是否保留）？→ 交给 LLM judge 或语义匹配，禁止写成 if/正则。

## 4. 反向用例要求

每一条协议/语义规则，必须同时带一个“模型可能怎么自然表达却被误拒”的反向用例，并落进对应 smoke。没有反向用例的规则不允许合入。

## 5. 拒绝必须可归因

后端工具拒绝必须携带 `gate`（`registry_arguments` / `dispatcher_target` / `dispatcher_scope` / `revision_commit` / `spec_validation` / `readiness` / `idempotency` / `dependency` / `registry`），写入 trace 的 tool 结果，前端/评测据此区分“规则问题 vs 模型问题”。

## 6. 变更流程

1. 从台账取失败轮次 → 分类根因；
2. 按分层原则修改（规则放宽 / 服务端绑定 / prompt / 数据集 / 评测语义 / judge）；
3. 更新台账（fixType、status、verification）；
4. 跑 `smoke-v2-review-development-loop`（校验台账与规则台账一致）+ 受影响 smoke + 正式回归；
5. 需要模型行为的修复标记 `needs_live_rerun`，由下一次 live 基线确认后置为 fixed。

## 7. 强制校验

`npm.cmd run test:smoke:v2:review-development-loop` 校验：台账/规则台账结构合法；`fixed_this_round` 的 verification 引用的 smoke 文件存在；规则台账每条都有分层与反向用例。
