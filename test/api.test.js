import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = "123456:TEST";
process.env.BOT_TOKEN = TOKEN;
process.env.PUBLIC_URL = "https://example.test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sinitsa-"));
process.env.ADMIN_IDS = "";

const { signInitData, verifyInitData } = await import("../src/auth.js");
const { startServer } = await import("../src/server.js");
const store = await import("../src/db.js");

let server, base;
const user = { id: 42, first_name: "Тест", username: "tester" };
const init = signInitData(user, TOKEN);
const call = (p, opts = {}) =>
  fetch(base + p, { ...opts, headers: { "content-type": "application/json", "x-telegram-init-data": opts.init ?? init } }).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("подпись Telegram: верная принимается, подделка отклоняется", () => {
  assert.equal(verifyInitData(init, TOKEN).id, 42);
  assert.equal(verifyInitData(init.replace("42", "43"), TOKEN), null);
  assert.equal(verifyInitData(signInitData(user, TOKEN, 1000), TOKEN), null, "просроченная");
});

test("каталог доступен без входа", async () => {
  const r = await call("/api/catalog", { init: "" });
  assert.equal(r.status, 200);
  assert.equal(r.body.teas.length, 29);
  assert.ok(r.body.teas.every((t) => t.quiz && t.effect && t.prices["20"] > 0));
});

test("заказы без подписи запрещены", async () => {
  const r = await call("/api/orders", { init: "bad" });
  assert.equal(r.status, 401);
});

test("сумма считается по каталогу, а не по клиенту; набор даёт скидку 10%", async () => {
  const items = [1, 9, 13].map((id) => ({ teaId: id, pack: "20", qty: 1, set: "s1", price: 1 }));
  const r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items, name: "Тест", phone: "+7 900 123-45-67", delivery: "pickup" }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sum = 690 + 290 + 290;
  assert.equal(r.body.order.total, sum - Math.round(sum * 0.1 / 10) * 10);
});

test("ошибки формы понятные", async () => {
  const items = [{ teaId: 1, pack: "50", qty: 1 }];
  let r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items, name: "", phone: "1", delivery: "delivery" }) });
  assert.equal(r.status, 400); assert.match(r.body.error, /имя/);
  r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items, name: "А", phone: "89001234567", delivery: "delivery", address: "" }) });
  assert.match(r.body.error, /адрес/);
  r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items: [{ teaId: 999, pack: "50", qty: 1 }], name: "А", phone: "89001234567", delivery: "pickup" }) });
  assert.equal(r.status, 400);
});

test("нет в наличии — заказ не проходит", async () => {
  store.setAvailable(2, false);
  const r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items: [{ teaId: 2, pack: "50", qty: 1 }], name: "А", phone: "89001234567", delivery: "pickup" }) });
  assert.equal(r.status, 400); assert.match(r.body.error, /нет в наличии/);
  store.setAvailable(2, true);
});

test("мои заказы и отмена нового заказа", async () => {
  const list = await call("/api/orders");
  assert.ok(list.body.orders.length >= 1);
  const id = list.body.orders[0].id;
  const c = await call(`/api/orders/${id}/cancel`, { method: "POST" });
  assert.equal(c.body.order.status, "cancelled");
  const again = await call(`/api/orders/${id}/cancel`, { method: "POST" });
  assert.equal(again.status, 409);
  const other = await call(`/api/orders/${id}/cancel`, { method: "POST", init: signInitData({ id: 7 }, TOKEN) });
  assert.equal(other.status, 404, "чужой заказ не виден");
});

test("статика отдаётся, выход за папку запрещён", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Синица/);
  const bad = await fetch(base + "/..%2Fsrc%2Fconfig.js");
  assert.notEqual(bad.status, 200);
});
