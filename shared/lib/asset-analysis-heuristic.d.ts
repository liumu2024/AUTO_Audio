import type { AssetAnalysisV1 } from '../types/asset-analysis.v1.js';
export interface HeuristicAssetInput {
    id: string;
    type: 'video' | 'image' | 'audio' | 'VIDEO' | 'IMAGE' | 'AUDIO';
    name: string;
    url: string;
    tags?: string[];
    duration_sec?: number;
}
export declare function analyzeAssetHeuristically(input: HeuristicAssetInput): AssetAnalysisV1;
//# sourceMappingURL=asset-analysis-heuristic.d.ts.map