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
process.env.SITE_ORDERS_PER_HOUR = "100";

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
    if (!("terms" in b)) b.terms = true;
    // Личной встречи больше нет — в старых тестах заказ идёт в ПВЗ Яндекса
    if (b.delivery === "pickup") { b.delivery = "yandex"; b.address ||= "Москва, ПВЗ"; }
    return { ...opts, body: JSON.stringify(b) };
  }
  return opts;
};
// Доставка 290 ₽ до порога бесплатной доставки
const withDl = (t) => t + (t < 3000 ? 290 : 0);
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
  assert.equal(r.body.teas.length, 37);
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
  assert.equal(r.body.order.total, withDl(sum - Math.round(sum * 0.1 / 10) * 10));
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
  assert.equal(r.body.order.total, withDl(sum - Math.round(sum * 0.1 / 10) * 10));
  assert.ok(cat.sets.length >= 4);
});

test("промокод: работает на первый заказ, не работает на второй, неверный код — ошибка", async () => {
  const u = signInitData({ id: 777 }, TOKEN);
  const body = (promo) => JSON.stringify({ items: [{ teaId: 13, pack: "50", qty: 2 }], name: "П", phone: "89005550101", delivery: "pickup", promo });
  let r = await call("/api/promo?code=синица10", { init: u });
  assert.equal(r.body.ok, true);
  r = await call("/api/orders", { method: "POST", init: u, body: body("НЕТТАКОГО") });
  assert.equal(r.status, 400);
  r = await call("/api/orders", { method: "POST", init: u, body: body("sinitsa10") });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.total, withDl(590 * 2 - 120));
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
  const t = await (await fetch(base + "/terms")).text();
  assert.match(t, /Вскрытую упаковку вернуть нельзя/);
  assert.match(t, /290 ₽/);
});

test("без согласия с условиями возврата заказ не принимается", async () => {
  const r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items: [{ teaId: 1, pack: "50", qty: 1 }], name: "А", phone: "89001234567", delivery: "meet", terms: false }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /условиями доставки и возврата/);
});

test("через 30 дней персональные данные из завершённых заказов удаляются", async () => {
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
    assert.equal(r.body.order.total, withDl(sum - Math.round(sum * 0.1 / 10) * 10));
  }
  const mixed = [["13", "20"], ["14", "50"], ["16", "50"]].map(([id, pack]) => ({ teaId: Number(id), pack, qty: 1, set: "mix" }));
  const r = await call("/api/orders", { method: "POST", init: signInitData({ id: 699 }, TOKEN), body: JSON.stringify(withConsent({ items: mixed, name: "Н", phone: "89001234567", delivery: "pickup" })) });
  const full = cat.teas.find((t) => t.id === 13).prices["20"] + cat.teas.find((t) => t.id === 14).prices["50"] + cat.teas.find((t) => t.id === 16).prices["50"];
  assert.equal(r.body.order.total, withDl(full));
});

test("доставка: фиксированная цена входит в итог, от порога бесплатно любой службой", async () => {
  const { deliveryCost, FREE_DELIVERY_FROM } = await import("../src/catalog.js");
  assert.equal(deliveryCost("yandex", FREE_DELIVERY_FROM).free, true);
  assert.equal(deliveryCost("cdek", FREE_DELIVERY_FROM).free, true);
  assert.equal(deliveryCost("yandex", FREE_DELIVERY_FROM - 10).cost, 290);
  assert.equal(deliveryCost("post", FREE_DELIVERY_FROM - 10).cost, 450);
  assert.equal(deliveryCost("meet", 100), null, "личной встречи больше нет");
  const send = (id, items, delivery) => call("/api/orders", { method: "POST", init: signInitData({ id }, TOKEN), body: JSON.stringify(withConsent({ items, name: "Д", phone: "89001234567", delivery, address: "Москва, ул. Чайная, 1" })) });
  let r = await send(801, [{ teaId: 13, pack: "50", qty: 1 }], "ozon");
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.order.delivery, "ozon");
  assert.equal(r.body.order.total, 590 + 290);
  r = await send(802, [{ teaId: 13, pack: "100", qty: 4 }], "cdek");
  assert.equal(r.body.order.total, 990 * 4);
});

