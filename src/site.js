// Сайт «Синицы»: страницы для людей и поисковиков.
//   /            главная
//   /chai        каталог, /chai/<slug> — страница чая
//   /blog        блог «О чае», /blog/<slug> — статья
//   главная — сам магазин (то же приложение, что в Telegram); /shop и /podbor ведут на неё
//   /sitemap.xml, /robots.txt
// Заказ на сайте оформляется без Telegram (см. /api/site-orders в server.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGAL, PUBLIC_URL } from "./config.js";
import { DELIVERY, FREE_DELIVERY_FROM, KINDS, RECIPES, TEAS } from "./catalog.js";
import { ARTICLES, REGIONS, articleBySlug } from "./articles.js";
import * as store from "./db.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const BOT = "https://t.me/sinitsa_chai_bot";
const CHANNEL = "https://t.me/sinitsa_chai";
const INSTAGRAM = "https://www.instagram.com/sinitsa_chai/";
// Живые люди для вопросов: показываем внизу сайта и в оформлении заказа
const PEOPLE = [["Яна", "alpha_omega_Y"], ["Александр", "Ont_hefly"]];
const peopleLinks = () => PEOPLE.map(([n, u]) => `<a href="https://t.me/${u}">${n} — @${u}</a>`).join("");
const BRAND = "Синица";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rub = (n) => n.toLocaleString("ru-RU").replace(/\s/g, " ") + " ₽";
const abs = (p) => PUBLIC_URL + p;

// ---------- адреса чаёв: «Габа Шаньлинси» → gaba-shanlinsi ----------
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function slugify(s) {
  return String(s).toLowerCase().split("").map((c) => TR[c] ?? c).join("")
    .replace(/№/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}
// Название до тире — короче и лучше ищется: «Красный ИньЛо — дяньхун улитки» → krasnyj-inlo
const slugOf = (t) => slugify(t.name.split(" — ")[0].replace(/,.*$/, ""));
const TEA_SLUGS = new Map();
for (const t of TEAS) {
  let s = slugOf(t);
  if ([...TEA_SLUGS.values()].includes(s)) s = slugify(t.name); // «… — кирпич» отличается только хвостом
  if ([...TEA_SLUGS.values()].includes(s)) s += `-${t.id}`;
  TEA_SLUGS.set(t.id, s);
}
export const teaUrl = (t) => `/chai/${TEA_SLUGS.get(t.id)}`;
const teaBySlug = (s) => TEAS.find((t) => TEA_SLUGS.get(t.id) === s);

// Фото: своё фото чая (public/teas/<id>.webp) или общее фото вида
function photoOf(t) {
  for (const ext of ["webp", "jpg", "png"]) if (fs.existsSync(path.join(PUBLIC_DIR, "teas", `${t.id}.${ext}`))) return `/teas/${t.id}.${ext}`;
  for (const ext of ["webp", "jpg", "png"]) if (fs.existsSync(path.join(PUBLIC_DIR, "teas", "kinds", `${t.kind}.${ext}`))) return `/teas/kinds/${t.kind}.${ext}`;
  return "/emblem.jpg";
}
const available = (t) => store.availability()[t.id] !== false;

// Виды для каталога и главной: в порядке, удобном для знакомства
const KIND_ORDER = ["gaba", "light_oolong", "dark_oolong", "dancong", "red", "sheng", "shu", "puer", "heicha"];
const KIND_TEXT = {
  gaba: "Мягкие сладкие улуны с Тайваня: печёные фрукты, мёд, кислинка.",
  light_oolong: "Свежие, цветочные, с мягкой сладостью.",
  dark_oolong: "Обжаренные улуны гор Уишань: тепло, орехи, печёные фрукты.",
  dancong: "Яркий аромат мёда, орхидеи и цветов цитрусовых.",
  red: "Мёд, солод, хлеб. Почти не горчит — хорош для начала.",
  sheng: "Молодой бодрый пуэр: травы, фрукты, лёгкая терпкость.",
  shu: "Тёмный тёплый пуэр: дерево, орехи, земля.",
  puer: "Пуэры с выдержкой и по годам.",
  heicha: "Тёмные чаи Любао из Гуанси: мягкие, густые, с древесными нотами.",
};
const KIND_SLUG = { gaba: "gaba", light_oolong: "svetlyj-ulun", dark_oolong: "temnyj-ulun", dancong: "dancun", red: "krasnyj-chaj", sheng: "shen-puer", shu: "shu-puer", puer: "puer", heicha: "heicha" };

// ---------- общий каркас ----------
function layout({ title, description, canonical, image = "/emblem.jpg", jsonld = [], body, type = "website" }) {
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", name: BRAND, url: abs("/"), logo: abs("/emblem.jpg"), sameAs: [CHANNEL, INSTAGRAM, BOT] },
    ...jsonld,
  ];
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(canonical))}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(canonical))}">
<meta property="og:image" content="${esc(abs(image))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#100f15">
<link rel="icon" href="/emblem.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Prata&display=swap">
<link rel="stylesheet" href="/site.css">
${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}
<script>
// Telegram открыл старую ссылку на главную — ведём сразу в магазин
if (/tgWebAppData/.test(location.hash)) location.replace("/" + location.search + location.hash);
</script>
</head>
<body>
<header class="hd"><div class="wrap hd-in">
  <nav class="menu" aria-label="Разделы">
    <a href="/">Каталог</a><a href="/#quiz">Подбор</a><a href="/#sets">Наборы</a><a href="/blog">Блог</a>
  </nav>
  <a class="logo" href="/"><img src="/emblem.jpg" alt="Синица — логотип" width="44" height="44"><span>Синица</span></a>
  <a class="btn sm hd-cart" href="/#cart">Корзина</a>
