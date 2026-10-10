import { ADMIN_IDS, ORDERS_CHAT_ID, PUBLIC_URL, isAdmin, notifyChats } from "./config.js";
import { STATUS, TEAS, findTea, rub } from "./catalog.js";
import * as store from "./db.js";
import { adminKeyboard, canMove, notifyCustomer, orderText, refreshAdminMessages } from "./orders.js";
import { esc, poll, tg, tgSafe } from "./telegram.js";

// Раздел передаём через ?tab=, потому что после # Telegram дописывает свои параметры запуска
const shopButton = (text, hash = "") => ({
  text,
  web_app: { url: hash ? `${PUBLIC_URL}/?tab=${hash.replace("#", "")}` : `${PUBLIC_URL}/` },
});

const WELCOME =
  "🐦 Добро пожаловать в «Синицу»!\n\n" +
  "Мы верим, что у каждого человека есть свой чай.\n\n" +
  "🍵 Не знаете, с чего начать? Ответьте на 5 коротких вопросов, и мы подберём три чая под ваш вкус и способ заваривания.\n\n" +
  "🎁 На первый заказ — промокод SINITSA10, скидка 10%.\n\n" +
  "Выбирайте, с чего начнём:";

const ABOUT =
  "«Синица» — небольшая коллекция китайского и тайваньского чая: улуны, ГАБА, красные чаи и пуэры.\n\n" +
  "Каждый чай можно взять по 20 г на пробу. Чай собираем под заказ, поэтому продавец подтверждает наличие, сумму с доставкой и сроки в этом чате. Оплата после подтверждения.\n\n" +
  "Остались вопросы? Просто напишите сообщение сюда, продавец ответит.";

const ADMIN_HELP =
  "<b>Для продавца</b>\n" +
  "Внизу появились кнопки «🧾 Заказы в работе» и «🫙 Наличие».\n" +
  "В «Наличии» нажмите на чай, чтобы включить или выключить его в магазине.\n\n" +
  "Новые заказы приходят сюда с кнопками статусов. Сообщения покупателей тоже приходят сюда: чтобы ответить, сделайте «Ответить» на пересланное сообщение.";

// Кнопки постоянного меню внизу чата
const BTN = {
  quiz: "🍵 Подобрать чай",
  shop: "🛍 Каталог",
  orders: "📦 Мои заказы",
  about: "🐦 О Синице",
  active: "🧾 Заказы в работе",
  stock: "🫙 Наличие",
};
function menuKeyboard(userId) {
  const rows = [
    [{ text: BTN.quiz }, { text: BTN.shop }],
    [{ text: BTN.orders }, { text: BTN.about }],
  ];
  if (isAdmin(userId)) rows.push([{ text: BTN.active }, { text: BTN.stock }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: "Напишите вопрос продавцу" };
}
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
  await tgSafe("sendMessage", {
    chat_id: chat,
    text: isAdmin(msg.from.id) ? ADMIN_HELP : "Меню всегда под рукой, внизу чата 👇\nВопрос продавцу можно просто написать сообщением.",
    parse_mode: "HTML",
    reply_markup: menuKeyboard(msg.from.id),
  });
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
    text: sent ? "Передали продавцу, ответ придёт сюда 🙂" : "Не получилось передать сообщение. Попробуйте чуть позже.",
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
  if (text === BTN.quiz)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "Пять коротких вопросов, и мы предложим три чая под ваш вкус и способ заваривания.", reply_markup: openButton("🍵 Начать подбор", "#quiz") });
  if (text === BTN.shop)
    return tgSafe("sendMessage", { chat_id: msg.chat.id, text: "29 чаёв и готовые наборы по 20 г. Каждый можно взять на пробу.", reply_markup: openButton("🛍 Открыть каталог", "") });
  if (text === BTN.orders) return myOrders(msg);
  if (text === BTN.about) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ABOUT, reply_markup: menuKeyboard(from.id) });
  if (text.startsWith("/id")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: `Ваш Telegram ID: ${from.id}` });
  if (text.startsWith("/help")) return tgSafe("sendMessage", { chat_id: msg.chat.id, text: ABOUT, reply_markup: startKeyboard() });

  if (isAdmin(from.id)) {
    if (text.startsWith("/active") || text === BTN.active) return onActive(msg);
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
      text: "Меню продавца внизу 👇 Чтобы ответить покупателю, нажмите «Ответить» на его сообщение.",
      reply_markup: menuKeyboard(from.id),
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

  // Отзыв покупателя: fb:<заказ>:<оценка>, затем fw:<заказ>:<пожелание>
  if (data.startsWith("fb:") || data.startsWith("fw:")) {
    const [kind, id, value] = data.split(":");
    const order = store.getOrder(Number(id));
    if (!order || order.user_id !== q.from.id) return answer();
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

const RATINGS = { good: "👍 Понравился.", ok: "😐 Нормально.", bad: "👎 Не моё." };
const WISHES = { stronger: "покрепче", softer: "помягче", sweeter: "послаще", aroma: "ароматнее", same: "всё отлично" };
const FEEDBACK_AFTER_DAYS = Number(process.env.FEEDBACK_AFTER_DAYS || 3);

/** Через несколько дней после «Завершён» спрашиваем, как зашёл чай. Один раз на заказ. */
async function askFeedback() {
  for (const o of store.ordersDueForFeedback(FEEDBACK_AFTER_DAYS)) {
    store.markFeedbackAsked(o.id);
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
      { command: "start", description: "Главное меню" },
      { command: "help", description: "О магазине и как заказать" },
    ],
  });
  setInterval(() => askFeedback().catch((e) => console.error("[feedback]", e)), 30 * 60 * 1000);
  askFeedback().catch((e) => console.error("[feedback]", e));
  if (ORDERS_CHAT_ID) console.log(`Заказы и вопросы идут в группу ${ORDERS_CHAT_ID}`);
  if (!ADMIN_IDS.length) console.warn("ADMIN_IDS не задан: заказы некому будет получать. Напишите боту /id и добавьте ID.");
  poll(async (u) => {
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  });
}
export const _test = { onMessage, onCallback };
