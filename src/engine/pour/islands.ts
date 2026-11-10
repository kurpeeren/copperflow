import { boundsOf, boxesMeet, intersection, type Path, type Region } from "./clip.js"

/**
 * The pieces of a fill that touch the net: those that overlap at least one anchor, the outline of a piece of the
 * pour's own net's copper on the layer (a pad, a track segment as a capsule, a via's disc), grown a hair so copper
 * that only meets the piece's edge counts too. The rest are islands. A piece is measured against the anchors whose
 * boxes meet its own, all in one intersection.
 */
export function connectedPieces(pieces: readonly Region[], anchors: readonly Path[]): Region[] {
  const anchorBoxes = anchors.map((anchor) => boundsOf([anchor]))
  return pieces.filter((piece) => {
    const box = boundsOf([piece.outer])
    const near = anchors.filter((_, i) => {
      const anchorBox = anchorBoxes[i]
      return anchorBox !== undefined && boxesMeet(box, anchorBox)
    })
    return near.length > 0 && intersection([piece.outer, ...piece.holes], near).length > 0
  })
}
