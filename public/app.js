"use strict";
const tgApp = window.Telegram?.WebApp;
try { tgApp?.ready(); tgApp?.expand(); tgApp?.setHeaderColor?.("#100f15"); tgApp?.setBackgroundColor?.("#100f15"); } catch {}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rub = (n) => n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₽";
const BOT_LINK = "https://t.me/sinitsa_chai_bot";
const SET_DISCOUNT = 0.1;

const S = { teas: [], kinds: {}, recipes: {}, mugRecipes: {}, tastes: {}, sets: [], group: "all", query: "", sort: "pop", cart: [], quiz: null, checkout: false, promo: null, me: null };

// ---------- хранение корзины ----------
function loadCart() { try { S.cart = JSON.parse(localStorage.getItem("cart") || "[]"); } catch { S.cart = []; } }
function saveCart() { try { localStorage.setItem("cart", JSON.stringify(S.cart)); } catch {} updateBadge(); if (typeof renderMiniCart === "function") renderMiniCart(); }
function updateBadge() {
  const n = S.cart.reduce((s, i) => s + (i.removed ? 0 : i.qty), 0);
  const b = $("#cart-count"); b.hidden = !n; b.textContent = n;
}
function toast(text) {
  const t = $("#toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
  try { tgApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", "x-telegram-init-data": tgApp?.initData || "", "x-site-auth": inTelegram() ? "" : S.auth?.token || "", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  // Вход на сайте истёк — выходим, покупатель войдёт заново
  if (res.status === 401 && S.auth && !inTelegram()) { logout(); }
  if (!res.ok) throw new Error(data.error || "Не получилось. Попробуйте ещё раз.");
  return data;
}
const inTelegram = () => !!tgApp?.initData;
// Покупатель известен: открыл магазин в Telegram или вошёл на сайте через Telegram
const authed = () => inTelegram() || !!S.auth?.token;

// ---------- вход на сайте через Telegram ----------
const BOT_NAME = "sinitsa_chai_bot";
function loadAuth() { try { S.auth = JSON.parse(localStorage.getItem("siteAuth") || "null"); } catch { S.auth = null; } }
function saveAuth() { try { S.auth ? localStorage.setItem("siteAuth", JSON.stringify(S.auth)) : localStorage.removeItem("siteAuth"); } catch {} updateAccount(); }
function logout() { S.auth = null; S.me = null; saveAuth(); }
function updateAccount() {
  const a = $("#acc"); if (!a) return;
  a.textContent = S.auth?.user ? `👤 ${S.auth.user.first_name || "Мой профиль"}` : "Войти";
}
const loginBox = (text) => `<div class="login-box site-only"><div><b>Войдите через Telegram</b><small>${text}</small></div><div class="tg-login"></div></div>`;
// Вход через бота: кнопка открывает @бот по одноразовой ссылке, покупатель жмёт «Да, войти» — сайт входит сам
const LOGIN = { code: "", url: "", at: 0, timer: null };
async function loginLink(fresh = false) {
  if (!fresh && LOGIN.code && Date.now() - LOGIN.at < 8 * 60 * 1000) return LOGIN;
  const r = await api("/api/login-link", { method: "POST" });
  Object.assign(LOGIN, { code: r.code, url: r.url, at: Date.now() });
  return LOGIN;
}
function mountLogin() {
  const boxes = [...document.querySelectorAll(".tg-login:empty")];
  if (!boxes.length) return;
  loginLink().then((L) => boxes.forEach((el) => {
    el.innerHTML = `<a class="btn tg-btn" href="${esc(L.url)}" target="_blank" rel="noopener" data-login>✈️ Войти через Telegram</a><small class="login-wait" hidden>Подтвердите вход в боте — эта страница обновится сама</small>`;
  })).catch(() => boxes.forEach((el) => (el.innerHTML = `<small class="muted">Вход сейчас недоступен, попробуйте позже.</small>`)));
}
function pollLogin() {
  clearInterval(LOGIN.timer);
  document.querySelectorAll(".login-wait").forEach((x) => (x.hidden = false));
  const code = LOGIN.code, started = Date.now();
  const check = async () => {
    if (Date.now() - started > 10 * 60 * 1000) return clearInterval(LOGIN.timer);
    try {
      const r = await api(`/api/login-link/${code}`);
      if (r.status === "ok") { clearInterval(LOGIN.timer); LOGIN.code = ""; await onTelegramAuth(null, r); }
      else if (r.status === "expired") { clearInterval(LOGIN.timer); LOGIN.code = ""; document.querySelectorAll(".tg-login").forEach((x) => (x.innerHTML = "")); mountLogin(); }
    } catch {}
  };
  LOGIN.timer = setInterval(check, 2000);
  LOGIN.check = check;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && LOGIN.timer) LOGIN.check?.(); });
document.addEventListener("click", (e) => { if (e.target.closest("[data-login]")) pollLogin(); });
window.onTelegramAuth = async (user, done = null) => {
  try {
    const r = done || await api("/api/login", { method: "POST", body: JSON.stringify(user) });
    S.auth = { token: r.token, user: r.user }; saveAuth();
    await claimLocalOrders();
    api("/api/me").then((me) => (S.me = me)).catch(() => {});
    toast(`Вы вошли, ${r.user.first_name || "добро пожаловать"}!`);
    route();
  } catch (err) { toast(err.message); }
};
// Аналитика: отмечаем шаги, чтобы видеть, где люди уходят. Только в Telegram, тихо, без ожидания ответа.
function track(name, data = "") {
  if (!authed()) return;
  try { fetch("/api/event", { method: "POST", keepalive: true, headers: { "content-type": "application/json", "x-telegram-init-data": tgApp?.initData || "", "x-site-auth": inTelegram() ? "" : S.auth.token }, body: JSON.stringify({ name, data: String(data) }) }).catch(() => {}); } catch {}
}

// ---------- помощники каталога ----------
const tea = (id) => S.teas.find((t) => t.id === Number(id));
function packInfo(t, pack) {
  return { price: t.prices[pack], label: `${pack} г` };
}
// Одно фото на вид чая: каждому чаю показываем свой фрагмент, чтобы карточки не повторялись
const art = (t) => t.photo
  ? `<div class="art photo"><img src="${esc(t.photo)}" alt="${esc(t.name)}" loading="lazy"></div>`
  : `<div class="art"><span aria-hidden="true">${S.kinds[t.kind].glyph}</span></div>`;

// ---------- каталог ----------
const SORTS = [["pop", "Популярные"], ["asc", "Сначала дешевле"], ["desc", "Сначала дороже"], ["new", "Новинки"]];
const GROUPS = [["all", "Все"], ["premium", "✦ Премиум"], ["gaba", "ГАБА"], ["oolong", "Улуны"], ["red", "Красный чай"], ["puer", "Пуэры и хэйча"]];
function renderCatalog() {
  let list = S.teas.filter((t) =>
    (S.group === "all" || (S.group === "premium" ? t.premium : S.kinds[t.kind].group === S.group)) &&
    (!S.query || `${t.name} ${t.notes} ${S.kinds[t.kind].label} ${t.region}`.toLowerCase().includes(S.query)));
  if (S.sort === "asc") list = [...list].sort((a, b) => a.prices["50"] - b.prices["50"]);
  if (S.sort === "desc") list = [...list].sort((a, b) => b.prices["50"] - a.prices["50"]);
  if (S.sort === "new") list = [...list].sort((a, b) => b.id - a.id); // новые чаи добавляем в конец каталога
  list = [...list].sort((a, b) => b.available - a.available);
  // На сайте свой заголовок над каталогом (для поиска), этот — только в Telegram
  const showTop = inTelegram() && !S.query && S.group === "all";
  $("#view").innerHTML = `${showTop ? `<div class="sc sc-tg" id="showcase-tg"></div>` : ""}${inTelegram() ? `
    <section class="hero">
      <div class="eyebrow">Китайский чай. Свой ритм.</div>
      <h1>Хороший чай. <em>Время для себя.</em></h1>
      <p>Тёплая чашка, глубокий вкус и немного времени для себя. Каждый чай можно взять по 20 г на пробу.</p>
      <a class="btn" href="#quiz">🍵 Подобрать мой чай</a>
    </section>` : ""}
    <label class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Найти свой чай" value="${esc(S.query)}" autocomplete="off"></label>
    <div class="chips scroll" id="groups">${GROUPS.map(([k, l]) => `<button class="chip" data-g="${k}" aria-pressed="${S.group === k}">${l}</button>`).join("")}</div>
    <div class="chips scroll sorts" id="sorts" aria-label="Сортировка">${SORTS.map(([k, l]) => `<button class="chip" data-sort="${k}" aria-pressed="${S.sort === k}">${l}</button>`).join("")}</div>
    <p class="note">${list.length} из ${S.teas.length} · цены за 50 г · собираем под заказ</p>
    <div class="cat-wrap"><div class="grid">${list.length ? list.map(cardHTML).join("") : `<p class="muted">Ничего не нашли. Попробуйте другое слово.</p>`}</div>
    <aside class="mini-cart" id="mini-cart" aria-label="Ваша корзина"></aside></div>
    <div class="opt-box"><span>🧑‍💼</span><span><b>Покупаете оптом?</b><small>Для кофейни, магазина или подарков — обсудим цены лично, в Москве можно встретиться и попробовать.</small></span><button class="btn ghost" data-opt="0">Я оптовик</button></div>`;
  if (inTelegram()) mountPromo();
  renderMiniCart();
  $("#q").addEventListener("input", (e) => { S.query = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; renderCatalog(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); });
  $("#sorts").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.sort = b.dataset.sort; renderCatalog();
  });
  $("#groups").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.group = b.dataset.g;
    renderCatalog();
  });
}
const SET_PACKS = ["20", "50", "100"];
function setPrice(set, pack = "20") {
  const sum = set.teas.reduce((s, id) => s + (tea(id)?.prices[pack] || 0), 0);
  return { sum, final: sum - Math.round((sum * SET_DISCOUNT) / 10) * 10 };
}
function renderSets() {
  S.setPack ||= {};
  if (S.builder) return renderBuilder();
  $("#view").innerHTML = `<h2 class="section-title">Наборы</h2>
    <p class="note" style="margin-top:0">Три разных чая одной фасовки — 20, 50 или 100 г. Скидка 10% на любой набор.</p>
    <button class="sets-banner build-start" id="build"><span>✋</span><span><b>Собрать свой набор</b><small>Выберите от 3 до 6 любых чаёв — скидка та же, 10%</small></span><span class="more-price">→</span></button>
    ${S.sets.length ? `<div class="sets-list">${S.sets.map((set) => {
      const pack = S.setPack[set.key] || "20";
      const p = setPrice(set, pack);
      return `<div class="set"><div class="set-e">${set.emoji}</div><h3>${esc(set.title)}</h3><p class="muted small">${esc(set.text)}</p>
        <div class="set-teas">${set.teas.map((id) => `<button class="set-tea" data-tea="${id}">${esc(tea(id)?.name || "")}</button>`).join("")}</div>
        <div class="chips sizes" data-set-packs="${set.key}">${SET_PACKS.map((x) => `<button class="chip" data-p="${x}" aria-pressed="${x === pack}">по ${x} г</button>`).join("")}</div>
        <div class="big-price" style="font-size:22px">${rub(p.final)} <small><s>${rub(p.sum)}</s></small></div>
        <button class="btn wide" data-set="${set.key}">В корзину · ${set.teas.length} × ${pack} г</button></div>`;
    }).join("")}</div>` : `<p class="muted">Сейчас наборы собрать не из чего — часть чаёв закончилась. Загляните в каталог.</p>`}`;
  $("#build").onclick = () => { track("builder_open"); S.builder = { ids: [], pack: "20" }; renderSets(); scrollTo(0, 0); };
  $("#view").onclick = (e) => {
    const b = e.target.closest("[data-set-packs] [data-p]"); if (!b) return;
    S.setPack[b.parentElement.dataset.setPacks] = b.dataset.p;
    const y = scrollY; renderSets(); scrollTo(0, y);
  };
}
// Свой набор: 3–6 разных чаёв, одна фасовка, скидка как у готовых
const BUILD_MIN = 3, BUILD_MAX = 6;
function renderBuilder() {
  const B = S.builder;
  const teas = S.teas.filter((t) => t.available && t.prices[B.pack] != null);
  B.ids = B.ids.filter((id) => teas.some((t) => t.id === id));
  const sum = B.ids.reduce((s, id) => s + tea(id).prices[B.pack], 0);
  const ok = B.ids.length >= BUILD_MIN && B.ids.length <= BUILD_MAX;
  const final = ok ? sum - Math.round((sum * SET_DISCOUNT) / 10) * 10 : sum;
  const groups = GROUPS.filter(([k]) => k !== "all" && k !== "premium").map(([k, l]) => [l, teas.filter((t) => S.kinds[t.kind].group === k)]).filter(([, l]) => l.length);
  const hint = B.ids.length < BUILD_MIN ? `Выберите ещё ${BUILD_MIN - B.ids.length} — и скидка 10% включится` : B.ids.length === BUILD_MAX ? "Максимум 6 чаёв в наборе" : "Скидка 10% включена";
  $("#view").innerHTML = `<button class="link" id="build-back">← Все наборы</button>
    <h2 class="section-title" style="padding-top:4px">Свой набор</h2>
    <p class="note" style="margin-top:0">От 3 до 6 разных чаёв, все одной фасовки.</p>
    <div class="chips sizes" id="build-packs">${SET_PACKS.map((x) => `<button class="chip" data-p="${x}" aria-pressed="${x === B.pack}">по ${x} г</button>`).join("")}</div>
    ${groups.map(([label, list]) => `<div class="eyebrow" style="margin:16px 0 8px">${esc(label)}</div>
      ${list.map((t) => { const on = B.ids.includes(t.id); return `<button class="more-row build-row" data-pick="${t.id}" aria-pressed="${on}" ${!on && B.ids.length >= BUILD_MAX ? "disabled" : ""}>
        <span class="tick">${on ? "✓" : ""}</span><span><b>${esc(t.name)}</b><small>${esc(t.notes)}</small></span><span class="more-price">${rub(t.prices[B.pack])}</span></button>`; }).join("")}`).join("")}
    <div class="build-bar"><div><div class="muted small">${B.ids.length} из ${BUILD_MIN}–${BUILD_MAX} · ${hint}</div>
      <div class="big-price" style="font-size:22px">${rub(final)}${ok && sum !== final ? ` <small><s>${rub(sum)}</s></small>` : ""}</div></div>
      <button class="btn" id="build-add" ${ok ? "" : "disabled"}>В корзину</button></div>`;
  $("#build-back").onclick = () => { S.builder = null; renderSets(); };
  $("#build-packs").onclick = (e) => { const b = e.target.closest("[data-p]"); if (!b) return; B.pack = b.dataset.p; const y = scrollY; renderBuilder(); scrollTo(0, y); };
  $("#view").onclick = (e) => {
    const r = e.target.closest("[data-pick]"); if (!r || r.disabled) return;
    const id = Number(r.dataset.pick);
    B.ids = B.ids.includes(id) ? B.ids.filter((x) => x !== id) : [...B.ids, id];
    const y = scrollY; renderBuilder(); scrollTo(0, y);
  };
  $("#build-add").onclick = () => {
    const set = "own-" + Date.now().toString(36);
    B.ids.forEach((teaId) => S.cart.push({ teaId, pack: B.pack, qty: 1, set }));
    saveCart(); toast(`Ваш набор (${B.ids.length} × ${B.pack} г) в корзине`); track("cart_add", `свой набор · ${B.ids.length} × ${B.pack} г`); S.builder = null; location.hash = "#cart";
  };
}

