import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

export type ExerciseId = 'E01' | 'E02' | 'E03' | 'E04'
export type Sample = {
  t: number
  width: number
  height: number
  hand?: Array<{ x: number; y: number; z: number }>
  pose?: Array<{ x: number; y: number; visibility: number }>
}
export type ModelArtifact = {
  exerciseId: ExerciseId
  modelType: 'logreg'
  features: string[]
  mean: number[]
  scale: number[]
  coef: number[]
  intercept: number
  confidenceThreshold: number
  status: string
}
export type Prediction = {
  probability: number
  confidence: number
  threshold: number
  verdict: 'complete' | 'check' | 'quality'
  message: string
  detectedPercent: number
  durationSeconds: number
  cycleCount: number
  features?: Record<string, number>
  cycleFeatures?: Record<string, number>[]
  angleSeries?: Array<{ t: number; angle: number }>
}

const MODEL_PATHS: Record<ExerciseId, string> = {
  E01: '/models/E01.json', E02: '/models/E02.json',
  E03: '/models/E03.json', E04: '/models/E04.json',
}

export class BrowserLandmarker {
  private analysisOnly = false
  private hand?: HandLandmarker
  private pose?: PoseLandmarker
  private lastHandDetection = Number.NEGATIVE_INFINITY
  private canvas = document.createElement('canvas')
  private context = this.canvas.getContext('2d', { willReadFrequently: true })

  static async create(exercise: ExerciseId, analysisOnly = false) {
    const instance = new BrowserLandmarker()
    instance.analysisOnly = analysisOnly
    const vision = await FilesetResolver.forVisionTasks('/wasm')
    const needPose = !analysisOnly || exercise === 'E02'
    const needHand = !analysisOnly || exercise !== 'E02'
    const poseOptions = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.2, minPosePresenceConfidence: 0.2,
      minTrackingConfidence: 0.2,
    })
    const handOptions = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
    })
    if (needPose) instance.pose = await poseOptions('GPU').catch(() => poseOptions('CPU'))
    if (needHand) instance.hand = await handOptions('GPU').catch(() => handOptions('CPU'))
    return instance
  }

  detect(source: HTMLVideoElement, timestampMs: number, t: number): Sample {
    const sample: Sample = { t, width: source.videoWidth, height: source.videoHeight }
    if (!this.context || !source.videoWidth || !source.videoHeight) return sample
    // Upload analysis runs on the main thread, often on an older phone.
    // A smaller inference frame keeps the UI responsive while retaining enough
    // resolution for shoulder/elbow/wrist pose landmarks.
    const maxDimension = this.analysisOnly ? 480 : 640
    const scale = Math.min(1, maxDimension / Math.max(source.videoWidth, source.videoHeight))
    this.canvas.width = Math.max(1, Math.round(source.videoWidth * scale))
    this.canvas.height = Math.max(1, Math.round(source.videoHeight * scale))
    this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height)
    if (this.pose) {
      const result = this.pose.detectForVideo(this.canvas, timestampMs)
      const points = result.landmarks[0]
      if (points) {
        sample.pose = [11, 12, 13, 14, 15, 16, 19, 20].map((index) => {
          const point = points[index]
          return { x: point.x, y: point.y, visibility: point.visibility ?? point.presence ?? 0 }
        })
      }
    }
    if (this.hand && timestampMs - this.lastHandDetection >= 200) {
      this.lastHandDetection = timestampMs
      const result = this.hand.detectForVideo(this.canvas, timestampMs)
      const tracks = result.landmarks
      if (tracks.length) {
        const chosen = [...tracks].sort((a, b) => handArea(b) - handArea(a))[0]
        sample.hand = chosen.map((point) => ({ x: point.x, y: point.y, z: point.z }))
      }
    }
    return sample
  }

  close() {
    this.hand?.close()
    this.pose?.close()
  }
}

const overlayHistory = new WeakMap<HTMLCanvasElement, { pose?: Sample['pose']; hand?: Sample['hand']; handAt: number }>()

