import crypto from "node:crypto";

/**
 * Проверка подписи данных, которые Telegram передаёт в мини-приложение (initData).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Возвращает объект пользователя или null.
 */
export function verifyInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  if (!initData || typeof initData !== "string") return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user"));
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

/** Для тестов: собрать подписанную строку initData. */
export function signInitData(user, botToken, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheck).digest("hex"));
  return params.toString();
}

// ---------- вход на сайте через Telegram (Login Widget) ----------
// https://core.telegram.org/widgets/login#checking-authorization
const WIDGET_FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];
const widgetCheck = (data) =>
  WIDGET_FIELDS.filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== "")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

/** Проверить данные от кнопки «Войти через Telegram». Возвращает пользователя или null. */
export function verifyLoginWidget(data, botToken, maxAgeSec = 24 * 3600) {
  if (!data || typeof data !== "object" || typeof data.hash !== "string") return null;
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(widgetCheck(data)).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(data.hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(data.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, first_name: String(data.first_name || ""), username: String(data.username || "") };
}

/** Для тестов: подписать данные так, как это делает Telegram. */
export function signLoginWidget(user, botToken, authDate = Math.floor(Date.now() / 1000)) {
  const data = { ...user, auth_date: authDate };
  const secret = crypto.createHash("sha256").update(botToken).digest();
  return { ...data, hash: crypto.createHmac("sha256", secret).update(widgetCheck(data)).digest("hex") };
}

// Сессия на сайте: подписанный токен, живёт 90 дней, хранится у покупателя в браузере
const sessionKey = (botToken) => crypto.createHmac("sha256", "SinitsaSiteSession").update(botToken).digest();
export function signSession(user, botToken, days = 90) {
  const body = Buffer.from(JSON.stringify({ id: user.id, n: user.first_name || "", u: user.username || "", exp: Math.floor(Date.now() / 1000) + days * 86400 })).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionKey(botToken)).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifySession(token, botToken) {
  if (!token || typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const calc = crypto.createHmac("sha256", sessionKey(botToken)).update(body).digest("base64url");
  const a = Buffer.from(calc);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.id || p.exp < Date.now() / 1000) return null;
    return { id: p.id, first_name: p.n, username: p.u };
  } catch {
    return null;
  }
}
