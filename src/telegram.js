import { BOT_TOKEN } from "./config.js";

// TELEGRAM_API_BASE — адрес пересылки к Telegram, если с сервера api.telegram.org недоступен
// (сервер в РФ, пересылка — на зарубежном сервере, см. relay/README.md)
const BASE = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const API = `${BASE}/bot${BOT_TOKEN}`;

/** Вызов метода Telegram Bot API. Бросает ошибку, если Telegram ответил ok: false. */
export async function tg(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) {
    const err = new Error(`${method}: ${data.description}`);
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

/** Тихий вызов: ошибку пишет в лог и не роняет обработку. */
export async function tgSafe(method, params) {
  try {
    return await tg(method, params);
  } catch (e) {
    console.error("[telegram]", e.message);
    return null;
  }
}

/** Бесконечный цикл получения обновлений (long polling). */
export async function poll(onUpdate) {
  let offset = 0;
  await tgSafe("deleteWebhook", { drop_pending_updates: false });
  for (;;) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          await onUpdate(u);
        } catch (e) {
          console.error("[update]", e);
        }
      }
    } catch (e) {
      console.error("[poll]", e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
