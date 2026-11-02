// Розыгрыши в Telegram-канале: участник — подписчик канала, оставивший комментарий под постом.
// Бот должен быть администратором канала (чтобы проверять подписку) и группы обсуждения (чтобы видеть комментарии).
// Команда для продавца в личке бота: /rozygrysh — список последних постов с числом участников и кнопкой «Разыграть».
import crypto from "node:crypto";
import { db } from "./db.js";
import { isAdmin } from "./config.js";
import { esc, tgSafe } from "./telegram.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS gw_posts (
    group_id INTEGER NOT NULL,
    thread_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    post_id INTEGER,
    channel_username TEXT,
    text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, thread_id)
  );
  CREATE TABLE IF NOT EXISTS gw_entries (
    group_id INTEGER NOT NULL,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    first_name TEXT,
    username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, thread_id, user_id)
  );
`);

/** Удаляем данные участников старых розыгрышей (имена — персональные данные, дольше не храним). */
export function cleanGiveaways(days = 30) {
  db.prepare("DELETE FROM gw_entries WHERE created_at < datetime('now', ?)").run(`-${days} days`);
  db.prepare("DELETE FROM gw_posts WHERE created_at < datetime('now', ?)").run(`-${days} days`);
}

/** Сообщение в группе обсуждения: запоминаем пост канала или комментарий к нему. true — сообщение обработано. */
export function trackGroupMessage(msg) {
  const group = msg.chat.id;
  // Пост канала автоматически пересылается в группу обсуждения — это «корень» ветки комментариев
  if (msg.is_automatic_forward && msg.sender_chat?.type === "channel") {
    const origin = msg.forward_origin || {};
    db.prepare(
      "INSERT OR IGNORE INTO gw_posts (group_id, thread_id, channel_id, post_id, channel_username, text) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(group, msg.message_id, msg.sender_chat.id, origin.message_id || msg.forward_from_message_id || null, msg.sender_chat.username || null,
      String(msg.text || msg.caption || "").slice(0, 200));
    return true;
  }
  const thread = msg.message_thread_id || msg.reply_to_message?.message_id;
  if (!thread || !msg.from || msg.from.is_bot || msg.sender_chat) return false;
  if (!db.prepare("SELECT 1 FROM gw_posts WHERE group_id = ? AND thread_id = ?").get(group, thread)) return false;
  db.prepare("INSERT OR IGNORE INTO gw_entries (group_id, thread_id, user_id, first_name, username) VALUES (?, ?, ?, ?, ?)")
    .run(group, thread, msg.from.id, msg.from.first_name || "", msg.from.username || null);
  return true;
}

const shortText = (t) => (t || "пост без текста").replace(/\s+/g, " ").slice(0, 60);
const count = (g, t) => db.prepare("SELECT user_id FROM gw_entries WHERE group_id = ? AND thread_id = ?").all(g, t).filter((e) => !isAdmin(e.user_id)).length;
const who = (e) => `${esc(e.first_name || "Без имени")}${e.username ? ` (@${esc(e.username)})` : ""}`;

/** /rozygrysh — последние посты канала с числом комментаторов. */
export function giveawayMenu(chatId) {
  const posts = db.prepare("SELECT * FROM gw_posts ORDER BY created_at DESC LIMIT 8").all();
  if (!posts.length)
    return tgSafe("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "🎁 <b>Розыгрыш</b>\n\nПока не вижу постов канала. Чтобы бот считал комментарии:\n" +
        "1. Добавьте бота администратором <b>канала</b> (права можно минимальные) — так он проверит подписку.\n" +
        "2. Добавьте бота администратором <b>группы обсуждения</b> — так он видит комментарии.\n" +
        "3. Опубликуйте пост с розыгрышем. Бот запоминает посты и комментарии, начиная с этого момента.",
    });
  return tgSafe("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: "🎁 <b>Розыгрыш</b>\n\nВыберите пост — разыграем среди тех, кто его прокомментировал и подписан на канал:",
    reply_markup: {
      inline_keyboard: posts.map((p) => [{ text: `${count(p.group_id, p.thread_id)} 👤 · ${shortText(p.text)}`, callback_data: `gw:${p.group_id}:${p.thread_id}` }]),
    },
  });
}

const SUBSCRIBED = new Set(["member", "administrator", "creator", "restricted"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Провести розыгрыш по посту: проверка подписки, честный случайный выбор, «барабан» для записи экрана. */
export async function runGiveaway(chatId, groupId, threadId, fromId) {
  if (!isAdmin(fromId)) return;
  const post = db.prepare("SELECT * FROM gw_posts WHERE group_id = ? AND thread_id = ?").get(groupId, threadId);
  if (!post) return tgSafe("sendMessage", { chat_id: chatId, text: "Пост не найден." });
  const all = db.prepare("SELECT * FROM gw_entries WHERE group_id = ? AND thread_id = ? ORDER BY created_at").all(groupId, threadId)
    .filter((e) => !isAdmin(e.user_id));
  const msg = await tgSafe("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🎁 <b>Розыгрыш</b>\n«${esc(shortText(post.text))}»\n\nКомментариев от разных людей: ${all.length}\nПроверяем подписку на канал…` });
  const ok = [];
  let checkFailed = 0;
  for (const e of all) {
    const m = await tgSafe("getChatMember", { chat_id: post.channel_id, user_id: e.user_id });
    if (!m) checkFailed++;
    else if (SUBSCRIBED.has(m.status) && m.is_member !== false) ok.push(e);
  }
  if (checkFailed && checkFailed === all.length)
    return tgSafe("sendMessage", { chat_id: chatId, text: "Не получилось проверить подписку: сделайте бота администратором канала и запустите розыгрыш ещё раз." });
  const head = `🎁 <b>Розыгрыш</b>\n«${esc(shortText(post.text))}»\n\nКомментариев: ${all.length} · подписаны на канал: ${ok.length}`;
  if (!ok.length) return tgSafe("editMessageText", { chat_id: chatId, message_id: msg?.message_id, parse_mode: "HTML", text: `${head}\n\nПодходящих участников нет.` });

  const winner = ok[crypto.randomInt(ok.length)];
  // «Барабан»: несколько случайных имён перед результатом — для записи экрана
  for (let i = 0; i < Math.min(6, ok.length * 2); i++) {
    const e = ok[crypto.randomInt(ok.length)];
    await tgSafe("editMessageText", { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML", text: `${head}\n\n🎲 ${who(e)}` });
    await sleep(600);
  }
  const link = post.channel_username && post.post_id ? `\nПост: https://t.me/${post.channel_username}/${post.post_id}` : "";
  return tgSafe("editMessageText", {
    chat_id: chatId,
    message_id: msg.message_id,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text:
      `${head}\n\n🏆 <b>Победитель: ${who(winner)}</b>\n` +
      `<a href="tg://user?id=${winner.user_id}">Написать победителю</a>${link}\n\n` +
      `Выбран случайно (crypto.randomInt) из ${ok.length} подписчиков, оставивших комментарий.`,
  });
}