</div></header>
<main>${body}</main>
<footer class="ft"><div class="wrap ft-in">
  <div><a class="logo" href="/"><img src="/emblem.jpg" alt="" width="36" height="36"><span>Синица</span></a>
    <p class="muted small">Китайский чай с доставкой по России.<br>Каждый чай можно взять по 20 г на пробу.</p></div>
  <div class="ft-col"><b>Покупателям</b><a href="/">Каталог</a><a href="/#quiz">Подбор чая</a><a href="/#sets">Наборы</a><a href="/chai">Все чаи списком</a></div>
  <div class="ft-col"><b>Блог</b><a href="/blog">Все статьи</a>${ARTICLES.slice(0, 3).map((a) => `<a href="/blog/${a.slug}">${esc(a.h1.split(":")[0])}</a>`).join("")}</div>
  <div class="ft-col"><b>Мы на связи</b>${peopleLinks()}<a href="mailto:${esc(LEGAL.email)}">${esc(LEGAL.email)}</a><a href="${BOT}">Telegram-бот @sinitsa_chai_bot</a><a href="${CHANNEL}">Канал о чае</a><a href="${INSTAGRAM}">Instagram</a></div>
</div><div class="wrap ft-legal small muted">
  <a href="/terms">Условия доставки и возврата</a> · <a href="/privacy">Политика конфиденциальности</a> · <a href="/consent">Согласие на обработку данных</a>
