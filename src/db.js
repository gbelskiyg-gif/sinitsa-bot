import crypto from "node:crypto";
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
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
  CREATE TABLE IF NOT EXISTS reminders (
    user_id INTEGER PRIMARY KEY,
    sent_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
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
  "ALTER TABLE users ADD COLUMN menu_v INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN paid_claim_at TEXT",
  "ALTER TABLE orders ADD COLUMN site_token TEXT",
  "ALTER TABLE orders ADD COLUMN phone_key TEXT",
]) {
  try {
    db.exec(sql);
  } catch {
    /* колонка уже есть */
  }
}

// Отпечатки телефонов для старых заказов (где номер ещё не удалён)
for (const r of db.prepare("SELECT id, phone FROM orders WHERE phone_key IS NULL AND phone != ''").all()) {
  db.prepare("UPDATE orders SET phone_key = ? WHERE id = ?").run(phoneKey(r.phone), r.id);
}

const insertStock = db.prepare("INSERT OR IGNORE INTO stock (tea_id, available) VALUES (?, 1)");
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
export function usersWithoutMenu(v) {
  return db.prepare("SELECT id FROM users WHERE menu_v < ? AND id > 0").all(v).map((r) => r.id);
}
export function markMenu(id, v) {
  db.prepare("UPDATE users SET menu_v = ? WHERE id = ?").run(v, id);
}

// ---------- аналитика: что делают люди в приложении ----------
export function logEvent(userId, name, data = "") {
  db.prepare("INSERT INTO events (user_id, name, data) VALUES (?, ?, ?)").run(userId, name, String(data).slice(0, 200));
}
export function hasRecentEvent(userId, name, minutes) {
  return !!db.prepare("SELECT 1 FROM events WHERE user_id = ? AND name = ? AND created_at > datetime('now', ?)").get(userId, name, `-${minutes} minutes`);
}
export function recentEventCount(userId, minutes) {
  return db.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND created_at > datetime('now', ?)").get(userId, `-${minutes} minutes`).n;
}
/** Сколько разных людей дошло до каждого шага за последние days дней. */
export function funnel(days) {
  const rows = db.prepare(
    "SELECT name, COUNT(DISTINCT user_id) AS n FROM events WHERE created_at > datetime('now', ?) GROUP BY name"
  ).all(`-${days} days`);
  return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}
/** До какого вопроса подбора дошли люди, которые его не закончили. */
export function quizDropoff(days) {
  return db.prepare(
    `SELECT max_step AS step, COUNT(*) AS n FROM (
       SELECT user_id, MAX(CAST(data AS INTEGER)) AS max_step FROM events
       WHERE name = 'quiz_step' AND created_at > datetime('now', ?) GROUP BY user_id
     ) s WHERE user_id NOT IN (SELECT user_id FROM events WHERE name = 'quiz_done' AND created_at > datetime('now', ?))
     GROUP BY max_step ORDER BY max_step`
  ).all(`-${days} days`, `-${days} days`);
}
/** Чаще всего открываемые чаи. */
export function topTeas(days, limit = 5) {
  return db.prepare(
    "SELECT data AS id, COUNT(DISTINCT user_id) AS n FROM events WHERE name = 'tea_open' AND created_at > datetime('now', ?) GROUP BY data ORDER BY n DESC LIMIT ?"
  ).all(`-${days} days`, limit);
}
/** Брошенные корзины: добавили чай, но заказа после этого нет. */
export function abandonedCarts(days) {
  return db.prepare(
    `SELECT e.user_id, u.first_name, u.username, MAX(e.created_at) AS last_at,
            (SELECT GROUP_CONCAT(d, ' | ') FROM (SELECT DISTINCT data AS d FROM events x WHERE x.user_id = e.user_id AND x.name = 'cart_add' AND x.created_at > datetime('now', ?))) AS items,
            MAX(CASE WHEN c.user_id IS NOT NULL THEN 1 ELSE 0 END) AS reached_checkout,
            r.sent_at AS reminded_at
     FROM events e
     LEFT JOIN users u ON u.id = e.user_id
     LEFT JOIN events c ON c.user_id = e.user_id AND c.name = 'checkout_open' AND c.created_at >= e.created_at
     LEFT JOIN reminders r ON r.user_id = e.user_id
     WHERE e.name = 'cart_add' AND e.created_at > datetime('now', ?)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = e.user_id AND o.created_at >= e.created_at)
     GROUP BY e.user_id ORDER BY last_at DESC LIMIT 20`
  ).all(`-${days} days`, `-${days} days`);
}
/** Кому пора напомнить: положили в корзину от after до before часов назад, заказа нет, не напоминали 14 дней. */
export function cartsToRemind(afterHours = 3, beforeHours = 72) {
  return db.prepare(
    `SELECT e.user_id, MAX(e.created_at) AS last_at,
            (SELECT GROUP_CONCAT(d, ' | ') FROM (SELECT DISTINCT data AS d FROM events x WHERE x.user_id = e.user_id AND x.name = 'cart_add' AND x.created_at > datetime('now', ?))) AS items
     FROM events e
     WHERE e.name = 'cart_add'
       AND e.created_at > datetime('now', ?)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = e.user_id AND o.created_at >= e.created_at)
       AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.user_id = e.user_id AND r.sent_at > datetime('now', '-14 days'))
     GROUP BY e.user_id
     HAVING MAX(e.created_at) < datetime('now', ?)`
  ).all(`-${beforeHours} hours`, `-${beforeHours} hours`, `-${afterHours} hours`);
}
export function markReminded(userId) {
  db.prepare("INSERT INTO reminders (user_id, sent_at) VALUES (?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET sent_at = excluded.sent_at").run(userId);
}
export function remindedRecently(userId, days) {
  return !!db.prepare("SELECT 1 FROM reminders WHERE user_id = ? AND sent_at > datetime('now', ?)").get(userId, `-${days} days`);
}
/** Действия старше 90 дней не храним. */
export function cleanOldEvents(days = 90) {
  return db.prepare("DELETE FROM events WHERE created_at < datetime('now', ?)").run(`-${days} days`).changes;
}

