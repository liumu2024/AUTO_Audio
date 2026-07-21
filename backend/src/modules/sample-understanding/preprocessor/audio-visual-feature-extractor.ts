// Extracts lightweight audio-aware timing hints and keyframe plans before sample understanding.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import type { AudioVisualUnderstandingHints } from '../../../../../shared/types/sample-understanding-skills.js'
import type { VideoInput } from '../../video-understanding/video-input.js'

const execFileAsync = promisify(execFile)

interface FfprobeStream {
  width?: number
  height?: number
  r_frame_rate?: string
  nb_frames?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
  }
}

export async function extractAudioVisualUnderstandingHints(
  video: VideoInput,
): Promise<AudioVisualUnderstandingHints> {
  const metadata = await probeVideoMetadata(video.localPath).catch(() => ({
    video_duration: 10,
    fps: 30,
    frame_count: 300,
    width: undefined,
    height: undefined,
  }))
  const duration = Math.max(0.1, metadata.video_duration)
  const rhythm = await analyzeAudioRhythm(video.localPath, duration).catch(() =>
    buildHeuristicRhythm(duration),
  )
  const beats = rhythm.beats
  const strongBeats = rhythm.strongBeats
  const energyPeaks = rhythm.energyPeaks
  const waveform = rhythm.waveform
  const sections = buildSections(duration, energyPeaks.map((peak) => peak.time))
  const visualKeyframes = buildVisualKeyframes({
    duration,
    beats,
    strongBeats,
    energyPeaks: energyPeaks.map((peak) => peak.time),
    sections,
  })

  return {
    metadata,
    audio_features: {
      beats,
      strong_beats: strongBeats,
      energy_peaks: energyPeaks,
      waveform,
      sections,
    },
    visual_keyframes: visualKeyframes,
  }
}

interface RhythmAnalysis {
  beats: number[]
  strongBeats: number[]
  energyPeaks: Array<{
    time: number
    intensity: number
    duration_sec: number
  }>
  waveform: Array<{
    time: number
    value: number
  }>
}

async function probeVideoMetadata(localPath: string): Promise<AudioVisualUnderstandingHints['metadata']> {
  const ffprobe = resolveFfprobePath()
  const { stdout } = await execFileAsync(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-show_entries',
    'stream=width,height,r_frame_rate,nb_frames',
    '-of',
    'json',
    localPath,
  ])
  const payload = JSON.parse(stdout) as FfprobeOutput
  const videoStream =
    payload.streams?.find((stream) => stream.width && stream.height) ??
    payload.streams?.[0]
  const duration = Number(payload.format?.duration)
  const fps = parseRate(videoStream?.r_frame_rate) ?? 30
  const frameCount = Number(videoStream?.nb_frames)

  return {
    video_duration: Number.isFinite(duration) && duration > 0 ? duration : 10,
    fps,
    frame_count:
      Number.isFinite(frameCount) && frameCount > 0
        ? frameCount
        : Math.round((Number.isFinite(duration) ? duration : 10) * fps),
    width: videoStream?.width,
    height: videoStream?.height,
  }
}

function resolveFfprobePath(): string {
  const candidates = [
    process.env.FFPROBE_PATH,
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe',
    ),
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-linux-x64-gnu/ffprobe',
    ),
  ].filter((item): item is string => Boolean(item))
  return candidates.find((candidate) => existsSync(candidate)) ?? 'ffprobe'
}

function resolveFfmpegPath(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe',
    ),
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg',
    ),
  ].filter((item): item is string => Boolean(item))
  return candidates.find((candidate) => existsSync(candidate)) ?? 'ffmpeg'
}

function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined
  const [num, den] = rate.split('/').map(Number)
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
    return num / den
  }
  const direct = Number(rate)
  return Number.isFinite(direct) && direct > 0 ? direct : undefined
}

async function analyzeAudioRhythm(localPath: string, duration: number): Promise<RhythmAnalysis> {
  const sampleRate = 11025
  const windowSec = 0.05
  const pcm = await decodeMonoPcm(localPath, sampleRate)
  const energies = computeWindowEnergies(pcm, sampleRate, windowSec)
  if (energies.length < 8 || Math.max(...energies.map((item) => item.energy)) <= 0) {
    return buildHeuristicRhythm(duration)
  }

  const normalized = normalizeEnergies(energies)
  const beats = detectEnergyBeats(normalized, duration)
  const strongBeats = detectStrongBeats(normalized, beats)
  const energyPeaks = detectEnergyPeaks(normalized, duration)

  if (!beats.length) return buildHeuristicRhythm(duration)
  return {
    beats,
    strongBeats: strongBeats.length ? strongBeats : beats.filter((_, index) => index % 2 === 1),
    energyPeaks: energyPeaks.length ? energyPeaks : buildEnergyPeaks(duration, beats),
    waveform: buildWaveform(normalized, duration),
  }
}

