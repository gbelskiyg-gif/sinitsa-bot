import { notifyChats } from "./config.js";
import { DELIVERY, KINDS, PACKS, PROMOS, STATUS, deliveryCost, findTea, normalizePromo, packInfo, rub } from "./catalog.js";
import * as store from "./db.js";
import { esc, tgSafe } from "./telegram.js";
import { menuKeyboard } from "./menu.js";

export class OrderError extends Error {}

export const SET_DISCOUNT = 0.1;

const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Проверяет заказ из мини-приложения и считает сумму по ценам каталога (цены клиента не используются). */
// Набор: 3–6 разных чаёв одной фасовки (20, 50 или 100 г) в одинаковом количестве
export function isValidSet(group, get = (i) => i) {
  const g = group.map(get);
  return (
    g.length >= 3 &&
    g.length <= 6 &&
    new Set(g.map((i) => i.teaId)).size === g.length &&
    ["20", "50", "100"].includes(g[0].pack) &&
    g.every((i) => i.pack === g[0].pack && i.qty === g[0].qty)
  );
}
const discountLine = (name, label, discount) => ({ teaId: 0, name, pack: "", label, grams: 0, price: -discount, qty: 1, sum: -discount, set: "" });

/** Проверить промокод заранее, чтобы показать покупателю скидку в корзине. */
export function checkPromo(code, isFirstOrder) {
  const c = normalizePromo(code);
  const promo = PROMOS[c];
  if (!promo) return { ok: false, error: "Такого промокода нет." };
  if (promo.firstOrderOnly && !isFirstOrder) return { ok: false, error: "Этот промокод действует только на первый заказ." };
  return { ok: true, code: c, percent: promo.percent, label: promo.label };
}

export function buildOrder(body, user, { isFirstOrder = false } = {}) {
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) throw new OrderError("Корзина пуста.");
  if (raw.length > 30) throw new OrderError("Слишком много позиций в одном заказе.");
  const avail = store.availability();
  const items = [];
  for (const it of raw) {
    const tea = findTea(it.teaId);
    const pack = String(it.pack);
    const qty = Number(it.qty);
    if (!tea || !PACKS.includes(pack) || !Number.isInteger(qty) || qty < 1 || qty > 20)
      throw new OrderError("В корзине есть неизвестная позиция. Обновите приложение.");
    if (avail[tea.id] === false) throw new OrderError(`«${tea.name}» сейчас нет в наличии. Удалите его из корзины.`);
    const p = packInfo(tea, pack);
    const set = typeof it.set === "string" ? it.set.slice(0, 40) : "";
    items.push({ teaId: tea.id, name: tea.name, pack, label: p.label, grams: p.grams, price: p.price, qty, sum: p.price * qty, set });
  }
  // Набор: 3–6 разных чаёв по 20 г в одинаковом количестве, скидка 10%
  const sets = {};
  for (const i of items) if (i.set) (sets[i.set] ||= []).push(i);
  const inValidSet = new Set();
  for (const group of Object.values(sets)) {
    if (!isValidSet(group)) continue;
    group.forEach((i) => inValidSet.add(i));
    const discount = Math.round((group.reduce((s, i) => s + i.sum, 0) * SET_DISCOUNT) / 10) * 10;
    items.push(discountLine("Скидка на набор", "−10%", discount));
  }
  // Промокод: действует на всё, что не входит в набор со скидкой
  const code = normalizePromo(body.promo);
  if (code) {
    const promo = PROMOS[code];
    if (!promo) throw new OrderError("Такого промокода нет. Проверьте написание или уберите его.");
    if (promo.firstOrderOnly && !isFirstOrder) throw new OrderError("Этот промокод действует только на первый заказ.");
    const base = items.filter((i) => i.teaId && !inValidSet.has(i)).reduce((s, i) => s + i.sum, 0);
    const discount = Math.round((base * promo.percent) / 100 / 10) * 10;
    if (discount > 0) items.push(discountLine(`Промокод ${code}`, `−${promo.percent}%`, discount));
  }
  const name = clean(body.name, 80);
  const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
  // «pickup» — старое название личной встречи
  const delivery = body.delivery === "pickup" ? "meet" : String(body.delivery || "");
  const address = clean(body.address, 300);
  const comment = clean(body.comment, 500);
  if (body.terms !== true) throw new OrderError("Отметьте, что согласны с условиями доставки и возврата.");
  if (body.consent !== true) throw new OrderError("Отметьте согласие на обработку персональных данных.");
  if (!name) throw new OrderError("Укажите имя.");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) throw new OrderError("Проверьте телефон: нужно от 10 до 15 цифр.");
  if (!DELIVERY[delivery]) throw new OrderError("Выберите способ доставки.");
  const needAddress = !!DELIVERY[delivery].address;
  if (needAddress && address.length < 5) throw new OrderError("Укажите город и адрес пункта выдачи.");
  // Доставка — отдельной строкой, входит в итог
  const goods = Math.max(0, items.reduce((s, i) => s + i.sum, 0));
  const dc = deliveryCost(delivery, goods);
  if (dc.cost > 0) items.push({ teaId: 0, name: `Доставка: ${DELIVERY[delivery].label}`, pack: "", label: "", grams: 0, price: dc.cost, qty: 1, sum: dc.cost, set: "" });
  return {
    userId: user.id,
    name,
    phone: clean(body.phone, 30),
    delivery,
    address: needAddress ? address : "",
    comment,
    items,
    total: Math.max(0, items.reduce((s, i) => s + i.sum, 0)),
    promo: code || "",
  };
}

