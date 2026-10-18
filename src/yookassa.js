// Онлайн-оплата через ЮKassa (карта, СБП, SberPay) с чеками по 54-ФЗ («Чеки от ЮKassa»).
// Без внешних библиотек: обычные запросы к API v3.
//
// Настройки в .env (пока ключей нет — магазин работает как раньше, переводом по реквизитам):
//   YOOKASSA_SHOP_ID       — shopId магазина из личного кабинета ЮKassa
//   YOOKASSA_SECRET_KEY    — секретный ключ (раздел «Интеграция → Ключи API»)
//   YOOKASSA_RECURRING=1   — включить подписку с ежемесячным автосписанием (ЮKassa включает автоплатежи по заявке)
//   YOOKASSA_TAX_SYSTEM    — код системы налогообложения для чека, если в ЮKassa их несколько (2 — УСН «доходы»)
//   YOOKASSA_VAT_CODE      — ставка НДС в чеке, по умолчанию 1 — «без НДС»
import crypto from "node:crypto";

const API = (process.env.YOOKASSA_API || "https://api.yookassa.ru/v3").replace(/\/+$/, "");
const SHOP = process.env.YOOKASSA_SHOP_ID || "";
const KEY = process.env.YOOKASSA_SECRET_KEY || "";
const TAX = Number(process.env.YOOKASSA_TAX_SYSTEM || 0);
const VAT = Number(process.env.YOOKASSA_VAT_CODE || 1);

export const ykEnabled = () => !!(SHOP && KEY);
export const ykRecurring = () => ykEnabled() && process.env.YOOKASSA_RECURRING === "1";

async function call(method, path, body, idem) {
  const headers = { authorization: "Basic " + Buffer.from(`${SHOP}:${KEY}`).toString("base64"), "content-type": "application/json" };
  if (method === "POST") headers["idempotence-key"] = idem || crypto.randomUUID();
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // В лог — только код и описание ошибки ЮKassa, без ключей
    const e = new Error(`ЮKassa ${r.status}: ${data.description || data.code || "ошибка"}`);
    e.yk = data;
    throw e;
  }
  return data;
}

const money = (kop) => ({ value: (kop / 100).toFixed(2), currency: "RUB" });

/** Покупатель в чеке: почта (лучше) или телефон в формате 79XXXXXXXXX. */
export function receiptCustomer({ email, phone, name }) {
  const c = {};
  if (email) c.email = email;
  else {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
    if (d.length === 10) d = "7" + d;
    if (d) c.phone = d;
  }
  if (name) c.full_name = String(name).slice(0, 256);
  return c;
}

/**
 * Строки чека из позиций заказа. Скидки (набор, промокод) — отрицательные строки заказа:
 * в чеке их быть не может, поэтому раскладываем скидку на чай пропорционально сумме, до копейки.
 * Доставка — услуга. Сумма строк всегда равна итогу заказа.
 */
export function receiptItems(lines, mode = "full_prepayment") {
  const pos = lines.filter((l) => l.sum > 0).map((l) => ({ ...l, kop: l.sum * 100 }));
  let discount = -lines.filter((l) => l.sum < 0).reduce((s, l) => s + l.sum, 0) * 100;
  const goods = pos.filter((l) => l.goods);
  const base = goods.reduce((s, l) => s + l.kop, 0);
  if (discount > 0 && base > 0) {
    discount = Math.min(discount, base);
    let left = discount;
    goods.forEach((l, i) => {
      const cut = i === goods.length - 1 ? left : Math.floor((discount * l.kop) / base);
      l.kop -= cut;
      left -= cut;
    });
  }
  return pos
    .filter((l) => l.kop > 0)
    .map((l) => {
      // Цену за штуку пишем, только если делится без остатка, иначе одна строка на всю сумму
      const q = l.qty > 1 && l.kop % l.qty === 0 ? l.qty : 1;
      return {
        description: String(q === 1 && l.qty > 1 ? `${l.text} × ${l.qty}` : l.text).slice(0, 128),
        quantity: q.toFixed(2),
        amount: money(l.kop / q),
        vat_code: VAT,
        payment_mode: mode,
        payment_subject: l.goods ? "commodity" : "service",
      };
    });
}

function receipt(customer, items) {
  return { customer: receiptCustomer(customer), items, ...(TAX ? { tax_system_code: TAX } : {}) };
}

/**
 * Создать платёж. Возвращает объект платежа ЮKassa (id, status, confirmation.confirmation_url).
 * methodId — списать с сохранённой карты (автоплатёж подписки), без участия покупателя.
 */
export function createPayment({ amount, description, metadata, returnUrl, customer, items, save = false, methodId = "", idem }) {
  const body = {
    amount: money(amount * 100),
    capture: true,
    description: String(description).slice(0, 128),
    metadata,
    receipt: receipt(customer, items),
  };
  if (methodId) body.payment_method_id = methodId;
  else body.confirmation = { type: "redirect", return_url: returnUrl };
  if (save) body.save_payment_method = true;
  return call("POST", "/payments", body, idem);
}

export const getPayment = (id) => call("GET", `/payments/${encodeURIComponent(id)}`);

/**
 * Второй чек — «полный расчёт» при передаче товара покупателю (после чека предоплаты).
 * amount — сколько из предоплаты засчитываем (в рублях).
 */
export function createSettlementReceipt({ paymentId, customer, items, amount, idem }) {
  return call("POST", "/receipts", {
    customer: receiptCustomer(customer),
    payment_id: paymentId,
    type: "payment",
    send: true,
    items,
    settlements: [{ type: "prepayment", amount: money(amount * 100) }],
    ...(TAX ? { tax_system_code: TAX } : {}),
  }, idem);
}
