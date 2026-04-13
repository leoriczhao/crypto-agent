import { randomUUID } from "node:crypto";

export type SessionType = "user" | "system";

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  messages: any[];
  createdAt: Date;
  lastActiveAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private _activeId: string | null = null;

  create(name: string, type: SessionType, id?: string): Session {
    const session: Session = {
      id: id ?? randomUUID(),
      name,
      type,
      messages: [],
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(session.id, session);
    if (this._activeId === null) {
      this._activeId = session.id;
    }
    return session;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    return s;
  }

  getByName(name: string): Session | undefined {
    for (const s of this.sessions.values()) {
      if (s.name === name) return s;
    }
    return undefined;
  }

  get active(): Session {
    if (!this._activeId) throw new Error("No active session");
    return this.get(this._activeId);
  }

  get activeId(): string {
    if (!this._activeId) throw new Error("No active session");
    return this._activeId;
  }

  setActive(id: string): void {
    this.get(id); // validate existence
    this._activeId = id;
  }

  list(typeFilter?: SessionType): Session[] {
    const all = [...this.sessions.values()];
    return typeFilter ? all.filter((s) => s.type === typeFilter) : all;
  }

  delete(id: string): void {
    if (this._activeId === id) {
      this._activeId = null;
    }
    this.sessions.delete(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  touch(id: string): void {
    const s = this.get(id);
    s.lastActiveAt = new Date();
  }
}
