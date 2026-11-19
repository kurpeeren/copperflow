import { describe, expect, test } from "vitest"
import {
  BOTTOM_MIN_HEIGHT,
  CANVAS_MIN_WIDTH,
  DEFAULT_PANEL_SIZES,
  KEY_STEP,
  KEY_STEP_LARGE,
  PANEL_SIZES_KEY,
  SIDE_MIN_WIDTH,
  STRIPS_WIDTH,
  bottomLimits,
  dragSize,
  keySize,
  loadPanelSizes,
  parseStoredSizes,
  savePanelSizes,
  shownSizes,
  sideLimits,
} from "../studio/src/shell/panel-sizes.js"

const WIDE = { width: 1920, height: 1080 }
const LAPTOP = { width: 1280, height: 720 }
const BOTH_OPEN = { left: true, right: true }

/** A storage that keeps what it is given, as localStorage does. */
function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  }
}

describe("panel limits", () => {
  test("a side panel runs from 180px to 45% of the window", () => {
    expect(sideLimits(WIDE, 0)).toEqual({ min: SIDE_MIN_WIDTH, max: 864 })
    expect(SIDE_MIN_WIDTH).toBe(180)
  })

  test("a side panel never leaves the canvas less than 320px beside the strips and the other panel", () => {
    // 1280 - 48 of strips - 320 of canvas - 600 of the other panel leaves 312, under 45% (576).
    expect(sideLimits(LAPTOP, 600).max).toBe(LAPTOP.width - STRIPS_WIDTH - CANVAS_MIN_WIDTH - 600)
    expect(CANVAS_MIN_WIDTH).toBe(320)
  })

  test("the minimum wins when the window has no room for more", () => {
    expect(sideLimits({ width: 700, height: 600 }, 400)).toEqual({ min: 180, max: 180 })
  })

  test("the bottom panel runs from 120px to 60% of the window's height", () => {
    expect(bottomLimits(LAPTOP)).toEqual({ min: BOTTOM_MIN_HEIGHT, max: 432 })
    expect(BOTTOM_MIN_HEIGHT).toBe(120)
    expect(bottomLimits({ width: 800, height: 150 })).toEqual({ min: 120, max: 120 })
  })
})

describe("the sizes shown for the remembered ones", () => {
  test("the defaults show as they are on a wide window", () => {
    expect(shownSizes(DEFAULT_PANEL_SIZES, WIDE, BOTH_OPEN)).toEqual({ left: 262, right: 262, bottom: 240 })
    expect(DEFAULT_PANEL_SIZES).toEqual({ left: 262, right: 262, bottom: 240 })
  })

  test("each size is kept within its own limits", () => {
    expect(shownSizes({ left: 50, right: 2000, bottom: 2000 }, WIDE, BOTH_OPEN)).toEqual({ left: 180, right: 864, bottom: 648 })
    expect(shownSizes({ left: 300, right: 300, bottom: 10 }, WIDE, BOTH_OPEN).bottom).toBe(120)
  })

  test("when both open sides would squeeze the canvas, each gives up room by how far it is above its minimum", () => {
    const shown = shownSizes({ left: 500, right: 380, bottom: 240 }, LAPTOP, BOTH_OPEN)
    // Room for both: 1280 - 48 - 320 = 912; asked 880 fits.
    expect(shown).toEqual({ left: 500, right: 380, bottom: 240 })
    const tight = shownSizes({ left: 480, right: 380, bottom: 240 }, { width: 1100, height: 720 }, BOTH_OPEN)
    // Room 732, asked 860: 128 to give up, from excesses 300 and 200 (3/5 and 2/5).
    expect(tight.left + tight.right).toBe(1100 - STRIPS_WIDTH - CANVAS_MIN_WIDTH)
    expect(tight).toEqual({ left: 403, right: 329, bottom: 240 })
  })

  test("a closed side takes no room, so the open one may use it", () => {
    const shown = shownSizes({ left: 500, right: 500, bottom: 240 }, { width: 1100, height: 720 }, { left: true, right: false })
    expect(shown.left).toBe(495)
    // The closed side keeps its own limits for when it opens again.
    expect(shown.right).toBe(495)
  })

  test("a smaller window shrinks the panels smoothly and a larger one gives the remembered sizes back", () => {
    const preferred = { left: 400, right: 262, bottom: 300 }
    let last = shownSizes(preferred, WIDE, BOTH_OPEN).left
    for (let width = 1900; width >= 961; width -= 1) {
      const left = shownSizes(preferred, { width, height: 1080 }, BOTH_OPEN).left
      expect(Math.abs(left - last)).toBeLessThanOrEqual(1)
      last = left
    }
    expect(shownSizes(preferred, WIDE, BOTH_OPEN)).toEqual(preferred)
  })
})

describe("dragging a splitter", () => {
  const limits = { min: 180, max: 600 }

  test("the left splitter follows the pointer, the right one grows the panel when moved left, the bottom one when moved up", () => {
    expect(dragSize("left", 262, 40, limits)).toBe(302)
    expect(dragSize("right", 262, 40, limits)).toBe(222)
    expect(dragSize("right", 262, -40, limits)).toBe(302)
    expect(dragSize("bottom", 240, -60, { min: 120, max: 432 })).toBe(300)
  })

  test("a drag stops at the limits and lands on whole pixels", () => {
    expect(dragSize("left", 262, -500, limits)).toBe(180)
    expect(dragSize("left", 262, 5000, limits)).toBe(600)
    expect(dragSize("left", 262, 10.6, limits)).toBe(273)
  })
})

