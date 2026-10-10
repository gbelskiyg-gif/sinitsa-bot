import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.js";
import { TEAS } from "./catalog.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, "sinitsa.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS stock (
    tea_id INTEGER PRIMARY KEY,
    available INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    delivery TEXT NOT NULL,
    address TEXT,
    comment TEXT,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    admin_msgs TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
  CREATE TABLE IF NOT EXISTS support (
    admin_chat INTEGER NOT NULL,
    admin_msg INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (admin_chat, admin_msg)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    order_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    rating TEXT,
    wish TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Миграции для баз, созданных ранее
for (const sql of [
  "ALTER TABLE orders ADD COLUMN done_at TEXT",
  "ALTER TABLE orders ADD COLUMN feedback_asked INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN promo TEXT",
  "ALTER TABLE orders ADD COLUMN consent_at TEXT",
]) {
  try {
    db.exec(sql);
  } catch {
    /* колонка уже есть */
  }
}

const insertStock =db.prepare("INSERT OR IGNORE INTO stock (tea_id, available) VALUES (?, 1)");
for (const t of TEAS) insertStock.run(t.id);

// ---------- наличие ----------
export function availability() {
  const map = {};
  for (const r of db.prepare("SELECT tea_id, available FROM stock").all()) map[r.tea_id] = !!r.available;
  return map;
}
export function setAvailable(teaId, on) {
  db.prepare("UPDATE stock SET available = ? WHERE tea_id = ?").run(on ? 1 : 0, teaId);
}

// ---------- покупатели ----------
export function upsertUser(u) {
  db.prepare(
    `INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`
  ).run(u.id, u.first_name || "", u.username || "");
}

// ---------- заказы ----------
function rowToOrder(r) {
  if (!r) return null;
  return { ...r, items: JSON.parse(r.items_json), adminMsgs: JSON.parse(r.admin_msgs) };
}
export function createOrder(o) {
  const res = db
    .prepare(
      `INSERT INTO orders (user_id, name, phone, delivery, address, comment, items_json, total, promo, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(o.userId, o.name, o.phone, o.delivery, o.address || "", o.comment || "", JSON.stringify(o.items), o.total, o.promo || "");
  return getOrder(Number(res.lastInsertRowid));
}
export function getOrder(id) {
  return rowToOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
}
export function userOrders(userId) {
  return db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(userId).map(rowToOrder);
}
export function activeOrders() {
  return db
    .prepare("SELECT * FROM orders WHERE status IN ('new','accepted','shipped') ORDER BY id")
    .all()
    .map(rowToOrder);
}
export function recentOrderCount(userId, minutes) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND created_at > datetime('now', ?)")
    .get(userId, `-${minutes} minutes`).n;
}
export function setStatus(id, status) {
  db.prepare(
    "UPDATE orders SET status = ?, updated_at = datetime('now'), done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE done_at END WHERE id = ?"
  ).run(status, status, id);
  return getOrder(id);
}
/** Через 12 месяцев после выполнения или отмены удаляем имя, телефон, адрес и комментарий. */
export function anonymizeOldOrders(days = 365) {
  return db
    .prepare(
      `UPDATE orders SET name = '', phone = '', address = '', comment = ''
       WHERE status IN ('done','cancelled') AND updated_at < datetime('now', ?) AND (phone != '' OR name != '')`
    )
    .run(`-${days} days`).changes;
}

export function isFirstOrder(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status != 'cancelled'").get(userId).n === 0;
}

// ---------- отзывы ----------
export function ordersDueForFeedback(days) {
  return db
    .prepare("SELECT * FROM orders WHERE status = 'done' AND feedback_asked = 0 AND done_at <= datetime('now', ?)")
    .all(`-${days} days`)
    .map(rowToOrder);
}
export function markFeedbackAsked(orderId) {
  db.prepare("UPDATE orders SET feedback_asked = 1 WHERE id = ?").run(orderId);
}
export function saveFeedback(orderId, userId, fields) {
  db.prepare("INSERT OR IGNORE INTO feedback (order_id, user_id) VALUES (?, ?)").run(orderId, userId);
  if (fields.rating) db.prepare("UPDATE feedback SET rating = ? WHERE order_id = ? AND user_id = ?").run(fields.rating, orderId, userId);
  if (fields.wish) db.prepare("UPDATE feedback SET wish = ? WHERE order_id = ? AND user_id = ?").run(fields.wish, orderId, userId);
}
/** Отзывы покупателя: по каким чаям и с какой оценкой. */
export function userFeedback(userId) {
  return db
    .prepare("SELECT f.rating, f.wish, o.items_json FROM feedback f JOIN orders o ON o.id = f.order_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 20")
    .all(userId)
    .map((r) => ({ rating: r.rating, wish: r.wish, teaIds: JSON.parse(r.items_json).map((i) => i.teaId).filter(Boolean) }));
}
export function setAdminMsgs(id, msgs) {
  db.prepare("UPDATE orders SET admin_msgs = ? WHERE id = ?").run(JSON.stringify(msgs), id);
}

// ---------- переписка с продавцом ----------
export function rememberSupport(adminChat, adminMsg, userId) {
  db.prepare("INSERT OR REPLACE INTO support (admin_chat, admin_msg, user_id) VALUES (?, ?, ?)").run(adminChat, adminMsg, userId);
}
export function supportUser(adminChat, adminMsg) {
  return db.prepare("SELECT user_id FROM support WHERE admin_chat = ? AND admin_msg = ?").get(adminChat, adminMsg)?.user_id;
}
