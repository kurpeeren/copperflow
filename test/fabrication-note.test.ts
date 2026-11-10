import { describe, expect, test } from "vitest"
import { fabricationNote } from "../studio/src/shell/fabrication-note.js"

const FILES = Array.from({ length: 13 }, (_, i) => `led-${i}.gbr`)

describe("the note after Export → Fabrication files", () => {
  test("names the folder, the zip and the upload step", () => {
    expect(fabricationNote({ written: true, folder: "boards/led-fab", zip: "boards/led-fab.zip", files: FILES, warnings: [] })).toBe(
      "Wrote 13 fabrication files to boards/led-fab/ and boards/led-fab.zip. Upload led-fab.zip to JLCPCB.",
    )
  })

  test("adds each warning, a long list cut to its first three items", () => {
    const warnings = [
      "5 connections are not routed: net.A: R1#1 to R2#1, net.B: R1#2 to R2#2, net.C: U1#1 to U1#2, net.D: J1#1 to U1#3, net.E: J1#2 to U1#4",
      "1 part has no footprint and is not in the pick-and-place: X1",
    ]
    expect(fabricationNote({ written: true, folder: "led-fab", zip: "led-fab.zip", files: FILES, warnings })).toBe(
      "Wrote 13 fabrication files to led-fab/ and led-fab.zip. Upload led-fab.zip to JLCPCB. " +
        "Warning: 5 connections are not routed: net.A: R1#1 to R2#1, net.B: R1#2 to R2#2, net.C: U1#1 to U1#2 and 2 more. " +
        "Warning: 1 part has no footprint and is not in the pick-and-place: X1.",
    )
  })

  test("a refusal says nothing was written and why", () => {
    expect(fabricationNote({ written: false, errors: ["duplicate-name: More than one part is named RX (RX)", "short: GND and VCC are joined (GND, VCC)"] })).toBe(
      "No fabrication files written: duplicate-name: More than one part is named RX (RX); short: GND and VCC are joined (GND, VCC)",
    )
  })
})
