import sqlite3
import json
from datetime import datetime
from pathlib import Path


class Memory:
    def __init__(self, db_path: str = "crypto_agent.db"):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self._init_tables()

    def _init_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS cron_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                cron_expr TEXT NOT NULL,
                next_run TIMESTAMP NOT NULL,
                enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        self.conn.commit()

    def save_message(self, role: str, content: str):
        self.conn.execute(
            "INSERT INTO conversations (role, content) VALUES (?, ?)",
            (role, content if isinstance(content, str) else json.dumps(content))
        )
        self.conn.commit()

    def load_recent_messages(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT role, content FROM conversations ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
        messages = []
        for role, content in reversed(rows):
            try:
                content = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                pass
            messages.append({"role": role, "content": content})
        return messages

    def add_cron_job(self, description: str, cron_expr: str, next_run: str) -> int:
        cursor = self.conn.execute(
            "INSERT INTO cron_jobs (description, cron_expr, next_run) VALUES (?, ?, ?)",
            (description, cron_expr, next_run)
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_due_cron_jobs(self) -> list[dict]:
        now = datetime.now().isoformat()
        rows = self.conn.execute(
            "SELECT id, description, cron_expr, next_run FROM cron_jobs WHERE enabled=1 AND next_run <= ?",
            (now,)
        ).fetchall()
        return [{"id": r[0], "description": r[1], "cron_expr": r[2], "next_run": r[3]} for r in rows]

    def update_cron_next_run(self, job_id: int, next_run: str):
        self.conn.execute("UPDATE cron_jobs SET next_run = ? WHERE id = ?", (next_run, job_id))
        self.conn.commit()

    def list_cron_jobs(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, description, cron_expr, next_run, enabled FROM cron_jobs ORDER BY id"
        ).fetchall()
        return [{"id": r[0], "description": r[1], "cron_expr": r[2], "next_run": r[3], "enabled": bool(r[4])} for r in rows]

    def delete_cron_job(self, job_id: int):
        self.conn.execute("DELETE FROM cron_jobs WHERE id = ?", (job_id,))
        self.conn.commit()

    def log_event(self, event_type: str, data: str = ""):
        self.conn.execute("INSERT INTO events (event_type, data) VALUES (?, ?)", (event_type, data))
        self.conn.commit()

    def close(self):
        self.conn.close()
