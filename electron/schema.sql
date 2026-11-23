CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, teacher TEXT NOT NULL, type TEXT NOT NULL,
  archived INTEGER NOT NULL, color_index INTEGER NOT NULL, note TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  id TEXT NOT NULL, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  start INTEGER NOT NULL CHECK(start BETWEEN 1 AND 16),
  end INTEGER NOT NULL CHECK(end BETWEEN start AND 16), location TEXT NOT NULL,
  weeks TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(course_id,id)
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL, notes TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL,
  reminder_minutes INTEGER, reminder_notified_at INTEGER, created_at TEXT NOT NULL,
  done_at TEXT, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_course ON assignments(course_id);
CREATE INDEX IF NOT EXISTS assignments_due ON assignments(status,due_at);
CREATE INDEX IF NOT EXISTS materials_course ON materials(course_id);
PRAGMA user_version=2;
