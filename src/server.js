import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInitData } from "./auth.js";
import { BOT_TOKEN } from "./config.js";
import { KINDS, MUG_RECIPES, RECIPES, TASTES, TEAS, quizOf } from "./catalog.js";
import * as store from "./db.js";
import {
  OrderError,
  buildOrder,
  notifyAdminsNew,
  publicOrder,
  refreshAdminMessages,
} from "./orders.js";
import { tgSafe } from "./telegram.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, data) {
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

function auth(req) {
  return verifyInitData(req.headers["x-telegram-init-data"], BOT_TOKEN);
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
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(buf);
  });
}

async function api(req, res, url) {
  // Каталог доступен всем, в том числе вне Telegram
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const avail = store.availability();
    return send(res, 200, {
      teas: TEAS.map((t) => ({ ...t, available: avail[t.id] !== false, quiz: quizOf(t) })),
      kinds: KINDS,
      recipes: RECIPES,
      mugRecipes: MUG_RECIPES,
      tastes: TASTES,
    });
  }

  const user = auth(req);
  if (!user) return send(res, 401, { error: "Откройте магазин через бота @sinitsa_chai_bot в Telegram." });
  store.upsertUser(user);

  if (req.method === "GET" && url.pathname === "/api/orders") {
    return send(res, 200, { orders: store.userOrders(user.id).map(publicOrder) });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (store.recentOrderCount(user.id, 60) >= 5)
      return send(res, 429, { error: "Слишком много заказов за час. Напишите нам в бот, поможем." });
    const body = await readJson(req);
    const draft = buildOrder(body, user);
    const order = store.createOrder(draft);
    await notifyAdminsNew(order, user.username);
    await tgSafe("sendMessage", {
      chat_id: user.id,
      text: `Заказ №${order.id} получили 🍵\nСобираем чай под заказ. Продавец подтвердит наличие, итоговую сумму с доставкой и сроки здесь, в чате. Оплата после подтверждения.`,
    });
    return send(res, 201, { order: publicOrder(order) });
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
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });
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
