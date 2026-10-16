// Вход на сайт через бота: сайт создаёт одноразовый код, покупатель открывает бота по ссылке
// t.me/<бот>?start=login_<код>, нажимает «Да, войти» — и сайт получает сессию. Телефон вводить не нужно.
import crypto from "node:crypto";

const TTL = 10 * 60 * 1000;
const codes = new Map(); // code -> { created, user?, used? }

const sweep = () => { const now = Date.now(); for (const [k, v] of codes) if (now - v.created > TTL) codes.delete(k); };

export function createLoginCode() {
  sweep();
  if (codes.size > 5000) return null;
  const code = crypto.randomBytes(16).toString("hex");
  codes.set(code, { created: Date.now() });
  return code;
}
export function loginCodeValid(code) {
  const v = codes.get(String(code || ""));
  return !!v && !v.user && Date.now() - v.created < TTL;
}
/** Бот: покупатель подтвердил вход. */
export function confirmLoginCode(code, user) {
  const v = codes.get(String(code || ""));
  if (!v || v.user || Date.now() - v.created > TTL) return false;
  v.user = { id: user.id, first_name: user.first_name || "", username: user.username || "" };
  return true;
}
/** Сайт: забрать подтверждённого пользователя (один раз). */
export function takeLoginCode(code) {
  const v = codes.get(String(code || ""));
  if (!v) return { status: "expired" };
  if (Date.now() - v.created > TTL) { codes.delete(code); return { status: "expired" }; }
  if (!v.user) return { status: "pending" };
  codes.delete(code);
  return { status: "ok", user: v.user };
}
