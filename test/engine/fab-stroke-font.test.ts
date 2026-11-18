import { expect, test } from "vitest"
import { textStrokes, undrawable } from "../../src/engine/fab/stroke-font.js"

const box = (lines: { x: number; y: number }[][]) => {
  const points = lines.flat()
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

test("draws every character a designator uses, centred on the point and as tall as asked", () => {
  const strokes = textStrokes("R10", { x: 5, y: 2 }, 1.2)
  expect(strokes.length).toBeGreaterThanOrEqual(3)
  const b = box(strokes)
  expect(b.minY).toBeCloseTo(1.4, 9)
  expect(b.maxY).toBeCloseTo(2.6, 9)
  expect((b.minX + b.maxX) / 2).toBeCloseTo(5, 9)
  for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_+./~()#") {
    expect(textStrokes(char, { x: 0, y: 0 }, 1).length, char).toBeGreaterThan(0)
  }
})

test("lower case has glyphs of its own, an unknown character is a box, and a space is nothing", () => {
  expect(textStrokes("r", { x: 0, y: 0 }, 1)).not.toEqual(textStrokes("R", { x: 0, y: 0 }, 1))
  for (const char of "abcdefghijklmnopqrstuvwxyz:%=,!") {
    expect(undrawable(char), char).toEqual([])
    expect(textStrokes(char, { x: 0, y: 0 }, 1).length, char).toBeGreaterThan(0)
  }
  // Lower case stands two thirds as tall as a capital.
  expect(box(textStrokes("x", { x: 0, y: 0 }, 1.2)).maxY).toBeCloseTo(-0.6 + 0.8, 9)
  expect(undrawable("Ré€ ok é")).toEqual(["é", "€"])
  expect(textStrokes("é", { x: 0, y: 0 }, 1)).toHaveLength(1)
  expect(textStrokes(" ", { x: 0, y: 0 }, 1)).toEqual([])
  expect(textStrokes("", { x: 0, y: 0 }, 1)).toEqual([])
})

test("mirrored text is the same text reversed left to right about the point", () => {
  const plain = textStrokes("U2", { x: 3, y: 0 }, 1)
  const mirrored = textStrokes("U2", { x: 3, y: 0 }, 1, true)
  expect(mirrored.map((line) => line.map((p) => ({ x: Math.round((6 - p.x) * 1e9) / 1e9, y: p.y })))).toEqual(
    plain.map((line) => line.map((p) => ({ x: Math.round(p.x * 1e9) / 1e9, y: p.y }))),
  )
})