test("оплата переводом: реквизиты в заказе, «Я оплатил», подтверждение продавцом", async () => {
  store.setSetting("payment", { phone: "+7 900 123-45-67", bank: "Т-Банк", name: "Александр Б." });
  const u = signInitData({ id: 901 }, TOKEN);
  let r = await call("/api/orders", { method: "POST", init: u, body: JSON.stringify({ items: [{ teaId: 13, pack: "50", qty: 1 }], name: "О", phone: "89001234567", delivery: "yandex", address: "Москва, ПВЗ 1" }) });
  const id = r.body.order.id;
  r = await call(`/api/orders/${id}/paid`, { method: "POST", init: u });
  assert.equal(r.status, 409, "новый заказ ещё не ждёт оплаты");
  store.setStatus(id, "accepted");
  r = await call("/api/orders", { init: u });
  const o = r.body.orders.find((x) => x.id === id);
  assert.equal(o.payment.bank, "Т-Банк");
  assert.equal(o.paidClaim, false);
  r = await call(`/api/orders/${id}/paid`, { method: "POST", init: u });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.paidClaim, true);
  r = await call(`/api/orders/${id}/paid`, { method: "POST", init: signInitData({ id: 902 }, TOKEN) });
  assert.equal(r.status, 404, "чужой заказ");
  const { canMove } = await import("../src/orders.js");
  assert.ok(canMove("accepted", "paid") && canMove("paid", "shipped") && canMove("accepted", "shipped"));
  store.setStatus(id, "paid");
  r = await call("/api/orders", { init: u });
  assert.equal(r.body.orders.find((x) => x.id === id).payment, null);
});

