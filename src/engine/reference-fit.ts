// Where a reference image lies on the board: from its pixel size, its mirror switch and the points picked on it (each a
// pixel of the image and the board point in mm it belongs on), a 3x3 matrix taking an image pixel (u right, v down) to
// board millimetres (y up). No point: the image is centred on the board at its own scale (a Gerber's) or the board's
// width. One point: the same scale, moved onto it. Two or three: the best fit of scale, turn and move. Four or more:
// the best perspective, which also takes out the slant of a photo taken at an angle. Pure, for the core, the
// renderer and the Studio alike.

export interface FitPoint {
  x: number
  y: number
}

/** One picked pair: a pixel of the image and the board point in mm it belongs on. */
export interface ReferencePoint {
  image: FitPoint
  board: FitPoint
}

/** What the fit needs of a reference record. */
export interface FitInput {
  /** The image's size in pixels. */
  width: number
  height: number
  /** A photo of the bottom side is a mirror image: it is flipped left to right first. */
  mirror: boolean
  points: readonly ReferencePoint[]
  /** The size of one pixel in mm when the image has its own scale (one made from a Gerber file). */
  pixel?: number
}

/** A 3x3 matrix, row by row: [x, y, w] = M · [u, v, 1], board point (x / w, y / w). */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]

export type FitKind = "placed" | "similar" | "perspective"

export interface ReferenceFit {
  matrix: Matrix3
  /** "placed": centred or moved at a set scale; "similar": scale, turn and move fitted; "perspective": slant too. */
  kind: FitKind
  /** How far each point's image pixel lands from its board point, in mm, in the points' order. */
  residuals: number[]
  /** Why a perspective could not be used, when it could not. */
  note?: string
}

export interface BoardFrame {
  /** The board's centre and width in mm, which place an image without points. */
  centre: FitPoint
  width: number
}

/** The size of a pixel when nothing else tells it and there is no board: a tenth of a millimetre. */
const FALLBACK_PIXEL = 0.1
const PERSPECTIVE_POINTS = 4
/** A perspective whose last row stays this close to [0, 0, 1] is drawn as a plain transform. */
const FLAT = 1e-12

const multiply = (a: Matrix3, b: Matrix3): Matrix3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
]

/** The board point a pixel lands on (or the pixel a board point comes from, through the inverse). */
export function mapPoint(m: Matrix3, p: FitPoint): FitPoint {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }
}

/** The inverse matrix; undefined for one that folds the image flat. */
export function invertMatrix(m: Matrix3): Matrix3 | undefined {
  const c0 = m[4] * m[8] - m[5] * m[7]
  const c1 = m[5] * m[6] - m[3] * m[8]
  const c2 = m[3] * m[7] - m[4] * m[6]
  const det = m[0] * c0 + m[1] * c1 + m[2] * c2
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return undefined
  const k = 1 / det
  return [
    c0 * k,
    (m[2] * m[7] - m[1] * m[8]) * k,
    (m[1] * m[5] - m[2] * m[4]) * k,
    c1 * k,
    (m[0] * m[8] - m[2] * m[6]) * k,
    (m[2] * m[3] - m[0] * m[5]) * k,
    c2 * k,
    (m[1] * m[6] - m[0] * m[7]) * k,
    (m[0] * m[4] - m[1] * m[3]) * k,
  ]
}

/** Whether the matrix keeps straight parallel lines parallel: no perspective, one canvas transform draws it. */
export function isAffine(m: Matrix3): boolean {
  return Math.abs(m[6] / m[8]) < FLAT && Math.abs(m[7] / m[8]) < FLAT
}

/** Pixel to the image's own centred frame, y up, flipped left to right when mirrored. */
function centring(input: FitInput): Matrix3 {
  const flip = input.mirror ? -1 : 1
  return [flip, 0, (-flip * input.width) / 2, 0, -1, input.height / 2, 0, 0, 1]
}

/** Scale and turn `a` (a complex number), then move by `t`. */
const similarity = (a: FitPoint, t: FitPoint): Matrix3 => [a.x, -a.y, t.x, a.y, a.x, t.y, 0, 0, 1]

const defaultScale = (input: FitInput, board: BoardFrame | undefined) => input.pixel ?? (board && board.width > 0 ? board.width / input.width : FALLBACK_PIXEL)

/** Least squares over the points: the complex a and t with board ≈ a · q + t. */
function fitSimilarity(qs: readonly FitPoint[], bs: readonly FitPoint[]): Matrix3 {
  const mean = (ps: readonly FitPoint[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length })
  const [qm, bm] = [mean(qs), mean(bs)]
  let [re, im, norm] = [0, 0, 0]
  qs.forEach((q, i) => {
    const [dq, db] = [{ x: q.x - qm.x, y: q.y - qm.y }, { x: (bs[i] as FitPoint).x - bm.x, y: (bs[i] as FitPoint).y - bm.y }]
    re += dq.x * db.x + dq.y * db.y
    im += dq.x * db.y - dq.y * db.x
    norm += dq.x * dq.x + dq.y * dq.y
  })
  const a = { x: re / norm, y: im / norm }
  return similarity(a, { x: bm.x - (a.x * qm.x - a.y * qm.y), y: bm.y - (a.y * qm.x + a.x * qm.y) })
}

