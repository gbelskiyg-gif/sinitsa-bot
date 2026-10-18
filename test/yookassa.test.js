import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Онлайн-оплата и подписка без настоящих ЮKassa и Telegram: перехватываем запросы
const TOKEN = "123456:TEST";
process.env.BOT_TOKEN = TOKEN;
process.env.PUBLIC_URL = "https://example.test";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sinitsa-yk-"));
process.env.ADMIN_IDS = "1";
process.env.SITE_ORDERS_PER_HOUR = "100";
process.env.YOOKASSA_API = "https://yk.mock/v3";
process.env.YOOKASSA_SHOP_ID = "1000";
process.env.YOOKASSA_SECRET_KEY = "test_secret";
process.env.YOOKASSA_RECURRING = "1";

const tgSent = [];
const yk = { payments: new Map(), receipts: [], creates: [], n: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/")) {
    tgSent.push({ method: u.split("/").pop(), ...JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: tgSent.length } }));
  }
  if (u.startsWith("https://yk.mock/v3/")) {
    assert.match(opts.headers.authorization, /^Basic /);
    const p = u.slice("https://yk.mock/v3".length);
    if (opts.method === "POST" && p === "/payments") {
      assert.ok(opts.headers["idempotence-key"], "нужен ключ идемпотентности");
      const b = JSON.parse(opts.body);
      yk.creates.push(b);
      const id = `pay_${++yk.n}`;
      const auto = !!b.payment_method_id;
      const pay = {
        id, status: auto ? "succeeded" : "pending", paid: auto, amount: b.amount, metadata: b.metadata,
        confirmation: auto ? undefined : { type: "redirect", confirmation_url: `https://yoomoney.mock/checkout/${id}` },
        payment_method: { id: b.payment_method_id || `pm_${yk.n}`, saved: auto || !!b.save_payment_method },
      };
      yk.payments.set(id, pay);
      return new Response(JSON.stringify(pay));
    }
    if (opts.method === "GET" && p.startsWith("/payments/")) {
      const pay = yk.payments.get(decodeURIComponent(p.split("/")[2]));
      return pay ? new Response(JSON.stringify(pay)) : new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
    }
    if (opts.method === "POST" && p === "/receipts") {
      yk.receipts.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: `r_${yk.receipts.length}`, status: "pending" }));
    }
  }
  return realFetch(url, opts);
};

const { signInitData } = await import("../src/auth.js");
const { startServer } = await import("../src/server.js");
const store = await import("../src/db.js");
const { receiptItems } = await import("../src/yookassa.js");
const payments = await import("../src/payments.js");

