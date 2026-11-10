// The arrow keys on a part's name, value or designator selected alone: quick presses merge into bursts as a part's do
// (key-burst.ts). While one move is in flight the presses that follow are summed and sent as one move when it
// resolves, each from where the text was when the burst began, so the moves never race and the last one written is the
// latest place. Plain TypeScript with .js imports, so the tests can run it.
import type { Point } from "./geometry.js"
import { pressNudge, settleNudge, type Burst } from "./key-burst.js"
import type { PartText } from "./part-text.js"

/** Writes the text's middle at `at`, as one set_props edit; resolves whether it was written. */
export type SendText = (text: PartText, at: Point) => Promise<boolean>

export interface TextKeys {
  /**
   * An arrow press of `by` on the text: `base` is the design shown now (a new one ends a burst that is not in flight)
   * and `find` gives the text as drawn now, a burst's starting place. Returns where the text goes, for its preview.
   */
  press(base: object, find: (id: string) => PartText | undefined, id: string, by: Point): Point | undefined
}

export function textKeys(send: SendText): TextKeys {
  const state: { burst?: Burst<object>; text?: PartText } = {}
  const placeAfter = (text: PartText, total: Point): Point => ({ x: text.at.x + total.x, y: text.at.y + total.y })
  const write = (burst: Burst<object>, total: Point) => {
    const { text } = state
    if (!text) return
    void send(text, placeAfter(text, total)).then((ok) => {
      if (state.burst !== burst && state.burst?.base !== burst.base) return
      const next = state.burst ? settleNudge(state.burst, ok) : undefined
      state.burst = next?.burst
      if (next?.burst && next.send) write(next.burst, next.send)
    })
  }
  return {
    press(base, find, id, by) {
      const step = pressNudge(state.burst, base, [id], by)
      if (step.fresh) state.text = find(id)
      state.burst = step.burst
      if (!state.text) {
        state.burst = undefined
        return undefined
      }
      if (step.send) write(step.burst, step.send)
      return placeAfter(state.text, step.burst.total)
    },
  }
}