function decodeMonoPcm(localPath: string, sampleRate: number): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const ffmpeg = spawn(resolveFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      localPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1',
    ])

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`))
        return
      }
      const buffer = Buffer.concat(chunks)
      resolve(new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2)))
    })
  })
}

function computeWindowEnergies(
  samples: Int16Array,
  sampleRate: number,
  windowSec: number,
): Array<{ time: number; energy: number }> {
  const windowSize = Math.max(1, Math.round(sampleRate * windowSec))
  const result: Array<{ time: number; energy: number }> = []
  for (let offset = 0; offset + windowSize <= samples.length; offset += windowSize) {
    let sum = 0
    for (let index = offset; index < offset + windowSize; index += 1) {
      const value = samples[index] / 32768
      sum += value * value
    }
    result.push({
      time: roundTime(offset / sampleRate),
      energy: Math.sqrt(sum / windowSize),
    })
  }
  return result
}

function normalizeEnergies(
  energies: Array<{ time: number; energy: number }>,
): Array<{ time: number; energy: number; onset: number }> {
  const maxEnergy = Math.max(...energies.map((item) => item.energy), 0.0001)
  return energies.map((item, index) => {
    const previous = energies[Math.max(0, index - 1)]?.energy ?? item.energy
    const normalized = item.energy / maxEnergy
    return {
      time: item.time,
      energy: normalized,
      onset: Math.max(0, (item.energy - previous) / maxEnergy),
    }
  })
}

function detectEnergyBeats(
  energies: Array<{ time: number; energy: number; onset: number }>,
  duration: number,
): number[] {
  const onsetValues = energies.map((item) => item.onset)
  const threshold = percentile(onsetValues, 0.72)
  const minGap = duration <= 12 ? 0.24 : 0.32
  const beats: number[] = []
  for (let index = 1; index < energies.length - 1; index += 1) {
    const current = energies[index]
    if (
      current.onset >= threshold &&
      current.onset >= energies[index - 1].onset &&
      current.onset >= energies[index + 1].onset &&
      (!beats.length || current.time - beats[beats.length - 1] >= minGap)
    ) {
      beats.push(roundTime(current.time))
    }
  }
  return beats.slice(0, 128)
}

function detectStrongBeats(
  energies: Array<{ time: number; energy: number; onset: number }>,
  beats: number[],
): number[] {
  const byTime = new Map(energies.map((item) => [roundTime(item.time), item]))
  return beats
    .map((time) => ({
      time,
      score: (byTime.get(roundTime(time))?.onset ?? 0) + (byTime.get(roundTime(time))?.energy ?? 0) * 0.45,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, Math.ceil(beats.length / 3)))
    .map((item) => item.time)
    .sort((a, b) => a - b)
}

function detectEnergyPeaks(
  energies: Array<{ time: number; energy: number; onset: number }>,
  duration: number,
): RhythmAnalysis['energyPeaks'] {
  const threshold = percentile(energies.map((item) => item.energy), 0.86)
  const peaks: RhythmAnalysis['energyPeaks'] = []
  for (let index = 1; index < energies.length - 1; index += 1) {
    const item = energies[index]
    if (
      item.energy >= threshold &&
      item.energy >= energies[index - 1].energy &&
      item.energy >= energies[index + 1].energy &&
      (!peaks.length || item.time - peaks[peaks.length - 1].time >= duration / 5)
    ) {
      peaks.push({
        time: roundTime(item.time),
        intensity: roundNumber(Math.min(1, item.energy)),
        duration_sec: 0.18,
      })
    }
  }
  return peaks.slice(0, 5)
}

function buildHeuristicRhythm(duration: number): RhythmAnalysis {
  const beatStep = inferBeatStep(duration)
  const beats = buildTimes(beatStep, duration, beatStep)
  const strongBeats = beats.filter((_, index) => index % 2 === 1)
  return {
    beats,
    strongBeats,
    energyPeaks: buildEnergyPeaks(duration, strongBeats),
    waveform: buildHeuristicWaveform(duration, beats, strongBeats),
  }
}

function buildWaveform(
  energies: Array<{ time: number; energy: number; onset: number }>,
  duration: number,
): RhythmAnalysis['waveform'] {
  const bucketCount = Math.max(24, Math.min(160, Math.round(duration * 12)))
  const buckets = Array.from({ length: bucketCount }, () => [] as number[])
  for (const item of energies) {
    const index = Math.max(
      0,
      Math.min(bucketCount - 1, Math.floor((item.time / duration) * bucketCount)),
    )
    buckets[index].push(Math.max(item.energy, item.onset * 1.8))
  }

  return buckets.map((bucket, index) => ({
    time: roundTime((index / bucketCount) * duration),
    value: roundNumber(Math.min(1, bucket.length ? Math.max(...bucket) : 0.02)),
  }))
}

function buildHeuristicWaveform(
  duration: number,
  beats: number[],
  strongBeats: number[],
): RhythmAnalysis['waveform'] {
  const strong = new Set(strongBeats.map(roundTime))
  const beatSet = new Set(beats.map(roundTime))
  const bucketCount = Math.max(24, Math.min(160, Math.round(duration * 12)))
  return Array.from({ length: bucketCount }, (_, index) => {
    const time = roundTime((index / bucketCount) * duration)
    const nearestBeat = beats
      .map((beat) => Math.abs(beat - time))
      .sort((a, b) => a - b)[0] ?? 1
    const pulse = Math.max(0, 1 - nearestBeat / 0.28)
    const base = 0.18 + Math.sin(index * 0.73) * 0.08
    const accent = strong.has(time) ? 0.4 : beatSet.has(time) ? 0.24 : 0
    return {
      time,
      value: roundNumber(Math.max(0.04, Math.min(1, base + pulse * 0.54 + accent))),
    }
  })
}

function inferBeatStep(duration: number): number {
  if (duration <= 8) return 0.42
  if (duration <= 15) return 0.48
  if (duration <= 30) return 0.5
  return 0.6
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))
  return sorted[index]
}

function buildTimes(start: number, duration: number, step: number): number[] {
  const times: number[] = []
  for (let time = start; time < duration - 0.05; time += step) {
    times.push(roundTime(time))
  }
  return times.slice(0, 96)
}

function buildEnergyPeaks(duration: number, strongBeats: number[]) {
  const candidates = strongBeats.filter((time) => time > duration * 0.18)
  const picks = [
    nearestTime(candidates, duration * 0.33),
    nearestTime(candidates, duration * 0.66),
    nearestTime(candidates, duration * 0.88),
  ].filter((time): time is number => typeof time === 'number')
  return [...new Set(picks)].map((time, index) => ({
    time,
    intensity: roundNumber(Math.min(1, 0.72 + index * 0.11)),
    duration_sec: 0.18,
  }))
}

function buildSections(duration: number, peakTimes: number[]) {
  const boundaries = [
    0,
    roundTime(duration * 0.25),
    roundTime(duration * 0.62),
    peakTimes.at(-1) ?? roundTime(duration * 0.82),
    roundTime(duration),
  ]
    .filter((time, index, arr) => time >= 0 && time <= duration && arr.indexOf(time) === index)
    .sort((a, b) => a - b)
  const labels = ['intro', 'groove', 'accent', 'outro']
  return boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1],
    type: labels[index] ?? 'groove',
  }))
}

function buildVisualKeyframes(input: {
  duration: number
  beats: number[]
  strongBeats: number[]
  energyPeaks: number[]
  sections: Array<{ start: number; end: number; type: string }>
}): AudioVisualUnderstandingHints['visual_keyframes'] {
  const map = new Map<number, string>()
  for (let time = 0; time <= input.duration; time += 1) {
    map.set(roundTime(time), 'uniform')
  }
  for (const beat of input.beats.slice(0, 48)) {
    addAround(map, beat, 'beat')
  }
  for (const beat of input.strongBeats.slice(0, 32)) {
    addAround(map, beat, 'strong_beat')
  }
  for (const peak of input.energyPeaks) {
    addAround(map, peak, 'energy_peak')
  }
  for (const section of input.sections) {
    map.set(roundTime(section.start), 'section_boundary')
    map.set(roundTime(section.end), 'section_boundary')
  }
  return [...map.entries()]
    .filter(([time]) => time >= 0 && time <= input.duration)
    .sort(([a], [b]) => a - b)
    .slice(0, 80)
    .map(([time, reason]) => ({ time, reason }))
}

function addAround(map: Map<number, string>, time: number, reason: string): void {
  map.set(roundTime(Math.max(0, time - 0.06)), reason)
  map.set(roundTime(time), reason)
  map.set(roundTime(time + 0.06), reason)
}

function nearestTime(times: number[], target: number): number | undefined {
  return times
    .slice()
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]
}

function roundTime(value: number): number {
  return Math.round(value * 100) / 100
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000
}
