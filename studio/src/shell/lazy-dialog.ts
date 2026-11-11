// Dialogs loaded on first open. Plain TypeScript (createElement, no JSX) so the tests can run it.
import { Component, createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react"

/**
 * A loader that keeps its first success but not a failure, so the next call imports again. React.lazy alone keeps a
 * rejected import for good, and a dialog could then never open without reloading the Studio.
 */
export function retryingLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export interface RetryingComponent<P> {
  /** The lazy component to render now. */
  component(): ComponentType<P>
  /** After a failed load: a new lazy component, whose first render imports again. */
  retry(): void
}

export function lazyRetrying<P extends object>(load: () => Promise<ComponentType<P>>): RetryingComponent<P> {
  const loader = retryingLoader(load)
  const make = () => lazy(() => loader().then((loaded) => ({ default: loaded })))
  let current = make()
  return {
    component: () => current,
    retry: () => {
      current = make()
    },
  }
}

/** The message in place of a dialog that could not load, with Retry. */
export function DialogLoadFailed({ what, message, onRetry }: { what: string; message: string; onRetry(): void }) {
  return createElement(
    "div",
    { role: "alert" },
    createElement("p", null, `The ${what} dialog could not open (${message}). Check that the Studio is still running, then try again; if it fails again, reload the Studio.`),
    createElement("button", { type: "button", onClick: onRetry }, "Retry"),
  )
}

interface BoundaryProps {
  what: string
  onRetry(): void
  /** Called on each render, so a retry renders the component made after it. */
  render(): ReactNode
}

/** Keeps a dialog's failure inside the dialog: the rest of the Studio stays up. */
export class DialogBoundary extends Component<BoundaryProps, { error?: Error }> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error) {
      const retry = () => {
        this.props.onRetry()
        this.setState({ error: undefined })
      }
      return createElement(DialogLoadFailed, { what: this.props.what, message: error.message, onRetry: retry })
    }
    return createElement(Suspense, { fallback: createElement("p", null, "Loading…") }, this.props.render())
  }
}
