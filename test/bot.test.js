import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Бот без настоящего Telegram: перехватываем запросы к API и запоминаем их
process.env.BOT_TOKEN = "123456:TEST";
process.env.PUBLIC_URL = "https://example.test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sinitsa-bot-"));
process.env.ADMIN_IDS = "1";
process.env.ORDERS_CHAT_ID = "";

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const method = String(url).split("/").pop();
    const body = JSON.parse(opts.body);
    sent.push({ method, ...body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  }
  return realFetch(url, opts);
};

const { _test } = await import("../src/bot.js");
const store = await import("../src/db.js");
const { buildOrder } = await import("../src/orders.js");

const adminMsg = (text) => ({ chat: { id: 1, type: "private" }, from: { id: 1, first_name: "Продавец" }, text, message_id: 1 });
const last = () => sent[sent.length - 1];

test("продавец задаёт реквизиты в боте, покупатель получает их при принятии заказа", async () => {
  await _test.onMessage(adminMsg("💳 Реквизиты"));
  assert.match(last().text, /ещё не заданы/);
  await _test.onMessage(adminMsg("+7 900 123-45-67\nТ-Банк\nАлександр Б."));
  assert.match(last().text, /Сохранили/);
  assert.deepEqual(store.getSetting("payment"), { phone: "+7 900 123-45-67", bank: "Т-Банк", name: "Александр Б." });

  const draft = buildOrder(
    { items: [{ teaId: 13, pack: "50", qty: 1 }], name: "Покупатель", phone: "89001234567", delivery: "ozon", address: "Москва, ПВЗ", consent: true, terms: true },
    { id: 500 },
    { isFirstOrder: false }
  );
  const order = store.createOrder(draft);
  sent.length = 0;
  await _test.onCallback({ id: "q1", data: `ord:${order.id}:accepted`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 7 } });
  const toCustomer = sent.find((m) => m.method === "sendMessage" && m.chat_id === 500);
  assert.match(toCustomer.text, /К оплате: 880/);
  assert.match(toCustomer.text, /Т-Банк/);
  assert.equal(toCustomer.reply_markup.inline_keyboard[0][0].callback_data, `paid:${order.id}`);

  sent.length = 0;
  await _test.onCallback({ id: "q2", data: `paid:${order.id}`, from: { id: 500 }, message: { chat: { id: 500 }, message_id: 9 } });
  assert.ok(store.getOrder(order.id).paid_claim_at, "отметка «оплатил» сохранена");
  assert.ok(sent.some((m) => m.chat_id === 1 && /сообщил об оплате/.test(m.text || "")), "продавцу пришло уведомление");

  sent.length = 0;
  await _test.onCallback({ id: "q3", data: `ord:${order.id}:paid`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 11 } });
  assert.equal(store.getOrder(order.id).status, "paid");
  assert.ok(sent.some((m) => m.chat_id === 500 && /Оплату по заказу/.test(m.text || "")));
});

test("личная встреча: при принятии без реквизитов, оплата на месте", async () => {
  const draft = buildOrder(
    { items: [{ teaId: 13, pack: "50", qty: 1 }], name: "П", phone: "89001234567", delivery: "meet", consent: true, terms: true },
    { id: 501 },
    { isFirstOrder: false }
  );
  const order = store.createOrder(draft);
  sent.length = 0;
  await _test.onCallback({ id: "q4", data: `ord:${order.id}:accepted`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 12 } });
  const m = sent.find((x) => x.chat_id === 501);
  assert.match(m.text, /при встрече/);
});

test("аналитика: брошенная корзина видна в статистике, бот один раз напоминает", async () => {
  store.upsertUser({ id: 700, first_name: "Анна", username: "anna" });
  store.logEvent(700, "app_open");
  store.logEvent(700, "quiz_start");
  store.logEvent(700, "quiz_step", 1);
  store.logEvent(700, "quiz_step", 2);
  store.logEvent(700, "cart_add", "Пуэр зайчик, тигр, дракон по годам · 50 г");
  store.logEvent(700, "cart_add", "набор «Пауза» · 20 г");
  // делаем вид, что это было 4 часа назад
  store.db.prepare("UPDATE events SET created_at = datetime('now','-4 hours') WHERE user_id = 700").run();

  const { text } = _test.statsText(7);
  assert.match(text, /Положили в корзину — \d/);
  assert.match(text, /вопрос 2 «на что похож чай» — 1/);
  assert.match(text, /Анна \(@anna\)/);

  sent.length = 0;
  await _test.autoRemind({ anyHour: true });
  const m = sent.find((x) => x.chat_id === 700);
  assert.ok(m, "напоминание отправлено");
  assert.match(m.text, /Пуэр зайчик, тигр, дракон по годам · 50 г/);
  assert.match(m.text, /набор «Пауза» · 20 г/);

  sent.length = 0;
  await _test.autoRemind({ anyHour: true });
  assert.ok(!sent.some((x) => x.chat_id === 700), "второй раз не пишем");
});

test("кто оформил заказ после корзины — не получает напоминание", async () => {
  store.logEvent(701, "cart_add", "Габа Дундин · 50 г");
  store.db.prepare("UPDATE events SET created_at = datetime('now','-5 hours') WHERE user_id = 701").run();
  const draft = buildOrder({ items: [{ teaId: 6, pack: "50", qty: 1 }], name: "Б", phone: "89001234567", delivery: "meet", consent: true, terms: true }, { id: 701 }, { isFirstOrder: true });
  store.createOrder(draft);
  sent.length = 0;
  await _test.autoRemind({ anyHour: true });
  assert.ok(!sent.some((x) => x.chat_id === 701));
});
