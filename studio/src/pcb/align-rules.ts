// Which align and distribute commands there are and how many parts each needs; no imports, so the menus, the
// context menu, the toolbar and the keys can all read it.

export const ALIGN_COMMANDS = ["alignLeft", "alignRight", "alignTop", "alignBottom", "alignHCentres", "alignVCentres", "distributeH", "distributeV"] as const
export type AlignCommand = (typeof ALIGN_COMMANDS)[number]

const DISTRIBUTES: ReadonlySet<string> = new Set(["distributeH", "distributeV"])

export const isAlignCommand = (command: string): command is AlignCommand => (ALIGN_COMMANDS as readonly string[]).includes(command)

/** The fewest selected parts the command works on: two to align, three to distribute (the ends stay, the rest are spaced). */
export const partsNeeded = (command: AlignCommand): 2 | 3 => (DISTRIBUTES.has(command) ? 3 : 2)

/** Why the command cannot run with `count` parts selected, or null when it can. */
export function alignDisabledReason(command: AlignCommand, count: number): string | null {
  if (count >= partsNeeded(command)) return null
  return partsNeeded(command) === 2 ? "Select two or more parts" : "Select three or more parts"
}
