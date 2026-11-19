// The Files tab's logic: the tree from the server's flat list, which rows show for the open folders, the tree keys, what
// a click does per kind, the row's menu, and the Files sub-tab of Project Design.
import { describe, expect, test } from "vitest"
import type { FileEntry, FileListing } from "../src/studio/file-list.js"
import { previewKind } from "../src/studio/file-kinds.js"
import {
  absolutePath,
  buildFileTree,
  fileAction,
  fileIconKind,
  fileMenu,
  formatSize,
  openForProject,
  rootName,
  toggleOpen,
  treeKey,
  visibleRows,
  wrapsLines,
} from "../studio/src/shell/files-tree.js"
import { showDesignSub } from "../studio/src/shell/strip-state.js"
import { NOT_IN_DESKTOP } from "../studio/src/shell/desktop-bridge.js"

const entry = (path: string, kind: FileEntry["kind"] = "file", size = 10): FileEntry => ({ path, kind, size, modified: "2026-11-19T00:00:00.000Z" })
const LISTING: FileListing = {
  root: "C:\\work\\blinky",
  truncated: false,
  entries: [
    entry(".copperflow", "dir"),
    entry(".copperflow/history", "dir"),
    entry(".copperflow/history/1.json"),
    entry("parts", "dir"),
    entry("parts/R1", "dir"),
    entry("parts/R1/part.yaml"),
    entry("main.circuit.tsx"),
    entry("PROJECT.md"),
  ],
}
const tree = buildFileTree(LISTING)
const paths = (open: ReadonlySet<string>) => visibleRows(tree.nodes, open).map((row) => `${row.depth} ${row.node.path}`)

describe("the tree", () => {
  test("nests the flat list under its folders and names the root", () => {
    expect(tree.name).toBe("blinky")
    expect(tree.nodes.map((node) => node.path)).toEqual([".copperflow", "parts", "main.circuit.tsx", "PROJECT.md"])
    expect(tree.nodes[1]!.children.map((node) => node.path)).toEqual(["parts/R1"])
  })

  test("rootName takes the last folder of either kind of path", () => {
    expect(rootName("/home/a/board/")).toBe("board")
    expect(rootName("C:\\work\\blinky")).toBe("blinky")
  })

  test("every folder starts closed, .copperflow included; an open folder shows its children one level deeper", () => {
    expect(paths(new Set())).toEqual(["1 .copperflow", "1 parts", "1 main.circuit.tsx", "1 PROJECT.md"])
    expect(paths(new Set(["parts", "parts/R1"]))).toEqual(["1 .copperflow", "1 parts", "2 parts/R1", "3 parts/R1/part.yaml", "1 main.circuit.tsx", "1 PROJECT.md"])
  })

  test("a child of a closed folder stays hidden even when its own folder is open", () => {
    expect(paths(new Set(["parts/R1"]))).toEqual(["1 .copperflow", "1 parts", "1 main.circuit.tsx", "1 PROJECT.md"])
  })

  test("toggleOpen gives a new set and leaves the old one", () => {
    const before = new Set(["parts"])
    expect([...toggleOpen(before, "parts")]).toEqual([])
    expect([...toggleOpen(before, "art")]).toEqual(["parts", "art"])
    expect([...before]).toEqual(["parts"])
  })

  test("the open folders are kept per project: another root starts closed", () => {
    const kept = { root: "C:\\work\\blinky", open: new Set(["parts"]) }
    expect(openForProject(kept, "C:\\work\\blinky")).toBe(kept)
    expect(openForProject(kept, "C:\\work\\other")).toEqual({ root: "C:\\work\\other", open: new Set() })
  })
})

describe("tree keys", () => {
  const open = new Set(["parts"])
  const rows = visibleRows(tree.nodes, open)

  test("Up and Down move between the visible rows and stop at the ends; Home and End jump", () => {
    expect(treeKey("ArrowDown", rows, "parts")).toEqual({ focus: "parts/R1" })
    expect(treeKey("ArrowUp", rows, "parts")).toEqual({ focus: ".copperflow" })
    expect(treeKey("ArrowUp", rows, ".copperflow")).toEqual({ focus: ".copperflow" })
    expect(treeKey("ArrowDown", rows, "PROJECT.md")).toEqual({ focus: "PROJECT.md" })
    expect(treeKey("Home", rows, "PROJECT.md")).toEqual({ focus: ".copperflow" })
    expect(treeKey("End", rows, "parts")).toEqual({ focus: "PROJECT.md" })
  })

  test("Right opens a closed folder, enters an open one, and does nothing on a file", () => {
    expect(treeKey("ArrowRight", rows, ".copperflow")).toEqual({ toggle: ".copperflow" })
    expect(treeKey("ArrowRight", rows, "parts")).toEqual({ focus: "parts/R1" })
    expect(treeKey("ArrowRight", rows, "PROJECT.md")).toBeNull()
  })

  test("Left closes an open folder, else goes to the parent; at the top level it stays", () => {
    expect(treeKey("ArrowLeft", rows, "parts")).toEqual({ toggle: "parts" })
    expect(treeKey("ArrowLeft", rows, "parts/R1")).toEqual({ focus: "parts" })
    expect(treeKey("ArrowLeft", rows, "PROJECT.md")).toBeNull()
  })

  test("Enter acts on the row; other keys and a missing row are not the tree's", () => {
    expect(treeKey("Enter", rows, "PROJECT.md")).toEqual({ act: "PROJECT.md" })
    expect(treeKey("x", rows, "PROJECT.md")).toBeNull()
    expect(treeKey("ArrowDown", rows, "gone.txt")).toEqual({ focus: ".copperflow" })
    expect(treeKey("ArrowDown", [], "gone.txt")).toBeNull()
  })
})

