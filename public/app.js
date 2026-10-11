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
function saveCart() { try { localStorage.setItem("cart", JSON.stringify(S.cart)); } catch {} updateBadge(); }
function updateBadge() {
  const n = S.cart.reduce((s, i) => s + i.qty, 0);
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
    headers: { "content-type": "application/json", "x-telegram-init-data": tgApp?.initData || "", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не получилось. Попробуйте ещё раз.");
  return data;
}
const inTelegram = () => !!tgApp?.initData;

// ---------- помощники каталога ----------
const tea = (id) => S.teas.find((t) => t.id === Number(id));
function packInfo(t, pack) {
  if (pack === "wholesale") return { price: t.wholesale.price, label: `опт ${t.wholesale.grams} г` };
  return { price: t.prices[pack], label: `${pack} г` };
}
// Одно фото на вид чая: каждому чаю показываем свой фрагмент, чтобы карточки не повторялись
const art = (t) => t.photo
  ? `<div class="art photo"><img src="${esc(t.photo)}" alt="${esc(t.name)}" loading="lazy"></div>`
  : `<div class="art"><span aria-hidden="true">${S.kinds[t.kind].glyph}</span></div>`;

// ---------- каталог ----------
const GROUPS = [["all", "Все"], ["gaba", "ГАБА"], ["oolong", "Улуны"], ["red", "Красный чай"], ["puer", "Пуэры"]];
function renderCatalog() {
  let list = S.teas.filter((t) =>
    (S.group === "all" || S.kinds[t.kind].group === S.group) &&
    (!S.query || `${t.name} ${t.notes} ${S.kinds[t.kind].label} ${t.region}`.toLowerCase().includes(S.query)));
  if (S.sort === "asc") list = [...list].sort((a, b) => a.prices["50"] - b.prices["50"]);
  if (S.sort === "desc") list = [...list].sort((a, b) => b.prices["50"] - a.prices["50"]);
  list = [...list].sort((a, b) => b.available - a.available);
  $("#view").innerHTML = `
    <section class="hero">
      <div class="eyebrow">Китайский чай. Свой ритм.</div>
      <h1>Хороший чай. <em>Время для себя.</em></h1>
      <p>Тёплая чашка, глубокий вкус и немного времени для себя. Каждый чай можно взять по 20 г на пробу.</p>
      <a class="btn" href="#quiz">🍵 Подобрать мой чай</a>
    </section>
    <label class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Найти свой чай" value="${esc(S.query)}" autocomplete="off"></label>
    <div class="chips scroll" id="groups">${GROUPS.map(([k, l]) => `<button class="chip" data-g="${k}" aria-pressed="${S.group === k}">${l}</button>`).join("")}
      <button class="chip" id="sort">${{ pop: "По умолчанию", asc: "Сначала дешевле", desc: "Сначала дороже" }[S.sort]} ⇅</button></div>
    ${!S.query && S.group === "all" && S.sets.length ? setsBanner() : ""}
    <p class="note">${list.length} из ${S.teas.length} · цены за 50 г · собираем под заказ</p>
    <div class="grid">${list.length ? list.map(cardHTML).join("") : `<p class="muted">Ничего не нашли. Попробуйте другое слово.</p>`}</div>`;
  $("#q").addEventListener("input", (e) => { S.query = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; renderCatalog(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); });
  $("#groups").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "sort") S.sort = { pop: "asc", asc: "desc", desc: "pop" }[S.sort]; else S.group = b.dataset.g;
    renderCatalog();
  });
}
const SET_PACKS = ["20", "50", "100"];
function setPrice(set, pack = "20") {
  const sum = set.teas.reduce((s, id) => s + (tea(id)?.prices[pack] || 0), 0);
  return { sum, final: sum - Math.round((sum * SET_DISCOUNT) / 10) * 10 };
}
// Короткий баннер в каталоге — сами наборы во вкладке «Наборы»
function setsBanner() {
  const from = Math.min(...S.sets.map((x) => setPrice(x).final));
  return `<a class="sets-banner" href="#sets"><span>🎁</span><span><b>Наборы чая</b><small>ГАБА, пуэры, улуны — по 20, 50 или 100 г, скидка 10%</small></span><span class="more-price">от ${rub(from)} →</span></a>`;
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
  $("#build").onclick = () => { S.builder = { ids: [], pack: "20" }; renderSets(); scrollTo(0, 0); };
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
  const groups = GROUPS.filter(([k]) => k !== "all").map(([k, l]) => [l, teas.filter((t) => S.kinds[t.kind].group === k)]).filter(([, l]) => l.length);
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
    saveCart(); toast(`Ваш набор (${B.ids.length} × ${B.pack} г) в корзине`); S.builder = null; location.hash = "#cart";
  };
}

