// Who has asked for the Packages dialog, if anyone: the menu, the Library panel, a footprint manager row or the
// inspector open it from wherever they are, and the app shows it over everything else, the footprint manager included.
import type { PackagesPurpose } from "./packages-choice.js"

export interface PackagesRequest {
  purpose: PackagesPurpose
  /** What the part is ("resistor"), for its colours in 3D. */
  kind?: string
  /** The string shown first: the part's footprint now. */
  initial?: string
  /** Called with the chosen string when the purpose is to use one. */
  choose?(footprint: string): void
}

let request: PackagesRequest | undefined
const listeners = new Set<() => void>()

function set(next: PackagesRequest | undefined): void {
  request = next
  for (const listener of listeners) listener()
}

export const packagesRequests = {
  open(next: PackagesRequest): void {
    set(next)
  },
  close(): void {
    set(undefined)
  },
  current: (): PackagesRequest | undefined => request,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Opened from the menu or the Library: to look and copy. */
export const openPackagesToLook = (): void => packagesRequests.open({ purpose: { kind: "look" } })
