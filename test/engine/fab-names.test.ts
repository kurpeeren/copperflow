import { expect, test } from "vitest"
import { designName, fabFileName, fabFolderName, fabZipName, GERBER_LAYERS, OTHER_FILES } from "../../src/engine/fab/names.js"

test("the design's name comes from its circuit file, without folders", () => {
  expect(designName("can-module.circuit.tsx")).toBe("can-module")
  expect(designName("boards/main.circuit.tsx")).toBe("main")
  expect(designName("boards\\main.circuit.tsx")).toBe("main")
})

test("the files follow JLCPCB's names, in a folder and a zip named after the design", () => {
  expect([...GERBER_LAYERS, ...OTHER_FILES].map((file) => fabFileName("can", file))).toEqual([
    "can-F_Cu.gtl",
    "can-In1_Cu.g2",
    "can-In2_Cu.g3",
    "can-B_Cu.gbl",
    "can-F_Mask.gts",
    "can-B_Mask.gbs",
    "can-F_Paste.gtp",
    "can-B_Paste.gbp",
    "can-F_Silkscreen.gto",
    "can-B_Silkscreen.gbo",
    "can-Edge_Cuts.gm1",
    "can-PTH.drl",
    "can-NPTH.drl",
    "can-pick-and-place.csv",
    "can-bom.csv",
  ])
  expect(fabFolderName("can")).toBe("can-fab")
  expect(fabZipName("can")).toBe("can-fab.zip")
})