function addSet(key) {
  const set = S.sets.find((s) => s.key === key); if (!set) return;
  const pack = S.setPack?.[key] || "20";
  const id = `${key}-${Date.now().toString(36)}`;
  set.teas.forEach((teaId) => S.cart.push({ teaId, pack, qty: 1, set: id }));
  saveCart(); toast(`Набор «${set.title}» по ${pack} г в корзине`);
  track("cart_add", `набор «${set.title}» · ${pack} г`);
}
// ---------- карусель на главной: гусеничный чай, наборы, премиум ----------
function promoSlides() {
  const out = [];
  const t = S.teas.filter((x) => x.unusual && x.available).sort((a, b) => a.prices["20"] - b.prices["20"])[0];
  if (t) out.push({ cls: "cat", attr: `data-tea="${t.id}"`, img: `<img src="/promo/caterpillar.svg" alt="Гусеница на чайном листе и горка тёмных гранул чая" width="800" height="500">`,
    eye: "🐛 Самый необычный чай", title: "Чай, который сделали гусеницы",
    text: "Гусеницы едят чайный лист, а из их гранул получается густой сладкий настой. Звучит странно — вкус удивляет.", cta: `Попробовать — от ${rub(t.prices["20"])}` });
  if (S.sets.length) {
    const from = Math.min(...S.sets.map((x) => setPrice(x).final));
    const pics = ["gaba", "shu", "dark_oolong"];
    out.push({ cls: "sets", attr: `data-promo="sets"`, img: `<div class="sc-sets">${pics.map((k) => `<img src="/teas/kinds/${k}.webp" alt="" loading="lazy">`).join("")}<b>−10%</b></div>`,
      eye: "🎁 Наборы чая", title: "Три чая в одной коробке — скидка 10%",
      text: "ГАБА, пуэры, улуны по 20, 50 или 100 г. Или соберите свой набор из любых 3–6 чаёв.", cta: `Наборы — от ${rub(from)}` });
  }
  if (S.teas.some((x) => x.premium && x.available)) out.push({ cls: "prem", attr: `data-promo="premium"`,
    img: `<img src="/teas/kinds/dark_oolong.webp" alt="Тёмный утёсный улун" loading="lazy">`,
    eye: "✦ Премиум", title: "Редкие чаи для особого случая",
    text: "Утёсные улуны Уишань со старых кустов, выдержанные пуэры и хэйча Любао.", cta: "Смотреть премиум" });
  return out;
}
let promoTimer = null;
function mountPromo() {
  const box = inTelegram() ? $("#showcase-tg") : $("#showcase"); if (!box) return;
  clearInterval(promoTimer);
  const slides = promoSlides();
  if (!slides.length) { box.hidden = true; return; }
  box.innerHTML = `<div class="sc-track">${slides.map((x, i) => `<button class="sc-slide ${x.cls}" ${x.attr} aria-roledescription="слайд" aria-label="${i + 1} из ${slides.length}: ${esc(x.title)}"${i ? ' tabindex="-1"' : ""}>
      <span class="sc-img">${x.img}</span>
      <span class="sc-txt"><small>${x.eye}</small><b>${esc(x.title)}</b><span>${esc(x.text)}</span><em>${x.cta} →</em></span></button>`).join("")}</div>
    ${slides.length > 1 ? `<div class="sc-nav"><button class="sc-arr prev" aria-label="Назад">‹</button><button class="sc-arr next" aria-label="Вперёд">›</button></div>
    <div class="sc-dots">${slides.map((_, i) => `<button aria-label="Слайд ${i + 1}" data-i="${i}"></button>`).join("")}</div>` : ""}`;
  box.setAttribute("aria-roledescription", "карусель");
  const track_ = box.querySelector(".sc-track");
  let cur = 0, paused = false;
  const go = (i) => {
    cur = (i + slides.length) % slides.length;
    track_.style.transform = `translateX(${-cur * 100}%)`;
    box.querySelectorAll(".sc-slide").forEach((el, k) => (el.tabIndex = k === cur ? 0 : -1));
    box.querySelectorAll(".sc-dots button").forEach((d, k) => d.setAttribute("aria-current", k === cur));
  };
  go(0);
  if (slides.length < 2) return;
  box.querySelector(".prev").onclick = () => go(cur - 1);
  box.querySelector(".next").onclick = () => go(cur + 1);
  box.querySelector(".sc-dots").onclick = (e) => { const d = e.target.closest("[data-i]"); if (d) go(Number(d.dataset.i)); };
  box.onmouseenter = () => (paused = true); box.onmouseleave = () => (paused = false);
  box.onfocusin = () => (paused = true); box.onfocusout = () => (paused = false);
  // листание пальцем
  let x0 = null, moved = false;
  box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; moved = false; paused = true; }, { passive: true });
  box.addEventListener("touchmove", (e) => { if (x0 !== null && Math.abs(e.touches[0].clientX - x0) > 10) moved = true; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    const dx = (e.changedTouches[0]?.clientX ?? x0) - x0; x0 = null;
    if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
    setTimeout(() => (paused = false), 4000);
  });
  box.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    promoTimer = setInterval(() => { if (!paused && !document.hidden && document.body.contains(box)) go(cur + 1); }, 5500);
}
function openPromo(kind) {
  track("promo", kind);
  if (kind === "sets") { location.hash = "#sets"; return; }
  S.group = "premium"; S.query = "";
  if ((location.hash || "#catalog") !== "#catalog") location.hash = "#catalog"; else renderCatalog();
  setTimeout(() => $("#groups")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}
function cardHTML(t) {
  return `<article class="card${t.available ? "" : " off"}" data-tea="${t.id}" role="button" tabindex="0" aria-label="${esc(t.name)}">${art(t)}
    <div class="card-body"><span class="type">${t.premium ? `<b class="prem">✦ Премиум</b> · ` : ""}${esc(S.kinds[t.kind].label)}</span><h3>${esc(t.name)}</h3>
    <div class="price">${t.available ? rub(t.prices["50"]) : "Нет в наличии"}<small>${t.available ? "50 г" : ""}</small></div>
    ${t.available ? `<div class="qc" data-qc="${t.id}">${qcHTML(t)}</div>` : ""}</div></article>`;
}
// Управление корзиной прямо на карточке: «В корзину» → выбор веса 20/50/100 → «− 2 +»
const QC = { open: null, pack: {} };
function qcLine(t) {
  const lines = S.cart.filter((i) => !i.removed && !i.set && i.teaId === t.id && !i.variant);
  return lines.find((i) => i.pack === QC.pack[t.id]) || lines[lines.length - 1] || null;
}
function qcHTML(t) {
  if (QC.open === t.id) {
    return `<div class="qc-packs" role="group" aria-label="Выберите вес">${["20", "50", "100"].map((p) => `<button data-qc-pack="${p}"><b>${p} г</b><small>${rub(t.prices[p])}</small></button>`).join("")}<button class="qc-x" data-qc-close aria-label="Отмена">×</button></div>`;
  }
  const line = qcLine(t);
  if (line) {
    const other = S.cart.filter((i) => !i.removed && i.teaId === t.id && i !== line).reduce((n, i) => n + i.qty, 0);
    return `<div class="qc-step"><button data-qc-minus aria-label="Меньше">−</button><span><b>${line.qty}</b> × ${line.pack} г</span><button data-qc-plus aria-label="Больше">+</button></div>
      <button class="qc-more" data-qc-open>${other ? `ещё ${other} в корзине · ` : ""}другой вес</button>`;
  }
  return `<button class="quick" data-qc-open>В корзину</button>`;
}
function qcRefresh(id) { const t = tea(id); if (t) document.querySelectorAll(`[data-qc="${id}"]`).forEach((el) => (el.innerHTML = qcHTML(t))); }
function qcClick(e, box) {
  const id = Number(box.dataset.qc), t = tea(id); if (!t) return;
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-qc-open")) {
    if (t.variants?.length) return openTea(id);
    const prev = QC.open; QC.open = id; if (prev) qcRefresh(prev);
  } else if (b.hasAttribute("data-qc-close")) {
    QC.open = null;
  } else if (b.dataset.qcPack) {
    QC.open = null; QC.pack[id] = b.dataset.qcPack;
    addToCart(id, b.dataset.qcPack, 1);
  } else if (b.hasAttribute("data-qc-plus") || b.hasAttribute("data-qc-minus")) {
    const line = qcLine(t); if (!line) return;
    if (b.hasAttribute("data-qc-plus")) line.qty = Math.min(20, line.qty + 1);
    else if (--line.qty <= 0) S.cart.splice(S.cart.indexOf(line), 1);
    saveCart();
  }
  qcRefresh(id);
}
// Корзина рядом с каталогом: на компьютере — колонка справа, на телефоне — полоса над меню
function renderMiniCart() {
  const box = $("#mini-cart"); if (!box) return;
  const { lines, discount, promoOff, total } = cartLines();
  document.body.classList.toggle("has-cart", lines.length > 0);
  if (!lines.length) {
    box.innerHTML = `<div class="mc-empty"><b>Корзина пока пуста</b><span>Нажмите «В корзину» на любом чае — он появится здесь вместе с суммой.</span><a class="btn ghost wide" href="#quiz">🍵 Подобрать чай</a></div>`;
    return;
  }
  const count = lines.reduce((n, l) => n + l.i.qty, 0);
  const left = S.freeFrom ? S.freeFrom - total : 0;
  box.innerHTML = `<div class="mc-head"><b>Ваш заказ</b><span>${count} ${plural(count, "позиция", "позиции", "позиций")}</span></div>
    <ul class="mc-list">${lines.map((l) => `<li><span class="mc-name">${esc(l.t.name)}${l.i.variant ? ` — ${esc(l.i.variant)}` : ""}<small>${esc(l.label)} × ${l.i.qty}${l.i.set ? " · набор" : ""}</small></span><span class="mc-sum">${rub(l.sum)}</span><button class="mc-del" data-mc-del="${l.idx}" aria-label="Убрать ${esc(l.t.name)}">×</button>${l.i.set ? "" : `<span class="mc-step"><button data-mc-qty="-1" data-i="${l.idx}" aria-label="Меньше">−</button><b>${l.i.qty}</b><button data-mc-qty="1" data-i="${l.idx}" aria-label="Больше">+</button></span>`}</li>`).join("")}</ul>
    ${discount ? `<div class="mc-row"><span>Скидка на набор</span><span>−${rub(discount)}</span></div>` : ""}
    ${promoOff ? `<div class="mc-row"><span>Промокод</span><span>−${rub(promoOff)}</span></div>` : ""}
    <div class="mc-total"><span>Итого</span><b>${rub(total)}</b></div>
    ${S.freeFrom ? `<p class="mc-free">${left <= 0 ? "🎁 Доставка бесплатная" : `🚚 До бесплатной доставки ${rub(left)}`}</p>` : ""}
    <a class="btn wide" href="#cart">Оформить заказ</a>
    <a class="mc-bar" href="#cart"><span>🛒 ${count} · <b>${rub(total)}</b></span><span>Оформить →</span></a>`;
}
function plural(n, a, b, c) { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; }