export function drawLandmarks(canvas: HTMLCanvasElement, video: HTMLVideoElement, sample: Sample) {
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  if (!video.videoWidth || !video.videoHeight) return

  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
  const shownWidth = video.videoWidth * scale
  const shownHeight = video.videoHeight * scale
  const offsetX = (rect.width - shownWidth) / 2
  const offsetY = (rect.height - shownHeight) / 2
  const point = (p: { x: number; y: number }) => ({ x: offsetX + p.x * shownWidth, y: offsetY + p.y * shownHeight })

  const history = overlayHistory.get(canvas) ?? { handAt: 0 }
  const blend = <T extends { x: number; y: number }>(next: T[] | undefined, previous: T[] | undefined) =>
    next?.map((p, i) => previous?.[i] ? { ...p, x: p.x * 0.72 + previous[i].x * 0.28, y: p.y * 0.72 + previous[i].y * 0.28 } : p)
  const pose = blend(sample.pose, history.pose) || []
  if (sample.hand) { history.hand = blend(sample.hand, history.hand); history.handAt = performance.now() }
  const hand = history.handAt && performance.now() - history.handAt < 360 ? history.hand || [] : []
  history.pose = pose
  overlayHistory.set(canvas, history)
  const poseLines = [[0, 1], [0, 2], [2, 4], [4, 6], [1, 3], [3, 5], [5, 7]]
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#62e5d2'
  for (const [a, b] of poseLines) {
    if ((pose[a]?.visibility ?? 0) < 0.4 || (pose[b]?.visibility ?? 0) < 0.4) continue
    const start = point(pose[a]); const end = point(pose[b])
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke()
  }
  for (const index of [0, 1, 2, 3, 4, 5]) {
    if ((pose[index]?.visibility ?? 0) < 0.4) continue
    const p = point(pose[index])
    ctx.beginPath(); ctx.arc(p.x, p.y, index < 2 ? 6 : 5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#168d91'; ctx.lineWidth = 3; ctx.stroke()
  }

  if (hand.length < 21) return
  const fingers = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3
  for (const chain of fingers) {
    const first = point(hand[chain[0]])
    ctx.beginPath(); ctx.moveTo(first.x, first.y)
    for (const index of chain.slice(1)) { const p = point(hand[index]); ctx.lineTo(p.x, p.y) }
    ctx.stroke()
  }
  for (const p0 of hand) {
    const p = point(p0)
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#d99a18'; ctx.lineWidth = 2; ctx.stroke()
  }
}

function handArea(points: NormalizedLandmark[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

export async function getModel(exercise: ExerciseId): Promise<ModelArtifact> {
  const response = await fetch(MODEL_PATHS[exercise], { cache: 'no-cache' })
  if (!response.ok) throw new Error('model_missing')
  return await response.json() as ModelArtifact
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function median(values: number[]) { return quantile(values, 0.5) }
function std(values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(values.length, 1))
}
function range(values: number[]) { return quantile(values, 0.95) - quantile(values, 0.05) }

function handRows(samples: Sample[]) {
  return samples.flatMap((sample) => {
    if (!sample.hand || sample.hand.length < 21) return []
    const p = sample.hand
    const dist = (a: number, b: number) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y)
    const palmLength = Math.max(dist(0, 9), 1e-4)
    const palmWidth = Math.max(dist(5, 17), 1e-4)
    const fingerExtension = [dist(8, 5), dist(12, 9), dist(16, 13), dist(20, 17)].map((d) => d / palmLength)
    return [{
      t: sample.t, wristX: p[0].x, wristY: p[0].y,
      open: [8, 12, 16, 20].reduce((sum, tip) => sum + dist(tip, 0) / palmLength, 0) / 4,
      spread: dist(8, 20) / palmWidth,
      thumb: dist(4, 0) / palmLength,
      finger: fingerExtension.reduce((sum, value) => sum + value, 0) / 4,
      middle: fingerExtension[1],
      axis: Math.atan2(-(p[9].y - p[0].y), Math.abs(p[9].x - p[0].x) + 1e-6) * 180 / Math.PI,
    }]
  })
}

function summarizeHand(exercise: ExerciseId, samples: Sample[]) {
  const rows = handRows(samples)
  if (rows.length < 8) return null
  const y = rows.map((row) => row.wristY)
  const x = rows.map((row) => row.wristX)
  const open = rows.map((row) => row.open)
  const spread = rows.map((row) => row.spread)
  const finger = rows.map((row) => row.finger)
  const thumb = rows.map((row) => row.thumb)
  const middle = rows.map((row) => row.middle)
  const axis = rows.map((row) => row.axis)
  const dt = rows.slice(1).map((row, i) => Math.max(row.t - rows[i].t, 1e-3))
  const ySpeed = rows.slice(1).map((row, i) => Math.abs(row.wristY - rows[i].wristY) / dt[i])
  const unwrappedAxis = [axis[0]]
  for (let i = 1; i < axis.length; i++) {
    let next = axis[i]
    while (next - unwrappedAxis[i - 1] > 180) next -= 360
    while (next - unwrappedAxis[i - 1] < -180) next += 360
    unwrappedAxis.push(next)
  }
  const features: Record<string, number> = {
    wrist_y_range: range(y), wrist_y_change: y[y.length - 1] - y[0],
    wrist_y_speed_p95: quantile(ySpeed, 0.95), wrist_x_range: range(x),
    open_median: median(open), open_p90: quantile(open, 0.9), open_range: range(open),
    spread_median: median(spread), spread_p90: quantile(spread, 0.9), spread_range: range(spread),
    thumb_extension_median: median(thumb), finger_extension_median: median(finger),
    finger_extension_range: range(finger), middle_extension_range: range(middle),
    hand_axis_range: range(unwrappedAxis), hand_axis_std: std(unwrappedAxis),
    hand_axis_change: unwrappedAxis[unwrappedAxis.length - 1] - unwrappedAxis[0],
  }
  const featureNames: Record<string, string[]> = {
    E01: ['wrist_y_range', 'wrist_y_change', 'wrist_y_speed_p95', 'wrist_x_range', 'open_median', 'open_range', 'spread_median'],
    E03: ['hand_axis_range', 'hand_axis_std', 'hand_axis_change', 'wrist_y_range', 'open_median', 'middle_extension_range', 'spread_range'],
    E04: ['open_median', 'open_p90', 'open_range', 'spread_median', 'spread_p90', 'thumb_extension_median', 'finger_extension_median', 'finger_extension_range'],
  }
  return Object.fromEntries(featureNames[exercise].map((name) => [name, features[name]])) as Record<string, number>
}

function interpolate(times: number[], values: number[], targetTimes: number[]) {
  let i = 0
  return targetTimes.map((time) => {
    while (i < times.length - 2 && times[i + 1] < time) i++
    const dt = times[i + 1] - times[i]
    if (dt <= 1e-6) return values[i]
    const f = Math.max(0, Math.min(1, (time - times[i]) / dt))
    return values[i] + (values[i + 1] - values[i]) * f
  })
}

function movingAverage(values: number[], width: number) {
  const half = Math.floor(width / 2)
  return values.map((_, i) => {
    let sum = 0
    for (let d = -half; d <= half; d++) sum += values[Math.max(0, Math.min(values.length - 1, i + d))]
    return sum / width
  })
}

function movingMedian(values: number[], width: number) {
  const half = Math.floor(width / 2)
  return values.map((_, i) => {
    const window: number[] = []
    for (let d = -half; d <= half; d++) window.push(values[Math.max(0, Math.min(values.length - 1, i + d))])
    return median(window)
  })
}

function segmentCycles(signal: number[]) {
  if (signal.length < 12) return [[0, signal.length] as [number, number]]
  const distance = 27
  const valleys: number[] = []
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] <= signal[i - 1] && signal[i] < signal[i + 1]) valleys.push(i)
  }
  const selected: number[] = []
  for (const valley of valleys) {
    const previous = selected[selected.length - 1]
    if (previous === undefined || valley - previous >= distance) selected.push(valley)
    else if (signal[valley] < signal[previous]) selected[selected.length - 1] = valley
  }
  const valid = selected.filter((valley, index) => {
    if (!index) return true
    const prev = selected[index - 1]
    const leftPeak = Math.max(...signal.slice(Math.max(0, valley - distance), valley))
    const rightPeak = Math.max(...signal.slice(valley + 1, Math.min(signal.length, valley + distance + 1)))
    return Math.min(leftPeak - signal[valley], rightPeak - signal[valley]) >= 15 && valley - prev >= distance
  })
  if (valid.length <= 1) return [[0, signal.length] as [number, number]]
  const splits: number[] = []
  for (let i = 1; i < valid.length; i++) {
    const start = valid[i - 1]
    const end = valid[i]
    const segment = signal.slice(start, end + 1)
    let rel = 0
    segment.forEach((v, j) => { if (v > segment[rel]) rel = j })
    if (segment[rel] - Math.max(signal[start], signal[end]) >= 18) splits.push(start + rel)
  }
  const bounds = [0, ...splits, signal.length]
  const cycles: Array<[number, number]> = []
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] >= 8) cycles.push([bounds[i], bounds[i + 1]])
  return cycles.length ? cycles : [[0, signal.length] as [number, number]]
}

