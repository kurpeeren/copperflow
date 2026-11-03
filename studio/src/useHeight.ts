import { useEffect, useRef, useState } from "react"

/** Tracks the height of an element, for viewers that need a pixel height. */
export function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.max(200, Math.floor(entry.contentRect.height)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, height }
}
