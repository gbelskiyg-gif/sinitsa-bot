// Сводка из Яндекс Метрики для админа (кнопка в «📊 Статистике»).
// Нужен токен с правом только на чтение статистики: METRIKA_TOKEN в .env (как получить — README).
const API = (process.env.METRIKA_API || "https://api-metrika.yandex.net").replace(/\/+$/, "");
const COUNTER = () => process.env.METRIKA_ID || "113675520";
// Порядок шагов воронки — по идентификаторам целей на сайте
const FUNNEL = ["tea_open", "quiz_start", "quiz_done", "cart_add", "checkout_open", "order_sent"];

export const metrikaEnabled = () => !!process.env.METRIKA_TOKEN && /^\d+$/.test(COUNTER());

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n) => Math.round(Number(n) || 0).toLocaleString("ru-RU");
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

async function call(pathname, params = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { authorization: `OAuth ${process.env.METRIKA_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

const stat = (days, params) => call("/stat/v1/data", {
  ids: COUNTER(), date1: `${days - 1}daysAgo`, date2: "today", lang: "ru", accuracy: "full", ...params,
});

// Цели счётчика: id и идентификатор события (tea_open и т. п.)
async function goals() {
  const r = await call(`/management/v1/counter/${COUNTER()}/goals`);
  return (r.goals || []).map((g) => ({ id: g.id, name: g.name, event: g.conditions?.[0]?.url || "" }));
}

const rows = (r) => (r.data || []).map((d) => ({ name: d.dimensions?.[0]?.name || "", v: d.metrics?.[0] || 0 }));

export async function metrikaReport(days = 7) {
  if (!metrikaEnabled()) {
    return "📈 Яндекс Метрика не подключена: на сервере нет METRIKA_TOKEN. Инструкция — в README, раздел «Метрика в боте».";
  }
  try {
    const gl = await goals();
    const funnel = FUNNEL.map((e) => gl.find((g) => g.event === e)).filter(Boolean);
    const others = gl.filter((g) => !funnel.includes(g)).slice(0, Math.max(0, 14 - funnel.length));
    const goalList = [...funnel, ...others];

    const [tot, src, eng, dev, gr] = await Promise.all([
      stat(days, { metrics: "ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:percentNewVisitors" }),
      stat(days, { metrics: "ym:s:visits", dimensions: "ym:s:lastsignTrafficSource", sort: "-ym:s:visits", limit: "6" }),
      stat(days, { metrics: "ym:s:visits", dimensions: "ym:s:lastsignSourceEngine", sort: "-ym:s:visits", limit: "6" }),
      stat(days, { metrics: "ym:s:visits", dimensions: "ym:s:deviceCategory", sort: "-ym:s:visits", limit: "4" }),
      goalList.length ? stat(days, { metrics: goalList.map((g) => `ym:s:goal${g.id}users`).join(",") }) : null,
    ]);

    const [visits, users, views, bounce, dur, fresh] = tot.totals || [];
    const m = Math.floor((dur || 0) / 60), s = Math.round((dur || 0) % 60);
    const lines = [
      `📈 <b>Яндекс Метрика за ${days} дн.</b>`,
      `Посетители: <b>${num(users)}</b> (новых ${Math.round(fresh || 0)}%) · визиты: ${num(visits)} · страниц: ${num(views)}`,
      `В среднем на сайте: ${m} мин ${s} с · ушли сразу (отказы): ${Math.round(bounce || 0)}%`,
    ];

    if (gr) {
      const vals = gr.totals || [];
      const base = users || 0;
      lines.push("", "<b>Воронка</b> (люди, % от всех посетителей):");
      funnel.forEach((g, i) => lines.push(`${esc(g.name)} — ${num(vals[i])} (${pct(vals[i], base)})`));
      others.forEach((g, i) => lines.push(`${esc(g.name)} — ${num(vals[funnel.length + i])}`));
    }

    const srcRows = rows(src);
    if (srcRows.length) lines.push("", "<b>Откуда пришли</b>:", ...srcRows.map((r) => `${esc(r.name || "Не определено")} — ${num(r.v)}`));
    const engRows = rows(eng).filter((r) => r.name);
    if (engRows.length) lines.push("", "<b>Конкретные источники</b>:", ...engRows.map((r) => `${esc(r.name)} — ${num(r.v)}`));
    const devRows = rows(dev);
    if (devRows.length) lines.push("", `<b>Устройства</b>: ${devRows.map((r) => `${esc(r.name)} ${pct(r.v, visits)}`).join(" · ")}`);

    lines.push("", "<i>Метрика видит только тех, кто принял cookie; ваши визиты не считаются.</i>");
    return lines.join("\n");
  } catch (e) {
    if (e.message === "auth") return "📈 Метрика не пустила: токен не подходит или у него нет доступа к счётчику. Получите новый по инструкции в README.";
    console.error("metrika:", e.message);
    return "📈 Не удалось получить данные Метрики. Попробуйте чуть позже.";
  }
}