// ---------- карточка чая ----------
function openTea(id) {
  const t = tea(id); if (!t) return;
  track("tea_open", t.id);
  let pack = "50", qty = 1, variant = "", needVariant = false;
  const vars = t.variants || [];
  const r = S.recipes[t.kind];
  const body = $("#tea-body");
  const draw = () => {
    const p = packInfo(t, pack);
    body.innerHTML = `<button class="close" aria-label="Закрыть">✕</button>${art(t)}
      <span class="type">${t.premium ? `<b class="prem">✦ Премиум</b> · ` : ""}${esc(S.kinds[t.kind].label)} · ${esc(t.region)}</span>
      <h2>${esc(t.name)}</h2><p class="muted">${esc(t.notes)}</p>
      <div class="tags"><span class="tag">Насыщенность: ${esc(t.strengthLabel.toLowerCase())}</span>${t.tastes.map((x) => `<span class="tag">${esc(S.tastes[x])}</span>`).join("")}</div>
      ${t.available ? `${vars.length ? `
      <div class="variants${needVariant ? " need" : ""}" role="group" aria-label="Вариант"><span class="small">Какой выбираете?</span>
        <div class="sizes" style="margin:6px 0 0">${vars.map((v) => `<button class="chip" data-v="${esc(v)}" aria-pressed="${v === variant}">${esc(v)}</button>`).join("")}</div>
        ${needVariant ? `<p class="error" style="margin:6px 0 0">Выберите: ${esc(vars.join(", ").toLowerCase())}</p>` : ""}</div>` : ""}
      <div class="sizes" role="group" aria-label="Фасовка">${["20", "50", "100"].map((k) => `<button class="chip" data-p="${k}" aria-pressed="${k === pack}">${k} г</button>`).join("")}</div>
      <div class="big-price">${rub(p.price * qty)} <small>${esc(p.label)}${qty > 1 ? ` × ${qty}` : ""}</small></div>
      <div class="row-actions"><div class="qty"><button data-q="-1" aria-label="Меньше">−</button><b>${qty}</b><button data-q="1" aria-label="Больше">+</button></div>
      <button class="btn" id="add">В корзину</button></div>
      <p class="muted small" style="margin:10px 0 0">Нужно больше, оптом? <button class="link opt-link" data-opt="${t.id}">Я оптовик</button></p>` : `<p class="error">Сейчас нет в наличии. Напишите нам в бот, сообщим о поступлении.</p>`}
      <div class="block"><h4>Эффект и особенности</h4><p style="margin:0"><b>${esc(t.effect.state)}.</b> ${esc(t.effect.text)}</p>
        <p class="small muted" style="margin:8px 0 0">Ощущения зависят от заваривания и от человека.</p></div>
      <div class="block"><h4>Как заваривать</h4>
        ${r ? `<div class="recipe"><div><span>Проливами</span>${esc(r[0])} на ${esc(r[1])}</div><div><span>Вода</span>${esc(r[2])}</div><div><span>Первый пролив</span>${esc(r[3])}</div><div><span>В кружке</span>${esc(S.mugRecipes[t.kind])}</div></div>` : ""}
      </div>`;
  };
  draw();
  body.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("close")) return $("#tea").close();
    if (b.dataset.v) { variant = b.dataset.v; needVariant = false; draw(); }
    if (b.dataset.p) { pack = b.dataset.p; draw(); }
    if (b.dataset.q) { qty = Math.min(20, Math.max(1, qty + Number(b.dataset.q))); draw(); }
    if (b.id === "add") {
      if (vars.length && !variant) { needVariant = true; draw(); body.querySelector(".variants")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      addToCart(t.id, pack, qty, "", variant); $("#tea").close();
    }
  };
  $("#tea").showModal();
}
$("#tea").addEventListener("click", (e) => { if (e.target.id === "tea") e.target.close(); });

function addToCart(teaId, pack, qty, set = "", variant = "") {
  const ex = S.cart.find((i) => i.teaId === teaId && i.pack === pack && (i.set || "") === set && (i.variant || "") === variant);
  if (ex) ex.qty = Math.min(20, ex.qty + qty); else S.cart.push({ teaId, pack, qty, set, ...(variant ? { variant } : {}) });
  saveCart(); toast("Добавлено в корзину");
  track("cart_add", `${tea(teaId)?.name || teaId} · ${pack} г`);
}

// «Я оптовик»: опт не через корзину — сообщаем нам, дальше общаемся лично в чате
async function wholesale(teaId, btn) {
  if (!authed()) { location.href = BOT_LINK; return; }
  btn.disabled = true;
  try {
    const r = await api("/api/wholesale", { method: "POST", body: JSON.stringify({ teaId }) });
    toast(r.repeat ? "Запрос уже у нас — скоро напишем" : "Спасибо! Напишем вам в чате с ботом");
    btn.textContent = "Запрос отправлен ✓";
  } catch (err) { toast(err.message); btn.disabled = false; }
}

// ---------- подбор ----------
// Вопрос может иметь вариант текста для подарка: gift = { title, hint, labels: {значение: подпись} }
const QUESTIONS = [
  { key: "who", title: "Для кого подбираем чай?", hint: "Подарок подберём так, чтобы понравился даже тому, кто раньше не пил китайский чай", options: [
    ["self", "🙋", "Себе"], ["gift", "🎁", "В подарок"]] },
  { key: "drink", multi: true, exclusive: "none", title: "На что должен быть похож чай, который хочется сейчас?",
    hint: "Покажем китайский чай, близкий по вкусу к выбранному напитку. Можно выбрать несколько", options: [
    ["coffee", "☕", "На кофе", "плотный, с нотами обжарки и шоколада — тёмные улуны, шу пуэр"],
    ["black", "🫖", "На привычный чёрный чай", "мягкий, медовый — красные чаи, ГАБА"],
    ["green", "🍃", "На зелёный чай", "свежий и лёгкий — светлые улуны, Даньцун"],
    ["herbal", "🌼", "На травяной или фруктовый", "сладкий, без горечи — ГАБА, мягкие улуны"],
    ["none", "✨", "Ни на что, хочу новое", "подберём по вкусам из следующих вопросов"]],
    gift: { title: "Что любит пить тот, кому дарите?", hint: "Подберём китайский чай, близкий по вкусу к его любимому напитку. Можно выбрать несколько",
      labels: { coffee: ["Кофе", "подберём плотный чай с нотами обжарки"], black: ["Чёрный чай", "подберём мягкий медовый красный чай"], green: ["Зелёный чай", "подберём свежий светлый улун"], herbal: ["Травяной или фруктовый", "подберём сладкий чай без горечи"], none: ["Не знаю", "подберём универсальный вкус"] } } },
  { key: "time", multi: true, title: "Когда будете пить?", hint: "Утром предложим бодрящий чай, вечером — спокойный. Можно выбрать несколько", options: [
    ["morning", "🌅", "Утром, чтобы проснуться"], ["day", "💻", "Днём, за делами"], ["evening", "🌙", "Вечером, без спешки"], ["food", "🍽", "После еды"]],
    gift: { title: "Когда этот человек обычно пьёт чай?" } },
  { key: "likes", multi: true, exclusive: "any", title: "Какие ноты хочется во вкусе?", hint: "В китайском чае бывают оттенки мёда, фруктов, цветов. Поднимем выше чаи с выбранными нотами. Можно выбрать несколько", options: [
    ["honey", "🍯", "Мёд и выпечка"], ["fruit", "🍑", "Фрукты и сухофрукты"], ["flowers", "🌸", "Цветы"], ["nuts", "🌰", "Орехи и карамель"],
    ["fresh", "🌿", "Свежая зелень"], ["forest", "🌲", "Лес и дерево"], ["spice", "🌶", "Пряности"], ["any", "🤷", "Не знаю, всё подряд"]],
    gift: { title: "Какие вкусы нравятся тому, кому дарите?", labels: { any: ["Не знаю"] } } },
  { key: "dislikes", multi: true, exclusive: "none", title: "Что точно не нравится?", hint: "Можно выбрать несколько. Чаи, где это главное во вкусе, уберём, а где это лишь оттенок — опустим ниже", options: [
    ["bitter", "😖", "Горечь и терпкость"], ["earthy", "🍂", "«Земляной» вкус", "как у тёмного пуэра"], ["strong", "⚡", "Слишком бодрящее"],
    ["flowers", "🌸", "Цветочный, «парфюмерный»"], ["honey", "🍯", "Сладкий, медовый"], ["fruit", "🍑", "Фруктовый, с кислинкой"],
    ["fresh", "🌿", "Травянистый"], ["forest", "🌲", "Древесный"], ["spice", "🌶", "Пряный"],
    ["none", "👌", "Ничего, готов пробовать"]],
    gift: { title: "Что точно не понравится?", labels: { none: ["Не знаю"] } } },
  { key: "brew", title: "Как будете заваривать?", hint: "Некоторые чаи горчат, если долго стоят в кружке, — для кружки их не предложим", options: [
    ["mug", "🫖", "В кружке или заварочном чайнике"], ["gaiwan", "🍶", "В гайвани, проливами", "маленький сосуд, много коротких заварок"], ["unknown", "🤔", "Пока не знаю"]],
    gift: { title: "Как будут заваривать?" } },
];
const LIKE_TO_TASTE = { honey: ["honey", "bread"], fruit: ["fruity"], flowers: ["floral"], nuts: ["nutty"], fresh: ["herbal"], forest: ["woody"], spice: ["spicy"], any: [] };
const DRINK_LIKE = {
  coffee: "Близок к кофе: плотный, с нотами обжарки.",
  black: "Понятный вкус, если привыкли к чёрному чаю.",
  green: "Близок к зелёному чаю: свежий и лёгкий.",
  herbal: "Мягкий и сладкий, как травяной сбор, без горечи.",
};
const isGift = (a) => a.who === "gift";

