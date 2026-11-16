// @ts-check
// Страница to-html: показывает набор из data.js (его пишут pack.sh / pack.ps1) — дерево файлов, документ,
// оглавление. Без data.js — экран «инит». Только классические скрипты: ES-модули с file:// Chrome не грузит.
(() => {
  "use strict";

  /** @typedef {"md" | "code" | "img" | "other"} Kind */
  /**
   * @typedef {object} Entry
   * @property {string} path  путь от корня набора: «/», NFC
   * @property {string} name
   * @property {string} dir   папка, «» — корень
   * @property {number} size
   * @property {Kind} kind
   * @property {string | null} b64   содержимое из data.js; у перетащенных — null, текст сразу в text
   * @property {string} [text]
   * @property {string} [title]
   * @property {File} [file]          перетащенный или выбранный файл
   * @property {string} [url]         его objectURL — для картинок и вложений
   */
  /** @typedef {{ path: string, file: File }} Picked */
  /** @typedef {{ picked: Picked[], label: string }} PickedSet */
  /** @typedef {{ v: 1, made: string, root: string, base: string, open: string, files: Array<[string, number, string | null]> }} Data */
  /** @typedef {{ level: number, text: string, id: string }} Heading */
  /** @typedef {{ file: string, headings: Heading[], slugs: Map<string, number>, nb?: boolean, frag?: boolean }} Env */
  /**
   * @typedef {{ type: "ext", href: string }
   *   | { type: "anchor", id: string }
   *   | { type: "file", path: string, id: string }
   *   | { type: "outside", href: string, shown: string }
   *   | { type: "none" }} Target
   */
  /** @typedef {{ h: Heading, children: TocNode[] }} TocNode */

  /** @param {string} id @returns {HTMLElement} */
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("нет элемента #" + id);
    return el;
  }

  const app = $("app"), tree = $("tree"), doc = $("doc"), toc = $("toc"), crumbs = $("crumbs"), init = $("init");

  /** @type {Map<string, Entry>} */
  const files = new Map();
  /** @type {Map<string, string>} путь в нижнем регистре → путь: ссылки пишут с другим регистром */
  const lower = new Map();
  /** @type {Map<string, string[]>} имя файла (и без .md) в нижнем регистре → пути: для [[Имя]] */
  const byName = new Map();
  /** @type {Map<string, string> | null} якорь пункта ноута → файл, где пункт записан; строится по первой ссылке */
  let nbIndex = null;
  /** @type {Entry[]} */
  let attachments = [];
  let base = "", made = "", rootLabel = "", openPath = "", current = "";
  let dropped = false;
  /** @type {Heading[]} */
  let headings = [];
  /** @type {string[]} */
  const objectUrls = [];
  // Пределы — как у pack.sh / pack.ps1: перетащенное отбирается по тем же правилам.
  const MAX_FILES = 2000, MAX_TEXT = 5 * 1024 * 1024;

  // ---------------------------------------------------------------- данные

  /** @param {unknown} x @returns {x is Data} */
  function isData(x) {
    if (typeof x !== "object" || x === null) return false;
    if (!("v" in x) || x.v !== 1) return false;
    if (!("made" in x) || typeof x.made !== "string" || !("root" in x) || typeof x.root !== "string") return false;
    if (!("base" in x) || typeof x.base !== "string" || !("open" in x) || typeof x.open !== "string") return false;
    if (!("files" in x) || !Array.isArray(x.files)) return false;
    return x.files.every((f) => Array.isArray(f) && f.length === 3 && typeof f[0] === "string" &&
      typeof f[1] === "number" && (f[2] === null || (typeof f[2] === "string" && /^[A-Za-z0-9+/=]*$/.test(f[2].slice(0, 64)))));
  }

  /** @param {string} p @returns {Kind} */
  function kindOf(p) {
    if (/\.(md|markdown)$/i.test(p)) return "md";
    if (/\.(txt|puml|plantuml|mmd|ya?ml|json)$/i.test(p)) return "code";
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(p)) return "img";
    return "other";
  }

  /** @param {string} b64 */
  function bytesOf(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // UTF-8, а если байты не UTF-8 — cp1251: старые файлы с Windows.
  /** @param {Uint8Array} bytes */
  function decodeText(bytes) {
    let t;
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) { t = new TextDecoder("windows-1251").decode(bytes); }
    return t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  }

  /** @param {Entry} e */
  function textOf(e) {
    if (e.text !== undefined) return e.text;
    if (e.b64 === null) return "";
    e.text = decodeText(bytesOf(e.b64));
    return e.text;
  }

  /** Есть ли у файла текст: из data.js или прочитанный из перетащенного. @param {Entry} e */
  function hasText(e) { return e.b64 !== null || e.text !== undefined; }

  /** @param {string} s */
  function stripMd(s) {
    return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
  }

  // Подпись в дереве — первый «# заголовок» файла. Читаем только начало: файлы бывают на мегабайты.
  /** @param {Entry} e */
  function titleOf(e) {
    if (e.title !== undefined) return e.title;
    let title = e.name;
    if (e.kind === "md" && hasText(e)) {
      const head = e.text ?? new TextDecoder("utf-8").decode(bytesOf((e.b64 ?? "").slice(0, 8000)));
      const body = head.replace(/^\uFEFF/, "").replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*\r?\n/, "");
      const m = body.match(/^#[ \t]+(.+?)[ \t#]*$/m);
      if (m) title = stripMd(m[1]) || e.name;
    }
    e.title = title;
    return title;
  }

  function reset() {
    for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u);
    files.clear();
    lower.clear();
    byName.clear();
    nbIndex = null;
    searchIndex = null;
    attachments = [];
    current = "";
    headings = [];
    activeId = "";
    assetsReady = null;
  }

  /** @param {string} raw @param {number} size @param {string | null} b64 @param {File} [file] @param {string} [text] */
  function add(raw, size, b64, file, text) {
    const path = raw.normalize("NFC");
    const i = path.lastIndexOf("/");
    /** @type {Entry} */
    const e = { path, name: path.slice(i + 1), dir: i < 0 ? "" : path.slice(0, i), size, kind: kindOf(path), b64 };
    if (file) e.file = file;
    if (text !== undefined) e.text = text;
    if (e.kind === "other") attachments.push(e);
    files.set(path, e);
    if (!lower.has(path.toLowerCase())) lower.set(path.toLowerCase(), path);
    for (const k of new Set([e.name.toLowerCase(), e.name.replace(/\.(md|markdown)$/i, "").toLowerCase()])) {
      const list = byName.get(k);
      if (list) list.push(path); else byName.set(k, [path]);
    }
  }

  /** @param {Data} d */
  function load(d) {
    reset();
    made = d.made;
    rootLabel = d.root;
    base = d.base;
    openPath = d.open;
    dropped = false;
    for (const [raw, size, b64] of d.files) add(raw, size, b64);
    attachments.sort((a, b) => cmp(a.path, b.path));
  }

  // ---------------------------------------------------------------- пути и адреса

  /** @param {string} a @param {string} b */
  function cmp(a, b) { return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }); }

  /** @param {string} p */
  function dirOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }

  /** @param {string} s */
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /** a/./b/../c → a/c; выше корня набора — null. @param {string} p @returns {string | null} */
  function normRel(p) {
    /** @type {string[]} */
    const out = [];
    for (const part of p.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") { if (!out.length) return null; out.pop(); continue; }
      out.push(part);
    }
    return out.join("/");
  }

  /** @param {string} p */
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  // base — сырой путь от упаковщика: «../../coddoc/» или «file:///C:/x y/»; кодируем по сегментам, не трогая схему и диск.
  /** @param {string} b */
  function encBase(b) {
    return b.split("/").map((s, i) =>
      s === "" || s === "." || s === ".." || (i === 0 && /^[a-z][a-z0-9+.-]*:$/i.test(s)) || /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)
    ).join("/");
  }

  /** @param {string} p */
  function fileUrl(p) {
    const e = files.get(p);
    if (e && e.file) {
      if (!e.url) { e.url = URL.createObjectURL(e.file); objectUrls.push(e.url); }
      return e.url;
    }
    return encBase(base) + encPath(p);
  }

  /** @param {string} p @returns {string | null} */
  function find(p) {
    const n = p.normalize("NFC");
    if (files.has(n)) return n;
    return lower.get(n.toLowerCase()) ?? null;
  }

  /** @param {string} raw @param {string} from @returns {Target} */
  function resolve(raw, from) {
    const href = raw.trim();
    if (!href) return { type: "none" };
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { type: "ext", href };
    if (href.startsWith("#")) return { type: "anchor", id: safeDecode(href.slice(1)) };
    const at = href.indexOf("#");
    const pathPart = (at < 0 ? href : href.slice(0, at)).split("?")[0];
    const id = at < 0 ? "" : safeDecode(href.slice(at + 1));
    const p = safeDecode(pathPart);
    const dir = dirOf(from);
    const joined = p.startsWith("/") ? p.slice(1) : dir ? dir + "/" + p : p;
    const rel = normRel(joined);
    if (rel !== null && rel !== "") {
      const hit = find(rel);
      if (hit) return { type: "file", path: hit, id };
    }
    const shown = rel ?? joined;
    return { type: "outside", href: base ? encBase(base) + encPath(joined) + (at < 0 ? "" : href.slice(at)) : "", shown };
  }

  // [[Имя]]: путь от корня или от текущей папки, иначе файл с таким именем где угодно — ближайший к текущему.
  /** @param {string} name @param {string} from @returns {string | null} */
  function findByName(name, from) {
    const n = name.trim().replace(/^\/+/, "");
    if (!n) return null;
    const dir = dirOf(from);
    for (const c of [n, n + ".md", ...(dir ? [dir + "/" + n, dir + "/" + n + ".md"] : [])]) {
      const hit = find(c);
      if (hit) return hit;
    }
    const list = byName.get((n.split("/").pop() ?? n).normalize("NFC").toLowerCase());
    if (!list || !list.length) return null;
    const here = dir ? dir.split("/") : [];
    /** @param {string} p — сколько папок пути общие с текущим файлом */
    const near = (p) => { const a = dirOf(p) ? dirOf(p).split("/") : []; let k = 0; while (k < a.length && k < here.length && a[k] === here[k]) k++; return k; };
    return [...list].sort((x, y) => near(y) - near(x) || x.length - y.length)[0] ?? null;
  }

  // Путь файла набора, записанный текстом или в `коде`: от текущего файла, от корня набора и от папки
  // запуска (скиллы пишут пути от корня репо, заметки — «исходник: sources/…»).
  /** @param {string} s @param {string} from @returns {string | null} */
  function pathLike(s, from) {
    if (!/[/.]/.test(s) || /\s/.test(s)) return null;
    const tries = [s, "/" + s];
    if (rootLabel && rootLabel !== "." && s.startsWith(rootLabel + "/")) tries.push("/" + s.slice(rootLabel.length + 1));
    for (const t of tries) {
      const r = resolve(t, from);
      if (r.type === "file") return r.path;
    }
    return null;
  }

  /** @param {string} path @param {string} [id] */
  function hrefOf(path, id) {
    return "#f=" + encodeURIComponent(path) + (id ? "&h=" + encodeURIComponent(id) : "");
  }

  /** @param {number} n */
  function human(n) {
    if (n < 1024) return n + " Б";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " КБ";
    return (n / 1048576).toFixed(1).replace(".", ",") + " МБ";
  }

  /** @param {string} s */
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  }

  /** @param {string} id @param {string} [cls] */
  function icon(id, cls) { return `<svg class="ico${cls ? " " + cls : ""}"><use href="#${id}"/></svg>`; }

  // Внутри документа значок — метка: DOMPurify снимает <use>, поэтому svg подставляется после чистки.
  /** @param {string} id */
  function iconMark(id) { return `<span data-icon="${id}"></span>`; }
  /** @param {string} html */
  function iconsIn(html) { return html.replace(/<span data-icon="(i-[a-z-]+)"><\/span>/g, (_, id) => icon(id)); }

  // ---------------------------------------------------------------- markdown

  const md = window.markdownit({ html: true, linkify: true });
  // Без «нечётких» ссылок: README.md иначе станет ссылкой на сайт — .md это домен Молдовы.
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
  md.use(window.markdownitFootnote);

  // Якоря заголовков — по правилу GitHub, чтобы ссылки из md, рабочие на GitHub/GitLab, работали и здесь.
  /** @param {string} text @param {Map<string, number>} used */
  function slug(text, used) {
    const s = text.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
    const n = used.get(s);
    used.set(s, (n ?? -1) + 1);
    return n === undefined ? s : `${s}-${n + 1}`;
  }

  // Свои HTML-токены помечаются: по ним видно, есть ли в части документа сырой HTML автора (см. renderMd).
  /** @param {MdToken} t */
  function ours(t) { t.meta = { ours: true }; return t; }

  md.core.ruler.push("to_html_headings", (state) => {
    /** @type {Env} */
    const env = state.env;
    if (env.frag) return;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "heading_open") continue;
      const inline = tokens[i + 1];
      const text = (inline.children ?? []).filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("");
      const id = slug(text, env.slugs);
      tokens[i].attrSet("id", id);
      env.headings.push({ level: Number(tokens[i].tag.slice(1)), text: text.trim(), id });
    }
  });

  // Пункты «- [ ] …» / «- [x] …» — галочка вместо скобок.
  md.core.ruler.push("to_html_tasks", (state) => {
    if (state.env.frag) return;
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
      const first = (tokens[i].children ?? [])[0];
      const m = first && first.type === "text" ? first.content.match(/^\[([ xX])\][ \t]+/) : null;
      if (!first || !m) continue;
      const done = m[1] !== " ";
      first.content = first.content.slice(m[0].length);
      tokens[i - 2].attrJoin("class", done ? "task done" : "task");
      const box = ours(new state.Token("html_inline", "", 0));
      box.content = `<span class="box" aria-hidden="true">${done ? iconMark("i-check") : ""}</span>`;
      (tokens[i].children ?? []).unshift(box);
    }
  });

  const rules = md.renderer.rules;
  /** @type {MdRenderRule} */
  const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);

  rules.heading_open = (tokens, idx, options, env, self) => {
    const id = tokens[idx].attrGet("id") ?? "";
    /** @type {Env} */
    const e = env;
    if (e.frag) return self.renderToken(tokens, idx, options);
    return self.renderToken(tokens, idx, options) + `<a class="anchor" href="${esc(hrefOf(e.file, id))}" aria-hidden="true" tabindex="-1">#</a>`;
  };

  rules.link_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    /** @type {Env} */
    const e = env;
    const r = resolve(t.attrGet("href") ?? "", e.file);
    switch (r.type) {
      case "ext":
        t.attrSet("target", "_blank");
        t.attrSet("rel", "noopener noreferrer");
        t.attrJoin("class", "ext");
        break;
      case "anchor":
        t.attrSet("href", hrefOf(e.file, r.id));
        break;
      case "file":
        t.attrSet("href", hrefOf(r.path, r.id));
        break;
      case "outside":
        t.attrJoin("class", "outside");
        t.attrSet("title", `Вне этой папки — открой отдельно: /to-html ${r.shown}`);
        if (r.href) { t.attrSet("href", r.href); t.attrSet("target", "_blank"); } else t.attrSet("href", "#");
        break;
      case "none":
        break;
      default: {
        /** @type {never} */
        const never = r;
        throw new Error("неизвестная ссылка " + JSON.stringify(never));
      }
    }
    return renderToken(tokens, idx, options, env, self);
  };

  rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    /** @type {Env} */
    const e = env;
    const r = resolve(t.attrGet("src") ?? "", e.file);
    if (r.type === "file") {
      t.attrSet("src", fileUrl(r.path));
      t.attrSet("data-file", r.path);
    } else if (r.type === "outside" && r.href) {
      t.attrSet("src", r.href);
    }
    t.attrSet("loading", "lazy");
    return self.renderToken(tokens, idx, options);
  };

  // Путь файла набора в `коде` — ссылка: так скиллы пишут пути, а заметки — «исходник: sources/…».
  rules.code_inline = (tokens, idx, options, env) => {
    const code = tokens[idx].content;
    /** @type {Env} */
    const e = env;
    const hit = pathLike(code, e.file);
    return hit ? `<a class="code-link" href="${esc(hrefOf(hit))}"><code>${esc(code)}</code></a>` : `<code>${esc(code)}</code>`;
  };

  // [[Имя]], [[Имя#Раздел|подпись]], ![[фото.png|300]] — как в Obsidian, Logseq, Foam.
  md.inline.ruler.before("link", "to_html_wiki", (state, silent) => {
    const src = state.src;
    let pos = state.pos;
    const embed = src.charCodeAt(pos) === 0x21;
    if (embed) pos++;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf("]]", pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim() || /[\n[\]]/.test(inner)) return false;
    if (!silent) {
      const t = state.push("wiki", "", 0);
      t.meta = { inner, embed };
    }
    state.pos = end + 2;
    return true;
  });

  rules.wiki = (tokens, idx, options, env) => {
    const meta = tokens[idx].meta;
    const inner = meta && typeof meta.inner === "string" ? meta.inner : "";
    const embed = !!meta && meta.embed === true;
    /** @type {Env} */
    const e = env;
    const bar = inner.indexOf("|");
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const alias = bar < 0 ? "" : inner.slice(bar + 1).trim();
    const at = target.indexOf("#");
    const name = (at < 0 ? target : target.slice(0, at)).trim();
    const section = at < 0 ? "" : target.slice(at + 1).replace(/^\^.*/, "").trim();
    const size = embed && /^\d+(x\d+)?$/.test(alias) ? alias : "";
    const label = alias && !size ? alias : section ? (name ? `${name} › ${section}` : section) : name;
    const hit = name ? findByName(name, e.file) : e.file;
    const ent = hit ? files.get(hit) : undefined;
    if (!hit || !ent) {
      return embed && kindOf(name) === "img"
        ? `<span class="img-missing">картинка не нашлась: ${esc(name)}</span>`
        : `<a class="missing" href="#" title="Нет в этой папке: «${esc(name)}»">${esc(label)}</a>`;
    }
    if (embed && ent.kind === "img") {
      const w = (size.match(/^\d+/) ?? [""])[0];
      return `<img src="${esc(fileUrl(hit))}" data-file="${esc(hit)}" alt="${esc(name)}" loading="lazy"${w ? ` width="${w}"` : ""}>`;
    }
    if (embed && ent.kind === "other") {
      return `<a class="att" href="${esc(fileUrl(hit))}" target="_blank" title="${esc(hit)}">${iconMark("i-clip")}${esc(ent.name)} <small>${human(ent.size)}</small></a>`;
    }
    return `<a href="${esc(hrefOf(hit, section ? slug(section, new Map()) : ""))}">${esc(label)}</a>`;
  };

  // > [!note] Заголовок — плашка (GitHub, Obsidian). Тип → [вид, значок, подпись по умолчанию].
  /** @type {Record<string, [string, string, string]>} */
  const CALLOUT = {
    note: ["note", "i-info", "Заметка"], info: ["note", "i-info", "Сведения"], abstract: ["note", "i-info", "Кратко"],
    summary: ["note", "i-info", "Кратко"], tldr: ["note", "i-info", "Кратко"], todo: ["note", "i-info", "Сделать"],
    question: ["note", "i-info", "Вопрос"], help: ["note", "i-info", "Вопрос"], faq: ["note", "i-info", "Вопрос"],
    example: ["note", "i-info", "Пример"], quote: ["note", "i-info", "Цитата"], cite: ["note", "i-info", "Цитата"],
    tip: ["tip", "i-bulb", "Совет"], hint: ["tip", "i-bulb", "Совет"], success: ["tip", "i-check", "Готово"],
    check: ["tip", "i-check", "Готово"], done: ["tip", "i-check", "Готово"],
    important: ["warning", "i-alert", "Важно"], warning: ["warning", "i-alert", "Внимание"], attention: ["warning", "i-alert", "Внимание"],
    caution: ["caution", "i-alert", "Осторожно"], danger: ["caution", "i-alert", "Опасно"], error: ["caution", "i-alert", "Ошибка"],
    bug: ["caution", "i-alert", "Ошибка"], failure: ["caution", "i-alert", "Не вышло"], fail: ["caution", "i-alert", "Не вышло"],
    заметка: ["note", "i-info", "Заметка"], совет: ["tip", "i-bulb", "Совет"], важно: ["warning", "i-alert", "Важно"],
    внимание: ["warning", "i-alert", "Внимание"], осторожно: ["caution", "i-alert", "Осторожно"],
  };

  md.core.ruler.after("inline", "to_html_callouts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open" || tokens[i + 1].type !== "paragraph_open" || tokens[i + 2].type !== "inline") continue;
      const inl = tokens[i + 2];
      const m = inl.content.match(/^\[!([^\]\s]+)\][+-]?[ \t]*([^\n]*)/);
      if (!m) continue;
      const def = CALLOUT[m[1].toLowerCase()] ?? CALLOUT.note;
      let depth = 0, close = -1;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_open") depth++;
        if (tokens[j].type === "blockquote_close" && --depth === 0) { close = j; break; }
      }
      if (close < 0) continue;
      tokens[i].tag = "div";
      tokens[i].attrJoin("class", "callout " + def[0]);
      // Заголовок рисует рендер открывающего тега: вставка токена (splice) в массив на миллион токенов
      // большого журнала — это сдвиг всего массива на каждую плашку.
      tokens[i].meta = { callout: `<div class="callout-title">${iconMark(def[1])}${esc(m[2].trim() || def[2])}</div>\n` };
      tokens[close].tag = "div";
      // Строка-метка уходит из абзаца; абзац из одной метки скрыт.
      const kids = inl.children ?? [];
      const br = kids.findIndex((c) => c.type === "softbreak" || c.type === "hardbreak");
      inl.children = br < 0 ? [] : kids.slice(br + 1);
      inl.content = inl.content.split("\n").slice(1).join("\n");
      if (!inl.children.length) { tokens[i + 1].hidden = true; tokens[i + 3].hidden = true; }
    }
  });

  rules.blockquote_open = (tokens, idx, options, env, self) => {
    const meta = tokens[idx].meta;
    return self.renderToken(tokens, idx, options) + (meta && typeof meta.callout === "string" ? meta.callout : "");
  };

  // ---- ссылки в тексте: номера пунктов ноута и пути файлов набора

  const REF_RE = /(\d{4}-\d\d-\d\d)\s*№(\d+)(?:\.(\d+))?/g;
  // Без lookbehind: Safari до 16.4 его не понимает, и тогда не разобрался бы весь скрипт.
  const HAS_EXT = /\.(?:md|markdown|txt|puml|plantuml|mmd|ya?ml|json|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|csv)(?![\p{L}\p{N}])/iu;
  const PATH_RE = /(^|[^\p{L}\p{N}_./-])((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.(?:md|markdown|txt|puml|plantuml|mmd|ya?ml|json|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|csv))(?![\p{L}\p{N}_/-])/giu;

  // Указатель пунктов ноута по всему набору: пункт «… · 2026-10-14 №1.2» записан там, где он стоит под
  // «## 2026-10-14» и «### 1 · …». В выкладке и списке пунктов те же номера в конце строк — это ссылки.
  function notebookIndex() {
    if (nbIndex) return nbIndex;
    /** @type {Map<string, string>} */
    const idx = new Map();
    for (const e of files.values()) {
      if (e.kind !== "md" || !hasText(e)) continue;
      const text = textOf(e);
      if (!text.includes("№")) continue;
      let date = "", entry = "", fence = false;
      for (const line of text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
        if (fence) continue;
        let m = line.match(/^(#{1,2})\s+(.*?)\s*$/);
        if (m) { date = m[1] === "##" && /^\d{4}-\d\d-\d\d$/.test(m[2]) ? m[2] : ""; entry = ""; continue; }
        if (date && (m = line.match(/^###\s+(\d+)\s*·/))) {
          entry = m[1];
          if (!idx.has(`n-${date}-${entry}`)) idx.set(`n-${date}-${entry}`, e.path);
          continue;
        }
        if (!date || !entry) continue;
        m = line.split("‖")[0].match(/^\s*[-*+]\s.*·\s*(\d{4}-\d\d-\d\d)\s*№(\d+)\.(\d+)\s*$/);
        if (m && m[1] === date && m[2] === entry && !idx.has(`n-${m[1]}-${m[2]}-${m[3]}`)) idx.set(`n-${m[1]}-${m[2]}-${m[3]}`, e.path);
      }
    }
    nbIndex = idx;
    return idx;
  }

  /** Текст → куски: обычный текст и готовые ссылки. null — ссылок нет. @param {string} s @param {Env} env @param {string} ownId */
  function splitLinks(s, env, ownId) {
    /** @type {Array<{ at: number, len: number, html: string }>} */
    const found = [];
    if (env.nb) {
      for (const m of s.matchAll(REF_RE)) {
        const id = `n-${m[1]}-${m[2]}${m[3] ? "-" + m[3] : ""}`;
        const where = notebookIndex().get(id);
        if (!where || m.index === undefined) continue;
        const own = id === ownId && where === env.file;
        found.push({ at: m.index, len: m[0].length, html: `<a class="${own ? "nb-id" : "nb-ref"}" href="${esc(hrefOf(where, id))}">${esc(m[0])}</a>` });
      }
    }
    // Дешёвая проверка до тяжёлой регулярки: в большом журнале кусков текста — сотни тысяч.
    if (HAS_EXT.test(s)) for (const m of s.matchAll(PATH_RE)) {
      if (m.index === undefined) continue;
      const at = m.index + m[1].length, p = m[2];
      if (found.some((f) => at < f.at + f.len && f.at < at + p.length)) continue;
      const hit = pathLike(p, env.file);
      if (hit) found.push({ at, len: p.length, html: `<a class="path-link" href="${esc(hrefOf(hit))}">${esc(p)}</a>` });
    }
    if (!found.length) return null;
    found.sort((a, b) => a.at - b.at);
    /** @type {Array<{ text: string } | { html: string }>} */
    const parts = [];
    let pos = 0;
    for (const f of found) {
      if (f.at > pos) parts.push({ text: s.slice(pos, f.at) });
      parts.push({ html: f.html });
      pos = f.at + f.len;
    }
    if (pos < s.length) parts.push({ text: s.slice(pos) });
    return parts;
  }

  /** Ссылки в текстовых кусках строки — кроме того, что уже внутри ссылки. @param {MdStateCore} state @param {MdToken} inl @param {Env} env @param {string} ownId */
  function linkText(state, inl, env, ownId) {
    const kids = inl.children;
    if (!kids) return;
    /** @type {MdToken[]} */
    const out = [];
    let depth = 0;
    for (const c of kids) {
      if (c.type === "link_open") depth++;
      else if (c.type === "link_close") depth--;
      const parts = c.type === "text" && depth === 0 ? splitLinks(c.content, env, ownId) : null;
      if (!parts) { out.push(c); continue; }
      for (const p of parts) {
        const t = ours(new state.Token("html" in p ? "html_inline" : "text", "", 0));
        t.content = "html" in p ? p.html : p.text;
        out.push(t);
      }
    }
    inl.children = out;
  }

  // Хвост пункта после «‖» (заменён, снят, закрыт, оспорен) — мельче; сам пункт приглушён.
  /** @param {MdStateCore} state @param {MdToken} inl */
  function wrapTail(state, inl) {
    const kids = inl.children ?? [];
    let depth = 0;
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      if (c.type === "link_open") depth++;
      else if (c.type === "link_close") depth--;
      const at = c.type === "text" && depth === 0 ? c.content.indexOf("‖") : -1;
      if (at < 0) continue;
      const before = new state.Token("text", "", 0);
      before.content = c.content.slice(0, at);
      const open = ours(new state.Token("html_inline", "", 0));
      open.content = '<span class="nb-tail">';
      const after = new state.Token("text", "", 0);
      after.content = c.content.slice(at);
      const close = ours(new state.Token("html_inline", "", 0));
      close.content = "</span>";
      kids.splice(k, 1, before, open, after);
      kids.push(close);
      return;
    }
  }

  // Правило ноута включается, только если в файле есть «№»: остальные md не задевает.
  md.core.ruler.push("to_html_notes", (state) => {
    /** @type {Env} */
    const env = state.env;
    env.nb = state.src.includes("№");
    const tokens = state.tokens;
    let date = "", entry = "";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "heading_open" && env.nb) {
        const text = tokens[i + 1].content.trim();
        if (t.tag === "h1" || t.tag === "h2") {
          date = t.tag === "h2" && /^\d{4}-\d\d-\d\d$/.test(text) ? text : "";
          entry = "";
        } else if (t.tag === "h3" && date) {
          const m = text.match(/^(\d+)\s*·/);
          entry = m ? m[1] : "";
          if (m) {
            const a = ours(new state.Token("html_inline", "", 0));
            a.content = `<span id="n-${date}-${entry}"></span>`;
            (tokens[i + 1].children ?? []).unshift(a);
          }
        }
      }
      if (t.type !== "inline") continue;
      let ownId = "";
      if (env.nb && i >= 2 && tokens[i - 1].type === "paragraph_open" && tokens[i - 2].type === "list_item_open") {
        const li = tokens[i - 2];
        const m = t.content.split("‖")[0].match(/·\s*(\d{4}-\d\d-\d\d)\s*№(\d+)\.(\d+)\s*$/);
        if (m && m[1] === date && m[2] === entry) { ownId = `n-${m[1]}-${m[2]}-${m[3]}`; li.attrSet("id", ownId); }
        if (t.content.includes("‖")) { li.attrJoin("class", "nb-off"); wrapTail(state, t); }
      }
      linkText(state, t, env, ownId);
    }
  });

  rules.fence = (tokens, idx, options, env) => {
    const t = tokens[idx];
    const lang = (t.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
    if (lang === "mermaid") return mermaidFigure(t.content);
    /** @type {Env} */
    const e = env;
    return e.frag ? plainCode(t.content, lang) : codeBlock(t.content, lang);
  };
  // Код в «Обзоре» — без шапки и подсветки: вид карточек задаёт overview.css.
  /** @param {string} code @param {string} lang */
  function plainCode(code, lang) {
    return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(code)}</code></pre>\n`;
  }

  // Схема рисуется позже (drawDiagram), а пока на её месте — исходник.
  /** @param {string} src */
  function mermaidFigure(src) {
    return `<figure class="figure mm"><div class="diagram" data-mermaid><pre class="mm-src">${esc(src.replace(/\n$/, ""))}</pre></div>` +
      `<figcaption>Mermaid <button class="icon-btn fig-btn" type="button" data-expand-fig title="Развернуть схему" aria-label="Развернуть схему">` +
      `${iconMark("i-expand")}</button></figcaption></figure>`;
  }
  rules.code_block = (tokens, idx, options, env) => (/** @type {Env} */ (env).frag ? plainCode : codeBlock)(tokens[idx].content, "");

  rules.table_open = (tokens, idx, options, env) => /** @type {Env} */ (env).frag ? "<table>\n" :
    `<div class="table"><button class="icon-btn expand" type="button" data-expand title="Развернуть таблицу" aria-label="Развернуть таблицу">${iconMark("i-expand")}</button><table>`;
  rules.table_close = (tokens, idx, options, env) => /** @type {Env} */ (env).frag ? "</table>\n" : "</table></div>";

  /** @type {Record<string, string>} */
  const LANG = { sh: "bash", shell: "bash", zsh: "bash", console: "bash", yml: "yaml", js: "javascript", ts: "typescript",
    py: "python", kt: "kotlin", golang: "go", "c#": "csharp", cs: "csharp", html: "xml", vue: "xml", jsonc: "json" };

  /** @param {string} code @param {string} lang */
  function highlight(code, lang) {
    const l = LANG[lang] ?? lang;
    if (l && window.hljs.getLanguage(l)) {
      try { return window.hljs.highlight(code, { language: l, ignoreIllegals: true }).value; } catch (e) { /* ниже — без подсветки */ }
    }
    return esc(code);
  }

  /** @param {string} code @param {string} rawLang @param {string} [label] */
  function codeBlock(code, rawLang, label) {
    const lang = rawLang.toLowerCase();
    const head = label ?? (lang === "plantuml" || lang === "puml" ? "PlantUML — исходник, без сервера не рисуем" : lang);
    return `<div class="code"><div class="code-head"><span>${esc(head)}</span>` +
      `<button class="icon-btn" type="button" data-copy>${iconMark("i-copy")}Копировать</button></div>` +
      `<pre><code>${highlight(code.replace(/\n$/, ""), lang)}</code></pre></div>`;
  }

  // Шапка «---» в начале: пары «ключ: значение» — карточкой; иначе markdown-it сделал бы из «---» заголовок.
  /** @param {string} src @returns {{ fm: Array<[string, string]> | null, body: string }} */
  function splitFrontMatter(src) {
    const m = src.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
    if (!m) return { fm: null, body: src };
    /** @type {Array<[string, string]>} */
    const pairs = [];
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([^\s:#-][^:]*):[ \t]*(.*)$/);
      const last = pairs[pairs.length - 1];
      if (kv) pairs.push([kv[1].trim(), kv[2].trim().replace(/^\[(.*)\]$/, "$1").replace(/^(["'])(.*)\1$/, "$2")]);
      else if (last && /^\s+(?:-\s+)?\S/.test(line)) last[1] += (last[1] ? ", " : "") + line.trim().replace(/^-\s+/, "");
    }
    if (!pairs.length) return { fm: null, body: src };
    return { fm: pairs, body: src.slice(m[0].length) };
  }

  const PURIFY = {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "textarea", "select"],
    SANITIZE_DOM: false,
    // Свой список схем: у DOMPurify нет file: (набор вне папки запуска) и blob: (перетащенные файлы) —
    // без них у картинок и ссылок пропадает адрес. javascript: и прочее по-прежнему режется.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  };
  // SANITIZE_DOM выключен: иначе DOMPurify снимает id, совпадающие со свойствами document (title, links,
  // images…), и заголовки «Title», «Links» теряют якоря. Скрипты и обработчики событий он снимает и так.
  /** @param {string} html */
  function purify(html) { return iconsIn(window.DOMPurify.sanitize(html, PURIFY)); }

  /** Сырой HTML автора: html_block или html_inline, который вставили не мы. @param {MdToken} t */
  function rawHtml(t) {
    if (t.type === "html_block") return true;
    return t.type === "inline" && (t.children ?? []).some((c) => c.type === "html_inline" && !(c.meta && c.meta.ours));
  }

  /** @param {Entry} e */
  function metaHtml(e) {
    const lines = hasText(e) ? textOf(e).split("\n").length : 0;
    return `<div class="doc-meta"><code>${esc(e.name)}</code><span>${human(e.size)}</span>` +
      (lines ? `<span>${lines.toLocaleString("ru")} строк</span>` : "") + "</div>";
  }

  // Большой файл режется по «##» верхнего уровня: каждая часть — <section> с content-visibility, браузер
  // рисует только видимые. Разбор один на весь файл — сноски и ссылки-определения работают через границы.
  /** @param {Entry} e @returns {{ html: string, headings: Heading[] }} */
  function renderMd(e) {
    const { fm, body } = splitFrontMatter(textOf(e));
    /** @type {Env} */
    const env = { file: e.path, headings: [], slugs: new Map() };
    const tokens = md.parse(body, env);
    const cuts = [0];
    tokens.forEach((t, i) => { if (i > 0 && t.type === "heading_open" && t.tag === "h2" && t.level === 0) cuts.push(i); });
    cuts.push(tokens.length);
    let html = fm ? `<dl class="fm">${fm.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
    const startsWithH1 = tokens.length > 0 && tokens[0].type === "heading_open" && tokens[0].tag === "h1";
    if (!startsWithH1) html += metaHtml(e);
    for (let k = 0; k < cuts.length - 1; k++) {
      const slice = tokens.slice(cuts[k], cuts[k + 1]);
      const rendered = md.renderer.render(slice, md.options, env);
      // DOMPurify нужен только там, где в md есть сырой HTML: остальное markdown-it отдаёт безопасным сам
      // (javascript: и прочее отсекает при разборе, текст экранирует), а свои вставки экранируем мы.
      // На журнале в мегабайты чистка всего подряд — половина времени открытия.
      let part = slice.some(rawHtml) ? purify(rendered) : iconsIn(rendered);
      if (k === 0 && startsWithH1) part = part.replace("</h1>", "</h1>" + metaHtml(e));
      html += `<section class="sec">${part}</section>`;
    }
    return { html, headings: env.headings };
  }

  // Кусок документа для «Обзора» (overview.js) — тем же разбором, что и весь документ: схемы, картинки, ссылки и
  // вставки считаются от пути документа. Заголовки без якорей (в обзоре свои), таблицы, код и галочки — без
  // обёрток to-html: вид карточек задаёт overview.css. Сырой HTML — текстом, как обзор показывал всегда:
  // иначе латинское слово в угловых скобках («<id>») очистка примет за тег и удалит.
  /** @param {string} src @param {string} file @param {boolean} [inline] */
  function fragment(src, file, inline) {
    /** @type {Env} */
    const env = { file, headings: [], slugs: new Map(), frag: true };
    md.options.html = false;
    try { return purify(inline ? md.renderInline(src, env) : md.render(src, env)); } finally { md.options.html = true; }
  }

  /** @param {Entry} e @returns {{ html: string, headings: Heading[] }} */
  function renderEntry(e) {
    const top = `<h1>${esc(e.name)}</h1>${metaHtml(e)}`;
    switch (e.kind) {
      case "md":
        if (!hasText(e)) return { html: top + tooBig(e), headings: [] };
        return renderMd(e);
      case "code": {
        if (!hasText(e)) return { html: top + tooBig(e), headings: [] };
        const ext = (e.name.match(/\.([^.]+)$/) ?? ["", ""])[1].toLowerCase();
        if (ext === "txt") return { html: top + `<div class="plain">${esc(textOf(e))}</div>`, headings: [] };
        if (ext === "mmd") return { html: top + purify(mermaidFigure(textOf(e))) + codeBlock(textOf(e), "", "исходник"), headings: [] };
        return { html: top + codeBlock(textOf(e), ext === "puml" ? "plantuml" : ext), headings: [] };
      }
      case "img":
        return { html: top + `<figure class="figure"><img src="${esc(fileUrl(e.path))}" data-file="${esc(e.path)}" alt="${esc(e.name)}">` +
          `<figcaption>${esc(e.path)} · ${human(e.size)}</figcaption></figure>`, headings: [] };
      case "other":
        return { html: top + `<div class="note-box">Этот файл страница не показывает. ` +
          (base || e.file ? `<a href="${esc(fileUrl(e.path))}" target="_blank">Открыть ${esc(e.name)}</a> — браузером или в системе.` : "") + "</div>", headings: [] };
      default: {
        /** @type {never} */
        const never = e.kind;
        throw new Error("неизвестный вид файла " + never);
      }
    }
  }

  /** @param {Entry} e */
  function tooBig(e) {
    return `<div class="note-box">Файл больше 5 МБ — страница его не показывает.` +
      (base || e.file ? ` <a href="${esc(fileUrl(e.path))}" target="_blank">Открыть как текст</a>.` : "") + "</div>";
  }

  // ---------------------------------------------------------------- дерево

  /** @typedef {{ name: string, path: string, dirs: Map<string, Folder>, files: Entry[], count: number }} Folder */

  const store = {
    /** @param {string} k */
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    /** @param {string} k @param {string} v */
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* хранилище недоступно — живём без него */ } },
  };
  const foldKey = () => "to-html:fold:" + rootLabel;
  /** @returns {Set<string>} папки, которые человек переключил руками */
  function toggled() {
    try { const v = JSON.parse(store.get(foldKey()) ?? "[]"); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []); }
    catch (e) { return new Set(); }
  }

  /** @param {string} name */
  function isMain(name) { return /^(readme|index)\.md$/i.test(name); }

  function buildFolders() {
    /** @type {Folder} */
    const root = { name: "", path: "", dirs: new Map(), files: [], count: 0 };
    for (const e of files.values()) {
      if (e.kind === "other") continue;
      let f = root;
      f.count++;
      if (e.dir) {
        let acc = "";
        for (const part of e.dir.split("/")) {
          acc = acc ? acc + "/" + part : part;
          let next = f.dirs.get(part);
          if (!next) { next = { name: part, path: acc, dirs: new Map(), files: [], count: 0 }; f.dirs.set(part, next); }
          f = next;
          f.count++;
        }
      }
      f.files.push(e);
    }
    return root;
  }

  function renderTree() {
    const keep = tree.scrollTop;
    tree.innerHTML = treeHtml(current, (p) => hrefOf(p), true);
    tree.scrollTop = keep;
  }

  // Дерево — и на странице, и в экспорте (там ссылки — на части файла, вложения — без ссылок).
  /** @param {string} cur @param {(path: string) => string} href @param {boolean} live */
  function treeHtml(cur, href, live) {
    const root = buildFolders();
    const flipped = live ? toggled() : new Set();
    const small = files.size <= 40;
    /** @param {Folder} f @param {number} d @returns {string} */
    const walk = (f, d) => {
      // Подпись — заголовок файла; у двух файлов папки с одним заголовком — имена файлов, иначе их не различить.
      /** @type {Map<string, number>} */
      const seen = new Map();
      for (const e of f.files) seen.set(titleOf(e), (seen.get(titleOf(e)) ?? 0) + 1);
      /** @param {Entry} e */
      const label = (e) => ((seen.get(titleOf(e)) ?? 0) > 1 ? e.name : titleOf(e));
      const fs = f.files.slice().sort((a, b) => (isMain(a.name) ? -1 : isMain(b.name) ? 1 : cmp(label(a), label(b))));
      let h = "<ul>";
      for (const e of fs) {
        const active = e.path === cur;
        const ico = e.kind === "img" ? "i-img" : e.kind === "code" ? (/\.(puml|plantuml|mmd)$/i.test(e.name) ? "i-schema" : "i-code") : "i-doc";
        const meta = e.size >= 1048576 ? `<span class="meta">${human(e.size)}</span>` : "";
        h += `<li><a class="row${active ? " active" : ""}" style="--d:${d}" href="${esc(href(e.path))}" title="${esc(e.path)}"` +
          `${active ? ' aria-current="page"' : ""}>${icon(ico)}<span class="lbl">${esc(label(e))}</span>${meta}</a>` +
          (active && live ? inlineToc(d) : "") + "</li>";
      }
      for (const sub of [...f.dirs.values()].sort((a, b) => cmp(a.name, b.name))) {
        const onPath = cur === sub.path || cur.startsWith(sub.path + "/");
        const open = (onPath || small || !live) !== flipped.has(sub.path);
        h += `<li class="${open ? "" : "closed"}"><button class="row folder${open ? " open" : ""}" style="--d:${d}" type="button" data-fold="${esc(sub.path)}"` +
          ` aria-expanded="${open}">${icon("i-chev", "chev")}<span class="lbl">${esc(sub.name)}</span><span class="meta">${sub.count}</span></button>` +
          walk(sub, d + 1) + "</li>";
      }
      return h + "</ul>";
    };
    let html = walk(root, 0);
    if (attachments.length) {
      html += `<div class="tree-sep"></div><div class="tree-cap">${live ? "Вложения" : "Вложения — в файл не вложены"}</div><ul>` + attachments.map((e) =>
        live
          ? `<li><a class="row${e.path === cur ? " active" : ""}" href="${esc(href(e.path))}" title="${esc(e.path)}">${icon("i-clip")}` +
            `<span class="lbl">${esc(e.name)}</span><span class="meta">${human(e.size)}</span></a></li>`
          : `<li><span class="row" title="${esc(e.path)}">${icon("i-clip")}<span class="lbl">${esc(e.name)}</span><span class="meta">${human(e.size)}</span></span></li>`
      ).join("") + "</ul>";
    }
    return html;
  }

  // ---------------------------------------------------------------- оглавление

  /** @param {Heading[]} list @returns {TocNode[]} */
  function nest(list) {
    /** @type {TocNode[]} */
    const roots = [];
    /** @type {TocNode[]} */
    const stack = [];
    for (const h of list) {
      const node = { h, children: [] };
      while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node); else roots.push(node);
      stack.push(node);
    }
    return roots;
  }

  function tocHeadings() {
    const sub = headings.filter((h) => h.level >= 2 && h.level <= 4);
    return sub.length >= 2 ? sub : headings.filter((h) => h.level <= 3);
  }

  function renderToc() {
    const list = tocHeadings();
    if (list.length < 2) { toc.innerHTML = ""; return; }
    const roots = nest(list);
    const collapsible = list.length > 40 && roots.length > 1;
    /** @param {TocNode[]} nodes @param {boolean} top @returns {string} */
    const walk = (nodes, top) => "<ul>" + nodes.map((n) =>
      `<li class="${top && collapsible && n.children.length ? "collapsed" : ""}"><a href="${esc(hrefOf(current, n.h.id))}" data-h="${esc(n.h.id)}">` +
      `${esc(n.h.text)}${top && collapsible && n.children.length ? `<span class="cnt">${n.children.length}</span>` : ""}</a>` +
      (n.children.length ? walk(n.children, false) : "") + "</li>").join("") + "</ul>";
    toc.innerHTML = `<div class="toc-head"><span class="toc-cap">На странице</span>` +
      (collapsible ? `<button class="toc-act" type="button" data-collapse>Свернуть всё</button>` : "") + `</div><nav>${walk(roots, true)}</nav>`;
  }

  /** @param {number} d */
  function inlineToc(d) {
    const list = tocHeadings();
    if (list.length < 2) return "";
    const min = Math.min(...list.map((h) => h.level));
    const shown = list.filter((h) => h.level <= min + 1).length <= 40 ? list.filter((h) => h.level <= min + 1) : list.filter((h) => h.level === min);
    return `<div class="inline-toc" style="--d:${d}">` + shown.map((h) =>
      `<a href="${esc(hrefOf(current, h.id))}" data-h="${esc(h.id)}" class="${h.level > min ? "lv3" : ""}">${esc(h.text)}</a>`).join("") + "</div>";
  }

  let activeId = "";
  function spy() {
    const hs = doc.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
    let id = "";
    for (const h of hs) { if (h.getBoundingClientRect().top < 96) id = h.id; else break; }
    if (id === activeId) return;
    activeId = id;
    for (const a of document.querySelectorAll("#toc a.on, #tree .inline-toc a.on")) a.classList.remove("on");
    if (!id) return;
    for (const a of document.querySelectorAll(`#toc a[data-h="${CSS.escape(id)}"], #tree .inline-toc a[data-h="${CSS.escape(id)}"]`)) {
      a.classList.add("on");
      const li = a.closest("#toc nav > ul > li");
      if (li) li.classList.remove("collapsed");
      const box = a.closest(".toc, .tree");
      if (box instanceof HTMLElement && a instanceof HTMLElement) {
        const top = a.offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = top - box.clientHeight / 3;
      }
    }
  }

  // ---------------------------------------------------------------- показ и адрес

  const posKey = (/** @type {string} */ p) => "to-html:pos:" + rootLabel + ":" + p;

  function savePos() {
    if (!current) return;
    const h = activeId ? doc.querySelector(`[id="${CSS.escape(activeId)}"]`) : null;
    const dy = h instanceof HTMLElement ? Math.round(-h.getBoundingClientRect().top) : 0;
    store.set(posKey(current), JSON.stringify({ id: h ? activeId : "", dy, y: Math.round(window.scrollY) }));
  }

  // Прыжок к разделу «держится»: схемы выше дорисовываются позже и сдвигают текст — после каждой
  // перерисовки возвращаемся к разделу, пока человек сам не начал листать (или не прошло 5 с).
  /** @type {{ id: string, dy: number, until: number } | null} */
  let anchorLock = null;
  for (const t of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(t, () => { anchorLock = null; }, { passive: true });

  /** @param {string} id @param {boolean} flash @param {number} [dy] */
  function scrollToId(id, flash, dy = 0) {
    const el = doc.querySelector(`[id="${CSS.escape(id)}"]`);
    if (!(el instanceof HTMLElement)) return false;
    el.scrollIntoView({ block: "start" });
    if (dy) window.scrollBy(0, dy);
    anchorLock = { id, dy, until: Date.now() + 5000 };
    const box = el.closest("li, h1, h2, h3, h4, h5, h6") ?? el;
    if (flash && box instanceof HTMLElement) { box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); }
    return true;
  }

  function holdAnchor() {
    if (!anchorLock || Date.now() > anchorLock.until) { anchorLock = null; return; }
    const { id, dy, until } = anchorLock;
    scrollToId(id, false, dy);
    anchorLock = { id, dy, until };
  }

  function restorePos() {
    let saved = null;
    try { saved = JSON.parse(store.get(posKey(current)) ?? "null"); } catch (e) { saved = null; }
    if (saved && typeof saved === "object" && typeof saved.id === "string" && saved.id &&
        scrollToId(saved.id, false, typeof saved.dy === "number" ? saved.dy : 0)) {
      // уже на месте
    } else if (saved && typeof saved === "object" && typeof saved.y === "number") {
      window.scrollTo(0, saved.y);
    } else {
      window.scrollTo(0, 0);
    }
  }

  /** @param {string} path */
  function show(path) {
    const e = files.get(path);
    if (!e) return;
    if (current) savePos();
    current = path;
    activeId = "";
    let out;
    try { out = renderEntry(e); }
    catch (err) {
      out = { html: `<h1>${esc(e.name)}</h1><div class="note-box err">Не удалось показать файл: ${esc(String(err))}</div>` +
        (hasText(e) ? codeBlock(textOf(e), "") : ""), headings: [] };
    }
    // Обзор документов петли (overview.js): свой вид для БТ и спеки, остальное — как было.
    if (window.CoddocView) { try { out = window.CoddocView.render(e, out) || out; } catch (err) { console.error(err); } }
    headings = out.headings;
    doc.innerHTML = out.html;
    if (window.CoddocView) { try { window.CoddocView.mounted(e, doc); } catch (err) { console.error(err); } }
    watchDiagrams();
    const title = titleOf(e);
    crumbs.innerHTML = `<span>${esc(setName())}</span>` + (e.dir ? e.dir.split("/").map((p) => `<span class="sep">›</span><span>${esc(p)}</span>`).join("") : "") +
      `<span class="sep">›</span><b>${esc(title)}</b>`;
    document.title = title + " — " + setName();
    renderTree();
    renderToc();
    document.body.classList.remove("drawer");
  }

  function startFile() {
    const open = find(openPath);
    if (open) return open;
    const first = [...files.values()].filter((e) => e.kind === "md").sort((a, b) => cmp(a.path, b.path))[0];
    return first ? first.path : [...files.keys()][0] ?? "";
  }

  function parseHash() {
    const h = location.hash.slice(1);
    if (!h) return null;
    if (!h.startsWith("f=")) return { path: "", id: safeDecode(h) };
    const q = new URLSearchParams(h);
    return { path: (q.get("f") ?? "").normalize("NFC"), id: q.get("h") ?? "" };
  }

  function route() {
    if (!files.size) return;
    const h = parseHash();
    if (h && !h.path) {
      // Якорь без файла (сноска, «#раздел»): он в текущем документе.
      if (current) { history.replaceState(null, "", hrefOf(current, h.id)); scrollToId(h.id, true); }
      return;
    }
    const want = h ? find(h.path) : null;
    const path = want ?? startFile();
    const changed = path !== current;
    if (changed) show(path);
    // Адрес всегда с файлом: F5 и «назад» возвращают сюда же, даже если снимок откроет другой файл первым.
    if (!want) history.replaceState(null, "", hrefOf(path, h ? h.id : ""));
    const hits = pendingHits;
    pendingHits = null;
    let at = h ? h.id : "";
    // Якорь из поиска посчитан по сырому тексту — не совпал, ищем заголовок по тексту.
    if (at && !scrollToId(at, true) && hits && hits.title) at = scrollToHeading(hits.title);
    else if (!at && changed) restorePos();
    if (hits) markHits(at, hits.words);
    spy();
  }

  // ---------------------------------------------------------------- картинки: запасной путь через assets.js

  /** @type {Promise<Map<string, string>> | null} */
  let assetsReady = null;
  function loadAssets() {
    if (assetsReady) return assetsReady;
    assetsReady = new Promise((done) => {
      const s = document.createElement("script");
      s.src = "assets.js?v=" + made.replace(/\D/g, "");
      s.onload = () => {
        /** @type {Map<string, string>} */
        const m = new Map();
        const list = window.MDV_ASSETS;
        if (Array.isArray(list)) for (const a of list) {
          if (Array.isArray(a) && typeof a[0] === "string" && typeof a[1] === "string" && typeof a[2] === "string") m.set(a[0].normalize("NFC"), `data:${a[1]};base64,${a[2]}`);
        }
        done(m);
      };
      s.onerror = () => done(new Map());
      document.head.appendChild(s);
    });
    return assetsReady;
  }

  /** @param {Event} ev */
  function imgFallback(ev) {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
    img.dataset.fallback = "1";
    const path = img.dataset.file;
    const missing = () => {
      const span = document.createElement("span");
      span.className = "img-missing";
      span.textContent = "картинка не нашлась: " + (path ?? img.getAttribute("src") ?? "");
      img.replaceWith(span);
    };
    if (!path) { missing(); return; }
    loadAssets().then((m) => { const u = m.get(path); if (u) img.src = u; else missing(); });
  }
  doc.addEventListener("error", imgFallback, true);

  // ---------------------------------------------------------------- схемы Mermaid

  // Библиотека — 2,5 МБ: грузим при первой схеме на странице, рисуем схему, когда она подходит к экрану.
  /** @type {Promise<boolean> | null} */
  let mermaidReady = null;
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((done) => {
      const s = document.createElement("script");
      s.src = "vendor/mermaid.min.js";
      s.onload = () => done(window.mermaid !== undefined);
      s.onerror = () => done(false);
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  function darkNow() {
    const t = document.documentElement.dataset.theme;
    return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // Цвета схем — из токенов страницы (макет to-html-mock.html).
  const MM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
  const MM_LIGHT = {
    fontFamily: MM_FONT, fontSize: "14px", background: "#ffffff", primaryColor: "#eef1fd", primaryBorderColor: "#3b5bdb",
    primaryTextColor: "#1d1d1f", secondaryColor: "#f7f7f5", tertiaryColor: "#ffffff", lineColor: "#5b5b60", textColor: "#1d1d1f",
    actorBkg: "#eef1fd", actorBorder: "#3b5bdb", actorTextColor: "#1d1d1f", actorLineColor: "#c9c8c4", signalColor: "#5b5b60",
    signalTextColor: "#1d1d1f", sequenceNumberColor: "#ffffff", noteBkgColor: "#fff3bf", noteBorderColor: "#e0c200",
    edgeLabelBackground: "#ffffff", clusterBkg: "#f7f7f5", clusterBorder: "#e4e3df",
  };
  const MM_DARK = {
    darkMode: true, fontFamily: MM_FONT, fontSize: "14px", background: "#1b1c1e", primaryColor: "#23283d", primaryBorderColor: "#8ea2ff",
    primaryTextColor: "#e8e8ea", secondaryColor: "#26272a", tertiaryColor: "#1b1c1e", lineColor: "#a0a0a8", textColor: "#e8e8ea",
    actorBkg: "#23283d", actorBorder: "#8ea2ff", actorTextColor: "#e8e8ea", actorLineColor: "#3a3b3f", signalColor: "#a0a0a8",
    signalTextColor: "#e8e8ea", sequenceNumberColor: "#151617", noteBkgColor: "#4a3f10", noteBorderColor: "#8a7420",
    edgeLabelBackground: "#1b1c1e", clusterBkg: "#26272a", clusterBorder: "#2e2f33",
  };

  /** @param {unknown} err */
  function errText(err) {
    const s = err instanceof Error ? err.message : String(err);
    return s.split("\n").slice(0, 3).join(" ").trim();
  }

  let mmSeq = 0;
  // mermaid.render с общим состоянием — схемы рисуем строго по одной.
  let mmQueue = Promise.resolve();
  /** @type {IntersectionObserver | null} */
  let mmObserver = null;

  // SVG схемы. labels: false — подписи без foreignObject: из такого SVG выходит PNG для буфера (иначе холст «портится»).
  /** @param {string} src @param {{ dark: boolean, labels: boolean }} o @returns {Promise<string>} */
  function mermaidSvg(src, o) {
    const job = mmQueue.then(async () => {
      const mm = (await loadMermaid()) ? window.mermaid : undefined;
      if (!mm) throw new Error("не загрузилась библиотека Mermaid (vendor/mermaid.min.js).");
      mm.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", logLevel: "fatal",
        themeVariables: o.dark ? MM_DARK : MM_LIGHT, htmlLabels: o.labels, flowchart: { htmlLabels: o.labels },
        sequence: { mirrorActors: false } });
      const id = "to-html-mm-" + ++mmSeq;
      try {
        await mm.parse(src);
        return (await mm.render(id, src)).svg;
      } finally {
        // При ошибке mermaid оставляет в body свой временный контейнер.
        document.getElementById("d" + id)?.remove();
      }
    });
    mmQueue = job.then(() => undefined, () => undefined);
    return job;
  }

  /** @param {HTMLElement} box */
  function drawDiagram(box) {
    const src = box.dataset.src ?? box.querySelector(".mm-src")?.textContent ?? "";
    box.dataset.src = src;
    const dark = darkNow();
    mermaidSvg(src, { dark, labels: true }).then((svg) => {
      if (!box.isConnected) return;
      box.innerHTML = svg;
      box.dataset.drawn = dark ? "dark" : "light";
      // Широкая схема на телефоне не сжимается в нечитаемое — прокручивается вбок.
      const el = box.querySelector("svg");
      const vb = el ? el.viewBox.baseVal : null;
      if (el && vb && vb.width) el.style.minWidth = Math.min(vb.width, 560) + "px";
    }, (err) => {
      if (!box.isConnected) return;
      box.innerHTML = `<div class="note-box err">Схема не нарисовалась: ${esc(errText(err))}</div><pre class="mm-src">${esc(src)}</pre>`;
      box.dataset.drawn = "error";
    }).finally(holdAnchor);
  }

  function watchDiagrams() {
    if (mmObserver) mmObserver.disconnect();
    const boxes = doc.querySelectorAll(".diagram[data-mermaid]");
    if (!boxes.length) return;
    mmObserver = new IntersectionObserver((entries, obs) => {
      for (const en of entries) {
        if (!en.isIntersecting || !(en.target instanceof HTMLElement)) continue;
        obs.unobserve(en.target);
        drawDiagram(en.target);
      }
    }, { rootMargin: "600px 0px" });
    for (const b of boxes) mmObserver.observe(b);
  }

  // Тема поменялась — перерисовать уже нарисованные схемы в новых цветах.
  function redrawDiagrams() {
    const want = darkNow() ? "dark" : "light";
    for (const box of doc.querySelectorAll(".diagram[data-mermaid]")) {
      if (box instanceof HTMLElement && (box.dataset.drawn === "light" || box.dataset.drawn === "dark") && box.dataset.drawn !== want) drawDiagram(box);
    }
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawDiagrams);

  // ---------------------------------------------------------------- тема, буфер, мелочи

  const THEMES = ["auto", "light", "dark"];
  const THEME_ICON = { auto: "#i-auto", light: "#i-sun", dark: "#i-moon" };
  const THEME_TITLE = { auto: "Тема: как в системе", light: "Тема: светлая", dark: "Тема: тёмная" };
  /** @param {string} t */
  function setTheme(t) {
    const theme = t === "light" || t === "dark" ? t : "auto";
    document.documentElement.dataset.theme = theme;
    for (const b of document.querySelectorAll("[data-theme-btn]")) {
      b.setAttribute("title", THEME_TITLE[theme]);
      b.querySelector("use")?.setAttribute("href", THEME_ICON[theme]);
    }
    try { localStorage.setItem("to-html:theme", theme); } catch (e) { /* без хранилища тема не запомнится */ }
    redrawDiagrams();
  }

  /** @param {string} text @param {{ label: string, run: () => void }} [action] @param {number} [ms] */
  function toast(text, action, ms) {
    const t = $("toast");
    t.innerHTML = icon("i-check") + esc(text) + (action ? `<button class="btn" type="button">${esc(action.label)}</button>` : "");
    const b = t.querySelector("button");
    if (b && action) b.addEventListener("click", () => { t.hidden = true; action.run(); });
    t.hidden = false;
    clearTimeout(Number(t.dataset.timer ?? 0));
    t.dataset.timer = String(setTimeout(() => { t.hidden = true; }, ms ?? (action ? 10000 : 1800)));
  }

  /** @param {string} text */
  function copyPlain(text) {
    /** @param {ClipboardEvent} e */
    const h = (e) => { e.clipboardData?.setData("text/plain", text); e.preventDefault(); };
    document.addEventListener("copy", h);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.removeEventListener("copy", h);
    return ok;
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const fold = t.closest("[data-fold]");
    if (fold instanceof HTMLElement) {
      const p = fold.dataset.fold ?? "";
      const set = toggled();
      if (set.has(p)) set.delete(p); else set.add(p);
      store.set(foldKey(), JSON.stringify([...set]));
      const li = fold.parentElement;
      const open = li ? li.classList.toggle("closed") === false : false;
      fold.classList.toggle("open", open);
      fold.setAttribute("aria-expanded", String(open));
      return;
    }
    const copy = t.closest("[data-copy]");
    if (copy) {
      const pre = copy.closest(".code")?.querySelector("pre");
      if (pre && copyPlain(pre.innerText)) toast("Скопировано");
      return;
    }
    const exp = t.closest("[data-expand]");
    if (exp) { exp.closest(".table")?.classList.toggle("full"); return; }
    const fig = t.closest("[data-expand-fig]");
    if (fig) { fig.closest(".figure")?.classList.toggle("full"); return; }
    if (t.closest("[data-theme-btn]")) {
      const cur = document.documentElement.dataset.theme ?? "auto";
      setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
      return;
    }
    if (t.closest("[data-collapse]")) { for (const li of toc.querySelectorAll("nav > ul > li")) if (li.querySelector("ul")) li.classList.add("collapsed"); return; }
    if (t.closest("[data-open-search]")) { openSearch(); return; }
    if (t.closest("#drawerBtn")) { document.body.classList.toggle("drawer"); return; }
    if (t.closest("#scrim")) { document.body.classList.remove("drawer"); return; }
    const a = t.closest("a");
    if (!(a instanceof HTMLAnchorElement)) return;
    if ((a.classList.contains("outside") || a.classList.contains("missing")) && a.getAttribute("href") === "#") { ev.preventDefault(); toast(a.title); return; }
    // Тот же адрес второй раз hashchange не даёт — прокручиваем сами.
    if (a.getAttribute("href") === location.hash) { ev.preventDefault(); route(); }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    document.body.classList.remove("drawer");
    $("dropover").hidden = true;
    $("search").hidden = true;
    for (const f of document.querySelectorAll(".table.full, .figure.full")) f.classList.remove("full");
  });

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; spy(); });
  }, { passive: true });
  let saveTimer = 0;
  window.addEventListener("scroll", () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(savePos, 250); }, { passive: true });
  window.addEventListener("pagehide", savePos);

  // ---------------------------------------------------------------- поиск

  /** @typedef {{ path: string, file: string, title: string, id: string, text: string, norm: string, normTitle: string, normFile: string }} Section */

  /** @type {Section[] | null} указатель: файлы, порезанные по заголовкам; строится при первом поиске */
  let searchIndex = null;
  /** @type {{ words: string[], title: string } | null} что подсветить после перехода из поиска */
  let pendingHits = null;

  // Регистр и «ё» не важны. Длина строки не меняется — позиции в сложенной строке те же, что в исходной.
  /** @param {string} s */
  function fold(s) { return s.toLowerCase().replace(/ё/g, "е"); }

  // Текст без разметки — для поиска и отрывков: ссылки — подписью, без *_`~>|#.
  /** @param {string} s */
  function plain(s) {
    return s.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
      .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ").replace(/[*_`~>|#]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function buildIndex() {
    /** @type {Section[]} */
    const out = [];
    for (const e of files.values()) {
      if ((e.kind !== "md" && e.kind !== "code") || !hasText(e)) continue;
      const file = titleOf(e);
      const normFile = fold(file + " " + e.path);
      /** @param {string} title @param {string} id @param {string} raw */
      const push = (title, id, raw) => {
        const text = plain(raw);
        if (text || title) out.push({ path: e.path, file, title, id, text, norm: fold(text), normTitle: fold(title), normFile });
      };
      if (e.kind === "code") { push("", "", textOf(e)); continue; }
      // Якоря — тем же правилом, что у заголовков на странице (slug); не совпадут — переход найдёт заголовок по тексту.
      /** @type {Map<string, number>} */
      const used = new Map();
      let title = "", id = "", fence = false;
      /** @type {string[]} */
      let buf = [];
      for (const line of splitFrontMatter(textOf(e)).body.split("\n")) {
        if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
        const m = fence ? null : line.match(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/);
        if (!m) { buf.push(line); continue; }
        push(title, id, buf.join("\n"));
        buf = [];
        title = stripMd(m[1]);
        id = slug(title, used);
      }
      push(title, id, buf.join("\n"));
    }
    return out;
  }

  /** @param {string[]} words */
  function wordsRe(words) {
    return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/е/g, "[её]")).join("|"), "giu");
  }

  /** Подсветка слов в строке; сама строка экранируется. @param {string} s @param {RegExp} re */
  function hl(s, re) {
    let out = "", pos = 0;
    for (const m of s.matchAll(re)) {
      if (m.index === undefined || !m[0]) continue;
      out += esc(s.slice(pos, m.index)) + "<mark>" + esc(m[0]) + "</mark>";
      pos = m.index + m[0].length;
    }
    return out + esc(s.slice(pos));
  }

  /** @param {Section} s @param {string[]} words @param {RegExp} re */
  function snippet(s, words, re) {
    let at = -1;
    for (const w of words) { const i = s.norm.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return hl(s.text.slice(0, 140), re);
    const from = Math.max(0, at - 50), to = Math.min(s.text.length, at + 100);
    return (from > 0 ? "…" : "") + hl(s.text.slice(from, to), re) + (to < s.text.length ? "…" : "");
  }

  /** @param {string} query */
  function searchFor(query) {
    const words = fold(plain(query)).split(" ").filter(Boolean);
    if (!words.length) return { words, hits: [] };
    if (!searchIndex) searchIndex = buildIndex();
    /** @type {Array<{ s: Section, score: number }>} */
    const hits = [];
    for (const s of searchIndex) {
      let score = 0;
      let all = true;
      for (const w of words) {
        const t = s.normTitle.includes(w), f = s.normFile.includes(w), x = s.norm.includes(w);
        if (!t && !f && !x) { all = false; break; }
        score += (t ? 6 : 0) + (f ? 3 : 0) + (x ? 1 : 0);
      }
      if (all) hits.push({ s, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return { words, hits: hits.slice(0, 50), total: hits.length };
  }

  const searchBox = $("search"), results = $("searchRes"), countEl = $("searchCount");
  const qInput = $("q");
  if (!(qInput instanceof HTMLInputElement)) throw new Error("#q — не поле ввода");
  const q = qInput;
  /** @type {Array<{ s: Section }>} */
  let shown = [];
  /** @type {string[]} */
  let lastWords = [];
  let active = 0;

  function runSearch() {
    const { words, hits, total } = searchFor(q.value);
    shown = hits;
    lastWords = words;
    active = 0;
    countEl.textContent = total ? (total > hits.length ? `${hits.length} из ${total}` : String(total)) : "";
    if (!words.length) { results.innerHTML = `<div class="s-note">Ищу по именам файлов, заголовкам и тексту всех файлов набора.</div>`; return; }
    if (!hits.length) { results.innerHTML = `<div class="s-note">Ничего не нашлось.</div>`; return; }
    const re = wordsRe(words);
    /** @type {Map<string, Array<{ s: Section, i: number }>>} */
    const groups = new Map();
    hits.forEach((h, i) => { const g = groups.get(h.s.path); if (g) g.push({ s: h.s, i }); else groups.set(h.s.path, [{ s: h.s, i }]); });
    // Порядок в окне — по группам; номер i — в порядке показа, для стрелок.
    shown = [];
    let html = "";
    for (const [path, items] of groups) {
      const e = files.get(path);
      html += `<div class="s-group">${icon("i-doc")}${esc(e ? titleOf(e) : path)}<small>${esc(path)}</small></div>`;
      for (const it of items) {
        const n = shown.length;
        shown.push({ s: it.s });
        html += `<a class="s-item${n === 0 ? " on" : ""}" role="option" aria-selected="${n === 0}" data-n="${n}" href="${esc(hrefOf(it.s.path, it.s.id))}">` +
          `<b>${hl(it.s.title || it.s.file, re)}</b><span>${snippet(it.s, words, re)}</span></a>`;
      }
    }
    results.innerHTML = html;
  }

  /** @param {number} n */
  function setActive(n) {
    if (!shown.length) return;
    active = (n + shown.length) % shown.length;
    for (const a of results.querySelectorAll(".s-item")) {
      const on = a instanceof HTMLElement && a.dataset.n === String(active);
      a.classList.toggle("on", on);
      a.setAttribute("aria-selected", String(on));
      if (on) a.scrollIntoView({ block: "nearest" });
    }
  }

  /** @param {number} n */
  function openResult(n) {
    const r = shown[n];
    if (!r) return;
    closeSearch();
    pendingHits = { words: lastWords, title: r.s.title };
    const href = hrefOf(r.s.path, r.s.id);
    if (href === location.hash) route(); else location.hash = href;
  }

  let searchTimer = 0;
  function openSearch() {
    if (app.hidden) return;
    searchBox.hidden = false;
    q.focus();
    q.select();
    runSearch();
  }
  function closeSearch() { searchBox.hidden = true; }

  q.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 80); });
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
    else if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(searchTimer); if (q.value && !shown.length) runSearch(); openResult(active); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeSearch(); }
  });
  results.addEventListener("click", (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest(".s-item") : null;
    if (!(a instanceof HTMLElement)) return;
    ev.preventDefault();
    openResult(Number(a.dataset.n));
  });
  searchBox.addEventListener("click", (ev) => { if (ev.target === searchBox) closeSearch(); });
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "k" || ev.key === "K" || ev.key === "л" || ev.key === "Л")) {
      ev.preventDefault();
      openSearch();
    }
  });

  /** Заголовок по тексту — запасной путь, если якорь из указателя не совпал со страницей. @param {string} title */
  function scrollToHeading(title) {
    const want = fold(title).trim();
    for (const h of doc.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      const text = [...h.childNodes].filter((n) => !(n instanceof Element && n.classList.contains("anchor"))).map((n) => n.textContent ?? "").join("");
      if (fold(text).trim() === want && h.id && scrollToId(h.id, true)) return h.id;
    }
    return "";
  }

  // Подсветка найденного в разделе: от заголовка до следующего заголовка того же уровня или выше.
  /** @param {string} id @param {string[]} words */
  function markHits(id, words) {
    for (const m of doc.querySelectorAll("mark.hit")) m.replaceWith(document.createTextNode(m.textContent ?? ""));
    doc.normalize();
    if (!words.length) return;
    const re = wordsRe(words);
    const start = id ? doc.querySelector(`[id="${CSS.escape(id)}"]`) : null;
    const head = start ? start.closest("h1, h2, h3, h4, h5, h6") ?? start : null;
    const level = head && /^H[1-6]$/.test(head.tagName) ? Number(head.tagName[1]) : 7;
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let inside = !head;
    /** @type {Text[]} */
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof Element) {
        if (n === head) { inside = true; continue; }
        if (inside && head && /^H[1-6]$/.test(n.tagName) && Number(n.tagName[1]) <= level && !head.contains(n)) break;
        continue;
      }
      if (!inside || !(n instanceof Text) || !n.data.trim()) continue;
      const p = n.parentElement;
      if (p && p.closest(".anchor, .code-head, svg, mark")) continue;
      texts.push(n);
    }
    /** @type {HTMLElement | null} */
    let first = null;
    let count = 0;
    for (const t of texts) {
      if (count >= 300) break;
      const s = t.data;
      const parts = [...s.matchAll(re)].filter((m) => m.index !== undefined && m[0]);
      if (!parts.length) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const m of parts) {
        const i = m.index ?? 0;
        frag.append(s.slice(pos, i));
        const mark = document.createElement("mark");
        mark.className = "hit";
        mark.textContent = m[0];
        frag.append(mark);
        if (!first) first = mark;
        pos = i + m[0].length;
        count++;
      }
      frag.append(s.slice(pos));
      t.replaceWith(frag);
    }
    // Найденное ниже экрана — показать первое совпадение.
    if (first && first.getBoundingClientRect().top > window.innerHeight * 0.8) first.scrollIntoView({ block: "center" });
  }

  // ---------------------------------------------------------------- экспорт

  /** @param {Blob} blob @returns {Promise<string>} */
  function dataUrlOf(blob) {
    return new Promise((done, fail) => {
      const r = new FileReader();
      r.onload = () => done(String(r.result));
      r.onerror = () => fail(r.error);
      r.readAsDataURL(blob);
    });
  }

  /** @param {string} src @returns {Promise<HTMLImageElement>} */
  function loadImage(src) {
    return new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => fail(new Error("картинка не загрузилась"));
      img.src = src;
    });
  }

  // Картинка внутрь файла: из перетащенного файла или из assets.js. Крупнее 2 МБ — до 1600 px по длинной стороне.
  /** @param {string} path @returns {Promise<string | null>} */
  async function embedImage(path) {
    const e = files.get(path);
    if (!e) return null;
    const url = e.file ? await dataUrlOf(e.file) : (await loadAssets()).get(path) ?? null;
    if (!url || e.size <= 2 * 1024 * 1024 || url.startsWith("data:image/svg")) return url;
    try {
      const img = await loadImage(url);
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext("2d");
      if (!ctx) return url;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    } catch (err) {
      return url;
    }
  }

  // PNG из SVG — для буфера: Word и Confluence SVG из буфера не берут. Фон белый, разрешение ×2.
  /** @param {string} svg */
  async function svgToPng(svg) {
    const el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const vb = (el.getAttribute("viewBox") ?? "0 0 600 400").split(/[\s,]+/).map(Number);
    const w = Math.max(1, Math.ceil(vb[2] || 600)), h = Math.max(1, Math.ceil(vb[3] || 400));
    el.setAttribute("width", String(w));
    el.setAttribute("height", String(h));
    el.removeAttribute("style");
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(el)));
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("нет холста");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    return { url: c.toDataURL("image/png"), width: w };
  }

  /** Ссылку — в текст с подсказкой: файла в экспорте нет. @param {Element} a @param {string} why */
  function unlink(a, why) {
    const s = document.createElement("span");
    s.className = "unlinked";
    s.title = why;
    s.innerHTML = a.innerHTML;
    a.replaceWith(s);
  }

  // Разметка документа без загрузки: в <template> картинки не грузятся (в большом журнале их тысячи).
  /** @param {string} html @returns {HTMLElement} */
  function inert(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = "<div>" + html + "</div>";
    const box = tpl.content.firstElementChild;
    if (!(box instanceof HTMLElement)) throw new Error("пустой документ");
    return box;
  }

  /** @param {string} href @returns {{ path: string, id: string } | null} */
  function parseInner(href) {
    if (!href.startsWith("#f=")) return null;
    const qs = new URLSearchParams(href.slice(1));
    return { path: (qs.get("f") ?? "").normalize("NFC"), id: qs.get("h") ?? "" };
  }

  // Документ для экспорта: та же отрисовка, что на странице, но картинки и схемы — внутри, ссылки между
  // файлами — на части файла (linkTo), кнопок нет. prefix — к id внутри части, чтобы части не столкнулись.
  /**
   * @param {Entry} e @param {string} prefix
   * @param {(path: string, id: string) => string | null} linkTo
   * @param {Map<string, Promise<string | null>>} images
   */
  async function exportPart(e, prefix, linkTo, images) {
    const box = inert(renderEntry(e).html);
    for (const b of box.querySelectorAll("button")) b.remove();
    if (prefix) for (const el of box.querySelectorAll("[id]")) el.id = prefix + el.id;
    for (const a of box.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") ?? "";
      const inner = parseInner(href);
      if (inner) {
        const to = linkTo(inner.path, inner.id);
        if (to === null) unlink(a, "в этот файл не вошло: " + inner.path); else { a.setAttribute("href", to); a.removeAttribute("target"); }
      } else if (href === "#" || href.startsWith("blob:") || href.startsWith("file:") || !/^([a-z][a-z0-9+.-]*:|#)/i.test(href)) {
        unlink(a, a.getAttribute("title") || "файл в экспорт не вложен");
      } else if (href.startsWith("#") && prefix) {
        a.setAttribute("href", "#" + prefix + href.slice(1)); // сноски: #fn1 → #d3-fn1, как и их id
      }
    }
    for (const img of box.querySelectorAll("img")) {
      const path = img.getAttribute("data-file") ?? undefined;
      let url = null;
      if (path) {
        let p = images.get(path);
        if (!p) { p = embedImage(path); images.set(path, p); }
        url = await p;
      }
      if (url) { img.setAttribute("src", url); img.removeAttribute("loading"); img.removeAttribute("data-file"); }
      else {
        const s = document.createElement("span");
        s.className = "img-missing";
        s.textContent = "картинка не вложена: " + (path ?? img.getAttribute("src") ?? "");
        img.replaceWith(s);
      }
    }
    for (const d of box.querySelectorAll(".diagram[data-mermaid]")) {
      const src = d.querySelector(".mm-src")?.textContent ?? "";
      try {
        const light = await mermaidSvg(src, { dark: false, labels: true });
        const dark = await mermaidSvg(src, { dark: true, labels: true });
        d.innerHTML = `<div class="mm-light">${light}</div><div class="mm-dark">${dark}</div>`;
      } catch (err) {
        d.innerHTML = `<div class="note-box err">Схема не нарисовалась: ${esc(errText(err))}</div><pre class="mm-src">${esc(src)}</pre>`;
      }
      d.removeAttribute("data-mermaid");
    }
    return box.innerHTML;
  }

  // Свой скрипт экспорта (~2 КБ): какая часть видна, оглавление, тема, панель на телефоне. Без библиотек.
  const EXPORT_JS = `(function(){"use strict";
var parts=[].slice.call(document.querySelectorAll(".part")),toc=document.getElementById("toc"),crumbs=document.getElementById("crumbs"),root=document.documentElement;
function esc(s){return s.replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function show(){var h=decodeURIComponent(location.hash.slice(1)),t=h?document.getElementById(h):null,p=t?t.closest(".part"):null;if(!p)p=parts[0];
parts.forEach(function(x){x.hidden=x!==p;});
[].forEach.call(document.querySelectorAll(".tree a.row"),function(r){r.classList.toggle("active",r.getAttribute("href")==="#"+p.id);});
if(crumbs)crumbs.textContent=p.getAttribute("data-title");document.title=p.getAttribute("data-title")+" — "+root.getAttribute("data-set");
var hs=p.querySelectorAll("h2[id],h3[id],h4[id]"),html="";[].forEach.call(hs,function(x){var c=x.cloneNode(true),a=c.querySelector(".anchor");if(a)a.remove();html+='<li><a class="l'+x.tagName[1]+'" href="#'+x.id+'">'+esc(c.textContent.trim())+"</a></li>";});
if(toc)toc.innerHTML=hs.length>1?'<div class="toc-head"><span class="toc-cap">На странице</span></div><nav><ul>'+html+"</ul></nav>":"";
if(t&&t!==p)t.scrollIntoView();else window.scrollTo(0,0);document.body.classList.remove("drawer");}
window.addEventListener("hashchange",show);show();
var order=["auto","light","dark"];try{var s=localStorage.getItem("to-html:theme");if(s)root.setAttribute("data-theme",s);}catch(e){}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-theme-btn],#drawerBtn,#scrim");if(!b)return;
if(b.id==="drawerBtn"){document.body.classList.toggle("drawer");return;}if(b.id==="scrim"){document.body.classList.remove("drawer");return;}
var n=order[(order.indexOf(root.getAttribute("data-theme")||"auto")+1)%3];root.setAttribute("data-theme",n);try{localStorage.setItem("to-html:theme",n);}catch(e){}});
})();`;

  /** @param {string} s */
  function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "to-html"; }

  /** @param {string} name @param {string} html */
  function download(name, html) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Один html: CSS страницы, значки, части и свой скрипт. Ни одного внешнего запроса.
  /** @param {"folder" | "doc"} what */
  async function exportHtml(what) {
    const cur = files.get(current);
    if (!cur) return;
    toast("Готовлю экспорт…", undefined, 120000);
    /** @type {Map<string, Promise<string | null>>} */
    const images = new Map();
    const list = what === "doc" ? [cur] : [...files.values()].filter((e) => e.kind !== "other").sort((a, b) => cmp(a.path, b.path));
    /** @type {Map<string, string>} путь → id части */
    const partOf = new Map(list.map((e, i) => [e.path, "d" + i]));
    let body = "";
    for (const e of list) {
      const pid = partOf.get(e.path) ?? "d0";
      const prefix = what === "doc" ? "" : pid + "-";
      const html = await exportPart(e, prefix, (path, id) => {
        const p = partOf.get(path);
        if (!p) return null;
        if (what === "doc") return "#" + (id || p);
        return "#" + (id ? p + "-" + id : p);
      }, images);
      body += `<section class="part" id="${pid}" data-title="${esc(titleOf(e))}">${html}</section>`;
    }
    const css = document.querySelector("head style")?.textContent ?? "";
    const sprite = document.querySelector("body > svg")?.outerHTML ?? "";
    const set = setName();
    const date = new Date().toISOString().slice(0, 10);
    const themeBtn = `<button class="icon-btn" data-theme-btn type="button" title="Тема" aria-label="Тема"><svg class="ico"><use href="#i-auto"/></svg></button>`;
    const side = what === "doc" ? "" :
      `<aside class="side"><div class="side-head"><div class="set-name">${esc(set)}</div><div class="set-path">экспорт · ${date}</div></div>` +
      `<nav class="tree" aria-label="Файлы">${treeHtml("", (p) => "#" + (partOf.get(p) ?? ""), false)}</nav>` +
      `<div class="side-foot"><span>файлов ${list.length}</span>${themeBtn}</div></aside>`;
    const page = `<!doctype html>\n<html lang="ru" data-theme="auto" data-set="${esc(set)}">\n<head>\n<meta charset="utf-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(what === "doc" ? titleOf(cur) : set)}</title>\n` +
      `<style>${css}</style>\n</head>\n<body>\n${sprite}\n<div class="app${what === "doc" ? " single" : ""}">${side}<main class="main"><header class="bar">` +
      (what === "doc" ? "" : `<button class="icon-btn only-narrow" id="drawerBtn" type="button" aria-label="Файлы"><svg class="ico"><use href="#i-menu"/></svg></button>`) +
      `<div class="crumbs"><b id="crumbs"></b></div>${what === "doc" ? themeBtn : ""}</header><article class="doc md">${body}</article></main>` +
      `<aside class="toc" id="toc" aria-label="На странице"></aside></div><div class="scrim" id="scrim"></div>\n<script>${EXPORT_JS}<\/script>\n</body>\n</html>\n`;
    const name = what === "doc" ? safeName(cur.name.replace(/\.[^.]+$/, "")) + ".html" : safeName(set) + "-" + date + ".html";
    download(name, page);
    toast("Сохранено: " + name);
  }

  // ---- в буфер для Confluence и Word: стили прямо в тегах — классы там не действуют

  /** @param {Element} el @param {string} css */
  function styleIt(el, css) { el.setAttribute("style", css); }

  /** @param {Entry} e */
  async function officeHtml(e) {
    const box = inert(renderEntry(e).html);
    for (const x of box.querySelectorAll("button, .anchor, .doc-meta")) x.remove();
    for (const s of box.querySelectorAll(".sec")) s.replaceWith(...s.childNodes);
    for (const a of box.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") ?? "";
      if (!/^(https?|mailto):/i.test(href)) a.replaceWith(...a.childNodes);
    }
    for (const d of box.querySelectorAll("figure.mm")) {
      const code = d.querySelector(".mm-src")?.textContent ?? "";
      try {
        const png = await svgToPng(await mermaidSvg(code, { dark: false, labels: false }));
        d.outerHTML = `<p><img src="${png.url}" width="${Math.min(png.width, 640)}" alt="схема"></p>`;
      } catch (err) {
        d.outerHTML = `<pre style="font-family:Consolas,monospace;white-space:pre-wrap">${esc(code)}</pre>`;
      }
    }
    for (const img of box.querySelectorAll("img[data-file]")) {
      const path = img.getAttribute("data-file") ?? "";
      const url = await embedImage(path);
      if (url) { img.setAttribute("src", url); img.removeAttribute("data-file"); img.removeAttribute("loading"); }
      else img.replaceWith(document.createTextNode("[картинка: " + path + "]"));
    }
    for (const c of box.querySelectorAll(".code")) {
      const pre = document.createElement("pre");
      pre.textContent = c.querySelector("pre")?.textContent ?? "";
      styleIt(pre, "font-family:Consolas,'Courier New',monospace;font-size:10pt;background:#f6f6f4;padding:8px;white-space:pre-wrap");
      c.replaceWith(pre);
    }
    for (const t of box.querySelectorAll(".table")) t.replaceWith(...t.childNodes);
    for (const t of box.querySelectorAll("table")) styleIt(t, "border-collapse:collapse");
    for (const c of box.querySelectorAll("th, td")) {
      const align = (/text-align:\s*(\w+)/.exec(c.getAttribute("style") ?? "") ?? ["", ""])[1];
      styleIt(c, "border:1px solid #999;padding:4px 8px;vertical-align:top" + (c.tagName === "TH" ? ";background:#f2f2f2;font-weight:bold" : "") + (align ? ";text-align:" + align : ""));
    }
    for (const c of box.querySelectorAll("code")) styleIt(c, "font-family:Consolas,'Courier New',monospace;background:#f4f4f2");
    for (const q of box.querySelectorAll("blockquote")) styleIt(q, "border-left:3px solid #ccc;margin:0 0 8px;padding:2px 12px;color:#555");
    for (const c of box.querySelectorAll(".callout")) {
      const color = c.classList.contains("tip") ? "#1a7f37" : c.classList.contains("warning") ? "#8a5a00" : c.classList.contains("caution") ? "#c62828" : "#3b5bdb";
      styleIt(c, `border-left:3px solid ${color};padding:6px 12px;margin:0 0 8px;background:#f7f7f5`);
      const t = c.querySelector(".callout-title");
      if (t) { t.querySelector("svg")?.remove(); styleIt(t, `font-weight:bold;color:${color}`); }
    }
    for (const b of box.querySelectorAll("li.task .box")) b.replaceWith(document.createTextNode(b.closest("li")?.classList.contains("done") ? "☑ " : "☐ "));
    for (const dl of box.querySelectorAll("dl.fm")) {
      const rows = [...dl.querySelectorAll("dt")].map((dt) =>
        `<tr><td style="border:1px solid #999;padding:4px 8px;color:#666">${esc(dt.textContent ?? "")}</td>` +
        `<td style="border:1px solid #999;padding:4px 8px">${esc(dt.nextElementSibling?.textContent ?? "")}</td></tr>`).join("");
      dl.outerHTML = `<table style="border-collapse:collapse">${rows}</table>`;
    }
    for (const s of box.querySelectorAll("svg")) s.remove();
    for (const el of box.querySelectorAll("[class]")) el.removeAttribute("class");
    for (const el of box.querySelectorAll("[id]")) el.removeAttribute("id");
    return box.innerHTML;
  }

  /** @param {string} html @param {string} text */
  function copyRich(html, text) {
    /** @param {ClipboardEvent} ev */
    const h = (ev) => { ev.clipboardData?.setData("text/html", html); ev.clipboardData?.setData("text/plain", text); ev.preventDefault(); };
    document.addEventListener("copy", h);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.removeEventListener("copy", h);
    return ok;
  }

  // Подготовка асинхронная (схемы, картинки), а копировать браузер даёт только сразу после щелчка.
  // Сначала ClipboardItem с обещанием (Chrome, Edge, Safari держат щелчок, пока данные готовятся),
  // потом событие copy; не вышло и оно — кнопка «Скопировать» в подсказке.
  async function copyOffice() {
    const e = files.get(current);
    if (!e) return;
    const text = hasText(e) ? textOf(e) : e.name;
    const ready = officeHtml(e);
    const done = () => toast("Скопировано — вставьте в Confluence или Word");
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": ready.then((h) => new Blob([h], { type: "text/html" })),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        done();
        return;
      } catch (err) { /* ниже — запасные пути */ }
    }
    const html = await ready;
    if (copyRich(html, text)) { done(); return; }
    toast("Готово к копированию", { label: "Скопировать", run: () => { if (copyRich(html, text)) done(); } });
  }

  const exportBtn = $("exportBtn"), exportMenu = $("exportMenu");
  /** @param {boolean} open */
  function menu(open) {
    exportMenu.hidden = !open;
    exportBtn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const n = [...files.values()].filter((e) => e.kind !== "other").length;
    const att = attachments.length;
    $("expFolderNote").textContent = `${n} ${n === 1 ? "файл" : n < 5 ? "файла" : "файлов"}, картинки и схемы внутри.` +
      (att ? ` ${att} вложени${att === 1 ? "е" : att < 5 ? "я" : "й"} — списком, без файлов.` : "") + " Откроется у коллеги без скилла.";
    const cur = files.get(current);
    $("expDocNote").textContent = (cur ? cur.name : "Текущий файл") + " с оглавлением.";
  }
  exportBtn.addEventListener("click", () => menu(exportMenu.hidden));
  exportMenu.addEventListener("click", (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest("[data-export]") : null;
    if (!(b instanceof HTMLElement)) return;
    menu(false);
    const what = b.dataset.export;
    if (what === "folder" || what === "doc") exportHtml(what);
    else if (what === "office") copyOffice();
  });
  document.addEventListener("click", (ev) => {
    if (!exportMenu.hidden && ev.target instanceof Node && !exportMenu.contains(ev.target) && !exportBtn.contains(ev.target)) menu(false);
  });

  // ---------------------------------------------------------------- инит: перетаскивание и выбор

  // Отбор — как у упаковщика: скрытое и node_modules не берём.
  /** @param {string} path */
  function skipped(path) { return path.split("/").some((s) => s.startsWith(".") || s === "node_modules"); }

  /** @param {FileSystemEntry} e @returns {e is FileSystemFileEntry} */
  function isFileEntry(e) { return e.isFile; }
  /** @param {FileSystemEntry} e @returns {e is FileSystemDirectoryEntry} */
  function isDirEntry(e) { return e.isDirectory; }

  /** @param {FileSystemDirectoryReader} r @returns {Promise<FileSystemEntry[]>} */
  function batchOf(r) { return new Promise((done, fail) => r.readEntries(done, fail)); }
  /** @param {FileSystemFileEntry} e @returns {Promise<File>} */
  function fileOf(e) { return new Promise((done, fail) => e.file(done, fail)); }

  /** @param {FileSystemDirectoryEntry} dir @returns {Promise<FileSystemEntry[]>} */
  async function children(dir) {
    const reader = dir.createReader();
    /** @type {FileSystemEntry[]} */
    const all = [];
    // readEntries отдаёт папку порциями (в Chrome по 100) — читаем, пока не вернёт пусто.
    for (;;) {
      const batch = await batchOf(reader);
      if (!batch.length) return all;
      all.push(...batch);
    }
  }

  /** @param {FileSystemEntry} entry @param {string} prefix @param {Picked[]} out @returns {Promise<void>} */
  async function readEntry(entry, prefix, out) {
    if (out.length > MAX_FILES || skipped(entry.name)) return;
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (isFileEntry(entry)) {
      out.push({ path, file: await fileOf(entry) });
    } else if (isDirEntry(entry)) {
      for (const c of await children(entry)) await readEntry(c, path, out);
    }
  }

  // webkitGetAsEntry и files читаются сразу, до первого await: после обработчика drop они пустеют.
  /** @param {DataTransfer} dt @returns {Promise<PickedSet>} */
  async function fromDrop(dt) {
    /** @type {FileSystemEntry[]} */
    const entries = [];
    for (const item of Array.from(dt.items)) {
      const en = item.kind === "file" ? item.webkitGetAsEntry() : null;
      if (en) entries.push(en);
    }
    const plain = Array.from(dt.files);
    /** @type {Picked[]} */
    const picked = [];
    const only = entries.length === 1 ? entries[0] : null;
    if (only && isDirEntry(only)) {
      for (const c of await children(only)) await readEntry(c, "", picked);
      return { picked, label: only.name };
    }
    if (entries.length) {
      for (const en of entries) await readEntry(en, "", picked);
      return { picked, label: "перетащенные файлы" };
    }
    for (const f of plain) if (!skipped(f.name)) picked.push({ path: f.name, file: f });
    return { picked, label: "перетащенные файлы" };
  }

  /** @param {FileList} list @param {boolean} dir @returns {PickedSet} */
  function fromInput(list, dir) {
    let label = dir ? "выбранная папка" : "выбранные файлы";
    /** @type {Picked[]} */
    const picked = [];
    for (const f of Array.from(list)) {
      let p = dir && f.webkitRelativePath ? f.webkitRelativePath : f.name;
      // У папки путь начинается с её имени: «заметки/Журнал.md» → набор «заметки», файл «Журнал.md».
      const i = dir ? p.indexOf("/") : -1;
      if (i >= 0) { label = p.slice(0, i); p = p.slice(i + 1); }
      if (!skipped(p)) picked.push({ path: p, file: f });
    }
    return { picked, label };
  }

  /** @param {string} msg */
  function warn(msg) {
    if (init.hidden) { toast(msg); return; }
    const w = $("initWarn");
    w.textContent = msg;
    w.hidden = !msg;
  }

  function now() {
    const d = new Date();
    const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Главный файл — как у упаковщика: README / index в корне, иначе самый большой .md в корне.
  function pickOpen() {
    const top = [...files.values()].filter((e) => !e.dir && e.kind === "md");
    const main = top.find((e) => /^readme\.md$/i.test(e.name)) ?? top.find((e) => /^index\.md$/i.test(e.name));
    if (main) return main.path;
    return top.sort((a, b) => b.size - a.size)[0]?.path ?? "";
  }

  /** @param {PickedSet} set */
  async function openPicked(set) {
    const isText = (/** @type {string} */ p) => { const k = kindOf(p); return k === "md" || k === "code"; };
    if (!set.picked.length) { warn("В выбранном нет файлов."); return; }
    if (set.picked.length > MAX_FILES) { warn(`Больше ${MAX_FILES} файлов — выбери папку поуже.`); return; }
    if (!set.picked.some((x) => isText(x.path))) { warn("Среди выбранного нет текстовых файлов (.md, .txt, .puml …)."); return; }
    $("dzBusy").hidden = false;
    const texts = await Promise.all(set.picked.map(async (x) =>
      isText(x.path) && x.file.size <= MAX_TEXT ? decodeText(new Uint8Array(await x.file.arrayBuffer())) : undefined));
    $("dzBusy").hidden = true;
    reset();
    base = "";
    rootLabel = set.label;
    made = now();
    dropped = true;
    set.picked.forEach((x, i) => add(x.path, x.file.size, null, x.file, texts[i]));
    attachments.sort((a, b) => cmp(a.path, b.path));
    openPath = pickOpen();
    history.replaceState(null, "", location.pathname + location.search);
    openSet();
  }

  let dragDepth = 0;
  /** @param {DragEvent} ev */
  const carriesFiles = (ev) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files");
  function dragOff() {
    dragDepth = 0;
    $("dropover").hidden = true;
    $("dropzone").classList.remove("over");
  }
  window.addEventListener("dragenter", (ev) => {
    if (!carriesFiles(ev)) return;
    ev.preventDefault();
    dragDepth++;
    if (init.hidden) {
      $("dropoverText").innerHTML = `Отпустите — откроется вместо «${esc(setName())}»<small>текущий набор закроется</small>`;
      $("dropover").hidden = false;
    } else $("dropzone").classList.add("over");
  });
  window.addEventListener("dragover", (ev) => {
    if (!carriesFiles(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (ev) => {
    if (!carriesFiles(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dragOff();
  });
  window.addEventListener("drop", (ev) => {
    if (!ev.dataTransfer || !carriesFiles(ev)) return;
    ev.preventDefault();
    const replacing = init.hidden;
    const was = setName();
    dragOff();
    fromDrop(ev.dataTransfer).then((set) => {
      if (replacing && !window.confirm(`Открыть «${set.label}» вместо «${was}»? Текущий набор закроется.`)) return;
      return openPicked(set);
    });
  });

  $("pickDir").addEventListener("click", () => $("dirInput").click());
  $("pickFiles").addEventListener("click", () => $("filesInput").click());
  /** @type {Array<[string, boolean]>} поле выбора → это папка */
  const pickers = [["dirInput", true], ["filesInput", false]];
  for (const [id, dir] of pickers) {
    const input = $(id);
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.files) return;
      const set = fromInput(input.files, dir);
      input.value = "";
      openPicked(set);
    });
  }

  // ---------------------------------------------------------------- старт

  function setName() { return rootLabel === "." ? "текущая папка" : rootLabel.split("/").filter(Boolean).pop() ?? ""; }

  /** @param {string} msg */
  function showInit(msg) {
    app.hidden = true;
    init.hidden = false;
    warn(msg);
    document.title = "to-html";
  }

  function openSet() {
    $("setName").textContent = setName();
    $("setPath").textContent = rootLabel === setName() ? "" : rootLabel;
    const m = made.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)$/);
    $("snap").textContent = dropped ? "перетащено · F5 сбросит" : "снимок " + (m ? `${m[3]}.${m[2]} · ${m[4]}` : made);
    app.hidden = false;
    init.hidden = true;
    route();
  }

  let theme = "auto";
  try { theme = localStorage.getItem("to-html:theme") ?? "auto"; } catch (e) { theme = "auto"; }
  setTheme(theme);
  if (window.CoddocView) window.CoddocView.attach({
    current: () => current, get: (/** @type {string} */ p) => files.get(p), text: textOf, has: hasText, paths: () => [...files.keys()],
    href: hrefOf, rerender: () => { const c = current; current = ""; show(c); },
    md: fragment,
    // Показ рисуется вне документа: схемы — сразу, у картинок — тот же запасной путь через assets.js.
    mount: (/** @type {HTMLElement} */ root) => {
      if (!root.dataset.imgFallback) { root.dataset.imgFallback = "1"; root.addEventListener("error", imgFallback, true); }
      for (const box of root.querySelectorAll(".diagram[data-mermaid]")) if (box instanceof HTMLElement && !box.dataset.drawn) drawDiagram(box);
    },
  });
  window.addEventListener("hashchange", route);

  const raw = window.MDV_DATA;
  if (raw === undefined) { showInit(""); return; }
  if (!isData(raw)) { showInit("Снимок повреждён — вызови /to-html ещё раз."); return; }
  if (!raw.files.length) { showInit(""); return; }
  load(raw);
  openSet();
})();
