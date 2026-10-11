import { TEAS } from "./teas.js";

export { TEAS };

export const KINDS = {
  gaba: { label: "ГАБА", group: "gaba", glyph: "香" },
  light_oolong: { label: "Светлый улун", group: "oolong", glyph: "清" },
  dark_oolong: { label: "Тёмный улун", group: "oolong", glyph: "岩" },
  dancong: { label: "Даньцун", group: "oolong", glyph: "鳳" },
  red: { label: "Красный чай", group: "red", glyph: "紅" },
  shu: { label: "Шу пуэр", group: "puer", glyph: "熟" },
  sheng: { label: "Шэн пуэр", group: "puer", glyph: "生" },
  puer: { label: "Пуэр", group: "puer", glyph: "普" },
};

// [чай, вода, температура, первый пролив]
export const RECIPES = {
  gaba: ["5 г", "100 мл", "95–100 °C", "5–7 секунд"],
  light_oolong: ["4–5 г", "150 мл", "90–95 °C", "5–10 секунд"],
  dark_oolong: ["4–5 г", "150 мл", "90–95 °C", "5–10 секунд"],
  dancong: ["4–5 г", "100 мл", "90 °C", "1–3 секунды"],
  red: ["4–5 г", "150 мл", "90–95 °C", "5–10 секунд"],
  shu: ["5 г", "100 мл", "95–100 °C", "10 секунд"],
  sheng: ["5–6 г", "100 мл", "90–92 °C", "10–20 секунд"],
  puer: ["5 г", "100 мл", "95–100 °C", "10 секунд"],
};

export const TASTES = {
  fruity: "Фруктовый",
  honey: "Медовый",
  floral: "Цветочный",
  bread: "Хлебный",
  nutty: "Ореховый",
  woody: "Древесный",
  spicy: "Пряный",
  herbal: "Травяной",
};

/**
 * Признаки для подбора чая. По виду чая, отдельные сорта уточнены в QUIZ_OVERRIDES.
 * familiar — что человек обычно пьёт, если этот чай ему будет «родным»: black (чёрный в пакетиках),
 *   coffee (кофе), green (зелёный), herbal (травяной), none (ничего особенного).
 * bitter — риск горечи и терпкости 0–2; earthy — «земляной» вкус; mug — прощает заваривание в кружке;
 * caffeine — относительная бодрость 1–3 (больше всего зависит от заваривания).
 */
export const QUIZ = {
  gaba: { familiar: ["herbal", "none", "black"], bitter: 0, earthy: false, mug: true, caffeine: 2 },
  light_oolong: { familiar: ["green", "herbal", "none"], bitter: 0, earthy: false, mug: true, caffeine: 2 },
  dark_oolong: { familiar: ["coffee", "black"], bitter: 1, earthy: false, mug: true, caffeine: 2 },
  dancong: { familiar: ["green"], bitter: 2, earthy: false, mug: false, caffeine: 2 },
  red: { familiar: ["black", "coffee", "none"], bitter: 0, earthy: false, mug: true, caffeine: 3 },
  shu: { familiar: ["coffee", "black"], bitter: 0, earthy: true, mug: true, caffeine: 2 },
  sheng: { familiar: ["green"], bitter: 2, earthy: false, mug: false, caffeine: 3 },
  puer: { familiar: ["coffee", "black"], bitter: 1, earthy: true, mug: true, caffeine: 2 },
};
export const QUIZ_OVERRIDES = {
  25: { bitter: 0 }, // Бирма: мягче и легче
  29: { familiar: ["herbal", "none", "black"] }, // Женьшень улун: сладкий
};
export const quizOf = (tea) => ({ ...QUIZ[tea.kind], ...(QUIZ_OVERRIDES[tea.id] || {}) });

// Рецепт для кружки или чайника: один долгий пролив
export const MUG_RECIPES = {
  gaba: "3–4 г на 250 мл, 95 °C, 2–3 минуты",
  light_oolong: "3 г на 250 мл, 90 °C, 2–3 минуты",
  dark_oolong: "3–4 г на 250 мл, 95 °C, 2–3 минуты",
  dancong: "2 г на 250 мл, 90 °C, 1–2 минуты",
  red: "3 г на 250 мл, 90–95 °C, 3 минуты",
  shu: "3–4 г на 250 мл, кипяток, 2–3 минуты; первую воду слить",
  sheng: "2–3 г на 250 мл, 85–90 °C, 1–2 минуты",
  puer: "3–4 г на 250 мл, кипяток, 2–3 минуты; первую воду слить",
};

/**
 * Готовые наборы: каждый чай по 20 г, скидка 10% (SET_DISCOUNT в orders.js).
 * Чтобы изменить состав, поменяйте номера чаёв (id из teas.js).
 */
// Готовые наборы: по 3 разных чая одной фасовки (20, 50 или 100 г), скидка 10%.
// Свой набор покупатель собирает сам из 3–6 чаёв — правило то же.
export const SETS = [
  { key: "gaba", emoji: "🌙", title: "Знакомство с ГАБА", text: "Три разных ГАБА улуна: орехи и карамель, хлеб и мёд, фрукты. Мягкие, сладкие, без горечи — для спокойного вечера.", teas: [6, 4, 2] },
  { key: "puer", emoji: "🍂", title: "Знакомство с пуэром", text: "Три лица пуэра: тёмный и тёплый шу, бодрый молодой шэн и выдержанный Павлин 2006 года.", teas: [21, 22, 26] },
  { key: "oolong-red", emoji: "🌸", title: "Улуны и красный", text: "Всё, что не ГАБА и не пуэр: свежий светлый улун, печёный тёмный и медовый красный.", teas: [28, 27, 13] },
  { key: "morning", emoji: "🌅", title: "Утро", text: "Бодрящие красные чаи: мёд, солод, хлеб. Для завтрака и начала дня.", teas: [13, 14, 16] },
  { key: "pause", emoji: "🌿", title: "Пауза", text: "Мягкие и спокойные: ГАБА и светлые улуны для неспешного чаепития.", teas: [6, 9, 28] },
  { key: "after-meal", emoji: "🍂", title: "После еды", text: "Тёплые и глубокие: шу пуэр и тёмный улун.", teas: [11, 7, 21] },
  { key: "first-steps", emoji: "🧭", title: "Знакомство", text: "Три самых непохожих вида: мягкий ГАБА, медовый красный и тёмный шу пуэр — чтобы понять, что ближе.", teas: [4, 16, 11] },
];

// Промокоды. Регистр и русская раскладка («синица10») не важны.
export const PROMOS = {
  SINITSA10: { percent: 10, firstOrderOnly: true, label: "Первый заказ −10%" },
};
export function normalizePromo(code) {
  let c = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (c.startsWith("СИНИЦА")) c = "SINITSA" + c.slice(6);
  return c;
}

export const PACKS = ["20", "50", "100", "wholesale"];

export const STATUS = {
  new: "Новый",
  accepted: "Принят",
  shipped: "Отправлен",
  done: "Завершён",
  cancelled: "Отменён",
};

export function findTea(id) {
  return TEAS.find((t) => t.id === Number(id));
}

/** Цена и граммовка одной позиции. Возвращает null, если фасовки нет. */
export function packInfo(tea, pack) {
  if (pack === "wholesale") return { grams: tea.wholesale.grams, price: tea.wholesale.price, label: `опт ${tea.wholesale.grams} г` };
  if (tea.prices[pack] == null) return null;
  return { grams: Number(pack), price: tea.prices[pack], label: `${pack} г` };
}

export function rub(n) {
  return n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₽";
}
