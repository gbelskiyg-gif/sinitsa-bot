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
