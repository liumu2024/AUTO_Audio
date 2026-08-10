import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { summarizeFormalExecution } from '../src/evaluation-v2/formal-regression-summary.js'

const root = path.resolve(import.meta.dirname, '..')

const formalSummary = summarizeFormalExecution({
  commandResults: [
    { id: 'passing_smoke', ok: true, status: 0 },
    { id: 'failing_smoke', ok: false, status: 1, stderr: 'fixture failure' },
  ],
  turns: [{
    caseId: 'failing_turn', run: 1, turn: 2,
    deterministicPass: false, deterministicFailures: ['state mismatch'],
    judgePass: true, traceDir: 'trace/failing-turn',
  }],
  renderDetails: {
    scenarios: [
      { id: 'render_ok_1', ok: true, outputPath: 'render-1.mp4' },
      { id: 'render_failed', ok: false },
      { id: 'render_ok_2', ok: true, outputPath: 'render-2.mp4' },
      { id: 'corrupt_asset_failure', ok: true, expectedFailure: 'invalid input' },
    ],
  },
})
assert.deepEqual(formalSummary.renderDelivery, { successes: 2, total: 3, rate: 2 / 3 })
assert.equal(formalSummary.renderScenarioCount, 4)
assert.deepEqual(formalSummary.failures.map((failure) => failure.source), ['smoke', 'turn'])
assert.equal(formalSummary.failures[0]?.id, 'failing_smoke')
assert.equal(formalSummary.failures[1]?.id, 'failing_turn')

const missingRenderReport = summarizeFormalExecution({
  commandResults: [{ id: 'remotion_delivery', ok: true, status: 0 }],
  turns: [],
  renderDetails: null,
})
assert.equal(missingRenderReport.renderDelivery, null)
assert.equal(missingRenderReport.renderScenarioCount, 0)
assert.equal(missingRenderReport.failures[0]?.id, 'remotion_delivery')

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
  'active_draft_replanned_without_revision_base', 'timeline_fact_projection_omits_realization',
  'sample_semantic_segments_conflated_with_shots', 'render_readiness_ignores_saved_spec_resources',
  'director_followup_drops_attachment_group', 'custom_transition_visual_acceptance_missing_geometry_policy',
  'missing_generated_footage_degraded_to_text_cards',
  'restored_materials_conflicted_with_non_authoritative_ui_status',
  'fulfilled_material_job_without_resolved_output_passed_readiness',
  'promoted_component_visual_evidence_not_scoped_to_canvas_ratio',
  'material_planner_protocol_failure_degraded_to_ungrounded_slideshow',
  'restored_sample_leaked_across_workspaces',
  'legacy_component_policy_upgrade_broke_history',
  'obsolete_stateless_render_endpoint_bypassed_render_run_boundary',
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

const [appSource, frontendApiSource] = await Promise.all([
  readFile(path.join(root, 'src/app.ts'), 'utf8'),
  readFile(path.resolve(root, '../fonted/src/lib/api.ts'), 'utf8'),
])
assert.doesNotMatch(appSource, /['"]\/api\/v2\/timeline\/run['"]/, 'the obsolete stateless render route must stay removed')
assert.doesNotMatch(frontendApiSource, /\/api\/v2\/timeline\/run/, 'the frontend must use the persisted draft RenderRun')

const layers = new Set(['invariant', 'protocol', 'semantic'])
assert.ok(registry.rules.length >= 8, 'rule registry must list the review rules')
for (const rule of registry.rules) {
  assert.ok(layers.has(rule.layer), `unknown layer for ${rule.name}`)
  assert.ok(rule.reverseCase.trim(), `rule ${rule.name} must carry a reverse case`)
  assert.ok(rule.verification.trim(), `rule ${rule.name} must name its verification`)
}

console.log('V2 review development loop smoke passed (ledger + rule registry invariants).')
