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
    ${!S.query && S.group === "all" && S.sets.length ? setsHTML() : ""}
    <p class="note">${list.length} из ${S.teas.length} · цены за 50 г · собираем под заказ</p>
    <div class="grid">${list.length ? list.map(cardHTML).join("") : `<p class="muted">Ничего не нашли. Попробуйте другое слово.</p>`}</div>`;
  $("#q").addEventListener("input", (e) => { S.query = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; renderCatalog(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); });
  $("#groups").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "sort") S.sort = { pop: "asc", asc: "desc", desc: "pop" }[S.sort]; else S.group = b.dataset.g;
    renderCatalog();
  });
}
function setPrice(set) {
  const sum = set.teas.reduce((s, id) => s + (tea(id)?.prices["20"] || 0), 0);
  return { sum, final: sum - Math.round((sum * SET_DISCOUNT) / 10) * 10 };
}
function setsHTML() {
  return `<h2 class="section-title" style="padding-top:8px">Наборы по 20 г</h2>
    <p class="note" style="margin-top:0">Готовые сочетания со скидкой 10%. Каждый чай по 20 г.</p>
    <div class="sets">${S.sets.map((set) => {
      const p = setPrice(set);
      return `<div class="set"><div class="set-e">${set.emoji}</div><h3>${esc(set.title)}</h3><p class="muted small">${esc(set.text)}</p>
        <p class="small">${set.teas.map((id) => esc(tea(id)?.name || "")).join(" · ")}</p>
        <div class="big-price" style="font-size:22px">${rub(p.final)} <small><s>${rub(p.sum)}</s></small></div>
        <button class="btn wide" data-set="${set.key}">В корзину</button></div>`;
    }).join("")}</div>`;
}
function addSet(key) {
  const set = S.sets.find((s) => s.key === key); if (!set) return;
  const id = `${key}-${Date.now().toString(36)}`;
  set.teas.forEach((teaId) => S.cart.push({ teaId, pack: "20", qty: 1, set: id }));
  saveCart(); toast(`Набор «${set.title}» в корзине`);
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
  { key: "drink", multi: true, exclusive: "none", title: "Что вы обычно пьёте?", hint: "Можно выбрать несколько. Отталкиваемся от привычного вкуса", options: [
    ["black", "☕", "Чёрный чай в пакетиках"], ["coffee", "🫘", "Кофе"], ["green", "🍃", "Зелёный чай"],
    ["herbal", "🌼", "Травяной или фруктовый"], ["none", "✨", "Ничего особенного", "хочу попробовать новое"]],
    gift: { title: "Что обычно пьёт тот, кому дарите?", labels: { none: ["Не знаю", "подберём универсальный вкус"] } } },
  { key: "time", multi: true, title: "Когда будете пить?", hint: "Можно выбрать несколько. От этого зависит, насколько бодрым подобрать чай", options: [
    ["morning", "🌅", "Утром, чтобы проснуться"], ["day", "💻", "Днём, за делами"], ["evening", "🌙", "Вечером, без спешки"], ["food", "🍽", "После еды"]],
    gift: { title: "Когда этот человек обычно пьёт чай?" } },
  { key: "likes", multi: true, exclusive: "any", title: "Что вам нравится?", hint: "Можно выбрать несколько", options: [
    ["honey", "🍯", "Мёд и выпечка"], ["fruit", "🍑", "Фрукты и сухофрукты"], ["flowers", "🌸", "Цветы"], ["nuts", "🌰", "Орехи и карамель"],
    ["fresh", "🌿", "Свежая зелень"], ["forest", "🌲", "Лес и дерево"], ["spice", "🌶", "Пряности"], ["any", "🤷", "Не знаю, всё подряд"]],
    gift: { title: "Что нравится тому, кому дарите?", labels: { any: ["Не знаю"] } } },
  { key: "dislikes", multi: true, exclusive: "none", title: "Что точно не нравится?", hint: "Уберём такие чаи из подбора", options: [
    ["bitter", "😖", "Горечь и терпкость"], ["earthy", "🍂", "«Земляной» вкус", "как у тёмного пуэра"], ["strong", "⚡", "Слишком бодрящее"],
    ["none", "👌", "Ничего, готов пробовать"]],
    gift: { title: "Что точно не понравится?", labels: { none: ["Не знаю"] } } },
  { key: "brew", title: "Как будете заваривать?", hint: "Некоторые чаи горчат, если долго стоят в кружке", options: [
    ["mug", "🫖", "В кружке или заварочном чайнике"], ["gaiwan", "🍶", "В гайвани, проливами", "маленький сосуд, много коротких заварок"], ["unknown", "🤔", "Пока не знаю"]],
    gift: { title: "Как будут заваривать?" } },
];
const LIKE_TO_TASTE = { honey: ["honey", "bread"], fruit: ["fruity"], flowers: ["floral"], nuts: ["nutty"], fresh: ["herbal"], forest: ["woody"], spice: ["spicy"], any: [] };
const DRINK_LABEL = { black: "чёрный чай", coffee: "кофе", green: "зелёный чай", herbal: "травяной чай" };
const isGift = (a) => a.who === "gift";

function newQuiz() { S.quiz = { step: 0, a: { who: "", drink: [], time: [], likes: [], dislikes: [], brew: "" } }; }

function renderQuiz() {
  if (!S.quiz) newQuiz();
  const { step, a } = S.quiz;
  if (step >= QUESTIONS.length) return renderResults();
  const q = QUESTIONS[step];
  const g = isGift(a) && q.gift ? q.gift : {};
  const opts = q.options.map(([v, e, l, sub]) => (g.labels?.[v] ? [v, e, g.labels[v][0], g.labels[v][1]] : [v, e, l, sub]));
  const sel = (v) => (q.multi ? a[q.key].includes(v) : a[q.key] === v);
  const ready = q.multi ? a[q.key].length > 0 : !!a[q.key];
  $("#view").innerHTML = `<div class="quiz-head"><div class="eyebrow">Подбор чая · вопрос ${step + 1} из ${QUESTIONS.length}</div>
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
      a[q.key] = arr; renderQuiz();
    } else { a[q.key] = v; S.quiz.step++; renderQuiz(); }
  };
  $("#back")?.addEventListener("click", () => { S.quiz.step--; renderQuiz(); });
  $("#next")?.addEventListener("click", () => { S.quiz.step++; renderQuiz(); });
  window.scrollTo(0, 0);
}

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
  if (a.brew !== "gaiwan" && !q.mug) return null;
  const wanted = a.likes.flatMap((l) => LIKE_TO_TASTE[l]);
  const matched = [...new Set(t.tastes.filter((x) => wanted.includes(x)))];
  let s = matched.length * 3 - (wanted.length && !matched.length ? 2 : 0);
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