function addSet(key) {
  const set = S.sets.find((s) => s.key === key); if (!set) return;
  const pack = S.setPack?.[key] || "20";
  const id = `${key}-${Date.now().toString(36)}`;
  set.teas.forEach((teaId) => S.cart.push({ teaId, pack, qty: 1, set: id }));
  saveCart(); toast(`Набор «${set.title}» по ${pack} г в корзине`);
}
function cardHTML(t) {
  return `<button class="card${t.available ? "" : " off"}" data-tea="${t.id}">${art(t)}
    <div class="card-body"><span class="type">${esc(S.kinds[t.kind].label)}</span><h3>${esc(t.name)}</h3>
    <div class="price">${t.available ? rub(t.prices["50"]) : "Нет в наличии"}<small>${t.available ? "50 г" : ""}</small></div></div></button>`;
}

// ---------- карточка чая ----------
function openTea(id) {
  const t = tea(id); if (!t) return;
  let pack = "50", qty = 1;
  const r = S.recipes[t.kind];
  const body = $("#tea-body");
  const draw = () => {
    const p = packInfo(t, pack);
    body.innerHTML = `<button class="close" aria-label="Закрыть">✕</button>${art(t)}
      <span class="type">${esc(S.kinds[t.kind].label)} · ${esc(t.region)}</span>
      <h2>${esc(t.name)}</h2><p class="muted">${esc(t.notes)}</p>
      <div class="tags"><span class="tag">Насыщенность: ${esc(t.strengthLabel.toLowerCase())}</span>${t.tastes.map((x) => `<span class="tag">${esc(S.tastes[x])}</span>`).join("")}</div>
      ${t.available ? `
      <div class="sizes" role="group" aria-label="Фасовка">${["20", "50", "100", "wholesale"].map((k) => `<button class="chip" data-p="${k}" aria-pressed="${k === pack}">${k === "wholesale" ? `Опт ${t.wholesale.grams} г` : `${k} г`}</button>`).join("")}</div>
      <div class="big-price">${rub(p.price * qty)} <small>${esc(p.label)}${qty > 1 ? ` × ${qty}` : ""}${pack === "wholesale" ? ` · ${rub(t.wholesale.perKg)}/кг` : ""}</small></div>
      <div class="row-actions"><div class="qty"><button data-q="-1" aria-label="Меньше">−</button><b>${qty}</b><button data-q="1" aria-label="Больше">+</button></div>
      <button class="btn" id="add">В корзину</button></div>` : `<p class="error">Сейчас нет в наличии. Напишите нам в бот, сообщим о поступлении.</p>`}
      <div class="block"><h4>Эффект и особенности</h4><p style="margin:0"><b>${esc(t.effect.state)}.</b> ${esc(t.effect.text)}</p>
        <p class="small muted" style="margin:8px 0 0">Ощущения зависят от заваривания и от человека. Чай содержит кофеин.</p></div>
      <div class="block"><h4>Как заваривать</h4>
        ${r ? `<div class="recipe"><div><span>Проливами</span>${esc(r[0])} на ${esc(r[1])}</div><div><span>Вода</span>${esc(r[2])}</div><div><span>Первый пролив</span>${esc(r[3])}</div><div><span>В кружке</span>${esc(S.mugRecipes[t.kind])}</div></div>` : ""}
      </div>`;
  };
  draw();
  body.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("close")) return $("#tea").close();
    if (b.dataset.p) { pack = b.dataset.p; draw(); }
    if (b.dataset.q) { qty = Math.min(20, Math.max(1, qty + Number(b.dataset.q))); draw(); }
    if (b.id === "add") { addToCart(t.id, pack, qty); $("#tea").close(); }
  };
  $("#tea").showModal();
}
$("#tea").addEventListener("click", (e) => { if (e.target.id === "tea") e.target.close(); });