function newQuiz() { S.quiz = { step: 0, a: { who: "", drink: [], time: [], likes: [], dislikes: [], brew: "" } }; }

function renderQuiz() {
  if (!S.quiz) newQuiz();
  const { step, a } = S.quiz;
  if (step >= QUESTIONS.length) return renderResults();
  const q = QUESTIONS[step];
  if (S.quiz.tracked !== step) { S.quiz.tracked = step; if (step === 0) track("quiz_start"); track("quiz_step", step + 1); }
  const g = isGift(a) && q.gift ? q.gift : {};
  const opts = q.options.filter(([v]) => !(q.key === "dislikes" && a.likes.includes(v))).map(([v, e, l, sub]) => (g.labels?.[v] ? [v, e, g.labels[v][0], g.labels[v][1]] : [v, e, l, sub]));
  const sel = (v) => (q.multi ? a[q.key].includes(v) : a[q.key] === v);
  const ready = q.multi ? a[q.key].length > 0 : !!a[q.key];
  $("#view").innerHTML = `<div class="quiz-head"><div class="quiz-top"><div class="eyebrow">Подбор чая · вопрос ${step + 1} из ${QUESTIONS.length}</div><button class="link quit" id="quit">Выйти</button></div>
    <div class="progress"><i style="width:${(step / QUESTIONS.length) * 100}%"></i></div>
    <h2 class="q-title">${g.title || q.title}</h2><p class="muted small" style="margin:0">${g.hint || q.hint}</p></div>
    <div class="options" id="opts">${opts.map(([v, e, l, sub]) => `<button class="option" data-v="${v}" aria-pressed="${sel(v)}"><span class="e">${e}</span><span>${l}${sub ? `<small>${sub}</small>` : ""}</span></button>`).join("")}</div>
    <div class="quiz-nav">${step ? `<button class="btn ghost" id="back">Назад</button>` : ""}${q.multi ? `<button class="btn" id="next" ${ready ? "" : "disabled"}>Дальше</button>` : ""}</div>`;
  $("#opts").onclick = (e) => {
    const b = e.target.closest(".option"); if (!b) return;
    const v = b.dataset.v;
    if (q.multi) {
      let arr = a[q.key];
      if (v === q.exclusive) arr = arr.includes(v) ? [] : [v];
      else arr = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr.filter((x) => x !== q.exclusive), v];
      a[q.key] = arr;
      if (q.key === "likes") a.dislikes = a.dislikes.filter((d) => !arr.includes(d));
      renderQuiz();
    } else { a[q.key] = v; S.quiz.step++; renderQuiz(); }
  };
  $("#back")?.addEventListener("click", () => { S.quiz.step--; renderQuiz(); });
  $("#next")?.addEventListener("click", () => { S.quiz.step++; renderQuiz(); });
  $("#quit").onclick = quitQuiz;
  // Наверх — только при переходе к новому вопросу, а не при каждом нажатии
  if (S.quiz.shown !== step) { S.quiz.shown = step; window.scrollTo(0, 0); }
}

function quitQuiz() { track("quiz_exit", S.quiz?.step ?? ""); newQuiz(); location.hash = "#catalog"; }

// Отзывы покупателя: «не моё» убирает чай, пожелания сдвигают подбор
function lastWish() { return S.me?.feedback?.find((f) => f.wish)?.wish || ""; }
function feedbackBonus(t) {
  const fb = S.me?.feedback || [];
  if (fb.some((f) => f.rating === "bad" && f.teaIds.includes(t.id))) return -Infinity;
  let b = 0;
  const likedKinds = new Set(fb.filter((f) => f.rating === "good").flatMap((f) => f.teaIds.map((id) => tea(id)?.kind)));
  if (likedKinds.has(t.kind)) b += 2;
  const w = lastWish();
  if (w === "stronger") b += (t.quiz.caffeine === 3 ? 2 : 0) + (t.strengths.includes("full") ? 1 : 0);
  if (w === "softer") b += (t.quiz.bitter ? -2 : 0) + (t.quiz.caffeine === 3 ? -1 : 0) + (["gaba", "light_oolong"].includes(t.kind) ? 1 : 0);
  if (w === "sweeter") b += t.tastes.some((x) => x === "honey" || x === "fruity") ? 2 : 0;
  if (w === "aroma") b += (t.tastes.includes("floral") ? 2 : 0) + (t.kind === "dancong" ? 1 : 0);
  if (w === "same" && likedKinds.has(t.kind)) b += 1;
  return b;
}
const WISH_LABEL = { stronger: "покрепче", softer: "помягче", sweeter: "послаще", aroma: "ароматнее", same: "так же, как в прошлый раз" };
function timeBonus(t, tm) {
  const c = t.quiz.caffeine;
  if (tm === "morning") return c === 3 ? 2 : 0;
  if (tm === "evening") return c === 3 ? -3 : t.kind === "gaba" || t.kind === "light_oolong" ? 1 : 0;
  if (tm === "food") return ["shu", "dark_oolong", "puer"].includes(t.kind) ? 2 : 0;
  return 0;
}
function scoreTea(t, a) {
  const q = t.quiz;
  if (!t.available) return null;
  if (a.dislikes.includes("bitter") && q.bitter >= 2) return null;
  if (a.dislikes.includes("earthy") && q.earthy) return null;
  // Нелюбимые ноты: главная нота чая — убираем, второстепенная — штраф
  const disliked = a.dislikes.flatMap((d) => LIKE_TO_TASTE[d] || []);
  if (disliked.includes(t.tastes[0])) return null;
  const minor = t.tastes.filter((x) => disliked.includes(x)).length;
  if (a.brew !== "gaiwan" && !q.mug) return null;
  const wanted = a.likes.flatMap((l) => LIKE_TO_TASTE[l]);
  const matched = [...new Set(t.tastes.filter((x) => wanted.includes(x)))];
  let s = matched.length * 3 - (wanted.length && !matched.length ? 2 : 0) - minor * 3;
  if (a.drink.some((d) => q.familiar.includes(d))) s += 3;
  // Несколько вариантов времени: чай оцениваем по тому моменту, для которого он подходит лучше всего
  if (a.time.length) s += Math.max(...a.time.map((tm) => timeBonus(t, tm)));
  if (a.dislikes.includes("bitter") && q.bitter === 1) s -= 2;
  if (a.dislikes.includes("strong") && q.caffeine === 3) s -= 2;
  if (t.kind === "puer") s -= 2; // тип пуэра не уточнён у поставщика: не ставим его первым
  if (isGift(a)) {
    // подарок: вкус получателя неизвестен точно, поэтому без резких и спорных чаёв
    if (q.bitter >= 2) s -= 3;
    if (q.earthy && !a.likes.includes("forest")) s -= 2;
    if (["gaba", "red", "light_oolong"].includes(t.kind)) s += 1;
  } else s += feedbackBonus(t);
  if (s === -Infinity) return null;
  return { t, s, matched };
}

const scoredTeas = (a) => S.teas.map((t) => scoreTea(t, a)).filter(Boolean).sort((x, y) => y.s - x.s || x.t.prices["50"] - y.t.prices["50"]);
function pickThree(a) {
  const scored = scoredTeas(a);
  if (!scored.length) return [];
  const safe = scored[0];
  const used = new Set([safe.t.id]);
  const group = (x) => S.kinds[x.t.kind].group;
  const bolder = scored.find((x) => !used.has(x.t.id) && group(x) !== group(safe)) || scored.find((x) => !used.has(x.t.id));
  if (bolder) used.add(bolder.t.id);
  // «Открытие» — другого вида, чем первые два, чтобы не было двух почти одинаковых чаёв
  const kinds = new Set([safe, bolder].filter(Boolean).map((x) => x.t.kind));
  const fresh = (x) => !used.has(x.t.id) && !kinds.has(x.t.kind);
  const discovery = scored.find((x) => fresh(x) && !a.drink.some((d) => x.t.quiz.familiar.includes(d)) && x.matched.length)
    || scored.find(fresh) || scored.find((x) => !used.has(x.t.id));
  const picks = [["Точно понравится", safe], ["Чуть смелее", bolder], ["Открытие", discovery]].filter(([, x]) => x);
  // Выбрали и утро, и вечер: в тройке должен быть и бодрый, и спокойный чай
  if (a.time.includes("morning") && a.time.includes("evening") && picks.length === 3) {
    const bold = (x) => x.t.quiz.caffeine === 3;
    const ids = new Set(picks.map(([, x]) => x.t.id));
    if (picks.every(([, x]) => bold(x))) { const calm = scored.find((x) => !bold(x) && !ids.has(x.t.id)); if (calm) picks[2][1] = calm; }
    else if (!picks.some(([, x]) => bold(x))) { const b = scored.find((x) => bold(x) && !ids.has(x.t.id)); if (b) picks[2][1] = b; }
  }
  return picks;
}

// Почему этот чай: только то, что помогает выбрать. Без повторов и без лишних оговорок.
function whyText(x, a, role) {
  const parts = [];
  const gift = isGift(a);
  if (x.matched.length) parts.push(`${gift ? "Есть то, что нравится получателю" : "Есть ноты, которые вы выбрали"}: ${x.matched.map((m) => S.tastes[m].toLowerCase()).join(", ")}.`);
  const fam = a.drink.find((d) => x.t.quiz.familiar.includes(d) && DRINK_LIKE[d]);
  if (fam) parts.push(DRINK_LIKE[fam]);
  else if (role === "Открытие" && !x.matched.length) parts.push(gift ? "Что-то новое — хороший способ удивить." : "Что-то новое — попробуйте как открытие.");
  const c = x.t.quiz.caffeine;
  const morning = a.time.includes("morning"), evening = a.time.includes("evening");
  if (morning && c === 3) parts.push(evening ? "Этот — для утра: хорошо бодрит." : "Хорошо бодрит утром.");
  else if (evening && c === 3) parts.push("Вечером заваривайте коротко — так он мягче.");
  else if (evening) parts.push(morning ? "Этот — для спокойного вечера." : "Подходит для спокойного вечера.");
  if (a.time.includes("food") && ["shu", "dark_oolong", "puer"].includes(x.t.kind)) parts.push("Хорош после еды.");
  if (!parts.length && gift && !x.t.quiz.bitter) parts.push("Мягкий, без горечи — беспроигрышный подарок.");
  return parts.join(" ");
}

