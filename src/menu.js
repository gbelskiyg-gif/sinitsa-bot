import { isAdmin } from "./config.js";

// Кнопки постоянного меню внизу чата
export const BTN = {
  quiz: "🍵 Подобрать чай",
  shop: "🛍 Каталог",
  orders: "📦 Мои заказы",
  about: "🐦 О Синице",
  delivery: "🚚 Доставка",
  active: "🧾 Заказы в работе",
  stock: "🫙 Наличие",
  payment: "💳 Реквизиты",
};

// Версия меню: если поменяли кнопки, увеличьте — бот один раз разошлёт новое меню всем
export const MENU_VERSION = 1;

export function menuKeyboard(userId) {
  const rows = [
    [{ text: BTN.quiz }, { text: BTN.shop }],
    [{ text: BTN.orders }, { text: BTN.delivery }],
    [{ text: BTN.about }],
  ];
  if (isAdmin(userId)) rows.push([{ text: BTN.active }, { text: BTN.stock }], [{ text: BTN.payment }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: "Напишите вопрос продавцу" };
}
