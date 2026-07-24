import type { MaterialAnalysis } from '../types/material-analysis.js';
/** Metadata available before an optional provider-backed material analysis. */
export interface HeuristicAssetInput {
    id: string;
    type: 'video' | 'image' | 'audio' | 'VIDEO' | 'IMAGE' | 'AUDIO';
    name: string;
    url: string;
    tags?: string[];
    duration_sec?: number;
}
export declare function analyzeMaterialHeuristically(input: HeuristicAssetInput): MaterialAnalysis;
//# sourceMappingURL=material-analysis-heuristic.d.ts.map