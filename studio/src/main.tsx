import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { installKeyGate } from "./shell/key-gate"
import { applyTheme, browserStore, loadTheme } from "./shell/theme-state"
import "./styles.css"
import "./shell/theme.css"
import "./shell/hairline.css"

// Before anything renders, so the gate's listener runs ahead of every other key listener on the window.
installKeyGate(window)
// The remembered theme is on the root before the first paint, so a dark Studio never flashes light.
applyTheme(document.documentElement, loadTheme(browserStore))

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
