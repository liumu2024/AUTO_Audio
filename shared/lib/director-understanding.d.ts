import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { UserMaterialDto } from '../types/pipeline.js';
import type { DirectorContentDomain, DirectorContextSlots, DirectorIntentResult, DirectorUserIntent, MaterialAnalysis, SampleStyleRecipe } from '../types/director-context.js';
import type { TemplateSchemaV1 } from '../types/template-schema.v1.js';
export interface DirectorConversationRuntime {
    backendEnabled: boolean;
    sampleUrl: string;
    sampleName?: string;
    isSampleParsed: boolean;
    hasPipeline: boolean;
    activeTaskId?: string | null;
    hasVisualMaterial: boolean;
    materialCount: number;
}
export declare function createDefaultDirectorSlots(partial?: Partial<DirectorContextSlots>): DirectorContextSlots;
export declare function mergeDirectorSlots(base: DirectorContextSlots, patch: Partial<DirectorContextSlots>): DirectorContextSlots;
export declare function deriveRuntimeSlotStatus(runtime: DirectorConversationRuntime): Pick<DirectorContextSlots, 'sampleVideoStatus' | 'materialStatus'>;
export declare function inferContentDomain(text: string): DirectorContentDomain;
export declare function isLandscapeLikeDomain(domain: DirectorContentDomain): boolean;
export declare function parseDirectorIntent(text: string): DirectorUserIntent;
export declare function parseDirectorSlotsFromText(text: string): Partial<DirectorContextSlots>;
export declare function routeDirectorConversation(input: {
    prompt: string;
    slots: DirectorContextSlots;
    runtime: DirectorConversationRuntime;
}): DirectorIntentResult;
export declare function directorIntentToUserIntent(result: DirectorIntentResult, current: DirectorUserIntent, prompt: string): DirectorUserIntent;
export declare function buildSampleStyleRecipe(template: TemplateSchemaV1 | undefined): SampleStyleRecipe;
export declare function buildSampleStyleRecipeFromMigration(structure: MigrationProtocolV12 | undefined): SampleStyleRecipe;
export declare function buildMaterialAnalysis(material: UserMaterialDto): MaterialAnalysis;
//# sourceMappingURL=director-understanding.d.ts.map