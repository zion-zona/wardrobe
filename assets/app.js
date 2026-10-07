(function () {
  "use strict";

  const CFG = window.WARDROBE_CONFIG || {};
  const TG = String(CFG.telegram || "").replace(/^@/, "").trim();

  const CATS = [
    ["", "всё"], ["clothes", "одежда"], ["shoes", "обувь"], ["bags", "сумки"],
    ["accessories", "аксессуары"], ["jewelry", "украшения"], ["books", "книги"],
    ["beauty", "косметика и уход"], ["toys", "игрушки"], ["home", "дом"], ["other", "другое"]
  ];
  const CAT = Object.fromEntries(CATS);
  const INTENTS = {
    try: { label: "хочу примерить / посмотреть вживую", msg: "хочу примерить" },
    take: { label: "хочу забрать", msg: "хочу забрать" },
    queue: { label: "встать в очередь", msg: "встану в очередь" }
  };
  const PHOTO_NOTE = {
    ai: "ai-фото — цвет, посадка и детали могут отличаться",
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
    market: "примерная стоимость — ориентир по вторичному рынку, а не цена продажи"
  };

  // ---------- хранилище в браузере (может быть недоступно) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ovtd:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ovtd:" + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  const state = {
    items: [],
    cat: "", deal: "", onlyFree: false, onlyLiked: false,
    likes: new Set(store.get("likes", [])),
    mine: store.get("mine", {}),            // id -> { intent, on }
    user: store.get("user", { name: "", tg: "", comment: "" })
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rub = (n) => Number(n).toLocaleString("ru-RU") + " ₽";
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
    return "отдаю";
  }
  const PODGON_LINK = `<a class="link" href="#podgon">идеи для подгона →</a>`;
  function dealSub(i) {
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
      document.title = CFG.title;
      $("#logo").textContent = CFG.title;
      const h = $("#site-heading");
      const lines = CFG.titleLines && CFG.titleLines.length ? CFG.titleLines : [CFG.title];
      h.setAttribute("aria-label", CFG.title);
      h.innerHTML = lines.map((l) => `<span class="tl">${esc(l)}</span>`).join("");
    }
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
    if (p.permanent && p.permanent.length) html += `<h2 class="podgon__h">постоянные направления</h2>${list(p.permanent)}`;
    if (p.wishes && p.wishes.length) html += `<h2 class="podgon__h">актуальные хотелки</h2>${list(p.wishes)}`;
    $("#podgon-body").innerHTML = html;
  }

  // ---------- загрузка ----------
  async function load() {
    try {
      const res = await fetch("data/items.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const raw = await res.json();
      state.items = raw.map(norm).sort((a, b) =>
        condRank(b) - condRank(a) ||
        String(b.added || "").localeCompare(String(a.added || "")) ||
        String(a.id).localeCompare(String(b.id)));
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
    route();
  }

  // ---------- каталог ----------
  function buildChips() {
    const chips = $("#cat-chips");
    chips.innerHTML = CATS.map(([id, label]) =>
      `<button class="chip" role="tab" data-cat="${id}" aria-selected="${state.cat === id}">${label}</button>`).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      state.cat = b.dataset.cat;
      chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-selected", x === b));
      render();
    });
    $("#f-deal").onchange = (e) => { state.deal = e.target.value; render(); };
    $("#f-free").onchange = (e) => { state.onlyFree = e.target.checked; render(); };
    $("#f-liked").onchange = (e) => { state.onlyLiked = e.target.checked; render(); };
  }

  function catalog() { return state.items.filter((i) => i.status !== "archive"); }

  function render() {
    const base = catalog().filter((i) =>
      (!state.cat || i.category === state.cat) &&
      (!state.deal || i.deal.mode === state.deal) &&
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
    const meta = [i.size, i.defects.length ? "есть дефект" : ""].filter(Boolean).map(esc).join(" · ");
    const status = i.status === "reserved" ? `<div class="card__status st-reserved">забронировано</div>`
      : archived ? `<div class="card__status st-archive">уже в других руках</div>` : "";
    const price = i.deal.mode === "price";
    return `<article class="card${archived ? " is-archived" : ""}">
      <button class="card__img" data-open="${esc(i.id)}" aria-label="открыть: ${esc(titleOf(i))}">
        <img src="${esc((i.photos[0] || {}).src || "")}" alt="${esc(titleOf(i))}" loading="lazy">
      </button>
      ${archived ? "" : `<button class="like" data-like="${esc(i.id)}" aria-pressed="${liked}" aria-label="нравится">${liked ? "♥" : "♡"}</button>`}
      <div class="card__info">
        <button class="card__title" data-open="${esc(i.id)}">${esc(titleOf(i))}</button>
        ${meta ? `<div class="card__meta">${meta}</div>` : ""}
        <div class="card__deal${price ? " is-price" : ""}">${esc(dealShort(i))}</div>
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

  function onGridClick(e) {
    const like = e.target.closest("[data-like]");
    if (like) { toggleLike(like.dataset.like); return; }
    const open = e.target.closest("[data-open]");
    if (open) openItem(open.dataset.open);
  }
  $("#grid").addEventListener("click", onGridClick);
  $("#archive-grid").addEventListener("click", onGridClick);

  function toggleLike(id) {
    if (state.likes.has(id)) state.likes.delete(id); else state.likes.add(id);
    saveLikes();
    render();
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
    const head = [CAT[i.category], i.type].filter(Boolean).map(esc).join(" · ");

    const rows = [];
    if (i.brand) rows.push(["бренд", i.brand]);
    if (i.model) rows.push(["модель", i.model]);
    if (i.size) rows.push(["размер", [i.size, i.fit].filter(Boolean).join(" · ")]);
    else if (i.fit) rows.push(["посадка", i.fit]);
    if (i.author) rows.push(["автор", i.author]);
    if (i.publisher) rows.push(["издательство", i.publisher]);
    if (i.opened === true) rows.push(["упаковка", "открыта"]);
    if (i.opened === false) rows.push(["упаковка", "не открыта"]);
    if (condText(i)) rows.push(["состояние", condText(i)]);
    const specs = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    const defects = i.defects.map((d) => `<p class="defect">есть дефект → ${esc(d)}</p>`).join("");
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
    if (i.status === "archive") {
      actions = `<p class="state-msg">${T.given}</p>`;
    } else if (i.status === "reserved") {
      actions = `<p class="state-msg">${T.reserved}</p>` + (mine
        ? `<p class="ok-msg">${T.queued}</p><div class="row-actions"><button class="btn btn--ghost" id="m-remove">убрать из моего</button>${likeBtn}</div>`
        : `<div class="row-actions"><button class="btn btn--primary" id="m-queue">встать в очередь</button>${likeBtn}</div>`);
    } else {
      const cur = mine ? effectiveIntent(i, mine.intent) : "try";
      actions = `<fieldset class="intents"><legend class="sr-only">что хочешь</legend>
          ${["try", "take"].map((k) => `<label class="intent"><input type="radio" name="intent" value="${k}" ${cur === k ? "checked" : ""}><span>${INTENTS[k].label}</span></label>`).join("")}
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
        </div>
        ${specs ? `<dl class="specs">${specs}</dl>` : ""}
        ${defects}
        ${market}
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
    const q = body.querySelector(".market__q");
    if (q) q.addEventListener("click", () => {
      const note = body.querySelector(".market__note");
      note.hidden = !note.hidden;
      q.setAttribute("aria-expanded", String(!note.hidden));
    });
    const like = $("#m-like");
    if (like) like.addEventListener("click", () => toggleLike(id));
    body.querySelectorAll("input[name=intent]").forEach((r) => r.addEventListener("change", () => {
      if (state.mine[id]) { state.mine[id].intent = r.value; saveMine(); }
    }));
    const add = $("#m-add");
    if (add) add.addEventListener("click", () => {
      const v = (body.querySelector("input[name=intent]:checked") || {}).value || "try";
      state.mine[id] = { intent: v, on: true };
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
            `<option value="${k}" ${intent === k ? "selected" : ""}>${INTENTS[k].label}</option>`).join("")}</select>`;
      return `<div class="mine-item${archived ? " is-off" : ""}">
        <input type="checkbox" class="check" data-check="${esc(id)}" ${!archived && v.on !== false ? "checked" : ""} ${archived ? "disabled" : ""} aria-label="включить в заявку">
        <img src="${esc((item.photos[0] || {}).src || "")}" alt="">
        <div class="mine-item__body">
          <button class="mine-item__title" data-open="${esc(id)}">${esc(titleOf(item))}</button>
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
    const lines = sel.map(({ v, item }) => `— ${titleOf(item)} — ${INTENTS[effectiveIntent(item, v.intent)].msg}`);
    const name = (state.user.name || "").trim() || "…";
    const tg = normTg(state.user.tg) || "@…";
    let text = `${head}\n\n${lines.join("\n")}\n\nя — ${name}, ${tg}`;
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
    if ($("#mine-modal").open) renderMine();
  });
  $("#mine-modal").addEventListener("close", () => { render(); $("#req").hidden = true; });

  // ---------- навигация ----------
  function showView(name) {
    ["catalog", "archive", "podgon"].forEach((v) => { $("#view-" + v).hidden = v !== name; });
  }
  function route() {
    const h = location.hash;
    const m = h.match(/^#item-(.+)$/);
    if (m) {
      const item = byId(decodeURIComponent(m[1]));
      if (item && !$("#item-modal").open) showView(item.status === "archive" ? "archive" : "catalog");
      viewHash = item && item.status === "archive" ? "#archive" : "";
      openItem(decodeURIComponent(m[1]));
      return;
    }
    viewHash = h === "#archive" || h === "#podgon" ? h : "";
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    const name = h === "#archive" ? "archive" : h === "#podgon" ? "podgon" : "catalog";
    const wasHidden = $("#view-" + name).hidden;
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
