import { PUBLIC_URL, notifyChats } from "./config.js";
import { EMAIL_RE, sendMail } from "./mail.js";
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
    // Чай с вариантами (например, блины «зайчик / тигр / дракон»): вариант обязателен
    let variant = "";
    if (Array.isArray(tea.variants) && tea.variants.length) {
      variant = tea.variants.find((v) => v === it.variant) || "";
      if (!variant) throw new OrderError(`Выберите вариант для «${tea.name}»: ${tea.variants.join(", ").toLowerCase()}.`);
    }
    items.push({ teaId: tea.id, name: variant ? `${tea.name} — ${variant}` : tea.name, pack, label: p.label, grams: p.grams, price: p.price, qty, sum: p.price * qty, set, ...(variant ? { variant } : {}) });
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
  const delivery = String(body.delivery || "");
  const address = clean(body.address, 300);
  let comment = clean(body.comment, 500);
  // Заказ с сайта: как удобнее связаться (в Telegram заказ и так привязан к чату)
  const CONTACT = { tg: "Telegram", wa: "WhatsApp", call: "звонок" };
  if (!user.id && CONTACT[body.contact]) {
    const nick = clean(body.contactNick, 60);
    comment = [`Связь: ${CONTACT[body.contact]}${nick ? ` ${nick}` : ""}`, comment].filter(Boolean).join(" · ");
  }
  if (body.terms !== true) throw new OrderError("Отметьте, что согласны с условиями доставки и возврата.");
  if (body.consent !== true) throw new OrderError("Отметьте согласие на обработку персональных данных.");
  if (!name) throw new OrderError("Укажите имя.");
  const email = clean(body.email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new OrderError("Проверьте почту: похоже, в адресе ошибка.");
  if (!user.id && body.contact === "tg") {
    const nick = clean(body.contactNick, 60).replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
    if (!/^[A-Za-z0-9_]{4,32}$/.test(nick)) throw new OrderError("Укажите ник в Telegram (например, @username) — по нему мы с вами свяжемся.");
  }
  if (!user.id && ["wa", "call"].includes(body.contact) && !email)
    throw new OrderError("Укажите почту — пришлём на неё подтверждение, реквизиты и QR для оплаты.");
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
    email,
  };
}