function renderResults() {
  const a = S.quiz.a;
  if (!S.quiz.doneTracked) { S.quiz.doneTracked = true; track("quiz_done", a.who); }
  const picks = pickThree(a);
  if (!picks.length) {
    $("#view").innerHTML = `<div class="empty"><h2>Не нашли точного совпадения</h2><p>Попробуйте убрать одно из ограничений или напишите нам в бот, подберём вручную.</p>
      <button class="btn" id="again">Пройти заново</button> <button class="btn ghost" id="home">В главное меню</button></div>`;
    $("#again").onclick = () => { newQuiz(); renderQuiz(); };
    $("#home").onclick = quitQuiz;
    return;
  }
  const mug = a.brew !== "gaiwan";
  let setPack = "20";
  const setPrice = (pack) => {
    const sum = picks.reduce((s, [, x]) => s + x.t.prices[pack], 0);
    return { sum, total: sum - Math.round((sum * SET_DISCOUNT) / 10) * 10 };
  };
  const { sum, total } = setPrice(setPack);
  $("#view").innerHTML = `<div class="quiz-head"><div class="eyebrow">Ваш подбор</div>
    <div class="progress"><i style="width:100%"></i></div><h2 class="q-title">${isGift(a) ? "Три чая в подарок" : "Три чая для вас"}</h2>
    ${!isGift(a) && S.me?.feedback?.length ? `<p class="muted small" style="margin:6px 0 0">Учли ваши прошлые отзывы${lastWish() ? `: хотелось ${WISH_LABEL[lastWish()]}` : ""}.</p>` : ""}</div>
    ${picks.map(([role, x]) => {
      const r = S.recipes[x.t.kind];
      return `<article class="result"><div class="role">${role}</div><h3>${esc(x.t.name)}</h3>
        <div class="type">${esc(S.kinds[x.t.kind].label)} · ${esc(x.t.effect.state.toLowerCase())}</div>
        <p>${esc(x.t.notes)}</p>${(() => { const w = whyText(x, a, role); return w ? `<p>${esc(w)}</p>` : ""; })()}
        <p class="mug">🫖 ${mug ? esc(S.mugRecipes[x.t.kind]) : `${esc(r[0])} на ${esc(r[1])}, ${esc(r[2])}, первый пролив ${esc(r[3])}`}</p>
        <div class="row-actions"><button class="btn ghost" data-tea="${x.t.id}">Подробнее · от ${rub(x.t.prices["20"])}</button></div></article>`;
    }).join("")}
    ${picks.length === 3 ? `<div class="trial"><div class="eyebrow">${isGift(a) ? "Подарочный набор" : "Пробный набор"}</div><h3 id="trial-title">Все три по 20 г</h3>
      <p class="muted small">${isGift(a) ? "Три разных вкуса — пусть выберет свой. Скидка 10% на набор. Если нужна подарочная упаковка или открытка, напишите в комментарии к заказу." : "Попробуйте и поймите, какой ваш. Скидка 10% на набор."}</p>
      <div class="chips sizes" id="trial-packs" style="margin:12px 0 4px">${["20", "50", "100"].map((p) => `<button class="chip" data-p="${p}" aria-pressed="${p === setPack}">по ${p} г</button>`).join("")}</div>
      <div class="big-price" id="trial-price">${rub(total)} <small><s>${rub(sum)}</s></small></div>
      <button class="btn wide" id="trial" style="margin-top:12px">Положить набор в корзину</button></div>` : ""}
    ${moreHTML(a, picks)}
    <div class="quiz-end"><button class="btn ghost wide" id="home">В главное меню</button>
    <button class="link" id="again">Пройти подбор заново</button></div>`;
  $("#trial-packs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    setPack = b.dataset.p;
    $("#trial-packs").querySelectorAll("[data-p]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.p === setPack));
    const pr = setPrice(setPack);
    $("#trial-title").textContent = `Все три по ${setPack} г`;
    $("#trial-price").innerHTML = `${rub(pr.total)} <small><s>${rub(pr.sum)}</s></small>`;
  });
  $("#trial")?.addEventListener("click", () => {
    const set = "quiz-" + Date.now().toString(36);
    picks.forEach(([, x]) => S.cart.push({ teaId: x.t.id, pack: setPack, qty: 1, set }));
    saveCart(); toast("Набор в корзине"); track("cart_add", `набор из подбора · ${setPack} г`); location.hash = "#cart";
  });
  $("#again").onclick = () => { newQuiz(); renderQuiz(); };
  $("#home").onclick = quitQuiz;
  $("#more-btn")?.addEventListener("click", (e) => { e.currentTarget.hidden = true; $("#more").hidden = false; track("quiz_more"); });
  $("#ask")?.addEventListener("click", askSeller);
  window.scrollTo(0, 0);
}

// Ещё 5 подходящих чаёв — спрятаны за кнопкой, чтобы не перегружать выбор
function moreHTML(a, picks) {
  const ids = new Set(picks.map(([, x]) => x.t.id));
  const more = scoredTeas(a).filter((x) => !ids.has(x.t.id)).slice(0, 5);
  const ask = `<p class="muted small more-ask">Не нашли своё? <button class="link" id="ask">Напишите нам — подберём вручную</button></p>`;
  if (!more.length) return ask;
  return `<button class="btn ghost wide" id="more-btn">Показать ещё похожие на ваш вкус</button>
    <div id="more" hidden><div class="eyebrow" style="margin:18px 0 8px">Ещё подходят</div>
    ${more.map((x) => `<button class="more-row" data-tea="${x.t.id}"><span><b>${esc(x.t.name)}</b>
      <small>${esc(S.kinds[x.t.kind].label)}${x.matched.length ? ` · ${esc(x.matched.map((m) => S.tastes[m].toLowerCase()).join(", "))}` : ""} · ${esc(x.t.effect.state.toLowerCase())}</small></span>
      <span class="more-price">от ${rub(x.t.prices["20"])}</span></button>`).join("")}
    ${ask}</div>`;
}

// Вопрос продавцу: в Telegram — закрыть приложение и вернуться в чат с ботом
function askSeller() {
  if (tgApp?.close && inTelegram()) { toast("Напишите в чат с ботом, что ищете — ответим"); setTimeout(() => tgApp.close(), 1200); }
  else location.href = BOT_LINK;
}

// ---------- корзина и оформление ----------
function cartLines() {
  // Зачёркнутые чаи из набора (removed) остаются в списке, но не считаются
  const lines = S.cart.map((i, idx) => {
    if (i.removed) return null;
    const t = tea(i.teaId); if (!t) return null;
    const p = packInfo(t, i.pack);
    return { idx, t, i, label: p.label, sum: p.price * i.qty };
  }).filter(Boolean);
  const sets = {};
  for (const l of lines) if (l.i.set) (sets[l.i.set] ||= []).push(l);
  let discount = 0;
  for (const g of Object.values(sets))
    if (g.length >= 3 && g.length <= 6 && new Set(g.map((l) => l.t.id)).size === g.length && ["20", "50", "100"].includes(g[0].i.pack) && g.every((l) => l.i.pack === g[0].i.pack && l.i.qty === g[0].i.qty)) {
      discount += Math.round((g.reduce((s, l) => s + l.sum, 0) * SET_DISCOUNT) / 10) * 10;
      g.forEach((l) => (l.inSet = true));
    }
  const promoBase = lines.filter((l) => !l.inSet).reduce((s, l) => s + l.sum, 0);
  const promoOff = S.promo ? Math.round((promoBase * S.promo.percent) / 100 / 10) * 10 : 0;
  const total = Math.max(0, lines.reduce((s, l) => s + l.sum, 0) - discount - promoOff);
  return { lines, discount, promoOff, total };
}

// ---------- корзина: наборы блоком, удаление с «Вернуть» ----------
function setTitle(id) {
  const key = id.replace(/-[a-z0-9]+$/, "");
  const ready = S.sets.find((x) => x.key === key);
  if (ready) return `Набор «${ready.title}»`;
  return key === "own" ? "Свой набор" : key === "quiz" ? "Набор из подбора" : "Набор";
}
function removeFromCart(idxs) {
  const items = idxs.sort((a, b) => b - a).map((at) => ({ at, item: S.cart.splice(at, 1)[0] })).filter((x) => x.item);
  if (!items.length) return;
  const names = items.map((x) => tea(x.item.teaId)?.name || "чай");
  S.undo = { items, label: items.length > 1 ? `${items.length} чая из набора` : `«${names[0]}»` };
  saveCart();
}
// Чай с вариантами (зайчик / тигр / дракон): выбор прямо в корзине
const varMissing = (i) => { const t = tea(i.teaId); return !i.removed && !!t?.variants?.length && !t.variants.includes(i.variant); };
function varPick(idx, i, t) {
  if (!t.variants?.length) return "";
  const miss = !t.variants.includes(i.variant);
  return `<div class="var-pick${miss && S.varNeed ? " need" : ""}">${t.variants.map((v) => `<button class="chip" data-cv="${idx}" data-val="${esc(v)}" aria-pressed="${v === i.variant}">${esc(v)}</button>`).join("")}
    ${miss ? `<span class="small ${S.varNeed ? "error" : "muted"}">выберите вариант</span>` : ""}</div>`;
}
function cartBlocks(lines) {
  const done = new Set();
  return lines.map((l) => {
    if (!l.i.set) return `<div class="line"><div><h3>${esc(l.t.name)}${l.i.variant ? ` — ${esc(l.i.variant)}` : ""}</h3><div class="muted small">${esc(l.label)}${l.t.available ? "" : " · <span class=error>нет в наличии</span>"}</div>${varPick(l.idx, l.i, l.t)}
      <div class="qty" style="margin-top:8px"><button data-d="-1" data-i="${l.idx}" aria-label="Меньше">−</button><b>${l.i.qty}</b><button data-d="1" data-i="${l.idx}" aria-label="Больше">+</button></div></div>
      <div class="sum">${rub(l.sum)}</div></div>`;
    if (done.has(l.i.set)) return "";
    done.add(l.i.set);
    const g = lines.filter((x) => x.i.set === l.i.set);
    const sum = g.reduce((s, x) => s + x.sum, 0);
    const all = S.cart.map((i, idx) => ({ i, idx, t: tea(i.teaId) })).filter((x) => x.i.set === l.i.set && x.t);
    const ok = g.every((x) => x.inSet);
    return `<div class="line cart-set"><div style="flex:1"><h3>${esc(setTitle(l.i.set))}</h3>
      <div class="muted small">${g.length} ${g.length >= 5 ? "чаёв" : g.length === 1 ? "чай" : "чая"} по ${esc(g[0].label)}${ok ? " · скидка 10%" : ""}</div>
      <ul class="set-items">${all.map((x) => x.i.removed
        ? `<li class="off"><s>${esc(x.t.name)}</s><button class="link back" data-toggle="${x.idx}">вернуть</button></li>`
        : `<li><span>${esc(x.t.name)}${x.i.variant ? ` — ${esc(x.i.variant)}` : ""}${x.t.available ? "" : " · <span class=error>нет в наличии</span>"}${varPick(x.idx, x.i, x.t)}</span><button class="link" data-toggle="${x.idx}" aria-label="Убрать из набора">убрать</button></li>`).join("")}</ul>
      ${ok ? "" : `<p class="small" style="color:var(--gold);margin:6px 0 0">В наборе нужно от 3 разных чаёв одной фасовки и количества — сейчас скидка не действует.</p>`}
      <div style="display:flex;align-items:center;gap:14px;margin-top:8px"><div class="qty"><button data-sq="-1" data-set="${esc(l.i.set)}" aria-label="Меньше наборов">−</button><b>${g[0].i.qty}</b><button data-sq="1" data-set="${esc(l.i.set)}" aria-label="Больше наборов">+</button></div>
      <button class="link" data-rm="${all.map((x) => x.idx).join(",")}">Убрать набор</button></div></div>
      <div class="sum">${rub(sum)}</div></div>`;
  }).join("");
}