export function orderText(o, { forAdmin = false, username = "" } = {}) {
  const lines = [`<b>Заказ №${o.id}</b> · ${STATUS[o.status]}`, ""];
  for (const i of o.items)
    lines.push(i.teaId ? `• ${esc(i.name)}, ${esc(i.label)} × ${i.qty} = ${rub(i.sum)}` : i.sum >= 0 ? `• ${esc(i.name)}: ${rub(i.sum)}` : `• ${esc(i.name)}: −${rub(-i.sum)}`);
  lines.push("", `<b>Итого: ${rub(o.total)}</b>`);
  const dl = DELIVERY[o.delivery];
  const paid = o.items.some((i) => !i.teaId && i.sum > 0);
  lines.push(dl ? `🚚 ${dl.label}${dl.price && !paid ? " — бесплатно" : ""}` : "🚚 доставка по договорённости");
  if (forAdmin) {
    lines.push("", `👤 ${esc(o.name)}${username ? ` (@${esc(username)})` : ""}`, `📞 ${esc(o.phone)}`);
    if (o.address) lines.push(`📍 ${esc(o.address)}`);
    if (o.status === "accepted" && o.paid_claim_at) lines.push("💳 Покупатель сообщил, что оплатил — проверьте банк");
    if (o.comment) lines.push(`💬 ${esc(o.comment)}`);
  }
  return lines.join("\n");
}

// Какие кнопки доступны продавцу в каждом статусе
const NEXT = {
  new: [["accepted", "✅ Принять"], ["cancelled", "✖️ Отменить"]],
  // «Отправлен» сразу из «Принят» — для личной встречи с оплатой на месте
  accepted: [["paid", "💰 Оплата получена"], ["shipped", "📦 Отправлен"], ["cancelled", "✖️ Отменить"]],
  paid: [["shipped", "📦 Отправлен"], ["cancelled", "✖️ Отменить"]],
  shipped: [["done", "🏁 Завершён"]],
  done: [],
  cancelled: [],
};
export const canMove = (from, to) => NEXT[from]?.some(([s]) => s === to);

export function adminKeyboard(o) {
  const btns = NEXT[o.status].map(([s, label]) => ({ text: label, callback_data: `ord:${o.id}:${s}` }));
  // По две кнопки в ряд, чтобы подписи не обрезались
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  return { inline_keyboard: rows };
}

// ---------- оплата переводом ----------
/** Реквизиты: { phone, bank, name } — продавец задаёт их в боте кнопкой «💳 Реквизиты». */
export const getPayment = () => store.getSetting("payment", null);
export function paymentText(o) {
  const p = getPayment();
  const head = `Заказ №${o.id} принят 🍵\nК оплате: ${rub(o.total)}`;
  if (!p) return `${head}\n\nРеквизиты для оплаты продавец пришлёт в этом чате.`;
  return `${head}\n\nПереведите по СБП (по номеру телефона):\n📱 ${p.phone}\n🏦 ${p.bank}\n👤 ${p.name}\n\nВ комментарии к переводу укажите «Заказ ${o.id}». После перевода нажмите кнопку ниже — продавец проверит и подтвердит.`;
}
const payButton = (o) => ({ inline_keyboard: [[{ text: "✅ Я оплатил", callback_data: `paid:${o.id}` }]] });