describe("a splitter's keys", () => {
  const limits = { min: 180, max: 600 }

  test("Left and Right move a side splitter by 16px, 64px with Shift", () => {
    expect(keySize("left", { key: "ArrowRight", shiftKey: false }, 262, limits)).toBe(262 + KEY_STEP)
    expect(keySize("left", { key: "ArrowLeft", shiftKey: true }, 262, limits)).toBe(262 - KEY_STEP_LARGE)
    expect(keySize("right", { key: "ArrowLeft", shiftKey: false }, 262, limits)).toBe(278)
    expect(keySize("right", { key: "ArrowRight", shiftKey: false }, 262, limits)).toBe(246)
    expect([KEY_STEP, KEY_STEP_LARGE]).toEqual([16, 64])
  })

  test("Up and Down move the bottom splitter; Up makes the panel taller", () => {
    expect(keySize("bottom", { key: "ArrowUp", shiftKey: false }, 240, limits)).toBe(256)
    expect(keySize("bottom", { key: "ArrowDown", shiftKey: true }, 240, limits)).toBe(180)
  })

  test("a side splitter ignores Up and Down, the bottom one Left and Right", () => {
    expect(keySize("left", { key: "ArrowUp", shiftKey: false }, 262, limits)).toBeNull()
    expect(keySize("bottom", { key: "ArrowLeft", shiftKey: false }, 240, limits)).toBeNull()
    expect(keySize("left", { key: "a", shiftKey: false }, 262, limits)).toBeNull()
  })

  test("Home and End go to the limits, Enter back to the default size", () => {
    expect(keySize("left", { key: "Home", shiftKey: false }, 262, limits)).toBe(180)
    expect(keySize("right", { key: "End", shiftKey: false }, 262, limits)).toBe(600)
    expect(keySize("left", { key: "Enter", shiftKey: false }, 400, limits)).toBe(262)
    expect(keySize("bottom", { key: "Enter", shiftKey: false }, 400, limits)).toBe(240)
  })

  test("with Ctrl, Alt or Meta the key is not the splitter's, so the Studio's shortcuts still work", () => {
    for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(keySize("left", { key: "ArrowRight", shiftKey: false, ...modifier }, 262, limits)).toBeNull()
      expect(keySize("bottom", { key: "Home", shiftKey: false, ...modifier }, 240, limits)).toBeNull()
    }
  })

  test("a move stops at the limits", () => {
    expect(keySize("left", { key: "ArrowLeft", shiftKey: true }, 200, limits)).toBe(180)
    expect(keySize("left", { key: "ArrowRight", shiftKey: true }, 590, limits)).toBe(600)
  })
})

describe("the remembered sizes", () => {
  test("a stored value is read field by field; anything damaged reads as that field's default", () => {
    expect(parseStoredSizes('{"left":300,"right":420,"bottom":200}')).toEqual({ left: 300, right: 420, bottom: 200 })
    expect(parseStoredSizes('{"left":"wide","right":-5,"bottom":1e9}')).toEqual(DEFAULT_PANEL_SIZES)
    expect(parseStoredSizes('{"left":300.4}')).toEqual({ left: 300, right: 262, bottom: 240 })
    for (const text of [null, "", "not json", "[1,2]", "null", "42"]) expect([text, parseStoredSizes(text)]).toEqual([text, DEFAULT_PANEL_SIZES])
  })

  test("a size under the minimum is raised to it; window limits are applied when shown, not when read", () => {
    expect(parseStoredSizes('{"left":100,"right":3000,"bottom":50}')).toEqual({ left: 180, right: 3000, bottom: 120 })
  })

  test("sizes are saved under their own key and read back", () => {
    const store = memoryStore()
    expect(savePanelSizes(() => store, { left: 320, right: 280, bottom: 200 })).toBe(true)
    expect(store.items.get(PANEL_SIZES_KEY)).toBe('{"left":320,"right":280,"bottom":200}')
    expect(loadPanelSizes(() => store)).toEqual({ left: 320, right: 280, bottom: 200 })
    expect(PANEL_SIZES_KEY).toBe("copperflow.panels")
  })

  test("no storage, or blocked storage, gives the defaults and a false save", () => {
    const blocked = () => {
      throw new Error("blocked")
    }
    const throwing = { getItem: blocked, setItem: blocked }
    expect(loadPanelSizes(() => undefined)).toEqual(DEFAULT_PANEL_SIZES)
    expect(loadPanelSizes(blocked)).toEqual(DEFAULT_PANEL_SIZES)
    expect(loadPanelSizes(() => throwing)).toEqual(DEFAULT_PANEL_SIZES)
    expect(savePanelSizes(() => undefined, DEFAULT_PANEL_SIZES)).toBe(false)
    expect(savePanelSizes(() => throwing, DEFAULT_PANEL_SIZES)).toBe(false)
  })
})
