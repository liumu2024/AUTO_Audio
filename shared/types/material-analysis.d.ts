export type MaterialAnalysisType = 'video' | 'image' | 'audio';
export type MaterialVisualTag = 'face' | 'product' | 'close_up' | 'wide_shot' | 'empty_scene' | 'screen_recording' | 'food' | 'lifestyle' | string;
export type MaterialEmotionTag = 'excited' | 'calm' | 'surprised' | 'urgent' | 'happy' | 'trustworthy' | string;
export interface MaterialSegment {
    id: string;
    material_id: string;
    start_sec: number;
    end_sec: number;
    tags: MaterialVisualTag[];
    emotion_tags?: MaterialEmotionTag[];
    shot_type?: 'close_up' | 'medium' | 'wide' | 'macro' | 'screen' | string;
    motion?: 'static' | 'push_in' | 'pan' | 'shake' | 'handheld' | string;
    transcript?: string;
    ocr_text?: string;
    score: number;
}
/** Protocol-neutral material facts used by V2 material selection and the editor. */
export interface MaterialAnalysis {
    schema_version: 'material_analysis.v1';
    material_id: string;
    type: MaterialAnalysisType;
    name: string;
    url: string;
    duration_sec?: number;
    tags: MaterialVisualTag[];
    segments: MaterialSegment[];
}
//# sourceMappingURL=material-analysis.d.ts.map