describe("what a click does", () => {
  test("a circuit opens its schematic, a sheet opens as the Page tree opens it", () => {
    expect(fileAction(entry("boards/main.circuit.tsx"))).toEqual({ kind: "document", file: "boards/main.circuit.tsx", view: "schematic" })
    expect(fileAction(entry("power.sheet.tsx"))).toEqual({ kind: "document", file: "power.sheet.tsx", view: "schematic" })
  })

  test("images and text kinds open the preview; other files, links and folders do not", () => {
    expect(fileAction(entry("pics/board.PNG"))).toEqual({ kind: "preview", preview: "image" })
    expect(fileAction(entry("art/logo.svg"))).toEqual({ kind: "preview", preview: "image" })
    for (const name of ["PROJECT.md", "rules.yaml", "parts/R1/R1.tsx", "fab/top.gtl", "fab/board.drl", "a.kicad_pcb", "bom.csv"]) {
      expect([name, fileAction(entry(name))]).toEqual([name, { kind: "preview", preview: "text" }])
    }
    for (const name of ["board-fab.zip", "board.html", "board.step", "board.glb"]) expect([name, fileAction(entry(name))]).toEqual([name, { kind: "none" }])
    expect(fileAction(entry("out.md", "link"))).toEqual({ kind: "none" })
    expect(fileAction(entry("parts", "dir"))).toEqual({ kind: "toggle" })
  })

  test("the kind rules are the server's", () => {
    expect(previewKind("x.gbo")).toBe("text")
    expect(previewKind("x.webp")).toBe("image")
    expect(previewKind("folder.png/readme")).toBeUndefined()
  })

  test("each kind has an icon", () => {
    expect(["parts", "main.circuit.tsx", "a.sheet.tsx", "x.png", "x.md", "x.zip"].map((path) => fileIconKind(entry(path, path === "parts" ? "dir" : "file")))).toEqual(["folder", "circuit", "sheet", "image", "markdown", "archive"])
    expect(fileIconKind(entry("out", "link"))).toBe("link")
  })
})

describe("the row menu", () => {
  test("a row that opens something offers Open, Copy path and Show in folder", () => {
    expect(fileMenu(entry("PROJECT.md"), true)).toEqual([
      { label: "Open", action: "open" },
      { label: "Copy path", action: "copy" },
      { label: "Show in folder", action: "show" },
    ])
  })

  test("a row that opens nothing has no Open; in a browser Show in folder is off with the reason", () => {
    expect(fileMenu(entry("board-fab.zip"), false)).toEqual([
      { label: "Copy path", action: "copy" },
      { label: "Show in folder", action: "show", pending: NOT_IN_DESKTOP },
    ])
    expect(fileMenu(entry("parts", "dir"), true).map((item) => item.label)).toEqual(["Copy path", "Show in folder"])
  })

  test("the copied path is absolute, with the root's own separator", () => {
    expect(absolutePath("C:\\work\\blinky", "parts/R1/part.yaml")).toBe("C:\\work\\blinky\\parts\\R1\\part.yaml")
    expect(absolutePath("/home/a/board", "parts/R1/part.yaml")).toBe("/home/a/board/parts/R1/part.yaml")
  })

  test("sizes read in bytes, kB and MB", () => {
    expect(formatSize(512)).toBe("512 B")
    expect(formatSize(1536)).toBe("1.5 kB")
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB")
  })
})

describe("the Files sub-tab", () => {
  test("shows on Project Design like the others", () => {
    expect(showDesignSub("files")).toEqual({ strip: "design", sub: "files", open: true })
  })
})

describe("the preview wraps prose only", () => {
  test("wraps Markdown and plain text, and keeps a data file's lines whole", () => {
    expect(wrapsLines("PROJECT.md")).toBe(true)
    expect(wrapsLines("notes/read me.TXT")).toBe(true)
    expect(wrapsLines("board-fab/board-F_Cu.gtl")).toBe(false)
    expect(wrapsLines("board-bom.csv")).toBe(false)
    expect(wrapsLines("rules.yaml")).toBe(false)
  })
})

describe("each kind of file has its own icon, by its name", () => {
  const icon = (path: string) => fileIconKind({ path, kind: "file" })

  test("a circuit, a sheet and a layout are not taken for code or JSON", () => {
    expect(["usb.circuit.tsx", "power.sheet.tsx", "usb.circuit.layout.json", "parts/U1/U1.tsx", "x.json"].map(icon)).toEqual(["circuit", "sheet", "layout", "code", "config"])
  })

  test("the fabrication files: every Gerber layer, the drills, the pick-and-place table, the model", () => {
    expect(["b-F_Cu.gtl", "b-B_Mask.gbs", "b-Edge_Cuts.gm1", "b.GBR", "b-PTH.drl", "b-pick-and-place.csv", "b.step", "b.glb"].map(icon)).toEqual(["gerber", "gerber", "gerber", "gerber", "drill", "table", "model", "model"])
  })

  test("documents, pictures, archives and anything unknown", () => {
    expect(["PROJECT.md", "rules.yaml", "ds.pdf", "logo.SVG", "b.html", "b-fab.zip", "log.txt", "a.kicad_pcb", "noext", "x.bin"].map(icon)).toEqual(["markdown", "config", "pdf", "image", "web", "archive", "text", "layout", "file", "file"])
  })
})