export function orderText(o, { forAdmin = false, username = "" } = {}) {
  const lines = [`<b>Заказ №${o.id}</b> · ${STATUS[o.status]}`, ""];
  if (forAdmin && !o.user_id) lines.splice(1, 0, "🌐 С сайта — свяжитесь с покупателем, подтвердите заказ и пришлите реквизиты");
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
  // «Отправлен» сразу из «Принят» — если оплату получили не через бота
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
// Реквизиты по умолчанию; кнопка «💳 Реквизиты» в боте их заменяет
const DEFAULT_PAYMENT = { phone: "8 905 589 03 71", bank: "Т-Банк", name: "Александр Б." };
export const getPayment = () => store.getSetting("payment", DEFAULT_PAYMENT);
// Два вида реквизитов:
//  • СБП по телефону: { phone, bank, name, link? }
//  • расчётный счёт ИП: { type: "account", name, inn, acc, bic, corr, bank } — для него
//    делаем QR-код по ГОСТ Р 56042 (ST00012): приложение банка само заполнит получателя, сумму и назначение.
export const isAccount = (p) => p?.type === "account";
export const payPurpose = (o) => `Оплата заказа №${o.id}. НДС не облагается`;
/** Строка для QR-кода «оплата по реквизитам» с суммой заказа (в копейках). */
export function accountQr(p, o) {
  const f = (x) => String(x ?? "").replace(/[|\r\n]/g, " ").trim();
  return ["ST00012", `Name=${f(p.name)}`, `PersonalAcc=${p.acc}`, `BankName=${f(p.bank)}`, `BIC=${p.bic}`, `CorrespAcc=${p.corr}`,
    `PayeeINN=${p.inn}`, `Sum=${Math.round(o.total * 100)}`, `Purpose=${f(payPurpose(o))}`].join("|");
}
/** Контрольная цифра расчётного счёта (проверка по БИК) — ловит опечатки в номере. */
export function accountValid(acc, bic) {
  if (!/^\d{20}$/.test(acc) || !/^\d{9}$/.test(bic)) return false;
  const s = bic.slice(-3) + acc;
  let t = 0;
  for (let i = 0; i < 23; i++) t += Number(s[i]) * [7, 1, 3][i % 3];
  return t % 10 === 0;
}
/** Реквизиты текстом (для Telegram, WhatsApp и писем). */
export function payLines(p, o) {
  if (isAccount(p))
    return [`Перевод на расчётный счёт:`, `👤 ${p.name}`, `ИНН ${p.inn}`, `Счёт ${p.acc}`, `🏦 ${p.bank}, БИК ${p.bic}`, `Корр. счёт ${p.corr}`, `Назначение: «${payPurpose(o)}»`];
  return [`Перевод по СБП (по номеру телефона):`, `📱 ${p.phone}`, `🏦 ${p.bank}`, `👤 ${p.name}`, `В комментарии к переводу: «Заказ ${o.id}».`];
}
export function paymentText(o) {
  const p = getPayment();
  const head = `Заказ №${o.id} принят 🍵\nК оплате: ${rub(o.total)}`;
  if (!p) return `${head}\n\nРеквизиты для оплаты пришлём в этом чате.`;
  const qr = isAccount(p) ? `\n\nПроще всего — QR-код: откройте «Мои заказы» в магазине (кнопка «Магазин» внизу), сохраните QR-код и загрузите его в приложении банка в разделе «Оплата по QR». Сумма и все реквизиты заполнятся сами.` : "";
  return `${head}\n\n${payLines(p, o).join("\n")}${qr}\n\nПосле перевода нажмите кнопку ниже — мы проверим и подтвердим.`;
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
  if (!customerChat(order)) return updated;
  await tgSafe("sendMessage", {
    chat_id: customerChat(order),
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

// ---------- заказы с сайта: помогаем продавцу отправить реквизиты туда, где удобно покупателю ----------
/** Страница заказа на сайте: статус, а после подтверждения — QR и реквизиты. */
export const siteOrderUrl = (o) => (o.site_token ? `${PUBLIC_URL}/?order=${o.id}&t=${o.site_token}` : "");
/** Номер для WhatsApp: только цифры, российский номер с 8 или без кода → 7XXXXXXXXXX. */
export function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d;
}
/** Готовое сообщение покупателю: сумма, ссылка на страницу оплаты и реквизиты. */
export function sitePaymentMessage(o) {
  const p = getPayment();
  const lines = [`Здравствуйте! Это «Синица» 🍵`, `Заказ №${o.id} подтвердили. К оплате: ${rub(o.total)}.`];
  const url = siteOrderUrl(o);
  if (url) lines.push("", `Оплатить можно на странице заказа — там QR-код и реквизиты:`, url);
  if (p) lines.push("", ...payLines(p, o));
  if (p?.link) lines.push("", `Ссылка на оплату: ${p.link}`);
  return lines.join("\n");
}
/** Куда писать покупателю: Telegram-аккаунт заказа или чат, привязанный по ссылке с сайта. */
export const customerChat = (o) => o.user_id || o.tg_chat || null;
/** Ссылка «Получать статус в Telegram» для заказа с сайта: t.me/бот?start=o<id>_<ключ> */
export const siteStartPayload = (o) => (o.site_token ? `o${o.id}_${o.site_token.slice(0, 16)}` : "");
async function helpAdminsWithSitePayment(o) {
  const contact = (String(o.comment || "").match(/Связь: (Telegram|WhatsApp|звонок)(?: (\S+))?/) || []);
  const how = contact[1] || "звонок";
  const nick = (contact[2] || "").replace(/^@/, "").replace(/[^\w]/g, "");
  const msg = sitePaymentMessage(o);
  const buttons = [];
  if (how === "WhatsApp") buttons.push([{ text: "💬 Отправить в WhatsApp", url: `https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(msg)}` }]);
  if (how === "Telegram" && nick) buttons.push([{ text: `✈️ Написать @${nick}`, url: `https://t.me/${nick}` }]);
  const url = siteOrderUrl(o);
  if (url) buttons.push([{ text: "🔗 Страница оплаты заказа", url }]);
  const hint = how === "WhatsApp" ? "Нажмите «Отправить в WhatsApp» — сообщение уже набрано, останется отправить."
    : how === "Telegram" ? `Покупатель просил связаться в Telegram${nick ? ` (@${nick})` : ""}. Скопируйте текст ниже и отправьте ему.`
    : `Покупатель просил позвонить: ${o.phone}. Реквизиты он увидит на странице заказа — или отправьте текст ниже по СМС.`;
  for (const chat of notifyChats())
    await tgSafe("sendMessage", { chat_id: chat, text: `🌐 Заказ №${o.id} с сайта принят.\n${hint}\n\nТекст для покупателя:\n\n${msg}`, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}), disable_web_page_preview: true });
}

// ---------- письма покупателю (дублируют Telegram; для WhatsApp и звонка — главный канал) ----------
const escH = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const orderPageUrl = (o) => siteOrderUrl(o) || `${PUBLIC_URL}/#orders`;
function itemsText(o) {
  return o.items.map((i) => (i.teaId ? `• ${i.name}, ${i.label} × ${i.qty} — ${rub(i.sum)}` : `• ${i.name}: ${i.sum < 0 ? "−" : ""}${rub(Math.abs(i.sum))}`)).join("\n");
}
function mailLayout(title, bodyHtml, o) {
  const rows = o.items.map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${escH(i.name)}${i.teaId ? `<br><span style="color:#888;font-size:13px">${escH(i.label)} × ${i.qty}</span>` : ""}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${i.sum < 0 ? "−" : ""}${escH(rub(Math.abs(i.sum)))}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4efe8;font-family:Arial,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#100f15;color:#edbe82;padding:18px 22px;border-radius:14px 14px 0 0;font:italic 26px Georgia,serif">Синица</div>
<div style="background:#fff;padding:22px;border-radius:0 0 14px 14px">
<h2 style="margin:0 0 12px;font:22px Georgia,serif">${escH(title)}</h2>
${bodyHtml}
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${rows}
<tr><td style="padding:10px 0;font-weight:bold">Итого</td><td style="padding:10px 0;text-align:right;font-weight:bold">${escH(rub(o.total))}</td></tr></table>
<p style="margin:16px 0 0"><a href="${escH(orderPageUrl(o))}" style="display:inline-block;background:#edbe82;color:#21141a;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">Открыть заказ на сайте</a></p>
<p style="color:#888;font-size:12px;margin:18px 0 0">Вопросы — просто ответьте на это письмо или напишите нам в Telegram: @alpha_omega_Y, @Ont_hefly.</p>
</div></div></body></html>`;
}
export function orderEmail(o, event) {
  const p = getPayment();
  const page = orderPageUrl(o);
  const head = { created: `Заказ №${o.id} получили`, accepted: `Заказ №${o.id} подтверждён — можно оплатить`, paid: `Оплату по заказу №${o.id} получили`, shipped: `Заказ №${o.id} отправлен`, done: `Заказ №${o.id} завершён`, cancelled: `Заказ №${o.id} отменён` }[event];
  if (!head) return null;
  let text = "", html = "";
  if (event === "created") {
    text = `Спасибо за заказ! Проверим наличие и пришлём на эту почту сумму и реквизиты для оплаты.`;
    html = `<p>${escH(text)}</p>`;
  } else if (event === "accepted") {
    const pay = p ? payLines(p, o) : [`Реквизиты для оплаты пришлём отдельно.`];
    text = [`Заказ подтвердили, всё есть в наличии. К оплате: ${rub(o.total)}.`, "", ...pay, ...(p?.link ? ["", `Оплатить в приложении банка: ${p.link}`] : []), "", `QR-код для оплаты и кнопка «Я оплатил» — на странице заказа: ${page}`].join("\n");
    html = `<p>Заказ подтвердили, всё есть в наличии. К оплате: <b>${escH(rub(o.total))}</b>.</p>
${p ? `<div style="background:#faf6ef;border:1px solid #edbe82;border-radius:12px;padding:14px 16px;margin:12px 0">
<div style="font-weight:bold;margin-bottom:6px">${escH(payLines(p, o)[0].replace(/:$/, ""))}</div>
<div>${payLines(p, o).slice(1).map(escH).join("<br>")}</div>
${p.link ? `<p style="margin:12px 0 0"><a href="${escH(p.link)}" style="color:#7a4b8f;font-weight:bold">Открыть оплату в приложении банка →</a></p>` : ""}</div>` : ""}
<p>QR-код для оплаты и кнопка «Я оплатил» — на странице заказа (кнопка ниже).</p>`;
  } else {
    text = (CUSTOMER_STATUS[event] || "").replace("{id}", o.id).replace(/ сюда/g, " нам").replace("напишите нам сюда", "напишите нам");
    html = `<p>${escH(text).replace(/\n/g, "<br>")}</p>`;
  }
  const full = `${head}\n\n${text}\n\nСостав заказа:\n${itemsText(o)}\nИтого: ${rub(o.total)}\n\nЗаказ на сайте: ${page}\n\n— «Синица», китайский чай`;
  return { subject: `«Синица»: ${head}`, text: full, html: mailLayout(head, html, o) };
}
export async function emailCustomer(o, event) {
  if (!o?.email) return false;
  const m = orderEmail(o, event);
  return m ? sendMail({ to: o.email, ...m }) : false;
}

export async function notifyCustomer(order) {
  emailCustomer(order, order.status).catch(() => {});
  const chat = customerChat(order);
  // Заказ с сайта, покупатель не подключил бота — помогаем продавцу отправить реквизиты вручную
  if (!chat) {
    if (order.status === "accepted") await helpAdminsWithSitePayment(order);
    return;
  }
  if (order.status === "accepted") {
    if (!order.user_id)
      for (const a of notifyChats())
        await tgSafe("sendMessage", { chat_id: a, text: `🌐 Заказ №${order.id} с сайта принят. Покупатель подключил бота — сумма и реквизиты ушли ему в Telegram автоматически.` });
    return tgSafe("sendMessage", { chat_id: chat, text: paymentText(order), reply_markup: getPayment() ? payButton(order) : menuKeyboard(chat) });
  }
  const t = CUSTOMER_STATUS[order.status];
  if (t) await tgSafe("sendMessage", { chat_id: chat, text: t.replace("{id}", order.id), reply_markup: menuKeyboard(chat) });
}
/** Сообщение покупателю сразу после привязки заказа с сайта к Telegram. */
export function linkedText(o) {
  if (o.status === "accepted") return paymentText(o);
  const now = { new: "Сейчас проверяем наличие — как только подтвердим, пришлём сюда сумму и реквизиты.", paid: "Оплату получили, собираем чай.", shipped: "Заказ уже отправлен.", done: "Заказ завершён.", cancelled: "Заказ отменён." }[o.status] || "";
  return `Готово! Заказ №${o.id} с сайта привязан к этому чату 🍵\nВсе новости по заказу будем присылать сюда.\n\n${now}`;
}

const withQr = (p, o) => (isAccount(p) ? { ...p, qr: accountQr(p, o), purpose: payPurpose(o) } : p);
/** Публичное представление заказа для мини-приложения. */
export function publicOrder(o) {
  return {
    id: o.id,
    status: o.status,
    statusLabel: STATUS[o.status],
    createdAt: o.created_at,
    items: o.items.map(({ teaId, name, label, qty, sum, pack, set, variant }) => ({ teaId, name, label, qty, sum, pack, set, variant: variant || "" })),
    total: o.total,
    delivery: o.delivery,
    canCancel: o.status === "new",
    // Ждёт оплаты: показываем реквизиты в «Моих заказах»
    payment: o.status === "accepted" ? withQr(getPayment(), o) : null,
    paidClaim: !!o.paid_claim_at,
    tgLinked: !!(o.user_id || o.tg_chat),
  };
}

export { KINDS };
