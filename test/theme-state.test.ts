import { describe, expect, test } from "vitest"
import { INITIAL_GRID_STYLES } from "../studio/src/pcb/grid.js"
import { readFileSync } from "node:fs"
import { DEFAULT_THEME, THEME_KEY, applyTheme, browserStore, gridAfterThemeChoice, loadTheme, parseTheme, saveTheme, themeGridStyle, themeToggles, withThemeGrid } from "../studio/src/shell/theme-state.js"

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

  test("outside a browser there is no storage, and the theme is Light", () => {
    expect(browserStore()).toBeUndefined()
    expect(loadTheme(browserStore)).toBe("light")
    expect(saveTheme(browserStore, "dark")).toBe(false)
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

describe("choosing the theme that is already on", () => {
  test("leaves the grid style alone; a real change sets the schematic's", () => {
    const styles = { schematic: "lines", pcb: "lines" } as const
    expect(gridAfterThemeChoice(styles, "dark", "dark")).toBe(styles)
    expect(gridAfterThemeChoice(styles, "light", "dark")).toEqual({ schematic: "dots", pcb: "lines" })
    expect(gridAfterThemeChoice({ schematic: "dots", pcb: "lines" }, "dark", "light")).toEqual({ schematic: "lines", pcb: "lines" })
  })
})

describe("the theme before the first paint", () => {
  const html = readFileSync(new URL("../studio/index.html", import.meta.url), "utf8")
  const head = html.slice(0, html.indexOf("</head>"))
  const inline = /<script>([\s\S]*?)<\/script>/.exec(head)?.[1] ?? ""

  /** Runs the inline script against a storage and a root, and returns the data-theme it set, if any. */
  function boot(stored: string | null | Error): string | undefined {
    let set: string | undefined
    const localStorage = {
      getItem: (key: string) => {
        if (stored instanceof Error) throw stored
        return key === THEME_KEY ? stored : null
      },
    }
    const document = { documentElement: { setAttribute: (name: string, value: string) => void (name === "data-theme" && (set = value)) } }
    new Function("localStorage", "document", inline)(localStorage, document)
    return set
  }

  test("index.html sets the remembered theme in <head>, ahead of the module script that loads the CSS", () => {
    expect(inline).toContain(THEME_KEY)
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('<script type="module"'))
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"))
  })

  test("only a remembered Dark is applied; anything else, or a blocked storage, leaves the page light", () => {
    expect(boot("dark")).toBe("dark")
    for (const stored of ["light", null, "Dark", new Error("blocked")]) expect(boot(stored)).toBeUndefined()
  })
})