/** Moves the points' centre to 0 and scales their mean distance to √2, for a well-conditioned solve. */
function normaliser(ps: readonly FitPoint[]): Matrix3 {
  const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length
  const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length
  const spread = ps.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / ps.length || 1
  const k = Math.SQRT2 / spread
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1]
}

/** Solves the square system A·x = b by elimination with partial pivoting; undefined when it is singular. */
function solve(a: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const rows = a.map((row, i) => [...row, b[i] as number])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs((rows[r] as number[])[col] as number) > Math.abs((rows[pivot] as number[])[col] as number)) pivot = r
    if (Math.abs((rows[pivot] as number[])[col] as number) < 1e-12) return undefined
    ;[rows[col], rows[pivot]] = [rows[pivot] as number[], rows[col] as number[]]
    const top = rows[col] as number[]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const row = rows[r] as number[]
      const f = (row[col] as number) / (top[col] as number)
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - f * (top[c] as number)
    }
  }
  return rows.map((row, i) => (row[n] as number) / (row[i] as number))
}

/** The least-squares perspective taking the qs to the bs (last entry 1); undefined when the points cannot fix one. */
function fitPerspective(qs: readonly FitPoint[], bs: readonly FitPoint[]): Matrix3 | undefined {
  const [nq, nb] = [normaliser(qs), normaliser(bs)]
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  const atb = new Array<number>(8).fill(0)
  const add = (row: number[], value: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] = (atb[i] as number) + (row[i] as number) * value
      for (let j = 0; j < 8; j++) (ata[i] as number[])[j] = ((ata[i] as number[])[j] as number) + (row[i] as number) * (row[j] as number)
    }
  }
  qs.forEach((raw, i) => {
    const [q, b] = [mapPoint(nq, raw), mapPoint(nb, bs[i] as FitPoint)]
    add([q.x, q.y, 1, 0, 0, 0, -b.x * q.x, -b.x * q.y], b.x)
    add([0, 0, 0, q.x, q.y, 1, -b.y * q.x, -b.y * q.y], b.y)
  })
  const h = solve(ata, atb)
  const back = invertMatrix(nb)
  if (!h || !back) return undefined
  const m = multiply(back, multiply([...h, 1] as unknown as Matrix3, nq))
  return m.map((v) => v / m[8]) as unknown as Matrix3
}

/** Whether the image's four corners land as a quadrilateral that does not fold: in front of the horizon, convex, one way round. */
function unfolded(m: Matrix3, input: FitInput): boolean {
  const corners = [
    { x: 0, y: 0 },
    { x: input.width, y: 0 },
    { x: input.width, y: input.height },
    { x: 0, y: input.height },
  ]
  const ws = corners.map((p) => m[6] * p.x + m[7] * p.y + m[8])
  if (!ws.every((w) => w > 0) && !ws.every((w) => w < 0)) return false
  const at = corners.map((p) => mapPoint(m, p))
  const turns = at.map((p, i) => {
    const [q, r] = [at[(i + 1) % 4] as FitPoint, at[(i + 2) % 4] as FitPoint]
    return Math.sign((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x))
  })
  return turns.every((t) => t === turns[0] && t !== 0)
}

/** The matrix for the image's pixels and how well it meets each picked point. */
export function fitReference(input: FitInput, board?: BoardFrame): ReferenceFit {
  const centre = centring(input)
  const qs = input.points.map((p) => mapPoint(centre, p.image))
  const bs = input.points.map((p) => p.board)
  const scale = defaultScale(input, board)
  const placedAt = (t: FitPoint): ReferenceFit => ({ matrix: multiply(similarity({ x: scale, y: 0 }, t), centre), kind: "placed", residuals: input.points.map(() => 0) })
  if (qs.length === 0) return placedAt(board?.centre ?? { x: 0, y: 0 })
  const [q0, b0] = [qs[0] as FitPoint, bs[0] as FitPoint]
  if (qs.length === 1) return placedAt({ x: b0.x - scale * q0.x, y: b0.y - scale * q0.y })
  if (qs.every((q) => q.x === q0.x && q.y === q0.y)) return withResiduals(input, placedAt({ x: b0.x - scale * q0.x, y: b0.y - scale * q0.y }).matrix, "placed", "the points are one pixel of the image")
  const similar = multiply(fitSimilarity(qs, bs), centre)
  if (qs.length < PERSPECTIVE_POINTS) return withResiduals(input, similar, "similar")
  const perspective = fitPerspective(qs, bs)
  if (perspective && unfolded(multiply(perspective, centre), input)) return withResiduals(input, multiply(perspective, centre), "perspective")
  return withResiduals(input, similar, "similar", "the points do not make a perspective that keeps the image flat; scale and turn only")
}

function withResiduals(input: FitInput, matrix: Matrix3, kind: FitKind, note?: string): ReferenceFit {
  const residuals = input.points.map((p) => {
    const at = mapPoint(matrix, p.image)
    return Math.hypot(at.x - p.board.x, at.y - p.board.y)
  })
  return { matrix, kind, residuals, ...(note === undefined ? {} : { note }) }
}

/** The board box the image covers, from its four corners. */
export function referenceBox(m: Matrix3, width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const at = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((p) => mapPoint(m, p))
  const xs = at.map((p) => p.x)
  const ys = at.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
