'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'campusconnect.db');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
// Local demo secret is randomized on each launch. Configure SESSION_SECRET for persistent sessions.
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('Production requires a strong SESSION_SECRET (32+ characters).');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = 12;

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(fs.readFileSync(path.join(ROOT, 'DATABASE_SCHEMA.sql'), 'utf8'));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, expectedHex] = String(stored || '').split(':');
    if (!salt || !expectedHex) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function seedDatabase() {
  const userCount = Number(db.prepare('SELECT COUNT(*) AS c FROM Users').get().c);
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO Users (full_name,email,password_hash,role) VALUES (?,?,?,?)');
    if (process.env.NODE_ENV === 'production') {
      const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 16) {
        throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and a 16+ character BOOTSTRAP_ADMIN_PASSWORD before first production start.');
      }
      insertUser.run('Campus Administrator', email, hashPassword(password), 'admin');
    } else {
      insertUser.run('Campus Admin', 'admin@campusconnect.local', hashPassword('Admin@123'), 'admin');
      insertUser.run('Event Organizer', 'organizer@campusconnect.local', hashPassword('Organizer@123'), 'organizer');
      insertUser.run('Demo Student', 'student@campusconnect.local', hashPassword('Student@123'), 'student');
    }
  }

  // Production must not automatically publish demo societies, events or personal records.
  if (process.env.NODE_ENV === 'production') return;

  const societyCount = Number(db.prepare('SELECT COUNT(*) AS c FROM Societies').get().c);
  if (societyCount === 0) {
    const insertSociety = db.prepare('INSERT INTO Societies (society_name,category,contact_email) VALUES (?,?,?)');
    insertSociety.run('ACM Society', 'Computing', 'acm@university.edu');
    insertSociety.run('AI Society', 'Technology', 'ai.society@university.edu');
    insertSociety.run('Career Society', 'Professional Development', 'career@university.edu');
  }

  const venueCount = Number(db.prepare('SELECT COUNT(*) AS c FROM Venues').get().c);
  if (venueCount === 0) {
    const insertVenue = db.prepare('INSERT INTO Venues (venue_name,location,capacity,availability_status) VALUES (?,?,?,?)');
    insertVenue.run('Main Auditorium', 'Academic Block A', 500, 'Available');
    insertVenue.run('Seminar Hall A', 'Academic Block B', 140, 'Available');
    insertVenue.run('CS Lab 2', 'Computing Block', 55, 'Available');
    insertVenue.run('Conference Room', 'Administration Block', 35, 'Maintenance');
  }

  const eventCount = Number(db.prepare('SELECT COUNT(*) AS c FROM Events').get().c);
  if (eventCount === 0) {
    const societies = db.prepare('SELECT society_id,society_name FROM Societies').all();
    const ids = Object.fromEntries(societies.map(s => [s.society_name, s.society_id]));
    const insertEvent = db.prepare(`
      INSERT INTO Events (society_id,title,description,event_date,start_time,end_time,capacity,status)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    insertEvent.run(ids['AI Society'], 'AI & Machine Learning Workshop', 'Hands-on workshop covering practical AI concepts and student projects.', '2026-11-05', '10:00', '12:00', 120, 'Published');
    insertEvent.run(ids['ACM Society'], 'Web Development Bootcamp', 'A focused session on modern web development fundamentals and project structure.', '2026-11-12', '09:30', '12:30', 50, 'Published');
    insertEvent.run(ids['Career Society'], 'Career & Internship Seminar', 'Industry speakers discuss internships, CV preparation and career planning.', '2026-11-20', '14:00', '16:00', 300, 'Published');
  }

  const bookingCount = Number(db.prepare('SELECT COUNT(*) AS c FROM Bookings').get().c);
  if (bookingCount === 0) {
    const aiEvent = db.prepare("SELECT event_id,event_date,start_time,end_time FROM Events WHERE title='AI & Machine Learning Workshop'").get();
    const seminar = db.prepare("SELECT venue_id FROM Venues WHERE venue_name='Seminar Hall A'").get();
    if (aiEvent && seminar) {
      db.prepare('INSERT INTO Bookings (event_id,venue_id,booking_date,start_time,end_time,booking_status) VALUES (?,?,?,?,?,?)')
        .run(aiEvent.event_id, seminar.venue_id, aiEvent.event_date, aiEvent.start_time, aiEvent.end_time, 'Confirmed');
    }
  }
}
seedDatabase();

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signSession(user) {
  const payload = {
    uid: user.user_id,
    role: user.role,
    exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  };
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySession(token) {
  try {
    const [encoded, sig] = String(token || '').split('.');
    if (!encoded || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    const user = db.prepare('SELECT user_id,full_name,email,role,created_at FROM Users WHERE user_id=?').get(payload.uid);
    return user || null;
  } catch {
    return null;
  }
}

function currentUser(req) {
  return verifySession(parseCookies(req).cc_session);
}

function requireAuth(req, res, roles = null) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Please log in first.' });
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    json(res, 403, { error: 'You do not have permission for this action.' });
    return null;
  }
  return user;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = '';
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function clean(value) {
  return String(value ?? '').trim();
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function safeDbError(err) {
  const msg = String(err?.message || err);
  if (msg.includes('UNIQUE constraint failed: Users.email')) return 'This email is already registered.';
  if (msg.includes('UNIQUE constraint failed: Societies.society_name')) return 'A society with this name already exists.';
  if (msg.includes('UNIQUE constraint failed: Venues.venue_name')) return 'A venue with this name already exists.';
  if (msg.includes('UNIQUE constraint failed: Registrations.user_id, Registrations.event_id')) return 'You are already registered for this event.';
  if (msg.includes('FOREIGN KEY constraint failed')) return 'This record is linked to other data and cannot be removed yet.';
  if (msg.includes('CHECK constraint failed')) return 'One or more values violate the database rules.';
  return 'Database operation failed.';
}

function eventWithDetailsWhere(where = '', params = []) {
  return db.prepare(`
    SELECT e.*, s.society_name,
           COALESCE((SELECT COUNT(*) FROM Registrations r WHERE r.event_id=e.event_id AND r.reg_status='Registered'),0) AS registration_count,
           b.booking_id, b.venue_id, b.booking_status,
           v.venue_name, v.location AS venue_location
    FROM Events e
    JOIN Societies s ON s.society_id=e.society_id
    LEFT JOIN Bookings b ON b.booking_id = (
      SELECT b2.booking_id FROM Bookings b2
      WHERE b2.event_id=e.event_id AND b2.booking_status!='Cancelled'
      ORDER BY CASE b2.booking_status WHEN 'Confirmed' THEN 0 ELSE 1 END, b2.booking_id DESC LIMIT 1
    )
    LEFT JOIN Venues v ON v.venue_id=b.venue_id
    ${where}
    ORDER BY e.event_date ASC, e.start_time ASC
  `).all(...params);
}

function registrationRows(where = '', params = []) {
  return db.prepare(`
    SELECT r.registration_id,r.user_id,r.event_id,r.registered_at,r.reg_status,
           u.full_name,u.email,e.title,e.event_date,e.start_time,e.end_time,
           s.society_name
    FROM Registrations r
    JOIN Users u ON u.user_id=r.user_id
    JOIN Events e ON e.event_id=r.event_id
    JOIN Societies s ON s.society_id=e.society_id
    ${where}
    ORDER BY r.registered_at DESC
  `).all(...params);
}

function bookingRows(where = '', params = []) {
  return db.prepare(`
    SELECT b.*, e.title AS event_title, e.capacity AS event_capacity,
           v.venue_name,v.location,v.capacity AS venue_capacity,
           s.society_name
    FROM Bookings b
    JOIN Events e ON e.event_id=b.event_id
    JOIN Venues v ON v.venue_id=b.venue_id
    JOIN Societies s ON s.society_id=e.society_id
    ${where}
    ORDER BY b.booking_date DESC,b.start_time DESC,b.booking_id DESC
  `).all(...params);
}

function bookingConflict({ venue_id, booking_date, start_time, end_time, exclude_booking_id = null }) {
  let sql = `SELECT b.booking_id,e.title FROM Bookings b JOIN Events e ON e.event_id=b.event_id
             WHERE b.venue_id=? AND b.booking_date=? AND b.booking_status!='Cancelled'
             AND ? < b.end_time AND ? > b.start_time`;
  const params = [venue_id, booking_date, start_time, end_time];
  if (exclude_booking_id) {
    sql += ' AND b.booking_id != ?';
    params.push(exclude_booking_id);
  }
  return db.prepare(sql).get(...params);
}

function validateEvent(body) {
  const society_id = positiveInt(body.society_id);
  const title = clean(body.title);
  const description = clean(body.description);
  const event_date = clean(body.event_date);
  const start_time = clean(body.start_time);
  const end_time = clean(body.end_time);
  const capacity = positiveInt(body.capacity);
  const status = clean(body.status || 'Published');
  if (!society_id || !title || !event_date || !start_time || !end_time || !capacity) return { error: 'Please fill all required event fields.' };
  if (start_time >= end_time) return { error: 'Event end time must be after start time.' };
  if (!['Draft','Published','Completed','Cancelled'].includes(status)) return { error: 'Invalid event status.' };
  if (!db.prepare('SELECT 1 FROM Societies WHERE society_id=?').get(society_id)) return { error: 'Selected society does not exist.' };
  return { value: { society_id,title,description,event_date,start_time,end_time,capacity,status } };
}

function validateBooking(body, excludeId = null) {
  const event_id = positiveInt(body.event_id);
  const venue_id = positiveInt(body.venue_id);
  const booking_date = clean(body.booking_date);
  const start_time = clean(body.start_time);
  const end_time = clean(body.end_time);
  const booking_status = clean(body.booking_status || 'Confirmed');
  if (!event_id || !venue_id || !booking_date || !start_time || !end_time) return { error: 'Please fill all required booking fields.' };
  if (start_time >= end_time) return { error: 'Booking end time must be after start time.' };
  if (!['Pending','Confirmed','Cancelled'].includes(booking_status)) return { error: 'Invalid booking status.' };
  const event = db.prepare('SELECT * FROM Events WHERE event_id=?').get(event_id);
  const venue = db.prepare('SELECT * FROM Venues WHERE venue_id=?').get(venue_id);
  if (!event) return { error: 'Event not found.' };
  if (!venue) return { error: 'Venue not found.' };
  if (venue.availability_status !== 'Available' && booking_status !== 'Cancelled') return { error: `Venue is currently ${venue.availability_status.toLowerCase()}.` };
  if (event.capacity > venue.capacity && booking_status !== 'Cancelled') return { error: `Venue capacity (${venue.capacity}) is smaller than event capacity (${event.capacity}).` };
  if (booking_status !== 'Cancelled') {
    const conflict = bookingConflict({ venue_id, booking_date, start_time, end_time, exclude_booking_id: excludeId });
    if (conflict) return { error: `Booking conflict: this venue is already used by “${conflict.title}” during that time.` };
  }
  return { value: { event_id,venue_id,booking_date,start_time,end_time,booking_status } };
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;

  if (pathname === '/api/health' && method === 'GET') {
    return json(res, 200, { ok: true, database: path.basename(DB_PATH), tables: 6 });
  }

  if (pathname === '/api/auth/signup' && method === 'POST') {
    try {
      const body = await readBody(req);
      const full_name = clean(body.full_name);
      const email = clean(body.email).toLowerCase();
      const password = String(body.password || '');
      const role = 'student'; // Public sign-up never self-grants organizer privileges. Admin may promote users.
      if (full_name.length < 2) return json(res, 400, { error: 'Please enter your full name.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
      if (password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
      const info = db.prepare('INSERT INTO Users (full_name,email,password_hash,role) VALUES (?,?,?,?)')
        .run(full_name, email, hashPassword(password), role);
      const user = db.prepare('SELECT user_id,full_name,email,role,created_at FROM Users WHERE user_id=?').get(Number(info.lastInsertRowid));
      const token = signSession(user);
      return json(res, 201, { user }, { 'Set-Cookie': `cc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}Path=/; Max-Age=${SESSION_HOURS*3600}` });
    } catch (err) {
      return json(res, 400, { error: safeDbError(err) });
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await readBody(req);
      const email = clean(body.email).toLowerCase();
      const password = String(body.password || '');
      const row = db.prepare('SELECT * FROM Users WHERE email=?').get(email);
      if (!row || !verifyPassword(password, row.password_hash)) return json(res, 401, { error: 'Invalid email or password.' });
      const user = { user_id: row.user_id, full_name: row.full_name, email: row.email, role: row.role, created_at: row.created_at };
      const token = signSession(user);
      return json(res, 200, { user }, { 'Set-Cookie': `cc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}Path=/; Max-Age=${SESSION_HOURS*3600}` });
    } catch {
      return json(res, 400, { error: 'Unable to log in.' });
    }
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'cc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = currentUser(req);
    return user ? json(res, 200, { user }) : json(res, 401, { error: 'Not authenticated.' });
  }

  // Everything below requires authentication.
  const user = requireAuth(req, res);
  if (!user) return;

  if (pathname === '/api/dashboard' && method === 'GET') {
    const stats = {
      events: Number(db.prepare("SELECT COUNT(*) AS c FROM Events WHERE status!='Cancelled'").get().c),
      societies: Number(db.prepare('SELECT COUNT(*) AS c FROM Societies').get().c),
      venues: Number(db.prepare("SELECT COUNT(*) AS c FROM Venues WHERE availability_status='Available'").get().c),
      registrations: Number(db.prepare("SELECT COUNT(*) AS c FROM Registrations WHERE reg_status='Registered'").get().c),
      bookings: Number(db.prepare("SELECT COUNT(*) AS c FROM Bookings WHERE booking_status='Confirmed'").get().c),
      users: Number(db.prepare('SELECT COUNT(*) AS c FROM Users').get().c),
    };
    const upcoming = eventWithDetailsWhere("WHERE e.status='Published' AND e.event_date >= date('now')", []).slice(0, 5);
    const myRegistrations = user.role === 'student' ? registrationRows('WHERE r.user_id=?', [user.user_id]).slice(0, 5) : [];
    return json(res, 200, { stats, upcoming, myRegistrations });
  }

  // SMART PLANNER: read-only, deterministic planning signals using the approved six tables.
  if (pathname === '/api/planner' && method === 'GET') {
    const eventId = positiveInt(url.searchParams.get('event_id'));
    const event = eventId ? db.prepare('SELECT * FROM Events WHERE event_id=?').get(eventId) : null;
    if (eventId && !event) return json(res, 404, { error: 'Event not found.' });
    const venues = db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM Bookings b WHERE b.venue_id=v.venue_id AND b.booking_status='Confirmed') AS bookings_count FROM Venues v ORDER BY v.venue_name`).all();
    const candidates = venues.map(v => {
      const fit = event ? v.capacity >= event.capacity : true;
      const conflict = event ? bookingConflict({venue_id:v.venue_id,booking_date:event.event_date,start_time:event.start_time,end_time:event.end_time}) : null;
      const available = v.availability_status==='Available' && fit && !conflict;
      // Transparent, non-AI ranking: capacity utilization, availability, historical use.
      const occupancy = event ? Math.round(event.capacity/v.capacity*100) : 0;
      const score = event && available ? Math.round(70 + Math.min(20,occupancy/5) + Math.max(0,10-Math.min(10,v.bookings_count))) : 0;
      return { ...v, available, fit, conflict: conflict?.title || null, score, occupancy };
    });
    return json(res,200,{event:event||null,venues:candidates.sort((a,b)=>Number(b.available)-Number(a.available)||b.score-a.score||a.venue_name.localeCompare(b.venue_name))});
  }
  if (pathname === '/api/calendar' && method === 'GET') {
    const month = clean(url.searchParams.get('month'));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json(res,400,{error:'Month must be YYYY-MM.'});
    const events = db.prepare(`SELECT e.event_id,e.title,e.event_date,e.start_time,e.end_time,e.capacity,e.status,s.society_name, (SELECT COUNT(*) FROM Registrations r WHERE r.event_id=e.event_id AND r.reg_status='Registered') AS participants FROM Events e JOIN Societies s ON s.society_id=e.society_id WHERE e.event_date LIKE ? ORDER BY e.event_date,e.start_time`).all(month+'%');
    return json(res,200,{month,events});
  }

  // USERS
  if (pathname === '/api/users' && method === 'GET') {
    if (!requireAuth(req, res, ['admin'])) return;
    const rows = db.prepare(`SELECT u.user_id,u.full_name,u.email,u.role,u.created_at,
      (SELECT COUNT(*) FROM Registrations r WHERE r.user_id=u.user_id) AS registration_count
      FROM Users u ORDER BY u.created_at DESC`).all();
    return json(res, 200, { users: rows });
  }

  const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'PUT') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const id = Number(userMatch[1]);
    if (auth.role !== 'admin' && auth.user_id !== id) return json(res, 403, { error: 'You can only update your own profile.' });
    const body = await readBody(req);
    const full_name = clean(body.full_name);
    const email = clean(body.email).toLowerCase();
    const existing = db.prepare('SELECT * FROM Users WHERE user_id=?').get(id);
    if (!existing) return json(res, 404, { error: 'User not found.' });
    let role = existing.role;
    if (auth.role === 'admin' && ['student','organizer','admin'].includes(clean(body.role))) role = clean(body.role);
    if (!full_name || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Valid name and email are required.' });
    try {
      if (body.password) {
        if (String(body.password).length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
        db.prepare('UPDATE Users SET full_name=?,email=?,role=?,password_hash=? WHERE user_id=?').run(full_name,email,role,hashPassword(String(body.password)),id);
      } else {
        db.prepare('UPDATE Users SET full_name=?,email=?,role=? WHERE user_id=?').run(full_name,email,role,id);
      }
      const updated = db.prepare('SELECT user_id,full_name,email,role,created_at FROM Users WHERE user_id=?').get(id);
      return json(res, 200, { user: updated });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }

  if (userMatch && method === 'DELETE') {
    const auth = requireAuth(req, res, ['admin']);
    if (!auth) return;
    const id = Number(userMatch[1]);
    if (id === auth.user_id) return json(res, 400, { error: 'You cannot delete your own admin account.' });
    const info = db.prepare('DELETE FROM Users WHERE user_id=?').run(id);
    return info.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'User not found.' });
  }

  // SOCIETIES
  if (pathname === '/api/societies' && method === 'GET') {
    const rows = db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM Events e WHERE e.society_id=s.society_id) AS event_count
      FROM Societies s ORDER BY s.society_name`).all();
    return json(res, 200, { societies: rows });
  }
  if (pathname === '/api/societies' && method === 'POST') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const body = await readBody(req);
    const society_name = clean(body.society_name), category = clean(body.category), contact_email = clean(body.contact_email);
    if (!society_name || !category || !/^\S+@\S+\.\S+$/.test(contact_email)) return json(res, 400, { error: 'Society name, category and valid email are required.' });
    try {
      const info = db.prepare('INSERT INTO Societies (society_name,category,contact_email) VALUES (?,?,?)').run(society_name,category,contact_email);
      return json(res, 201, { society: db.prepare('SELECT * FROM Societies WHERE society_id=?').get(Number(info.lastInsertRowid)) });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }
  const societyMatch = pathname.match(/^\/api\/societies\/(\d+)$/);
  if (societyMatch && method === 'PUT') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const id = Number(societyMatch[1]);
    const body = await readBody(req);
    const society_name = clean(body.society_name), category = clean(body.category), contact_email = clean(body.contact_email);
    if (!society_name || !category || !/^\S+@\S+\.\S+$/.test(contact_email)) return json(res, 400, { error: 'Society name, category and valid email are required.' });
    try {
      const info = db.prepare('UPDATE Societies SET society_name=?,category=?,contact_email=? WHERE society_id=?').run(society_name,category,contact_email,id);
      return info.changes ? json(res, 200, { society: db.prepare('SELECT * FROM Societies WHERE society_id=?').get(id) }) : json(res, 404, { error: 'Society not found.' });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }
  if (societyMatch && method === 'DELETE') {
    if (!requireAuth(req, res, ['admin'])) return;
    try {
      const info = db.prepare('DELETE FROM Societies WHERE society_id=?').run(Number(societyMatch[1]));
      return info.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Society not found.' });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }

  // EVENTS
  if (pathname === '/api/events' && method === 'GET') {
    const q = clean(url.searchParams.get('q')).toLowerCase();
    const status = clean(url.searchParams.get('status'));
    const clauses = [], params = [];
    if (q) { clauses.push('(LOWER(e.title) LIKE ? OR LOWER(s.society_name) LIKE ? OR LOWER(e.description) LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    if (status) { clauses.push('e.status=?'); params.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return json(res, 200, { events: eventWithDetailsWhere(where, params) });
  }
  if (pathname === '/api/events' && method === 'POST') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const body = await readBody(req);
    const v = validateEvent(body);
    if (v.error) return json(res, 400, { error: v.error });
    const x = v.value;
    const info = db.prepare(`INSERT INTO Events (society_id,title,description,event_date,start_time,end_time,capacity,status) VALUES (?,?,?,?,?,?,?,?)`)
      .run(x.society_id,x.title,x.description,x.event_date,x.start_time,x.end_time,x.capacity,x.status);
    return json(res, 201, { event: eventWithDetailsWhere('WHERE e.event_id=?',[Number(info.lastInsertRowid)])[0] });
  }
  const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
  if (eventMatch && method === 'GET') {
    const row = eventWithDetailsWhere('WHERE e.event_id=?',[Number(eventMatch[1])])[0];
    return row ? json(res, 200, { event: row }) : json(res, 404, { error: 'Event not found.' });
  }
  if (eventMatch && method === 'PUT') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const id = Number(eventMatch[1]);
    const body = await readBody(req);
    const v = validateEvent(body);
    if (v.error) return json(res, 400, { error: v.error });
    const x = v.value;
    const info = db.prepare(`UPDATE Events SET society_id=?,title=?,description=?,event_date=?,start_time=?,end_time=?,capacity=?,status=? WHERE event_id=?`)
      .run(x.society_id,x.title,x.description,x.event_date,x.start_time,x.end_time,x.capacity,x.status,id);
    return info.changes ? json(res, 200, { event: eventWithDetailsWhere('WHERE e.event_id=?',[id])[0] }) : json(res, 404, { error: 'Event not found.' });
  }
  if (eventMatch && method === 'DELETE') {
    if (!requireAuth(req, res, ['admin'])) return;
    try {
      const info = db.prepare('DELETE FROM Events WHERE event_id=?').run(Number(eventMatch[1]));
      return info.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Event not found.' });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }

  // VENUES
  if (pathname === '/api/venues' && method === 'GET') {
    const rows = db.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM Bookings b WHERE b.venue_id=v.venue_id AND b.booking_status='Confirmed') AS booking_count
      FROM Venues v ORDER BY v.venue_name`).all();
    return json(res, 200, { venues: rows });
  }
  if (pathname === '/api/venues' && method === 'POST') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const body = await readBody(req);
    const venue_name = clean(body.venue_name), location = clean(body.location), capacity = positiveInt(body.capacity), availability_status = clean(body.availability_status || 'Available');
    if (!venue_name || !location || !capacity) return json(res, 400, { error: 'Venue name, location and positive capacity are required.' });
    if (!['Available','Maintenance','Unavailable'].includes(availability_status)) return json(res, 400, { error: 'Invalid availability status.' });
    try {
      const info = db.prepare('INSERT INTO Venues (venue_name,location,capacity,availability_status) VALUES (?,?,?,?)').run(venue_name,location,capacity,availability_status);
      return json(res, 201, { venue: db.prepare('SELECT * FROM Venues WHERE venue_id=?').get(Number(info.lastInsertRowid)) });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }
  const venueMatch = pathname.match(/^\/api\/venues\/(\d+)$/);
  if (venueMatch && method === 'PUT') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const id = Number(venueMatch[1]);
    const body = await readBody(req);
    const venue_name = clean(body.venue_name), location = clean(body.location), capacity = positiveInt(body.capacity), availability_status = clean(body.availability_status || 'Available');
    if (!venue_name || !location || !capacity) return json(res, 400, { error: 'Venue name, location and positive capacity are required.' });
    if (!['Available','Maintenance','Unavailable'].includes(availability_status)) return json(res, 400, { error: 'Invalid availability status.' });
    try {
      const info = db.prepare('UPDATE Venues SET venue_name=?,location=?,capacity=?,availability_status=? WHERE venue_id=?').run(venue_name,location,capacity,availability_status,id);
      return info.changes ? json(res, 200, { venue: db.prepare('SELECT * FROM Venues WHERE venue_id=?').get(id) }) : json(res, 404, { error: 'Venue not found.' });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }
  if (venueMatch && method === 'DELETE') {
    if (!requireAuth(req, res, ['admin'])) return;
    try {
      const info = db.prepare('DELETE FROM Venues WHERE venue_id=?').run(Number(venueMatch[1]));
      return info.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Venue not found.' });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }

  // REGISTRATIONS
  if (pathname === '/api/registrations' && method === 'GET') {
    const scopeAll = url.searchParams.get('scope') === 'all' && ['organizer','admin'].includes(user.role);
    const rows = scopeAll ? registrationRows() : registrationRows('WHERE r.user_id=?',[user.user_id]);
    return json(res, 200, { registrations: rows });
  }
  if (pathname === '/api/registrations' && method === 'POST') {
    const body = await readBody(req);
    const event_id = positiveInt(body.event_id);
    if (!event_id) return json(res, 400, { error: 'Select a valid event.' });
    const event = db.prepare('SELECT * FROM Events WHERE event_id=?').get(event_id);
    if (!event) return json(res, 404, { error: 'Event not found.' });
    if (event.status !== 'Published') return json(res, 400, { error: 'Only published events accept registrations.' });
    if (event.event_date < new Date().toISOString().slice(0,10)) return json(res,400,{ error:'Registration is closed for past events.' });
    const activeCount = Number(db.prepare("SELECT COUNT(*) AS c FROM Registrations WHERE event_id=? AND reg_status='Registered'").get(event_id).c);
    if (activeCount >= event.capacity) return json(res, 400, { error: 'This event is already full.' });
    const existing = db.prepare('SELECT * FROM Registrations WHERE user_id=? AND event_id=?').get(user.user_id,event_id);
    try {
      if (existing) {
        if (existing.reg_status === 'Registered') return json(res, 400, { error: 'You are already registered for this event.' });
        db.prepare("UPDATE Registrations SET reg_status='Registered',registered_at=datetime('now') WHERE registration_id=?").run(existing.registration_id);
        return json(res, 200, { registration: registrationRows('WHERE r.registration_id=?',[existing.registration_id])[0] });
      }
      const info = db.prepare('INSERT INTO Registrations (user_id,event_id,reg_status) VALUES (?,?,?)').run(user.user_id,event_id,'Registered');
      return json(res, 201, { registration: registrationRows('WHERE r.registration_id=?',[Number(info.lastInsertRowid)])[0] });
    } catch (err) { return json(res, 400, { error: safeDbError(err) }); }
  }
  const regMatch = pathname.match(/^\/api\/registrations\/(\d+)$/);
  if (regMatch && method === 'PUT') {
    const id = Number(regMatch[1]);
    const row = db.prepare('SELECT * FROM Registrations WHERE registration_id=?').get(id);
    if (!row) return json(res, 404, { error: 'Registration not found.' });
    if (user.role === 'student' && row.user_id !== user.user_id) return json(res, 403, { error: 'You can only update your own registration.' });
    const body = await readBody(req);
    let status = clean(body.reg_status);
    if (user.role === 'student' && status !== 'Cancelled') status = 'Cancelled';
    if (!['Registered','Cancelled','Attended'].includes(status)) return json(res, 400, { error: 'Invalid registration status.' });
    db.prepare('UPDATE Registrations SET reg_status=? WHERE registration_id=?').run(status,id);
    return json(res, 200, { registration: registrationRows('WHERE r.registration_id=?',[id])[0] });
  }
  if (regMatch && method === 'DELETE') {
    const id = Number(regMatch[1]);
    const row = db.prepare('SELECT * FROM Registrations WHERE registration_id=?').get(id);
    if (!row) return json(res, 404, { error: 'Registration not found.' });
    if (user.role === 'student' && row.user_id !== user.user_id) return json(res, 403, { error: 'You can only remove your own registration.' });
    db.prepare('DELETE FROM Registrations WHERE registration_id=?').run(id);
    return json(res, 200, { ok: true });
  }

  // BOOKINGS
  if (pathname === '/api/bookings' && method === 'GET') {
    return json(res, 200, { bookings: bookingRows() });
  }
  if (pathname === '/api/bookings' && method === 'POST') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const body = await readBody(req);
    const v = validateBooking(body);
    if (v.error) return json(res, 400, { error: v.error });
    const x = v.value;
    const info = db.prepare('INSERT INTO Bookings (event_id,venue_id,booking_date,start_time,end_time,booking_status) VALUES (?,?,?,?,?,?)')
      .run(x.event_id,x.venue_id,x.booking_date,x.start_time,x.end_time,x.booking_status);
    return json(res, 201, { booking: bookingRows('WHERE b.booking_id=?',[Number(info.lastInsertRowid)])[0] });
  }
  const bookingMatch = pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (bookingMatch && method === 'PUT') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const id = Number(bookingMatch[1]);
    const body = await readBody(req);
    const v = validateBooking(body,id);
    if (v.error) return json(res, 400, { error: v.error });
    const x = v.value;
    const info = db.prepare('UPDATE Bookings SET event_id=?,venue_id=?,booking_date=?,start_time=?,end_time=?,booking_status=? WHERE booking_id=?')
      .run(x.event_id,x.venue_id,x.booking_date,x.start_time,x.end_time,x.booking_status,id);
    return info.changes ? json(res, 200, { booking: bookingRows('WHERE b.booking_id=?',[id])[0] }) : json(res, 404, { error: 'Booking not found.' });
  }
  if (bookingMatch && method === 'DELETE') {
    if (!requireAuth(req, res, ['admin'])) return;
    const info = db.prepare('DELETE FROM Bookings WHERE booking_id=?').run(Number(bookingMatch[1]));
    return info.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Booking not found.' });
  }

  // REPORTS
  if (pathname === '/api/reports' && method === 'GET') {
    const eventsBySociety = db.prepare(`SELECT s.society_name,COUNT(e.event_id) AS event_count
      FROM Societies s LEFT JOIN Events e ON e.society_id=s.society_id
      GROUP BY s.society_id ORDER BY event_count DESC,s.society_name`).all();
    const registrationsByEvent = db.prepare(`SELECT e.title,e.capacity,
      SUM(CASE WHEN r.reg_status='Registered' THEN 1 ELSE 0 END) AS registered_count,
      SUM(CASE WHEN r.reg_status='Attended' THEN 1 ELSE 0 END) AS attended_count
      FROM Events e LEFT JOIN Registrations r ON r.event_id=e.event_id
      GROUP BY e.event_id ORDER BY registered_count DESC,e.title`).all();
    const venueUsage = db.prepare(`SELECT v.venue_name,v.capacity,
      SUM(CASE WHEN b.booking_status='Confirmed' THEN 1 ELSE 0 END) AS confirmed_bookings
      FROM Venues v LEFT JOIN Bookings b ON b.venue_id=v.venue_id
      GROUP BY v.venue_id ORDER BY confirmed_bookings DESC,v.venue_name`).all();
    const statusSummary = {
      events: db.prepare('SELECT status,COUNT(*) AS count FROM Events GROUP BY status').all(),
      registrations: db.prepare('SELECT reg_status AS status,COUNT(*) AS count FROM Registrations GROUP BY reg_status').all(),
      bookings: db.prepare('SELECT booking_status AS status,COUNT(*) AS count FROM Bookings GROUP BY booking_status').all(),
    };
    const tableCounts = Object.fromEntries(['Users','Societies','Events','Venues','Registrations','Bookings'].map(t => [t, Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c)]));
    return json(res, 200, { eventsBySociety, registrationsByEvent, venueUsage, statusSummary, tableCounts });
  }

  if (pathname === '/api/reports/registrations.csv' && method === 'GET') {
    if (!requireAuth(req, res, ['organizer','admin'])) return;
    const rows = registrationRows();
    const cols = ['registration_id','full_name','email','title','event_date','society_name','reg_status','registered_at'];
    const escapeCsv = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => escapeCsv(r[c])).join(','))].join('\n');
    return text(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="campusconnect_registrations.csv"' });
  }

  return json(res, 404, { error: 'API route not found.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  requested = decodeURIComponent(requested).replace(/\\/g, '/');
  if (requested.includes('..')) return text(res, 403, 'Forbidden');
  let filePath = path.join(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR)) return text(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, 'index.html');
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=120',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    // Reject cross-origin state mutations: protects cookie-authenticated accounts.
    if (!['GET','HEAD','OPTIONS'].includes(req.method || 'GET')) {
      const origin = req.headers.origin;
      if (origin) {
        const own = new URL(`http://${req.headers.host || `${HOST}:${PORT}`}`);
        const supplied = new URL(origin);
        if (supplied.host !== own.host || !['http:', 'https:'].includes(supplied.protocol)) return json(res, 403, {error:'Origin not permitted.'});
      }
    }
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    if (!res.headersSent) json(res, 500, { error: 'Unexpected server error.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       CampusConnect — Viva Final Project        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Running: http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('Tables: Users, Societies, Events, Venues, Registrations, Bookings');
  console.log('Press Ctrl+C to stop.');
  console.log('');
});

function shutdown() {
  try { db.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
