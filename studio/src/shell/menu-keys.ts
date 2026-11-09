// The menu bar's keys, as the WAI-ARIA menubar pattern has them. The titles are one tab stop: Left and Right move
// between them (and switch the open menu), Down, Enter or Space open a menu at its first enabled item, Up at its last
// (a menu with none opens at its first or last item). In an open menu Up and Down step through the items, disabled
// ones too, skipping separators and wrapping; Home and End jump to the ends; Esc
// closes it and goes back to its title; Tab closes it and lets the focus move on. Enter and Space on an item are the
// item's own click, so they are not decided here.

/** Where the focus is in the menu bar: a menu's title (item null) or one of its entries, by index. */
export interface MenuFocus {
  menu: number
  item: number | null
}

export interface MenuKeyResult {
  /** The menu open afterwards, by index, or null for none. */
  open: number | null
  /** Where the focus goes; "keep" leaves it where it is. */
  focus: MenuFocus | "keep"
  /** False for Tab, whose default moves the focus on. */
  preventDefault: boolean
}

/** One entry of a menu: an item that runs, a disabled item (it takes the focus but does nothing), or a separator. */
export type MenuSlot = "item" | "disabled" | "separator"
export type MenuShape = readonly MenuSlot[]

const wrap = (index: number, count: number) => (index + count) % count
const anyItem = (slot: MenuSlot | undefined) => slot === "item" || slot === "disabled"

/** The entry `step` places from `from` that `wanted` accepts; from null, the first (step 1) or last (step -1) one. */
function stepItem(shape: MenuShape, from: number | null, step: 1 | -1, wanted: (slot: MenuSlot | undefined) => boolean = anyItem): number | null {
  const count = shape.length
  let index = from ?? (step === 1 ? -1 : count)
  for (let tries = 0; tries < count; tries++) {
    index = wrap(index + step, count)
    if (wanted(shape[index])) return index
  }
  return null
}

const firstItem = (shape: MenuShape | undefined) => (shape ? stepItem(shape, null, 1) : null)
const lastItem = (shape: MenuShape | undefined) => (shape ? stepItem(shape, null, -1) : null)
/** Where a menu opens: its first (or last) enabled item, else its first (or last) item. */
const openingItem = (shape: MenuShape | undefined, step: 1 | -1) => (shape ? (stepItem(shape, null, step, (slot) => slot === "item") ?? stepItem(shape, null, step)) : null)
const firstOpen = (shape: MenuShape | undefined) => openingItem(shape, 1)
const lastOpen = (shape: MenuShape | undefined) => openingItem(shape, -1)
const result = (open: number | null, focus: MenuFocus | "keep", preventDefault = true): MenuKeyResult => ({ open, focus, preventDefault })
/** Opens `menu` with the focus on `item`, or on its title when it has no items. */
const openAt = (menu: number, item: number | null) => result(menu, { menu, item })

function onTitle(key: string, menu: number, open: number | null, menus: readonly MenuShape[]): MenuKeyResult | null {
  const count = menus.length
  const sideways: Record<string, number> = { ArrowLeft: wrap(menu - 1, count), ArrowRight: wrap(menu + 1, count), Home: 0, End: count - 1 }
  const to = sideways[key]
  if (to !== undefined) return result(open === null ? null : to, { menu: to, item: null })
  if (key === "ArrowDown") return openAt(menu, firstOpen(menus[menu]))
  if (key === "ArrowUp") return openAt(menu, lastOpen(menus[menu]))
  if (open === null) return null
  if (key === "Escape") return result(null, { menu, item: null })
  return key === "Tab" ? result(null, "keep", false) : null
}

function onItem(key: string, at: { menu: number; item: number }, menus: readonly MenuShape[]): MenuKeyResult | null {
  const shape = menus[at.menu] ?? []
  const count = menus.length
  const within: Record<string, number | null> = {
    ArrowDown: stepItem(shape, at.item, 1),
    ArrowUp: stepItem(shape, at.item, -1),
    Home: firstItem(shape),
    End: lastItem(shape),
  }
  if (key in within) return openAt(at.menu, within[key] ?? null)
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const to = wrap(at.menu + (key === "ArrowLeft" ? -1 : 1), count)
    return openAt(to, firstOpen(menus[to]))
  }
  if (key === "Escape") return result(null, { menu: at.menu, item: null })
  // Back to the title first, so Tab's own move starts from the menu bar and leaves it.
  return key === "Tab" ? result(null, { menu: at.menu, item: null }, false) : null
}

/** A key while the focus is elsewhere and a menu is open (it was opened with the mouse, which gives the focus up). */
function fromOutside(key: string, open: number, menus: readonly MenuShape[]): MenuKeyResult | null {
  if (key === "Escape") return result(null, "keep")
  if (key === "Tab") return result(null, "keep", false)
  if (key === "ArrowDown" || key === "Home") return openAt(open, firstOpen(menus[open]))
  if (key === "ArrowUp" || key === "End") return openAt(open, lastOpen(menus[open]))
  if (key === "ArrowLeft" || key === "ArrowRight") return result(wrap(open + (key === "ArrowLeft" ? -1 : 1), menus.length), "keep")
  return null
}

/** The modifier keys held with a press. */
export interface Modifiers {
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
}

/**
 * What `key` does with the focus `at` (null when it is outside the menu bar) and menu `open`; null when it is not a menu key.
 * With Alt, Ctrl or Meta held nothing is the menu's (Alt+Left must still go back in the browser), Tab excepted.
 */
export function menuKey(key: string, at: MenuFocus | null, open: number | null, menus: readonly MenuShape[], modifiers: Modifiers = {}): MenuKeyResult | null {
  if (menus.length === 0) return null
  if ((modifiers.alt || modifiers.ctrl || modifiers.meta) && key !== "Tab") return null
  if (at === null) return open === null ? null : fromOutside(key, open, menus)
  if (at.item === null) return onTitle(key, at.menu, open, menus)
  return onItem(key, { menu: at.menu, item: at.item }, menus)
}

/** Where a menu opened with Enter or Space on its title puts the focus. */
export function firstMenuItem(shape: MenuShape | undefined): number | null {
  return firstOpen(shape)
}