function addToCart(teaId, pack, qty, set = "") {
  const ex = S.cart.find((i) => i.teaId === teaId && i.pack === pack && (i.set || "") === set);
  if (ex) ex.qty = Math.min(20, ex.qty + qty); else S.cart.push({ teaId, pack, qty, set });
  saveCart(); toast("Добавлено в корзину");
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
  black: "Близок к привычному чёрному чаю, только мягче и глубже.",
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

function quitQuiz() { newQuiz(); location.hash = "#catalog"; }

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

function whyText(x, a) {
  const parts = [];
  const gift = isGift(a);
  if (x.matched.length) parts.push(`${gift ? "Есть то, что нравится получателю" : "Есть ноты, которые вы выбрали"}: ${x.matched.map((m) => S.tastes[m].toLowerCase()).join(", ")}.`);
  const fam = a.drink.find((d) => x.t.quiz.familiar.includes(d) && DRINK_LIKE[d]);
  if (fam) parts.push(DRINK_LIKE[fam]);
  else if (!a.drink.includes("none")) parts.push(gift ? "Новый вкус в знакомых оттенках — хороший способ удивить." : (x.matched.length ? "По характеру дальше от выбранного напитка, зато в нём есть нужные ноты." : "Новый для вас вкус — попробуйте как открытие."));
  const c = x.t.quiz.caffeine;
  const morning = a.time.includes("morning"), evening = a.time.includes("evening");
  if (morning && c === 3) parts.push(evening ? "Этот — для утра: хорошо бодрит." : "Хорошо бодрит утром.");
  else if (evening && c === 3) parts.push("Вечером заваривайте коротко: так он бодрит мягче.");
  else if (evening) parts.push(morning ? "Этот — для вечера: спокойный, но кофеин в нём есть." : "Подходит для спокойного вечера, но кофеин в нём есть.");
  if (gift && x.t.quiz.mug) parts.push("Легко заварить даже в кружке.");
  return parts.join(" ");
}

function renderResults() {
  const a = S.quiz.a;
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
        <p>${esc(x.t.notes)}</p><p>${esc(whyText(x, a))}</p>
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
    saveCart(); toast("Набор в корзине"); location.hash = "#cart";
  });
  $("#again").onclick = () => { newQuiz(); renderQuiz(); };
  $("#home").onclick = quitQuiz;
  $("#more-btn")?.addEventListener("click", (e) => { e.currentTarget.hidden = true; $("#more").hidden = false; });
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
  if (tgApp?.close && inTelegram()) { toast("Напишите в чат с ботом, что ищете — продавец ответит"); setTimeout(() => tgApp.close(), 1200); }
  else location.href = BOT_LINK;
}