</div></footer>
</body>
</html>`;
}

const crumbs = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(url) })),
});
const crumbsHTML = (items) => `<nav class="crumbs small" aria-label="Навигация">${items
  .map(([name, url], i) => (i < items.length - 1 ? `<a href="${url}">${esc(name)}</a> <span aria-hidden="true">/</span> ` : `<span>${esc(name)}</span>`))
  .join("")}</nav>`;

function teaCard(t, { h = "h3" } = {}) {
  const off = !available(t);
  return `<a class="card" href="${teaUrl(t)}">
    <img src="${photoOf(t)}" alt="${esc(t.name)} — ${esc(KINDS[t.kind].label.toLowerCase())}" loading="lazy" width="400" height="400">
    <span class="card-b"><span class="tag">${esc(KINDS[t.kind].label)}</span>
    <${h}>${esc(t.name)}</${h}>
    <span class="muted small">${esc(t.notes)}</span>
    <span class="price">${off ? `<span class="muted">нет в наличии</span>` : `от ${rub(t.prices["20"])} <small>за 20 г</small>`}</span></span>
  </a>`;
}

function articleCard(a) {
  return `<a class="post" href="/blog/${a.slug}">
    <img src="${esc(a.cover)}" alt="${esc(a.h1)}" loading="lazy" width="600" height="400">
    <span class="post-b">${a.region ? `<span class="tag">${esc(a.region)}</span>` : `<span class="tag">Обзор</span>`}
    <h3>${esc(a.h1)}</h3><span class="muted small">${esc(a.description)}</span>
    <span class="btn sm ghost post-go">Читать статью →</span></span></a>`;
}

// ---------- главная = магазин ----------
// Главная — это сам магазин (public/index.html, тот же, что в Telegram): каталог с фильтрами,
// карточка чая, подбор, наборы, корзина и заказы — без переходов на другие страницы.
// Здесь добавляем к нему то, что нужно только сайту: заголовок для поиска, доставку, вопросы, подвал.
const FAQ = [
  ["Как оплатить заказ?", "После того как мы подтвердим наличие, пришлём сумму и реквизиты. Оплата переводом по СБП. Ничего не нужно платить заранее, пока мы не подтвердили заказ."],
  ["Сколько стоит доставка?", `ПВЗ Яндекс Маркета и Ozon — 290 ₽, СДЭК и Почта России — 450 ₽. Цена одна для любого города. От ${rub(FREE_DELIVERY_FROM)} доставка бесплатная любой службой.`],
  ["Сколько идёт посылка?", "Обычно 2–4 рабочих дня по Москве, Петербургу и центральной России и 5–10 дней в другие регионы."],
  ["Можно сначала попробовать?", "Да. Любой чай можно взять по 20 г, а ещё есть наборы из 3–6 чаёв со скидкой 10%."],
  ["Не знаю, какой чай выбрать", "Пройдите подбор: несколько вопросов о том, что вам нравится, — и мы предложим 1–3 чая. Или напишите нам в Telegram, подскажем лично."],
  ["Можно заказать без Telegram?", "Да, прямо на сайте. Оставьте телефон и выберите, как с вами связаться: Telegram, WhatsApp или звонок."],
];

function siteFooter() {
  return `<footer class="s-ft site-only"><div class="s-ft-in">
  <div><a class="brand" href="/"><img src="/emblem.jpg" alt="" width="36" height="36"><span>Синица</span></a>
    <p class="muted small">Китайский чай с доставкой по России.<br>Каждый чай можно взять по 20 г на пробу.</p></div>
  <div class="s-col"><b>Покупателям</b><a href="/#catalog">Каталог</a><a href="/#quiz">Подбор чая</a><a href="/#sets">Наборы</a><a href="/#cart">Корзина</a></div>
  <div class="s-col"><b>Блог</b><a href="/blog">Все статьи</a>${ARTICLES.slice(0, 3).map((a) => `<a href="/blog/${a.slug}">${esc(a.h1.split(":")[0])}</a>`).join("")}</div>
  <div class="s-col"><b>Мы на связи</b>${peopleLinks()}<a href="mailto:${esc(LEGAL.email)}">${esc(LEGAL.email)}</a><a href="${BOT}">Telegram-бот @sinitsa_chai_bot</a><a href="${CHANNEL}">Канал о чае</a><a href="${INSTAGRAM}">Instagram</a></div>
</div><p class="s-legal small muted"><a href="/terms">Условия доставки и возврата</a> · <a href="/privacy">Политика конфиденциальности</a> · <a href="/consent">Согласие на обработку данных</a></p></footer>`;
}

function homePage() {
  const title = "Китайский чай с доставкой по России — Синица";
  const description = "Улуны, ГАБА, пуэр и красный чай из Китая и с Тайваня. Пробники по 20 г, подбор чая по вкусу, наборы со скидкой, доставка по России. Заказ прямо на сайте.";
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", name: BRAND, url: abs("/"), logo: abs("/emblem.jpg"), sameAs: [CHANNEL, INSTAGRAM, BOT] },
    { "@context": "https://schema.org", "@type": "WebSite", name: BRAND, url: abs("/") },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs("/"))}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs("/"))}">
<meta property="og:image" content="${esc(abs("/blog/teguanin.webp"))}">
${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}`;

  const top = `<section class="s-hero site-only home-only"><div class="s-hero-txt">
  <span class="eyebrow">Китайский чай · доставка по России</span>
  <h1>Китайский чай с доставкой: улуны, ГАБА, пуэр и красный чай</h1>
  <p>Чай из Фуцзяни, Гуандуна, Юньнани и с Тайваня. Каждый можно взять по 20 г на пробу. Выберите ниже — или подберём по вкусу за минуту.</p>
  <div class="s-row"><a class="btn" href="#quiz">🍵 Подобрать мой чай</a><a class="btn ghost" href="#sets">Наборы −10%</a></div>
</div><div class="sc" id="showcase" aria-label="Наши предложения"></div></section>`;

  const bottom = `<div class="s-blocks site-only home-only">
<section id="kak-zakazat"><h2>Как заказать</h2>
  <ol class="s-steps">
    <li><b>Положите чай в корзину</b><span>Нажмите на чай, выберите вес — 20, 50 или 100 г.</span></li>
    <li><b>Оформите заказ</b><span>Имя, телефон и пункт выдачи. Выберите, как с вами связаться: Telegram, WhatsApp или звонок.</span></li>
    <li><b>Подтвердим и отправим</b><span>Проверим наличие, пришлём сумму и реквизиты. После оплаты отправим в тот же день или на следующий.</span></li>
  </ol>
  <p class="muted small">Удобнее в Telegram? Тот же магазин есть в боте <a href="${BOT}">@sinitsa_chai_bot</a> — там же статусы заказа.</p>
</section>
<section id="dostavka"><h2>Доставка и оплата</h2>
  <div class="s-dl">${Object.values(DELIVERY).map((d) => `<div><b>${esc(d.label)}</b><span>${rub(d.price)}</span><small class="muted">${esc(d.note)}</small></div>`).join("")}</div>
  <p>🎁 От ${rub(FREE_DELIVERY_FROM)} доставка бесплатная любой службой. Отправляем по всей России. Чай собираем под заказ, оплата — переводом после подтверждения. <a href="/terms">Условия доставки и возврата</a>.</p>
</section>
<section><div class="s-head"><h2>О чае: где он растёт</h2><a href="/blog">Все статьи →</a></div>
  <div class="s-posts">${ARTICLES.slice(0, 3).map((a) => `<a class="s-post" href="/blog/${a.slug}"><img src="${esc(a.cover)}" alt="${esc(a.h1)}" loading="lazy" width="600" height="400"><span><b>${esc(a.h1)}</b><small class="muted">${esc(a.description)}</small><em class="s-post-go">Читать →</em></span></a>`).join("")}</div>
</section>
<section class="s-faq"><h2>Частые вопросы</h2>
  ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
</section>
</div>
${siteFooter()}`;

  const tpl = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  return tpl.replace(/<title>.*?<\/title>/, head).replace("<!--SITE_TOP-->", top).replace("<!--SITE_BOTTOM-->", bottom);
}

