function anchorEvidenceText(anchor) {
    return [
        anchor.logic_intent.marketing_role,
        anchor.logic_intent.emotion_vibe,
        anchor.replication_instructions.visual_generation_prompt,
        anchor.replication_instructions.overlay_rewrite_instruction,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}
function localAudioTiming(recipe, anchor) {
    const audio = recipe?.audio_driver;
    const start = anchor.start_sec;
    const end = anchor.end_sec;
    const localize = (time) => Number((time - start).toFixed(3));
    return {
        beats: (audio?.beat_times ?? [])
            .filter((time) => time >= start && time < end)
            .map(localize),
        strongBeats: (audio?.strong_beats ?? [])
            .filter((time) => time >= start && time < end)
            .map(localize),
        energyPeaks: (audio?.energy_peaks ?? [])
            .filter((peak) => peak.time >= start && peak.time < end)
            .map((peak) => ({ ...peak, time: localize(peak.time) })),
    };
}
function clampPercent(value) {
    return Math.max(4, Math.min(116, Number(value.toFixed(2))));
}
function scenicCueFromText(text) {
    if (/red|sunset|rose|夕阳|日落|红/.test(text))
        return { label: '红', color: '#ef4444' };
    if (/green|grass|forest|meadow|草|森林|绿/.test(text))
        return { label: '绿', color: '#22c55e' };
    if (/blue|sea|lake|water|sky|ocean|海|湖|蓝/.test(text))
        return { label: '蓝', color: '#38bdf8' };
    if (/snow|ice|white|雪|冰|白/.test(text))
        return { label: '白', color: '#e5e7eb' };
    if (/yellow|gold|warm|金|黄/.test(text))
        return { label: '黄', color: '#facc15' };
    return { label: '色', color: '#22d3ee' };
}
function timedPoint(time, x_pct, y_pct, easing, hold) {
    return {
        time: Number(time.toFixed(3)),
        x_pct: clampPercent(x_pct),
        y_pct: clampPercent(y_pct),
        ...(easing ? { easing: easing } : {}),
        ...(hold ? { hold: true } : {}),
    };
}
export function normalizePrimitiveEffectForAnchor(effect, anchor) {
    if (!effect)
        return undefined;
    const duration = Math.max(0.2, anchor.end_sec - anchor.start_sec);
    const record = effect;
    if (effect.preset === 'primitive_mask_reveal') {
        const portalShape = typeof record.portal_shape === 'string' ? record.portal_shape : undefined;
        return {
            ...effect,
            mask: {
                ...effect.mask,
                shape: portalShape === 'square' ? 'rectangle' : effect.mask.shape,
                radius_pct_keyframes: [
                    { time: 0, value: portalShape === 'square' ? 8 : 10 },
                    { time: Number((duration * 0.42).toFixed(3)), value: 34 },
                    { time: Number(duration.toFixed(3)), value: 120 },
                ],
                position_keyframes: [
                    { time: 0, x_pct: 50, y_pct: 50 },
                    { time: Number(duration.toFixed(3)), x_pct: 50, y_pct: 50 },
                ],
            },
        };
    }
    if (effect.preset === 'primitive_ripple_displacement') {
        const durationSec = Math.min(duration, 1.2);
        return {
            ...effect,
            ripple: {
                ...effect.ripple,
                origin: { x_pct: 50, y_pct: 50 },
                start_sec: 0,
                duration_sec: durationSec,
                radius_pct_keyframes: [
                    { time: 0, value: 0 },
                    { time: Number((durationSec * 0.35).toFixed(3)), value: 28 },
                    { time: Number((durationSec * 0.72).toFixed(3)), value: 82 },
                    { time: Number(durationSec.toFixed(3)), value: 122 },
                ],
            },
        };
    }
    if (effect.preset === 'primitive_texture_grade') {
        const vignetteStrength = typeof record.vignette_strength === 'number' ? record.vignette_strength : undefined;
        const grainAmount = typeof record.grain === 'number' ? record.grain : undefined;
        return {
            ...effect,
            color_grade: effect.color_grade ?? {
                saturate: 1.16,
                contrast: 1.1,
                brightness: 0.96,
            },
            ...(vignetteStrength !== undefined
                ? {
                    vignette_strength: vignetteStrength,
                }
                : {}),
            ...(grainAmount !== undefined ? { grain: grainAmount } : {}),
        };
    }
    return effect;
}
export function detailPrimitiveOrbMotion(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const text = anchorEvidenceText(anchor);
    const timing = localAudioTiming(recipe, anchor);
    const isOpen = /open|intro|start|opening|cinematic_open/.test(text);
    const isPeak = /peak|outro|final|payoff|closing|burst|color_peak/.test(text);
    const isAccent = /accent|beat|fast|energy/.test(text);
    const isContinuous = /continuous|always.?moving|nonstop|rapid|fast.?move|quick.?jump|moving.?orb|moving.?ball|一直|持续|快速|小球|光球/.test(text);
    const entryTime = Math.min(duration * 0.28, isOpen ? 0.72 : 0.44);
    const firstBeat = timing.strongBeats[0] ?? timing.beats[0];
    const holdTime = Math.min(duration * 0.42, firstBeat !== undefined ? Math.max(entryTime + 0.08, firstBeat) : entryTime + (isOpen ? 0.28 : 0.14));
    const pointPalette = isAccent
        ? [
            { x: 20, y: 28 },
            { x: 72, y: 26 },
            { x: 30, y: 72 },
            { x: 84, y: 55 },
        ]
        : isPeak
            ? [
                { x: 50, y: 48 },
                { x: 50, y: 48 },
            ]
            : [
                { x: 28, y: 34 },
                { x: 70, y: 42 },
                { x: 42, y: 66 },
            ];
    const path = isContinuous
        ? [
            timedPoint(0, 50, isOpen ? 108 : 92, 'ease-out'),
            ...pointPalette.concat(pointPalette.slice(0, 2)).map((point, index, points) => timedPoint(Math.min(duration - 0.04, entryTime + (index * Math.max(0.18, duration - entryTime)) / Math.max(1, points.length - 1)), point.x, point.y, index % 2 === 0 ? 'ease-in-out' : 'linear')),
            timedPoint(duration, pointPalette.at(-1)?.x ?? 54, pointPalette.at(-1)?.y ?? 48, 'ease-in-out'),
        ]
        : [
            timedPoint(0, 50, isOpen ? 108 : 92, 'ease-out'),
            timedPoint(entryTime, pointPalette[0]?.x ?? 50, pointPalette[0]?.y ?? 48, 'ease-out'),
            timedPoint(holdTime, pointPalette[0]?.x ?? 50, pointPalette[0]?.y ?? 48, undefined, true),
            ...pointPalette.slice(1).map((point, index) => timedPoint(Math.min(duration - 0.08, holdTime + (index + 1) * (duration - holdTime) * 0.28), point.x, point.y, 'ease-in-out')),
            timedPoint(duration, pointPalette.at(-1)?.x ?? 54, pointPalette.at(-1)?.y ?? 48, 'ease-in-out'),
        ];
    return {
        ...effect,
        orb: {
            ...effect.orb,
            radius_pct: isPeak ? 4.2 : isAccent ? 3.8 : effect.orb.radius_pct,
            glow_px: isPeak ? 44 : isAccent ? 38 : 34,
            trail_enabled: true,
            trail_decay: isAccent ? 0.66 : 0.72,
            path_keyframes: path,
        },
    };
}
export function detailPrimitiveDirectionalWaveReveal(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const text = anchorEvidenceText(anchor);
    const timing = localAudioTiming(recipe, anchor);
    const isOpen = /open|intro|start|opening|cinematic_open/.test(text);
    const isPeak = /peak|outro|final|payoff|closing|burst|color_peak/.test(text);
    const isAccent = /accent|beat|fast|energy/.test(text);
    const wantsPersistentColor = /unlock|full.?color|color.?release|accumulate|hold|burst|铺满|全彩|解锁|完全|释放/.test(text);
    const entryTime = Math.min(duration * 0.28, isOpen ? 0.72 : 0.44);
    const triggerSeeds = [
        ...timing.strongBeats,
        ...timing.energyPeaks.map((peak) => peak.time),
        ...timing.beats.filter((_, index) => index % (isAccent ? 1 : 2) === 0),
    ]
        .filter((time) => time > entryTime + 0.08 && time < duration - 0.06)
        .filter((time, index, all) => all.findIndex((item) => Math.abs(item - time) < 0.12) === index);
    const fallbackTriggers = isPeak
        ? [Math.max(0.18, duration * 0.28)]
        : isAccent
            ? [duration * 0.28, duration * 0.52, duration * 0.76]
            : [duration * 0.34, duration * 0.62];
    const triggerTimes = (triggerSeeds.length ? triggerSeeds : fallbackTriggers)
        .slice(0, isAccent ? 4 : 3)
        .map((time) => Math.min(duration - 0.08, Math.max(entryTime + 0.08, time)));
    const pointPalette = isAccent
        ? [
            { x: 20, y: 28 },
            { x: 72, y: 26 },
            { x: 30, y: 72 },
        ]
        : isPeak
            ? [{ x: 50, y: 48 }]
            : [
                { x: 28, y: 34 },
                { x: 70, y: 42 },
            ];
    const revealEvents = triggerTimes.map((triggerTime, index) => {
        const point = pointPalette[index % pointPalette.length] ?? { x: 50, y: 48 };
        return {
            id: `reveal_${String(index + 1).padStart(3, '0')}`,
            trigger_time: Number(triggerTime.toFixed(3)),
            origin: { x_pct: point.x, y_pct: point.y },
            direction_from_motion: true,
            duration_sec: isPeak ? 0.52 : isAccent ? 0.36 : 0.42,
            wave_count: isPeak ? 7 : isAccent ? 5 : 4,
            wave_spacing_pct: isPeak ? 7 : 6,
            wave_width_pct: isPeak ? 5 : 4,
            propagation_speed_pct_per_sec: isPeak ? 330 : isAccent ? 250 : 210,
            color_unlock: isPeak ? 1 : isAccent ? 0.82 : 0.58,
            hold_after: wantsPersistentColor && index === triggerTimes.length - 1,
        };
    });
    return {
        ...effect,
        color_layer: {
            saturate: 1.35,
            contrast: 1.08,
            brightness: 1,
            ...(effect.color_layer ?? {}),
            accumulate: wantsPersistentColor || effect.color_layer?.accumulate,
        },
        reveal_events: revealEvents.length ? revealEvents : effect.reveal_events,
    };
}
export function detailPrimitiveMaskReveal(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const record = effect;
    if (effect.lens_style === 'crystal' || effect.reveal_asset_id || effect.next_asset_id) {
        const startRadius = typeof record.start_radius_pct === 'number' ? record.start_radius_pct : 4;
        const midRadius = typeof record.mid_radius_pct === 'number' ? record.mid_radius_pct : 34;
        const endRadius = typeof record.end_radius_pct === 'number' ? record.end_radius_pct : 130;
        const xPct = typeof record.x_pct === 'number' ? record.x_pct : 50;
        const yPct = typeof record.y_pct === 'number' ? record.y_pct : 50;
        return {
            ...effect,
            lens_style: 'crystal',
            mask: {
                ...effect.mask,
                shape: 'circle',
                radius_pct_keyframes: effect.mask.radius_pct_keyframes?.length
                    ? effect.mask.radius_pct_keyframes
                    : [
                        { time: 0, value: startRadius },
                        { time: Number((duration * 0.55).toFixed(3)), value: midRadius },
                        { time: Number(duration.toFixed(3)), value: endRadius },
                    ],
                position_keyframes: effect.mask.position_keyframes?.length
                    ? effect.mask.position_keyframes
                    : [
                        { time: 0, x_pct: xPct, y_pct: yPct },
                        { time: Number(duration.toFixed(3)), x_pct: xPct, y_pct: yPct },
                    ],
                beat_reactive_scale: false,
            },
        };
    }
    const timing = localAudioTiming(recipe, anchor);
    const firstBeat = timing.strongBeats[0] ?? timing.beats[0] ?? duration * 0.38;
    return {
        ...effect,
        mask: {
            ...effect.mask,
            radius_pct_keyframes: [
                { time: 0, value: 8 },
                { time: Number(Math.min(duration * 0.34, firstBeat).toFixed(3)), value: 18 },
                { time: Number(Math.min(duration * 0.72, firstBeat + 0.46).toFixed(3)), value: 44 },
                { time: Number(duration.toFixed(3)), value: 118 },
            ],
            position_keyframes: [
                { time: 0, x_pct: 50, y_pct: 108 },
                { time: Number(Math.min(duration * 0.32, 0.72).toFixed(3)), x_pct: 50, y_pct: 50 },
                { time: Number(duration.toFixed(3)), x_pct: 54, y_pct: 48 },
            ],
            beat_reactive_scale: true,
        },
    };
}
export function detailPrimitiveRippleDisplacement(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const timing = localAudioTiming(recipe, anchor);
    const start = Math.min(duration * 0.28, timing.strongBeats[0] ?? timing.beats[0] ?? 0.22);
    const rippleDuration = Math.min(duration - start, Math.max(0.36, duration * 0.58));
    return {
        ...effect,
        ripple: {
            ...effect.ripple,
            start_sec: Number(start.toFixed(3)),
            duration_sec: Number(Math.max(0.22, rippleDuration).toFixed(3)),
            radius_pct_keyframes: [
                { time: 0, value: 0 },
                { time: Number(start.toFixed(3)), value: 0 },
                { time: Number((start + rippleDuration * 0.28).toFixed(3)), value: 28 },
                { time: Number((start + rippleDuration * 0.68).toFixed(3)), value: 78 },
                { time: Number((start + rippleDuration).toFixed(3)), value: 128 },
            ],
            amplitude_px: Math.max(effect.ripple.amplitude_px, 34),
            frequency: Math.max(effect.ripple.frequency, 9.4),
            width_pct: Math.max(effect.ripple.width_pct, 10),
        },
    };
}
export function detailPrimitiveBeatPulse(effect) {
    return {
        ...effect,
        pulse: {
            scale: 0.055,
            duration_sec: 0.16,
            ...(effect.pulse ?? {}),
        },
        shake: {
            enabled: true,
            amplitude_px: 4,
            duration_sec: 0.12,
            ...(effect.shake ?? {}),
        },
    };
}
export function detailPrimitiveBeatColorUnlock(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const timing = localAudioTiming(recipe, anchor);
    const trigger = timing.strongBeats[0] ?? timing.energyPeaks[0]?.time ?? timing.beats[0] ?? Math.min(0.72, duration * 0.34);
    const text = anchorEvidenceText(anchor);
    const isWipe = /wipe|left|right|horizontal|横向|划|扫/.test(text);
    return {
        ...effect,
        reveal_mode: isWipe ? 'directional_wipe' : effect.reveal_mode,
        trigger_times: [Number(Math.min(duration - 0.08, Math.max(0.08, trigger)).toFixed(3))],
        duration_sec: Number(Math.min(0.86, Math.max(0.32, duration * 0.22)).toFixed(3)),
        origin: effect.origin ?? { x_pct: 50, y_pct: 50 },
        hold_after: true,
    };
}
export function detailPrimitiveColorHintOverlay(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const timing = localAudioTiming(recipe, anchor);
    const end = timing.strongBeats[0] ?? timing.energyPeaks[0]?.time ?? timing.beats[0] ?? Math.min(0.72, duration * 0.34);
    const cue = scenicCueFromText(anchorEvidenceText(anchor));
    return {
        ...effect,
        cues: [
            {
                id: 'hint_001',
                label: cue.label,
                color: cue.color,
                start_sec: 0,
                end_sec: Number(Math.min(duration - 0.04, Math.max(0.12, end)).toFixed(3)),
                x_pct: 50,
                y_pct: 42,
            },
        ],
    };
}
export function detailPrimitiveFadeOverlay(input) {
    const duration = Math.max(0.4, input.anchor.end_sec - input.anchor.start_sec);
    return {
        ...input.effect,
        start_sec: Number(Math.max(0, duration - input.effect.duration_sec).toFixed(3)),
        direction: input.effect.direction ?? 'out',
        hold: input.effect.hold ?? true,
    };
}
export function detailPrimitiveTransitionAccentOverlay(input) {
    const { effect, anchor, recipe } = input;
    const duration = Math.max(0.4, anchor.end_sec - anchor.start_sec);
    const text = anchorEvidenceText(anchor);
    const timing = localAudioTiming(recipe, anchor);
    const isStart = /intro|open|opening|start|entrance|in\b/.test(text);
    const isFlash = /flash|white|blink|snap|hard.?cut|strobe/.test(text);
    const isColorWash = /color.?wash|wash|gradient|color.?wipe|saturat/.test(text);
    const isZoomBlur = /zoom.?blur|motion.?blur|rush|speed|whip/.test(text);
    const isVertical = /vertical|top|bottom|up|down/.test(text);
    const isReverse = /right.?to.?left|bottom.?to.?top|reverse|back/.test(text);
    const trigger = timing.strongBeats[0] ??
        timing.energyPeaks[0]?.time ??
        timing.beats[0];
    const accentDuration = Number(Math.min(0.72, Math.max(0.18, effect.duration_sec || duration * 0.14)).toFixed(3));
    const start = isStart
        ? 0
        : trigger !== undefined
            ? Math.max(0, trigger - accentDuration * 0.5)
            : Math.max(0, duration - accentDuration);
    return {
        ...effect,
        style: isZoomBlur
            ? 'zoom_blur'
            : isColorWash
                ? 'color_wash'
                : isFlash
                    ? 'flash'
                    : effect.style,
        start_sec: Number(Math.min(Math.max(0, duration - accentDuration), start).toFixed(3)),
        duration_sec: accentDuration,
        intensity: Number(Math.min(0.88, Math.max(0.22, effect.intensity)).toFixed(2)),
        direction: isVertical
            ? isReverse
                ? 'bottom_to_top'
                : 'top_to_bottom'
            : isReverse
                ? 'right_to_left'
                : effect.direction ?? 'left_to_right',
    };
}
export function detailPrimitiveEffectForAnchor(input) {
    const { effect, anchor, recipe } = input;
    if (!effect)
        return undefined;
    switch (effect.preset) {
        case 'primitive_orb_motion':
            return detailPrimitiveOrbMotion({ effect, anchor, recipe });
        case 'primitive_directional_wave_reveal':
            return detailPrimitiveDirectionalWaveReveal({ effect, anchor, recipe });
        case 'primitive_mask_reveal':
            return detailPrimitiveMaskReveal({ effect, anchor, recipe });
        case 'primitive_ripple_displacement':
            return detailPrimitiveRippleDisplacement({ effect, anchor, recipe });
        case 'primitive_beat_pulse':
            return detailPrimitiveBeatPulse(effect);
        case 'primitive_beat_color_unlock':
            return detailPrimitiveBeatColorUnlock({ effect, anchor, recipe });
        case 'primitive_color_hint_overlay':
            return detailPrimitiveColorHintOverlay({ effect, anchor, recipe });
        case 'primitive_fade_overlay':
            return detailPrimitiveFadeOverlay({ effect, anchor });
        case 'primitive_transition_accent_overlay':
            return detailPrimitiveTransitionAccentOverlay({ effect, anchor, recipe });
        default:
            return effect;
    }
}
export function wantsGlobalCinematicGrade(globalEffects) {
    return (globalEffects ?? []).some((item) => item === 'primitive_texture_grade' || item === 'cinematic_grade_pack');
}
//# sourceMappingURL=primitive-effect-detail.js.map