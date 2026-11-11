// File → New circuit…, as plain data: the name and board size typed in the dialog checked and turned into the request
// the server writes through the core (an empty `<name>.circuit.tsx` with a board of that size, one history entry). Pure.

export const NEW_BOARD = { width: 30, height: 20 }
const MAX_BOARD_MM = 1000
const NAME = /^[\w\- ]+(\/[\w\- ]+)*$/

export interface NewCircuitRequest {
  file: string
  width: number
  height: number
}

/** The request, or what is wrong with the fields. A name may have folders (boards/power) and may end in .circuit.tsx. */
export function newCircuitRequest(name: string, width: string, height: string): NewCircuitRequest | { message: string } {
  const base = name.trim().replace(/\.circuit\.tsx$/, "")
  if (base === "") return { message: "Give the circuit a name" }
  if (!NAME.test(base)) return { message: "Use letters, digits, spaces, - and _ in the name, and / between folders" }
  const size = [Number(width), Number(height)]
  if (size.some((value) => !Number.isFinite(value) || value <= 0 || value > MAX_BOARD_MM)) return { message: `The board's width and height are mm above 0 and at most ${MAX_BOARD_MM}` }
  return { file: `${base}.circuit.tsx`, width: size[0] as number, height: size[1] as number }
}
