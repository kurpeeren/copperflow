import { describe, expect, test } from "vitest"
import { INITIAL_GRID_STYLES } from "../studio/src/pcb/grid.js"
import { DEFAULT_THEME, THEME_KEY, applyTheme, loadTheme, parseTheme, saveTheme, themeGridStyle, themeToggles, withThemeGrid } from "../studio/src/shell/theme-state.js"

/** A storage that keeps what it is given, or throws on every use. */
function store(initial: Record<string, string> = {}, broken = false) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    storage: {
      getItem: (key: string) => {
        if (broken) throw new Error("blocked")
        return items.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        if (broken) throw new Error("blocked")
        items.set(key, value)
      },
    },
  }
}

describe("the theme switch", () => {
  test("Light until chosen", () => {
    expect(DEFAULT_THEME).toBe("light")
    expect(loadTheme(() => store().storage)).toBe("light")
  })

  test("only light and dark are themes; anything else reads as Light", () => {
    expect(parseTheme("dark")).toBe("dark")
    expect(parseTheme("light")).toBe("light")
    for (const value of [null, undefined, "", "Dark", "blue", 1]) expect(parseTheme(value)).toBe("light")
  })

  test("the choice is remembered per browser under one key", () => {
    const { items, storage } = store()
    expect(saveTheme(() => storage, "dark")).toBe(true)
    expect(items.get(THEME_KEY)).toBe("dark")
    expect(loadTheme(() => storage)).toBe("dark")
  })

  test("a blocked or missing storage falls back to Light and saving says it failed", () => {
    const { storage } = store({ [THEME_KEY]: "dark" }, true)
    expect(loadTheme(() => storage)).toBe("light")
    expect(saveTheme(() => storage, "dark")).toBe(false)
    expect(loadTheme(() => undefined)).toBe("light")
    expect(
      loadTheme(() => {
        throw new Error("no localStorage")
      }),
    ).toBe("light")
  })

  test("applying a theme sets data-theme on the root, which theme.css keys the dark tokens on", () => {
    const attributes = new Map<string, string>()
    const root = { setAttribute: (name: string, value: string) => void attributes.set(name, value) }
    applyTheme(root, "dark")
    expect(attributes.get("data-theme")).toBe("dark")
    applyTheme(root, "light")
    expect(attributes.get("data-theme")).toBe("light")
  })

  test("the View menu's pair: exactly one of Light and Dark is checked", () => {
    expect(themeToggles("light")).toEqual({ themeLight: true, themeDark: false })
    expect(themeToggles("dark")).toEqual({ themeLight: false, themeDark: true })
  })
})

describe("the grid style per theme", () => {
  test("the dark sheet has a dot grid, the light one lines", () => {
    expect(themeGridStyle("dark")).toBe("dots")
    expect(themeGridStyle("light")).toBe("lines")
  })

  test("switching the theme sets the schematic's grid style and leaves the PCB's", () => {
    const styles = { schematic: "lines", pcb: "dots" } as const
    expect(withThemeGrid(styles, "dark")).toEqual({ schematic: "dots", pcb: "dots" })
    expect(withThemeGrid({ ...styles, schematic: "dots" }, "light")).toEqual({ schematic: "lines", pcb: "dots" })
    expect(withThemeGrid(INITIAL_GRID_STYLES, "light")).toEqual(INITIAL_GRID_STYLES)
  })
})
