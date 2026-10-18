import { PORT } from "./config.js";
import { startServer } from "./server.js";
import { startBot } from "./bot.js";

import * as store from "./db.js";
import { tickSubs } from "./payments.js";

startServer(PORT);

// Раз в сутки удаляем персональные данные из старых заказов (см. политику конфиденциальности)
const cleanup = () => {
  try {
    const n = store.anonymizeOldOrders(30);
    store.cleanOldEvents(90);
    if (n) console.log(`Обезличено старых заказов: ${n}`);
  } catch (e) {
    console.error("[cleanup]", e);
  }
};
cleanup();
setInterval(cleanup, 24 * 60 * 60 * 1000);
// Подписка «Чайный клуб»: раз в час — автосписания и напоминания продавцу отправить конверты
setTimeout(tickSubs, 60_000);
setInterval(tickSubs, 60 * 60 * 1000);
if (process.env.NO_BOT !== "1") {
  startBot().catch((e) => {
    console.error("Не удалось запустить бота:", e.message);
    process.exit(1);
  });
}
