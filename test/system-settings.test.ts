import { describe, expect, test } from "vitest"
import { DEFAULT_SYSTEM, loadSystem, parseSystem, saveSystem, SYSTEM_KEY } from "../studio/src/shell/system-settings.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"

function memoryStore() {
  const kept = new Map<string, string>()
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), kept }
}

describe("Settings → System", () => {
  test("is an item the app runs", () => {
    const settings = MENUS.find((menu) => menu.title === "Settings")
    expect(settings && menuItems(settings)[0]).toEqual({ label: "System…", command: "systemSettings" })
    expect(commandOwner("systemSettings")).toBe("app")
  })

  test("keeps the unit and the grid steps per browser and reads them back", () => {
    const store = memoryStore()
    expect(loadSystem(() => store)).toEqual(DEFAULT_SYSTEM)
    expect(saveSystem(() => store, { unit: "mil", grid: { schematic: 0.05, pcb: 1 } })).toBe(true)
    expect(JSON.parse(store.kept.get(SYSTEM_KEY) ?? "")).toEqual({ unit: "mil", grid: { schematic: 0.05, pcb: 1 } })
    expect(loadSystem(() => store)).toEqual({ unit: "mil", grid: { schematic: 0.05, pcb: 1 } })
  })

  test("a broken or unknown value reads as the default, and blocked storage never throws", () => {
    expect(parseSystem("not json")).toEqual(DEFAULT_SYSTEM)
    expect(parseSystem(JSON.stringify({ unit: "inch", grid: { schematic: 7, pcb: "x" } }))).toEqual(DEFAULT_SYSTEM)
    const blocked = () => {
      throw new Error("blocked")
    }
    expect(loadSystem(blocked)).toEqual(DEFAULT_SYSTEM)
    expect(saveSystem(blocked, DEFAULT_SYSTEM)).toBe(false)
    expect(saveSystem(() => undefined, DEFAULT_SYSTEM)).toBe(false)
  })
})
