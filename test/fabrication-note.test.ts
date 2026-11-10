import { describe, expect, test } from "vitest"
import { fabricationNote } from "../studio/src/shell/fabrication-note.js"

const FILES = [...Array.from({ length: 11 }, (_, i) => `led-${i}.gbr`), "led-pick-and-place.csv", "led-bom.csv"]
const written = (warnings: string[]) => ({ written: true as const, folder: "led-fab", zip: "led-fab.zip", files: FILES, warnings })

describe("the note after Export → Fabrication files", () => {
  test("names the folder, the zip for the PCB order and the two CSVs for the assembly step", () => {
    expect(fabricationNote({ written: true, folder: "boards/led-fab", zip: "boards/led-fab.zip", files: FILES, warnings: [] })).toBe(
      "Wrote 13 fabrication files to boards/led-fab/ and boards/led-fab.zip. Upload led-fab.zip to JLCPCB's PCB order, and led-bom.csv and led-pick-and-place.csv from boards/led-fab/ at its assembly step (the zip holds them too).",
    )
  })

  test("adds each warning in full", () => {
    const warnings = [
      "5 connections are not routed: net.A: R1#1 to R2#1, net.B: R1#2 to R2#2, net.C: U1#1 to U1#2, net.D: J1#1 to U1#3, net.E: J1#2 to U1#4",
      "1 part has no footprint and is not in the pick-and-place: X1",
    ]
    expect(fabricationNote(written(warnings))).toBe(
      "Wrote 13 fabrication files to led-fab/ and led-fab.zip. Upload led-fab.zip to JLCPCB's PCB order, and led-bom.csv and led-pick-and-place.csv from led-fab/ at its assembly step (the zip holds them too). " +
        "Warning: 5 connections are not routed: net.A: R1#1 to R2#1, net.B: R1#2 to R2#2, net.C: U1#1 to U1#2, net.D: J1#1 to U1#3, net.E: J1#2 to U1#4. " +
        "Warning: 1 part has no footprint and is not in the pick-and-place: X1.",
    )
  })

  test("shows the first three warnings and counts the rest", () => {
    expect(fabricationNote(written(["a", "b", "c", "d", "e"]))).toBe(
      "Wrote 13 fabrication files to led-fab/ and led-fab.zip. Upload led-fab.zip to JLCPCB's PCB order, and led-bom.csv and led-pick-and-place.csv from led-fab/ at its assembly step (the zip holds them too). Warning: a. Warning: b. Warning: c. And 2 more warnings.",
    )
    expect(fabricationNote(written(["a", "b", "c", "d"]))).toMatch(/Warning: c\. And 1 more warning\.$/)
  })

  test("a refusal says nothing was written and why", () => {
    expect(fabricationNote({ written: false, errors: ["duplicate-name: More than one part is named RX (RX)", "short: GND and VCC are joined (GND, VCC)"] })).toBe(
      "No fabrication files written: duplicate-name: More than one part is named RX (RX); short: GND and VCC are joined (GND, VCC)",
    )
  })
})