// Настройки магазина (реквизиты для оплаты и т. п.)
export function getSetting(key, fallback = null) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
/** Покупатель нажал «Я оплатил» (или сброс, если продавец не нашёл перевод). */
export function setPaidClaim(id, on) {
  db.prepare("UPDATE orders SET paid_claim_at = CASE WHEN ? THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE id = ?").run(on ? 1 : 0, id);
  return getOrder(id);
}

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
      `INSERT INTO orders (user_id, name, phone, delivery, address, comment, items_json, total, promo, consent_at, site_token, phone_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
    )
    .run(o.userId, o.name, o.phone, o.delivery, o.address || "", o.comment || "", JSON.stringify(o.items), o.total, o.promo || "", o.siteToken || null, phoneKey(o.phone));
  return getOrder(Number(res.lastInsertRowid));
}
/** Все заказы для таблицы: новые сверху, с ником покупателя. */
export function ordersForExport() {
  return db.prepare("SELECT o.*, u.username, u.first_name AS tg_name FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC").all().map(rowToOrder);
}
export function getOrder(id) {
  return rowToOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
}
export function userOrders(userId) {
  return db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(userId).map(rowToOrder);
}
export function activeOrders() {
  return db
    .prepare("SELECT * FROM orders WHERE status IN ('new','accepted','paid','shipped') ORDER BY id")
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
/** Через 30 дней после выполнения или отмены удаляем имя, телефон, адрес и комментарий. */
export function anonymizeOldOrders(days = 30) {
  return db
    .prepare(
      `UPDATE orders SET name = '', phone = '', address = '', comment = ''
       WHERE status IN ('done','cancelled') AND updated_at < datetime('now', ?) AND (phone != '' OR name != '')`
    )
    .run(`-${days} days`).changes;
}

/**
 * Отпечаток телефона: HMAC последних 10 цифр с секретной солью.
 * Сам номер через 30 дней удаляется, а отпечаток остаётся — только чтобы
 * промокод «на первый заказ» нельзя было использовать второй раз. Номер из него не восстановить.
 */
function phoneSalt() {
  let s = getSetting("phone_salt");
  if (!s) { s = crypto.randomBytes(32).toString("hex"); setSetting("phone_salt", s); }
  return s;
}
export function phoneKey(phone) {
  const d = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (d.length < 10) return null;
  return crypto.createHmac("sha256", phoneSalt()).update(d).digest("hex").slice(0, 32);
}
/** Первый ли заказ на этот телефон (по любым каналам: сайт и бот). */
export function isFirstOrderByPhone(phone) {
  const k = phoneKey(phone);
  if (!k) return true;
  return !db.prepare("SELECT 1 FROM orders WHERE phone_key = ? AND status != 'cancelled' LIMIT 1").get(k);
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
