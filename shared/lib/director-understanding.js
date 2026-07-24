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
function hasAnalyzeOnly(text) {
    return includesAny(text, words.analyzeOnly);
}
function asksToReanalyzeSample(text) {
    return /重新理解|重新解析|重新分析|再次理解|再次解析|再分析.*(样例|视频)|再看.*(样例|视频)/.test(text);
}
function asksToAnalyzeSample(text) {
    return (includesAny(text, words.analyze) ||
        /分析.*(样例|视频|主要内容|创作手法|视频结构|镜头|转场|节奏)/.test(text) ||
        /(这个|这个样例|这个视频).*(分析|解析|理解|拆解|看一下|看下)/.test(text));
}
function hasCurrentV2Timeline(runtime) {
    return Boolean(runtime.hasV2Timeline);
}
function isQualityFeedback(text) {
    return /没用到|没有用到|没用完|没有用完|太简单|看不到|不清楚|不满意|不符合|不对|不好|很差/.test(text);
}
function asksForConcreteRevision(text) {
    return /按.*重排|重新生成|生成一版|重排|改成|修改为|调整为|换成|用上|补上|增加|减少|渲染|导出/.test(text);
}
function asksOpenQuestion(text) {
    return /为什么|怎么|如何|是什么|是否|是不是|能否|可以吗|讲讲|解释|说明|区别|关系/.test(text);
}
function hasExecutionWording(text) {
    return /帮我|请|直接|现在|开始|按|用|重新|继续|生成一版|生成方案|渲染吧|导出吧|解析这个|分析这个|修改为|调整为|改成|换成/.test(text);
}
export function createDefaultDirectorSlots(partial) {
    return {
        sampleVideoStatus: 'missing',
        materialStatus: 'missing',
        contentDomain: 'general',
        aspectRatio: '9:16',
        styleIntensity: 'medium',
        generationMode: 'style_replicate',
        subtitlePolicy: 'keep',
        audioPolicy: 'keep_sample_bgm',
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
export function parseDirectorIntent(text) {
    const rawText = text.trim();
    const lower = rawText.toLowerCase();
    let goal = 'analyze_sample';
    if (hasAnalyzeOnly(rawText) || asksToAnalyzeSample(rawText)) {
        goal = 'analyze_sample';
    }
    else if (includesAny(rawText, words.render)) {
        goal = 'render';
    }
    else if (includesAny(rawText, words.generate) || /\bgenerate\b|\bmake\b/.test(lower)) {
        goal = 'generate_timeline';
    }
    else if (includesAny(rawText, words.revise) || /\brevise\b|\bchange\b|\badjust\b/.test(lower)) {
        goal = 'revise_timeline';
    }
    else if (includesAny(rawText, words.material)) {
        goal = 'analyze_materials';
    }
    const aspectRatio = includesAny(rawText, words.horizontal) ||
        rawText.includes('16:9') ||
        lower.includes('youtube')
        ? '16:9'
        : includesAny(rawText, words.square) || rawText.includes('1:1')
            ? '1:1'
            : includesAny(rawText, words.vertical) ||
                rawText.includes('9:16') ||
                lower.includes('shorts') ||
                lower.includes('vertical')
                ? '9:16'
                : undefined;
    const durationMatch = rawText.match(/(\d{1,3})\s*(秒|s|sec|seconds)/i);
    const durationSec = durationMatch ? Number(durationMatch[1]) : undefined;
    const styleIntensity = includesAny(rawText, words.strong) || lower.includes('strong')
        ? 'strong'
        : includesAny(rawText, words.light) || lower.includes('light')
            ? 'light'
            : undefined;
    return {
        goal,
        aspectRatio,
        durationSec,
        styleIntensity,
        requestedStyle: rawText || undefined,
        constraints: [],
        rawText,
    };
}
export function parseDirectorSlotsFromText(text) {
    const rawText = text.trim();
    const lower = rawText.toLowerCase();
    const patch = {};
    const parsed = parseDirectorIntent(rawText);
    if (parsed.aspectRatio)
        patch.aspectRatio = parsed.aspectRatio;
    if (parsed.durationSec)
        patch.durationSec = parsed.durationSec;
    if (parsed.styleIntensity)
        patch.styleIntensity = parsed.styleIntensity;
    const domain = inferContentDomain(rawText);
    if (domain !== 'general')
        patch.contentDomain = domain;
    if (includesAny(rawText, words.noSubtitle)) {
        patch.subtitlePolicy = 'none';
    }
    else if (includesAny(rawText, words.rewriteSubtitle)) {
        patch.subtitlePolicy = 'rewrite';
    }
    else if (includesAny(rawText, words.keepSubtitle)) {
        patch.subtitlePolicy = 'keep';
    }
    if (includesAny(rawText, words.beatSync)) {
        patch.generationMode = 'beat_sync';
    }
    else if (includesAny(rawText, words.montage)) {
        patch.generationMode = 'montage';
    }
    else if (includesAny(rawText, words.styleReplicate)) {
        patch.generationMode = 'style_replicate';
    }
    if (/静音|不要音乐|无配乐|mute/.test(rawText) || lower.includes('mute')) {
        patch.audioPolicy = 'mute';
    }
    else if (/用户音频|自己的音乐|替换音乐|user audio/.test(rawText)) {
        patch.audioPolicy = 'user_audio';
    }
    return patch;
}
function classifyConversationIntent(text, slots) {
    const raw = text.trim();
    const lower = raw.toLowerCase();
    if (!raw) {
        return slots.sampleVideoStatus === 'parsed'
            ? { intent: 'clarify', confidence: 0.45 }
            : { intent: 'analyze_sample', confidence: 0.7 };
    }
    if (/先修改当前时间线方案，再重新渲染|修改后渲染/.test(raw)) {
        return { intent: 'render', confidence: 0.95 };
    }
    if (/重新生成方案|重排时间线/.test(raw)) {
        return { intent: 'generate_timeline', confidence: 0.94 };
    }
    if (hasAnalyzeOnly(raw) || asksToAnalyzeSample(raw)) {
        return { intent: 'analyze_sample', confidence: hasAnalyzeOnly(raw) ? 0.96 : 0.9 };
    }
    if (asksOpenQuestion(raw) && !hasExecutionWording(raw)) {
        return { intent: 'clarify', confidence: 0.74 };
    }
    if (includesAny(raw, words.render))
        return { intent: 'render', confidence: 0.92 };
    if (includesAny(raw, words.generate) || /\bgenerate\b|\bmake\b/.test(lower)) {
        return { intent: 'generate_timeline', confidence: 0.88 };
    }
    if (includesAny(raw, words.material))
        return { intent: 'analyze_materials', confidence: 0.8 };
    if (includesAny(raw, words.revise) || /\brevise\b|\bchange\b|\badjust\b/.test(lower)) {
        return { intent: 'revise_timeline', confidence: 0.78 };
    }
    const slotsPatch = parseDirectorSlotsFromText(raw);
    if (Object.keys(slotsPatch).length > 0)
        return { intent: 'revise_timeline', confidence: 0.7 };
    return { intent: 'unknown', confidence: 0.35 };
}
function goalFromConversationIntent(intent) {
    if (intent === 'render')
        return 'render';
    if (intent === 'generate_timeline')
        return 'generate_timeline';
    if (intent === 'revise_timeline')
        return 'revise_timeline';
    if (intent === 'analyze_materials')
        return 'analyze_materials';
    return 'analyze_sample';
}
function buildRevisionAckMessage(slots) {
    const subtitle = slots.subtitlePolicy === 'none'
        ? '不加字幕'
        : slots.subtitlePolicy === 'rewrite'
            ? '重写字幕'
            : '保留字幕策略';
    const mode = slots.generationMode === 'beat_sync'
        ? '节拍卡点'
        : slots.generationMode === 'montage'
            ? '混剪编排'
            : slots.generationMode === 'custom'
                ? '自定义生成'
                : '按样例风格复刻';
    return `我先按你的偏好记下来了：画幅 ${slots.aspectRatio}，${mode}，${subtitle}，风格强度 ${slots.styleIntensity}。后面要继续出方案，直接告诉我“生成一版方案”就行。`;
}
export function routeDirectorConversation(input) {
    const runtimeSlots = deriveRuntimeSlotStatus(input.runtime);
    const slotsPatchFromText = parseDirectorSlotsFromText(input.prompt);
    const mergedSlots = mergeDirectorSlots(mergeDirectorSlots(input.slots, runtimeSlots), slotsPatchFromText);
    const signal = classifyConversationIntent(input.prompt, mergedSlots);
    const contentDomain = slotsPatchFromText.contentDomain ??
        mergedSlots.contentDomain ??
        inferContentDomain(input.prompt);
    const slotsPatch = { ...slotsPatchFromText, ...runtimeSlots, contentDomain };
    if (!input.runtime.backendEnabled) {
        return {
            intent: signal.intent,
            confidence: 1,
            contentDomain,
            slotsPatch,
            missingSlots: ['backend'],
            requiresConfirmation: false,
            nextAction: 'NEED_BACKEND',
            assistantMessage: '现在执行端还没准备好，所以我暂时不能真正解析或渲染。不过你可以先把想法说给我，我可以先帮你梳理风格和流程。',
        };
    }
    const wantsOutput = signal.intent === 'generate_timeline' || signal.intent === 'render';
    if (signal.intent === 'render' && hasCurrentV2Timeline(input.runtime)) {
        return {
            intent: 'render',
            confidence: Math.max(signal.confidence, 0.9),
            contentDomain,
            slotsPatch,
            missingSlots: [],
            requiresConfirmation: false,
            nextAction: 'RENDER',
            assistantMessage: '好，我按右侧这版时间线直接渲染，不重新生成方案。',
        };
    }
    if (mergedSlots.sampleVideoStatus === 'missing' &&
        signal.intent === 'analyze_sample') {
        return {
            intent: 'analyze_sample',
            confidence: Math.max(signal.confidence, 0.75),
            contentDomain,
            slotsPatch,
            missingSlots: ['sampleVideoStatus'],
            requiresConfirmation: false,
            nextAction: 'NEED_SAMPLE',
            assistantMessage: '要开始拆样例的话，还需要先给我一条参考视频。你也可以先不上传，继续和我聊风格、结构或生成思路。',
        };
    }
    if (signal.intent === 'analyze_sample' &&
        (mergedSlots.sampleVideoStatus !== 'parsed' || asksToReanalyzeSample(input.prompt))) {
        return {
            intent: 'analyze_sample',
            confidence: Math.max(signal.confidence, 0.85),
            contentDomain,
            slotsPatch,
            missingSlots: [],
            requiresConfirmation: false,
            nextAction: 'ANALYZE_SAMPLE',
            assistantMessage: '好，我先看这条样例，把它的段落结构、节奏变化和可借鉴的镜头方式拆出来；这一步只做理解，不会直接出片。',
        };
    }
    if (signal.intent === 'render' && !hasCurrentV2Timeline(input.runtime)) {
        return {
            intent: 'render',
            confidence: Math.max(signal.confidence, 0.82),
            contentDomain,
            slotsPatch,
            missingSlots: ['v2Timeline'],
            requiresConfirmation: false,
            nextAction: 'ASK_USER',
            assistantMessage: '现在还没有可以直接渲染的时间线方案。你可以先让我按文字和素材生成一版方案；确认分镜、素材和字幕后，我再渲染成 MP4。',
        };
    }
    if (wantsOutput) {
        const missingSlots = [];
        if (signal.intent === 'render' && !hasCurrentV2Timeline(input.runtime)) {
            missingSlots.push('v2Timeline');
        }
        if (missingSlots.length) {
            return {
                intent: signal.intent,
                confidence: signal.confidence,
                contentDomain,
                slotsPatch,
                missingSlots,
                requiresConfirmation: false,
                nextAction: 'ASK_USER',
                assistantMessage: '现在还没有可渲染的 V2 时间线方案。你可以先按文字、可选样例参考或可用素材生成一版方案，再让我渲染。',
            };
        }
        return {
            intent: signal.intent,
            confidence: Math.max(signal.confidence, 0.82),
            contentDomain,
            slotsPatch,
            missingSlots: [],
            requiresConfirmation: false,
            nextAction: signal.intent === 'render' ? 'RENDER' : 'GENERATE_TIMELINE',
            assistantMessage: signal.intent === 'render'
                ? '好，我按当前方案去渲染一版。渲染时你可以继续看右侧方案，等输出回来我们再一起挑问题。'
                : '我先把你的创作意图整理成一版可编辑时间线；会结合可选样例参考和可用素材，右侧会展示分段和画面安排，确认后再渲染成 MP4。',
        };
    }
    if (isQualityFeedback(input.prompt) && !asksForConcreteRevision(input.prompt)) {
        return {
            intent: 'clarify',
            confidence: 0.82,
            contentDomain,
            slotsPatch,
            missingSlots: [],
            requiresConfirmation: false,
            nextAction: 'ACKNOWLEDGE',
            assistantMessage: '这个反馈我记下了，我先不直接覆盖右侧现有方案。问题更像是素材覆盖和分镜说明不够清楚：如果你要我重排，可以直接说“按这个问题重排一版”，也可以指定哪些图片必须出现、希望保留几段。',
        };
    }
    if (signal.intent === 'revise_timeline' || Object.keys(slotsPatchFromText).length > 0) {
        return {
            intent: 'revise_timeline',
            confidence: Math.max(signal.confidence, 0.72),
            contentDomain,
            slotsPatch,
            missingSlots: [],
            requiresConfirmation: false,
            nextAction: 'REVISE_TIMELINE',
            assistantMessage: buildRevisionAckMessage(mergedSlots),
        };
    }
    return {
        intent: signal.intent === 'unknown' ? 'clarify' : signal.intent,
        confidence: signal.confidence,
        contentDomain,
        slotsPatch,
        missingSlots: ['userIntent'],
        requiresConfirmation: signal.confidence < 0.55,
        nextAction: signal.confidence < 0.55 ? 'ASK_USER' : 'ACKNOWLEDGE',
        assistantMessage: mergedSlots.sampleVideoStatus === 'parsed'
            ? '样例我已经理解过了。你可以继续问这条样例的节奏、镜头和风格，也可以直接按文字生成方案，或补充素材后再生成。'
            : '可以，我们先聊也行。你可以描述想做的风格、用途和时长；准备好后可直接按文字生成，也可选上传样例或素材。',
    };
}
export function directorIntentToUserIntent(result, current, prompt) {
    const parsed = parseDirectorIntent(prompt);
    return {
        ...current,
        goal: goalFromConversationIntent(result.intent),
        aspectRatio: result.slotsPatch.aspectRatio ?? parsed.aspectRatio ?? current.aspectRatio,
        durationSec: result.slotsPatch.durationSec ?? parsed.durationSec ?? current.durationSec,
        styleIntensity: result.slotsPatch.styleIntensity ?? parsed.styleIntensity ?? current.styleIntensity,
        requestedStyle: prompt.trim() || current.requestedStyle,
        rawText: prompt.trim() || current.rawText,
        constraints: result.slotsPatch.subtitlePolicy === 'none'
            ? [...(current.constraints ?? []), 'no_subtitle']
            : current.constraints,
    };
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