import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { GeneratedComponentRenderProps } from "../../component-registry";

export default function StaticMaterialDynamicMotion(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const effectProps = props.effects.props as Record<string, unknown>;

  // Narrow all unknown typed effect props safely
  const intensity = typeof effectProps.intensity === "number" ? effectProps.intensity : 0.65;
  const rawDirection = typeof effectProps.direction === "object" && effectProps.direction !== null ? effectProps.direction as Record<string, unknown> : {};
  const directionX = typeof rawDirection.x === "number" ? rawDirection.x : 1;
  const directionY = typeof rawDirection.y === "number" ? rawDirection.y : 0;
  const chromaticAberrationPx = typeof effectProps.chromatic_aberration_px === "number" ? effectProps.chromatic_aberration_px : 2;
  const waveCount = typeof effectProps.wave_count === "number" ? effectProps.wave_count : 4;
  const durationSec = typeof effectProps.duration_sec === "number" ? effectProps.duration_sec : 1.2;
  const rawOrigin = typeof effectProps.origin === "object" && effectProps.origin !== null ? effectProps.origin as Record<string, unknown> : {};
  const originXPct = typeof rawOrigin.x_pct === "number" ? rawOrigin.x_pct : 50;
  const originYPct = typeof rawOrigin.y_pct === "number" ? rawOrigin.y_pct : 50;

  const effectFrameCount = durationSec * fps;
  const progress = interpolate(frame, [0, effectFrameCount], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const easedMotionProgress = interpolate(progress, [0, 0.25, 0.75, 1], [0, 0.15, 0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const panOffsetX = easedMotionProgress * directionX * intensity * width * 0.02;
  const panOffsetY = easedMotionProgress * directionY * intensity * height * 0.02;
  const rippleScale = interpolate(progress, [0, 1], [0, waveCount], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const originX = (originXPct / 100) * width;
  const originY = (originYPct / 100) * height;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{
        transform: `translate(${panOffsetX}px, ${panOffsetY}px) scale(${1 + intensity * 0.05})`,
        filter: `url(#rippleDisplacement)`,
      }}>
        {props.assetType === "image" ? (
          <img src={props.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="effect source" />
        ) : (
          <video src={props.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted autoPlay playsInline />
        )}
      </AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0, opacity: 0 }}>
        <defs>
          <filter id="rippleDisplacement">
            <feTurbulence type="fractalNoise" baseFrequency={`${0.01 * intensity}`} numOctaves={2} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={rippleScale * 4} xChannelSelector="R" yChannelSelector="G" />
            <feColorMatrix type="matrix" values={`1 0 0 ${chromaticAberrationPx / width} 0  0 1 0 0 0  0 0 1 0 ${-chromaticAberrationPx / width}  0 0 0 1 0`} />
          </filter>
        </defs>
      </svg>
    </AbsoluteFill>
  );
}