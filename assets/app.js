(function () {
  "use strict";

  const CFG = window.WARDROBE_CONFIG || {};
  const TG = String(CFG.telegram || "").replace(/^@/, "").trim();

  const CATS = [
    ["", "всё"], ["clothes", "одежда"], ["shoes", "обувь"], ["bags", "сумки и рюкзаки"], ["accessories", "аксессуары"],
    ["jewelry", "украшения"], ["beauty", "косметика и уход"], ["tech", "техника"], ["dishes", "посуда"],
    ["home", "товары для дома"], ["repair", "ремонт"], ["craft", "творчество"], ["stationery", "канцелярия"],
    ["toys", "игрушки"], ["decor", "декор"], ["library", "библиотека"], ["other", "разное"]
  ];
  const LIB_SUBS = ["подборка", "художественная", "поэзия", "психология", "искусство и музыка", "учебная и справочная", "журналы", "другие издания"];
  // черновики видны только по ссылке с ?drafts
  const SHOW_DRAFTS = /[?&]drafts\b/.test(location.search);
  const CAT = Object.fromEntries(CATS);
  const BOOK_INTENTS = {
    try: { label: "хочу одолжить почитать", msg: "хочу одолжить почитать" },
    take: { label: "хочу купить / забрать", msg: "хочу купить" }
  };
  const intentsFor = (i) => (i && i.category === "library" ? Object.assign({}, INTENTS, BOOK_INTENTS) : INTENTS);
  const INTENTS = {
    try: { label: "хочу примерить / посмотреть вживую", msg: "хочу примерить" },
    take: { label: "хочу забрать", msg: "хочу забрать" },
    queue: { label: "встать в очередь", msg: "встану в очередь" }
  };
  const PHOTO_NOTE = {
    ai: "ai-фото — цвет, посадка и детали могут отличаться",
    tryon: "Виртуальная примерка — посадка приблизительная",
    fragment: "",
    model: "фото этой модели из интернета",
    defect: "дефект"
  };
  const T = {
    added: "добавлено в моё ♡",
    queued: "ты в очереди ♡",
    removed: "передумать тоже нормально",
    copied: "заявка скопирована ♡",
    copyFail: "не получилось скопировать :( попробуй ещё раз",
    reserved: "эта вещь уже забронирована :( но можно встать в очередь",
    given: "эта вещь уже в других руках :(",
    none: "ничего не нашлось :(",
    noFree: "свободных вещей здесь пока нет :(",
    error: "что-то пошло не так :(",
    market: "примерная стоимость — ориентир по вторичному рынку, а не цена продажи",
    nominal: "сколько такая вещь стоит новой сейчас — ориентир по рознице, а не цена, за которую я её отдаю",
    estimate: "это ориентир по объявлениям, а не подтверждённые продажи."
  };

  // ---------- хранилище в браузере (может быть недоступно) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ovtd:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ovtd:" + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  const state = {
    items: [],
    cat: "", sub: "", libSub: "", varSel: {}, deal: "", onlyFree: false, onlyLiked: false,
    likes: new Set(store.get("likes", [])),
    mine: store.get("mine", {}),            // id -> { intent, on }
    user: store.get("user", { name: "", tg: "", comment: "" })
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rub = (n) => Number(n).toLocaleString("ru-RU") + " ₽";
  const rubRange = (a, b) => a === b ? rub(a) : Number(a).toLocaleString("ru-RU") + "–" + rub(b);
  function nominalText(i) {
    const n = i.nominal;
    if (!n) return "";
    if (n.text) return n.text;
    return "≈ " + rubRange(n.min, n.max);
  }
  const ruDate = (d) => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d || ""); };
  const byId = (id) => state.items.find((i) => i.id === id);
  const saveLikes = () => store.set("likes", Array.from(state.likes));
  const saveMine = () => { store.set("mine", state.mine); updateMineCount(); };

  // ---------- toast ----------
  let toastTimer;
  function toast(text) {
    const el = $("#toast");
    const host = document.querySelector("dialog[open]:last-of-type") || document.body;
    const open = Array.from(document.querySelectorAll("dialog[open]"));
    (open.length ? open[open.length - 1] : host).appendChild(el);
    el.textContent = text;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2400);
  }

  // ---------- данные вещи ----------
  function norm(i) {
    const photos = (i.photos || []).map((p) => (typeof p === "string" ? { src: p, kind: "real" } : p)).filter((p) => p && p.src);
    return Object.assign({}, i, {
      photos,
      condition: i.condition || {},
      deal: i.deal || { mode: "give" },
      defects: i.defects || [],
      features: i.features || [],
      specs: i.specs || [],
      todo: i.todo || [],
      status: i.status || "available"
    });
  }
  function titleOf(i) {
    if (i.title) return i.title;
    return [i.brand, i.model || i.type].filter(Boolean).join(" · ") || "без названия";
  }
  function condText(i) {
    const c = i.condition;
    return [c.label, c.score != null && c.score !== "" ? c.score + "/10" : ""].filter(Boolean).join(" · ");
  }
  function condRank(i) {
    const c = i.condition, s = Number(c.score) || 0;
    if (c.label === "новая") return 2000 + s;
    if (c.label === "как новая") return 1000 + s;
    return s * 10;
  }
  function dealShort(i) {
    const d = i.deal;
    if (d.mode === "donate") return "донат от " + rub(d.amount);
    if (d.mode === "price") return rub(d.amount);
    if (d.mode === "tbd") return CFG.priceTbd || "цена уточняется";
    if (d.mode === "label") return d.text || "";
    if (d.mode === "pwyw") return d.amount ? "≈ " + rub(d.amount) + (d.per ? " " + d.per : "") : "бесплатно / символически";
    return "отдаю";
  }
  const PODGON_LINK = `<a class="link" href="#podgon">идеи для подгона →</a>`;
  function dealSub(i) {
    if (i.deal.mode === "pwyw") return `${esc(i.category === "library" ? CFG.pwywBooks : CFG.pwyw)} · ${PODGON_LINK}`;
    if (i.deal.mode === "give") return `донат или подгон по желанию · ${PODGON_LINK}`;
    if (i.deal.mode === "donate") return `или эквивалентный подгон · ${PODGON_LINK}`;
    return "";
  }
  function effectiveIntent(item, saved) {
    if (item.status === "reserved") return "queue";
    if (!saved || saved === "queue") return "take";
    return saved;
  }

  // ---------- оформление страницы из config ----------
  function applyConfig() {
    if (CFG.title) {
      document.title = CFG.title + (CFG.slogan ? " — " + CFG.slogan : "");
      $("#logo").textContent = CFG.title;
      const h = $("#site-heading");
      const lines = CFG.titleLines && CFG.titleLines.length ? CFG.titleLines : [CFG.title];
      h.setAttribute("aria-label", CFG.title);
      h.innerHTML = lines.map((l) => `<span class="tl">${esc(l)}</span>`).join("");
    }
    if (CFG.slogan) $("#slogan").textContent = CFG.slogan;
    $("#intro-text").innerHTML = (CFG.intro || []).map((p) => `<p>${esc(p)}</p>`).join("");
    if (CFG.ticker) {
      $("#ticker-track").innerHTML = `<span>${esc(CFG.ticker)}&nbsp;</span>`.repeat(12);
      $("#ticker").hidden = false;
    }
    const rules = (CFG.handover || []).map((r) => `<li>${esc(r)}</li>`).join("");
    $("#foot-rules").innerHTML = rules;
    $("#mine-rules").innerHTML = rules;
    if (TG) {
      $("#foot-tg").href = "https://t.me/" + encodeURIComponent(TG);
      $("#foot-tg").textContent = "telegram @" + TG + " ↗";
      $("#send").href = "https://t.me/" + encodeURIComponent(TG);
    } else {
      $("#foot-tg").hidden = true;
    }
    renderPodgon();
  }

  function renderPodgon() {
    const p = CFG.podgon || {};
    const list = (arr) => `<ol class="podgon__list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
    let html = p.intro ? `<p class="podgon__intro">${esc(p.intro)}</p>` : "";
    if (p.items && p.items.length) html += list(p.items);
    if (p.permanent && p.permanent.length) html += `<h2 class="podgon__h">постоянные направления</h2>${list(p.permanent)}`;
    if (p.wishes && p.wishes.length) html += `<h2 class="podgon__h">актуальные хотелки</h2>${list(p.wishes)}`;
    if (p.outro) html += `<p class="podgon__outro">${esc(p.outro)}</p>`;
    $("#podgon-body").innerHTML = html;
  }

  // ---------- загрузка ----------
  async function load() {
    try {
      const res = await fetch("data/items.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const raw = await res.json();
      // порядок — как в items.json; черновики показываются только по ссылке с ?drafts
      state.items = raw.map(norm).filter((i) => SHOW_DRAFTS || i.status !== "draft");
    } catch (e) {
      $("#empty").textContent = T.error;
      $("#empty").hidden = false;
      return;
    }
    Object.keys(state.mine).forEach((id) => { if (!byId(id)) delete state.mine[id]; });
    saveMine();
    buildChips();
    render();
    renderArchive();
    buildLibrary();
    buildCollage();
    route();
  }

  // ---------- каталог ----------
  function buildChips() {
    const chips = $("#cat-chips");
    chips.innerHTML = CATS.map(([id, label]) =>
      `<button class="chip" role="tab" data-cat="${id}" aria-selected="${state.cat === id}">${label}</button>`).join("");
    // показываем только категории, в которых есть вещи
    const used = new Set(catalog().map((i) => i.category));
    chips.innerHTML = CATS.filter(([id]) => !id || id === "library" || used.has(id)).map(([id, label]) =>
      id === "library"
        ? `<a class="chip" href="#library">${label} →</a>`
        : `<button class="chip" role="tab" data-cat="${id}" aria-selected="${state.cat === id}">${label}</button>`).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      state.cat = b.dataset.cat;
      state.sub = "";
      chips.querySelectorAll("[data-cat]").forEach((x) => x.setAttribute("aria-selected", x === b));
      buildSubChips();
      render();
    });
    $("#sub-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sub]");
      if (!b) return;
      state.sub = b.dataset.sub;
      $("#sub-chips").querySelectorAll("[data-sub]").forEach((x) => x.setAttribute("aria-selected", x === b));
      render();
    });
    $("#f-deal").onchange = (e) => { state.deal = e.target.value; render(); };
    $("#f-free").onchange = (e) => { state.onlyFree = e.target.checked; render(); };
    $("#f-liked").onchange = (e) => { state.onlyLiked = e.target.checked; render(); };
  }

  function inRange(i, r) {
    if (i.deal.mode !== "pwyw") return false;
    const [a, b] = r.split("-");
    const x = Number(i.deal.amount) || 0;
    return x >= Number(a) && (b === "" || x <= Number(b));
  }
  function catalog() { return state.items.filter((i) => i.status !== "archive" && i.category !== "library"); }

  function subsOf(list) {
    const out = [];
    list.forEach((i) => { if (i.subcategory && !out.includes(i.subcategory)) out.push(i.subcategory); });
    return out;
  }
  function buildSubChips() {
    const box = $("#sub-chips");
    const subs = state.cat ? subsOf(catalog().filter((i) => i.category === state.cat)) : [];
    box.hidden = subs.length < 2;
    box.innerHTML = [["", "все"]].concat(subs.map((x) => [x, x])).map(([id, label]) =>
      `<button class="chip" role="tab" data-sub="${esc(id)}" aria-selected="${state.sub === id}">${esc(label)}</button>`).join("");
  }

  function render() {
    const base = catalog().filter((i) =>
      (!state.cat || i.category === state.cat) &&
      (!state.sub || i.subcategory === state.sub) &&
      (!state.deal || inRange(i, state.deal)) &&
      (!state.onlyLiked || state.likes.has(i.id)));
    const list = state.onlyFree ? base.filter((i) => i.status === "available") : base;
    $("#grid").innerHTML = list.map(cardHTML).join("");
    const empty = $("#empty");
    empty.hidden = list.length > 0;
    empty.textContent = state.onlyFree && base.length ? T.noFree : T.none;

    const given = state.items.filter((i) => i.status === "archive").length;
    const gc = $("#given-counter");
    gc.hidden = given === 0;
    gc.textContent = `уже в других руках — ${given}`;
  }

  function cardHTML(i) {
    const archived = i.status === "archive";
    const liked = state.likes.has(i.id);
    const meta = [i.author || i.subcategory, i.size, i.defects.length ? "есть дефект" : ""].filter(Boolean).map(esc).join(" · ");
    const status = i.status === "reserved" ? `<div class="card__status st-reserved">забронировано</div>`
      : archived ? `<div class="card__status st-archive">уже в других руках</div>`
      : i.status === "draft" ? `<div class="card__status st-draft">черновик</div>` : "";
    const price = i.deal.mode === "price";
    return `<article class="card${archived ? " is-archived" : ""}">
      <button class="card__img" data-open="${esc(i.id)}" aria-label="открыть: ${esc(titleOf(i))}"${i.photos.length > 1 ? ` data-photos="${esc(JSON.stringify(i.photos.map((p) => p.src)))}"` : ""}>
        <img src="${esc((i.photos[0] || {}).src || "")}" alt="${esc(titleOf(i))}" loading="lazy">
        ${i.photos.length > 1 ? `<span class="card__dots" aria-hidden="true">${i.photos.map((_, n) => `<i${n ? "" : ' class="on"'}></i>`).join("")}</span>` : ""}
      </button>
      ${archived ? "" : `<button class="like" data-like="${esc(i.id)}" aria-pressed="${liked}" aria-label="нравится">${liked ? "♥" : "♡"}</button>`}
      <div class="card__info">
        <button class="card__title" data-open="${esc(i.id)}">${esc(titleOf(i))}</button>
        ${meta ? `<div class="card__meta">${meta}</div>` : ""}
        ${nominalText(i) ? `<div class="card__nominal">номинальная цена: <span class="nw">${esc(nominalText(i))}</span></div>` : ""}
        ${i.is_collection ? `<div class="card__deal">${esc((i.books || []).length)} книг</div>` : `<div class="card__deal${price ? " is-price" : ""}${i.deal.mode === "tbd" ? " is-tbd" : ""}">${esc(dealShort(i))}</div>`}
        ${status}
      </div>
    </article>`;
  }

  function renderArchive() {
    const list = state.items.filter((i) => i.status === "archive")
      .sort((a, b) => String(b.added || "").localeCompare(String(a.added || "")));
    $("#archive-grid").innerHTML = list.map(cardHTML).join("");
    $("#archive-empty").hidden = list.length > 0;
    $("#archive-sub").textContent = list.length ? `уже в других руках — ${list.length}` : "";
  }

  // ---------- библиотека ----------
  function libItems() { return state.items.filter((i) => i.category === "library" && i.status !== "archive"); }
  function buildLibrary() {
    $("#lib-intro").textContent = (CFG.library || {}).intro || "";
    const present = subsOf(libItems());
    const subs = LIB_SUBS.filter((x) => present.includes(x)).concat(present.filter((x) => !LIB_SUBS.includes(x)));
    const box = $("#lib-chips");
    box.innerHTML = [["", "всё"]].concat(subs.map((x) => [x, x])).map(([id, label]) =>
      `<button class="chip" role="tab" data-lsub="${esc(id)}" aria-selected="${state.libSub === id}">${esc(label)}</button>`).join("");
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lsub]");
      if (!b) return;
      state.libSub = b.dataset.lsub;
      box.querySelectorAll("[data-lsub]").forEach((x) => x.setAttribute("aria-selected", x === b));
      renderLibrary();
    });
    renderLibrary();
  }
  function renderLibrary() {
    const order = (i) => { const k = LIB_SUBS.indexOf(i.subcategory); return k < 0 ? 99 : k; };
    const list = libItems().filter((i) => !state.libSub || i.subcategory === state.libSub)
      .map((i, n) => [i, n]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map((x) => x[0]);
    $("#lib-grid").innerHTML = list.map(cardHTML).join("");
  }

  // ---------- превью как на маркетплейсах: ведёшь мышью — фото меняются, на телефоне — свайп ----------
  function cardPhoto(box, n) {
    const list = JSON.parse(box.dataset.photos);
    n = Math.max(0, Math.min(list.length - 1, n));
    if (box.dataset.cur === String(n)) return;
    box.dataset.cur = String(n);
    box.querySelector("img").src = list[n];
    box.querySelectorAll(".card__dots i").forEach((d, k) => d.classList.toggle("on", k === n));
  }
  function bindPreview(grid) {
    grid.addEventListener("mousemove", (e) => {
      const box = e.target.closest(".card__img[data-photos]");
      if (!box) return;
      if (!box.dataset.pre) { box.dataset.pre = "1"; JSON.parse(box.dataset.photos).forEach((src) => { new Image().src = src; }); }
      const r = box.getBoundingClientRect();
      const n = JSON.parse(box.dataset.photos).length;
      cardPhoto(box, Math.floor((e.clientX - r.left) / r.width * n));
    });
    grid.addEventListener("mouseout", (e) => {
      const box = e.target.closest(".card__img[data-photos]");
      if (box && !box.contains(e.relatedTarget)) cardPhoto(box, 0);
    });
    let sx = 0, sy = 0, sbox = null;
    grid.addEventListener("touchstart", (e) => {
      sbox = e.target.closest(".card__img[data-photos]");
      if (sbox) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    grid.addEventListener("touchend", (e) => {
      if (!sbox) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
        cardPhoto(sbox, Number(sbox.dataset.cur || 0) + (dx < 0 ? 1 : -1));
        sbox.dataset.swiped = "1";
        setTimeout(() => { if (sbox) delete sbox.dataset.swiped; }, 400);
      }
    }, { passive: true });
  }

  function onGridClick(e) {
    const sw = e.target.closest("[data-swiped]");
    if (sw) return;
    const like = e.target.closest("[data-like]");
    if (like) { toggleLike(like.dataset.like); return; }
    const open = e.target.closest("[data-open]");
    if (open) openItem(open.dataset.open);
  }
  $("#grid").addEventListener("click", onGridClick);
  $("#archive-grid").addEventListener("click", onGridClick);
  $("#lib-grid").addEventListener("click", onGridClick);
  ["#grid", "#archive-grid", "#lib-grid"].forEach((g) => bindPreview($(g)));

  function toggleLike(id) {
    if (state.likes.has(id)) state.likes.delete(id); else state.likes.add(id);
    saveLikes();
    render();
    renderLibrary();
    if ($("#item-modal").open && currentId === id) renderItem(id);
  }

  // ---------- карточка вещи ----------
  let currentId = null;
  let viewHash = "";

  function openItem(id) {
    const item = byId(id);
    if (!item) return;
    currentId = id;
    renderItem(id);
    const m = $("#item-modal");
    if (!m.open) m.showModal();
    m.scrollTop = 0;
    history.replaceState(null, "", "#item-" + encodeURIComponent(id));
  }

  function renderItem(id) {
    const i = byId(id);
    const mine = state.mine[id];
    const liked = state.likes.has(id);
    const head = [CAT[i.category], i.subcategory || i.type].filter(Boolean).map(esc).join(" · ");

    const rows = i.specs.slice();
    if (i.brand) rows.push(["бренд", i.brand]);
    if (i.model) rows.push(["модель", i.model]);
    if (i.size) rows.push(["размер", [i.size, i.fit].filter(Boolean).join(" · ")]);
    else if (i.fit) rows.push(["посадка", i.fit]);
    if (i.author && !rows.some((r) => r[0] === "автор")) rows.push(["автор", i.author]);
    if (i.publisher) rows.push(["издательство", i.publisher]);
    if (i.opened === true) rows.push(["упаковка", "открыта"]);
    if (i.opened === false) rows.push(["упаковка", "не открыта"]);
    if (condText(i)) rows.push(["состояние", condText(i)]);
    const specs = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    const defects = i.defects.map((d) => `<p class="defect">есть дефект → ${esc(d)}</p>`).join("") +
      i.features.filter((f) => !i.defects.includes(f)).map((f) => `<p class="feature">${esc(f)}</p>`).join("");
    const e = i.estimate;
    const estimate = e && e.max ? `<div class="market">как я считала примерную стоимость
        <button class="market__q" aria-expanded="false" aria-label="что это">?</button>
        <span class="market__note" hidden>по похожим б/у вещам ≈ ${esc(rubRange(e.min, e.max))}. ${esc(T.estimate)}<br>
          ${esc(e.by_analogs ? "оценка по аналогам" : "по похожим предложениям")} · уверенность: ${esc(e.confidence)} · на ${esc(ruDate(e.date))}${e.note ? " · " + esc(e.note) : ""}
          ${(e.sources || []).length ? `<span class="sources">${e.sources.map((s) => s.url
            ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>` : `<span>${esc(s.title)}</span>`).join("")}</span>` : ""}
        </span></div>` : "";
    const todo = i.todo.length ? `<p class="todo">уточняется: ${esc(i.todo.join("; "))}</p>` : "";
    const draft = i.status === "draft" ? `<p class="defect">черновик, не показывается на сайте → ${esc(i.draft_reason || "")}</p>` : "";
    const mv = (state.mine[id] && state.mine[id].variants) || state.varSel[id] || [];
    const variants = i.variants ? `<div class="variants">
        <div class="variants__h">выбери, что хочешь — можно несколько <span id="var-count">${mv.length ? "· выбрано " + mv.length : ""}</span></div>
        <div class="variants__grid">${i.variants.map((v, k) => `<button class="var" data-var="${k}" aria-pressed="${mv.includes(k)}" title="${esc(v.label)}">
          <img src="${esc(v.src)}" alt="${esc(v.label)}" loading="lazy"><span>${esc(v.label)}</span></button>`).join("")}</div>
      </div>` : "";
    let rel = "";
    if (i.is_collection) {
      const books = (i.books || []).map(byId).filter(Boolean);
      rel = `<div class="books"><div class="books__h">книги из подборки — ${books.length}</div><ol class="books__list">${books.map((b) =>
        `<li><a class="link-btn" href="#item-${encodeURIComponent(b.id)}">${esc(b.title)}</a>${b.author ? ` <span>— ${esc(b.author)}</span>` : ""}</li>`).join("")}</ol></div>`;
    } else if (i.collection && byId(i.collection)) {
      rel = `<p class="rel">эта книга из <a class="link-btn" href="#item-${encodeURIComponent(i.collection)}">общей подборки →</a></p>`;
    }
    const market = i.market ? `<div class="market">примерная стоимость сейчас ≈ ${esc(rub(i.market))}
        <button class="market__q" aria-expanded="false" aria-label="что это">?</button>
        <span class="market__note" hidden>${esc(T.market)}</span></div>` : "";

    const photos = i.photos.length ? i.photos : [{ src: "", kind: "real" }];
    const slides = photos.map((p, n) => `<figure class="slide">
        <img src="${esc(p.src)}" alt="${esc(titleOf(i))}, фото ${n + 1}" ${n ? 'loading="lazy"' : ""}>
        ${PHOTO_NOTE[p.kind] ? `<figcaption class="slide__note${p.kind === "defect" ? " is-defect" : ""}">${PHOTO_NOTE[p.kind]}</figcaption>` : ""}
      </figure>`).join("");
    const many = photos.length > 1;

    let actions = "";
    const likeBtn = `<button class="btn btn--icon" id="m-like" aria-pressed="${liked}" aria-label="нравится">${liked ? "♥" : "♡"}</button>`;
    if (i.is_collection) {
      actions = `<p class="state-msg">выбери книги из списка — каждую можно добавить в «моё»</p><div class="row-actions">${likeBtn}</div>`;
    } else if (i.status === "archive") {
      actions = `<p class="state-msg">${T.given}</p>`;
    } else if (i.status === "reserved") {
      actions = `<p class="state-msg">${T.reserved}</p>` + (mine
        ? `<p class="ok-msg">${T.queued}</p><div class="row-actions"><button class="btn btn--ghost" id="m-remove">убрать из моего</button>${likeBtn}</div>`
        : `<div class="row-actions"><button class="btn btn--primary" id="m-queue">встать в очередь</button>${likeBtn}</div>`);
    } else {
      const cur = mine ? effectiveIntent(i, mine.intent) : "try";
      actions = `<fieldset class="intents"><legend class="sr-only">что хочешь</legend>
          ${["try", "take"].map((k) => `<label class="intent"><input type="radio" name="intent" value="${k}" ${cur === k ? "checked" : ""}><span>${intentsFor(i)[k].label}</span></label>`).join("")}
        </fieldset>
        <div class="row-actions">
          ${mine ? `<button class="btn btn--ghost" id="m-remove">убрать из моего</button>` : `<button class="btn btn--primary" id="m-add">добавить в моё</button>`}
          ${likeBtn}
        </div>`;
    }

    $("#item-body").innerHTML = `
      <div class="gallery">
        <div class="gallery__track" id="g-track">${slides}</div>
        ${many ? `<div class="gallery__bar">
          <button class="gallery__nav" data-dir="-1" aria-label="предыдущее фото">←</button>
          <span id="g-count">1 / ${photos.length}</span>
          <button class="gallery__nav" data-dir="1" aria-label="следующее фото">→</button>
        </div>` : ""}
      </div>
      <div class="details">
        <div class="details__head">${head}</div>
        <h2 class="details__title" id="m-title">${esc(titleOf(i))}</h2>
        <div class="deal">
          <div class="deal__main">${esc(dealShort(i))}</div>
          ${dealSub(i) ? `<div class="deal__sub">${dealSub(i)}</div>` : ""}
          ${nominalText(i) ? `<div class="deal__nominal">номинальная цена: <span class="nw">${esc(nominalText(i))}</span>
            <button class="market__q" aria-expanded="false" aria-label="что это">?</button>
            <span class="market__note" hidden>${esc(T.nominal)}${i.nominal.note ? " · " + esc(i.nominal.note) : ""}${i.nominal.date ? " · на " + esc(ruDate(i.nominal.date)) : ""}</span></div>` : ""}
        </div>
        ${specs ? `<dl class="specs">${specs}</dl>` : ""}
        ${i.description ? `<p class="comment">${esc(i.description)}</p>` : ""}
        ${draft}
        ${defects}
        ${todo}
        ${market}
        ${estimate}
        ${variants}
        ${rel}
        ${i.comment ? `<p class="comment">${esc(i.comment)}</p>` : ""}
        <div class="actions">${actions}</div>
      </div>`;

    const body = $("#item-body");
    const track = $("#g-track");
    if (many) {
      track.addEventListener("scroll", () => {
        const n = Math.round(track.scrollLeft / track.clientWidth) + 1;
        $("#g-count").textContent = `${n} / ${photos.length}`;
      }, { passive: true });
      body.querySelectorAll(".gallery__nav").forEach((b) => b.addEventListener("click", () =>
        track.scrollBy({ left: track.clientWidth * Number(b.dataset.dir), behavior: "smooth" })));
    }
    body.querySelectorAll(".market__q").forEach((q) => q.addEventListener("click", () => {
      const note = q.parentElement.querySelector(".market__note");
      note.hidden = !note.hidden;
      q.setAttribute("aria-expanded", String(!note.hidden));
    }));
    body.querySelectorAll(".var").forEach((b) => b.addEventListener("click", () => {
      const k = Number(b.dataset.var);
      const cur = new Set((state.mine[id] && state.mine[id].variants) || state.varSel[id] || []);
      if (cur.has(k)) cur.delete(k); else cur.add(k);
      const arr = Array.from(cur).sort((x, y) => x - y);
      state.varSel[id] = arr;
      if (state.mine[id]) { state.mine[id].variants = arr; saveMine(); }
      b.setAttribute("aria-pressed", String(cur.has(k)));
      $("#var-count").textContent = arr.length ? "· выбрано " + arr.length : "";
    }));
    const like = $("#m-like");
    if (like) like.addEventListener("click", () => toggleLike(id));
    body.querySelectorAll("input[name=intent]").forEach((r) => r.addEventListener("change", () => {
      if (state.mine[id]) { state.mine[id].intent = r.value; saveMine(); }
    }));
    const add = $("#m-add");
    if (add) add.addEventListener("click", () => {
      const v = (body.querySelector("input[name=intent]:checked") || {}).value || "try";
      state.mine[id] = { intent: v, on: true };
      if (state.varSel[id] && state.varSel[id].length) state.mine[id].variants = state.varSel[id];
      saveMine(); toast(T.added); renderItem(id);
    });
    const queue = $("#m-queue");
    if (queue) queue.addEventListener("click", () => {
      state.mine[id] = { intent: "queue", on: true };
      saveMine(); toast(T.queued); renderItem(id);
    });
    const rm = $("#m-remove");
    if (rm) rm.addEventListener("click", () => {
      delete state.mine[id];
      saveMine(); toast(T.removed); renderItem(id);
    });
  }

  // ---------- моё ----------
  function mineEntries() {
    return Object.entries(state.mine).map(([id, v]) => ({ id, v, item: byId(id) })).filter((x) => x.item);
  }
  function selected() {
    return mineEntries().filter((x) => x.v.on !== false && x.item.status !== "archive");
  }
  function updateMineCount() {
    $("#mine-count").textContent = mineEntries().filter((x) => x.item.status !== "archive").length;
  }

  function renderMine() {
    const list = mineEntries();
    $("#mine-empty").hidden = list.length > 0;
    $("#build").hidden = list.length === 0 || !$("#req").hidden;
    if (!list.length) $("#req").hidden = true;
    $("#mine-list").innerHTML = list.map(({ id, v, item }) => {
      const archived = item.status === "archive";
      const intent = effectiveIntent(item, v.intent);
      const opts = item.status === "reserved" ? ["queue"] : ["try", "take"];
      const control = archived
        ? `<p class="mine-item__state">${T.given}</p>`
        : `<select data-intent="${esc(id)}" aria-label="что хочешь">${opts.map((k) =>
            `<option value="${k}" ${intent === k ? "selected" : ""}>${intentsFor(item)[k].label}</option>`).join("")}</select>`;
      return `<div class="mine-item${archived ? " is-off" : ""}">
        <input type="checkbox" class="check" data-check="${esc(id)}" ${!archived && v.on !== false ? "checked" : ""} ${archived ? "disabled" : ""} aria-label="включить в заявку">
        <img src="${esc((item.photos[0] || {}).src || "")}" alt="">
        <div class="mine-item__body">
          <button class="mine-item__title" data-open="${esc(id)}">${esc(titleOf(item))}</button>
          ${item.variants ? `<span class="mine-item__state">${v.variants && v.variants.length ? "выбрано: " + esc(v.variants.map((k) => (item.variants[k] || {}).label).filter(Boolean).join(", ")) : "штуки не выбраны — открой и отметь"}</span>` : ""}
          ${control}
          <button class="remove" data-remove="${esc(id)}">убрать из моего</button>
        </div>
      </div>`;
    }).join("");
    $("#u-name").value = state.user.name || "";
    $("#u-tg").value = state.user.tg || "";
    $("#u-comment").value = state.user.comment || "";
    updatePreview();
  }

  function normTg(s) {
    s = String(s || "").trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/\s+/g, "");
    if (!s) return "";
    return s.startsWith("@") ? s : "@" + s;
  }

  function buildMessage() {
    const sel = selected();
    const head = sel.length > 1 ? "привет! хочу забрать несколько вещей с сайта:" : "привет! хочу забрать вещь с сайта:";
    const lines = sel.map(({ v, item }) => {
      const picked = item.variants && v.variants && v.variants.length
        ? ` (${v.variants.map((k) => item.variants[k] ? item.variants[k].label : "").filter(Boolean).join(", ")})` : "";
      return `• ${titleOf(item)}${picked} - ${intentsFor(item)[effectiveIntent(item, v.intent)].msg}`;
    });
    const name = (state.user.name || "").trim() || "…";
    const tg = normTg(state.user.tg) || "@…";
    let text = `${head}\n\n${lines.join("\n")}\n\nя - ${name}, ${tg}`;
    const c = (state.user.comment || "").trim();
    if (c) text += `\nкомментарий: ${c}`;
    return text;
  }
  function updatePreview() {
    const text = buildMessage();
    $("#preview").textContent = text;
    // текст сразу подставляется в поле сообщения в Telegram (параметр text у ссылки t.me)
    if (TG) $("#send").href = "https://t.me/" + encodeURIComponent(TG) + "?text=" + encodeURIComponent(text);
  }

  $("#mine-list").addEventListener("change", (e) => {
    const c = e.target.closest("[data-check]");
    if (c) { state.mine[c.dataset.check].on = c.checked; saveMine(); $("#sel-error").hidden = true; updatePreview(); return; }
    const s = e.target.closest("[data-intent]");
    if (s) { state.mine[s.dataset.intent].intent = s.value; saveMine(); updatePreview(); }
  });
  $("#mine-list").addEventListener("click", (e) => {
    const r = e.target.closest("[data-remove]");
    if (r) { delete state.mine[r.dataset.remove]; saveMine(); renderMine(); toast(T.removed); return; }
    const o = e.target.closest("[data-open]");
    if (o) openItem(o.dataset.open);
  });
  [["u-name", "name"], ["u-tg", "tg"], ["u-comment", "comment"]].forEach(([fid, key]) =>
    $("#" + fid).addEventListener("input", (e) => {
      state.user[key] = e.target.value;
      store.set("user", state.user);
      if (key === "name") $("#name-error").hidden = true;
      if (key === "tg") $("#tg-error").hidden = true;
      updatePreview();
    }));

  $("#build").addEventListener("click", () => {
    if (!selected().length) { $("#sel-error").hidden = false; return; }
    $("#sel-error").hidden = true;
    $("#req").hidden = false;
    $("#build").hidden = true;
    updatePreview();
    $("#req").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function copySync(text, host) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    host.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  $("#send").addEventListener("click", (e) => {
    if (!selected().length) { e.preventDefault(); $("#sel-error").hidden = false; return; }
    let bad = false;
    if (!(state.user.name || "").trim()) { $("#name-error").hidden = false; bad = true; }
    if (!normTg(state.user.tg)) { $("#tg-error").hidden = false; bad = true; }
    if (bad) { e.preventDefault(); return; }
    if (!TG) e.preventDefault();
    const text = buildMessage();
    if (copySync(text, $("#mine-modal"))) { toast(T.copied); return; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast(T.copied), () => toast(T.copyFail));
    } else {
      toast(T.copyFail);
    }
  });

  $("#mine-open").addEventListener("click", () => {
    renderMine();
    $("#mine-modal").showModal();
  });

  // ---------- окна ----------
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  });
  $("#item-modal").addEventListener("close", () => {
    currentId = null;
    if (/^#item-/.test(location.hash)) history.replaceState(null, "", viewHash || location.pathname + location.search);
    render();
    renderLibrary();
    if ($("#mine-modal").open) renderMine();
  });
  $("#mine-modal").addEventListener("close", () => { render(); $("#req").hidden = true; });

  // ---------- коллаж ----------
  // листы — как на референсах: вещи вперемешку внутри группы, сверху лицо, при наведении — оборот;
  // тонкая подпись-номер у каждой вещи и маленькая легенда внизу листа
  const TOPS = ["футболки и топы", "лонгсливы", "рубашки и блузы", "свитшоты и худи", "джемперы и кардиганы"];
  const PANELS = [
    ["платья и юбки", (i) => i.category === "clothes" && ["платья", "юбки"].includes(i.subcategory)],
    ["верх", (i) => i.category === "clothes" && TOPS.includes(i.subcategory)],
    ["обувь, сумки, аксессуары", (i) => ["shoes", "bags", "accessories"].includes(i.category)],
    ["брюки, джинсы, шорты", (i) => i.category === "clothes" && ["брюки", "джинсы", "шорты"].includes(i.subcategory)],
    ["украшения", (i) => i.category === "jewelry"],
    ["косметика и уход", (i) => i.category === "beauty"],
    ["дом, посуда, техника, ремонт", (i) => ["home", "dishes", "tech", "repair", "decor"].includes(i.category)],
    ["творчество, канцелярия, игрушки", (i) => ["craft", "stationery", "toys", "other"].includes(i.category)]
  ];
  const SHEET_STYLES = ["black", "grey", "white", "black", "grey", "white", "black", "grey"];
  // доля ширины листа (десктоп) по виду вещи
  function pieceWidth(i) {
    const s = i.subcategory;
    if (i.category === "clothes") return ["брюки", "джинсы", "шорты", "платья", "юбки"].includes(s) ? 0.135 : 0.145;
    if (i.category === "shoes") return 0.15;
    if (i.category === "bags") return 0.18;
    if (i.category === "jewelry") return 0.1;
    if (["beauty", "stationery", "toys", "craft"].includes(i.category)) return 0.11;
    return 0.13;
  }
  function seeded(str) {
    let h = 2166136261;
    for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }
  const scaleK = () => (window.innerWidth < 720 ? 2.15 : window.innerWidth < 1080 ? 1.4 : 1);
  // раскладка «лучший из кандидатов»: ширина листа = 1, высота подбирается, чтобы вещи лежали вольно и чуть перекрывались
  function scatter(items, k, seed) {
    const rnd = seeded(seed);
    const rawBoxes = items.map((i, n) => {
      const p = i.photos[0], ratio = p.w && p.h ? p.w / p.h : 0.8;
      return { n, ratio, w: pieceWidth(i) * k * (0.78 + rnd() * 0.5), rot: (rnd() - 0.5) * 14 };
    });
    const baseArea = rawBoxes.reduce((s, b) => s + b.w * b.w / b.ratio, 0);
    // небольшие листы — вещи крупнее, чтобы лист не выглядел пустым
    let H = Math.max(baseArea / 0.62, k > 1.8 ? 0.9 : 0.5);
    const f = Math.min(2.3, Math.max(1, Math.sqrt(H * 0.62 / baseArea)));
    const boxes = rawBoxes.map((b) => { const w = Math.min(0.44, b.w * f); return Object.assign(b, { w, h: w / b.ratio }); });
    const order = boxes.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    for (let attempt = 0; attempt < 14; attempt++) {
      const placed = []; let worst = 0;
      for (const b of order) {
        let best = null;
        for (let t = 0; t < 90; t++) {
          const x = rnd() * (1 - b.w), y = rnd() * Math.max(0.0001, H - b.h);
          let ov = 0, md = 9;
          for (const q of placed) {
            const s = 0.82;  // у вещи пустые углы — габарит чуть уменьшаем
            const ox = Math.min(x + b.w * (1 + s) / 2, q.x + q.w * (1 + s) / 2) - Math.max(x + b.w * (1 - s) / 2, q.x + q.w * (1 - s) / 2);
            const oy = Math.min(y + b.h * (1 + s) / 2, q.y + q.h * (1 + s) / 2) - Math.max(y + b.h * (1 - s) / 2, q.y + q.h * (1 - s) / 2);
            if (ox > 0 && oy > 0) ov += ox * oy;
            md = Math.min(md, Math.hypot((x + b.w / 2) - (q.x + q.w / 2), (y + b.h / 2) - (q.y + q.h / 2)));
          }
          const score = ov * 60 - Math.min(md, 0.5);   // меньше наложений, дальше от соседей — ровнее, но «хаотично»
          if (!best || score < best.score) best = { x, y, ov, score };
        }
        b.x = best.x; b.y = best.y; placed.push(b);
        worst = Math.max(worst, best.ov / (b.w * b.h));
      }
      if (worst < 0.18) break;
      H *= 1.07;
    }
    const maxY = Math.max.apply(null, boxes.map((b) => b.y + b.h));
    return { H: Math.max(maxY * 1.02, 0.3), boxes };
  }
  const priceOf = (i) => (i.deal && i.deal.mode === "pwyw" && i.deal.amount ? "≈ " + rub(i.deal.amount) : "");
  function pieceHTML(i, b, num, H) {
    const p1 = i.photos[1];
    return `<a class="piece${p1 ? " has-back" : ""}" href="#item-${esc(encodeURIComponent(i.id))}" data-open="${esc(i.id)}"
      style="left:${(b.x * 100).toFixed(2)}%;top:${(b.y / H * 100).toFixed(2)}%;width:${(b.w * 100).toFixed(2)}%;--r:${b.rot.toFixed(1)}deg;--ar:${b.ratio.toFixed(3)}" aria-label="${esc(titleOf(i))}">
      <span class="piece__box">
        <img class="p-front" src="${esc(i.photos[0].src)}" alt="${esc(titleOf(i))}" loading="lazy" decoding="async">
        ${p1 ? `<img class="p-back" data-src="${esc(p1.src)}" alt="" decoding="async">` : ""}
      </span>
      <span class="piece__no">${String(num).padStart(2, "0")}</span>
      <span class="piece__cap">${esc(titleOf(i))}${priceOf(i) ? " · " + esc(priceOf(i)) : ""}</span>
    </a>`;
  }
  let collageK = 0;
  function buildCollage() {
    const k = scaleK();
    collageK = k;
    const list = state.items.filter((i) => i.category !== "library" && i.status !== "archive" && i.photos.length);
    let sheetNo = 0;
    $("#collage").innerHTML = PANELS.map(([name, f], idx) => {
      const items = list.filter(f);
      if (!items.length) return "";
      sheetNo++;
      const sc = scatter(items, k, "sheet-" + name);
      const H = sc.H;
      let boxes = sc.boxes;
      const style = SHEET_STYLES[idx % SHEET_STYLES.length];
      const path = items.length <= 20 && style !== "black";
      let list2 = items;
      if (path) {
        // соединяем вещи тонкой линией «ближайший сосед» и нумеруем по ходу линии — как на афише с маршрутом
        const cx = (b) => b.x + b.w / 2, cy = (b) => b.y + b.h / 2;
        const left = boxes.slice(); const seq = [];
        let cur = left.splice(left.reduce((m, b, k2) => (cx(b) + cy(b) < cx(left[m]) + cy(left[m]) ? k2 : m), 0), 1)[0];
        seq.push(cur);
        while (left.length) {
          let bi = 0, bd = 9;
          left.forEach((b, k2) => { const d = Math.hypot(cx(b) - cx(cur), cy(b) - cy(cur)); if (d < bd) { bd = d; bi = k2; } });
          cur = left.splice(bi, 1)[0]; seq.push(cur);
        }
        list2 = seq.map((b) => items[b.n]);
        boxes = seq.map((b, n) => Object.assign({}, b, { n }));
      }
      const lines = path ? `<svg class="sheet__path" viewBox="0 0 1 ${H.toFixed(3)}" preserveAspectRatio="none" aria-hidden="true"><polyline vector-effect="non-scaling-stroke" points="${
        boxes.map((b) => `${(b.x + b.w / 2).toFixed(3)},${(b.y + b.h / 2).toFixed(3)}`).join(" ")}"/></svg>` : "";
      return `<section class="sheet sheet--${style}" aria-label="${esc(name)}">
        <div class="sheet__in">
          <header class="sheet__head"><span>${String(sheetNo).padStart(2, "0")} — ${esc(name)}</span><span>${items.length}</span></header>
          <div class="sheet__field" style="aspect-ratio:1 / ${H.toFixed(3)}">${lines}${boxes.map((b) => pieceHTML(list2[b.n], b, b.n + 1, H)).join("")}</div>
          <ol class="legend">${list2.map((i, n) => `<li><a href="#item-${esc(encodeURIComponent(i.id))}" data-open="${esc(i.id)}"><i>${String(n + 1).padStart(2, "0")}</i> ${esc(titleOf(i))}${priceOf(i) ? " · " + esc(priceOf(i)) : ""}</a></li>`).join("")}</ol>
        </div>
      </section>`;
    }).join("");
  }
  window.addEventListener("resize", () => {
    if (!collageK || scaleK() === collageK) return;
    clearTimeout(buildCollage._t);
    buildCollage._t = setTimeout(buildCollage, 150);
  });
  (function bindCollage() {
    const root = $("#collage");
    const load = (p) => { const b = p.querySelector(".p-back[data-src]"); if (b) { b.src = b.dataset.src; b.removeAttribute("data-src"); } };
    root.addEventListener("pointerover", (e) => { const p = e.target.closest(".piece"); if (p) load(p); });
    root.addEventListener("focusin", (e) => { const p = e.target.closest(".piece"); if (p) load(p); });
    root.addEventListener("click", (e) => {
      const p = e.target.closest("[data-open]");
      if (!p) return;
      e.preventDefault();
      const touch = window.matchMedia("(hover: none)").matches;
      if (touch && p.classList.contains("has-back") && !p.classList.contains("flip")) {
        root.querySelectorAll(".piece.flip").forEach((x) => x.classList.remove("flip"));
        load(p);
        p.classList.add("flip");     // на телефоне: первое касание — оборот, второе — карточка
        return;
      }
      openItem(p.dataset.open);
    });
  })();

  // режим главной: коллаж / списком
  function setMode(mode) {
    state.mode = mode === "list" ? "list" : "collage";
    $("#collage-wrap").hidden = state.mode !== "collage";
    $("#list-wrap").hidden = state.mode !== "list";
    $("#modes-hint").hidden = state.mode !== "collage";
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  }
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    const list = b.dataset.mode === "list";
    if (location.hash !== (list ? "#list" : "")) location.hash = list ? "#list" : "";
    if (!list && !location.hash) { setMode("collage"); history.replaceState(null, "", location.pathname + location.search); }
  }));

  // ---------- навигация ----------
  function showView(name) {
    ["catalog", "archive", "podgon", "library"].forEach((v) => { $("#view-" + v).hidden = v !== name; });
  }
  function route() {
    const h = location.hash;
    const m = h.match(/^#item-(.+)$/);
    if (m) {
      const item = byId(decodeURIComponent(m[1]));
      const view = !item ? "catalog" : item.status === "archive" ? "archive" : item.category === "library" ? "library" : "catalog";
      if (item && !$("#item-modal").open) showView(view);
      viewHash = view === "catalog" ? "" : "#" + view;
      openItem(decodeURIComponent(m[1]));
      return;
    }
    viewHash = h === "#archive" || h === "#podgon" || h === "#library" || h === "#list" ? h : "";
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    const name = h === "#archive" ? "archive" : h === "#podgon" ? "podgon" : h === "#library" ? "library" : "catalog";
    const wasHidden = $("#view-" + name).hidden;
    if (name === "catalog") setMode(h === "#list" ? "list" : "collage");
    showView(name);
    if (name === "catalog") fitTitle();
    if (name !== "catalog" || wasHidden) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  $("#to-items").addEventListener("click", () => $("#items-title").scrollIntoView({ behavior: "smooth" }));

  // ---------- название: подгон строк под ширину ----------
  function fitTitle() {
    const h = $("#site-heading");
    if (!h || !h.offsetParent) return;
    const w = h.clientWidth;
    h.querySelectorAll(".tl").forEach((line) => {
      let size = 100;
      for (let k = 0; k < 3; k++) {          // пара итераций — чтобы край совпал до пикселя
        line.style.fontSize = size + "px";
        const actual = line.getBoundingClientRect().width;
        if (!actual) return;
        size = size * w / actual;
      }
      line.style.fontSize = Math.floor(size * 100) / 100 + "px";
    });
  }
  let fitRaf;
  window.addEventListener("resize", () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitTitle); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);

  applyConfig();
  fitTitle();
  updateMineCount();
  load();
})();
