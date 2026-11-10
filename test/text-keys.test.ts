import { describe, expect, test } from "vitest"
import type { Point } from "../studio/src/pcb/geometry.js"
import type { PartText } from "../studio/src/pcb/part-text.js"
import { textKeys } from "../studio/src/pcb/text-keys.js"

const NAME: PartText = { id: "R1:schNameAt", part: "R1", prop: "schNameAt", text: "R1", at: { x: 0, y: 1 }, offset: { x: 0, y: 1 }, box: { minX: -0.1, maxX: 0.1, minY: 0.9, maxY: 1.1 } }

/** A send that waits until the test lets it go, and remembers what was written in order. */
function sender() {
  const sent: Point[] = []
  const waiting: ((ok: boolean) => void)[] = []
  const send = (_text: PartText, at: Point) => {
    sent.push(at)
    return new Promise<boolean>((resolve) => waiting.push(resolve))
  }
  const resolveNext = async (ok = true) => {
    waiting.shift()?.(ok)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { sent, send, resolveNext }
}

const find = (id: string) => (id === NAME.id ? NAME : undefined)
const right = { x: 0.1, y: 0 }

describe("arrow keys on a name or value", () => {
  test("presses while a move is in flight are merged into one move, sent from the latest place when it resolves", async () => {
    const s = sender()
    const keys = textKeys(s.send)
    const design = {}
    expect(keys.press(design, find, NAME.id, right)).toEqual({ x: 0.1, y: 1 })
    for (let i = 0; i < 29; i++) keys.press(design, find, NAME.id, right)
    expect(s.sent).toEqual([{ x: 0.1, y: 1 }])
    await s.resolveNext()
    expect(s.sent).toHaveLength(2)
    expect(s.sent[1]?.x).toBeCloseTo(3, 9)
    await s.resolveNext()
    expect(s.sent).toHaveLength(2)
  })

  test("a press after the move resolved on the same design goes on from the burst's total", async () => {
    const s = sender()
    const keys = textKeys(s.send)
    const design = {}
    keys.press(design, find, NAME.id, right)
    await s.resolveNext()
    keys.press(design, find, NAME.id, right)
    expect(s.sent.map((p) => p.x)).toEqual([0.1, 0.2])
  })

  test("a failed move ends the burst: the next press starts from the text as drawn", async () => {
    const s = sender()
    const keys = textKeys(s.send)
    const design = {}
    keys.press(design, find, NAME.id, right)
    keys.press(design, find, NAME.id, right)
    await s.resolveNext(false)
    expect(s.sent).toHaveLength(1)
    keys.press(design, find, NAME.id, right)
    expect(s.sent.map((p) => p.x)).toEqual([0.1, 0.1])
  })

  test("a text that is gone sends nothing", () => {
    const s = sender()
    expect(textKeys(s.send).press({}, find, "Q9:schNameAt", right)).toBeUndefined()
    expect(s.sent).toEqual([])
  })
})
