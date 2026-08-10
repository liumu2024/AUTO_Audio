const words = {
    analyze: [
        '解析',
        '拆解',
        '分析样例',
        '理解样例',
        '识别结构',
        '样例视频',
        '分析视频',
        '分析这个视频',
        '解析视频',
        '解析这个视频',
        '视频结构',
        '创作手法',
    ],
    analyzeOnly: ['只解析', '先解析', '不要生成', '不生成', '不要出片', '不出片'],
    generate: ['生成', '成片', '做成', '开始做', '出片', '生成视频', '重新生成方案', '重写时间线方案'],
    render: ['渲染', '重新渲染', '导出', '输出mp4', '输出 MP4', 'render', 'export'],
    revise: ['修改', '调整', '改成', '换成', '改为', '不要', '去掉', '保留'],
    material: ['素材', '镜头', '片段', '上传', '候选素材'],
    landscape: ['风景', '风光', '旅拍', '混剪', '自然', '治愈', '山水', '海边', '日落'],
    music: ['音乐', '节拍', '卡点', 'bgm', '配乐', '律动', '鼓点'],
    product: ['产品', '广告', '营销', '卖点', '带货', '商品'],
    noSubtitle: ['不要字幕', '无字幕', '去掉字幕', '禁用字幕', '不加字幕', '不要花字'],
    keepSubtitle: ['保留字幕', '要字幕', '加字幕', '要花字'],
    rewriteSubtitle: ['重写字幕', '改字幕', '字幕文案'],
    styleReplicate: ['按样例风格', '样例风格', '学习样例', '复刻样例', '保持样例'],
    montage: ['混剪', 'montage'],
    beatSync: ['卡点', '节奏', '强拍', 'beat', '鼓点'],
    horizontal: ['横屏', '16:9', '16：9'],
    square: ['方形', '方屏', '1:1'],
    vertical: ['竖屏', '抖音', '快手', '9:16', '9：16'],
    strong: ['强一点', '夸张', '强烈', '炸裂', '更明显'],
    light: ['轻一点', '克制', '淡一点', '柔和', '细腻'],
};
const cleanWords = {
    generate: ['生成', '生成视频', '生成方案', '做一个', '做一条', '制作', '出片', '成片', '帮我做'],
    render: ['渲染', '导出', '输出mp4', '输出 MP4'],
    revise: ['修改', '调整', '改成', '换成', '不要', '去掉', '保留'],
    material: ['素材', '镜头', '片段', '上传', '图片', '视频'],
    analyze: ['解析', '分析样例', '理解样例', '分析视频', '视频结构', '创作手法'],
};
function includesAny(text, candidates) {
    const expanded = [
        ...candidates,
        ...(candidates === words.generate ? cleanWords.generate : []),
        ...(candidates === words.render ? cleanWords.render : []),
        ...(candidates === words.revise ? cleanWords.revise : []),
        ...(candidates === words.material ? cleanWords.material : []),
        ...(candidates === words.analyze ? cleanWords.analyze : []),
    ];
    return expanded.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}
export function createDefaultDirectorSlots(partial) {
    return {
        sampleVideoStatus: 'missing',
        materialStatus: 'missing',
        contentDomain: 'general',
        aspectRatio: '9:16',
        styleIntensity: 'medium',
        ...partial,
    };
}
export function mergeDirectorSlots(base, patch) {
    return {
        ...base,
        ...patch,
        pendingConfirmation: patch.pendingConfirmation ?? base.pendingConfirmation,
    };
}
export function deriveRuntimeSlotStatus(runtime) {
    const sampleVideoStatus = runtime.isSampleParsed
        ? 'parsed'
        : runtime.sampleUrl.trim()
            ? 'attached'
            : 'missing';
    const materialStatus = runtime.hasVisualMaterial
        ? runtime.materialCount > 0
            ? 'ready'
            : 'partial'
        : 'missing';
    return { sampleVideoStatus, materialStatus };
}
export function inferContentDomain(text) {
    const lower = text.toLowerCase();
    if (includesAny(text, words.product) || /product|marketing|ad\b/.test(lower)) {
        return 'product_marketing';
    }
    if (includesAny(text, words.landscape) || /landscape|scenic|travel/.test(lower)) {
        return 'landscape_montage';
    }
    if (includesAny(text, words.music) || /music video|mv\b|beat/.test(lower)) {
        return 'music_video';
    }
    return 'general';
}
export function isLandscapeLikeDomain(domain) {
    return domain === 'landscape_montage' || domain === 'music_video';
}
export function summarizeDirectorReference(understanding) {
    return {
        source: 'sample_video',
        summary: understanding.summary_zh,
        atmosphere: understanding.atmosphere_zh,
        editing: understanding.editing_zh,
        rhythm: understanding.rhythm_zh,
        reusableStyle: understanding.reusable_style_zh,
        segmentCount: understanding.segments.length,
        shotCount: (understanding.shot_evidence ?? []).filter((shot) => shot.confidence >= 0.6).length,
        warnings: understanding.warnings_zh,
    };
}
export function summarizeDirectorMaterial(material) {
    const durationSec = material.durationSec ?? (material.type === 'audio' ? 15 : material.type === 'image' ? 5 : 8);
    return {
        asset_id: material.id,
        source: 'user_material',
        type: material.type,
        usable_segments: [
            {
                start_sec: 0,
                end_sec: durationSec,
                quality_score: 0.6,
                recommended_usage: material.tags ?? [],
            },
        ],
        tags: material.tags ?? [],
        summary: `${material.name || material.id} 是可用于时间线编排的用户素材。`,
    };
}
//# sourceMappingURL=director-understanding.js.map