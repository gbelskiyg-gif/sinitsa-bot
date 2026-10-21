import crypto from "node:crypto";
import { DELIVERY, STATUS, rub } from "./catalog.js";
import * as store from "./db.js";

// Таблица заказов для Google Таблиц: =IMPORTDATA("<ссылка>") подтягивает её сама примерно раз в час.
// Ссылка секретная: без ключа сервер ничего не отдаёт.
export function exportToken() {
  let t = store.getSetting("export_token", null);
  if (!t) {
    t = crypto.randomBytes(18).toString("base64url");
    store.setSetting("export_token", t);
  }
  return t;
}
export const checkToken = (key) => {
  const t = exportToken();
  return typeof key === "string" && key.length === t.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(t));
};

// Без имени, телефона, адреса и комментария: таблица лежит в Google (за рубежом). Контакты — в боте по кнопке.
const HEAD = ["№", "Дата (МСК)", "Статус", "Доставка", "Состав", "Чай, ₽", "Скидки, ₽", "Доставка, ₽", "Итого, ₽", "Промокод", "Покупатель отметил оплату", "Изменён (МСК)"];
const csvCell = (v) => {
  const s = String(v ?? "");
  // Не даём таблице принять текст за формулу
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const msk = (t) => (t ? new Date(Date.parse(t.replace(" ", "T") + "Z") + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "");

export function ordersCsv() {
  const rows = [HEAD];
  for (const o of store.ordersForExport()) {
    const tea = o.items.filter((i) => i.teaId);
    const disc = o.items.filter((i) => !i.teaId && i.sum < 0).reduce((s, i) => s + i.sum, 0);
    const dl = o.items.filter((i) => !i.teaId && i.sum > 0).reduce((s, i) => s + i.sum, 0);
    rows.push([
      o.id, msk(o.created_at), STATUS[o.status] || o.status, DELIVERY[o.delivery]?.label || o.delivery,
      tea.map((i) => `${i.name}, ${i.label} × ${i.qty}${i.set ? " (набор)" : ""}`).join("; "),
      tea.reduce((s, i) => s + i.sum, 0), disc, dl, o.total, o.promo, o.paid_claim_at ? "да" : "", msk(o.updated_at),
    ]);
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export const sheetFormula = (publicUrl) => `=IMPORTDATA("${publicUrl}/export/orders.csv?key=${exportToken()}")`;