function poseCycleFeatures(samples: Sample[], width: number, height: number) {
  const sides = [
    { shoulder: 0, elbow: 2, wrist: 4, index: 6, name: 'L' },
    { shoulder: 1, elbow: 3, wrist: 5, index: 7, name: 'R' },
  ]
  const minDim = Math.min(width, height)
  const details = sides.map((side) => {
    const values = samples.map((s) => {
      const p = s.pose
      if (!p) return { theta: Number.NaN, vis: 0, flen: 0, wy: Number.NaN, iy: Number.NaN, dx: Number.NaN, dy: Number.NaN }
      const e = p[side.elbow], w = p[side.wrist], sh = p[side.shoulder], idx = p[side.index]
      const dx = (w.x - e.x) * width
      const dy = (w.y - e.y) * height
      return {
        theta: Math.atan2(-dy, Math.abs(dx) + 1e-6) * 180 / Math.PI,
        vis: Math.min(e.visibility, w.visibility), flen: Math.hypot(dx, dy),
        wy: -w.y * height, iy: -idx.y * height, dx, dy,
        shElbowVisibility: Math.min(sh.visibility, e.visibility),
      }
    })
    const eligible = values.filter((v) => Number.isFinite(v.theta) && v.flen >= 0.04 * minDim)
    const motionX = eligible.length ? range(eligible.map((v) => v.dx)) : 0
    const motionY = eligible.length ? range(eligible.map((v) => v.dy)) : 0
    const medianLength = median(eligible.map((v) => v.flen)) || 1
    const score = (motionX + motionY) / medianLength * (0.2 + median(eligible.map((v) => v.vis)))
    return { side, values, score }
  })
  const chosen = details.sort((a, b) => b.score - a.score)[0]
  const raw = chosen.values
  let kept = raw.filter((v) => Number.isFinite(v.theta) && v.flen >= 0.04 * minDim && v.theta >= -25)
  if (kept.length < 8) kept = raw.filter((v) => Number.isFinite(v.theta))
  if (kept.length < 6) return null
  const visThreshold = Math.min(0.12, quantile(kept.map((v) => v.vis), 0.2))
  kept = kept.filter((v) => v.vis >= visThreshold)
  if (kept.length < 6) kept = raw.filter((v) => Number.isFinite(v.theta))
  const timeByFrame = new Map(samples.map((s) => [s, s.t]))
  const keptWithTime = samples.flatMap((s, i) => {
    const p = chosen.values[i]
    return kept.includes(p) ? [{ ...p, t: timeByFrame.get(s) ?? 0 }] : []
  })
  if (keptWithTime.length < 6) return null
  const t0 = keptWithTime[0].t
  const t1 = keptWithTime[keptWithTime.length - 1].t
  const duration = t1 - t0
  const targetTimes: number[] = []
  for (let t = t0; t <= t1 + 1e-5; t += 1 / 15) targetTimes.push(t)
  if (targetTimes.length < 8) return null
  const realTimes = keptWithTime.map((v) => v.t)
  const th = movingAverage(interpolate(realTimes, movingMedian(keptWithTime.map((v) => v.theta), 5), targetTimes), 7)
  const wy = interpolate(realTimes, movingMedian(keptWithTime.map((v) => v.wy), 5), targetTimes)
  const iy = interpolate(realTimes, movingMedian(keptWithTime.map((v) => v.iy), 5), targetTimes)
  const cycles = segmentCycles(th)
  const result = cycles.map(([start, end]) => {
    const a = th.slice(start, end), b = wy.slice(start, end), c = iy.slice(start, end)
    const dth = a.map((v, i) => i ? (v - a[i - 1]) * 15 : 0)
    const ddth = dth.map((v, i) => i ? (v - dth[i - 1]) * 15 : 0)
    const cycleStart = targetTimes[start]
    const cycleEnd = targetTimes[Math.min(end, targetTimes.length - 1)]
    const lengths = keptWithTime.filter((v) => v.t >= cycleStart && v.t <= cycleEnd).map((v) => v.flen)
    const medianLength = Math.max(median(lengths), 0.04 * minDim, 1)
    const features: Record<string, number> = {
      th_min: Math.min(...a), th_p10: quantile(a, 0.1), th_p50: median(a), th_p90: quantile(a, 0.9),
      th_rng: quantile(a, 0.9) - quantile(a, 0.1), th_drop: Math.max(...a) - Math.min(...a), th_std: std(a),
      frac_below_25: a.filter((v) => v < 25).length / a.length,
      frac_below_35: a.filter((v) => v < 35).length / a.length,
      wy_rel_rng: (quantile(b, 0.9) - quantile(b, 0.1)) / medianLength,
      iy_rel_rng: (quantile(c, 0.9) - quantile(c, 0.1)) / medianLength,
      max_speed: quantile(dth.map(Math.abs), 0.95),
      mean_abs_speed: dth.reduce((s, v) => s + Math.abs(v), 0) / dth.length,
      smooth_jerk: ddth.reduce((s, v) => s + Math.abs(v), 0) / ddth.length,
    }
    return features
  })
  const detectedPercent = 100 * keptWithTime.length / samples.length
  const graphStride = Math.max(1, Math.ceil(th.length / 180))
  const angleSeries = th.flatMap((angle, index) => index % graphStride === 0
    ? [{ t: Number((targetTimes[index] - t0).toFixed(2)), angle: Number(angle.toFixed(1)) }]
    : [])
  return { cycles: result, detectedPercent, duration, angleSeries }
}

