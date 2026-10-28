// Проверка почты с сервера: docker compose exec app node src/mailtest.js [адрес]
import { mailEnabled, sendMail } from "./mail.js";
const to = process.argv[2] || process.env.SMTP_USER;
if (!mailEnabled()) { console.log("Почта не настроена: нет SMTP_USER или SMTP_PASS в .env"); process.exit(1); }
const ok = await sendMail({ to, subject: "Проверка почты «Синицы»", text: "Если вы это читаете — письма с сервера уходят." });
console.log(ok ? `Отправлено на ${to} ✅` : "Не отправлено ❌ — причина в строке выше");