function renderCart() {
  S.cart = S.cart.filter((i) => tea(i.teaId) && ["20", "50", "100"].includes(i.pack));
  const { lines, discount, promoOff, total } = cartLines();
  if (!lines.length && !S.undo && S.cart.length) { S.cart = []; saveCart(); }
  if (!lines.length) {
    $("#view").innerHTML = `<div class="empty"><h2>Корзина пуста</h2><p>Откройте чай в каталоге или пройдите подбор.</p>
      <a class="btn" href="#quiz">🍵 Подобрать чай</a></div>`;
    return;
  }
  if (S.checkout) return renderCheckout(total);
  const off = lines.filter((l) => !l.t.available);
  $("#view").innerHTML = `<h2 class="section-title">Корзина</h2>
    ${S.undo ? `<div class="undo"><span>Убрали ${esc(S.undo.label)}</span><button class="link" id="undo">↩︎ Вернуть</button></div>` : ""}
    ${cartBlocks(lines)}
    ${discount ? `<div class="line"><div class="muted">Скидка на набор</div><div class="sum">−${rub(discount)}</div></div>` : ""}
    ${`<div class="promo">${S.promo
      ? (promoOff
        ? `<p class="promo-ok">✓ Промокод ${esc(S.promo.shown || S.promo.code)} применён: ${esc(S.promo.label)}</p><div class="line" style="border:0"><div class="muted">Скидка по промокоду</div><div class="sum">−${rub(promoOff)}</div></div>${S.promo.note ? `<p class="muted small" style="margin:0;flex-basis:100%">${esc(S.promo.note)}</p>` : ""}`
        : `<p class="muted small" style="margin:0">Промокод ${esc(S.promo.code)} не складывается со скидкой набора. Он сработает на чаи, которые вы добавите отдельно.</p>`) +
        `<button class="link" id="promo-off">Убрать промокод</button>`
      : `<label class="search"><input id="promo" placeholder="Промокод" autocomplete="off" autocapitalize="characters" enterkeyhint="done" value="${esc(S.promoDraft || "")}"></label><button class="btn ghost" id="promo-go">Применить</button>`}
      <p class="error" id="promo-err"></p></div>`}
    <div class="total"><span>Итого</span><span>${rub(total)}</span></div>
    ${S.freeFrom ? `<p class="free-left">${total >= S.freeFrom ? "🎁 Доставка бесплатная — любой службой" : `🚚 До бесплатной доставки осталось ${rub(S.freeFrom - total)}`}</p>` : ""}
    <p class="note">Доставку выберете на следующем шаге: ПВЗ Яндекса и Ozon — 290 ₽, СДЭК и Почта — 450 ₽. Чай собираем под заказ: наличие и сроки подтвердим ${authed() ? "в Telegram" : "по телефону или в мессенджере"}, оплата после подтверждения.</p>
    ${S.deliveryInfo ? `<details class="dl-info"><summary>Доставка и возврат</summary><p>${esc(S.deliveryInfo.replace(/^🚚 Доставка\n\n/, "")).replace(/\n/g, "<br>")}</p></details>` : ""}
    ${off.length ? `<p class="error">Уберите чаи, которых нет в наличии, чтобы оформить заказ.</p>` : ""}
    <button class="btn wide" id="go" ${off.length ? "disabled" : ""}>Оформить заказ</button>`;
  // «Вернуть» висит внизу экрана 8 секунд — на телефоне верх корзины после удаления может быть не виден
  clearTimeout(S.undoTimer);
  if (S.undo) { $("#toast").hidden = true; S.undoTimer = setTimeout(() => { S.undo = null; $(".undo")?.remove(); }, 8000); }
  $("#view").onclick = (e) => {
    const cv = e.target.closest("[data-cv]");
    if (cv) { S.cart[Number(cv.dataset.cv)].variant = cv.dataset.val; if (!S.cart.some(varMissing)) S.varNeed = false; saveCart(); return renderCart(); }
    if (e.target.closest("#undo")) {
      // Возвращаем убранное на прежние места
      for (const { at, item } of [...S.undo.items].sort((x, y) => x.at - y.at)) S.cart.splice(Math.min(at, S.cart.length), 0, item);
      S.undo = null; saveCart(); toast("Вернули"); return renderCart();
    }
    // Чай в наборе: зачёркиваем или возвращаем на место
    const tg = e.target.closest("[data-toggle]");
    if (tg) {
      const it = S.cart[Number(tg.dataset.toggle)];
      it.removed = !it.removed;
      if (!S.cart.some((x) => x.set === it.set && !x.removed)) S.cart = S.cart.filter((x) => x.set !== it.set);
      S.undo = null; saveCart(); return renderCart();
    }
    const rm = e.target.closest("[data-rm]");
    if (rm) { removeFromCart(rm.dataset.rm.split(",").map(Number)); return renderCart(); }
    const sq = e.target.closest("[data-sq]");
    if (sq) {
      // Количество набора меняем сразу у всех чаёв, чтобы скидка не слетела
      const g = S.cart.filter((i) => i.set === sq.dataset.set);
      const q = g[0].qty + Number(sq.dataset.sq);
      if (q < 1) { removeFromCart(g.map((i) => S.cart.indexOf(i))); return renderCart(); }
      g.forEach((i) => (i.qty = Math.min(q, 20)));
      S.undo = null; saveCart(); return renderCart();
    }
    const b = e.target.closest("button[data-d]"); if (!b) return;
    const idx = Number(b.dataset.i);
    const it = S.cart[idx];
    if (it.qty + Number(b.dataset.d) < 1) { removeFromCart([idx]); return renderCart(); }
    it.qty = Math.min(it.qty + Number(b.dataset.d), 20);
    S.undo = null; saveCart(); renderCart();
  };
  $("#go").onclick = () => {
    // Не выбран вариант у блина — подсвечиваем строку и не пускаем дальше
    if (S.cart.some(varMissing)) { S.varNeed = true; renderCart(); document.querySelector(".var-pick.need")?.scrollIntoView({ behavior: "smooth", block: "center" }); toast("Выберите вариант: зайчик, тигр или дракон"); return; }
    S.checkout = true; renderCart();
  };
  $("#promo-off")?.addEventListener("click", () => { S.promo = null; renderCart(); });
  const promoIn = $("#promo");
  const applyPromo = async () => {
    const btn = $("#promo-go"), err = $("#promo-err");
    const code = promoIn.value.trim();
    promoIn.classList.remove("bad"); err.textContent = "";
    if (!code) { promoIn.classList.add("bad"); err.textContent = "Введите промокод."; promoIn.focus(); return; }
    S.promoDraft = code;
    btn.disabled = true; btn.textContent = "Проверяем…";
    try {
      const r = await api((authed() ? "/api/promo?code=" : "/api/site-promo?code=") + encodeURIComponent(code));
      if (!r.ok) { promoIn.classList.add("bad"); err.textContent = "✕ " + r.error; return; }
      S.promo = { ...r, shown: code.toUpperCase().replace(/\s+/g, "") }; S.promoDraft = ""; renderCart(); toast(cartLines().promoOff ? "✓ Промокод применён" : "На наборы уже действует скидка");
    } catch (e) { promoIn.classList.add("bad"); err.textContent = "✕ " + e.message; }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = "Применить"; } }
  };
  $("#promo-go")?.addEventListener("click", applyPromo);
  promoIn?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } });
  promoIn?.addEventListener("input", () => { S.promoDraft = promoIn.value; promoIn.classList.remove("bad"); $("#promo-err").textContent = ""; });
}

