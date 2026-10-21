// Онлайн-оплата заказов и подписка «Чайный клуб» через ЮKassa.
// Чеки: при оплате — чек предоплаты, при отправке — чек полного расчёта (зачёт предоплаты).
import { PUBLIC_URL, notifyChats } from "./config.js";
import { SUB_PERIODS, SUB_PLANS, rub, subPrice } from "./catalog.js";
import * as store from "./db.js";
import * as yk from "./yookassa.js";
import { EMAIL_RE, sendMail } from "./mail.js";
import { OrderError, cardUrl, notifyCustomer, refreshAdminMessages, siteOrderUrl } from "./orders.js";
import { esc, tgSafe } from "./telegram.js";
import crypto from "node:crypto";

const BOT = process.env.BOT_USERNAME || "sinitsa_chai_bot";
const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const iso = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const parse = (s) => new Date(String(s).replace(" ", "T") + "Z");
function addMonths(s, n) {
  const d = s ? parse(s) : new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}
const date = (s) => (s ? parse(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }) : "");
async function toAdmins(text, extra = {}) {
  for (const chat of notifyChats()) await tgSafe("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

// ---------- заказы ----------
/** Строки заказа для чека: чай — товар, доставка — услуга, скидки раскладываются на чай. */
export const orderLines = (o) => o.items.map((i) => ({ text: i.teaId ? `${i.name}, ${i.label}` : i.name, qty: i.teaId ? i.qty : 1, sum: i.sum, goods: !!i.teaId }));

/** Куда вернуть покупателя после оплаты: заказ с сайта — на его страницу, из Telegram — обратно в бота. */
export const orderReturnUrl = (o) => siteOrderUrl(o) || `https://t.me/${BOT}?start=paid_${o.id}`;

/** Ссылка на оплату заказа (создаём платёж при нажатии кнопки, а не заранее: ссылка живёт недолго). */
export async function payOrder(order) {
  if (!yk.ykEnabled()) throw new OrderError("Онлайн-оплата пока не подключена.");
  if (order.status === "paid" || order.yk_status === "succeeded") throw new OrderError("Заказ уже оплачен.");
  if (order.status !== "accepted") throw new OrderError("Этот заказ сейчас не ждёт оплаты.");
  if (order.yk_id) {
    const old = await yk.getPayment(order.yk_id).catch(() => null);
    if (old?.status === "succeeded") { await orderPaid(order, old); throw new OrderError("Заказ уже оплачен."); }
    if (old?.status === "pending" && old.confirmation?.confirmation_url && Number(old.amount?.value) === order.total) return { url: old.confirmation.confirmation_url };
  }
  const p = await yk.createPayment({
    amount: order.total,
    description: `Заказ №${order.id} — «Синица», китайский чай`,
    metadata: { kind: "order", id: String(order.id) },
    returnUrl: orderReturnUrl(order),
    customer: { email: order.email, phone: order.phone },
    items: yk.receiptItems(orderLines(order)),
  });
  store.setOrderPayment(order.id, p.id, p.status);
  return { url: p.confirmation?.confirmation_url };
}

async function orderPaid(order, p) {
  if (Math.round(Number(p.amount?.value)) !== order.total) {
    await toAdmins(`⚠️ Оплата ${esc(p.amount?.value)} ₽ по заказу №${order.id} не совпадает с суммой заказа ${rub(order.total)}. Проверьте в кабинете ЮKassa.`);
    return;
  }
  store.setOrderPayment(order.id, p.id, "succeeded");
  if (order.status === "accepted") {
    const updated = store.setStatus(order.id, "paid");
    await refreshAdminMessages(updated);
    await notifyCustomer(updated);
    await toAdmins(`💳 Заказ №${order.id} оплачен онлайн: ${rub(order.total)}. Чек ушёл покупателю. Можно собирать.`);
  } else if (order.status === "cancelled") {
    await toAdmins(`⚠️ Пришла оплата за отменённый заказ №${order.id} (${rub(order.total)}). Верните деньги в кабинете ЮKassa: «Платежи» → платёж → «Вернуть».`);
  }
}

/** Отправили заказ: выбиваем второй чек — полный расчёт с зачётом предоплаты. */
export async function orderShipped(order) {
  if (!yk.ykEnabled() || !order.yk_id || order.yk_status !== "succeeded" || order.receipt2) return;
  try {
    await yk.createSettlementReceipt({
      paymentId: order.yk_id,
      customer: { email: order.email, phone: order.phone },
      items: yk.receiptItems(orderLines(order), "full_payment"),
      amount: order.total,
      idem: `receipt2-order-${order.id}`,
    });
    store.markReceipt2(order.id);
  } catch (e) {
    console.error("Второй чек по заказу", order.id, e.message);
    await toAdmins(`⚠️ Не получилось выбить чек полного расчёта по заказу №${order.id}: ${esc(e.message)}. Выбейте его в кабинете ЮKassa (платёж → «Сформировать чек»).`);
  }
}

// ---------- уведомление от ЮKassa ----------
/** ЮKassa сообщает о платеже. Данным из уведомления не верим — перепроверяем платёж по API. */
export async function handleWebhook(body) {
  const id = body?.object?.id;
  if (!yk.ykEnabled() || typeof id !== "string" || id.length > 64) return;
  const p = await yk.getPayment(id);
  const kind = p.metadata?.kind, ref = Number(p.metadata?.id);
  if (kind === "order") {
    const order = store.getOrder(ref);
    if (!order) return;
    if (p.status === "succeeded" && p.paid) await orderPaid(order, p);
    else if (p.status === "canceled" && order.yk_id === p.id) store.setOrderPayment(order.id, p.id, "canceled");
  } else if (kind === "sub") {
    const sub = store.getSub(ref);
    if (!sub) return;
    if (p.status === "succeeded" && p.paid) await subPaid(sub, p);
    else if (p.status === "canceled") await subPayFailed(sub, p);
  }
}

// ---------- подписка «Чайный клуб» ----------
export const SUB_STATUS = { pending: "Ждёт оплаты", active: "Активна", past_due: "Не прошла оплата", finished: "Закончилась", cancelled: "Отменена" };
const subPage = (s) => `${PUBLIC_URL}/?sub=${s.id}&t=${s.token}`;
const envWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? "конверт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "конверта" : "конвертов");

export function publicSub(s) {
  const plan = SUB_PLANS[s.plan], per = SUB_PERIODS[s.period];
  return {
    id: s.id,
    plan: plan?.name || s.plan,
    what: plan?.what || "",
    period: per?.label || s.period,
    monthly: s.period === "month",
    price: s.price,
    status: s.status,
    statusLabel: SUB_STATUS[s.status] || s.status,
    autorenew: !!s.autorenew,
    left: s.left_count,
    shipped: s.shipped,
    gift: !!s.gift,
    nextCharge: s.autorenew && s.status === "active" ? date(s.next_charge) : "",
    canPay: ["pending", "past_due", "finished"].includes(s.status),
    canCancel: (s.status === "active" && !!s.autorenew) || s.status === "past_due" || s.status === "pending",
  };
}

/** Проверяем форму подписки. Цена — из каталога, не от клиента. */
export function buildSub(body, user) {
  const plan = String(body?.plan || ""), period = String(body?.period || "");
  if (!SUB_PLANS[plan] || !SUB_PERIODS[period]) throw new OrderError("Выберите тариф и срок подписки.");
  const per = SUB_PERIODS[period];
  if (per.autorenew && !yk.ykRecurring()) throw new OrderError("Ежемесячная оплата пока недоступна — выберите 3 или 6 месяцев.");
  const gift = body.gift === true;
  if (gift && per.autorenew) throw new OrderError("В подарок можно оформить подписку на 3 или 6 месяцев.");
  const name = clean(body.name, 80), phone = clean(body.phone, 30), email = clean(body.email, 120).toLowerCase();
  const address = clean(body.address, 300), shipTo = gift ? clean(body.shipTo, 120) : "", note = gift ? clean(body.note, 300) : "";
  if (body.terms !== true) throw new OrderError("Отметьте, что согласны с условиями подписки.");
  if (body.consent !== true) throw new OrderError("Отметьте согласие на обработку персональных данных.");
  if (per.autorenew && body.autopay !== true) throw new OrderError("Отметьте согласие на ежемесячное списание — без него подписка «каждый месяц» не работает.");
  if (!name) throw new OrderError("Укажите имя.");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new OrderError("Проверьте телефон: нужно от 10 до 15 цифр.");
  if (!email && !user?.id) throw new OrderError("Укажите почту — пришлём на неё чек и новости подписки.");
  if (email && !EMAIL_RE.test(email)) throw new OrderError("Проверьте почту: похоже, в адресе ошибка.");
  if (address.length < 10) throw new OrderError("Укажите адрес для конверта: индекс, город, улицу, дом и квартиру — или пункт выдачи.");
  if (gift && shipTo.length < 2) throw new OrderError("Укажите, кому дарите: имя и телефон получателя.");
  return { userId: user?.id || 0, plan, period, price: subPrice(plan, period), envelopes: per.envelopes, autorenew: !!per.autorenew, name, phone, email, address, shipTo, note, gift };
}

/** Ссылка на оплату подписки: первый платёж, продление или оплата после неудачного списания. */
export async function paySub(sub) {
  if (!yk.ykEnabled()) throw new OrderError("Онлайн-оплата пока не подключена.");
  if (!["pending", "past_due", "finished"].includes(sub.status)) throw new OrderError("Подписка уже оплачена.");
  const plan = SUB_PLANS[sub.plan], per = SUB_PERIODS[sub.period];
  const p = await yk.createPayment({
    amount: sub.price,
    description: `«Чайный клуб Синицы»: ${plan.name}, ${per.label.toLowerCase()}`,
    metadata: { kind: "sub", id: String(sub.id) },
    returnUrl: sub.user_id && !sub.email ? `https://t.me/${BOT}?start=sub_${sub.id}` : subPage(sub),
    customer: { email: sub.email, phone: sub.phone },
    items: yk.receiptItems([{ text: `Чай по подписке «${plan.name}»: ${sub.envelopes} ${envWord(sub.envelopes)}`, qty: 1, sum: sub.price, goods: true }]),
    save: !!sub.autorenew,
  });
  store.updateSub(sub.id, { charge_id: p.id });
  return { url: p.confirmation?.confirmation_url };
}

export async function startSub(draft) {
  const sub = store.createSub({ ...draft, token: crypto.randomBytes(12).toString("hex") });
  const { url } = await paySub(sub);
  return { sub: store.getSub(sub.id), url };
}

/** Сообщение покупателю: в Telegram (если подписался там) и на почту. */
async function tellSub(sub, subject, text) {
  if (sub.user_id) await tgSafe("sendMessage", { chat_id: sub.user_id, text, disable_web_page_preview: true });
  if (sub.email) await sendMail({ to: sub.email, subject: `«Синица»: ${subject}`, text: `${text}\n\nПодписка: ${subPage(sub)}\n\n— «Синица», китайский чай` }).catch(() => {});
}

async function subPaid(sub, p) {
  if (sub.pay_id === p.id) return; // уже учли (ЮKassa может прислать уведомление дважды)
  if (Math.round(Number(p.amount?.value)) !== sub.price) {
    await toAdmins(`⚠️ Оплата ${esc(p.amount?.value)} ₽ по подписке №${sub.id} не совпадает с ценой ${rub(sub.price)}. Проверьте в кабинете ЮKassa.`);
    return;
  }
  const first = sub.status === "pending";
  const now = iso(new Date());
  const saved = p.payment_method?.saved ? p.payment_method.id : sub.yk_method;
  const autorenew = sub.autorenew && !!saved && sub.status !== "cancelled" ? 1 : 0;
  const upd = store.updateSub(sub.id, {
    status: "active",
    charge_id: null,
    pay_id: p.id, pay_amount: sub.price, pay_env: sub.envelopes, pay_shipped: 0,
    left_count: sub.left_count + sub.envelopes,
    next_ship: sub.left_count > 0 && sub.next_ship ? sub.next_ship : now,
    ship_notified: null,
    yk_method: autorenew ? saved : null,
    autorenew,
    next_charge: autorenew ? addMonths(sub.next_charge && !first ? sub.next_charge : now, 1) : null,
  });
  const plan = SUB_PLANS[sub.plan];
  if (first) {
    await toAdmins(`🍃 <b>Новая подписка №${sub.id}</b>: «${esc(plan.name)}», ${esc(SUB_PERIODS[sub.period].label.toLowerCase())}, ${rub(sub.price)}${sub.gift ? " · 🎁 подарок" : ""}`);
    await tellSub(upd, "добро пожаловать в «Чайный клуб»",
      `Добро пожаловать в «Чайный клуб Синицы» 🍵\n\nТариф «${plan.name}»: ${plan.what}. Первый конверт соберём и отправим в ближайшие дни.` +
      (upd.autorenew ? `\n\nСледующее списание — ${date(upd.next_charge)}. Отменить можно в любой момент на странице подписки.` : "") +
      (sub.autorenew && !upd.autorenew ? "\n\nАвтосписание не подключилось — когда конверты закончатся, продлите подписку на её странице." : ""));
  } else {
    await tellSub(upd, "оплата подписки", `Оплата по подписке «${plan.name}» прошла: ${rub(sub.price)}. Скоро отправим конверт 🍵`);
  }
  await notifyShipDue();
}

async function subPayFailed(sub, p) {
  if (sub.charge_id !== p.id) return;
  if (sub.status === "pending") { store.updateSub(sub.id, { charge_id: null }); return; }
  const upd = store.updateSub(sub.id, { charge_id: null, status: "past_due" });
  await tellSub(upd, "не прошла оплата подписки", `Не получилось списать ${rub(sub.price)} за конверт «Чайного клуба». Оплатите, пожалуйста, на странице подписки — и мы отправим конверт.`);
  await toAdmins(`⚠️ Не прошло автосписание по подписке №${sub.id} (${esc(sub.name)}). Покупателю написали.`);
}

/** Продавец отправил конверт: минус один оплаченный, чек полного расчёта, следующий — через месяц. */
export async function shipSub(id) {
  const sub = store.getSub(id);
  if (!sub || sub.left_count < 1) return null;
  const left = sub.left_count - 1;
  const idx = sub.pay_shipped + 1;
  const base = Math.floor(sub.pay_amount / Math.max(1, sub.pay_env));
  const amount = idx >= sub.pay_env ? sub.pay_amount - base * (sub.pay_env - 1) : base;
  const finished = left === 0 && !sub.autorenew;
  const upd = store.updateSub(id, {
    left_count: left, shipped: sub.shipped + 1, pay_shipped: idx,
    next_ship: left > 0 ? addMonths(sub.next_ship, 1) : null, ship_notified: null,
    status: finished ? "finished" : sub.status,
  });
  if (yk.ykEnabled() && sub.pay_id && amount > 0) {
    try {
      await yk.createSettlementReceipt({
        paymentId: sub.pay_id,
        customer: { email: sub.email, phone: sub.phone },
        items: yk.receiptItems([{ text: `Чай: конверт «Чайного клуба», тариф «${SUB_PLANS[sub.plan].name}»`, qty: 1, sum: amount, goods: true }], "full_payment"),
        amount,
        idem: `receipt2-sub-${id}-${sub.pay_id}-${idx}`,
      });
    } catch (e) {
      console.error("Второй чек по подписке", id, e.message);
      await toAdmins(`⚠️ Не получилось выбить чек полного расчёта по подписке №${id}: ${esc(e.message)}. Выбейте его в кабинете ЮKassa.`);
    }
  }
  const plan = SUB_PLANS[sub.plan];
  await tellSub(upd, "конверт отправлен",
    `Конверт «Чайного клуба» отправлен 📦${sub.gift ? " Получатель скоро его найдёт." : ""}` +
    (finished ? `\n\nЭто был последний оплаченный конверт по тарифу «${plan.name}». Продлить подписку можно на её странице.` : left > 0 ? `\n\nОсталось оплаченных конвертов: ${left}.` : ""));
  return upd;
}

/** Покупатель отменил: автосписаний больше не будет, уже оплаченные конверты всё равно отправим. */
export async function cancelSub(sub) {
  const upd = store.updateSub(sub.id, { autorenew: 0, yk_method: null, status: sub.left_count > 0 ? sub.status : "cancelled" });
  if (sub.status !== "pending") await toAdmins(`Подписка №${sub.id} (${esc(sub.name)}) отменена покупателем.${sub.left_count > 0 ? ` Оплаченных конвертов осталось: ${sub.left_count} — их нужно отправить.` : ""}`);
  return upd;
}

// ---------- раз в час: автосписания и напоминания продавцу ----------
export async function notifyShipDue() {
  for (const s of store.subsToShip(iso(new Date()))) {
    const plan = SUB_PLANS[s.plan];
    await toAdmins(
      `📮 <b>Пора отправить конверт</b> — подписка №${s.id}, «${esc(plan.name)}» (${esc(plan.what)})\n` +
        (s.gift ? "🎁 Подарок — получатель, адрес и открытка по кнопке ниже" : "👤 Получатель и адрес — по кнопке ниже") +
        `\nОтправлено раньше: ${s.shipped}, оплачено ещё: ${s.left_count}`,
      { reply_markup: { inline_keyboard: [[{ text: "👤 Получатель и адрес", url: cardUrl("s", s.id) }], [{ text: "📦 Конверт отправлен", callback_data: `sub:${s.id}:ship` }]] } }
    );
    store.updateSub(s.id, { ship_notified: s.next_ship });
  }
}
export async function chargeDue() {
  if (!yk.ykRecurring()) return;
  for (const s of store.subsToCharge(iso(new Date()))) {
    try {
      const plan = SUB_PLANS[s.plan];
      const p = await yk.createPayment({
        amount: s.price,
        description: `«Чайный клуб Синицы»: ${plan.name}, конверт месяца`,
        metadata: { kind: "sub", id: String(s.id) },
        customer: { email: s.email, phone: s.phone },
        items: yk.receiptItems([{ text: `Чай по подписке «${plan.name}»: 1 конверт`, qty: 1, sum: s.price, goods: true }]),
        methodId: s.yk_method,
        idem: `charge-sub-${s.id}-${s.next_charge}`, // повтор не спишет дважды
      });
      const cur = store.updateSub(s.id, { charge_id: p.id });
      if (p.status === "succeeded") await subPaid(cur, p);
      else if (p.status === "canceled") await subPayFailed(cur, p);
    } catch (e) {
      console.error("Автосписание подписки", s.id, e.message);
    }
  }
}
export async function tickSubs() {
  try { await chargeDue(); await notifyShipDue(); } catch (e) { console.error("[subs]", e); }
}

/** Список подписок для продавца (кнопка «🍃 Подписки»). */
export function subsSummary() {
  const list = store.activeSubs();
  if (!list.length) return "Активных подписок пока нет.";
  const rows = list.map((s) => `№${s.id} · ${esc(SUB_PLANS[s.plan]?.name || s.plan)} · ${esc(s.gift ? `🎁 ${s.ship_to}` : s.name)} · ${SUB_STATUS[s.status]}${s.left_count ? ` · к отправке: ${s.left_count}` : ""}${s.autorenew && s.next_charge ? ` · списание ${date(s.next_charge)}` : ""}`);
  return `🍃 <b>Подписки «Чайный клуб»</b>: ${list.length}\n\n${rows.join("\n")}`;
}
