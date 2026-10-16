// Письма покупателям через SMTP (по умолчанию — Яндекс Почта, smtp.yandex.ru:465, SSL).
// Без внешних библиотек: короткий SMTP-клиент на node:tls.
// Настройки в .env: SMTP_USER (адрес ящика), SMTP_PASS (пароль приложения из Яндекс ID).
// Если SMTP_USER/SMTP_PASS не заданы, письма просто не отправляются — магазин работает как раньше.
import tls from "node:tls";
import crypto from "node:crypto";
import os from "node:os";

const HOST = process.env.SMTP_HOST || "smtp.yandex.ru";
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || "";
const PASS = process.env.SMTP_PASS || "";
const FROM_NAME = process.env.MAIL_FROM_NAME || "Синица — китайский чай";

export const mailEnabled = () => !!(USER && PASS);
export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-zа-я]{2,24}$/i;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encWord = (s) => `=?UTF-8?B?${b64(s)}?=`;
const wrap76 = (s) => s.replace(/.{1,76}/g, "$&\r\n");

function buildMessage({ to, subject, text, html }) {
  const boundary = "sinitsa-" + crypto.randomBytes(8).toString("hex");
  const domain = USER.split("@")[1] || "localhost";
  return [
    `From: ${encWord(FROM_NAME)} <${USER}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Отправить письмо. Возвращает true/false, никогда не бросает исключение. */
export function sendMail({ to, subject, text, html }) {
  if (!mailEnabled() || !EMAIL_RE.test(String(to || ""))) return Promise.resolve(false);
  const data = buildMessage({ to, subject, text, html: html || `<pre>${text}</pre>` })
    .replace(/\r\n\./g, "\r\n..");
  const steps = [
    [null, 220],
    [`EHLO ${os.hostname() || "sinitsa"}`, 250],
    ["AUTH LOGIN", 334],
    [b64(USER), 334],
    [b64(PASS), 235],
    [`MAIL FROM:<${USER}>`, 250],
    [`RCPT TO:<${to}>`, 250],
    ["DATA", 354],
    [data + "\r\n.", 250],
    ["QUIT", 221],
  ];
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, why) => {
      if (done) return; done = true;
      if (!ok) console.error("Письмо не отправлено:", why);
      try { sock.end(); } catch {}
      resolve(ok);
    };
    const sock = tls.connect({ host: HOST, port: PORT, servername: HOST });
    sock.setTimeout(20000, () => finish(false, "timeout"));
    sock.on("error", (e) => {
      // При неудачном подключении Node отдаёт AggregateError с пустым message — показываем коды
      const codes = [e.code, ...(e.errors || []).map((x) => `${x.code || x.message} ${x.address || ""}:${x.port || ""}`)].filter(Boolean).join("; ");
      finish(false, `${HOST}:${PORT} — ${e.message || "нет соединения"}${codes ? ` (${codes})` : ""}`);
    });
    let buf = "", i = 0;
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // ответ закончен, когда последняя строка вида «250 текст» (без дефиса)
      const lines = buf.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last) || !buf.endsWith("\r\n")) return;
      const code = Number(last.slice(0, 3));
      buf = "";
      const [, expect] = steps[i];
      if (code !== expect) return finish(false, `${steps[i][0]?.split(" ")[0] || "connect"} → ${last}`);
      i++;
      if (i >= steps.length) return finish(true);
      sock.write(steps[i][0] + "\r\n");
      if (steps[i][0] === "QUIT") setTimeout(() => finish(true), 1500);
    });
  });
}
