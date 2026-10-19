import { ADMIN_IDS, LEGAL, ORDERS_CHAT_ID, PUBLIC_URL, isAdmin, notifyChats } from "./config.js";
import { DELIVERY_INFO, STATUS, TEAS, findTea, rub } from "./catalog.js";
import * as store from "./db.js";
import crypto from "node:crypto";
import { confirmLoginCode, loginCodeValid } from "./loginlink.js";
import { orderShipped, shipSub, subsSummary } from "./payments.js";
import { accountValid, isAccount, payLines, payButton, adminKeyboard, canMove, claimPaid, getPayment, linkedText, notifyCustomer, orderText, refreshAdminMessages, rejectPaid, siteStartPayload } from "./orders.js";
import { esc, poll, tg, tgSafe } from "./telegram.js";
import { BTN, MENU_VERSION, menuKeyboard } from "./menu.js";
import { requestWholesale } from "./wholesale.js";
import { sheetFormula } from "./export.js";
import { metrikaReport } from "./metrika.js";

// «37 чаёв», «31 чай», «32 чая» — число берём из каталога, чтобы не устаревало
function teasCount(n = TEAS.length) {
  const a = n % 10, b = n % 100;
  const w = a === 1 && b !== 11 ? "чай" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "чая" : "чаёв";
  return `${n} ${w}`;
}

// Раздел передаём через ?tab=, потому что после # Telegram дописывает свои параметры запуска
const shopButton = (text, hash = "") => ({
  text,
  web_app: { url: hash ? `${PUBLIC_URL}/?tab=${hash.replace("#", "")}` : `${PUBLIC_URL}/` },
});

const WELCOME =
  "🐦 Добро пожаловать в «Синицу»!\n\n" +
  "Мы верим, что у каждого человека есть свой чай.\n\n" +
  "🍵 Не знаете, с чего начать? Ответьте на 6 коротких вопросов, и мы подберём три чая под ваш вкус — себе или в подарок.\n\n" +
  "🎁 На первый заказ — промокод SINITSA10, скидка 10%.\n\n" +
  "Выбирайте, с чего начнём:";

const CHANNEL_URL = "https://t.me/sinitsa_chai";

const ABOUT =
  "🐦 «Синица» — небольшой чайный магазин из Москвы. Мы собрали коллекцию китайского и тайваньского чая: улуны, ГАБА, красные чаи и пуэры.\n\n" +
  "🍵 Каждый чай можно взять по 20 г — попробовать, прежде чем брать больше.\n\n" +
  "📦 Чай собираем под ваш заказ. Сначала мы проверяем наличие и пишем вам здесь, затем бот присылает сумму и реквизиты для оплаты. Отправляем после оплаты.\n\n" +
  "💬 Есть вопрос? Просто напишите сюда — ответим лично.\n\n" +
  "📢 О чае, заварке и новинках пишем в нашем канале: @sinitsa_chai\n\n" +
  "🧑‍💼 Покупаете оптом — для кофейни, магазина или подарков? Нажмите /opt или «Я оптовик» в приветствии, обсудим условия лично.";

const ADMIN_HELP =
  "<b>Панель магазина</b> 👇 кнопки прямо под этим сообщением.\n" +
  "Если кнопки потерялись — напишите боту слово <b>меню</b>, и они придут заново.\n\n" +
  "В «Наличии» нажмите на чай, чтобы включить или выключить его в магазине.\n" +
  "В «Реквизитах» задайте номер для перевода по СБП — когда вы принимаете заказ, бот сам пришлёт покупателю сумму и реквизиты, а вам — уведомление, когда он нажмёт «Я оплатил».\n\n" +
  "Новые заказы приходят сюда с кнопками статусов. Сообщения покупателей тоже приходят сюда: чтобы ответить, сделайте «Ответить» на пересланное сообщение.";

const openButton = (text, hash) => ({ inline_keyboard: [[shopButton(text, hash)]] });

async function myOrders(msg) {
  const list = store.userOrders(msg.from.id).slice(0, 5);
  if (!list.length)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Заказов пока нет. Начните с подбора или каталога 🍵", reply_markup: openButton("🛍 Открыть магазин", "") });
  const text = list
    .map((o) => `<b>№${o.id}</b> · ${STATUS[o.status]} · ${rub(o.total)}\n` + o.items.filter((i) => i.teaId).map((i) => `  ${esc(i.name)}, ${esc(i.label)} × ${i.qty}`).join("\n"))
    .join("\n\n");
  return tgSafe("sendMessage", { chat_id: msg.chat.id, text, parse_mode: "HTML", reply_markup: openButton("📦 Открыть мои заказы", "#orders") });
}