// ---------- корзина и оформление ----------
function cartLines() {
  const lines = S.cart.map((i, idx) => {
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

function renderCart() {
  S.cart = S.cart.filter((i) => tea(i.teaId));
  const { lines, discount, promoOff, total } = cartLines();
  if (!lines.length) {
    $("#view").innerHTML = `<div class="empty"><h2>Корзина пуста</h2><p>Откройте чай в каталоге или пройдите подбор.</p>
      <a class="btn" href="#quiz">🍵 Подобрать чай</a></div>`;
    return;
  }
  if (S.checkout) return renderCheckout(total);
  const off = lines.filter((l) => !l.t.available);
  $("#view").innerHTML = `<h2 class="section-title">Корзина</h2>
    ${lines.map((l) => `<div class="line"><div><h3>${esc(l.t.name)}</h3><div class="muted small">${esc(l.label)}${l.i.set ? " · в наборе" : ""}${l.t.available ? "" : " · <span class=error>нет в наличии</span>"}</div>
      <div class="qty" style="margin-top:8px"><button data-d="-1" data-i="${l.idx}" aria-label="Меньше">−</button><b>${l.i.qty}</b><button data-d="1" data-i="${l.idx}" aria-label="Больше">+</button></div></div>
      <div class="sum">${rub(l.sum)}</div></div>`).join("")}
    ${discount ? `<div class="line"><div class="muted">Скидка на набор</div><div class="sum">−${rub(discount)}</div></div>` : ""}
    ${inTelegram() ? `<div class="promo">${S.promo
      ? (promoOff
        ? `<div class="line" style="border:0"><div class="muted">Промокод ${esc(S.promo.code)} · ${esc(S.promo.label)}</div><div class="sum">−${rub(promoOff)}</div></div>`
        : `<p class="muted small" style="margin:0">Промокод ${esc(S.promo.code)} не складывается со скидкой набора. Он сработает на чаи, которые вы добавите отдельно.</p>`) +
        `<button class="link" id="promo-off">Убрать промокод</button>`
      : `<label class="search"><input id="promo" placeholder="Промокод" autocomplete="off"></label><button class="btn ghost" id="promo-go">Применить</button>`}
      <p class="error" id="promo-err"></p></div>` : ""}
    <div class="total"><span>Итого</span><span>${rub(total)}</span></div>
    ${S.freeFrom ? `<p class="free-left">${total >= S.freeFrom ? "🎁 Доставка до ПВЗ Яндекса и Ozon — бесплатно" : `🚚 До бесплатной доставки осталось ${rub(S.freeFrom - total)}`}</p>` : ""}
    <p class="note">Сумма без доставки. Чай собираем под заказ: продавец подтвердит наличие, доставку и сроки в чате с ботом. Оплата после подтверждения.</p>
    ${S.deliveryInfo ? `<details class="dl-info"><summary>Доставка: службы, цены, сроки</summary><p>${esc(S.deliveryInfo.replace(/^🚚 Доставка\n\n/, "")).replace(/\n/g, "<br>")}</p></details>` : ""}
    ${off.length ? `<p class="error">Уберите чаи, которых нет в наличии, чтобы оформить заказ.</p>` : ""}
    <button class="btn wide" id="go" ${off.length ? "disabled" : ""}>Оформить заказ</button>`;
  $("#view").onclick = (e) => {
    const b = e.target.closest("button[data-d]"); if (!b) return;
    const it = S.cart[Number(b.dataset.i)];
    it.qty += Number(b.dataset.d);
    if (it.qty < 1) S.cart.splice(Number(b.dataset.i), 1);
    else if (it.qty > 20) it.qty = 20;
    saveCart(); renderCart();
  };
  $("#go").onclick = () => { S.checkout = true; renderCart(); };
  $("#promo-off")?.addEventListener("click", () => { S.promo = null; renderCart(); });
  $("#promo-go")?.addEventListener("click", async () => {
    const code = $("#promo").value.trim(); if (!code) return;
    try {
      const r = await api("/api/promo?code=" + encodeURIComponent(code));
      if (!r.ok) { $("#promo-err").textContent = r.error; return; }
      S.promo = r; renderCart(); toast(cartLines().promoOff ? "Промокод применён" : "На наборы уже действует скидка");
    } catch (err) { $("#promo-err").textContent = err.message; }
  });
}

// Доставка: то же правило, что на сервере (src/catalog.js → deliveryCost)
function deliveryCost(k, total) {
  const d = S.delivery[k]; if (!d) return null;
  if (!d.price) return { cost: 0, free: false, text: "" };
  if (S.freeFrom && total >= S.freeFrom && d.free === "full") return { cost: 0, free: true, text: "бесплатно" };
  if (S.freeFrom && total >= S.freeFrom && d.free === "part") return { cost: d.price - 300, free: false, text: `≈${rub(d.price - 300)} (−300 ₽ от тарифа)` };
  return { cost: d.price, free: false, text: `≈${rub(d.price)}, точную сумму подтвердит продавец` };
}
function loadForm() { try { return JSON.parse(localStorage.getItem("form") || "{}"); } catch { return {}; } }
function renderCheckout(total) {
  const f = loadForm();
  const u = tgApp?.initDataUnsafe?.user;
  const dSel = S.delivery[f.delivery] ? f.delivery : "yandex";
  $("#view").onclick = null;
  $("#view").innerHTML = `<h2 class="section-title">Оформление</h2>
    ${inTelegram() ? "" : `<p class="error">Оформить заказ можно только из Telegram. <a href="${BOT_LINK}">Откройте магазин через бота</a>.</p>`}
    <form id="f" novalidate>
      <label>Имя<input id="f-name" name="name" required maxlength="80" value="${esc(f.name || u?.first_name || "")}"></label>
      <label>Телефон<input id="f-phone" name="phone" type="tel" required maxlength="30" placeholder="+7 900 000-00-00" value="${esc(f.phone || "")}"></label>
      <fieldset class="dl"><legend>Доставка</legend>${Object.entries(S.delivery).map(([k, d]) => {
        const c = deliveryCost(k, total);
        return `<label class="dl-opt"><input type="radio" name="delivery" value="${k}" ${k === dSel ? "checked" : ""}><span><b>${esc(d.label)}</b><small>${esc(d.note)}</small></span><span class="dl-price${c.free ? " free" : ""}">${c.free ? "бесплатно" : c.cost ? `≈${rub(c.cost)}` : "—"}</span></label>`;
      }).join("")}</fieldset>
      <label id="addr-wrap"><span id="addr-label">Город и адрес</span><input id="f-address" name="address" maxlength="300" value="${esc(f.address || "")}"></label>
      <label>Комментарий (необязательно)<textarea id="f-comment" name="comment" rows="3" maxlength="500"></textarea></label>
      <label class="consent"><input type="checkbox" id="f-consent" name="consent"> <span>Даю <a href="/consent" data-doc>согласие на обработку персональных данных</a> и принимаю <a href="/privacy" data-doc>политику конфиденциальности</a></span></label>
      <div class="total"><span>Итого за чай</span><span>${rub(total)}</span></div>
      <p class="muted small" id="dl-note" style="margin:0 0 10px"></p>
      <p class="error" id="err"></p>
      <button class="btn wide" id="send" ${inTelegram() ? "" : "disabled"}>Отправить заказ</button>
      <button class="link" type="button" id="back">← Вернуться в корзину</button>
    </form>`;
  const sync = () => {
    const k = $("#f input[name=delivery]:checked")?.value || "";
    const d = S.delivery[k];
    $("#addr-wrap").hidden = !d || !d.address;
    if (d?.address) $("#addr-label").textContent = d.address;
    const c = d && deliveryCost(k, total);
    $("#dl-note").textContent = !c ? "" : c.free ? `Доставка бесплатно — заказ от ${rub(S.freeFrom)}.` : !c.cost ? "Место и время встречи согласуем в чате." : `Доставка ${c.text}. Оплатите её вместе с заказом после подтверждения.`;
  };
  $("#f").addEventListener("change", sync); sync();
  $("#back").onclick = () => { S.checkout = false; renderCart(); };
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.consent = $("#f-consent").checked;
    if (!data.consent) { $("#err").textContent = "Отметьте согласие на обработку персональных данных."; return; }
    try { localStorage.setItem("form", JSON.stringify({ name: data.name, phone: data.phone, delivery: data.delivery, address: data.address })); } catch {}
    $("#send").disabled = true; $("#err").textContent = "";
    try {
      const { order } = await api("/api/orders", { method: "POST", body: JSON.stringify({ ...data, items: S.cart, promo: S.promo?.code || "" }) });
      S.cart = []; saveCart(); S.checkout = false; S.promo = null; if (S.me) S.me.firstOrder = false;
      $("#view").innerHTML = `<div class="empty"><h2>Заказ №${order.id} отправлен 🍵</h2><p>Продавец подтвердит наличие, сумму с доставкой и сроки в чате с ботом. Оплата после подтверждения.</p>
        <a class="btn" href="#orders">Мои заказы</a></div>`;
      try { tgApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
    } catch (err) { $("#err").textContent = err.message; $("#send").disabled = false; }
  };
}

// ---------- мои заказы ----------
async function renderOrders() {
  if (!inTelegram()) {
    $("#view").innerHTML = `<div class="empty"><h2>Мои заказы</h2><p>Заказы видны, когда магазин открыт через бота.</p><a class="btn" href="${BOT_LINK}">Открыть @sinitsa_chai_bot</a></div>`;
    return;
  }
  $("#view").innerHTML = `<h2 class="section-title">Мои заказы</h2><p class="muted">Загружаем…</p>`;
  try {
    const { orders } = await api("/api/orders");
    if (!orders.length) {
      $("#view").innerHTML = `<div class="empty"><h2>Пока нет заказов</h2><p>После оформления заказ появится здесь, а статусы будут приходить в чат.</p><a class="btn" href="#catalog">В каталог</a></div>`;
      return;
    }
    $("#view").innerHTML = `<h2 class="section-title">Мои заказы</h2>` + orders.map((o) => `
      <div class="line" style="display:block"><div style="display:flex;justify-content:space-between;gap:12px"><h3>Заказ №${o.id}</h3><span class="status ${o.status}">${esc(o.statusLabel)}</span></div>
      <div class="muted small">${o.items.map((i) => i.teaId ? `${esc(i.name)}, ${esc(i.label)} × ${i.qty}` : `${esc(i.name)}: −${rub(-i.sum)}`).join("<br>")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><b class="sum" style="color:var(--gold)">${rub(o.total)}</b>
      <span style="display:flex;gap:16px">${o.canCancel ? `<button class="link" data-cancel="${o.id}">Отменить</button>` : ""}
      <button class="link" data-repeat="${o.id}">Повторить</button></span></div></div>`).join("");
    S.lastOrders = orders;
    $("#view").onclick = async (e) => {
      const rp = e.target.closest("[data-repeat]");
      if (rp) {
        const o = S.lastOrders.find((x) => x.id === Number(rp.dataset.repeat));
        const setIds = {};
        let added = 0;
        for (const i of o.items) {
          const t = tea(i.teaId); if (!t || !t.available) continue;
          const set = i.set ? (setIds[i.set] ||= "rep-" + Math.random().toString(36).slice(2, 8)) : "";
          S.cart.push({ teaId: i.teaId, pack: i.pack, qty: i.qty, set }); added++;
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
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  $("#view").onclick = null;
  if (tab !== "cart") S.checkout = false;
  if (tab === "quiz") renderQuiz();
  else if (tab === "cart") renderCart();
  else if (tab === "orders") renderOrders();
  else if (tab === "sets") renderSets();
  else renderCatalog();
}
document.addEventListener("click", (e) => {
  const doc = e.target.closest("a[data-doc]");
  if (doc && tgApp?.openLink) { e.preventDefault(); tgApp.openLink(location.origin + doc.getAttribute("href")); return; }
  const c = e.target.closest("[data-tea]");
  if (c) return openTea(c.dataset.tea);
  const st = e.target.closest("[data-set]");
  if (st) addSet(st.dataset.set);
});
window.addEventListener("hashchange", route);

(async function init() {
  loadCart(); updateBadge();
  try {
    const data = await api("/api/catalog");
    Object.assign(S, { teas: data.teas, kinds: data.kinds, recipes: data.recipes, mugRecipes: data.mugRecipes, tastes: data.tastes, sets: data.sets || [], delivery: data.delivery || {}, freeFrom: data.freeDeliveryFrom || 0, deliveryInfo: data.deliveryInfo || "" });
    if (inTelegram()) api("/api/me").then((me) => (S.me = me)).catch(() => {});
  } catch {
    $("#view").innerHTML = `<div class="empty"><h2>Не удалось загрузить каталог</h2><p>Проверьте интернет и откройте магазин ещё раз.</p></div>`;
    return;
  }
  // Раздел, с которого открыли приложение из бота: ?tab=quiz | orders | cart
  const tab = new URLSearchParams(location.search).get("tab");
  if (["quiz", "orders", "cart", "catalog", "sets"].includes(tab)) history.replaceState(null, "", `${location.pathname}#${tab}`);
  else if (!/^#(quiz|orders|cart|catalog|sets)$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#catalog`);
  route();
})();
