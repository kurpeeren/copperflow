// A dense linear solve by Gaussian elimination with partial pivoting: the systems are a few hundred unknowns at most.

/** Below this a pivot is taken as zero: the system has no single solution. */
const SINGULAR = 1e-300

/** x with A x = b, A row-major n x n; undefined when A is singular. A and b are not changed. */
export function solveLinear(matrix: Float64Array, rhs: Float64Array, n: number): Float64Array | undefined {
  const a = Float64Array.from(matrix)
  const b = Float64Array.from(rhs)
  for (let col = 0; col < n; col++) {
    let pivot = col
    let best = Math.abs(a[col * n + col] ?? 0)
    for (let row = col + 1; row < n; row++) {
      const size = Math.abs(a[row * n + col] ?? 0)
      if (size > best) {
        best = size
        pivot = row
      }
    }
    if (best < SINGULAR) return undefined
    if (pivot !== col) {
      for (let k = col; k < n; k++) {
        const held = a[col * n + k] ?? 0
        a[col * n + k] = a[pivot * n + k] ?? 0
        a[pivot * n + k] = held
      }
      const held = b[col] ?? 0
      b[col] = b[pivot] ?? 0
      b[pivot] = held
    }
    const diagonal = a[col * n + col] ?? 1
    for (let row = col + 1; row < n; row++) {
      const factor = (a[row * n + col] ?? 0) / diagonal
      if (factor === 0) continue
      for (let k = col; k < n; k++) a[row * n + k] = (a[row * n + k] ?? 0) - factor * (a[col * n + k] ?? 0)
      b[row] = (b[row] ?? 0) - factor * (b[col] ?? 0)
    }
  }
  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row] ?? 0
    for (let k = row + 1; k < n; k++) sum -= (a[row * n + k] ?? 0) * (x[k] ?? 0)
    x[row] = sum / (a[row * n + row] ?? 1)
  }
  return x
}
