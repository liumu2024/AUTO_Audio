function normalizeType(type) {
    return type.toLowerCase();
}
function unique(items) {
    return [...new Set(items.filter(Boolean))];
}
function normalizedText(input) {
    return `${input.id} ${input.name} ${(input.tags ?? []).join(' ')} ${input.url}`.toLowerCase();
}
function inferVisualTags(input) {
    const text = normalizedText(input);
    const type = normalizeType(input.type);
    const tags = [...(input.tags ?? [])];
    if (type === 'audio')
        tags.push('bgm');
    if (type === 'image')
        tags.push('still_image');
    if (type === 'video')
        tags.push('broll');
    if (/face|talk|口播|人像|人物|达人|主播|采访/.test(text)) {
        tags.push('face', 'talking_head', 'close_up');
    }
    if (/product|goods|商品|产品|sku|logo|brand|品牌/.test(text)) {
        tags.push('product', 'close_up');
    }
    if (/food|餐|吃|面包|咖啡|饮品/.test(text))
        tags.push('food');
    if (/office|room|street|scene|空镜|办公室|街景|环境/.test(text)) {
        tags.push('empty_scene', 'wide_shot', 'lifestyle');
    }
    if (/screen|录屏|教程|界面|app|ui/.test(text)) {
        tags.push('screen_recording');
    }
    if (/hook|开头|爆点|痛点/.test(text))
        tags.push('hook');
    if (/demo|展示|演示|使用/.test(text))
        tags.push('demo');
    if (/cta|购买|下单|转化/.test(text))
        tags.push('cta');
    return unique(tags);
}
function inferEmotionTags(input) {
    const text = normalizedText(input);
    const tags = [];
    if (/urgent|fast|hit|冲刺|紧迫|限时|秒杀/.test(text))
        tags.push('urgent');
    if (/happy|smile|开心|快乐|治愈/.test(text))
        tags.push('happy');
    if (/surprise|wow|惊喜|反常识/.test(text))
        tags.push('surprised');
    if (/trust|proof|专业|可信|测评/.test(text))
        tags.push('trustworthy');
    if (/calm|slow|舒缓|安静/.test(text))
        tags.push('calm');
    if (/upbeat|excited|热血|高能/.test(text))
        tags.push('excited');
    return unique(tags);
}
function defaultDuration(input) {
    if (input.duration_sec && input.duration_sec > 0)
        return input.duration_sec;
    const type = normalizeType(input.type);
    if (type === 'image')
        return 5;
    if (type === 'audio')
        return 15;
    return 8;
}
function segmentScore(tags, emotionTags) {
    let score = 0.52;
    if (tags.includes('face'))
        score += 0.12;
    if (tags.includes('product'))
        score += 0.14;
    if (tags.includes('close_up'))
        score += 0.08;
    if (tags.includes('hook'))
        score += 0.08;
    if (emotionTags.includes('excited') || emotionTags.includes('urgent')) {
        score += 0.08;
    }
    return Math.min(0.96, Math.round(score * 100) / 100);
}
function makeSegment(input, index, start, end, tags, emotionTags) {
    const hasCloseup = tags.includes('close_up') || tags.includes('product');
    const isScreen = tags.includes('screen_recording');
    return {
        id: `${input.id}_seg_${index + 1}`,
        asset_id: input.id,
        start_sec: start,
        end_sec: end,
        tags,
        emotion_tags: emotionTags,
        shot_type: isScreen ? 'screen' : hasCloseup ? 'close_up' : 'wide',
        motion: tags.includes('hook') ? 'push_in' : 'static',
        score: segmentScore(tags, emotionTags),
    };
}
export function analyzeAssetHeuristically(input) {
    const type = normalizeType(input.type);
    const duration = defaultDuration(input);
    const tags = inferVisualTags(input);
    const emotionTags = inferEmotionTags(input);
    const segments = [];
    if (type === 'video') {
        const firstEnd = Math.min(duration, Math.max(2.5, duration * 0.38));
        segments.push(makeSegment(input, 0, 0, firstEnd, tags, emotionTags));
        if (duration > firstEnd + 1) {
            const midTags = unique([
                ...tags.filter((tag) => tag !== 'hook'),
                tags.includes('product') ? 'demo' : 'broll',
            ]);
            segments.push(makeSegment(input, 1, firstEnd, duration, midTags, emotionTags.filter((tag) => tag !== 'urgent')));
        }
    }
    else {
        segments.push(makeSegment(input, 0, 0, duration, tags, emotionTags));
    }
    return {
        version: '1.0',
        asset_id: input.id,
        type,
        name: input.name,
        url: input.url,
        duration_sec: duration,
        tags,
        segments,
    };
}
//# sourceMappingURL=asset-analysis-heuristic.js.map