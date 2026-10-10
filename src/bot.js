import { ADMIN_IDS, PUBLIC_URL, isAdmin } from "./config.js";
import { TEAS, findTea } from "./catalog.js";
import * as store from "./db.js";
import { adminKeyboard, canMove, notifyCustomer, orderText, refreshAdminMessages } from "./orders.js";
import { esc, poll, tg, tgSafe } from "./telegram.js";

const shopButton = (text, hash = "") => ({ text, web_app: { url: `${PUBLIC_URL}/${hash}` } });

const WELCOME =
  "🐦 Добро пожаловать в «Синицу»!\n\n" +
  "Мы верим, что у каждого человека есть свой чай.\n\n" +
  "🍵 Не знаете, с чего начать? Ответьте на 5 коротких вопросов, и мы подберём три чая под ваш вкус и способ заваривания.\n\n" +
  "Выбирайте, с чего начнём:";

const ABOUT =
  "«Синица» — небольшая коллекция китайского и тайваньского чая: улуны, ГАБА, красные чаи и пуэры.\n\n" +
  "Каждый чай можно взять по 20 г на пробу. Чай собираем под заказ, поэтому продавец подтверждает наличие, сумму с доставкой и сроки в этом чате. Оплата после подтверждения.\n\n" +
  "Остались вопросы? Просто напишите сообщение сюда, продавец ответит.";

const ADMIN_HELP =
  "<b>Для продавца</b>\n" +
  "/active — заказы в работе\n" +
  "/stock — наличие чаёв (нажмите на чай, чтобы включить или выключить)\n" +
  "/id — ваш Telegram ID\n\n" +
  "Новые заказы приходят сюда с кнопками статусов. Сообщения покупателей тоже приходят сюда: чтобы ответить, сделайте «Ответить» на пересланное сообщение.";

function startKeyboard() {
  return {
    inline_keyboard: [
      [shopButton("🛍 Открыть магазин")],
      [shopButton("🍵 Подобрать чай", "#quiz")],
      [{ text: "🐦 О Синице", callback_data: "about" }, { text: "💬 Задать вопрос", callback_data: "ask" }],
    ],
  };
}

function stockKeyboard() {
  const avail = store.availability();
  return {
    inline_keyboard: TEAS.map((t) => [
      { text: `${avail[t.id] === false ? "⛔" : "✅"} ${t.name}`.slice(0, 60), callback_data: `stock:${t.id}` },
    ]),
  };
}

async function onStart(msg) {
  const chat = msg.chat.id;
  const photo = await tgSafe("sendPhoto", {
    chat_id: chat,
    photo: `${PUBLIC_URL}/emblem.jpg`,
    caption: WELCOME,
    reply_markup: startKeyboard(),
  });
  if (!photo) await tgSafe("sendMessage", { chat_id: chat, text: WELCOME, reply_markup: startKeyboard() });
  if (isAdmin(msg.from.id)) await tgSafe("sendMessage", { chat_id: chat, text: ADMIN_HELP, parse_mode: "HTML" });
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
  for (const admin of ADMIN_IDS) {
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
    text: sent ? "Передали продавцу, ответ придёт сюда 🙂" : "Не получилось передать сообщение. Попробуйте чуть позже.",
  });
}

async function onMessage(msg) {
  if (msg.chat.type !== "private") return;
  const text = msg.text || "";
  const from = msg.from;
  if (from) store.upsertUser(from);

  if (text.startsWith("/start")) return onStart(msg);
  if (text.startsWith("/id")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Ваш Telegram ID: ${from.id}` });
  if (text.startsWith("/help")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ABOUT, reply_markup: startKeyboard() });

  if (isAdmin(from.id)) {
    if (text.startsWith("/active")) return onActive(msg);
    if (text.startsWith("/stock"))
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
    if (text.startsWith("/")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ADMIN_HELP, parse_mode: "HTML" });
    return tgSafe("sendMessage", {
      chat_id: msg.chat.id,
      text: "Чтобы ответить покупателю, нажмите «Ответить» на его сообщение.",
    });
  }

  if (text.startsWith("/")) return onStart(msg);
  return forwardToAdmins(msg);
}

async function onCallback(q) {
  const data = q.data || "";
  const chat = q.message?.chat.id;
  const answer = (text) => tgSafe("answerCallbackQuery", { callback_query_id: q.id, text });

  if (data === "about") {
    await answer();
    return tgSafe("sendMessage", { chat_id: chat, text: ABOUT, reply_markup: startKeyboard() });
  }
  if (data === "ask") {
    await answer();
    return tgSafe("sendMessage", { chat_id: chat, text: "Напишите вопрос одним сообщением, мы передадим его продавцу." });
  }

  if (!isAdmin(q.from.id)) return answer("Недоступно");

  if (data.startsWith("stock:")) {
    const tea = findTea(data.split(":")[1]);
    if (!tea) return answer();
    const now = store.availability()[tea.id] !== false;
    store.setAvailable(tea.id, !now);
    await tgSafe("editMessageReplyMarkup", { chat_id: chat, message_id: q.message.message_id, reply_markup: stockKeyboard() });
    return answer(`${tea.name}: ${now ? "нет в наличии" : "в наличии"}`);
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
    return answer("Готово");
  }
  return answer();
}

export async function startBot() {
  const me = await tg("getMe");
  console.log(`Бот @${me.username} запущен`);
  await tgSafe("setChatMenuButton", { menu_button: { type: "web_app", text: "Магазин", web_app: { url: `${PUBLIC_URL}/` } } });
  await tgSafe("setMyCommands", {
    commands: [
      { command: "start", description: "Главное меню" },
      { command: "help", description: "О магазине и как заказать" },
    ],
  });
  if (!ADMIN_IDS.length) console.warn("ADMIN_IDS не задан: заказы некому будет получать. Напишите боту /id и добавьте ID.");
  poll(async (u) => {
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  });
}
