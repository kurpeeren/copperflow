// Bundles the Node renderer (studio/src/render/node-render.ts) to dist/render/render.js for the CLI and the MCP
// server's render. The canvas package stays outside the bundle: it is an optional dependency with a native binary.
// So does earcut (the triangles of a model file), an ordinary dependency that keeps its own licence file.
import { build } from "esbuild"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

await build({
  absWorkingDir: root,
  entryPoints: ["studio/src/render/node-render.ts"],
  outfile: "dist/render/render.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@napi-rs/canvas", "earcut"],
  logLevel: "warning",
})