// Доставка: то же правило, что на сервере (src/catalog.js → deliveryCost)
function deliveryCost(k, total) {
  const d = S.delivery[k]; if (!d) return null;
  if (!d.price) return { cost: 0, free: false };
  if (S.freeFrom && total >= S.freeFrom) return { cost: 0, free: true };
  return { cost: d.price, free: false };
}
function loadForm() { try { return JSON.parse(localStorage.getItem("form") || "{}"); } catch { return {}; } }
function renderCheckout(total) {
  if (!S.checkoutTracked) { S.checkoutTracked = true; track("checkout_open"); }
  const f = loadForm();
  const u = tgApp?.initDataUnsafe?.user;
  const dSel = S.delivery[f.delivery] ? f.delivery : "yandex";
  $("#view").onclick = null;
  $("#view").innerHTML = `<h2 class="section-title">Оформление</h2>
    ${authed() ? "" : loginBox("Заказ сохранится в профиле, статусы и реквизиты придут в Telegram. Или оформите без входа — ниже.")}
    <form id="f" novalidate>
      <label>Имя<input id="f-name" name="name" required maxlength="80" value="${esc(f.name || u?.first_name || S.auth?.user?.first_name || "")}"></label>
      <label>Телефон<input id="f-phone" name="phone" type="tel" required maxlength="30" placeholder="+7 900 000-00-00" value="${esc(f.phone || "")}"></label>
      <label>Почта <span class="muted small" id="email-hint"></span><input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="name@mail.ru" value="${esc(f.email || "")}"></label>
      ${authed() ? "" : `<fieldset class="dl"><legend>Как с вами связаться, чтобы подтвердить заказ</legend>
        <div class="contact-opts">${[["tg", "Telegram"], ["wa", "WhatsApp"], ["call", "Звонок"]].map(([k, l]) => `<label><input type="radio" name="contact" value="${k}" ${(f.contact || "tg") === k ? "checked" : ""}>${l}</label>`).join("")}</div>
        <label id="nick-wrap" style="margin-top:10px">Ник в Telegram (необязательно)<input id="f-nick" name="contactNick" maxlength="60" placeholder="@username" value="${esc(f.contactNick || "")}"></label>
        <label class="hp" aria-hidden="true">Не заполняйте<input name="website" tabindex="-1" autocomplete="off"></label></fieldset>`}
      <fieldset class="dl"><legend>Доставка</legend>${Object.entries(S.delivery).map(([k, d]) => {
        const c = deliveryCost(k, total);
        return `<label class="dl-opt"><input type="radio" name="delivery" value="${k}" ${k === dSel ? "checked" : ""}><span><b>${esc(d.label)}</b><small>${esc(d.note)}</small></span><span class="dl-price${c.free || !c.cost ? " free" : ""}">${c.free || !c.cost ? "бесплатно" : rub(c.cost)}</span></label>`;
      }).join("")}</fieldset>
      <label id="addr-wrap"><span id="addr-label">Город и адрес</span><input id="f-address" name="address" maxlength="300" value="${esc(f.address || "")}"></label>
      <label>Комментарий (необязательно)<textarea id="f-comment" name="comment" rows="3" maxlength="500"></textarea></label>
      <p class="muted small" style="margin:4px 0 0">Вскрытую упаковку вернуть нельзя — поэтому каждый чай можно сначала взять по 20 г.</p>
      <label class="consent"><input type="checkbox" id="f-terms" name="terms"> <span>Согласен с <a href="/terms" data-doc>условиями доставки и возврата</a></span></label>
      <label class="consent"><input type="checkbox" id="f-consent" name="consent"> <span>Даю <a href="/consent" data-doc>согласие на обработку персональных данных</a> и принимаю <a href="/privacy" data-doc>политику конфиденциальности</a></span></label>
      <div class="line" style="border:0;padding:4px 0"><div class="muted">Чай</div><div class="sum">${rub(total)}</div></div>
      <div class="line" style="border:0;padding:4px 0"><div class="muted">Доставка</div><div class="sum" id="dl-sum"></div></div>
      <div class="total"><span>Итого</span><span id="grand"></span></div>
      <p class="muted small" id="dl-note" style="margin:0 0 10px"></p>
      <p class="error" id="err"></p>
      <button class="btn wide" id="send">Отправить заказ</button>
      <p class="muted small ask-us">Остались вопросы? Напишите нам в Telegram: <a href="https://t.me/alpha_omega_Y">Яна</a> · <a href="https://t.me/Ont_hefly">Александр</a> · или на почту <a href="mailto:Sinitsa-chai@yandex.ru">Sinitsa-chai@yandex.ru</a></p>
      <button class="link" type="button" id="back">← Вернуться в корзину</button>
    </form>`;
  const sync = () => {
    const k = $("#f input[name=delivery]:checked")?.value || "";
    const d = S.delivery[k];
    $("#addr-wrap").hidden = !d || !d.address;
    const ct = $("#f input[name=contact]:checked")?.value;
    if ($("#nick-wrap")) $("#nick-wrap").hidden = ct !== "tg";
    const needMail = !authed() && (ct === "wa" || ct === "call");
    $("#email-hint").textContent = needMail ? "— пришлём подтверждение, реквизиты и QR для оплаты" : "(необязательно) — продублируем подтверждение и статусы";
    if (d?.address) $("#addr-label").textContent = d.address;
    const c = d && deliveryCost(k, total);
    $("#dl-sum").textContent = !c ? "—" : c.cost ? rub(c.cost) : "бесплатно";
    $("#grand").textContent = rub(total + (c?.cost || 0));
    $("#dl-note").textContent = !c ? "Выберите способ доставки." : c.free ? `Доставка бесплатная — заказ от ${rub(S.freeFrom)}.` : !c.cost ? "Место и время встречи согласуем в чате." : S.freeFrom ? `До бесплатной доставки не хватает ${rub(S.freeFrom - total)}.` : "";
  };
  $("#f").addEventListener("change", sync); sync(); mountLogin();
  $("#back").onclick = () => { S.checkout = false; renderCart(); };
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.consent = $("#f-consent").checked;
    data.terms = $("#f-terms").checked;
    // Неотмеченную галочку подсвечиваем красным и показываем, чтобы не потерялась
    const need = (id, text) => {
      const l = $(id).closest("label"); l.classList.add("need");
      $("#err").textContent = text; l.scrollIntoView({ behavior: "smooth", block: "center" });
      $(id).addEventListener("change", () => { l.classList.remove("need"); $("#err").textContent = ""; }, { once: true });
    };
    // Незаполненное поле загорается красным, к нему прокручиваем — не надо искать глазами
    const bad = (id, text) => {
      const el = $(id); el.classList.add("bad"); el.closest("label")?.classList.add("need");
      $("#err").textContent = text; el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus({ preventScroll: true });
      el.addEventListener("input", () => { el.classList.remove("bad"); el.closest("label")?.classList.remove("need"); $("#err").textContent = ""; }, { once: true });
    };
    document.querySelectorAll("#f .bad").forEach((x) => x.classList.remove("bad"));
    document.querySelectorAll("#f label.need").forEach((x) => x.classList.remove("need"));
    const dl = S.delivery[data.delivery];
    if (!String(data.name || "").trim()) return bad("#f-name", "Укажите имя.");
    const digits = String(data.phone || "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return bad("#f-phone", "Проверьте телефон: нужно от 10 до 15 цифр.");
    const mail = String(data.email || "").trim();
    if (!authed() && (data.contact === "wa" || data.contact === "call") && !mail) return bad("#f-email", "Укажите почту — пришлём на неё подтверждение, реквизиты и QR для оплаты.");
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return bad("#f-email", "Проверьте почту: похоже, в адресе ошибка.");
    if (dl?.address && String(data.address || "").trim().length < 5) return bad("#f-address", "Укажите город и адрес пункта выдачи.");
    if (!data.terms) return need("#f-terms", "Отметьте, что согласны с условиями доставки и возврата.");
    if (!data.consent) return need("#f-consent", "Отметьте согласие на обработку персональных данных.");
    try { localStorage.setItem("form", JSON.stringify({ name: data.name, phone: data.phone, delivery: data.delivery, address: data.address, contact: data.contact, contactNick: data.contactNick, email: data.email })); } catch {}
    $("#send").disabled = true; $("#err").textContent = "";
    try {
      const { order, token } = await api(authed() ? "/api/orders" : "/api/site-orders", { method: "POST", body: JSON.stringify({ ...data, items: S.cart.filter((i) => !i.removed).map(({ removed, ...i }) => i), promo: S.promo?.code || "" }) });
      S.cart = []; saveCart(); S.checkout = false; S.promo = null; if (S.me) S.me.firstOrder = false;
      if (authed()) {
        $("#view").innerHTML = `<div class="empty"><h2>Заказ №${order.id} отправлен 🍵</h2><p>Проверим наличие и напишем вам в Telegram, в чате с ботом @${BOT_NAME}. Как только подтвердим, придут сумма и реквизиты для оплаты.</p>
          <a class="btn" href="#orders">Мои заказы</a></div>`;
      } else {
        saveSiteOrder(order, token);
        const how = { tg: "в Telegram", wa: "в WhatsApp", call: "по телефону" }[data.contact] || "по телефону";
        const tg = data.contact === "tg";
        $("#view").innerHTML = `<div class="empty"><h2>Заказ №${order.id} отправлен 🍵</h2>
          ${tg ? `<p>Нажмите кнопку ниже и «Старт» в боте — подтверждение, сумма к оплате и статусы будут приходить вам в Telegram автоматически.</p>
            <div class="row" style="justify-content:center;flex-wrap:wrap;gap:10px"><a class="btn tg-btn" href="${tgStartLink(order.id, token)}" target="_blank" rel="noopener">✈️ Получать статус в Telegram</a><a class="btn ghost" href="#orders">Мои заказы</a></div>`
          : `<p>Проверим наличие и свяжемся с вами ${how}.${data.email ? ` Подтверждение, сумму и реквизиты пришлём и на почту ${esc(data.email)}.` : ""} Как только подтвердим, в разделе «Заказы» здесь, на сайте, появятся QR-код и реквизиты для оплаты — никуда переходить не нужно.</p>
            <a class="btn" href="#orders">Мои заказы</a>
            <p class="small muted" style="margin-top:14px">Удобнее получать новости в Telegram? <a href="${tgStartLink(order.id, token)}" target="_blank" rel="noopener">Подключите бота</a> — одно нажатие.</p>`}</div>`;
      }
      try { tgApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
    } catch (err) {
      $("#err").textContent = err.message; $("#send").disabled = false; track("order_error", err.message);
      // Ошибка с сервера — тоже подсвечиваем нужное поле
      const m = err.message.toLowerCase();
      const id = m.includes("имя") ? "#f-name" : m.includes("почт") ? "#f-email" : m.includes("телефон") ? "#f-phone" : m.includes("адрес") ? "#f-address" : "";
      if (id && $(id)) { $(id).classList.add("bad"); $(id).scrollIntoView({ behavior: "smooth", block: "center" }); $(id).addEventListener("input", () => $(id).classList.remove("bad"), { once: true }); }
    }
  };
}

// ---------- мои заказы ----------
// Ждёт оплаты: реквизиты, копирование номера и кнопка «Я оплатил»
// QR-код из ссылки на оплату (библиотека /vendor/qrcode.js)
function qrSVG(text) {
  try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch { return ""; }
}
function payHTML(o, siteToken = "") {
  if (o.status !== "accepted") return "";
  if (!o.payment) return `<p class="muted small" style="margin:8px 0 0">Реквизиты для оплаты пришлём ${siteToken ? "в выбранный мессенджер" : "в чате с ботом"}.</p>`;
  const p = o.payment;
  const qr = p.link ? qrSVG(p.link) : "";
  return `<div class="pay"><div class="eyebrow">К оплате ${rub(o.total)}</div>
    ${p.link ? `<div class="pay-qr">${qr ? `<div class="qr">${qr}</div>` : ""}<div><p class="small" style="margin:0 0 8px">Наведите камеру телефона на QR-код или нажмите кнопку — откроется перевод в приложении банка.</p>
      <a class="btn wide" href="${esc(p.link)}" target="_blank" rel="noopener">Открыть оплату в банке</a>
      <p class="small muted" style="margin:6px 0 0">Сумма: <b>${rub(o.total)}</b>, в комментарии — «Заказ ${o.id}»</p></div></div>` : ""}
    <p class="small" style="margin:6px 0">Перевод по СБП по номеру телефона:</p>
    <button class="pay-row" data-copy="${esc(p.phone)}"><span>📱 ${esc(p.phone)}</span><small>скопировать</small></button>
    <p class="small" style="margin:6px 0 0">🏦 ${esc(p.bank)} · 👤 ${esc(p.name)}</p>
    <p class="muted small" style="margin:6px 0 10px">В комментарии к переводу: «Заказ ${o.id}»</p>
    ${o.paidClaim ? `<p class="small" style="margin:0;color:var(--gold)">Вы отметили оплату — проверим и подтвердим.</p>` : siteToken ? `<button class="btn wide" data-paid-site="${o.id}" data-t="${esc(siteToken)}">✅ Я оплатил</button>` : `<button class="btn wide" data-paid="${o.id}">✅ Я оплатил</button>`}</div>`;
}
// Заказы с сайта: помним номера на этом устройстве, статус сообщаем лично
function loadSiteOrders() { try { return JSON.parse(localStorage.getItem("siteOrders") || "[]"); } catch { return []; } }
function saveSiteOrder(o, token = "") {
  try {
    const rest = loadSiteOrders().filter((x) => x.id !== o.id);
    localStorage.setItem("siteOrders", JSON.stringify([{ id: o.id, total: o.total, at: Date.now(), token, items: o.items.filter((i) => i.teaId).map((i) => `${i.name}, ${i.label} × ${i.qty}`) }, ...rest].slice(0, 20)));
  } catch {}
}
// Шкала статуса заказа: Оформлен → Подтверждён → Оплачен → Отправлен → Получен
const STEPS = [["new", "Оформлен"], ["accepted", "Подтверждён"], ["paid", "Оплачен"], ["shipped", "Отправлен"], ["done", "Получен"]];
function stepsHTML(o) {
  if (o.status === "cancelled") return `<p class="steps-off">Заказ отменён</p>`;
  const cur = STEPS.findIndex(([k]) => k === o.status);
  return `<ol class="steps" aria-label="Статус: ${esc(o.statusLabel)}">${STEPS.map(([k, l], i) => `<li class="${i < cur ? "ok" : i === cur ? "now" : ""}"${i === cur ? ' aria-current="step"' : ""}><i></i><span>${l}</span></li>`).join("")}</ol>`;
}
// Ссылка на бота, которая привязывает заказ с сайта к Telegram покупателя
const tgStartLink = (id, token) => `https://t.me/${BOT_NAME}?start=o${id}_${String(token).slice(0, 16)}`;
// Свежие статусы заказов с сайта (по ключу заказа)
async function siteOrderStatus(x) {
  if (!x.token) return null;
  try { return (await api(`/api/site-orders/${x.id}?t=${encodeURIComponent(x.token)}`)).order; } catch { return null; }
}
// После входа через Telegram заказы, оформленные на этом устройстве без входа, переходят в профиль
async function claimLocalOrders() {
  if (inTelegram()) return;
  const list = loadSiteOrders().filter((x) => x.token);
  if (!list.length) return;
  try {
    await api("/api/claim-orders", { method: "POST", body: JSON.stringify({ orders: list.map(({ id, token }) => ({ id, token })) }) });
    localStorage.removeItem("siteOrders");
  } catch {}
}
async function renderOrders() {
  if (!authed()) {
    const list = loadSiteOrders();
    const draw = (live) => {
      $("#view").innerHTML = `<h2 class="section-title">Мои заказы</h2>
      ${list.length ? list.map((x) => {
        const o = live[x.id];
        return `<div class="line" style="display:block"><div style="display:flex;justify-content:space-between;gap:12px"><h3>Заказ №${x.id}</h3>${o ? `<span class="status ${o.status}">${esc(o.statusLabel)}</span>` : ""}</div>
          <div class="muted small">${(o ? o.items.map((i) => i.teaId ? `${i.name}, ${i.label} × ${i.qty}` : `${i.name}: ${i.sum >= 0 ? "" : "−"}${rub(Math.abs(i.sum))}`) : x.items).map(esc).join("<br>")}</div>
          <b class="sum" style="color:var(--gold)">${rub(o ? o.total : x.total)}</b>
          ${o ? stepsHTML(o) : x.token ? "" : `<p class="muted small" style="margin:8px 0 0">Статус этого заказа пришлём в выбранный мессенджер.</p>`}
          ${o ? (o.status === "new" ? `<p class="muted small" style="margin:8px 0 0">Проверяем наличие. Как только подтвердим, здесь появятся QR-код и реквизиты для оплаты.</p>` : payHTML(o, x.token)) : ""}
          ${o && !o.tgLinked && !["done", "cancelled"].includes(o.status) && x.token ? `<a class="btn ghost sm tg-link" href="${tgStartLink(x.id, x.token)}" target="_blank" rel="noopener">✈️ Получать статус в Telegram</a>` : ""}
          ${o?.tgLinked ? `<p class="small muted" style="margin:8px 0 0">✈️ Статусы приходят вам в Telegram</p>` : ""}
          ${x.token ? `<button class="link order-link" data-copy="${esc(`${location.origin}/?order=${x.id}&t=${x.token}`)}" data-copy-msg="Ссылка скопирована — откройте её на любом устройстве">🔗 Скопировать ссылку на заказ</button>` : ""}</div>`;
      }).join("") : `<p class="muted">На этом устройстве заказов пока нет.</p>`}
      ${list.length ? `<p class="muted small">Заказы без входа видны только на этом устройстве. Чтобы открыть заказ на другом — скопируйте ссылку на него. Или войдите через Telegram: эти заказы перейдут в ваш профиль и будут видны везде.</p>` : ""}
      ${loginBox("Чтобы видеть заказы с любого телефона и компьютера, а статусы получать в Telegram.")}`;
      mountLogin();
    };
    draw({});
    const live = {};
    await Promise.all(list.map(async (x) => { const o = await siteOrderStatus(x); if (o) live[x.id] = o; }));
    if ((location.hash || "") === "#orders" && !authed()) draw(live);
    $("#view").onclick = async (e) => {
      const ps = e.target.closest("[data-paid-site]");
      if (ps) {
        ps.disabled = true;
        try { await api(`/api/site-orders/${ps.dataset.paidSite}/paid?t=${encodeURIComponent(ps.dataset.t)}`, { method: "POST" }); toast("Спасибо! Проверим перевод и подтвердим"); renderOrders(); }
        catch (err) { toast(err.message); ps.disabled = false; }
        return;
      }
      const cp = e.target.closest("[data-copy]");
      if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast(cp.dataset.copyMsg || "Скопировано"); } catch { toast(cp.dataset.copy); } }
    };
    return;
  }
  const who = !inTelegram() && S.auth?.user ? `<p class="muted small site-only">Вы вошли как ${esc(S.auth.user.first_name || "")}${S.auth.user.username ? ` (@${esc(S.auth.user.username)})` : ""} · <button class="link" id="logout" style="padding:0">Выйти</button></p>` : "";
  $("#view").innerHTML = `<h2 class="section-title">Мои заказы</h2><p class="muted">Загружаем…</p>`;
  try {
    await claimLocalOrders();
    const { orders } = await api("/api/orders");
    if (!orders.length) {
      $("#view").innerHTML = who + `<div class="empty"><h2>Пока нет заказов</h2><p>После оформления заказ появится здесь, а статусы будут приходить в чат.</p><a class="btn" href="#catalog">В каталог</a></div>`;
      return;
    }
    $("#view").innerHTML = `<h2 class="section-title">Мои заказы</h2>` + who + orders.map((o) => `
      <div class="line" style="display:block"><div style="display:flex;justify-content:space-between;gap:12px"><h3>Заказ №${o.id}</h3><span class="status ${o.status}">${esc(o.statusLabel)}</span></div>
      <div class="muted small">${o.items.map((i) => i.teaId ? `${esc(i.name)}, ${esc(i.label)} × ${i.qty}` : (i.sum >= 0 ? `${esc(i.name)}: ${rub(i.sum)}` : `${esc(i.name)}: −${rub(-i.sum)}`)).join("<br>")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><b class="sum" style="color:var(--gold)">${rub(o.total)}</b>
      </div>${stepsHTML(o)}${payHTML(o)}<div style="display:flex;justify-content:flex-end;margin-top:4px">
      <span style="display:flex;gap:16px">${o.canCancel ? `<button class="link" data-cancel="${o.id}">Отменить</button>` : ""}
      <button class="link" data-repeat="${o.id}">Повторить</button></span></div></div>`).join("");
    S.lastOrders = orders;
    $("#view").onclick = async (e) => {
      const pd = e.target.closest("[data-paid]");
      if (pd) {
        pd.disabled = true;
        try { await api(`/api/orders/${pd.dataset.paid}/paid`, { method: "POST" }); toast("Спасибо! Проверим перевод и подтвердим"); renderOrders(); }
        catch (err) { toast(err.message); pd.disabled = false; }
        return;
      }
      const cp = e.target.closest("[data-copy]");
      if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Скопировано"); } catch { toast(cp.dataset.copy); } return; }
      const rp = e.target.closest("[data-repeat]");
      if (rp) {
        const o = S.lastOrders.find((x) => x.id === Number(rp.dataset.repeat));
        const setIds = {};
        let added = 0;
        for (const i of o.items) {
          const t = tea(i.teaId); if (!t || !t.available) continue;
          const set = i.set ? (setIds[i.set] ||= "rep-" + Math.random().toString(36).slice(2, 8)) : "";
          S.cart.push({ teaId: i.teaId, pack: i.pack, qty: i.qty, set, ...(i.variant ? { variant: i.variant } : {}) }); added++;
        }
        saveCart();
        if (!added) return toast("Этих чаёв сейчас нет в наличии");
        toast(added < o.items.filter((i) => i.teaId).length ? "Добавили то, что есть в наличии" : "Заказ в корзине");
        location.hash = "#cart"; return;
      }
      const b = e.target.closest("[data-cancel]"); if (!b) return;
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Точно отменить?"; return; }
      try { await api(`/api/orders/${b.dataset.cancel}/cancel`, { method: "POST" }); toast("Заказ отменён"); renderOrders(); }
      catch (err) { toast(err.message); }
    };
  } catch (err) {
    $("#view").innerHTML = `<div class="empty"><h2>Не получилось загрузить</h2><p>${esc(err.message)}</p></div>`;
  }
}

