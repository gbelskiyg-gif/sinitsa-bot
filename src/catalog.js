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

export const PACKS =["20", "50", "100", "wholesale"];

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
