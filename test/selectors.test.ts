import { expect, test } from "vitest"
import { partsInSelector } from "../src/core/selectors.js"

test("extracts part names from tscircuit selectors", () => {
  expect(partsInSelector(".R1 > .pin1")).toEqual(["R1"])
  expect(partsInSelector("U1.VIN")).toEqual(["U1"])
  expect(partsInSelector("net.GND")).toEqual([])
  expect(partsInSelector(".J1 > .A5, .J1 > .B5")).toEqual(["J1"])
})