// ---------- каталог ----------
function catalogPage() {
  const kinds = KIND_ORDER.filter((k) => TEAS.some((t) => t.kind === k));
  const body = `<div class="wrap sec">
  ${crumbsHTML([["Главная", "/"], ["Каталог чая", "/chai"]])}
  <h1>Каталог китайского чая</h1>
  <p class="lead">${TEAS.length} чаёв: улуны, ГАБА, красный чай и пуэр. Цены за 20 г — столько хватит на несколько чаепитий, чтобы понять, ваш ли это чай.</p>
  <div class="chips">${kinds.map((k) => `<a class="chip" href="#${KIND_SLUG[k]}">${esc(KINDS[k].label)}</a>`).join("")}<a class="chip gold" href="/#quiz">🍵 Подбор</a></div>
  ${kinds.map((k) => `<section class="kind-sec" id="${KIND_SLUG[k]}"><h2>${esc(KINDS[k].label)}</h2><p class="muted">${esc(KIND_TEXT[k])}</p>
    <div class="grid">${TEAS.filter((t) => t.kind === k).sort((a, b) => available(b) - available(a)).map((t) => teaCard(t)).join("")}</div></section>`).join("")}
</div>`;
  return layout({
    title: "Каталог китайского чая: улуны, ГАБА, пуэр — Синица",
    description: `Каталог: ${TEAS.length} китайских и тайваньских чаёв — ГАБА, светлые и тёмные улуны, Дань Цун, красный чай, шэн и шу пуэр. Пробники по 20 г, доставка по России.`,
    canonical: "/chai",
    jsonld: [
      crumbs([["Главная", "/"], ["Каталог чая", "/chai"]]),
      { "@context": "https://schema.org", "@type": "ItemList", itemListElement: TEAS.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: abs(teaUrl(t)), name: t.name })) },
    ],
    body,
  });
}

