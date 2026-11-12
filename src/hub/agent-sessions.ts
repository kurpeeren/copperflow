// The agents' MCP sessions at the hub: who opened each, with which credential (a personal token or an OAuth grant), and
// how to close it. Revoking a credential or a user closes their sessions at once, which ends any open stream.

export interface AgentSessionEntry {
  userId: string
  credential: string
  close: () => void
}

export class AgentSessions {
  private readonly sessions = new Map<string, AgentSessionEntry>()

  add(id: string, entry: AgentSessionEntry): void {
    this.sessions.set(id, entry)
  }

  get(id: string): AgentSessionEntry | undefined {
    return this.sessions.get(id)
  }

  /** Forgets a session that closed itself. */
  forget(id: string): void {
    this.sessions.delete(id)
  }

  get size(): number {
    return this.sessions.size
  }

  private closeWhere(match: (entry: AgentSessionEntry) => boolean): number {
    const doomed = [...this.sessions].filter(([, entry]) => match(entry))
    for (const [id, entry] of doomed) {
      this.sessions.delete(id)
      entry.close()
    }
    return doomed.length
  }

  closeUser(userId: string): number {
    return this.closeWhere((entry) => entry.userId === userId)
  }

  closeCredential(credential: string): number {
    return this.closeWhere((entry) => entry.credential === credential)
  }

  closeAll(): void {
    this.closeWhere(() => true)
  }
}