// ---------- навигация ----------
function route() {
  const tab = (location.hash || "#catalog").slice(1) || "catalog";
  // Сайт: блоки главной (заголовок, доставка, вопросы) видны только в каталоге
  if (document.body.dataset.tab && document.body.dataset.tab !== tab && !inTelegram()) window.scrollTo(0, 0);
  document.body.dataset.tab = tab;
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  $("#view").onclick = null;
  if (tab !== "cart") { S.checkout = false; S.undo = null; }
  if (tab !== "checkout" && tab !== "cart") S.checkoutTracked = false;
  if (S.lastTab !== tab) { S.lastTab = tab; if (tab === "sets") track("sets_open"); if (tab === "cart") track("cart_open"); }
  if (tab === "quiz") renderQuiz();
  else if (tab === "cart") renderCart();
  else if (tab === "orders") renderOrders();
  else if (tab === "sets") renderSets();
  else renderCatalog();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#logout")) { logout(); toast("Вы вышли"); route(); return; }
  // Ссылки сайта на блоки главной («Доставка», «Как заказать»): возвращаем каталог и листаем к блоку
  const hm = e.target.closest("[data-home]");
  if (hm) {
    e.preventDefault();
    const go = () => document.getElementById(hm.dataset.home)?.scrollIntoView({ behavior: "smooth" });
    if ((location.hash || "#catalog") !== "#catalog") { location.hash = "#catalog"; setTimeout(go, 50); } else go();
    return;
  }
  // Ссылки на Telegram внутри мини-приложения открываем средствами Telegram
  const tme = e.target.closest('a[href^="https://t.me/"]');
  if (tme && tgApp?.openTelegramLink && inTelegram()) { e.preventDefault(); tgApp.openTelegramLink(tme.href); return; }
  const doc = e.target.closest("a[data-doc]");
  if (doc && tgApp?.openLink) { e.preventDefault(); tgApp.openLink(location.origin + doc.getAttribute("href")); return; }
  const pr = e.target.closest("[data-promo]");
  if (pr) return openPromo(pr.dataset.promo);
  const op = e.target.closest("[data-opt]");
  if (op) return wholesale(Number(op.dataset.opt), op);
  const qc = e.target.closest("[data-qc]");
  if (qc) { e.stopPropagation(); return qcClick(e, qc); }
  const mq = e.target.closest("[data-mc-qty]");
  if (mq) {
    const i = S.cart[Number(mq.dataset.i)]; if (!i) return;
    i.qty = Math.min(20, i.qty + Number(mq.dataset.mcQty));
    if (i.qty <= 0) S.cart.splice(Number(mq.dataset.i), 1);
    saveCart(); qcRefresh(i.teaId); return;
  }
  const md = e.target.closest("[data-mc-del]");
  if (md) {
    const i = S.cart[Number(md.dataset.mcDel)]; if (!i) return;
    S.cart.splice(Number(md.dataset.mcDel), 1); saveCart(); qcRefresh(i.teaId);
    return;
  }
  const c = e.target.closest("[data-tea]");
  if (c) return openTea(c.dataset.tea);
  const st = e.target.closest("[data-set]");
  if (st) addSet(st.dataset.set);
});
window.addEventListener("hashchange", route);
// Карточка чая открывается и с клавиатуры
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("article.card[data-tea]")) { e.preventDefault(); openTea(e.target.dataset.tea); }
});

(async function init() {
  loadCart(); updateBadge(); loadAuth(); updateAccount();
  try {
    const data = await api("/api/catalog");
    Object.assign(S, { teas: data.teas, kinds: data.kinds, recipes: data.recipes, mugRecipes: data.mugRecipes, tastes: data.tastes, sets: data.sets || [], delivery: data.delivery || {}, freeFrom: data.freeDeliveryFrom || 0, deliveryInfo: data.deliveryInfo || "" });
    if (authed()) api("/api/me").then((me) => (S.me = me)).catch(() => {});
    if (!inTelegram()) mountPromo(); // на сайте карусель стоит в шапке главной
  } catch {
    $("#view").innerHTML = `<div class="empty"><h2>Не удалось загрузить каталог</h2><p>Проверьте интернет и откройте магазин ещё раз.</p></div>`;
    return;
  }
  // Раздел, с которого открыли приложение из бота: ?tab=quiz | orders | cart
  const qs = new URLSearchParams(location.search);
  if (qs.get("order") && qs.get("t") && !inTelegram()) {
    try {
      const { order } = await api(`/api/site-orders/${Number(qs.get("order"))}?t=${encodeURIComponent(qs.get("t"))}`);
      saveSiteOrder(order, qs.get("t"));
    } catch {}
    history.replaceState(null, "", "/#orders"); route(); return;
  }
  let tab = qs.get("tab");
  if (!tab && !location.hash && location.pathname === "/podbor") tab = "quiz";
  // Ссылка со страницы чая: /shop#tea-12 — открываем карточку поверх каталога
  const deep = location.hash.match(/^#tea-(\d+)$/);
  if (deep) { history.replaceState(null, "", `${location.pathname}#catalog`); route(); if (tea(deep[1])) openTea(deep[1]); return; }
  if (["quiz", "orders", "cart", "catalog", "sets"].includes(tab)) history.replaceState(null, "", `${location.pathname}#${tab}`);
  else if (!/^#(quiz|orders|cart|catalog|sets)$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#catalog`);
  track("app_open", tab || "");
  route();
})();
