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

// Группа для заказов, вопросов и отзывов. Если не задана — всё приходит продавцам в личку.
// Узнать ID группы: написать в группе /chatid
export const ORDERS_CHAT_ID = Number(process.env.ORDERS_CHAT_ID || 0);
export const notifyChats = () => (ORDERS_CHAT_ID ? [ORDERS_CHAT_ID] : ADMIN_IDS);

// Данные продавца для политики конфиденциальности и согласия (страницы /privacy и /consent)
// Данные оператора персональных данных для страниц /consent и /privacy.
// Значения из .env (OPERATOR_*) важнее этих.
export const LEGAL = {
  name: process.env.OPERATOR_NAME || "Бельский Александр Георгиевич",
  inn: process.env.OPERATOR_INN || "",
  email: process.env.OPERATOR_EMAIL || "belsciy@list.ru",
  address: process.env.OPERATOR_ADDRESS || "г. Москва",
  date: process.env.LEGAL_DATE || "11.10.2026",
};
