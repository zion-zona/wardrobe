(function () {
  "use strict";

  const CFG = window.WARDROBE_CONFIG || {};
  const CATS = [
    { id: "", label: "Все" },
    { id: "clothes", label: "Одежда" },
    { id: "shoes", label: "Обувь" },
    { id: "bags", label: "Сумки" },
    { id: "accessories", label: "Аксессуары" }
  ];
  const DEAL = {
    gift: { label: "Дарю", cls: "b-gift" },
    swap: { label: "Обмен", cls: "b-swap" },
    donate: { label: "Донат — сколько не жалко", short: "Донат", cls: "b-donate" },
    price: { label: "Цена", cls: "b-price" }
  };
  const COND = {
    new_tag: "Новое с биркой",
    new: "Новое без бирки",
    excellent: "Отличное",
    good: "Хорошее",
    fair: "Ношеное"
  };
  const STATUS = {
    available: { label: "Свободно", cls: "" },
    reserved: { label: "Забронировано", cls: "b-reserved" },
    given: { label: "Отдано", cls: "b-given" }
  };
  const INTENTS = {
    maybe: { label: "Возможно", hint: "просто интересно, вещь остаётся свободной" },
    try: { label: "Возьму, если подойдёт вживую", hint: "мягкая бронь до примерки" },
    sure: { label: "Беру точно", hint: "твёрдая бронь" }
  };

  // ---------- storage (может быть недоступно) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("wardrobe:" + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("wardrobe:" + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  const state = {
    items: [],
    cat: "",
    deal: "",
    size: "",
    onlyFree: false,
    onlyLiked: false,
    likes: new Set(store.get("likes", [])),
    cart: store.get("cart", {}), // id -> intent
    user: store.get("user", { name: "", contact: "" })
  };

  const $ = (s, root) => (root || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtPrice = (n) => Number(n).toLocaleString("ru-RU") + " ₽";

  function dealBadges(item, short) {
    return (item.deal || []).map((d) => {
      const def = DEAL[d];
      if (!def) return "";
      let text = short && def.short ? def.short : def.label;
      if (d === "price") text = item.price != null ? fmtPrice(item.price) : "Цена не указана";
      return `<span class="badge ${def.cls}">${esc(text)}</span>`;
    }).join("");
  }

  function saveLikes() { store.set("likes", Array.from(state.likes)); }
  function saveCart() { store.set("cart", state.cart); updateCartCount(); }

  // ---------- init ----------
  function applyConfig() {
    if (CFG.title) {
      document.title = CFG.title;
      $("#site-title").textContent = CFG.title;
      $("#site-heading").textContent = CFG.title;
    }
    $("#site-subtitle").textContent = CFG.subtitle || "";
    $("#rules-list").innerHTML = (CFG.rules || []).map((r) => `<li>${esc(r)}</li>`).join("");
    if (CFG.ticker) {
      const t = $("#ticker"), tr = $("#ticker-track");
      const chunk = `<span>${esc(CFG.ticker)}&nbsp;&nbsp;&nbsp;</span>`;
      tr.innerHTML = chunk.repeat(6);
      t.hidden = false;
    }
    if (CFG.pickup) { const p = $("#pickup"); p.textContent = CFG.pickup; p.hidden = false; }
  }

  async function loadItems() {
    try {
      const res = await fetch("data/items.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const items = await res.json();
      state.items = items.slice().sort((a, b) => {
        const ga = a.status === "given" ? 1 : 0, gb = b.status === "given" ? 1 : 0;
        if (ga !== gb) return ga - gb;
        return String(b.added || "").localeCompare(String(a.added || "")) || String(b.id).localeCompare(String(a.id));
      });
    } catch (e) {
      $("#grid").innerHTML = `<p class="empty">Не получилось загрузить вещи. Обнови страницу.</p>`;
      return;
    }
    // убрать из корзины вещи, которых больше нет
    Object.keys(state.cart).forEach((id) => { if (!state.items.find((i) => i.id === id)) delete state.cart[id]; });
    saveCart();
    buildFilters();
    render();
    openFromHash();
  }

  function buildFilters() {
    const chips = $("#cat-chips");
    chips.innerHTML = CATS.map((c) => {
      const n = c.id ? state.items.filter((i) => i.category === c.id).length : state.items.length;
      if (c.id && !n) return "";
      return `<button class="chip" role="tab" data-cat="${c.id}" aria-selected="${state.cat === c.id}">${c.label}<small>${n}</small></button>`;
    }).join("");
    chips.onclick = (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      state.cat = b.dataset.cat;
      chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-selected", x === b));
      render();
    };
    const sizes = Array.from(new Set(state.items.map((i) => i.size).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "ru", { numeric: true }));
    $("#f-size").innerHTML = `<option value="">Все</option>` + sizes.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#f-deal").onchange = (e) => { state.deal = e.target.value; render(); };
    $("#f-size").onchange = (e) => { state.size = e.target.value; render(); };
    $("#f-free").onchange = (e) => { state.onlyFree = e.target.checked; render(); };
    $("#f-liked").onchange = (e) => { state.onlyLiked = e.target.checked; render(); };
  }

  function visibleItems() {
    return state.items.filter((i) =>
      (!state.cat || i.category === state.cat) &&
      (!state.deal || (i.deal || []).includes(state.deal)) &&
      (!state.size || i.size === state.size) &&
      (!state.onlyFree || i.status === "available") &&
      (!state.onlyLiked || state.likes.has(i.id))
    );
  }

  // ---------- grid ----------
  function cardHTML(i) {
    const st = STATUS[i.status] || STATUS.available;
    const liked = state.likes.has(i.id);
    const meta = [i.size && `р. ${i.size}`, i.brand].filter(Boolean).map(esc).join(" · ");
    const statusLine = `<div class="card__status st-${esc(i.status || "available")}">${st.label}</div>`;
    const extra = [
      (i.defects && i.defects.length) ? `<span class="badge b-defect">Дефект</span>` : "",
      state.cart[i.id] ? `<span class="badge b-incart">В корзине</span>` : ""
    ].join("");
    return `<article class="card ${i.status === "given" ? "is-given" : ""}">
      <button class="card__img" data-open="${esc(i.id)}" aria-label="Открыть: ${esc(i.title)}">
        <img src="${esc((i.photos || [])[0] || "")}" alt="${esc(i.title)}" loading="lazy">
      </button>
      <button class="like" data-like="${esc(i.id)}" aria-pressed="${liked}" aria-label="В избранное">${liked ? "♥" : "♡"}</button>
      <div class="card__info">
        <button class="card__title" data-open="${esc(i.id)}">${esc(i.title)}</button>
        ${meta ? `<div class="card__meta">${meta}</div>` : ""}
        <div class="badges">${dealBadges(i, true)}${extra}</div>
        ${statusLine}
      </div>
    </article>`;
  }

  function render() {
    const list = visibleItems();
    $("#grid").innerHTML = list.map(cardHTML).join("");
    $("#empty").hidden = list.length > 0;
  }

  $("#grid").addEventListener("click", (e) => {
    const like = e.target.closest("[data-like]");
    if (like) { toggleLike(like.dataset.like); return; }
    const open = e.target.closest("[data-open]");
    if (open) openItem(open.dataset.open);
  });

  function toggleLike(id) {
    if (state.likes.has(id)) state.likes.delete(id); else state.likes.add(id);
    saveLikes();
    render();
    if ($("#item-modal").open && currentId === id) renderItem(id);
  }

  // ---------- item modal ----------
  let currentId = null;
  function openItem(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    currentId = id;
    renderItem(id);
    const m = $("#item-modal");
    if (!m.open) m.showModal();
    history.replaceState(null, "", "#item-" + id);
  }

  function renderItem(id) {
    const i = state.items.find((x) => x.id === id);
    const st = STATUS[i.status] || STATUS.available;
    const photos = i.photos && i.photos.length ? i.photos : [""];
    const liked = state.likes.has(i.id);
    const inCart = state.cart[i.id];
    const specs = [
      ["Тип", i.type], ["Бренд", i.brand], ["Размер", i.size], ["Цвет", i.color], ["Сезон", i.season],
      ["Состояние", COND[i.condition] || i.condition]
    ].concat(Object.entries(i.measurements || {}))
      .filter(([, v]) => v)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    const defects = (i.defects && i.defects.length)
      ? `<div class="defect-box"><strong>Дефект</strong><ul>${i.defects.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></div>` : "";
    const given = i.status === "given";
    const intents = given ? "" : `<fieldset class="intents">
        <legend>${i.status === "reserved" ? "Вещь забронирована — можно встать в очередь" : "Насколько хочешь?"}</legend>
        ${Object.entries(INTENTS).map(([k, v]) => `<label class="intent"><input type="radio" name="intent" value="${k}" ${(inCart || "try") === k ? "checked" : ""}><span>${v.label}<small>${v.hint}</small></span></label>`).join("")}
      </fieldset>`;
    $("#item-body").innerHTML = `
      <div class="gallery">
        <div class="gallery__main"><img id="g-main" src="${esc(photos[0])}" alt="${esc(i.title)}"></div>
        ${photos.length > 1 ? `<div class="gallery__thumbs">${photos.map((p, n) => `<button class="thumb" data-src="${esc(p)}" aria-current="${n === 0}" aria-label="Фото ${n + 1}"><img src="${esc(p)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="details">
        <div>
          <div class="details__num">№${esc(i.id)}</div>
          <h2 id="m-title">${esc(i.title)}</h2>
        </div>
        <div class="badges">${dealBadges(i, false)}${i.status !== "available" ? `<span class="badge ${st.cls}">${st.label}</span>` : ""}</div>
        ${specs ? `<dl class="specs">${specs}</dl>` : ""}
        ${defects}
        ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
        ${intents}
        <div class="row-actions">
          ${given ? "" : `<button class="btn btn--primary" id="m-cart">${inCart ? "Обновить в корзине" : "В корзину"}</button>`}
          ${inCart ? `<button class="btn btn--ghost" id="m-remove">Убрать</button>` : ""}
          <button class="btn btn--ghost" id="m-like" aria-pressed="${liked}">${liked ? "♥ В избранном" : "♡ В избранное"}</button>
        </div>
      </div>`;
    const body = $("#item-body");
    body.querySelectorAll(".thumb").forEach((t) => t.addEventListener("click", () => {
      $("#g-main").src = t.dataset.src;
      body.querySelectorAll(".thumb").forEach((x) => x.setAttribute("aria-current", x === t));
    }));
    const add = $("#m-cart");
    if (add) add.addEventListener("click", () => {
      const v = (body.querySelector("input[name=intent]:checked") || {}).value || "try";
      state.cart[i.id] = v; saveCart(); render(); renderItem(i.id);
    });
    const rm = $("#m-remove");
    if (rm) rm.addEventListener("click", () => { delete state.cart[i.id]; saveCart(); render(); renderItem(i.id); });
    $("#m-like").addEventListener("click", () => toggleLike(i.id));
  }

  function openFromHash() {
    const m = location.hash.match(/^#item-(.+)$/);
    if (m) openItem(decodeURIComponent(m[1]));
  }

  // ---------- cart ----------
  function updateCartCount() { $("#cart-count").textContent = Object.keys(state.cart).length; }

  function cartMessage() {
    const lines = Object.entries(state.cart).map(([id, intent]) => {
      const i = state.items.find((x) => x.id === id);
      if (!i) return null;
      return `• №${i.id} ${i.title}${i.size ? ` (р. ${i.size})` : ""} — ${INTENTS[intent].label.toLowerCase()}`;
    }).filter(Boolean);
    const name = state.user.name.trim() || "…";
    let text = `Привет! Это ${name}. Хочу с сайта:\n${lines.join("\n")}`;
    if (state.user.contact.trim()) text += `\nСвязь: ${state.user.contact.trim()}`;
    return text;
  }

  function renderCart() {
    const ids = Object.keys(state.cart);
    const list = $("#cart-list");
    if (!ids.length) {
      list.innerHTML = `<p class="cart-empty">Пока пусто. Открой вещь и нажми «В корзину».</p>`;
      $("#cart-form").hidden = true;
      return;
    }
    list.innerHTML = ids.map((id) => {
      const i = state.items.find((x) => x.id === id);
      if (!i) return "";
      return `<div class="cart-item">
        <img src="${esc((i.photos || [])[0] || "")}" alt="">
        <div>
          <div class="cart-item__title">${esc(i.title)}</div>
          <select data-intent="${esc(id)}" aria-label="Насколько хочешь">${Object.entries(INTENTS).map(([k, v]) => `<option value="${k}" ${state.cart[id] === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
        </div>
        <button class="remove" data-remove="${esc(id)}" aria-label="Убрать">Убрать</button>
      </div>`;
    }).join("");
    $("#cart-form").hidden = false;
    $("#u-name").value = state.user.name;
    $("#u-contact").value = state.user.contact;
    $("#cart-preview").textContent = cartMessage();
    const tg = (CFG.contact && CFG.contact.telegram || "").replace(/^@/, "");
    $("#send-tg").hidden = !tg;
    $("#no-contact").hidden = !!tg;
    $("#copy-status").textContent = "";
  }

  $("#cart-list").addEventListener("change", (e) => {
    const s = e.target.closest("[data-intent]");
    if (s) { state.cart[s.dataset.intent] = s.value; saveCart(); $("#cart-preview").textContent = cartMessage(); }
  });
  $("#cart-list").addEventListener("click", (e) => {
    const r = e.target.closest("[data-remove]");
    if (r) { delete state.cart[r.dataset.remove]; saveCart(); render(); renderCart(); }
  });
  ["u-name", "u-contact"].forEach((fid) => $("#" + fid).addEventListener("input", () => {
    state.user = { name: $("#u-name").value, contact: $("#u-contact").value };
    store.set("user", state.user);
    $("#cart-error").hidden = true;
    $("#cart-preview").textContent = cartMessage();
  }));

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove(); return ok;
    }
  }

  function validName() {
    if (!state.user.name.trim()) { $("#cart-error").hidden = false; $("#u-name").focus(); return false; }
    return true;
  }

  $("#copy-only").addEventListener("click", async () => {
    if (!validName()) return;
    const ok = await copyText(cartMessage());
    $("#copy-status").textContent = ok ? "Скопировано. Вставь в сообщение." : "Не получилось скопировать — выдели текст выше вручную.";
  });
  $("#send-tg").addEventListener("click", async () => {
    if (!validName()) return;
    const tg = (CFG.contact.telegram || "").replace(/^@/, "");
    const ok = await copyText(cartMessage());
    $("#copy-status").textContent = ok ? "Текст скопирован — вставь его в чат." : "Скопируй текст выше вручную и вставь в чат.";
    window.open("https://t.me/" + encodeURIComponent(tg), "_blank", "noopener");
  });

  $("#cart-open").addEventListener("click", () => { renderCart(); $("#cart-modal").showModal(); });

  // ---------- dialogs ----------
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  });
  $("#item-modal").addEventListener("close", () => {
    currentId = null;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  });
  window.addEventListener("hashchange", openFromHash);

  applyConfig();
  updateCartCount();
  loadItems();
})();
