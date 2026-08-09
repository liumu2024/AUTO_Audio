import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const ledger = JSON.parse(await readFile(
  path.join(root, 'evals/v2-agent/review-regression-ledger.v1.json'),
  'utf8',
)) as {
  groups: Array<{
    rootCause: string
    turns: string[]
    fixType: string
    status: string
    verification: string
  }>
}
const registry = JSON.parse(await readFile(
  path.join(root, 'evals/v2-agent/review-rule-registry.v1.json'),
  'utf8',
)) as {
  rules: Array<{ name: string; layer: string; reverseCase: string; verification: string }>
}

const rootCauses = new Set([
  'backend_rule_too_strict', 'server_target_binding', 'dataset_expectation', 'eval_harness',
  'eval_exact_match', 'judge_rubric', 'recovery_semantics', 'model_reconfirm',
  'model_intent_no_patch', 'model_scope_choice', 'model_requirement_memory_mix',
  'model_memory_write', 'model_render_refusal', 'model_state_action_missing', 'retrieval_limit',
  'transition_target_protocol_and_unverified_reply',
])
const statuses = new Set(['fixed_this_round', 'needs_live_rerun', 'needs_real_media', 'deferred'])
assert.ok(ledger.groups.length >= 10, 'ledger must carry the live failure groups')
for (const group of ledger.groups) {
  assert.ok(rootCauses.has(group.rootCause), `unknown rootCause ${group.rootCause}`)
  assert.ok(statuses.has(group.status), `unknown status ${group.status}`)
  assert.ok(group.turns.length > 0 && group.verification.trim(), `group ${group.rootCause} incomplete`)
  if (group.status === 'fixed_this_round') {
    for (const name of group.verification.split(';')) {
      assert.ok(
        existsSync(path.join(root, 'scripts', `${name.trim()}.ts`)),
        `fixed group ${group.rootCause} verification smoke missing: ${name}`,
      )
    }
  }
}

const layers = new Set(['invariant', 'protocol', 'semantic'])
assert.ok(registry.rules.length >= 8, 'rule registry must list the review rules')
for (const rule of registry.rules) {
  assert.ok(layers.has(rule.layer), `unknown layer for ${rule.name}`)
  assert.ok(rule.reverseCase.trim(), `rule ${rule.name} must carry a reverse case`)
  assert.ok(rule.verification.trim(), `rule ${rule.name} must name its verification`)
}

console.log('V2 review development loop smoke passed (ledger + rule registry invariants).')
