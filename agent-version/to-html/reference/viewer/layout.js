// layout.js — своя раскладка «Обзора»: блоки обзора (их отдаёт overview.js) на сетке из 12 колонок — порядок,
// ширина, скрытые. Высота блока — по содержимому.
//
// Раскладка одна на тип документа (id вида из views.js: brd, spec, bug, cr) и личная: файл
// <корень репозитория>/.coddoc-tmp/coddoc-settings/layouts/<вид>.json. У остальных .md (вид "md") раскладка — по маске
// файлов, которую человек задаёт при сохранении («stages/stage-*.md»): файл md-<маска>.json, маска — внутри; файлу
// подходит самая точная маска. pack.sh / pack.ps1 вшивают эти файлы в набор (layouts.js: window.CODDOC_LAYOUTS —
// текст файла в base64 по имени файла; window.CODDOC_LAYOUT_DIR — путь к папке).
// Файл — граница ввода: проверяется здесь (parseLayout); не прочитался — обзор как в документе.
//
// Сохраняет страница: в Chrome и Edge — прямо в папку раскладок (первый раз выбрать её в диалоге, дальше браузер
// помнит выбор в IndexedDB), иначе — скачиванием файла, который кладут в ту папку руками. После сохранения вкладка
// помнит раскладку до пересборки набора (sessionStorage), следующий /to-html вшивает её из файла.
//
// Блок без места в раскладке (новый раздел, раздел другого документа того же типа или под той же маской) встаёт сразу
// за своим соседом по документу; блок, которого в документе нет, пропускается и остаётся в файле для других
// документов. Скрытый блок не пропадает: он в свёрнутой полосе «Скрыто» под обзором.
(() => {
  "use strict";

  const COLS = 12;
  const MIN_W = 3;
  const FORMAT = 1;
  /** файл-пометка папки раскладок: его пишет pack.sh / pack.ps1, по нему страница узнаёт папку в диалоге */
  const MARKER = "to-html-layouts.txt";
  const SS = "cvg:layout:";
  /** вид остальных .md (overview.js): раскладка — по маске файлов */
  const GEN = "md";

  /** @typedef {{ level: number, text: string, id: string }} Heading */
  /** @typedef {{ key: string, title: string, html: string, span: number, heads: Heading[], head: boolean }} Item */
  /** @typedef {{ k: string, w: number, hide: boolean }} Slot */
  /** files — маска файлов, только у вида "md" */
  /** @typedef {{ format: number, view: string, files: string, items: Slot[] }} Layout */
  /** @typedef {{ it: Item, w: number, hide: boolean, fresh: boolean }} Placed */
  /** @typedef {{ rerender(): void, toast?(text: string): void }} Api */
  /** id — имя файла раскладки без .json ("" — у этого .md раскладки ещё нет); path — путь документа в наборе */
  /** @typedef {{ view: string, id: string, label: string, path: string, items: Item[], placed: Placed[], lay: Layout | null }} Cur */
  /** @typedef {{ root: HTMLElement, grid: HTMLElement, order: Placed[], cells: Map<string, HTMLElement> }} Ed */
  /** куда пишем: файл раскладки, маска (у .md) и прежняя раскладка этого файла — с ней сливается порядок */
  /** @typedef {{ id: string, files: string, old: Layout | null }} Target */

  /** @type {Api | null} */
  let api = null;
  /** раскладки, прочитанные или сохранённые в этой вкладке, по имени файла */
  /** @type {Map<string, Layout | null>} */
  const memo = new Map();
  /** что сейчас нарисовано */
  /** @type {Cur | null} */
  let cur = null;
  /** режим правки */
  /** @type {Ed | null} */
  let ed = null;
  /** пометка над обзором после сохранения (переживает перерисовку) */
  /** @type {{ text: string, path: string } | null} */
  let note = null;

  /** @param {unknown} x @returns {x is Record<string, unknown>} */
  const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  /** @param {string} s */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  /** @param {string} msg */
  const warn = (msg) => console.warn("layout.js: " + msg);
  /** @param {number} w */
  const clampW = (w) => Math.min(COLS, Math.max(MIN_W, Math.round(w)));

  // ---------------------------------------------------------------- маска файлов (вид "md")

  /**
   * Маска годится: латиница, цифры и / . * ? - _, на конце .md или .markdown, без папок «.» и «..».
   * @param {string} m
   */
  const validMask = (m) => m.length <= 200 && /^[A-Za-z0-9_.*?-]+(?:\/[A-Za-z0-9_.*?-]+)*$/.test(m) &&
    /\.(md|markdown)$/i.test(m) && !m.split("/").some((s) => s === "." || s === "..");

  /**
   * Маска как выражение: «*» и «?» — внутри одной папки, без учёта регистра; сверяется с концом пути файла от корня
   * репозитория, по границе папки — «stages/stage-*.md» подходит и «coddoc/X/stages/stage-03.md».
   * @param {string} m
   */
  const maskRe = (m) => new RegExp("(?:^|/)" + m.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]") + "$", "i");

  /**
   * Имя файла раскладки по маске — только [a-z0-9_-] (такие берёт pack): «_» → «__», «*» → «_s», «?» → «_q»,
   * «.» → «_d», «/» → «_p», .md отбрасывается, .markdown — «_m» на конце. Разные маски — разные имена; маски,
   * разные только регистром, — одна (совпадают они без учёта регистра).
   * @param {string} m
   */
  function maskId(m) {
    const low = m.toLowerCase(), md = low.endsWith(".md");
    const s = md ? low.slice(0, -3) : low.replace(/\.markdown$/, "");
    return "md-" + s.replace(/_/g, "__").replace(/\*/g, "_s").replace(/\?/g, "_q").replace(/\./g, "_d").replace(/\//g, "_p") + (md ? "" : "_m");
  }

  /**
   * Маска, которую страница предлагает при сохранении: папка и имя файла; числа и всё, кроме латиницы, — «*».
   * «stages/stage-03.md» → «stages/stage-*.md».
   * @param {string} path
   */
  function proposeMask(path) {
    const m = path.split("/").slice(-2).map((s) => s.replace(/[^A-Za-z0-9_.-]+/g, "*").replace(/[0-9]+/g, "*").replace(/\*+/g, "*")).join("/");
    return validMask(m) ? m : "*.md";
  }

  // ---------------------------------------------------------------- файл раскладки

  /**
   * Раскладка из файла — проверка на границе: чужой формат или вид — null; у вида "md" — и маска, и имя файла по
   * ней (id); плохие строки пропускаются.
   * @param {unknown} raw @param {string} view @param {string} [id] @returns {Layout | null}
   */
  function parseLayout(raw, view, id = view) {
    if (!isObj(raw) || raw.format !== FORMAT || raw.view !== view || !Array.isArray(raw.items)) return null;
    let files = "";
    if (view === GEN) {
      if (typeof raw.files !== "string" || !validMask(raw.files) || maskId(raw.files) !== id.toLowerCase()) return null;
      files = raw.files;
    }
    /** @type {Slot[]} */
    const items = [];
    const seen = new Set();
    for (const x of raw.items) {
      if (!isObj(x) || typeof x.k !== "string" || !x.k || x.k.length > 300 || seen.has(x.k)) continue;
      seen.add(x.k);
      items.push({ k: x.k, w: typeof x.w === "number" && Number.isFinite(x.w) ? clampW(x.w) : COLS, hide: x.hide === true });
    }
    return { format: FORMAT, view, files, items };
  }

  /** @param {Layout} lay */
  const toText = (lay) => JSON.stringify({ format: FORMAT, view: lay.view, ...(lay.files ? { files: lay.files } : {}),
    items: lay.items.map((s) => (s.hide ? { k: s.k, w: s.w, hide: true } : { k: s.k, w: s.w })) }, null, 1) + "\n";

  /** @param {string} b64 */
  const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

  /** Сборка набора — чтобы раскладка из этой вкладки не пережила пересборку. */
  function made() {
    const d = window.MDV_DATA;
    return isObj(d) && typeof d.made === "string" ? d.made : "";
  }

  /** Папка раскладок на диске (вшита сборкой) или "" — страница открыта без /to-html. */
  function layoutDir() {
    const v = window.CODDOC_LAYOUT_DIR;
    return typeof v === "string" ? v : "";
  }

  /** Раскладка из файла id.json: сохранённая в этой вкладке, иначе вшитая сборкой. */
  /** @param {string} id @param {string} view @returns {Layout | null} */
  function load(id, view) {
    if (memo.has(id)) return memo.get(id) ?? null;
    /** @type {string | null} */
    let text = null;
    try {
      const s = sessionStorage.getItem(SS + id);
      const o = s ? JSON.parse(s) : null;
      if (isObj(o) && o.made === made() && typeof o.text === "string") text = o.text;
    } catch (e) { /* без хранилища — из файла */ }
    const all = window.CODDOC_LAYOUTS;
    if (text === null && isObj(all) && typeof all[id] === "string") {
      try { text = fromB64(all[id]); } catch (e) { warn(`${id}.json: не base64`); }
    }
    /** @type {Layout | null} */
    let lay = null;
    if (text !== null) {
      try { lay = parseLayout(JSON.parse(text), view, id); } catch (e) { lay = null; }
      if (!lay) warn(`раскладка ${id}.json не прочитана — обзор как в документе`);
    }
    memo.set(id, lay);
    return lay;
  }

  /** Имена раскладок .md (md-…), известных вкладке: вшитых сборкой и сохранённых в ней. */
  function maskIds() {
    /** @type {Set<string>} */
    const ids = new Set();
    const all = window.CODDOC_LAYOUTS;
    if (isObj(all)) for (const k of Object.keys(all)) if (k.startsWith("md-")) ids.add(k);
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SS + "md-")) ids.add(k.slice(SS.length));
      }
    } catch (e) { /* без хранилища — только вшитые */ }
    for (const k of memo.keys()) if (k.startsWith("md-")) ids.add(k);
    return [...ids].sort();
  }

  /**
   * Раскладка .md по пути: из подходящих масок — самая точная (больше папок, меньше «*» и «?», длиннее).
   * @param {string} path @returns {{ id: string, lay: Layout } | null}
   */
  function forPath(path) {
    /** @type {{ id: string, lay: Layout } | null} */
    let best = null;
    /** @type {number[]} */
    let score = [];
    for (const id of maskIds()) {
      const lay = load(id, GEN);
      if (!lay || !maskRe(lay.files).test(path)) continue;
      const s = [lay.files.split("/").length, -(lay.files.match(/[*?]/g) || []).length, lay.files.length];
      const i = s.findIndex((x, j) => x !== score[j]);
      if (!best || (i >= 0 && s[i] > score[i])) { best = { id, lay }; score = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- раскладка блоков

  /**
   * Блоки документа по раскладке: сначала те, что в ней есть, в её порядке; блок без места — сразу за ближайшим
   * своим соседом выше по документу (нет такого — первым).
   * @param {Item[]} items @param {Layout | null} lay @returns {Placed[]}
   */
  function arrange(items, lay) {
    if (!lay) return items.map((it) => ({ it, w: it.span, hide: false, fresh: false }));
    const byKey = new Map(items.map((it) => [it.key, it]));
    /** @type {Placed[]} */
    const out = [];
    for (const s of lay.items) {
      const it = byKey.get(s.k);
      if (it && !out.some((p) => p.it === it)) out.push({ it, w: s.w, hide: s.hide, fresh: false });
    }
    items.forEach((it, j) => {
      if (out.some((p) => p.it === it)) return;
      let at = -1;
      for (let i = j - 1; i >= 0 && at < 0; i--) at = out.findIndex((p) => p.it === items[i]);
      out.splice(at + 1, 0, { it, w: it.span, hide: false, fresh: true });
    });
    return out;
  }

  /**
   * Что записать: порядок и ширина блоков этого документа; записи о блоках, которых в нём нет (другие документы
   * того же типа или под той же маской), остаются — каждая за своим прежним соседом.
   * @param {Placed[]} order @param {Layout | null} old @param {string} view @param {string} [files] @returns {Layout}
   */
  function merge(order, old, view, files = "") {
    /** @type {Slot[]} */
    const slots = order.map((p) => ({ k: p.it.key, w: p.w, hide: p.hide }));
    const prev = old ? old.items : [];
    prev.forEach((o, i) => {
      if (slots.some((s) => s.k === o.k)) return;
      let at = -1;
      for (let j = i - 1; j >= 0 && at < 0; j--) at = slots.findIndex((s) => s.k === prev[j].k);
      slots.splice(at + 1, 0, { ...o });
    });
    return { format: FORMAT, view, files, items: slots };
  }

  /** @param {Placed} p */
  const cell = (p) => `<div class="cvg-i${p.it.head ? " cvg-h" : ""}" data-k="${esc(p.it.key)}" style="--w:${p.w}">` +
    `<div class="cvg-c">${p.it.html}</div></div>`;

  /**
   * Обзор по раскладке: сетка и полоса «Скрыто»; оглавление — по видимым блокам в их порядке. path — путь документа
   * в наборе: по нему у вида "md" ищется раскладка по маске.
   * @param {string} view @param {string} label @param {Item[]} items @param {string} [path]
   * @returns {{ html: string, headings: Heading[] }}
   */
  function render(view, label, items, path = "") {
    ed = null;
    closeDlg();
    const found = view === GEN ? forPath(path) : null;
    const id = view === GEN ? (found ? found.id : "") : view;
    const lay = view === GEN ? (found ? found.lay : null) : load(view, view);
    const placed = arrange(items, lay);
    cur = { view, id, label, path, items, placed, lay };
    const vis = placed.filter((p) => !p.hide), hid = placed.filter((p) => p.hide);
    let html = `<div class="cvg" data-view="${esc(view)}" data-layout="${esc(id)}">${vis.map(cell).join("")}</div>`;
    if (hid.length) {
      const names = hid.slice(0, 4).map((p) => p.it.title).join(", ") + (hid.length > 4 ? "…" : "");
      html += `<details class="cvg-hidden"><summary>Скрыто в раскладке: ${hid.length} — ${esc(names)}</summary>` +
        `<div class="cvg">${hid.map(cell).join("")}</div></details>`;
    }
    return { html, headings: vis.flatMap((p) => p.it.heads.map((h) => ({ ...h }))) };
  }

  /** После вставки обзора в страницу: пометка о сохранении; якорь в скрытом блоке — раскрыть полосу. */
  /** @param {HTMLElement} doc */
  function mounted(doc) {
    const cv = doc.querySelector(".cv");
    if (!(cv instanceof HTMLElement)) return;
    const want = decodeURIComponent((location.hash.match(/[#&]h=([^&]*)/) || [])[1] || "");
    const hid = cv.querySelector(".cvg-hidden");
    if (want && hid instanceof HTMLDetailsElement && hid.querySelector(`[id="${CSS.escape(want)}"]`)) hid.open = true;
    if (note) {
      const n = document.createElement("div");
      n.className = "cvg-note";
      n.innerHTML = `<span>${esc(note.text)}${note.path ? " " + pathHtml(note.path) : ""}</span>` +
        `<button type="button" class="cvg-ico cvg-x" data-a="close" title="Закрыть" aria-label="Закрыть">✕</button>`;
      const path = note.path;
      n.addEventListener("click", (ev) => {
        const b = ev.target instanceof Element ? ev.target.closest("button[data-a]") : null;
        if (!b) return;
        if (b.getAttribute("data-a") === "copy") copyText(path, b);
        else n.remove();
      });
      cv.prepend(n);
      note = null;
    }
  }

  /** Скопировать путь; у иконки, по которой щёлкнули, на секунду — галочка. */
  /** @param {string} s @param {Element} [btn] */
  function copyText(s, btn) {
    if (!s) return;
    navigator.clipboard.writeText(s).then(() => {
      const use = btn ? btn.querySelector("use") : null;
      if (!use) { api?.toast?.("Путь скопирован"); return; }
      use.setAttribute("href", "#i-check");
      setTimeout(() => use.setAttribute("href", "#i-copy"), 1200);
    }, () => { /* без буфера — путь виден на странице */ });
  }

  // ---------------------------------------------------------------- правка

  function enter() {
    const root = document.querySelector("#doc .cv");
    const grid = root ? root.querySelector(":scope > .cvg") : null;
    if (!cur || ed || !(root instanceof HTMLElement) || !(grid instanceof HTMLElement)) return;
    /** @type {Map<string, HTMLElement>} */
    const cells = new Map();
    for (const el of root.querySelectorAll(".cvg-i")) if (el instanceof HTMLElement) cells.set(el.dataset.k ?? "", el);
    root.querySelector(".cvg-hidden")?.remove();
    root.querySelector(".cvg-note")?.remove();
    const tools = document.createElement("div");
    tools.className = "cvg-tools";
    // У .md — поле маски: для каких файлов раскладка; страница предлагает свою, человек правит.
    const md = cur.view === GEN;
    const mask = md ? (cur.lay ? cur.lay.files : proposeMask(cur.path)) : "";
    tools.innerHTML = `<div class="cvg-tt"><b>Раскладка: ${esc(cur.label)}</b> — ` +
      (md ? "для всех файлов по маске. " : "одна на все документы этого типа. ") +
      `Блок тяните за полосу с названием, ширину — за правый край.</div>` +
      (md ? `<label class="cvg-mask" title="* — любые символы имени, ? — один символ; папки — через /">Для файлов ` +
        `<input type="text" data-mask spellcheck="false" autocomplete="off" value="${esc(mask)}"></label>` +
        `<span class="cvg-bad" hidden></span>` : "") +
      `<div class="cvg-act"><button type="button" class="btn primary" data-a="save">Сохранить</button>` +
      `<button type="button" class="btn" data-a="cancel">Отмена</button>` +
      `<button type="button" class="btn" data-a="reset" title="Порядок и ширина — как в документе, скрытое вернуть">Сбросить</button></div>`;
    root.insertBefore(tools, grid);
    ed = { root, grid, order: cur.placed.map((p) => ({ ...p })), cells };
    for (const p of ed.order) {
      const el = cells.get(p.it.key);
      if (!el) continue;
      el.insertAdjacentHTML("afterbegin", `<div class="cvg-bar" title="Тяните, чтобы переставить"><span class="cvg-grip" aria-hidden="true">⠿</span>` +
        `<span class="cvg-t">${esc(p.it.title)}</span>${p.fresh && cur.lay ? '<span class="cvg-tag">нет в раскладке</span>' : ""}` +
        `<button type="button" data-a="prev" title="Раньше" aria-label="Раньше">◂</button><button type="button" data-a="next" title="Позже" aria-label="Позже">▸</button>` +
        // Ширина — между «−» и «+»: видно, что кнопки меняют именно её.
        `<span class="cvg-size" title="Ширина блока, колонок из 12"><button type="button" data-a="narrow" title="Уже" aria-label="Уже">−</button>` +
        `<span class="cvg-w"></span><button type="button" data-a="wide" title="Шире" aria-label="Шире">+</button></span>` +
        `<button type="button" data-a="hide"></button></div>`);
      el.insertAdjacentHTML("beforeend", '<div class="cvg-rs" title="Тяните, чтобы изменить ширину"></div>');
    }
    root.classList.add("cvg-edit");
    draw();
    tools.addEventListener("click", onTools);
    tools.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target instanceof HTMLInputElement) { ev.preventDefault(); void save(); }
    });
    grid.addEventListener("click", onCellButton);
    grid.addEventListener("pointerdown", onPointerDown);
  }

  /** Сетка по ed.order: порядок узлов, ширина, «скрыт». */
  function draw() {
    if (!ed) return;
    for (const p of ed.order) {
      const el = ed.cells.get(p.it.key);
      if (!el) continue;
      ed.grid.appendChild(el);
      el.style.setProperty("--w", String(p.w));
      el.classList.toggle("cvg-off", p.hide);
      const w = el.querySelector(".cvg-w");
      if (w) w.textContent = `${p.w}/${COLS}`;
      const h = el.querySelector('[data-a="hide"]');
      if (h) h.textContent = p.hide ? "Вернуть" : "Скрыть";
    }
  }

  /** Порядок ed.order — по узлам сетки (после перетаскивания). */
  function syncOrder() {
    if (!ed) return;
    const byKey = new Map(ed.order.map((p) => [p.it.key, p]));
    /** @type {Placed[]} */
    const next = [];
    for (const el of ed.grid.children) {
      const p = el instanceof HTMLElement ? byKey.get(el.dataset.k ?? "") : undefined;
      if (p) next.push(p);
    }
    if (next.length === ed.order.length) ed.order = next;
  }

  /** @param {Element} el */
  const placedOf = (el) => {
    const k = el.closest(".cvg-i")?.getAttribute("data-k") ?? "";
    return ed ? ed.order.find((p) => p.it.key === k) ?? null : null;
  };

  /** @param {MouseEvent} ev */
  function onCellButton(ev) {
    const b = ev.target instanceof Element ? ev.target.closest(".cvg-bar button[data-a]") : null;
    const p = b ? placedOf(b) : null;
    if (!ed || !b || !p) return;
    const i = ed.order.indexOf(p), a = b.getAttribute("data-a");
    if (a === "prev" && i > 0) ed.order.splice(i - 1, 2, p, ed.order[i - 1]);
    else if (a === "next" && i < ed.order.length - 1) ed.order.splice(i, 2, ed.order[i + 1], p);
    else if (a === "narrow") p.w = clampW(p.w - 1);
    else if (a === "wide") p.w = clampW(p.w + 1);
    else if (a === "hide") p.hide = !p.hide;
    draw();
  }

  /** @param {MouseEvent} ev */
  function onTools(ev) {
    const b = ev.target instanceof Element ? ev.target.closest("button[data-a]") : null;
    if (!ed || !cur || !b) return;
    const a = b.getAttribute("data-a");
    if (a === "cancel") { ed = null; api?.rerender(); }
    else if (a === "reset") { ed.order = cur.items.map((it) => ({ it, w: it.span, hide: false, fresh: false })); draw(); }
    else if (a === "save") void save();
  }

  // ---------------------------------------------------------------- перетаскивание и ширина

  /** @param {PointerEvent} ev */
  function onPointerDown(ev) {
    if (!ed || ev.button !== 0 || !(ev.target instanceof Element)) return;
    const el = ev.target.closest(".cvg-i");
    if (!(el instanceof HTMLElement) || !ed.grid.contains(el)) return;
    if (ev.target.closest(".cvg-rs")) { ev.preventDefault(); resize(ev, el); return; }
    if (ev.target.closest(".cvg-bar") && !ev.target.closest("button")) { ev.preventDefault(); drag(ev, el); }
  }

  /** @param {PointerEvent} ev @param {HTMLElement} el */
  function drag(ev, el) {
    if (!ed) return;
    const grid = ed.grid;
    let x = ev.clientX, y = ev.clientY, raf = 0;
    const ghost = document.createElement("div");
    ghost.className = "cvg-ghost";
    ghost.textContent = el.querySelector(".cvg-t")?.textContent ?? "";
    document.body.appendChild(ghost);
    el.classList.add("cvg-drag");
    const place = () => {
      ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
      const hit = document.elementFromPoint(x, y);
      const t = hit ? hit.closest(".cvg-i") : null;
      if (t instanceof HTMLElement && t !== el && grid.contains(t)) {
        const r = t.getBoundingClientRect();
        const after = r.width > grid.clientWidth * 0.7 ? y > r.top + r.height / 2 : x > r.left + r.width / 2;
        if (after ? t.nextElementSibling !== el : t.previousElementSibling !== el) grid.insertBefore(el, after ? t.nextElementSibling : t);
      } else if (!t && hit && grid.contains(hit) && y > grid.getBoundingClientRect().bottom - 24 && grid.lastElementChild !== el) {
        grid.appendChild(el);
      }
    };
    // Длинный обзор: у края окна — прокрутка, пока держат.
    const tick = () => {
      const edge = 70;
      const dy = y < edge ? -Math.ceil((edge - y) / 4) : y > innerHeight - edge ? Math.ceil((y - innerHeight + edge) / 4) : 0;
      if (dy) { scrollBy(0, dy); place(); }
      raf = requestAnimationFrame(tick);
    };
    /** @param {PointerEvent} e */
    const move = (e) => { x = e.clientX; y = e.clientY; place(); };
    const up = () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      ghost.remove();
      el.classList.remove("cvg-drag");
      syncOrder();
      draw();
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    place();
    raf = requestAnimationFrame(tick);
  }

  /** @param {PointerEvent} ev @param {HTMLElement} el */
  function resize(ev, el) {
    const p = placedOf(el);
    if (!ed || !p) return;
    const grid = ed.grid;
    el.classList.add("cvg-sizing");
    /** @param {PointerEvent} e */
    const move = (e) => {
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 14;
      const col = (grid.clientWidth - gap * (COLS - 1)) / COLS;
      const w = clampW((e.clientX - el.getBoundingClientRect().left + gap) / (col + gap));
      if (w !== p.w) { p.w = w; draw(); }
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      el.classList.remove("cvg-sizing");
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    move(ev);
  }

  // ---------------------------------------------------------------- сохранение

  /** Маска из поля правки (.md): годится и подходит к этому файлу — или null и подсказка у поля. */
  function maskOf() {
    if (!ed || !cur) return null;
    const inp = ed.root.querySelector("input[data-mask]"), bad = ed.root.querySelector(".cvg-bad");
    const m = inp instanceof HTMLInputElement ? inp.value.trim() : "";
    const problem = !validMask(m) ? "Маска — латиница, цифры и / . * ? - _, на конце .md"
      : !maskRe(m).test(cur.path) ? `Маска не подходит к этому файлу (${cur.path})` : "";
    if (bad instanceof HTMLElement) { bad.textContent = problem; bad.hidden = !problem; }
    if (problem && inp instanceof HTMLInputElement) inp.focus();
    return problem ? null : m;
  }

  /** Куда пишем: у вида — его файл; у .md — файл по маске из поля, прежняя раскладка — того же файла. */
  /** @returns {Target | null} */
  function target() {
    if (!cur) return null;
    if (cur.view !== GEN) return { id: cur.view, files: "", old: cur.lay };
    const m = maskOf();
    if (!m) return null;
    const id = maskId(m);
    return { id, files: m, old: id === cur.id ? cur.lay : load(id, GEN) };
  }

  /** Записать в папку раскладок, если браузер умеет и папка уже выбрана; иначе — спросить, куда (окно поверх страницы). */
  async function save() {
    if (!ed || !cur || !target()) return;
    const dir = layoutDir();
    if (!dir || typeof window.showDirectoryPicker !== "function") { finish("download"); return; }
    /** @type {FileSystemDirectoryHandle | null} */
    let h = null;
    try { h = await storedDir(dir); } catch (e) { h = null; }
    if (h) {
      try { await writeTo(h); finish("dir"); return; }
      // Папку удалили или переименовали — забыть её и спросить заново.
      catch (e) { await idbSet(dirKey(dir), null); }
    }
    // Путь — сразу в буфер (молча): в диалоге выбора его останется вставить.
    navigator.clipboard.writeText(dir).catch(() => { /* путь виден в окне */ });
    askDir("");
  }

  /** Окно «Куда сохранить» (модальное, <dialog>): путь к папке раскладок и два действия — выбрать папку или скачать
   * файл; problem — что не так с прошлым выбором. Закрыть — крестик, Esc или щелчок мимо окна; правка продолжается. */
  /** @param {string} problem */
  function askDir(problem) {
    const found = document.querySelector("dialog.cvg-dlg");
    const d = found instanceof HTMLDialogElement ? found : document.createElement("dialog");
    if (d !== found) {
      d.className = "cvg-dlg";
      d.setAttribute("aria-labelledby", "cvgDlgT");
      d.addEventListener("click", onDialog);
      document.body.appendChild(d);
    }
    d.innerHTML = `<button type="button" class="cvg-ico cvg-x" data-a="close" title="Закрыть" aria-label="Закрыть">✕</button>` +
      `<h3 id="cvgDlgT">Куда сохранить раскладку</h3>` + (problem ? `<p class="bad">${problem}</p>` : "") +
      `<p>Выберите папку раскладок — браузер её запомнит, дальше «Сохранить» пишет сразу. Путь можно вставить в поле ` +
      `«Папка» диалога:</p><p>${pathHtml(layoutDir())}</p><div class="cvg-act">` +
      `<button type="button" class="btn primary" data-a="pick">Выбрать папку…</button>` +
      `<button type="button" class="btn" data-a="download">Скачать файл</button></div>`;
    if (!d.open) d.showModal();
  }

  function closeDlg() {
    const d = document.querySelector("dialog.cvg-dlg");
    if (d instanceof HTMLDialogElement && d.open) d.close();
  }

  /** @param {MouseEvent} ev */
  function onDialog(ev) {
    const d = ev.currentTarget;
    // Щелчок по подложке приходит в сам <dialog>: мимо окна — закрыть.
    if (d instanceof HTMLDialogElement && ev.target === d) {
      const r = d.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) { closeDlg(); return; }
    }
    const b = ev.target instanceof Element ? ev.target.closest("button[data-a]") : null;
    const a = b ? b.getAttribute("data-a") : null;
    if (a === "close") closeDlg();
    else if (a === "pick") void pick();
    else if (a === "download") { closeDlg(); finish("download"); }
    else if (a === "copy" && b) copyText(layoutDir(), b);
  }

  /** Путь с иконкой «скопировать». */
  /** @param {string} path */
  const pathHtml = (path) => `<code>${esc(path)}</code><button type="button" class="cvg-ico" data-a="copy" title="Скопировать путь" ` +
    `aria-label="Скопировать путь"><svg class="ico"><use href="#i-copy"/></svg></button>`;

  async function pick() {
    if (!ed || !cur || typeof window.showDirectoryPicker !== "function") return;
    /** @type {FileSystemDirectoryHandle} */
    let h;
    try {
      h = await window.showDirectoryPicker({ id: "to-html-layouts", mode: "readwrite" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      askDir("Браузер не дал выбрать папку: " + esc(String(e)) + ". Можно скачать файл.");
      return;
    }
    try { await h.getFileHandle(MARKER); }
    catch (e) {
      askDir(`В выбранной папке нет файла <code>${MARKER}</code> — это не папка раскладок.`);
      return;
    }
    try {
      await writeTo(h);
      await idbSet(dirKey(layoutDir()), h);
      closeDlg();
      finish("dir");
    } catch (e) {
      askDir("Не удалось записать файл: " + esc(String(e)) + ". Можно скачать его.");
    }
  }

  /** @param {FileSystemDirectoryHandle} h */
  async function writeTo(h) {
    const t = target();
    if (!ed || !cur || !t) throw new Error("нет правки");
    const f = await h.getFileHandle(t.id + ".json", { create: true });
    const w = await f.createWritable();
    await w.write(toText(merge(ed.order, t.old, cur.view, t.files)));
    await w.close();
  }

  /** Раскладка сохранена (или скачан файл): запомнить во вкладке и нарисовать обзор по ней. */
  /** @param {"dir" | "download"} how */
  function finish(how) {
    const t = target();
    if (!ed || !cur || !t) return;
    const lay = merge(ed.order, t.old, cur.view, t.files);
    const text = toText(lay), dir = layoutDir(), file = t.id + ".json";
    if (how === "download") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    memo.set(t.id, lay);
    try { sessionStorage.setItem(SS + t.id, JSON.stringify({ made: made(), text })); } catch (e) { /* без хранилища — до перезагрузки */ }
    const whom = t.files ? `все файлы ${t.files}` : "все документы этого типа";
    note = how === "dir"
      ? { text: `Раскладка «${cur.label}» сохранена: ${file} в папке раскладок — так откроются ${whom}.`, path: "" }
      : dir
        ? { text: `Файл ${file} скачан. Чтобы так открывались ${whom}, положите его в папку`, path: dir }
        : { text: `Файл ${file} скачан. Раскладка действует в этой вкладке; чтобы она была всегда, откройте документ через /to-html и сохраните там.`, path: "" };
    // У этого .md есть маска точнее сохранённой — действует она: сказать, иначе правка «не сохранилась».
    const won = t.files ? forPath(cur.path) : null;
    if (won && won.id !== t.id) note.text += ` Этот файл открывается по более точной маске ${won.lay.files}.`;
    ed = null;
    api?.rerender();
  }

  // ---------------------------------------------------------------- выбранная папка (IndexedDB)

  /** @param {string} dir */
  const dirKey = (dir) => "dir:" + dir;

  /** @returns {Promise<IDBDatabase>} */
  function idb() {
    return new Promise((ok, no) => {
      const q = indexedDB.open("to-html", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("kv");
      q.onsuccess = () => ok(q.result);
      q.onerror = () => no(q.error);
    });
  }
  /** @param {string} key @returns {Promise<unknown>} */
  async function idbGet(key) {
    const db = await idb();
    return new Promise((ok, no) => {
      const g = db.transaction("kv").objectStore("kv").get(key);
      g.onsuccess = () => ok(g.result);
      g.onerror = () => no(g.error);
    });
  }
  /** @param {string} key @param {unknown} value */
  async function idbSet(key, value) {
    try {
      const db = await idb();
      await new Promise((ok, no) => {
        const t = db.transaction("kv", "readwrite");
        if (value === null) t.objectStore("kv").delete(key); else t.objectStore("kv").put(value, key);
        t.oncomplete = () => ok(undefined);
        t.onerror = () => no(t.error);
      });
    } catch (e) { /* не запомнится — спросим папку ещё раз */ }
  }

  /** Папка, выбранная раньше, с разрешением на запись — или null. */
  /** @param {string} dir @returns {Promise<FileSystemDirectoryHandle | null>} */
  async function storedDir(dir) {
    /** @type {unknown} */
    let h = null;
    try { h = await idbGet(dirKey(dir)); } catch (e) { return null; }
    if (!(h instanceof FileSystemDirectoryHandle)) return null;
    const opt = { mode: /** @type {const} */ ("readwrite") };
    if (typeof h.queryPermission === "function" && (await h.queryPermission(opt)) === "granted") return h;
    if (typeof h.requestPermission === "function" && (await h.requestPermission(opt)) === "granted") return h;
    return null;
  }

  // ---------------------------------------------------------------- вход

  document.addEventListener("click", (ev) => {
    if (ev.target instanceof Element && ev.target.closest("[data-cvg-edit]")) enter();
  });

  window.CoddocLayout = {
    attach: (/** @type {Api} */ a) => { api = a; },
    render,
    mounted,
    test: { arrange, merge, parseLayout, maskId, proposeMask, validMask, maskRe },
  };
})();