function sigmoid(value: number) { return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value)))) }

export async function scoreSamples(exercise: ExerciseId, samples: Sample[]): Promise<Prediction> {
  const model = await getModel(exercise)
  const duration = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0
  let featureRows: Record<string, number>[] = []
  let detectedPercent = 0
  let predictionData: Pick<Prediction, 'cycleFeatures' | 'angleSeries'> = {}
  if (exercise === 'E02') {
    const width = median(samples.map((s) => s.width).filter(Boolean)) || 640
    const height = median(samples.map((s) => s.height).filter(Boolean)) || 480
    const pose = poseCycleFeatures(samples, width, height)
    if (!pose) return { probability: 0, confidence: 0, threshold: model.confidenceThreshold, verdict: 'quality', message: 'Руку плохо видно или видео слишком короткое.', detectedPercent: 0, durationSeconds: duration, cycleCount: 0 }
    featureRows = pose.cycles
    detectedPercent = pose.detectedPercent
    if (detectedPercent < 50 || pose.duration < 3) return { probability: 0, confidence: 0, threshold: model.confidenceThreshold, verdict: 'quality', message: 'Руку плохо видно или видео слишком короткое.', detectedPercent, durationSeconds: pose.duration, cycleCount: pose.cycles.length, cycleFeatures: pose.cycles, angleSeries: pose.angleSeries }
    predictionData = { cycleFeatures: featureRows, angleSeries: pose.angleSeries }
  } else {
    const count = samples.filter((s) => s.hand?.length === 21).length
    detectedPercent = 100 * count / Math.max(samples.length, 1)
    featureRows = [summarizeHand(exercise, samples)].filter((row): row is Record<string, number> => row !== null)
    if (detectedPercent < 50 || duration < 3 || !featureRows.length) return { probability: 0, confidence: 0, threshold: model.confidenceThreshold, verdict: 'quality', message: 'Кисть плохо видна или видео слишком короткое.', detectedPercent, durationSeconds: duration, cycleCount: 0 }
  }
  const probs = featureRows.map((row) => {
    let z = model.intercept
    model.features.forEach((name, i) => { z += ((row[name] - model.mean[i]) / (model.scale[i] || 1)) * model.coef[i] })
    return sigmoid(z)
  })
  const probability = probs.reduce((sum, value) => sum + value, 0) / probs.length
  const confidence = Math.max(probability, 1 - probability)
  if (confidence < model.confidenceThreshold) return { probability, confidence, threshold: model.confidenceThreshold, verdict: 'check', message: 'Не удалось уверенно оценить движение. Посмотрите инструкцию и попробуйте ещё раз.', detectedPercent, durationSeconds: duration, cycleCount: featureRows.length, features: featureRows[0], ...(exercise === 'E02' ? predictionData : {}) }
  const verdict = probability >= 0.5 ? 'complete' : 'check'
  return { probability, confidence, threshold: model.confidenceThreshold, verdict, message: verdict === 'complete' ? 'Упражнение выполнено' : 'Посмотрите инструкцию и попробуйте ещё раз.', detectedPercent, durationSeconds: duration, cycleCount: featureRows.length, features: featureRows[0], ...(exercise === 'E02' ? predictionData : {}) }
}

export const MODEL_PATHS_BY_EXERCISE = MODEL_PATHS
