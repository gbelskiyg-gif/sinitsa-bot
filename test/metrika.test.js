import { test } from "node:test";
import assert from "node:assert/strict";

// Сводка Метрики без настоящего Яндекса: перехватываем запросы к API
process.env.METRIKA_API = "https://ym.mock";
process.env.METRIKA_ID = "113675520";
const calls = [];
let mode = "ok";
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  calls.push(u);
  assert.equal(opts.headers.authorization, "OAuth test-token");
  if (mode === "auth") return new Response("{}", { status: 403 });
  if (u.pathname === "/management/v1/counter/113675520/goals") {
    return Response.json({ goals: [
      { id: 2, name: "Положили в корзину", conditions: [{ type: "exact", url: "cart_add" }] },
      { id: 1, name: "Открыли чай", conditions: [{ type: "exact", url: "tea_open" }] },
      { id: 6, name: "Отправили заказ", conditions: [{ type: "exact", url: "order_sent" }] },
      { id: 9, name: "Переход в мессенджер", conditions: [] },
    ] });
  }
  assert.equal(u.pathname, "/stat/v1/data");
  const dim = u.searchParams.get("dimensions");
  const metrics = u.searchParams.get("metrics");
  if (!dim && metrics.startsWith("ym:s:visits,")) return Response.json({ totals: [50, 40, 120, 35.5, 95, 80] });
  if (!dim) return Response.json({ totals: metrics.split(",").map((_, i) => 20 - i * 5) });
  if (dim === "ym:s:lastsignTrafficSource") return Response.json({ data: [{ dimensions: [{ name: "Переходы из социальных сетей" }], metrics: [30] }] });
  if (dim === "ym:s:lastsignSourceEngine") return Response.json({ data: [{ dimensions: [{ name: "Instagram" }], metrics: [25] }, { dimensions: [{ name: null }], metrics: [5] }] });
  if (dim === "ym:s:deviceCategory") return Response.json({ data: [{ dimensions: [{ name: "Смартфоны" }], metrics: [45] }] });
  throw new Error("unexpected " + u);
};

const { metrikaReport } = await import("../src/metrika.js");

test("без токена — понятная подсказка", async () => {
  delete process.env.METRIKA_TOKEN;
  assert.match(await metrikaReport(7), /не подключена/);
});

test("сводка: посетители, воронка по порядку, источники", async () => {
  process.env.METRIKA_TOKEN = "test-token";
  const t = await metrikaReport(7);
  assert.match(t, /Посетители: <b>40<\/b>/);
  assert.match(t, /1 мин 35 с/);
  // порядок воронки: чай → корзина → заказ, затем прочие цели
  assert.ok(t.indexOf("Открыли чай") < t.indexOf("Положили в корзину") && t.indexOf("Положили в корзину") < t.indexOf("Отправили заказ"));
  assert.match(t, /Открыли чай — 20 \(50%\)/);
  assert.match(t, /Переход в мессенджер — 5/);
  assert.match(t, /Instagram — 25/);
  assert.match(t, /Смартфоны 90%/);
  const data = calls.find((u) => u.pathname === "/stat/v1/data");
  assert.equal(data.searchParams.get("date1"), "6daysAgo");
  assert.equal(data.searchParams.get("ids"), "113675520");
});

test("неверный токен — подсказка, а не падение", async () => {
  mode = "auth";
  assert.match(await metrikaReport(30), /токен не подходит/);
});
