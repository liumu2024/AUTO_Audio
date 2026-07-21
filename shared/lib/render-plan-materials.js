function isProductOrMarketingPrompt(prompt) {
    const lower = prompt.toLowerCase();
    return (lower.includes('product') ||
        lower.includes('ad') ||
        lower.includes('marketing') ||
        prompt.includes('产品') ||
        prompt.includes('广告') ||
        prompt.includes('营销') ||
        prompt.includes('卖点'));
}
function isVisualMontagePrompt(prompt, visualAssetCount) {
    const lower = prompt.toLowerCase();
    const explicitMontage = lower.includes('landscape') ||
        lower.includes('montage') ||
        prompt.includes('风景') ||
        prompt.includes('混剪') ||
        prompt.includes('风光') ||
        prompt.includes('剪辑');
    return explicitMontage || (visualAssetCount > 0 && !isProductOrMarketingPrompt(prompt));
}
/** 将用户素材绑定进 RenderPlan（不触发渲染） */
export function injectMaterialsIntoRenderPlan(input) {
    const prompt = input.prompt ?? '';
    const visualAssets = input.assets.filter((asset) => asset.type !== 'audio');
    const audioAsset = input.assets.find((asset) => asset.type === 'audio');
    if (!visualAssets.length)
        return input.plan;
    const isVisualMontage = isVisualMontagePrompt(prompt, visualAssets.length);
    const existingNonUserAssets = input.plan.assets.filter((asset) => asset.source !== 'user_material' ||
        !input.assets.some((next) => next.id === asset.id));
    const trimCursors = new Map();
    const backingAudioAsset = audioAsset ?? input.plan.assets.find((asset) => asset.id === 'sample_reference_audio');
    return {
        ...input.plan,
        strategy: visualAssets.length >= 2 ? 'montage' : input.plan.strategy,
        assets: [...existingNonUserAssets, ...input.assets],
        scenes: input.plan.scenes.map((scene, index) => {
            const asset = visualAssets[index % visualAssets.length];
            const sceneDuration = Math.max(0.5, scene.end_sec - scene.start_sec);
            const trimStart = trimCursors.get(asset.id) ?? 0;
            trimCursors.set(asset.id, trimStart + sceneDuration);
            return {
                ...scene,
                visual: {
                    ...scene.visual,
                    mode: asset.type === 'image' ? 'image_motion' : 'material_clip',
                    asset_id: asset.id,
                    material_source: 'user_material',
                    trim: asset.type === 'video'
                        ? { start_sec: trimStart, end_sec: trimStart + sceneDuration }
                        : undefined,
                    fit: 'cover',
                    motion: scene.visual.motion ??
                        {
                            preset: index % 2 === 0 ? 'push_in' : 'pan',
                            intensity: isVisualMontage ? 0.16 : 0.3,
                        },
                    visual_prompt: scene.visual.visual_prompt,
                },
                audio: audioAsset
                    ? [
                        {
                            id: `audio_${scene.id}`,
                            type: 'bgm',
                            start_sec: scene.start_sec,
                            end_sec: scene.end_sec,
                            asset_id: audioAsset.id,
                            emotion_vibe: isVisualMontage ? 'cinematic_calm' : scene.intent.emotion_vibe,
                            sfx_type: 'none',
                            volume: 0.72,
                            ducking: false,
                        },
                    ]
                    : scene.audio.length
                        ? scene.audio
                        : backingAudioAsset
                            ? [
                                {
                                    id: `bgm_${scene.source_anchor_id}`,
                                    type: 'bgm',
                                    start_sec: scene.start_sec,
                                    end_sec: scene.end_sec,
                                    asset_id: backingAudioAsset.id,
                                    emotion_vibe: scene.intent.emotion_vibe,
                                    sfx_type: 'none',
                                    volume: 1,
                                    ducking: false,
                                },
                            ]
                            : scene.audio,
            };
        }),
    };
}
//# sourceMappingURL=render-plan-materials.js.map