test("опт не кладётся в корзину, «Я оптовик» принимает запрос", async () => {
  let r = await call("/api/orders", { method: "POST", body: JSON.stringify({ items: [{ teaId: 1, pack: "wholesale", qty: 1 }], name: "О", phone: "89001234567", delivery: "yandex", address: "Москва" }) });
  assert.equal(r.status, 400);
  r = await call("/api/wholesale", { method: "POST", init: signInitData({ id: 4040, first_name: "Оптовик" }, TOKEN), body: JSON.stringify({ teaId: 3 }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  r = await call("/api/wholesale", { method: "POST", init: signInitData({ id: 4040, first_name: "Оптовик" }, TOKEN), body: JSON.stringify({}) });
  assert.equal(r.body.repeat, true, "повторный запрос в течение суток не дублируем");
  const cat = (await call("/api/catalog", { init: "" })).body;
  assert.ok(!("meet" in cat.delivery));
});

test("таблица заказов для Google: только по секретной ссылке, со всеми полями", async () => {
  const { exportToken } = await import("../src/export.js");
  let r = await fetch(base + "/export/orders.csv?key=wrong");
  assert.equal(r.status, 403);
  r = await fetch(base + "/export/orders.csv?key=" + exportToken());
  assert.equal(r.status, 200);
  const csv = await r.text();
  const [head, first] = csv.replace(/^\ufeff/, "").split("\n");
  assert.match(head, /№,Дата \(МСК\),Статус,Имя,Telegram,Телефон,Доставка,Адрес,Состав/);
  assert.ok(first && /^\d+,/.test(first), "есть строки заказов");
  assert.ok(!/^=/.test(csv.split(",").find((c) => c.startsWith("=")) || ""), "формулы не пропускаем");
});

test("сайт: главная, каталог, чай, блог и статьи с SEO-разметкой", async () => {
  for (const p of ["/", "/chai", "/chai/gaba-shanlinsi", "/blog", "/blog/puer-yunnan"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.match(html, /<title>[^<]{10,}<\/title>/, p);
    assert.match(html, /<meta name="description" content="[^"]{40,}">/, p);
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.test/, p);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `один H1 на ${p}`);
    assert.match(html, /application\/ld\+json/, p);
  }
  assert.equal((await fetch(base + "/chai/net-takogo")).status, 404);
  assert.equal((await fetch(base + "/blog/net-takoj")).status, 404);
});

test("сайт: sitemap и robots", async () => {
  const sm = await (await fetch(base + "/sitemap.xml")).text();
  assert.match(sm, /<loc>https:\/\/example\.test\/blog\/chai-tajvanya<\/loc>/);
  assert.equal((sm.match(/\/chai\//g) || []).length, 37, "все чаи в карте сайта");
  const rb = await (await fetch(base + "/robots.txt")).text();
  assert.match(rb, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  assert.match(rb, /Disallow: \/api\//);
});

test("магазин на главной: /shop и /podbor ведут туда, ?tab= открывает раздел", async () => {
  const home = await (await fetch(base + "/?tab=quiz")).text();
  assert.match(home, /id="view"/, "главная — это магазин");
  assert.match(home, /Как заказать/);
  let r = await fetch(base + "/shop?tab=cart", { redirect: "manual" });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "/?tab=cart");
  r = await fetch(base + "/podbor", { redirect: "manual" });
  assert.equal(r.headers.get("location"), "/?tab=quiz");
});

test("заказ с сайта без Telegram: сумма по каталогу, способ связи, промокод по телефону", async () => {
  const post = (body) => fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Сайт", delivery: "yandex", address: "Москва, ПВЗ", ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const items = [{ teaId: 1, pack: "50", qty: 1 }];
  const a = await post({ phone: "+7 999 555-44-33", items, contact: "wa", email: "buyer@mail.ru", promo: "SINITSA10" });
  assert.equal(a.status, 201);
  const o = store.getOrder(a.body.order.id);
  assert.equal(o.user_id, 0);
  assert.match(o.comment, /Связь: WhatsApp/);
  assert.equal(o.total, 1390 - 140 + 290);
  const b = await post({ phone: "8 (999) 555-44-33", items, promo: "SINITSA10" });
  assert.equal(b.status, 400, "второй заказ на тот же телефон — без промокода первого заказа");
  const spam = await post({ phone: "+7 900 000-00-01", items, website: "http://spam" });
  assert.equal(spam.status, 201);
  assert.equal(spam.body.order.id, 0, "скрытое поле заполнено — заказ не сохраняем");
});

test("вход на сайте через Telegram: сессия, заказ в профиле, подделка не проходит", async () => {
  const { signLoginWidget } = await import("../src/auth.js");
  const login = (data) => fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const bad = await login({ ...signLoginWidget({ id: 880044, first_name: "Сайт" }, TOKEN), id: 880045 });
  assert.equal(bad.status, 401, "подменили id — не пускаем");
  const old = await login(signLoginWidget({ id: 880044, first_name: "Сайт" }, TOKEN, Math.floor(Date.now() / 1000) - 3 * 86400));
  assert.equal(old.status, 401, "старая подпись");
  const ok = await login(signLoginWidget({ id: 880044, first_name: "Сайт", username: "site_user" }, TOKEN));
  assert.equal(ok.status, 200);
  const h = { "content-type": "application/json", "x-site-auth": ok.body.token };
  const created = await fetch(base + "/api/orders", { method: "POST", headers: h,
    body: JSON.stringify({ terms: true, consent: true, name: "Сайт", phone: "+7 900 777-77-77", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "20", qty: 1 }] }) });
  assert.equal(created.status, 201);
  const mine = await (await fetch(base + "/api/orders", { headers: h })).json();
  assert.equal(mine.orders.length, 1, "заказ виден в профиле с любого устройства");
  assert.equal(store.getOrder(mine.orders[0].id).user_id, 880044);
  const forged = await fetch(base + "/api/orders", { headers: { "x-site-auth": ok.body.token.replace(/.$/, (c) => (c === "A" ? "B" : "A")) } });
  assert.equal(forged.status, 401);
});

test("блины «зайчик / тигр / дракон»: без выбора заказ не проходит, вариант попадает в название", async () => {
  const post = (items) => fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Блин", phone: "+7 900 123-45-01", delivery: "yandex", address: "Москва, ПВЗ", items }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const no = await post([{ teaId: 10, pack: "100", qty: 1 }]);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /зайчик, тигр, дракон/);
  const fake = await post([{ teaId: 10, pack: "100", qty: 1, variant: "Слон" }]);
  assert.equal(fake.status, 400);
  const ok = await post([{ teaId: 10, pack: "100", qty: 1, variant: "Тигр" }]);
  assert.equal(ok.status, 201);
  assert.match(ok.body.order.items[0].name, /— Тигр$/);
  assert.equal(ok.body.order.items[0].variant, "Тигр");
});

test("заказ с сайта: по ключу видно статус, после подтверждения — реквизиты и ссылка на оплату, «Я оплатил»", async () => {
  const r = await fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Оплата", phone: "8 900 555-00-11", delivery: "yandex", address: "Москва, ПВЗ", contact: "wa", email: "pay@mail.ru", items: [{ teaId: 1, pack: "20", qty: 1 }] }) }).then((x) => x.json());
  assert.ok(r.token && r.token.length >= 20);
  const get = (t) => fetch(`${base}/api/site-orders/${r.order.id}?t=${t}`).then(async (x) => ({ status: x.status, body: await x.json() }));
  assert.equal((await get("chuzhoy")).status, 404, "без ключа заказ не открыть");
  let s = await get(r.token);
  assert.equal(s.body.order.status, "new");
  assert.equal(s.body.order.payment, null, "до подтверждения реквизитов нет");
  store.setSetting("payment", { phone: "+7 900 000-00-00", bank: "Т-Банк", name: "Александр Б.", link: "https://tbank.ru/cf/test" });
  store.setStatus(r.order.id, "accepted");
  s = await get(r.token);
  assert.equal(s.body.order.payment.link, "https://tbank.ru/cf/test");
  const { sitePaymentMessage, waNumber } = await import("../src/orders.js");
  assert.equal(waNumber("8 900 555-00-11"), "79005550011");
  assert.match(sitePaymentMessage(store.getOrder(r.order.id)), new RegExp(`\\?order=${r.order.id}&t=${r.token}`));
  const paid = await fetch(`${base}/api/site-orders/${r.order.id}/paid?t=${r.token}`, { method: "POST" }).then((x) => x.json());
  assert.equal(paid.order.paidClaim, true);
});

test("промокод: «синица 10» в любом регистре; повторный покупатель не проходит и после удаления номера", async () => {
  for (const code of ["синица10", "Синица 10", "СИНИЦА10", "sinitsa10"]) {
    const r = await fetch(`${base}/api/site-promo?code=${encodeURIComponent(code)}`).then((x) => x.json());
    assert.equal(r.ok, true, code);
    assert.equal(r.code, "SINITSA10");
  }
  const post = (body) => fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Повтор", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "50", qty: 1 }], ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const a = await post({ phone: "+7 911 222-33-44", promo: "синица 10" });
  assert.equal(a.status, 201);
  store.setStatus(a.body.order.id, "done");
  store.db.prepare("UPDATE orders SET updated_at = datetime('now','-400 days') WHERE id = ?").run(a.body.order.id);
  store.anonymizeOldOrders(365);
  assert.equal(store.getOrder(a.body.order.id).phone, "", "номер удалён");
  const b = await post({ phone: "8 911 222 33 44", promo: "СИНИЦА10" });
  assert.equal(b.status, 400, "по отпечатку номера видно, что заказ не первый");
  // Вход через Telegram не обходит проверку: новый аккаунт, но тот же телефон
  const fresh = signInitData({ id: 990077, first_name: "Новый" }, TOKEN);
  const c = await call("/api/orders", { method: "POST", init: fresh, body: JSON.stringify({ name: "Новый", phone: "+79112223344", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "50", qty: 1 }], promo: "SINITSA10" }) });
  assert.equal(c.status, 400);
});

test("заказ с сайта можно привязать к Telegram: ключ ссылки, чат сохраняется, статус видно на сайте", async () => {
  const { siteStartPayload, customerChat } = await import("../src/orders.js");
  const r = await fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "ТГ", phone: "+7 912 000-11-22", contact: "tg", nick: "@buyer", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "50", qty: 1 }] }) }).then((x) => x.json());
  const o = store.getOrder(r.order.id);
  assert.equal(siteStartPayload(o), `o${o.id}_${r.token.slice(0, 16)}`);
  assert.ok(siteStartPayload(o).length <= 64, "лимит Telegram на параметр start");
  assert.equal(customerChat(o), null);
  const get = () => fetch(`${base}/api/site-orders/${o.id}?t=${r.token}`).then((x) => x.json());
  assert.equal((await get()).order.tgLinked, false);
  store.linkOrderChat(o.id, 5550001);
  assert.equal(customerChat(store.getOrder(o.id)), 5550001);
  assert.equal((await get()).order.tgLinked, true);
});

