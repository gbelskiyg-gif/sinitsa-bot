import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signSession, verifyInitData, verifyLoginWidget, verifySession } from "./auth.js";
import { BOT_TOKEN } from "./config.js";
import { DELIVERY, DELIVERY_INFO, FREE_DELIVERY_FROM, KINDS, MUG_RECIPES, RECIPES, SETS, TASTES, TEAS, quizOf } from "./catalog.js";
import * as store from "./db.js";
import {
  OrderError,
  buildOrder,
  claimPaid,
  checkPromo,
  notifyAdminsNew,
  publicOrder,
  refreshAdminMessages,
} from "./orders.js";
import { tgSafe } from "./telegram.js";
import { consentPage, privacyPage, termsPage } from "./legal.js";
import { menuKeyboard } from "./menu.js";
import { requestWholesale } from "./wholesale.js";
import { checkToken, ordersCsv } from "./export.js";
import { sitePage } from "./site.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Фото чаёв:
//   public/teas/<id>.webp|jpg|png       — настоящее фото конкретного чая;
//   public/teas/kinds/<вид>.webp|jpg|png — общее фото вида чая (gaba, red, shu…).
// Нет ни того ни другого — показывается иероглиф.
function scanPhotos(dir, re) {
  const map = {};
  try {
    for (const f of fs.readdirSync(path.join(PUBLIC_DIR, dir))) {
      const m = f.match(re);
      if (!m) continue;
      const v = Math.round(fs.statSync(path.join(PUBLIC_DIR, dir, f)).mtimeMs / 1000);
      map[m[1]] = `/${dir}/${f}?v=${v}`;
    }
  } catch {
    /* папки ещё нет */
  }
  return map;
}
function photoOf(tea, own, kinds) {
  if (own[tea.id]) return { photo: own[tea.id], photoExample: false };
  if (kinds[tea.kind]) return { photo: kinds[tea.kind], photoExample: true };
  return { photo: "", photoExample: false };
}

const EVENTS = new Set([
  "app_open", "catalog_open", "tea_open", "sets_open", "builder_open", "quiz_start", "quiz_step", "quiz_done", "quiz_exit",
  "quiz_more", "cart_add", "cart_open", "checkout_open", "order_error",
]);

function html(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(body);
}

function redirect(res, to, code) {
  res.writeHead(code, { location: to });
  res.end();
}

function send(res, status, data) {
  if (status === 204) { res.writeHead(204); return res.end(); }
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function readJson(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new OrderError("Слишком большой запрос."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new OrderError("Неверный формат запроса."));
      }
    });
    req.on("error", reject);
  });
}

const PROMOS_FIRST_NOTE = "Если промокод только на первый заказ, проверим по номеру телефона при оформлении.";
// Не больше N заказов с сайта в час с одного адреса (SITE_ORDERS_PER_HOUR, по умолчанию 5)
const SITE_ORDERS_PER_HOUR = Number(process.env.SITE_ORDERS_PER_HOUR || 5);
const siteHits = new Map();
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}
function siteRateOk(ip) {
  const now = Date.now();
  const list = (siteHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= SITE_ORDERS_PER_HOUR) return false;
  list.push(now); siteHits.set(ip, list);
  if (siteHits.size > 5000) siteHits.clear();
  return true;
}

// Покупатель: из мини-приложения (подпись Telegram) или с сайта после «Войти через Telegram»
function auth(req) {
  return verifyInitData(req.headers["x-telegram-init-data"], BOT_TOKEN) || verifySession(req.headers["x-site-auth"], BOT_TOKEN);
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Не найдено");
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": TYPES[ext] || "application/octet-stream",
      // Код приложения всегда проверяем на свежесть — иначе телефон может держать старую версию после обновления
      "cache-control": [".html", ".js", ".css"].includes(ext) ? "no-cache" : "public, max-age=3600",
    });
    res.end(buf);
  });
}

