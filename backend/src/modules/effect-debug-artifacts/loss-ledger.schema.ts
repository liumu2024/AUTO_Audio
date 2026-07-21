import { z } from 'zod'

import { EFFECT_LOSS_LEDGER_SEVERITIES } from '../../../../shared/types/effect-roadmap.v1.js'

export const EffectLossLedgerEntrySchema = z.object({
  id: z.string().min(1),
  source_stage: z.string().min(1),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string()).default([]),
  fallback_used: z.string().nullable().default(null),
  severity: z.enum(EFFECT_LOSS_LEDGER_SEVERITIES),
})

export const EffectLossLedgerSchema = z.array(EffectLossLedgerEntrySchema)