let server, base;
const user = { id: 77, first_name: "Покупатель" };
const init = signInitData(user, TOKEN);
const call = (p, { method = "GET", body, auth = init } = {}) =>
  fetch(base + p, { method, body: body && JSON.stringify(body), headers: { "content-type": "application/json", ...(auth ? { "x-telegram-init-data": auth } : {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
const succeed = (id) => { const p = yk.payments.get(id); p.status = "succeeded"; p.paid = true; };
const sumKop = (items) => items.reduce((s, i) => s + Math.round(Number(i.amount.value) * 100) * Number(i.quantity), 0);

before(async () => {
  server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("чек: скидки раскладываются на чай, доставка — услуга, сумма до копейки", () => {
  const items = receiptItems([
    { text: "Чай А, 50 г", qty: 2, sum: 1180, goods: true },
    { text: "Чай Б, 20 г", qty: 1, sum: 290, goods: true },
    { text: "Скидка на набор", qty: 1, sum: -150, goods: false },
    { text: "Доставка", qty: 1, sum: 290, goods: false },
  ]);
  assert.equal(sumKop(items), (1180 + 290 - 150 + 290) * 100);
  assert.equal(items.at(-1).payment_subject, "service");
  assert.equal(items.at(-1).amount.value, "290.00", "доставку скидка не трогает");
  assert.ok(items.every((i) => i.vat_code === 1 && i.payment_mode === "full_prepayment"));
});

test("заказ: оплата онлайн → «Оплачен», чек, второй чек при отправке", async () => {
  const r = await call("/api/orders", { method: "POST", body: { items: [{ teaId: 14, pack: "50", qty: 2 }], name: "Покупатель", phone: "8 900 123-45-67", delivery: "yandex", address: "Москва, ПВЗ 1", consent: true, terms: true } });
  assert.equal(r.status, 201);
  const id = r.body.order.id;
  // Пока заказ не подтвердили — платить нельзя
  assert.equal((await call(`/api/orders/${id}/pay`, { method: "POST" })).status, 400);
  store.setStatus(id, "accepted");
  const pub = (await call("/api/orders")).body.orders.find((o) => o.id === id);
  assert.deepEqual(pub.payment, { online: true });

  const pay = await call(`/api/orders/${id}/pay`, { method: "POST" });
  assert.equal(pay.status, 200);
  assert.match(pay.body.url, /^https:\/\/yoomoney\.mock\/checkout\//);
  const req = yk.creates.at(-1);
  const order = store.getOrder(id);
  assert.equal(req.amount.value, order.total.toFixed(2));
  assert.equal(sumKop(req.receipt.items), order.total * 100, "сумма чека = сумма заказа");
  assert.equal(req.receipt.customer.phone, "79001234567");
  assert.equal(req.metadata.kind, "order");
  assert.match(req.confirmation.return_url, /^https:\/\/t\.me\/.+\?start=paid_\d+$/);
  // Повторное нажатие — та же ссылка, новый платёж не создаём
  const again = await call(`/api/orders/${id}/pay`, { method: "POST" });
  assert.equal(again.body.url, pay.body.url);

  const pid = store.getOrder(id).yk_id;
  // Уведомление пришло раньше, чем платёж прошёл, — статус не меняем
  assert.equal((await call("/api/yookassa", { method: "POST", body: { event: "payment.succeeded", object: { id: pid } }, auth: "" })).status, 200);
  assert.equal(store.getOrder(id).status, "accepted");
  succeed(pid);
  const before_ = tgSent.length;
  await call("/api/yookassa", { method: "POST", body: { event: "payment.succeeded", object: { id: pid } }, auth: "" });
  await call("/api/yookassa", { method: "POST", body: { event: "payment.succeeded", object: { id: pid } }, auth: "" }); // дубль
  assert.equal(store.getOrder(id).status, "paid");
  assert.equal(store.getOrder(id).yk_status, "succeeded");
  assert.equal(tgSent.slice(before_).filter((m) => /оплачен онлайн/.test(m.text || "")).length, 1, "продавцу — одно сообщение");

  // Отправили: чек полного расчёта с зачётом предоплаты
  store.setStatus(id, "shipped");
  await payments.orderShipped(store.getOrder(id));
  const r2 = yk.receipts.at(-1);
  assert.equal(r2.payment_id, pid);
  assert.equal(r2.settlements[0].type, "prepayment");
  assert.equal(r2.settlements[0].amount.value, order.total.toFixed(2));
  assert.ok(r2.items.every((i) => i.payment_mode === "full_payment"));
  await payments.orderShipped(store.getOrder(id));
  assert.equal(yk.receipts.length, 1, "второй чек — один раз");
});

test("подделанное уведомление не меняет заказ", async () => {
  const r = await call("/api/yookassa", { method: "POST", body: { object: { id: "pay_fake", status: "succeeded", metadata: { kind: "order", id: "1" } } }, auth: "" });
  assert.equal(r.status, 500); // такого платежа в ЮKassa нет
});

test("подписка каждый месяц: первый платёж, конверт, автосписание, отмена", async () => {
  const club = await call("/api/club", { auth: "" });
  assert.equal(club.body.enabled, true);
  assert.ok(club.body.periods.month);
  const gourmet = club.body.plans.find((p) => p.key === "gourmet");
  assert.equal(gourmet.prices["6"], gourmet.price * 5, "6 конвертов по цене 5");

  const form = { plan: "intro", period: "month", name: "Аня", phone: "+7 900 111-22-33", email: "anya@example.ru", address: "123456, Москва, ул. Чайная, 1, кв. 2", terms: true, consent: true };
  assert.match((await call("/api/subs", { method: "POST", body: form, auth: "" })).body.error, /ежемесячное списание/);
  const r = await call("/api/subs", { method: "POST", body: { ...form, autopay: true }, auth: "" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { id } = r.body.sub;
  const req = yk.creates.at(-1);
  assert.equal(req.save_payment_method, true);
  assert.equal(req.amount.value, "690.00");
  assert.equal(req.receipt.customer.email, "anya@example.ru");
  assert.match(req.confirmation.return_url, new RegExp(`/\\?sub=${id}&t=`));

  // чужой ключ — не видно
  assert.equal((await call(`/api/subs/${id}?t=bad`, { auth: "" })).status, 404);
  const pid = store.getSub(id).charge_id;
  succeed(pid);
  await call("/api/yookassa", { method: "POST", body: { object: { id: pid } }, auth: "" });
  let s = store.getSub(id);
  assert.equal(s.status, "active");
  assert.equal(s.left_count, 1);
  assert.equal(s.yk_method, `pm_${pid.split("_")[1]}`);
  assert.ok(tgSent.some((m) => m.chat_id === 1 && /Пора отправить конверт/.test(m.text || "") && m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `sub:${id}:ship`));

  // продавец отправил конверт — второй чек на цену конверта
  await payments.shipSub(id);
  s = store.getSub(id);
  assert.equal(s.left_count, 0);
  assert.equal(s.status, "active", "ежемесячная подписка продолжается");
  assert.equal(yk.receipts.at(-1).settlements[0].amount.value, "690.00");

  // настал день списания
  store.db.prepare("UPDATE subs SET next_charge = datetime('now', '-1 minute') WHERE id = ?").run(id);
  await payments.chargeDue();
  const auto = yk.creates.at(-1);
  assert.equal(auto.payment_method_id, s.yk_method);
  assert.equal(auto.confirmation, undefined);
  s = store.getSub(id);
  assert.equal(s.left_count, 1);
  assert.ok(s.next_charge > new Date().toISOString().slice(0, 10), "следующее списание — через месяц");
  await payments.chargeDue();
  assert.equal(yk.creates.at(-1), auto, "повторно не списываем");

  // отмена: автосписаний больше нет, оплаченный конверт отправим
  const t = r.body.token;
  const c = await call(`/api/subs/${id}/cancel?t=${t}`, { method: "POST", auth: "" });
  assert.equal(c.body.sub.autorenew, false);
  assert.equal(c.body.sub.status, "active");
  assert.equal(store.getSub(id).yk_method, null, "карту забыли");
  await payments.shipSub(id);
  assert.equal(store.getSub(id).status, "finished");
});

test("подписка в подарок на 6 месяцев: предоплата, 6 конвертов, чеки делят сумму", async () => {
  const base_ = { plan: "gourmet", name: "Саша", phone: "89001112233", email: "sasha@example.ru", address: "Москва, ПВЗ Ozon, ул. Пример, 5", terms: true, consent: true, gift: true };
  assert.match((await call("/api/subs", { method: "POST", body: { ...base_, period: "month", autopay: true }, auth: "" })).body.error, /3 или 6/);
  assert.match((await call("/api/subs", { method: "POST", body: { ...base_, period: "6" }, auth: "" })).body.error, /кому дарите/);
  const r = await call("/api/subs", { method: "POST", body: { ...base_, period: "6", shipTo: "Мама, +7 900 000-00-01", note: "С днём рождения!" }, auth: "" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.sub.id;
  assert.equal(yk.creates.at(-1).amount.value, (1490 * 5).toFixed(2));
  assert.equal(yk.creates.at(-1).save_payment_method, undefined, "карту не сохраняем");
  const pid = store.getSub(id).charge_id;
  succeed(pid);
  await call("/api/yookassa", { method: "POST", body: { object: { id: pid } }, auth: "" });
  assert.equal(store.getSub(id).left_count, 6);
  const n0 = yk.receipts.length;
  for (let i = 0; i < 6; i++) await payments.shipSub(id);
  const parts = yk.receipts.slice(n0).map((x) => Math.round(Number(x.settlements[0].amount.value)));
  assert.equal(parts.length, 6);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1490 * 5, "чеки в сумме = оплате");
  assert.equal(store.getSub(id).status, "finished");
  assert.equal(await payments.shipSub(id), null, "лишний конверт не отметить");
});

test("без ключей ЮKassa всё работает по-старому", async () => {
  const { stdout } = await import("node:child_process").then(({ execFileSync }) => ({
    stdout: execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e",
      "const y = await import('./src/yookassa.js'); console.log(y.ykEnabled(), y.ykRecurring())"],
      { env: { ...process.env, YOOKASSA_SHOP_ID: "", YOOKASSA_SECRET_KEY: "" }, cwd: path.resolve(".") }).toString(),
  }));
  assert.equal(stdout.trim(), "false false");
});