function pickThree(a) {
  const scored = S.teas.map((t) => scoreTea(t, a)).filter(Boolean).sort((x, y) => y.s - x.s || x.t.prices["50"] - y.t.prices["50"]);
  if (!scored.length) return [];
  const safe = scored[0];
  const used = new Set([safe.t.id]);
  const group = (x) => S.kinds[x.t.kind].group;
  const bolder = scored.find((x) => !used.has(x.t.id) && group(x) !== group(safe)) || scored.find((x) => !used.has(x.t.id));
  if (bolder) used.add(bolder.t.id);
  const discovery = scored.find((x) => !used.has(x.t.id) && !a.drink.some((d) => x.t.quiz.familiar.includes(d)) && x.matched.length) || scored.find((x) => !used.has(x.t.id));
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
  if (x.matched.length) parts.push(`${gift ? "Есть то, что нравится получателю" : "Есть то, что вы любите"}: ${x.matched.map((m) => S.tastes[m].toLowerCase()).join(", ")}.`);
  const fam = a.drink.filter((d) => x.t.quiz.familiar.includes(d) && DRINK_LABEL[d]);
  if (fam.length) parts.push(`Понятный вкус для тех, кто пьёт ${fam.map((d) => DRINK_LABEL[d]).join(" или ")}.`);
  else if (!a.drink.includes("none")) parts.push(gift ? "Новый вкус в знакомых оттенках — хороший способ удивить." : "Новый для вас вкус, но в знакомых оттенках.");
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
      <button class="btn" id="again">Пройти заново</button></div>`;
    $("#again").onclick = () => { newQuiz(); renderQuiz(); };
    return;
  }
  const mug = a.brew !== "gaiwan";
  const sum = picks.reduce((s, [, x]) => s + x.t.prices["20"], 0);
  const disc = Math.round((sum * SET_DISCOUNT) / 10) * 10;
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
    ${picks.length === 3 ? `<div class="trial"><div class="eyebrow">${isGift(a) ? "Подарочный набор" : "Пробный набор"}</div><h3>Все три по 20 г</h3>
      <p class="muted small">${isGift(a) ? "Три разных вкуса — пусть выберет свой. Скидка 10% на набор. Если нужна подарочная упаковка или открытка, напишите в комментарии к заказу." : "Попробуйте и поймите, какой ваш. Скидка 10% на набор."}</p>
      <div class="big-price">${rub(sum - disc)} <small><s>${rub(sum)}</s></small></div>
      <button class="btn wide" id="trial" style="margin-top:12px">Положить набор в корзину</button></div>` : ""}
    <button class="link" id="again">Пройти подбор заново</button>`;
  $("#trial")?.addEventListener("click", () => {
    const set = "quiz-" + Date.now().toString(36);
    picks.forEach(([, x]) => S.cart.push({ teaId: x.t.id, pack: "20", qty: 1, set }));
    saveCart(); toast("Набор в корзине"); location.hash = "#cart";
  });
  $("#again").onclick = () => { newQuiz(); renderQuiz(); };
  window.scrollTo(0, 0);
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
    if (g.length >= 3 && g.length <= 6 && new Set(g.map((l) => l.t.id)).size === g.length && g.every((l) => l.i.pack === "20" && l.i.qty === g[0].i.qty)) {
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
    <p class="note">Без доставки. Чай собираем под заказ: продавец подтвердит наличие, сумму с доставкой и сроки в чате с ботом. Оплата после подтверждения.</p>
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

function loadForm() { try { return JSON.parse(localStorage.getItem("form") || "{}"); } catch { return {}; } }
function renderCheckout(total) {
  const f = loadForm();
  const u = tgApp?.initDataUnsafe?.user;
  $("#view").onclick = null;
  $("#view").innerHTML = `<h2 class="section-title">Оформление</h2>
    ${inTelegram() ? "" : `<p class="error">Оформить заказ можно только из Telegram. <a href="${BOT_LINK}">Откройте магазин через бота</a>.</p>`}
    <form id="f" novalidate>
      <label>Имя<input id="f-name" name="name" required maxlength="80" value="${esc(f.name || u?.first_name || "")}"></label>
      <label>Телефон<input id="f-phone" name="phone" type="tel" required maxlength="30" placeholder="+7 900 000-00-00" value="${esc(f.phone || "")}"></label>
      <label>Способ получения<select id="f-delivery" name="delivery"><option value="delivery">Доставка</option><option value="pickup" ${f.delivery === "pickup" ? "selected" : ""}>Самовывоз</option></select></label>
      <label id="addr-wrap">Город и адрес<input id="f-address" name="address" maxlength="300" value="${esc(f.address || "")}"></label>
      <label>Комментарий (необязательно)<textarea id="f-comment" name="comment" rows="3" maxlength="500"></textarea></label>
      <label class="consent"><input type="checkbox" id="f-consent" name="consent"> <span>Даю <a href="/consent" data-doc>согласие на обработку персональных данных</a> и принимаю <a href="/privacy" data-doc>политику конфиденциальности</a></span></label>
      <div class="total"><span>Итого</span><span>${rub(total)}</span></div>
      <p class="error" id="err"></p>
      <button class="btn wide" id="send" ${inTelegram() ? "" : "disabled"}>Отправить заказ</button>
      <button class="link" type="button" id="back">← Вернуться в корзину</button>
    </form>`;
  const sync = () => ($("#addr-wrap").hidden = $("#f-delivery").value === "pickup");
  $("#f-delivery").onchange = sync; sync();
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
    Object.assign(S, { teas: data.teas, kinds: data.kinds, recipes: data.recipes, mugRecipes: data.mugRecipes, tastes: data.tastes, sets: data.sets || [] });
    if (inTelegram()) api("/api/me").then((me) => (S.me = me)).catch(() => {});
  } catch {
    $("#view").innerHTML = `<div class="empty"><h2>Не удалось загрузить каталог</h2><p>Проверьте интернет и откройте магазин ещё раз.</p></div>`;
    return;
  }
  // Раздел, с которого открыли приложение из бота: ?tab=quiz | orders | cart
  const tab = new URLSearchParams(location.search).get("tab");
  if (["quiz", "orders", "cart", "catalog"].includes(tab)) history.replaceState(null, "", `${location.pathname}#${tab}`);
  else if (!/^#(quiz|orders|cart|catalog)$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#catalog`);
  route();
})();