// ---------- страница чая ----------
function teaPage(t) {
  const k = KINDS[t.kind];
  const r = RECIPES[t.kind];
  const off = !available(t);
  const short = t.name.split(" — ")[0];
  const related = ARTICLES.filter((a) => a.teas.includes(t.id));
  const similar = TEAS.filter((x) => x.kind === t.kind && x.id !== t.id && available(x)).slice(0, 3);
  const trail = [["Главная", "/"], ["Каталог чая", "/chai"], [k.label, `/chai#${KIND_SLUG[t.kind]}`], [short, teaUrl(t)]];
  const body = `<div class="wrap sec">
  ${crumbsHTML(trail)}
  <div class="tea">
    <img class="tea-img" src="${photoOf(t)}" alt="${esc(t.name)} — ${esc(k.label.toLowerCase())}" width="560" height="560">
    <div>
      <span class="tag">${esc(k.label)}</span>
      <h1>${esc(t.name)}</h1>
      <p class="muted">📍 ${esc(t.region)} · крепость: ${esc(t.strengthLabel.toLowerCase())}</p>
      <p class="lead">${esc(t.notes)}</p>
      <p>${esc(t.effect.text)}</p>
      <table class="prices"><thead><tr><th>Вес</th><th>Цена</th></tr></thead><tbody>
        ${["20", "50", "100"].map((p) => `<tr><td>${p} г</td><td>${rub(t.prices[p])}</td></tr>`).join("")}</tbody></table>
      ${off ? `<p class="warn">Сейчас нет в наличии. Напишите нам — сообщим, когда появится, или подскажем похожий.</p>
        <div class="row"><a class="btn ghost" href="${BOT}">Написать в Telegram</a></div>`
      : `<div class="row"><a class="btn" href="/#tea-${t.id}">В корзину</a><a class="btn ghost" href="${BOT}">Заказать в Telegram</a></div>`}
      <p class="small muted">Доставка по России от 290 ₽, от ${rub(FREE_DELIVERY_FROM)} — бесплатно.</p>
    </div>
  </div>

  <section class="sec"><h2>Как заваривать ${esc(short)}</h2>
    <div class="recipe"><div><b>${esc(r[0])}</b><small>чая</small></div><div><b>${esc(r[1])}</b><small>воды</small></div><div><b>${esc(r[2])}</b><small>температура</small></div><div><b>${esc(r[3])}</b><small>первый пролив</small></div></div>
    <p class="muted">Каждую следующую заварку делайте чуть дольше. Если чай стал резким или горчит — сократите время пролива, а не количество чая.</p>
  </section>

  ${related.length ? `<section class="sec"><h2>Почитать об этом чае</h2><div class="posts">${related.map(articleCard).join("")}</div></section>` : ""}
  ${similar.length ? `<section class="sec"><h2>Похожие чаи</h2><div class="grid">${similar.map((x) => teaCard(x)).join("")}</div></section>` : ""}
</div>`;
  const prices = ["20", "50", "100"].map((p) => t.prices[p]);
  return layout({
    title: `${short} — купить, цена от ${rub(t.prices["20"])} | Синица`,
    description: `${t.name}: ${t.notes.replace(/\.$/, "").toLowerCase()}. ${k.label}, ${t.region}. Пробник 20 г — ${rub(t.prices["20"])}, доставка по России.`.slice(0, 200),
    canonical: teaUrl(t),
    image: photoOf(t),
    type: "product",
    jsonld: [
      crumbs(trail),
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: t.name,
        image: abs(photoOf(t)),
        description: `${t.notes} ${t.effect.text}`,
        category: `Китайский чай / ${k.label}`,
        brand: { "@type": "Brand", name: BRAND },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "RUB",
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: 3,
          availability: off ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          url: abs(teaUrl(t)),
        },
      },
    ],
    body,
  });
}

// ---------- блог ----------
function blogPage(region) {
  const list = region ? ARTICLES.filter((a) => a.region === region) : ARTICLES;
  const body = `<div class="wrap sec">
  ${crumbsHTML([["Главная", "/"], ["Блог", "/blog"]])}
  <h1>О чае: где он растёт и как его пить</h1>
  <p class="lead">Рассказываем о чайных регионах Китая и Тайваня, о том, чем отличаются виды чая и как их заваривать.</p>
  <div class="chips"><a class="chip" href="/blog" aria-current="${!region}">Все</a>${REGIONS.map((r) => `<a class="chip" href="/blog?r=${encodeURIComponent(r)}" aria-current="${region === r}">${esc(r)}</a>`).join("")}</div>
  <div class="posts">${list.map(articleCard).join("") || `<p class="muted">Скоро здесь появятся статьи.</p>`}</div>
  <p class="muted">Короткие заметки о чае — в нашем <a href="${CHANNEL}">Telegram-канале</a>.</p>
</div>`;
  return layout({
    title: "Блог о китайском чае: регионы, виды, заваривание — Синица",
    description: "Статьи о китайском чае: где растут улуны, пуэр и красный чай, чем отличаются Фуцзянь, Гуандун, Юньнань и Тайвань, как заваривать.",
    canonical: "/blog",
    jsonld: [crumbs([["Главная", "/"], ["Блог", "/blog"]]), { "@context": "https://schema.org", "@type": "Blog", name: "О чае — блог «Синицы»", url: abs("/blog") }],
    body,
  });
}

