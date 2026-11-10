import { afterEach, describe, expect, test } from "vitest"
import type { Design } from "../studio/src/api.js"
import { designWithSavedRadius, forgetRulesWrite, latestRulesWrite, noteRulesWrite } from "../studio/src/pcb/rules-writes.js"
import { filletRadius } from "../src/engine/rules/track-defaults.js"
import { loadRules } from "../src/engine/rules/load.js"

const designWith = (radius?: number): Design => {
  const rules = loadRules({}).rules
  return { rules: { ...rules, fabrication: radius === undefined ? rules.fabrication : { ...rules.fabrication, filletRadius: radius } } } as unknown as Design
}
const radiusOf = (design: Design) => filletRadius(design.rules)

afterEach(forgetRulesWrite)

describe("the fillet radius saved before its build lands", () => {
  test("nothing saved leaves the design as it is", () => {
    const design = designWith(2)
    expect(designWithSavedRadius(design, latestRulesWrite(), 5)).toBe(design)
  })

  test("a saved radius is used while the shown build started before the write (or is unknown)", () => {
    noteRulesWrite({ radius: 1.5, mark: 10 })
    expect(radiusOf(designWithSavedRadius(designWith(), latestRulesWrite(), 9))).toBe(1.5)
    expect(radiusOf(designWithSavedRadius(designWith(), latestRulesWrite(), 10))).toBe(1.5)
    expect(radiusOf(designWithSavedRadius(designWith(3), latestRulesWrite(), undefined))).toBe(1.5)
  })

  test("once a build that started after the write is shown, the design's own radius is used", () => {
    noteRulesWrite({ radius: 1.5, mark: 10 })
    const design = designWith(1.5)
    expect(designWithSavedRadius(design, latestRulesWrite(), 11)).toBe(design)
  })

  test("saving the default (null) puts the default radius back over an older one", () => {
    noteRulesWrite({ radius: null, mark: 4 })
    const shown = designWithSavedRadius(designWith(3), latestRulesWrite(), 3)
    expect(shown.rules.fabrication.filletRadius).toBeUndefined()
    expect(radiusOf(shown)).toBe(1)
  })

  test("the newest write wins", () => {
    noteRulesWrite({ radius: 1.5, mark: 4 })
    noteRulesWrite({ radius: 2.5, mark: 6 })
    expect(radiusOf(designWithSavedRadius(designWith(), latestRulesWrite(), 5))).toBe(2.5)
  })
})
