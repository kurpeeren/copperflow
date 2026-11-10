// Locks on sub-sheet instances: a lock names an instance as it names a part, and holds every part inside it.

/** A sub-sheet instance as far as locks need it: its path and the flattened parts inside it. */
export interface InstanceParts {
  path: string
  parts: readonly string[]
}

/**
 * The locked parts with the parts of every locked instance added: a lock names an instance as it names a part, and a
 * locked instance locks all its parts (an instance inside it included).
 */
export function withInstanceParts(locked: ReadonlySet<string>, instances: readonly InstanceParts[] | undefined): Set<string> {
  const all = new Set(locked)
  for (const instance of instances ?? []) {
    const outer = instance.path.split("/")[0] ?? instance.path
    if (locked.has(instance.path) || locked.has(outer)) for (const part of instance.parts) all.add(part)
  }
  return all
}
