import { notifyChats } from "./config.js";
import { findTea } from "./catalog.js";
import * as store from "./db.js";
import { menuKeyboard } from "./menu.js";
import { esc, tgSafe } from "./telegram.js";

// Опт не продаём через корзину: оптовик нажимает «Я оптовик», и дальше общаемся лично.
export const WHOLESALE_REPLY =
  "Спасибо! 🧑‍💼 С оптовыми покупателями мы общаемся лично — скоро напишем вам здесь.\n\n" +
  "Чтобы быстрее подготовить цены, расскажите одним сообщением:\n" +
  "• какие чаи интересуют;\n" +
  "• примерные объёмы;\n" +
  "• для чего: кофейня, магазин, подарки, для себя.\n\n" +
  "В Москве можем встретиться — попробуете чай и выберете.";

/** Покупатель нажал «Я оптовик»: продавцам — уведомление (на него можно ответить), покупателю — ответ. */
export async function requestWholesale(user, teaId = 0) {
  if (store.hasRecentEvent(user.id, "wholesale", 24 * 60)) return { ok: true, repeat: true };
  store.logEvent(user.id, "wholesale", teaId || "");
  const tea = teaId ? findTea(teaId) : null;
  const who = `${esc(user.first_name || "Без имени")}${user.username ? ` (@${esc(user.username)})` : ""}`;
  for (const chat of notifyChats()) {
    const m = await tgSafe("sendMessage", {
      chat_id: chat,
      text: `🧑‍💼 <b>Запрос на опт</b> от ${who}${tea ? `\nСмотрел: ${esc(tea.name)}` : ""}\n\nЧтобы написать ему, нажмите «Ответить» на это сообщение.`,
      parse_mode: "HTML",
    });
    if (m) store.rememberSupport(chat, m.message_id, user.id);
  }
  await tgSafe("sendMessage", { chat_id: user.id, text: WHOLESALE_REPLY, reply_markup: menuKeyboard(user.id) });
  return { ok: true };
}
