import { useEffect } from "react"

const VENDOR_LABEL = /^@tscircuit\/[\w-]+@/

/**
 * Hides the package-and-version labels tscircuit's viewers print in their menus. Their MIT
 * licence asks for the licence text to ship with the code (see dist/app/THIRD_PARTY_LICENSES.txt),
 * not for an on-screen label. Menus render in portals, so the whole document is watched.
 */
export function useHideVendorLabels(): void {
  useEffect(() => {
    const hide = () => {
      for (const element of document.body.querySelectorAll<HTMLElement>("div, span")) {
        if (element.childElementCount === 0 && VENDOR_LABEL.test(element.textContent ?? "")) element.style.display = "none"
      }
    }
    hide()
    const observer = new MutationObserver(hide)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}