async function api(req, res, url) {
  // Каталог доступен всем, в том числе вне Telegram
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const avail = store.availability();
    const own = scanPhotos("teas", /^(\d+)\.(webp|jpe?g|png)$/i);
    const kinds = scanPhotos("teas/kinds", /^([a-z_]+)\.(webp|jpe?g|png)$/i);
    return send(res, 200, {
      teas: TEAS.map((t) => ({ ...t, available: avail[t.id] !== false, quiz: quizOf(t), ...photoOf(t, own, kinds) })),
      kinds: KINDS,
      recipes: RECIPES,
      mugRecipes: MUG_RECIPES,
      sets: SETS.filter((s) => s.teas.every((id) => avail[id] !== false)),
      tastes: TASTES,
      delivery: DELIVERY,
      freeDeliveryFrom: FREE_DELIVERY_FROM,
      deliveryInfo: DELIVERY_INFO,
    });
  }

  // Заказ с сайта, без Telegram: связываемся с покупателем по телефону
  if (req.method === "GET" && url.pathname === "/api/site-promo") {
    const r = checkPromo(url.searchParams.get("code"), true);
    return send(res, 200, r.ok ? { ...r, note: PROMOS_FIRST_NOTE } : r);
  }
  if (req.method === "POST" && url.pathname === "/api/site-orders") {
    const ip = clientIp(req);
    if (!siteRateOk(ip)) return send(res, 429, { error: "Слишком много заказов подряд. Напишите нам в Telegram @sinitsa_chai_bot, поможем." });
    const body = await readJson(req);
    if (body.website) return send(res, 201, { order: { id: 0, total: 0, items: [] } }); // бот-спамер заполнил скрытое поле
    const draft = buildOrder(body, { id: 0 }, { isFirstOrder: store.isFirstOrderByPhone(body.phone) });
    const order = store.createOrder(draft);
    await notifyAdminsNew(order, "");
    return send(res, 201, { order: publicOrder(order) });
  }

  // Вход на сайте через Telegram: проверяем подпись и выдаём сессию
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req, 2000);
    const tgUser = verifyLoginWidget(body, BOT_TOKEN);
    if (!tgUser) return send(res, 401, { error: "Не получилось войти. Попробуйте ещё раз." });
    store.upsertUser(tgUser);
    return send(res, 200, { token: signSession(tgUser, BOT_TOKEN), user: { id: tgUser.id, first_name: tgUser.first_name, username: tgUser.username } });
  }

  const user = auth(req);
  if (!user) return send(res, 401, { error: "Откройте магазин через бота @sinitsa_chai_bot в Telegram." });
  store.upsertUser(user);

  // Аналитика: шаги в приложении (какие разделы открыли, на каком вопросе ушли, что положили в корзину)
  if (req.method === "POST" && url.pathname === "/api/event") {
    const body = await readJson(req, 2000);
    if (!EVENTS.has(body.name)) return send(res, 400, { error: "event" });
    if (store.recentEventCount(user.id, 60) < 300) store.logEvent(user.id, body.name, body.data ?? "");
    return send(res, 204, {});
  }

  // «Я оптовик»: дальше общаемся лично в чате
  if (req.method === "POST" && url.pathname === "/api/wholesale") {
    const body = await readJson(req, 500);
    return send(res, 200, await requestWholesale(user, Number(body.teaId) || 0));
  }

  if (req.method === "GET" && url.pathname === "/api/orders") {
    return send(res, 200, { orders: store.userOrders(user.id).map(publicOrder) });
  }

  if (req.method === "GET" && url.pathname === "/api/promo") {
    return send(res, 200, checkPromo(url.searchParams.get("code"), store.isFirstOrder(user.id)));
  }

  // Отзывы покупателя для подбора: что понравилось и чего хотелось
  if (req.method === "GET" && url.pathname === "/api/me") {
    return send(res, 200, { feedback: store.userFeedback(user.id), firstOrder: store.isFirstOrder(user.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (store.recentOrderCount(user.id, 60) >= 5)
      return send(res, 429, { error: "Слишком много заказов за час. Напишите нам в бот, поможем." });
    const body = await readJson(req);
    const draft = buildOrder(body, user, { isFirstOrder: store.isFirstOrder(user.id) });
    const order = store.createOrder(draft);
    store.logEvent(user.id, "order_sent", order.id);
    await notifyAdminsNew(order, user.username);
    await tgSafe("sendMessage", {
      chat_id: user.id,
      text: `Заказ №${order.id} получили 🍵\nПроверим наличие и напишем вам здесь. Как только подтвердим, бот пришлёт сумму и реквизиты для оплаты.`,
      reply_markup: menuKeyboard(user.id),
    });
    return send(res, 201, { order: publicOrder(order) });
  }

  const pm = url.pathname.match(/^\/api\/orders\/(\d+)\/paid$/);
  if (req.method === "POST" && pm) {
    const order = store.getOrder(Number(pm[1]));
    if (!order || order.user_id !== user.id) return send(res, 404, { error: "Заказ не найден." });
    const r = await claimPaid(order, user.username);
    if (!r.ok) return send(res, 409, { error: r.error });
    return send(res, 200, { order: publicOrder(r.order) });
  }

  const m = url.pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
  if (req.method === "POST" && m) {
    const order = store.getOrder(Number(m[1]));
    if (!order || order.user_id !== user.id) return send(res, 404, { error: "Заказ не найден." });
    if (order.status !== "new") return send(res, 409, { error: "Заказ уже принят. Чтобы отменить, напишите нам в бот." });
    const updated = store.setStatus(order.id, "cancelled");
    await refreshAdminMessages(updated, user.username);
    for (const [chat] of updated.adminMsgs)
      await tgSafe("sendMessage", { chat_id: chat, text: `Покупатель отменил заказ №${order.id}.` });
    return send(res, 200, { order: publicOrder(updated) });
  }

  return send(res, 404, { error: "Не найдено" });
}

export function startServer(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname === "/privacy") return html(res, privacyPage());
      if (url.pathname === "/consent") return html(res, consentPage());
      if (url.pathname === "/terms") return html(res, termsPage());
      // Таблица заказов для Google Таблиц (по секретной ссылке)
      if (url.pathname === "/export/orders.csv") {
        if (!checkToken(url.searchParams.get("key"))) return send(res, 403, { error: "forbidden" });
        res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
        return res.end(ordersCsv());
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });
      // Магазин живёт на главной; старые адреса ведут туда же (?tab= магазин понимает сам)
      if (url.pathname === "/shop" || url.pathname === "/index.html") return redirect(res, "/" + url.search, 301);
      if (url.pathname === "/podbor") return redirect(res, "/?tab=quiz", 301);
      const page = sitePage(url.pathname, url.searchParams);
      if (page) {
        res.writeHead(page.status || 200, { "content-type": page.type || "text/html; charset=utf-8", "cache-control": "no-cache" });
        return res.end(page.body);
      }
      return serveStatic(req, res);
    } catch (e) {
      if (e instanceof OrderError) return send(res, 400, { error: e.message });
      console.error("[http]", e);
      return send(res, 500, { error: "Что-то пошло не так. Попробуйте ещё раз." });
    }
  });
  server.listen(port, () => console.log(`HTTP: порт ${port}`));
  return server;
}