test("вход на сайте: заказы, оформленные без входа, переходят в профиль и видны с любого устройства", async () => {
  const { signLoginWidget, signSession } = await import("../src/auth.js");
  const r = await fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Гость", phone: "+7 913 000-22-33", contact: "call", email: "guest@ya.ru", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "50", qty: 1 }] }) }).then((x) => x.json());
  const sess = signSession({ id: 880077, first_name: "Гость" }, TOKEN);
  const as = (p, opts = {}) => fetch(base + p, { ...opts, headers: { "content-type": "application/json", "x-site-auth": sess } }).then(async (x) => ({ status: x.status, body: await x.json() }));
  assert.equal((await as("/api/orders")).body.orders.length, 0);
  const bad = await as("/api/claim-orders", { method: "POST", body: JSON.stringify({ orders: [{ id: r.order.id, token: "0".repeat(24) }] }) });
  assert.equal(bad.body.claimed, 0, "без ключа чужой заказ не забрать");
  const ok = await as("/api/claim-orders", { method: "POST", body: JSON.stringify({ orders: [{ id: r.order.id, token: r.token }] }) });
  assert.equal(ok.body.claimed, 1);
  const mine = (await as("/api/orders")).body.orders;
  assert.equal(mine.length, 1); assert.equal(mine[0].id, r.order.id); assert.equal(mine[0].tgLinked, true);
  // другой аккаунт тот же заказ уже не заберёт
  const other = signSession({ id: 880078, first_name: "Чужой" }, TOKEN);
  const o2 = await fetch(base + "/api/claim-orders", { method: "POST", headers: { "content-type": "application/json", "x-site-auth": other }, body: JSON.stringify({ orders: [{ id: r.order.id, token: r.token }] }) }).then((x) => x.json());
  assert.equal(o2.claimed, 0);
});

