import type { CapabilityLayerKind } from './capability-registry.v1.js'

export const COMPOSITION_RECIPE_SCHEMA_VERSION = 'composition_recipe.v1' as const

export interface CompositionRecipeLayerSpec {
  layer: CapabilityLayerKind | string
  provides: string
  optional?: boolean
}

export interface CompositionRecipe {
  recipe_id: string
  intent_id: string
  label: string
  required_layers: CompositionRecipeLayerSpec[]
  optional_layers: CompositionRecipeLayerSpec[]
  validation: string[]
  /** Hard grammar that must never be approximated (e.g. triangle → rectangle). */
  forbidden_fallbacks?: string[]
}
