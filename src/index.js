import { PORT } from "./config.js";
import { startServer } from "./server.js";
import { startBot } from "./bot.js";

startServer(PORT);
if (process.env.NO_BOT !== "1") {
  startBot().catch((e) => {
    console.error("Не удалось запустить бота:", e.message);
    process.exit(1);
  });
}
