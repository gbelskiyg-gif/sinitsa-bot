import path from "node:path";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Не задана переменная окружения ${name}. Посмотрите .env.example`);
    process.exit(1);
  }
  return v;
}

export const BOT_TOKEN = required("BOT_TOKEN");
// Адрес, по которому хостинг открывает приложение, например https://sinitsa.example.ru
export const PUBLIC_URL = required("PUBLIC_URL").replace(/\/+$/, "");
// Telegram ID продавцов через запятую. Узнать свой ID: написать боту /id
export const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
export const PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

export const isAdmin = (id) => ADMIN_IDS.includes(Number(id));
