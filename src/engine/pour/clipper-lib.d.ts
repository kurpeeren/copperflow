/** The part of clipper-lib 6.4 (Boost Software License 1.0) that the pour fill uses; the package ships no types. */
declare module "clipper-lib" {
  namespace ClipperLib {
    interface IntPoint {
      X: number
      Y: number
    }
    type Path = IntPoint[]
    type Paths = Path[]

    interface PolyNode {
      Contour(): Path
      Childs(): PolyNode[]
      IsHole(): boolean
    }

    interface ExPolygon {
      outer: Path
      holes: Paths
    }

    class PolyTree implements PolyNode {
      Contour(): Path
      Childs(): PolyNode[]
      IsHole(): boolean
    }

    class Clipper {
      constructor(initOptions?: number)
      StrictlySimple: boolean
      AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
      Execute(clipType: number, solution: Paths | PolyTree, subjFillType: number, clipFillType: number): boolean
      static Area(path: Path): number
      static Orientation(path: Path): boolean
      static PointInPolygon(point: IntPoint, path: Path): number
    }

    class ClipperOffset {
      constructor(miterLimit?: number, arcTolerance?: number)
      AddPaths(paths: Paths, joinType: number, endType: number): void
      Execute(solution: Paths, delta: number): void
    }

    const ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number }
    const PolyType: { ptSubject: number; ptClip: number }
    const PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number }
    const JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
    const EndType: { etOpenSquare: number; etOpenRound: number; etOpenButt: number; etClosedLine: number; etClosedPolygon: number }
    const JS: { PolyTreeToExPolygons(tree: PolyTree): ExPolygon[] }
  }
  export = ClipperLib
}
