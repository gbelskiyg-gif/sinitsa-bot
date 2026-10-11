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
const withConsent = (opts) => {
  if (opts.method === "POST" && opts.body) {
    const b = JSON.parse(opts.body);
    if (!("consent" in b)) b.consent = true;
    return { ...opts, body: JSON.stringify(b) };
  }
  return opts;
};
const call = (p, opts = {}) =>
  fetch(base + p, { ...withConsent(opts), headers: { "content-type": "application/json", "x-telegram-init-data": opts.init ?? init } }).then(async (r) => ({ status: r.status, body: await r.json() }));

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
  r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items, name: "А", phone: "89001234567", delivery: "yandex", address: "" }) });
  assert.match(r.body.error, /адрес/);
  r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items, name: "А", phone: "89001234567", delivery: "drone" }) });
  assert.match(r.body.error, /способ доставки/);
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

test("готовый набор из 5 чаёв по 20 г получает скидку 10%", async () => {
  const u = { id: 501 };
  const ids = [4, 7, 16, 23, 11];
  const items = ids.map((id) => ({ teaId: id, pack: "20", qty: 1, set: "first-steps-x" }));
  const r = await call("/api/orders", { method: "POST", init: signInitData(u, TOKEN), body: JSON.stringify({ items, name: "Н", phone: "89001234567", delivery: "pickup" }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cat = (await call("/api/catalog", { init: "" })).body;
  const sum = ids.reduce((s, id) => s + cat.teas.find((t) => t.id === id).prices["20"], 0);
  assert.equal(r.body.order.total, sum - Math.round(sum * 0.1 / 10) * 10);
  assert.ok(cat.sets.length >= 4);
});

test("промокод: работает на первый заказ, не работает на второй, неверный код — ошибка", async () => {
  const u = signInitData({ id: 777 }, TOKEN);
  const body = (promo) => JSON.stringify({ items: [{ teaId: 13, pack: "50", qty: 2 }], name: "П", phone: "89001234567", delivery: "pickup", promo });
  let r = await call("/api/promo?code=синица10", { init: u });
  assert.equal(r.body.ok, true);
  r = await call("/api/orders", { method: "POST", init: u, body: body("НЕТТАКОГО") });
  assert.equal(r.status, 400);
  r = await call("/api/orders", { method: "POST", init: u, body: body("sinitsa10") });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.total, 590 * 2 - 120);
  r = await call("/api/orders", { method: "POST", init: u, body: body("SINITSA10") });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /первый заказ/);
});

test("отзыв через 3 дня после завершения и учёт в /api/me", async () => {
  const u = { id: 888 };
  const r = await call("/api/orders", { method: "POST", init: signInitData(u, TOKEN), body: JSON.stringify({ items: [{ teaId: 9, pack: "50", qty: 1 }], name: "О", phone: "89001234567", delivery: "pickup" }) });
  const id = r.body.order.id;
  store.setStatus(id, "done");
  assert.equal(store.ordersDueForFeedback(3).filter((o) => o.id === id).length, 0, "рано");
  store.db.prepare("UPDATE orders SET done_at = datetime('now','-4 days') WHERE id = ?").run(id);
  assert.equal(store.ordersDueForFeedback(3).filter((o) => o.id === id).length, 1);
  store.markFeedbackAsked(id);
  assert.equal(store.ordersDueForFeedback(3).filter((o) => o.id === id).length, 0, "спрашиваем один раз");
  store.saveFeedback(id, 888, { rating: "bad" });
  store.saveFeedback(id, 888, { wish: "softer" });
  const me = await call("/api/me", { init: signInitData(u, TOKEN) });
  assert.deepEqual(me.body.feedback[0], { rating: "bad", wish: "softer", teaIds: [9] });
});

test("без согласия на обработку данных заказ не принимается", async () => {
  const r = await call("/api/orders", { method: "POST", init: signInitData({ id: 990 }, TOKEN), body: JSON.stringify({ items: [{ teaId: 1, pack: "50", qty: 1 }], name: "А", phone: "89001234567", delivery: "pickup", consent: false }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /согласие/);
});

test("страницы политики и согласия открываются", async () => {
  for (const p of ["/privacy", "/consent"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /персональных данных/);
  }
});

test("через год персональные данные из завершённых заказов удаляются", async () => {
  const id = store.userOrders(42)[0].id;
  store.setStatus(id, "done");
  store.db.prepare("UPDATE orders SET updated_at = datetime('now','-400 days') WHERE id = ?").run(id);
  assert.ok(store.anonymizeOldOrders(365) >= 1);
  const o = store.getOrder(id);
  assert.equal(o.phone, ""); assert.equal(o.name, "");
  assert.ok(o.items.length > 0, "состав заказа остаётся");
});

test("фото чая подхватывается из public/teas", async () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "teas");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "1.webp");
  if (fs.existsSync(f)) return;
  fs.writeFileSync(f, "x");
  try {
    const cat = (await call("/api/catalog", { init: "" })).body;
    assert.match(cat.teas.find((t) => t.id === 1).photo, /^\/teas\/1\.webp\?v=\d+$/);
    assert.equal(cat.teas.find((t) => t.id === 1).photoExample, false);
  } finally { fs.unlinkSync(f); }
});

