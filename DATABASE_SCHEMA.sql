PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','organizer','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Societies (
  society_id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'Published' CHECK (status IN ('Draft','Published','Completed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (society_id) REFERENCES Societies(society_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS Venues (
  venue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_name TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  availability_status TEXT NOT NULL DEFAULT 'Available' CHECK (availability_status IN ('Available','Maintenance','Unavailable')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Registrations (
  registration_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  reg_status TEXT NOT NULL DEFAULT 'Registered' CHECK (reg_status IN ('Registered','Cancelled','Attended')),
  FOREIGN KEY (user_id) REFERENCES Users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES Events(event_id) ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS Bookings (
  booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  venue_id INTEGER NOT NULL,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  booking_status TEXT NOT NULL DEFAULT 'Confirmed' CHECK (booking_status IN ('Pending','Confirmed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES Events(event_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (venue_id) REFERENCES Venues(venue_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_events_date ON Events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_society ON Events(society_id);
CREATE INDEX IF NOT EXISTS idx_registrations_user ON Registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON Registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_date ON Bookings(venue_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_event ON Bookings(event_id);