function startKeyboard() {
  return {
    inline_keyboard: [
      [shopButton("🛍 Открыть магазин")],
      [shopButton("🍵 Подобрать чай", "#quiz")],
      [{ text: "🐦 О Синице", callback_data: "about" }, { text: "💬 Задать вопрос", callback_data: "ask" }],
      [{ text: "📢 Наш канал о чае", url: CHANNEL_URL }],
      [{ text: "🧑‍💼 Я оптовик", callback_data: "wholesale" }],
    ],
  };
}

// Меню кнопками прямо под сообщением — их видно всегда, искать значок не нужно
const MENU_HINT = "Нажмите на нужную кнопку 👇\nЕсли кнопки потерялись — просто напишите слово «меню».";
function inlineMenu(userId) {
  const cb = (key) => ({ text: BTN[key], callback_data: `m:${key}` });
  const rows = [
    [shopButton(BTN.quiz, "#quiz"), shopButton(BTN.shop)],
    [cb("orders"), cb("delivery")],
    [cb("about"), { text: "📢 Наш канал", url: CHANNEL_URL }],
  ];
  if (isAdmin(userId)) rows.push([cb("active"), cb("stock")], [cb("payment"), cb("stats")], [cb("sheet"), cb("subs")]);
  return { inline_keyboard: rows };
}
const isMenuWord = (text) => /^\/menu(@\w+)?$|^(меню|menu|кнопки|главное меню)[.!?]*$/i.test(text.trim());

function stockKeyboard() {
  const avail = store.availability();
  return {
    inline_keyboard: TEAS.map((t) => [
      { text: `${avail[t.id] === false ? "⛔" : "✅"} ${t.name}`.slice(0, 60), callback_data: `stock:${t.id}` },
    ]),
  };
}

// Ссылка со страницы заказа на сайте: /start o<id>_<ключ> — привязываем заказ к этому чату
async function linkSiteOrder(msg, payload) {
  const m = /^o(\d+)_([0-9a-f]{16})$/.exec(payload || "");
  if (!m) return false;
  const o = store.getOrder(Number(m[1]));
  const want = o && !o.user_id ? siteStartPayload(o) : "";
  const a = Buffer.from(want), b = Buffer.from(payload);
  if (!want || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Не нашли такой заказ. Откройте ссылку со страницы заказа на сайте ещё раз или просто напишите нам сюда." });
    return true;
  }
  const linked = store.linkOrderChat(o.id, msg.chat.id);
  await tgSafe("sendMessage", {
    chat_id: msg.chat.id, text: linkedText(linked),
    reply_markup: linked.status === "accepted" && !linked.paid_claim_at ? payButton(linked) : menuKeyboard(msg.from.id),
  });
  for (const chat of notifyChats())
    await tgSafe("sendMessage", { chat_id: chat, text: `🔗 Покупатель заказа №${o.id} с сайта подключил бота${msg.from.username ? ` (@${msg.from.username})` : ""} — статусы и реквизиты будут уходить ему автоматически.` });
  return true;
}

async function onStart(msg) {
  const chat = msg.chat.id;
  const payload = String(msg.text || "").split(/\s+/)[1] || "";
  if (payload.startsWith("o") && (await linkSiteOrder(msg, payload))) { store.markMenu(msg.from.id, MENU_VERSION); return; }
  // Вернулись из ЮKassa после оплаты заказа или подписки
  const pm = /^(paid|sub)_(\d+)$/.exec(payload);
  if (pm) {
    const o = pm[1] === "paid" ? store.getOrder(Number(pm[2])) : null;
    const mine = o && (o.user_id || o.tg_chat) === msg.from.id;
    const text = pm[1] === "sub" ? "Спасибо! Как только ЮKassa подтвердит оплату, пришлём сюда сообщение о подписке 🍵"
      : !mine ? "Спасибо! Статус заказа пришлём сюда."
      : o.status === "accepted" ? `Проверяем оплату заказа №${o.id}… Как только ЮKassa её подтвердит, пришлём сообщение сюда.`
      : `Заказ №${o.id}: ${STATUS[o.status].toLowerCase()}. Спасибо! 🍵`;
    await tgSafe("sendMessage", { chat_id: chat, text, reply_markup: menuKeyboard(msg.from.id) });
    store.markMenu(msg.from.id, MENU_VERSION);
    return;
  }
  // Вход на сайт через бота
  const lm = /^login_([0-9a-f]{32})$/.exec(payload);
  if (lm) {
    if (!loginCodeValid(lm[1])) {
      await tgSafe("sendMessage", { chat_id: chat, text: "Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз." });
      return;
    }
    await tgSafe("sendMessage", {
      chat_id: chat,
      text: "Войти на сайт «Синицы» с этим аккаунтом Telegram?\n\nСайт увидит только ваше имя и ник. Заказы будут видны с любого устройства, а статусы — приходить сюда.",
      reply_markup: { inline_keyboard: [[{ text: "✅ Да, войти", callback_data: `login:${lm[1]}` }], [{ text: "Отмена", callback_data: "login:no" }]] },
    });
    store.markMenu(msg.from.id, MENU_VERSION);
    return;
  }
  // Откуда пришли: ссылка t.me/sinitsa_chai_bot?start=ig (метка — латиница, цифры, - и _)
  try { store.logEvent(msg.from.id, "bot_start", /^[a-z0-9_-]{1,32}$/i.test(payload) ? payload.toLowerCase() : ""); } catch {}
  const photo = await tgSafe("sendPhoto", {
    chat_id: chat,
    photo: `${PUBLIC_URL}/emblem.jpg`,
    caption: WELCOME,
    reply_markup: startKeyboard(),
  });
  if (!photo) await tgSafe("sendMessage", { chat_id: chat, text: WELCOME, reply_markup: startKeyboard() });
  await tgSafe("sendMessage", {
    chat_id: chat,
    text: "Кнопки меню — внизу чата 👇\nНе видно? Нажмите значок ⊞ справа в строке ввода или напишите слово «меню».\n\nЕсли есть вопрос, просто напишите его сюда — ответим.",
    reply_markup: menuKeyboard(msg.from.id),
  });
  if (isAdmin(msg.from.id)) await tgSafe("sendMessage", { chat_id: chat, text: ADMIN_HELP, parse_mode: "HTML", reply_markup: inlineMenu(msg.from.id) });
  store.markMenu(msg.from.id, MENU_VERSION);
}

