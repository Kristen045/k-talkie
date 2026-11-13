"""Database: a small SQLite file (data/ktalkie.db). No server to install.

SQL cheat sheet used in this project:
  CREATE TABLE  -> make a table (like a spreadsheet tab)
  INSERT        -> add a row
  SELECT        -> read rows
  UPDATE        -> change a row
  DELETE        -> remove a row
The "?" in queries is a placeholder: values are passed separately so
nobody can sneak in harmful SQL (this is called SQL injection protection).
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.getenv("KTALKIE_DB") or Path(__file__).resolve().parent.parent / "data" / "ktalkie.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tutor       TEXT NOT NULL,                 -- 'yuri' or 'joohyuk'
    mode        TEXT NOT NULL DEFAULT 'teacher',  -- teacher | friend | custom
    custom_role TEXT,                          -- e.g. 'cafe waiter' (only for custom)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,             -- 'user' or 'tutor'
    korean          TEXT NOT NULL,             -- what was said (user text, or tutor's Korean)
    burmese         TEXT NOT NULL DEFAULT '',  -- tutor's Burmese explanation
    tip             TEXT NOT NULL DEFAULT '',  -- tutor's correction / tip
    check_score     INTEGER,                   -- grammar score 0-100 (user messages only)
    check_corrected TEXT,                      -- corrected sentence, if any
    check_note      TEXT,                      -- Burmese explanation of the mistake
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@contextmanager
def get_db():
    """Open the database, save changes when done, always close it."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row          # rows behave like dictionaries
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as db:
        db.executescript(SCHEMA)
        # Older database files lack the grammar columns: add them (a "migration").
        have = {r["name"] for r in db.execute("PRAGMA table_info(messages)")}
        for col, ddl in [("check_score", "INTEGER"), ("check_corrected", "TEXT"), ("check_note", "TEXT")]:
            if col not in have:
                db.execute(f"ALTER TABLE messages ADD COLUMN {col} {ddl}")