test("почта: обязательна для WhatsApp и звонка, проверяется, письмо собирается с реквизитами и ссылкой на заказ", async () => {
  const { orderEmail } = await import("../src/orders.js");
  const post = (body) => fetch(base + "/api/site-orders", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: true, consent: true, name: "Почта", phone: "+7 914 111-22-33", delivery: "yandex", address: "Москва, ПВЗ", items: [{ teaId: 1, pack: "50", qty: 1 }], ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  let r = await post({ contact: "wa" });
  assert.equal(r.status, 400); assert.match(r.body.error, /почт/i);
  r = await post({ contact: "call", email: "не-почта" });
  assert.equal(r.status, 400); assert.match(r.body.error, /почт/i);
  r = await post({ contact: "tg" });
  assert.equal(r.status, 201, "для Telegram почта необязательна");
  r = await post({ contact: "call", email: "Client@Mail.ru", phone: "+7 914 111-22-44" });
  assert.equal(r.status, 201);
  const o = store.getOrder(r.body.order.id);
  assert.equal(o.email, "client@mail.ru");
  const m = orderEmail({ ...o, status: "accepted" }, "accepted");
  assert.match(m.subject, /подтверждён/);
  assert.match(m.text, /Заказ \d+/);
  assert.ok(m.text.includes(`?order=${o.id}&t=`), "ссылка на страницу заказа с QR");
  assert.match(m.html, /Открыть заказ на сайте/);
  store.setStatus(o.id, "done");
  store.db.prepare("UPDATE orders SET updated_at = datetime('now','-400 days') WHERE id = ?").run(o.id);
  store.anonymizeOldOrders(365);
  assert.equal(store.getOrder(o.id).email, "", "почта удаляется вместе с телефоном");
});