test("меню рассылается старым пользователям один раз", async () => {
  const store = await import("../src/db.js");
  store.upsertUser({ id: 777001, first_name: "Old" });
  assert.ok(store.usersWithoutMenu(1).includes(777001));
  store.markMenu(777001, 1);
  assert.ok(!store.usersWithoutMenu(1).includes(777001));
});

test("набор по 50 и 100 г тоже со скидкой 10%, смешанные фасовки — без скидки", async () => {
  const cat = (await call("/api/catalog", { init: "" })).body;
  const ids = [13, 14, 16];
  for (const pack of ["50", "100"]) {
    const items = ids.map((id) => ({ teaId: id, pack, qty: 1, set: "quiz-" + pack }));
    const r = await call("/api/orders", { method: "POST", init: signInitData({ id: 600 + Number(pack) }, TOKEN), body: JSON.stringify(withConsent({ items, name: "Н", phone: "89001234567", delivery: "pickup" })) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const sum = ids.reduce((s, id) => s + cat.teas.find((t) => t.id === id).prices[pack], 0);
    assert.equal(r.body.order.total, sum - Math.round(sum * 0.1 / 10) * 10);
  }
  const mixed = [["13", "20"], ["14", "50"], ["16", "50"]].map(([id, pack]) => ({ teaId: Number(id), pack, qty: 1, set: "mix" }));
  const r = await call("/api/orders", { method: "POST", init: signInitData({ id: 699 }, TOKEN), body: JSON.stringify(withConsent({ items: mixed, name: "Н", phone: "89001234567", delivery: "pickup" })) });
  const full = cat.teas.find((t) => t.id === 13).prices["20"] + cat.teas.find((t) => t.id === 14).prices["50"] + cat.teas.find((t) => t.id === 16).prices["50"];
  assert.equal(r.body.order.total, full);
});

test("доставка: бесплатно от порога для ПВЗ, скидка 300 ₽ для СДЭК", async () => {
  const { deliveryCost, FREE_DELIVERY_FROM } = await import("../src/catalog.js");
  assert.equal(deliveryCost("yandex", FREE_DELIVERY_FROM).free, true);
  assert.equal(deliveryCost("yandex", FREE_DELIVERY_FROM - 10).cost, 300);
  assert.equal(deliveryCost("cdek", FREE_DELIVERY_FROM).cost, 150);
  assert.equal(deliveryCost("meet", 100).cost, 0);
  const r = await call("/api/orders", { method: "POST", init: signInitData({ id: 801 }, TOKEN), body: JSON.stringify(withConsent({ items: [{ teaId: 13, pack: "50", qty: 1 }], name: "Д", phone: "89001234567", delivery: "ozon", address: "Москва, ул. Чайная, 1" })) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.order.delivery, "ozon");
});