// Тем, кто запускал бота до появления меню, один раз присылаем кнопки внизу чата
async function sendMenuToOldUsers() {
  for (const id of store.usersWithoutMenu(MENU_VERSION)) {
    await tgSafe("sendMessage", {
      chat_id: id,
      text: "Обновили бота 🍵 Теперь разделы всегда внизу чата: подбор чая, каталог, заказы 👇",
      reply_markup: menuKeyboard(id),
    });
    store.markMenu(id, MENU_VERSION);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------- реквизиты для оплаты (только продавец) ----------
const awaitingPayment = new Set();
function paymentInfo() {
  const p = getPayment();
  if (isAccount(p)) return `Сейчас покупатели видят:\n${payLines(p, { id: "N", total: 0 }).join("\n")}\n\n🔳 На сайте и в мини-приложении — QR-код с суммой заказа: приложение банка само заполнит реквизиты.`;
  return p ? `Сейчас покупатели видят:\n📱 ${p.phone}\n🏦 ${p.bank}\n👤 ${p.name}${p.link ? `\n🔗 ${p.link} (на сайте — QR-код)` : "\n🔗 ссылки на оплату нет — QR-код на сайте не показывается"}` : "Реквизиты ещё не заданы — покупателям пишется, что продавец пришлёт их в чате.";
}
async function askPayment(msg) {
  awaitingPayment.add(msg.from.id);
  return tgSafe("sendMessage", {
    chat_id: msg.chat.id,
    text: `💳 Реквизиты для оплаты переводом\n\n${paymentInfo()}\n\nРасчётный счёт ИП (рекомендуем): скопируйте реквизиты счёта в приложении банка (кнопка «копировать» в разделе «Реквизиты счёта») и вставьте сюда одним сообщением. Нужны расчётный счёт, БИК, корр. счёт и название банка. Получатель и ИНН возьмём из данных ИП: ${LEGAL.name}, ИНН ${LEGAL.inn}.\n\nИли СБП по телефону — одним сообщением три строки:\n1) номер телефона для СБП\n2) банк\n3) получатель (имя и первая буква фамилии)\n4) по желанию — ссылка на оплату из приложения банка (например, «Ссылка для перевода» в Т-Банке). Из неё сайт сделает QR-код.\n\nНапример:\n+7 900 123-45-67\nТ-Банк\nАлександр Б.\nhttps://tbank.ru/cf/…\n\nОтмена — /cancel`,
  });
}
/** Реквизиты счёта из текста, скопированного в банке: счёт 408…, БИК 04…, корр. счёт 301…, банк. */
const BANKS = { "044525225": ["ПАО Сбербанк", "30101810400000000225"], "044525593": ["АО «Альфа-Банк»", "30101810200000000593"], "044525974": ["АО «ТБанк»", "30101810145250000974"] };
export function parseAccount(text) {
  // цифры в банке часто разбиты пробелами: «40802 810 1 0000 0012345»
  const num = (start, n) => {
    const m = text.match(new RegExp(`(?<!\\d)${[...start].join("[ \\u00a0]?")}(?:[ \\u00a0]?\\d){${n - start.length}}(?!\\d)`));
    return m ? m[0].replace(/\D/g, "") : "";
  };
  const acc = num("408", 20) || num("407", 20);
  if (!acc) return null;
  const bic = num("04", 9);
  const corr = num("301", 20) || BANKS[bic]?.[1] || "";
  const bankLine = text.split("\n").map((s) => s.trim()).find((s) => /банк/i.test(s) && !/^получатель|БИК|корр/i.test(s) && !/\d{5}/.test(s));
  const bank = (bankLine || "").replace(/^(наименование|банк(\s+получателя)?)\s*:?\s*/i, "").slice(0, 80) || BANKS[bic]?.[0] || "";
  return { acc, bic, corr, bank };
}
async function savePayment(msg) {
  const a = parseAccount(msg.text);
  if (a) {
    const miss = [!a.bic && "БИК", !a.corr && "корр. счёт", !a.bank && "название банка"].filter(Boolean);
    if (miss.length) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Не хватает: ${miss.join(", ")}. Пришлите реквизиты целиком или /cancel.` });
    if (!accountValid(a.acc, a.bic)) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Номер счёта не сходится с БИК — похоже, опечатка. Проверьте и пришлите ещё раз или /cancel." });
    store.setSetting("payment", { type: "account", name: LEGAL.name, inn: LEGAL.inn, ...a });
    awaitingPayment.delete(msg.from.id);
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Сохранили ✅\n\n${paymentInfo()}\n\nТеперь, когда вы принимаете заказ, бот сам отправит покупателю сумму, реквизиты и кнопку «Я оплатил».`, reply_markup: menuKeyboard(msg.from.id) });
  }
  const all = msg.text.split("\n").map((s) => s.trim()).filter(Boolean);
  const link = (all.find((s) => /^https:\/\/\S+$/.test(s)) || "").slice(0, 300);
  const [phone, bank, name] = all.filter((s) => s !== link);
  const digits = (phone || "").replace(/\D/g, "");
  if (!bank || !name || digits.length < 10 || digits.length > 12)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Не получилось разобрать. Нужно три строки: телефон, банк, получатель. Попробуйте ещё раз или /cancel." });
  store.setSetting("payment", { phone: phone.slice(0, 30), bank: bank.slice(0, 60), name: name.slice(0, 60), ...(link ? { link } : {}) });
  awaitingPayment.delete(msg.from.id);
  return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Сохранили ✅\n\n${paymentInfo()}\n\nТеперь, когда вы принимаете заказ, бот сам отправит покупателю сумму и реквизиты с кнопкой «Я оплатил».`, reply_markup: menuKeyboard(msg.from.id) });
}

// ---------- напоминание о корзине ----------
// Один раз: через 3 часа после того, как положили чай и не оформили. Не ночью и не чаще раза в 14 дней.
const REMIND_AFTER_HOURS = Number(process.env.REMIND_AFTER_HOURS || 3);
export function cartReminderText(items) {
  const list = String(items || "").split(" | ").map((s) => s.trim()).filter(Boolean);
  const shown = list.slice(0, 4).map((x) => `• ${x}`).join("\n") + (list.length > 4 ? `\n• и ещё ${list.length - 4}` : "");
  return `Здравствуйте! Это «Синица» 🐦\n\nВ корзине остался ваш чай${shown ? ":\n" + shown : "."}\n\nОн никуда не делся — можно оформить, когда будет удобно. Если что-то смутило или не получилось, просто напишите сюда, поможем выбрать 🍵`;
}
async function sendCartReminder(uid, items) {
  const ok = await tgSafe("sendMessage", {
    chat_id: uid,
    text: cartReminderText(items),
    reply_markup: { inline_keyboard: [[shopButton("🛒 Открыть корзину", "#cart")]] },
  });
  store.markReminded(uid); // даже если не дошло — не пытаемся снова
  return !!ok;
}
async function autoRemind({ anyHour = false } = {}) {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow", hour: "numeric", hour12: false }));
  if (!anyHour && (h < 10 || h >= 21)) return; // не пишем рано утром и поздно вечером
  for (const c of store.cartsToRemind(REMIND_AFTER_HOURS, 72)) {
    if (isAdmin(c.user_id)) continue;
    await sendCartReminder(c.user_id, c.items);
  }
}

// ---------- статистика для продавца ----------
const QUIZ_STEPS = ["себе или в подарок", "на что похож чай", "когда пить", "какие ноты", "что не нравится", "как заваривать"];
const pct = (a, b) => (b ? ` (${Math.round((a / b) * 100)}%)` : "");
function ago(sqlTime) {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(sqlTime.replace(" ", "T") + "Z")) / 3600000));
  return h < 1 ? "только что" : h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн. назад`;
}
export function statsText(days) {
  const lines = [`📊 <b>Статистика за ${days} дн.</b>`];
  const block = (title, src) => {
    const f = store.funnel(days, src);
    const n = (k) => f[k] || 0;
    if (!n("app_open") && !n("cart_add")) { lines.push("", `<b>${title}</b>: заходов пока нет.`); return; }
    lines.push("", `<b>${title}</b> (разные люди):`);
    lines.push(`Открыли — ${n("app_open")}`);
    lines.push(`Смотрели чай — ${n("tea_open")}${pct(n("tea_open"), n("app_open"))}`);
    lines.push(`Начали подбор — ${n("quiz_start")}, дошли до конца — ${n("quiz_done")}${pct(n("quiz_done"), n("quiz_start"))}`);
    lines.push(`Открыли наборы — ${n("sets_open")}`);
    lines.push(`Положили в корзину — ${n("cart_add")}${pct(n("cart_add"), n("app_open"))}`);
    lines.push(`Открыли корзину — ${n("cart_open")}`);
    lines.push(`Начали оформление — ${n("checkout_open")}${pct(n("checkout_open"), n("cart_add"))}`);
    lines.push(`Отправили заказ — ${n("order_sent")}${pct(n("order_sent"), n("checkout_open"))}`);
    if (n("order_error")) lines.push(`Ошибка при оформлении — ${n("order_error")} (стоит посмотреть, что не так)`);
    if (n("wholesale")) lines.push(`Нажали «Я оптовик» — ${n("wholesale")}`);
  };
  block("📱 Мини-приложение в Telegram", "tg");
  block("🌐 Сайт", "site");
  const starts = store.botStarts(days);
  if (starts.length) {
    const total = starts.reduce((a, r) => a + r.n, 0);
    lines.push("", `🤖 <b>Нажали «Старт» в боте</b> — ${total}: ${starts.map((r) => `${esc(r.src || "без метки")} — ${r.n}`).join(", ")}`);
  }
  const drop = store.quizDropoff(days);
  if (drop.length) {
    lines.push("", "<b>Где бросили подбор:</b>");
    for (const d of drop) lines.push(`вопрос ${d.step} «${QUIZ_STEPS[d.step - 1] || "?"}» — ${d.n} чел.`);
  }
  const top = store.topTeas(days);
  if (top.length) {
    lines.push("", "<b>Чаще всего смотрят:</b>");
    for (const t of top) lines.push(`${esc(findTea(t.id)?.name || "чай " + t.id)} — ${t.n}`);
  }
  const carts = store.abandonedCarts(days);
  lines.push("", carts.length ? `🛒 <b>Брошенные корзины (${carts.length}):</b>` : "🛒 Брошенных корзин нет.");
  for (const c of carts) {
    const who = `${esc(c.first_name || "Без имени")}${c.username ? ` (@${esc(c.username)})` : ""}`;
    lines.push(`• ${who}, ${ago(c.last_at)}: ${esc((c.items || "").split(" | ").slice(0, 3).join("; "))}${c.reached_checkout ? " — дошёл(а) до оформления" : ""}${c.reminded_at ? " · напоминали" : ""}`);
  }
  return { text: lines.join("\n"), carts };
}
async function sendStats(chat, days) {
  const { text, carts } = statsText(days);
  const kb = carts.filter((c) => !store.remindedRecently(c.user_id, 14)).slice(0, 8)
    .map((c) => [{ text: `💬 Напомнить: ${(c.first_name || "покупатель").slice(0, 20)}`, callback_data: `rem:${c.user_id}` }]);
  kb.push([{ text: days === 7 ? "За 30 дней" : "За 7 дней", callback_data: `stats:${days === 7 ? 30 : 7}` }, { text: "📈 Яндекс Метрика", callback_data: `ym:${days}` }]);
  return tgSafe("sendMessage", { chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

async function onActive(msg) {
  const list = store.activeOrders();
  if (!list.length) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Заказов в работе нет." });
  for (const o of list) {
    await tgSafe("sendMessage", {
      chat_id: msg.chat.id,
      text: orderText(o, { forAdmin: true }),
      parse_mode: "HTML",
      reply_markup: adminKeyboard(o),
    });
  }
}

async function forwardToAdmins(msg) {
  const u = msg.from;
  const who = `${esc(u.first_name || "")}${u.username ? ` (@${esc(u.username)})` : ""}`;
  let sent = false;
  for (const admin of notifyChats()) {
    const head = await tgSafe("sendMessage", {
      chat_id: admin,
      text: `💬 Сообщение от ${who}. Чтобы ответить, нажмите «Ответить» на сообщение ниже.`,
      parse_mode: "HTML",
    });
    const copy = await tgSafe("copyMessage", { chat_id: admin, from_chat_id: msg.chat.id, message_id: msg.message_id });
    if (copy) {
      store.rememberSupport(admin, copy.message_id, u.id);
      sent = true;
    }
    if (head) store.rememberSupport(admin, head.message_id, u.id);
  }
  await tgSafe("sendMessage", {
    chat_id: msg.chat.id,
    text: sent ? "Получили! Ответим здесь в ближайшее время 🙂" : "Не получилось передать сообщение. Попробуйте чуть позже.",
    reply_markup: menuKeyboard(msg.from.id),
  });
}

async function onGroupMessage(msg) {
  const text = msg.text || "";
  if (/^\/chatid(@\w+)?$/.test(text))
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `ID этой группы: ${msg.chat.id}` });
  // Ответ продавца покупателю прямо из группы
  const reply = msg.reply_to_message;
  if (reply && msg.from && isAdmin(msg.from.id)) {
    const userId = store.supportUser(msg.chat.id, reply.message_id);
    if (!userId) return;
    const ok = await tgSafe("copyMessage", { chat_id: userId, from_chat_id: msg.chat.id, message_id: msg.message_id });
    return tgSafe("sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: ok ? "Отправлено покупателю ✅" : "Не удалось отправить: возможно, покупатель остановил бота." });
  }
}

async function onMessage(msg) {
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") return onGroupMessage(msg);
  if (msg.chat.type !== "private") return;
  const text = msg.text || "";
  const from = msg.from;
  if (from) store.upsertUser(from);

  if (text.startsWith("/start")) return onStart(msg);
  if (isMenuWord(text)) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: MENU_HINT, reply_markup: inlineMenu(from.id) });
  if (text === BTN.quiz)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Шесть коротких вопросов — и мы предложим три чая под ваш вкус, себе или в подарок.", reply_markup: openButton("🍵 Начать подбор", "#quiz") });
  if (text === BTN.shop)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `${teasCount()} и наборы по 20, 50 и 100 г. Каждый чай можно взять на пробу.`, reply_markup: openButton("🛍 Открыть каталог", "") });
  if (text === BTN.orders) return myOrders(msg);
  if (text === BTN.delivery || text.startsWith("/delivery")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: DELIVERY_INFO, reply_markup: menuKeyboard(from.id) });
  if (text === BTN.about) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ABOUT, reply_markup: menuKeyboard(from.id) });
  if (text.startsWith("/opt")) return requestWholesale(from);
  if (text.startsWith("/id")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Ваш Telegram ID: ${from.id}` });
  if (text.startsWith("/help")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ABOUT, reply_markup: startKeyboard() });

  if (isAdmin(from.id)) {
    if (text.startsWith("/cancel") && awaitingPayment.delete(from.id)) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Отменили, реквизиты не изменились.", reply_markup: menuKeyboard(from.id) });
    if (text.startsWith("/pay") || text === BTN.payment) return askPayment(msg);
    if (awaitingPayment.has(from.id) && text && !text.startsWith("/")) return savePayment(msg);
    if (text.startsWith("/stats") || text === BTN.stats) return sendStats(msg.chat.id, 7);
    if (text.startsWith("/sheet") || text === BTN.sheet)
      return tgSafe("sendMessage", {
        chat_id: msg.chat.id,
        parse_mode: "HTML",
        text:
          "🗂 <b>Все заказы в Google Таблице</b>\n\n" +
          "1. Создайте новую Google Таблицу.\n" +
          "2. В ячейку A1 вставьте эту формулу целиком (нажмите на неё, чтобы скопировать):\n\n" +
          `<code>${esc(sheetFormula(PUBLIC_URL))}</code>\n\n` +
          "3. Нажмите Enter — появятся все заказы с покупателями, составом, доставкой и статусом. Новые заказы и смена статуса подтягиваются сами примерно раз в час.\n\n" +
          "⚠️ В формуле секретный ключ: не публикуйте её и не открывайте доступ к таблице посторонним — там телефоны и адреса покупателей.",
      });
    if (text.startsWith("/active") || text === BTN.active) return onActive(msg);
    if (text.startsWith("/subs") || text === BTN.subs) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: subsSummary(), parse_mode: "HTML" });
    if (text.startsWith("/stock") || text === BTN.stock)
      return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Наличие чаёв. Нажмите, чтобы переключить:", reply_markup: stockKeyboard() });
    if (text.startsWith("/admin")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ADMIN_HELP, parse_mode: "HTML" });
    // Ответ продавца покупателю
    const reply = msg.reply_to_message;
    if (reply) {
      const userId = store.supportUser(msg.chat.id, reply.message_id);
      if (userId) {
        const ok = await tgSafe("copyMessage", { chat_id: userId, from_chat_id: msg.chat.id, message_id: msg.message_id });
        return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ok ? "Отправлено покупателю ✅" : "Не удалось отправить: возможно, покупатель остановил бота." });
      }
    }
    return tgSafe("sendMessage", {
      chat_id: msg.chat.id,
      text: "Что сделать? Нажмите кнопку 👇\n\nЧтобы ответить покупателю, нажмите «Ответить» на его сообщение.",
      reply_markup: inlineMenu(from.id),
    });
  }

  if (text.startsWith("/")) return onStart(msg);
  return forwardToAdmins(msg);
}

async function onCallback(q) {
  const data = q.data || "";
  const chat = q.message?.chat.id;
  const answer = (text) => tgSafe("answerCallbackQuery", { callback_query_id: q.id, text });

  // Кнопки меню под сообщением работают так же, как кнопки внизу чата
  if (data.startsWith("m:")) {
    await answer();
    const key = data.slice(2);
    const customerKeys = ["quiz", "shop", "orders", "delivery", "about"];
    if (!BTN[key] || (!customerKeys.includes(key) && !isAdmin(q.from.id))) return;
    return onMessage({ chat: { id: chat, type: "private" }, from: q.from, text: BTN[key] });
  }
  if (data === "about") {
    await answer();
    return tgSafe("sendMessage", { chat_id: chat, text: ABOUT, reply_markup: startKeyboard() });
  }
  if (data === "wholesale") {
    const r = await requestWholesale(q.from);
    return answer(r.repeat ? "Мы уже получили ваш запрос — скоро напишем" : "Спасибо! Напишем вам здесь");
  }
  if (data === "ask") {
    await answer();
    return tgSafe("sendMessage", { chat_id: chat, text: "Напишите вопрос одним сообщением — ответим здесь." });
  }

  // Отзыв покупателя: fb:<заказ>:<оценка>, затем fw:<заказ>:<пожелание>
  if (data.startsWith("fb:") || data.startsWith("fw:")) {
    const [kind, id, value] = data.split(":");
    const order = store.getOrder(Number(id));
    if (!order || (order.user_id || order.tg_chat) !== q.from.id) return answer();
    if (kind === "fb" && RATINGS[value]) {
      store.saveFeedback(order.id, q.from.id, { rating: value });
      await tgSafe("editMessageText", {
        chat_id: chat,
        message_id: q.message.message_id,
        text: `${RATINGS[value]} Спасибо! А чего хотелось бы в следующий раз?`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "💪 Покрепче", callback_data: `fw:${id}:stronger` }, { text: "🌿 Помягче", callback_data: `fw:${id}:softer` }],
            [{ text: "🍯 Послаще", callback_data: `fw:${id}:sweeter` }, { text: "🌸 Ароматнее", callback_data: `fw:${id}:aroma` }],
            [{ text: "👌 Всё отлично, так же", callback_data: `fw:${id}:same` }],
          ],
        },
      });
      return answer();
    }
    if (kind === "fw" && WISHES[value]) {
      store.saveFeedback(order.id, q.from.id, { wish: value });
      await tgSafe("editMessageText", {
        chat_id: chat,
        message_id: q.message.message_id,
        text: `Записали: ${WISHES[value]}. Следующий подбор учтёт ваш отзыв 🐦`,
        reply_markup: { inline_keyboard: [[shopButton("🍵 Подобрать следующий чай", "#quiz")]] },
      });
      const fb = store.userFeedback(q.from.id)[0];
      for (const admin of notifyChats())
        await tgSafe("sendMessage", {
          chat_id: admin,
          text: `📝 Отзыв по заказу №${order.id}: ${RATINGS[fb?.rating] || ""} ${WISHES[value]}`,
        });
      return answer("Спасибо!");
    }
    return answer();
  }

  // Вход на сайт через бота
  if (data.startsWith("login:")) {
    const code = data.slice(6);
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    if (code === "no") { await tgSafe("sendMessage", { chat_id: chat, text: "Хорошо, вход отменён." }); return answer(); }
    store.upsertUser(q.from);
    if (!confirmLoginCode(code, q.from)) { await tgSafe("sendMessage", { chat_id: chat, text: "Ссылка для входа устарела. Нажмите «Войти через Telegram» на сайте ещё раз." }); return answer(); }
    await tgSafe("sendMessage", { chat_id: chat, text: "Готово, вы вошли ✅ Вернитесь на сайт — страница обновится сама.", reply_markup: menuKeyboard(q.from.id) });
    return answer("Вы вошли");
  }

  // Покупатель: «Я оплатил»
  if (data.startsWith("paid:")) {
    const order = store.getOrder(Number(data.split(":")[1]));
    if (!order || (order.user_id || order.tg_chat) !== q.from.id) return answer();
    const r = await claimPaid(order, q.from.username);
    if (!r.ok) return answer(r.error);
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tgSafe("sendMessage", { chat_id: chat, text: "Спасибо! Проверим перевод и подтвердим здесь 🙏" });
    return answer("Отметили");
  }

  if (!isAdmin(q.from.id)) return answer("Недоступно");

  if (data.startsWith("ym:")) {
    const days = Number(data.split(":")[1]) === 30 ? 30 : 7;
    await answer("Спрашиваем Метрику…");
    const text = await metrikaReport(days);
    return tgSafe("sendMessage", { chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: days === 7 ? "Метрика за 30 дней" : "Метрика за 7 дней", callback_data: `ym:${days === 7 ? 30 : 7}` }]] } });
  }
  if (data.startsWith("stats:")) {
    await answer();
    return sendStats(chat, Number(data.split(":")[1]) === 30 ? 30 : 7);
  }
  // Напомнить вручную о брошенной корзине — не чаще раза в 14 дней
  if (data.startsWith("rem:")) {
    const uid = Number(data.split(":")[1]);
    if (store.remindedRecently(uid, 14)) return answer("Уже напоминали недавно");
    const c = store.abandonedCarts(30).find((x) => x.user_id === uid);
    const ok = await sendCartReminder(uid, c?.items || "");
    return answer(ok ? "Напомнили ✅" : "Не получилось: возможно, человек остановил бота");
  }

  if (data.startsWith("payno:")) {
    const order = store.getOrder(Number(data.split(":")[1]));
    if (!order || order.status !== "accepted") return answer("Статус уже изменён");
    const updated = await rejectPaid(order);
    await refreshAdminMessages(updated);
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    return answer("Написали покупателю");
  }

  if (data.startsWith("stock:")) {
    const tea = findTea(data.split(":")[1]);
    if (!tea) return answer();
    const now = store.availability()[tea.id] !== false;
    store.setAvailable(tea.id, !now);
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: stockKeyboard() });
    return answer(`${tea.name}: ${now ? "нет в наличии" : "в наличии"}`);
  }

  // Конверт подписки отправлен
  if (data.startsWith("sub:")) {
    if (!isAdmin(q.from.id)) return answer();
    const upd = await shipSub(Number(data.split(":")[1]));
    if (!upd) return answer("Уже отмечено");
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: "✅ Отправлено", callback_data: "noop" }]] } });
    return answer("Отметили, покупателю написали");
  }

  if (data.startsWith("ord:")) {
    const [, id, to] = data.split(":");
    const order = store.getOrder(Number(id));
    if (!order) return answer("Заказ не найден");
    if (!canMove(order.status, to)) return answer("Статус уже изменён");
    const updated = store.setStatus(order.id, to);
    // Обновляем все копии уведомления и то сообщение, где нажали кнопку
    const msgs = updated.adminMsgs.some(([c, m]) => c === chat && m === q.message.message_id)
      ? updated.adminMsgs
      : [...updated.adminMsgs, [chat, q.message.message_id]];
    await refreshAdminMessages({ ...updated, adminMsgs: msgs });
    await notifyCustomer(updated);
    if (to === "shipped") await orderShipped(updated); // онлайн-оплата: чек полного расчёта
    return answer("Готово");
  }
  return answer();
}

const RATINGS = { good: "👍 Понравился.", ok: "😐 Нормально.", bad: "👎 Не моё." };
const WISHES = { stronger: "покрепче", softer: "помягче", sweeter: "послаще", aroma: "ароматнее", same: "всё отлично" };
const FEEDBACK_AFTER_DAYS = Number(process.env.FEEDBACK_AFTER_DAYS || 3);

/** Через несколько дней после «Завершён» спрашиваем, как зашёл чай. Один раз на заказ. */
async function askFeedback() {
  for (const o of store.ordersDueForFeedback(FEEDBACK_AFTER_DAYS)) {
    store.markFeedbackAsked(o.id);
    if (!o.user_id) continue; // заказ с сайта — в Telegram спросить некого
    const names = o.items.filter((i) => i.teaId).map((i) => i.name);
    await tgSafe("sendMessage", {
      chat_id: o.user_id,
      text: `Уже попробовали чай из заказа №${o.id}?\n${names.map((n) => `• ${n}`).join("\n")}\n\nКак он вам? Это поможет подобрать следующий 🍵`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👍 Понравился", callback_data: `fb:${o.id}:good` },
            { text: "😐 Нормально", callback_data: `fb:${o.id}:ok` },
            { text: "👎 Не моё", callback_data: `fb:${o.id}:bad` },
          ],
        ],
      },
    });
  }
}

export async function startBot() {
  const me = await tg("getMe");
  console.log(`Бот @${me.username} запущен`);
  await tgSafe("setChatMenuButton", { menu_button: { type: "web_app", text: "Магазин", web_app: { url: `${PUBLIC_URL}/` } } });
  await tgSafe("setMyCommands", {
    commands: [
      { command: "start", description: "Начать сначала" },
      { command: "menu", description: "Показать кнопки меню" },
      { command: "help", description: "О магазине и как заказать" },
      { command: "delivery", description: "Доставка: службы, цены, сроки" },
      { command: "opt", description: "Я оптовик — обсудить опт лично" },
    ],
  });
  setInterval(() => askFeedback().catch((e) => console.error("[feedback]", e)), 30 * 60 * 1000);
  setInterval(() => autoRemind().catch((e) => console.error("[remind]", e)), 30 * 60 * 1000);
  askFeedback().catch((e) => console.error("[feedback]", e));
  sendMenuToOldUsers().catch((e) => console.error("[menu]", e));
  if (ORDERS_CHAT_ID) console.log(`Заказы и вопросы идут в группу ${ORDERS_CHAT_ID}`);
  if (!ADMIN_IDS.length) console.warn("ADMIN_IDS не задан: заказы некому будет получать. Напишите боту /id и добавьте ID.");
  poll(async (u) => {
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  });
}
export const _test = { onMessage, onCallback, autoRemind, statsText };
