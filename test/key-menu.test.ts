import { describe, expect, test } from "vitest"
import type { Camera, PartBox } from "../studio/src/pcb/geometry.js"
import { keyMenuPlace } from "../studio/src/pcb/key-menu.js"
import { returnsFocus } from "../studio/src/shell/focus.js"
import { shortcutList } from "../studio/src/shell/menus.js"

const CAMERA: Camera = { cx: 0, cy: 0, scale: 10 }
const SIZE = { width: 200, height: 100 }
const RECT = { left: 50, top: 20, width: 200, height: 100 }
// R1's box is centred at (2, 1) in the world, so 20 px right of and 10 px above the canvas centre.
const BOXES: PartBox[] = [{ name: "R1", pcbComponentId: "R1", center: { x: 9, y: 9 }, box: { minX: 1, minY: 0, maxX: 3, maxY: 2 } }]

describe("keyMenuPlace", () => {
  test("opens on the primary selected part, at the centre of its box, in client pixels", () => {
    expect(keyMenuPlace("R1", BOXES, CAMERA, SIZE, RECT)).toEqual({ target: { kind: "part", name: "R1" }, at: { x: 50 + 120, y: 20 + 40 } })
  })

  test("with nothing selected, or a part this view does not draw, opens on the canvas at its centre", () => {
    expect(keyMenuPlace(undefined, BOXES, CAMERA, SIZE, RECT)).toEqual({ target: { kind: "canvas" }, at: { x: 150, y: 70 } })
    expect(keyMenuPlace("C9", BOXES, CAMERA, SIZE, RECT)).toEqual({ target: { kind: "canvas" }, at: { x: 150, y: 70 } })
  })

  test("a part scrolled out of sight opens the menu at the canvas's edge, and a zoomed page scales the point", () => {
    const far = { ...CAMERA, cx: -50 }
    expect(keyMenuPlace("R1", BOXES, far, SIZE, RECT).at).toEqual({ x: 250, y: 60 })
    expect(keyMenuPlace(undefined, BOXES, CAMERA, SIZE, { left: 0, top: 0, width: 400, height: 200 }).at).toEqual({ x: 200, y: 100 })
  })

  test("on a selected wire, opens the wire's menu at the middle of its middle segment", () => {
    const wire = { id: "wire:W", points: [{ x: 0, y: 2 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: -2 }] }
    expect(keyMenuPlace(undefined, BOXES, CAMERA, SIZE, RECT, wire)).toEqual({ target: { kind: "wire", id: "wire:W" }, at: { x: 50 + 120, y: 20 + 50 } })
  })

  test("Help → Keys names Shift+F10", () => {
    expect(shortcutList().map((row) => row.keys)).toContain("Shift+F10")
  })
})

describe("returnsFocus", () => {
  const body = { name: "body" } as unknown as Element
  const item = { name: "item" } as unknown as Element
  const field = { name: "field" } as unknown as Element
  const menu = { contains: (node: Node | null) => node === (item as unknown as Node) }

  test("a closing menu gives the focus back while it is still in the menu or on nothing", () => {
    expect(returnsFocus(item, body, menu)).toBe(true)
    expect(returnsFocus(body, body, menu)).toBe(true)
    expect(returnsFocus(null, body, menu)).toBe(true)
  })

  test("a field an item focused keeps it", () => {
    expect(returnsFocus(field, body, menu)).toBe(false)
  })
})
