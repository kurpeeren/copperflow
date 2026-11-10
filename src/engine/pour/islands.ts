import { regionHolds, type IntPoint, type Region } from "./clip.js"

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boundsOf(region: Region): Bounds {
  return region.outer.reduce(
    (b, p) => ({ minX: Math.min(b.minX, p.X), minY: Math.min(b.minY, p.Y), maxX: Math.max(b.maxX, p.X), maxY: Math.max(b.maxY, p.Y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

const inBounds = (b: Bounds, p: IntPoint) => p.X >= b.minX && p.X <= b.maxX && p.Y >= b.minY && p.Y <= b.maxY

/**
 * The pieces of a fill that touch the net: those holding (inside or on the edge) at least one anchor, a point of the
 * pour's own net's copper (a pad's centre and corners, a via's centre, a track's points). The rest are islands.
 */
export function connectedPieces(pieces: readonly Region[], anchors: readonly IntPoint[]): Region[] {
  return pieces.filter((piece) => {
    const bounds = boundsOf(piece)
    return anchors.some((anchor) => inBounds(bounds, anchor) && regionHolds(piece, anchor))
  })
}
