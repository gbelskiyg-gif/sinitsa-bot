import { PORT } from "./config.js";
import { startServer } from "./server.js";
import { startBot } from "./bot.js";

import * as store from "./db.js";

startServer(PORT);

// Раз в сутки удаляем персональные данные из старых заказов (см. политику конфиденциальности)
const cleanup = () => {
  try {
    const n = store.anonymizeOldOrders(365);
    if (n) console.log(`Обезличено старых заказов: ${n}`);
  } catch (e) {
    console.error("[cleanup]", e);
  }
};
cleanup();
setInterval(cleanup, 24 * 60 * 60 * 1000);
if (process.env.NO_BOT !== "1") {
  startBot().catch((e) => {
    console.error("Не удалось запустить бота:", e.message);
    process.exit(1);
  });
}