/** Покупатель сообщил об оплате: отмечаем и зовём продавца проверить. */
export async function claimPaid(order, username = "") {
  if (order.status !== "accepted") return { ok: false, error: order.status === "paid" ? "Оплата уже подтверждена." : "Этот заказ сейчас не ждёт оплаты." };
  if (order.paid_claim_at) return { ok: true, order };
  const updated = store.setPaidClaim(order.id, true);
  await refreshAdminMessages(updated, username);
  for (const chat of notifyChats())
    await tgSafe("sendMessage", {
      chat_id: chat,
      text: `💳 Покупатель сообщил об оплате заказа №${order.id} на ${rub(order.total)}. Проверьте поступление в банке.`,
      reply_markup: { inline_keyboard: [[{ text: "💰 Оплата получена", callback_data: `ord:${order.id}:paid` }, { text: "❌ Не вижу оплату", callback_data: `payno:${order.id}` }]] },
    });
  return { ok: true, order: updated };
}
/** Продавец не нашёл перевод: сбрасываем отметку и снова даём покупателю кнопку. */
export async function rejectPaid(order) {
  const updated = store.setPaidClaim(order.id, false);
  await tgSafe("sendMessage", {
    chat_id: order.user_id,
    text: `Пока не видим перевод по заказу №${order.id} на ${rub(order.total)}. Проверьте, пожалуйста, реквизиты и сумму или пришлите сюда скриншот перевода.`,
    reply_markup: payButton(order),
  });
  return updated;
}

const CUSTOMER_STATUS = {
  paid: "Оплату по заказу №{id} получили, спасибо! Собираем чай и скоро отправим 📦",
  shipped: "Заказ №{id} отправлен. Спасибо, что выбрали «Синицу»!\n\n📦 Когда будете забирать, осмотрите посылку прямо в пункте выдачи. Если она повреждена — сфотографируйте и попросите сотрудника составить акт, не забирая её. Потом напишите нам сюда — заменим или вернём деньги.",
  done: "Заказ №{id} завершён. Приятного чаепития! Если захотите поделиться впечатлением, просто напишите сюда.",
  cancelled: "Заказ №{id} отменён. Если это ошибка или остались вопросы, напишите сюда.",
};

export async function notifyAdminsNew(order, username) {
  const msgs = [];
  for (const chat of notifyChats()) {
    const m = await tgSafe("sendMessage", {
      chat_id: chat,
      text: "🆕 " + orderText(order, { forAdmin: true, username }),
      parse_mode: "HTML",
      reply_markup: adminKeyboard(order),
    });
    if (m) msgs.push([chat, m.message_id]);
  }
  store.setAdminMsgs(order.id, msgs);
}

export async function refreshAdminMessages(order, username) {
  for (const [chat, msg] of order.adminMsgs) {
    await tgSafe("editMessageText", {
      chat_id: chat,
      message_id: msg,
      text: orderText(order, { forAdmin: true, username }),
      parse_mode: "HTML",
      reply_markup: adminKeyboard(order),
    });
  }
}

export async function notifyCustomer(order) {
  if (order.status === "accepted") {
    // Личная встреча — оплата на месте, реквизиты не нужны
    if (order.delivery === "meet") return tgSafe("sendMessage", { chat_id: order.user_id, text: `Заказ №${order.id} принят 🍵\nК оплате при встрече: ${rub(order.total)}. Место и время согласуем здесь, в чате.`, reply_markup: menuKeyboard(order.user_id) });
    return tgSafe("sendMessage", { chat_id: order.user_id, text: paymentText(order), reply_markup: getPayment() ? payButton(order) : menuKeyboard(order.user_id) });
  }
  const t = CUSTOMER_STATUS[order.status];
  if (t) await tgSafe("sendMessage", { chat_id: order.user_id, text: t.replace("{id}", order.id), reply_markup: menuKeyboard(order.user_id) });
}

/** Публичное представление заказа для мини-приложения. */
export function publicOrder(o) {
  return {
    id: o.id,
    status: o.status,
    statusLabel: STATUS[o.status],
    createdAt: o.created_at,
    items: o.items.map(({ teaId, name, label, qty, sum, pack, set }) => ({ teaId, name, label, qty, sum, pack, set })),
    total: o.total,
    delivery: o.delivery,
    canCancel: o.status === "new",
    // Ждёт оплаты: показываем реквизиты в «Моих заказах»
    payment: o.status === "accepted" && o.delivery !== "meet" ? getPayment() : null,
    paidClaim: !!o.paid_claim_at,
  };
}

export { KINDS };