function articlePage(a) {
  const teas = a.teas.map((id) => TEAS.find((t) => t.id === id)).filter(Boolean);
  const others = ARTICLES.filter((x) => x.slug !== a.slug).slice(0, 3);
  const trail = [["Главная", "/"], ["Блог", "/blog"], [a.h1, `/blog/${a.slug}`]];
  const date = new Date(a.date + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const body = `<article class="wrap sec article">
  ${crumbsHTML(trail)}
  <h1>${esc(a.h1)}</h1>
  <p class="small muted">${a.region ? `${esc(a.region)} · ` : ""}<time datetime="${a.date}">${date}</time></p>
  <img class="cover" src="${esc(a.cover)}" alt="${esc(a.h1)}" width="1200" height="800">
  <div class="prose">${a.body}</div>
  ${teas.length ? `<section class="sec"><h2>Чай из этой статьи</h2><div class="grid">${teas.map((t) => teaCard(t, { h: "h3" })).join("")}</div></section>` : ""}
  <div class="quiz-cta"><div><h2>Подберём чай под ваш вкус</h2><p class="muted">Несколько вопросов — и 1–3 чая, которые вам подойдут. Каждый можно взять по 20 г.</p></div>
    <div class="row"><a class="btn" href="/#quiz">Подобрать чай</a><a class="btn ghost" href="/">В каталог</a></div></div>
  <section class="sec"><h2>Ещё о чае</h2><div class="posts">${others.map(articleCard).join("")}</div></section>
</article>`;
  return layout({
    title: a.title,
    description: a.description,
    canonical: `/blog/${a.slug}`,
    image: a.cover,
    type: "article",
    jsonld: [
      crumbs(trail),
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: a.h1,
        description: a.description,
        image: abs(a.cover),
        datePublished: a.date,
        dateModified: a.updated || a.date,
        author: { "@type": "Organization", name: BRAND },
        publisher: { "@type": "Organization", name: BRAND, logo: { "@type": "ImageObject", url: abs("/emblem.jpg") } },
        mainEntityOfPage: abs(`/blog/${a.slug}`),
      },
    ],
    body,
  });
}

// ---------- sitemap и robots ----------
function sitemap() {
  const urls = [
    ["/", "weekly", "1.0"],
    ["/chai", "weekly", "0.9"],
    ...TEAS.map((t) => [teaUrl(t), "weekly", "0.8"]),
    ["/blog", "weekly", "0.7"],
    ...ARTICLES.map((a) => [`/blog/${a.slug}`, "monthly", "0.7", a.updated || a.date]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, f, pr, d]) => `<url><loc>${esc(abs(u))}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}<changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}
</urlset>`;
}
const robots = () => `User-agent: *
Disallow: /api/
Disallow: /export/
Allow: /

Sitemap: ${abs("/sitemap.xml")}
`;

function notFound() {
  return layout({
    title: "Страница не найдена — Синица",
    description: "Такой страницы нет.",
    canonical: "/",
    body: `<div class="wrap sec empty"><h1>Такой страницы нет</h1><p class="muted">Возможно, чай переехал. Загляните в каталог или пройдите подбор.</p>
      <div class="row"><a class="btn" href="/">Каталог</a><a class="btn ghost" href="/#quiz">Подбор</a></div></div>`,
  });
}

/** Страница сайта по адресу или null, если адрес не наш (тогда отдаём файл из public/). */
export function sitePage(pathname, search = new URLSearchParams()) {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { body: homePage() };
  if (p === "/chai") return { body: catalogPage() };
  if (p === "/blog") {
    const r = search.get("r");
    return { body: blogPage(REGIONS.includes(r) ? r : "") };
  }
  if (p === "/sitemap.xml") return { body: sitemap(), type: "application/xml; charset=utf-8" };
  if (p === "/robots.txt") return { body: robots(), type: "text/plain; charset=utf-8" };
  let m = p.match(/^\/chai\/([a-z0-9-]+)$/);
  if (m) {
    const t = teaBySlug(m[1]);
    return t ? { body: teaPage(t) } : { status: 404, body: notFound() };
  }
  m = p.match(/^\/blog\/([a-z0-9-]+)$/);
  if (m) {
    const a = articleBySlug(m[1]);
    return a ? { body: articlePage(a) } : { status: 404, body: notFound() };
  }
  return null;
}
