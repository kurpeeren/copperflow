import { expect, test } from "vitest"
import { CircuitCodeError, evaluateCircuit } from "../../src/engine/evaluate.js"
import type { CfElement, ComponentFunction } from "../../src/engine/jsx-runtime.js"

const board = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`

test("evaluates the board and records where each element is written", () => {
  const text = board(`    <resistor name="R1" footprint="0402" />`)
  const { root } = evaluateCircuit({ "main.circuit.tsx": text }, "main.circuit.tsx")
  expect(root.type).toBe("board")
  const r1 = root.children[0] as CfElement
  expect(r1).toMatchObject({ type: "resistor", props: { name: "R1", footprint: "0402" } })
  expect(r1.source).toEqual({ file: "main.circuit.tsx", line: 3, column: 5, offset: text.indexOf("<resistor") })
})

test("offsets count CRLF line endings", () => {
  const text = board(`    <resistor name="R1" />`).replaceAll("\n", "\r\n")
  const { root } = evaluateCircuit({ "main.circuit.tsx": text }, "main.circuit.tsx")
  expect((root.children[0] as CfElement).source?.offset).toBe(text.indexOf("<resistor"))
})

test(".map() and imported constants produce elements", () => {
  const files = {
    "shared.ts": "export const COUNT = 3",
    "main.circuit.tsx": `import { COUNT } from "./shared"\n` + board(`{Array.from({ length: COUNT }, (_, i) => <resistor name={"R" + i} />)}`),
  }
  expect(evaluateCircuit(files, "main.circuit.tsx").root.children).toHaveLength(3)
})

test("function components are kept for the elaborator, with the module that defined them", () => {
  const files = {
    "parts/X/X.tsx": `export const X = (props: { name: string }) => <chip footprint="soic8" {...props} />`,
    "main.circuit.tsx": `import { X } from "./parts/X/X"\n` + board(`<X name="U1" />`),
  }
  const { root, definedIn } = evaluateCircuit(files, "main.circuit.tsx")
  const u1 = root.children[0] as CfElement
  expect(typeof u1.type).toBe("function")
  expect(definedIn(u1.type as ComponentFunction)).toBe("parts/X/X.tsx")
})

test("imports may name only project files and copperflow", () => {
  const files = { "main.circuit.tsx": `import React from "react"\nvoid React\n` + board("") }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/imports may name only project files and copperflow; "react" is not allowed/)
})

test("a relative import may not leave the project", () => {
  const files = { "main.circuit.tsx": `import x from "../secret"\nvoid x\n` + board("") }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/outside the project/)
})

test("syntax errors name the file, line and column", () => {
  const files = { "main.circuit.tsx": "export default () => <board>\n" }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/^main\.circuit\.tsx:\d+:\d+: /)
})

test("circuit code cannot reach Node", () => {
  const files = { "main.circuit.tsx": "export default () => { process.exit(1) }" }
  const run = () => evaluateCircuit(files, "main.circuit.tsx")
  expect(run).toThrow(/process is not defined/)
  expect(run).toThrow(CircuitCodeError)
  expect(run).toThrow(/^main\.circuit\.tsx: /)
})

test("a throw inside an imported module is prefixed with that module's path", () => {
  const files = {
    "parts/bad.ts": "throw new Error(\"boom\")",
    "main.circuit.tsx": `import "./parts/bad"\n` + board(""),
  }
  const run = () => evaluateCircuit(files, "main.circuit.tsx")
  expect(run).toThrow(CircuitCodeError)
  expect(run).toThrow(/^parts\/bad\.ts: boom/)
})

test("the default export must be a component or an element", () => {
  const files = { "main.circuit.tsx": "export default 42" }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/must export default a function that returns <board>/)
})
