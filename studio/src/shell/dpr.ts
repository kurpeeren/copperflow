// The device pixel ratio as a CSS custom property, so a hairline (hairline.css) can scale a 1px line down to one
// device pixel at any display scale: 100%, 110%, 125%, 150%, and after a browser zoom.

/** The `--dpr` property for this ratio; a missing or broken ratio counts as 1. */
export function dprStyle(ratio: number): { "--dpr": string } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return { "--dpr": String(safe) }
}

/**
 * Sets `--dpr` on the root element and keeps it current: a window resize, and a change of the media query that
 * matches the present ratio (a zoom, or a move to a screen with another scale). Returns the function that stops it.
 */
export function watchDpr(win: Window): () => void {
  const root = win.document.documentElement
  let query: MediaQueryList | undefined
  const apply = () => {
    for (const [name, value] of Object.entries(dprStyle(win.devicePixelRatio))) root.style.setProperty(name, value)
    query?.removeEventListener("change", apply)
    query = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`)
    query.addEventListener("change", apply)
  }
  apply()
  win.addEventListener("resize", apply)
  return () => {
    win.removeEventListener("resize", apply)
    query?.removeEventListener("change", apply)
  }
}
