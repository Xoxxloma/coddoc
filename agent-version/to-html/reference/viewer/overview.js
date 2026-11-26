// overview.js — режим «Обзор» и «Показ» для документов внутри to-html.
// Какой файл как раскладывать, задают описания видов в views.js; остальные .md — вид "md": разделы и шапка, как
// у документа без правил. Над документом — «Текст / Обзор» и «Показ»; открывается «Текстом», выбор вкладка помнит
// отдельно для документов петли и для остальных .md. Всё на странице — текст документа: блоки только раскладывают
// его; что не взял ни один блок — обычный markdown на своём месте.
// Ссылки FR-n / INT-n ищутся в той же папке; «#0» — фундамент эпика (_foundation/ выше по дереву); этап — по
// `owns:` в шапке stages/stage-NN.md. Экспорт и копирование в Confluence/Word берут обычную отрисовку — обзор их не задевает.
// Подключение к to-html: show() зовёт render() и mounted(), app.js отдаёт через attach() доступ к файлам и адресу.
(function () {
  'use strict';
  // Текст разделов рисует to-html (api.md): схемы, картинки и ссылки — как в «Тексте», от пути документа (CUR).
  var api = null, CUR = '';
  // ---------------------------------------------------------------- виды
  // Проектный вид с тем же id заменяет встроенный, с новым id — добавляется (и при совпадении файлов идёт первым).
  // Ошибки описаний не роняют страницу: файл пропускается, над документом — пометка.
  var VIEWS = window.CODDOC_VIEWS || [];
  // Описание вида с ошибкой (неизвестный блок) — в консоль: страница работает, раздел показывается как есть.
  function warn(msg) { if (window.console) console.warn('overview.js: ' + msg); }
  function globRe(p) { return new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$', 'i'); }
  function viewFor(name) {
    for (var i = 0; i < VIEWS.length; i++) if ((VIEWS[i].files || []).some(function (p) { return globRe(p).test(name); })) return VIEWS[i];
    return null;
  }
  function kindOf(v) { return v ? (v.kind || 'doc') : null; }
  function viewsBy(role) { return VIEWS.filter(function (v) { return v.role === role; }); }
  // Остальные .md: разделы без правил; раскладка — по маске файлов (layout.js). Блоков больше LIMIT — подразделы
  // остаются в своих разделах; и разделов больше — обзор без правки раскладки (журнал, CHANGELOG).
  var GENERIC = { id: 'md' }, LIMIT = 50;
  function viewOf(e) { return viewFor(e.name) || (/\.(md|markdown)$/i.test(e.name) ? GENERIC : null); }

  var store = {
    get: function (k) { try { return sessionStorage.getItem('cv:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem('cv:' + k, v); } catch (e) { /* без памяти */ } },
  };
  // «Текст» или «Обзор»: по умолчанию «Текст»; выбор — отдельно для документов петли и для остальных .md.
  function modeKey(v) { return v === GENERIC ? 'mode:md' : 'mode'; }
  function mode(v) { return store.get(modeKey(v)) || 'text'; }

  // ---------------------------------------------------------------- мелочи
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var MK = { '🟢': ['green', 'новое — спроектировано здесь'], '🔵': ['blue', 'подтверждено аналитиком'], '🟡': ['yellow', 'к валидации'],
    '❓': ['q', 'открытое решение'], '⚠️': ['w', 'требует уточнения'] };
  function marks(html) {
    return html.replace(/(🟢|🔵|🟡|❓|⚠️)/g, function (m) { return '<span class="mk ' + MK[m][0] + '" title="' + MK[m][1] + '">' + m + '</span>'; });
  }
  function R(text) { return marks(api.md(text || '', CUR)); }
  function RI(text) { return marks(api.md(text || '', CUR, true)); }
  function card(inner, cls, id) { return '<div class="card' + (cls ? ' ' + cls : '') + '"' + (id ? ' id="' + id + '"' : '') + '>' + inner + '</div>'; }
  function dirOf(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function join(d, f) { return d ? d + '/' + f : f; }
  function stripFm(text) { return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); }
  function frontMatter(text) { var m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/); return m ? m[1] : ''; }
  function fileText(path) { var e = api.get(path); return e && api.has(e) ? api.text(e) : null; }

  // ---------------------------------------------------------------- разбор: дерево заголовков
  function tree(text) {
    var root = { level: 0, title: '', body: [], children: [] }, stack = [root], fence = false;
    stripFm(text).split(/\r?\n/).forEach(function (l) {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      var m = !fence && l.match(/^(#{1,4})\s+(.*?)\s*$/);
      if (m) {
        var node = { level: m[1].length, title: m[2], body: [], children: [] };
        while (stack[stack.length - 1].level >= node.level) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else stack[stack.length - 1].body.push(l);
    });
    return root;
  }
  function mdOf(node, withTitle) {
    var s = (withTitle ? '#'.repeat(Math.min(node.level + 1, 4)) + ' ' + node.title + '\n' : '') + node.body.join('\n') + '\n';
    node.children.forEach(function (c) { s += mdOf(c, true); });
    return s;
  }
  function child(node, re) { for (var i = 0; node && i < node.children.length; i++) if (re.test(node.children[i].title)) return node.children[i]; return null; }
  function take(node, re) { var c = child(node, re); if (c) c.used = true; return c; }
  // Правило вида находит раздел по названию ("title": регулярное выражение без учёта регистра, без номера раздела) или
  // по номеру ("num": "4.2"). Правила одного уровня раздают разделы в два прохода: сначала по названию, потом по номеру
  // среди ещё не занятых — перенумерация шаблона не сбивает раскладку, а документ с другими названиями раскладывается
  // по номерам. Один раздел — одному правилу.
  function titleRe(r) {
    if (!r.title) return null;
    try { return new RegExp(r.title, 'i'); } catch (e) { warn('неверное выражение "title": ' + r.title); return null; }
  }
  function assign(node, rules) {
    var map = new Map(), taken = new Set(), kids = node ? node.children : [];
    rules.forEach(function (r) {
      var re = titleRe(r);
      if (!re) return;
      for (var i = 0; i < kids.length; i++) if (!taken.has(kids[i]) && re.test(secNum(kids[i].title).name)) { map.set(r, kids[i]); taken.add(kids[i]); return; }
    });
    rules.forEach(function (r) {
      if (map.has(r) || r.num == null) return;
      for (var i = 0; i < kids.length; i++) if (!taken.has(kids[i]) && secNum(kids[i].title).num === String(r.num)) { map.set(r, kids[i]); taken.add(kids[i]); return; }
    });
    return map;
  }
  // Правила верхнего уровня вида: разделы, их пары («with») и раздел критичности шапки.
  function topRules(view) {
    var rs = [];
    ((view && view.sections) || []).forEach(function (r) { rs.push(r); if (r.with) rs.push(r.with); });
    if (view && view.hero && view.hero.critical) rs.push(view.hero.critical);
    return rs;
  }
  function topMap(view, root) {
    if (!root) return new Map();
    if (!root._amap || root._aview !== view) { root._amap = assign(root, topRules(view)); root._aview = view; }
    return root._amap;
  }
  // Раздел верхнего уровня по правилу вида — или подраздел по одиночному правилу (данные, чек-лист).
  function find(node, rule) {
    if (!node || !rule) return null;
    if (node._amap && node._amap.has(rule)) return node._amap.get(rule);
    return assign(node, [rule]).get(rule) || null;
  }
  function takeRule(node, rule) { var c = find(node, rule); if (c) c.used = true; return c; }
  function findTop(view, root, rule) { return rule ? topMap(view, root).get(rule) || null : null; }
  function ruleFor(view, node, root) {
    var hit = null;
    topMap(view, root).forEach(function (n, r) { if (n === node && !hit && (view.sections || []).indexOf(r) >= 0) hit = r; });
    return hit;
  }
  function ruleBy(view, block) { var rs = (view && view.sections) || []; for (var i = 0; i < rs.length; i++) if (rs[i].block === block) return rs[i]; return null; }
  function bodyMd(node) { return node ? node.body.join('\n').trim() : ''; }
  // Правило полноты: что обработчик раздела не забрал — строки, абзацы рядом с таблицей, подзаголовки ниже уровнем, —
  // выводится markdown на месте. Обзор раскладывает текст документа, а не выбирает из него.
  function kidsMd(node) { return node ? node.children.map(function (c) { return mdOf(c, true); }).join('') : ''; }
  function nonTable(node) { return node ? node.body.filter(function (l) { return !/^\s*\|/.test(l); }).join('\n').trim() : ''; }
  function restCard(md) { md = (md || '').trim(); return md ? card('<div class="cv-md">' + R(md) + '</div>') : ''; }
  function table(lines) {
    var rows = lines.filter(function (l) { return /^\s*\|/.test(l); }).map(function (l) {
      return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
    }).filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c); }); });
    return { head: rows[0] || [], rows: rows.slice(1) };
  }
  function secNum(title) { var m = title.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/); return m ? { num: m[1], name: m[2] } : { num: '', name: title }; }
  function header(h1) {
    var kv = {}, list = [], oq = [], oqNote = '', legend = [], free = [], md2 = null;
    h1.body.filter(function (l) { return /^>/.test(l); }).map(function (l) { return l.replace(/^>\s?/, ''); }).forEach(function (l) {
      var m = l.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (m) {
        var k = m[1].trim(), v = m[2].trim();
        kv[k] = v; list.push([k, v]);
        md2 = /Открытые вопросы/i.test(k) ? 'oq' : /Легенда/i.test(k) ? 'legend' : null;
        if (md2 === 'oq' && v) oqNote += v;
        if (md2 === 'legend' && v) legend.push(v);
        return;
      }
      if (md2 === 'oq') { var n = l.match(/^\s*\d+\.\s+(.*)$/); if (n) oq.push(n[1]); else if (l.trim()) oqNote += (oqNote ? ' ' : '') + l.trim(); }
      else if (md2 === 'legend' && l.trim()) legend.push(l.trim());
      else if (l.trim()) free.push(l);
    });
    return { kv: kv, list: list, oq: oq, oqNote: oqNote, legend: legend, free: free, rest: h1.body.filter(function (l) { return !/^>/.test(l); }).join('\n').trim() };
  }
  // Шапка: чипами — задача, статус, автор, редакция (у спеки строкой — источник); остальные строки шапки и текст под
  // заголовком — как есть.
  var SHOWN = /^(Задача|Статус|Автор|Редакция)/;
  function heroRest(hd, shown) {
    var lines = hd.list.filter(function (p) { return !shown.test(p[0]) && !/Открытые вопросы|Легенда/i.test(p[0]); })
      .map(function (p) { return '**' + p[0] + ':** ' + p[1]; });
    var md = (lines.join('  \n') + (hd.free.length ? '\n\n' + hd.free.join('\n') : '') + (hd.rest ? '\n\n' + hd.rest : '')).trim();
    return md ? '<div class="cv-md hero-rest">' + R(md) + '</div>' : '';
  }
  // Открытые вопросы — всегда карточкой с заголовком: и со списком, и одной пометкой («Все данные подтверждены…»).
  function heroOq(hd, numbered) {
    if (!hd.oq.length) return hd.oqNote ? '<div class="card"><h3>Открытые вопросы</h3><div class="cv-md">' + RI(hd.oqNote) + '</div></div>' : '';
    var note = hd.oqNote ? '<p class="muted" style="margin:0 0 8px">' + RI(hd.oqNote) + '</p>' : '';
    return numbered
      ? '<div class="card" style="margin-top:16px"><h3>Открытые вопросы · ' + hd.oq.length + '</h3>' + note + '<ol class="oq">' +
        hd.oq.map(function (q, i) { return '<li><span class="n">' + (i + 1) + '</span><span>' + RI(q) + '</span></li>'; }).join('') + '</ol></div>'
      : '<div class="card" style="margin-top:16px"><h3>Открытые вопросы</h3>' + note + '<ol class="cv-md">' + hd.oq.map(function (q) { return '<li>' + RI(q) + '</li>'; }).join('') + '</ol></div>';
  }
  // Вне первого заголовка «#»: текст над ним и второй «#», если есть, — в конце обзора.
  function outsideMd(m) { return m.top ? (m.top.body.join('\n') + '\n' + m.top.children.slice(1).map(function (c) { return mdOf(c, true); }).join('')).trim() : ''; }
  function kvGet(kv, re) { for (var k in kv) if (re.test(k)) return kv[k]; return ''; }
  function gwt(text) {
    var g = text.match(/^Дано:?\s+([\s\S]+?)[,.]\s+когда:?\s+([\s\S]+?)[,.]\s+тогда:?\s+([\s\S]+)$/i);
    return g ? { given: g[1], when: g[2], then: g[3] } : null;
  }
  function gwtHtml(g) {
    return '<div class="gwt"><span class="k">ДАНО</span><span>' + RI(g.given) + '</span><span class="k">КОГДА</span><span>' + RI(g.when) +
      '</span><span class="k then">ТОГДА</span><span>' + RI(g.then) + '</span></div>';
  }

  // ---------------------------------------------------------------- модели
  var FR_LINE = /^(?:-\s+)?\*\*FR-(\d+)\b\.?\s*(.*?)\*\*\s*(.*)$/;
  function brdModel(text, view) {
    var top = tree(text), h1 = top.children[0] || { title: '', body: [], children: [] };
    var m = { kind: 'brd', top: top, root: h1, head: header(h1), frs: [], crit: {}, critOther: [], critText: [] };
    var tm = h1.title.match(/^(.+?):\s*(.+)$/);
    m.kindLabel = tm ? tm[1] : 'Бизнес-требования'; m.title = tm ? tm[2] : h1.title;
    // Требования и критерии ищутся по содержимому, а не по номеру: подраздел §4 со строками FR — требования,
    // с пунктами «- **[FR-n]**» — критерии. Остальные подразделы §4 (например, «4.2. Роли») — обычным markdown.
    var s4 = findTop(view, h1, ruleBy(view, 'requirements')), kids4 = s4 ? s4.children : [];
    var s41 = kids4.filter(function (k) { return k.body.some(function (l) { return FR_LINE.test(l); }); })[0] || null;
    var s42 = kids4.filter(function (k) { return k !== s41 && k.body.some(function (l) { return /^- \*\*\[FR-\d+\]\*\*/.test(l); }); })[0] || null;
    m.s41 = s41; m.s42 = s42;
    if (s41) {
      var cur = null, intro = [];
      s41.body.forEach(function (l) {
        var f = l.match(FR_LINE);
        if (f) {
          // Формы: «**FR-1. Название**», «**FR-1. Название.** текст», «**FR-1** текст», «- **FR-1.** текст», пометка после «**».
          cur = { id: 'FR-' + f[1], n: f[1], name: f[2].replace(/\.$/, ''), text: [] };
          if (f[3].trim()) cur.text.push(f[3]);
          m.frs.push(cur);
        } else if (cur) cur.text.push(l); else intro.push(l);
      });
      m.frIntro = intro.join('\n').trim();
    }
    if (s42) {
      var it = null;
      s42.body.forEach(function (l) {
        var c = l.match(/^- \*\*\[(FR-\d+)\]\*\*\s*(.*)$/);
        if (c) { it = { fr: c[1], text: c[2] }; (m.crit[c[1]] = m.crit[c[1]] || []).push(it); }
        else if (/^- /.test(l)) { it = { fr: '', text: l.replace(/^- /, '') }; m.critOther.push(it); }
        else if (it && /^\s+\S/.test(l)) it.text += ' ' + l.trim();
        else if (l.trim()) { it = null; m.critText.push(l); }
      });
    }
    return m;
  }
  function specModel(text, view) {
    var top = tree(text), h1 = top.children[0] || { title: '', body: [], children: [] };
    var m = { kind: 'spec', top: top, root: h1, head: header(h1), ints: [], trace: {}, traceRows: [] };
    var tm = h1.title.match(/^(.+?):\s*(.+)$/);
    m.kindLabel = tm ? tm[1] : 'Техническая спецификация'; m.title = tm ? tm[2] : h1.title;
    var s2 = findTop(view, h1, ruleBy(view, 'interactions'));
    if (s2) s2.children.forEach(function (c) {
      var im = c.title.match(/^INT-(\d+)\.\s*(.+)$/);
      if (!im) return;
      var parts = im[2].split(/\s+—\s+/), name = parts.shift(), origin = parts.join(' — ');
      var f = fields(c.body), get = function (re) { for (var i = 0; i < f.length; i++) if (re.test(f[i].name)) return f[i].md; return ''; };
      var routes = [], rx = /`((GET|POST|PUT|PATCH|DELETE)\s+[^`]+)`/g, r, req = get(/^Контракт \(запрос\)/) || get(/^Контракт/);
      // Путь — из контракта; у «изменения существующего» и потребления он записан в «Существующий стык».
      [req, get(/^Существующий стык/)].some(function (src) {
        while ((r = rx.exec(src))) { var full = r[1].split(/\s+/), q = full[1].split('?'); routes.push({ verb: full[0], path: q[0], query: q[1] || '' }); }
        rx.lastIndex = 0;
        return routes.length > 0;
      });
      m.ints.push({ node: c, id: 'INT-' + im[1], n: im[1], name: name, origin: origin, fields: f, routes: routes,
        dir: get(/^Граница/), trigger: get(/^Триггер/), traceFr: (get(/^Трассировка/).match(/FR-\d+/g) || []) });
    });
    var s7 = findTop(view, h1, ruleBy(view, 'trace'));
    if (s7) table(s7.body).rows.forEach(function (row) {
      m.traceRows.push(row);
      (row[0].match(/FR-\d+/g) || []).forEach(function (fr) { m.trace[fr] = { ints: (row[1] || '').match(/INT-\d+/g) || [], test: row[2] || '' }; });
    });
    return m;
  }
  function fields(body) {
    var out = [], cur = null;
    body.forEach(function (l) {
      var m = l.match(/^- \*\*(.+?):\*\*\s?(.*)$/);
      if (m) { cur = { name: m[1], md: m[2] }; out.push(cur); }
      else if (cur) cur.md += '\n' + l.replace(/^ {2}/, '');
      else if (l.trim()) { cur = { name: '', md: l }; out.push(cur); }
    });
    return out;
  }

  // ---------------------------------------------------------------- соседи по дереву
  function ctx(path) {
    var dir = dirOf(path), c = { dir: dir, brd: join(dir, 'business_requirements.md'), spec: join(dir, 'technical_specification.md'), stageOf: {}, children: [], epic: null, foundation: null };
    // Спека папки и документ, из которого она берёт требования FR, — по ролям видов ("spec", "source").
    var specV = viewsBy('spec')[0];
    if (specV) c.spec = join(dir, specV.files[0]);
    c.specLabel = specV ? (specV.label || specV.id) : 'Спека';
    viewsBy('source').some(function (v) { var p = join(dir, v.files[0]); if (api.get(p)) { c.src = p; c.srcLabel = v.label || v.id; return true; } return false; });
    if (!c.src) { c.src = c.brd; c.srcLabel = 'БТ'; }
    // Этапы: stages/stage-NN.md, `owns: [INT-1, …]` в шапке.
    api.paths().filter(function (p) { return dirOf(p) === join(dir, 'stages') && /\/stage-\d+\.md$/i.test(p); }).sort().forEach(function (p) {
      var t = fileText(p) || '', fm = frontMatter(t), owns = (fm.match(/^owns:\s*\[(.*)\]/m) || [])[1] || '';
      var title = (stripFm(t).match(/^#\s+(.+)$/m) || [])[1] || p;
      var num = (p.match(/stage-(\d+)\.md$/i) || [])[1];
      (owns.match(/INT-\d+/g) || []).forEach(function (i) { c.stageOf[i] = { path: p, num: num, title: title }; });
    });
    // Эпик: decomposition.md в этой папке — мы эпик; в родительской — мы часть.
    var dec = fileText(join(dir, 'decomposition.md'));
    if (dec) (frontMatter(dec).match(/key:\s*(\S+)/g) || []).forEach(function (k) { var key = k.split(/:\s*/)[1]; c.children.push({ key: key, path: join(join(dir, key), 'business_requirements.md') }); });
    var parent = dirOf(dir);
    if (fileText(join(parent, 'decomposition.md')) !== null) c.epic = { key: parent.split('/').pop(), path: join(parent, 'business_requirements.md') };
    // Фундамент: _foundation/ рядом с эпиком — в этой папке или выше.
    [dir, parent].forEach(function (d) { if (!c.foundation && api.get(join(join(d, '_foundation'), 'technical_specification.md'))) c.foundation = join(join(d, '_foundation'), 'technical_specification.md'); });
    if (dir.split('/').pop() === '_foundation') { c.foundation = null; c.isFoundation = true; }
    return c;
  }
  function statusOf(path) {
    var t = fileText(path);
    if (t === null) return null;
    var h1 = tree(t).children[0];
    return h1 ? kvGet(header(h1).kv, /Статус/) : '';
  }
  function goAttr(path, anchor) { return ' data-cv-go="' + esc(path) + (anchor ? '#' + anchor : '') + '"'; }

  // ---------------------------------------------------------------- обзор: общее
  function statusChip(st) {
    if (!st) return '';
    return '<span class="chip ' + (/уточнени|TBD|не готов/i.test(st) ? 'warn' : 'ok') + '">' + esc(st) + '</span>';
  }
  function secHead(node) { var s = secNum(node.title); return '<h2>' + (s.num ? '<span class="num">' + esc(s.num) + '</span>' : '') + RI(s.name) + '</h2>'; }
  function sub(c, cls) { var s = secNum(c.title); return card('<h3>' + esc(s.name) + '</h3><div class="cv-md">' + R(mdOf(c, false)) + '</div>', cls); }
  function heroChips(m, c, extra) {
    var kv = m.head.kv, key = kvGet(kv, /^Задача/);
    var h = '<div class="chips">' + (key ? '<span class="chip"><b>' + esc(key) + '</b></span>' : '') + statusChip(kvGet(kv, /Статус/)) +
      (kvGet(kv, /^Редакция/) ? '<span class="chip">редакция ' + esc(kvGet(kv, /^Редакция/)) + '</span>' : '') +
      (kvGet(kv, /^Автор/) ? '<span class="chip">автор ' + esc(kvGet(kv, /^Автор/)) + '</span>' : '') + (extra || '');
    if (c.epic) h += '<span class="chip link"' + goAttr(c.epic.path) + '>эпик ' + esc(c.epic.key) + '</span>';
    c.children.forEach(function (ch) { var st = statusOf(ch.path); if (st !== null) h += '<span class="chip link"' + goAttr(ch.path) + '>часть ' + esc(ch.key) + '</span>'; });
    if (c.foundation && heroOpt(m).foundation) h += '<span class="chip link"' + goAttr(c.foundation) + '>фундамент #0</span>';
    return h + '</div>';
  }
  function heroOpt(m) { return (m.view && m.view.hero) || {}; }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ---------------------------------------------------------------- блоки раскладки
  // Обзор — список блоков: шапка, открытые вопросы, раздел (заголовок и что под ним), пункт ряда, подраздел без
  // правила, текст вне документа. Порядок и ширину блоков задаёт своя раскладка (layout.js); без неё — порядок
  // документа и ширина по описанию вида. Ключ блока — имя для раскладки, одно на все документы этого типа: по
  // правилу вида (первое название из "title") или по названию раздела без номера.
  function norm(s) { return String(s || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function ruleKey(r) {
    var t = String(r.title || '').split('|')[0].replace(/^\^/, '').replace(/\$$/, '').replace(/\\(.)/g, '$1').replace(/[.*+?()[\]{}]/g, '');
    return norm(t) || '#' + r.num;
  }
  function nodeKey(node, rule) { return rule ? ruleKey(rule) : norm(secNum(node.title).name); }
  function Items() { this.list = []; this.keys = {}; }
  // span — ширина по умолчанию из 12 колонок; heads — строки оглавления блока; head — блок начинает раздел.
  Items.prototype.add = function (key, title, html, span, heads, head) {
    if (!html) return;
    var k = key || '?', n = 2;
    while (this.keys[k]) k = key + ' ~' + n++;
    this.keys[k] = 1;
    this.list.push({ key: k, title: String(title || k).replace(/~~|\*\*|`/g, ''), html: html, span: span || 12, heads: heads || [], head: !!head });
  };

  // Шапка вида («hero» в описании): чипы задачи, статуса, редакции и автора; критичность — первым словом раздела
  // «critical»; соседний документ — «sibling» ("spec" — спека папки, "source" — документ, из которого спека берёт FR);
  // строка-ключ шапки — «line»; легенда меток; остальные строки шапки. Открытые вопросы — своим блоком (questions).
  function hero(m, c) {
    var hc = heroOpt(m), hd = m.head, extra = '';
    if (hc.critical) { var crit = critWord(findTop(m.view, m.root, hc.critical)); if (crit) extra += '<span class="chip crit">критичность · ' + esc(crit) + '</span>'; }
    if (hc.sibling === 'spec') { var ss = statusOf(c.spec); if (ss !== null) extra += '<span class="chip link"' + goAttr(c.spec) + '>' + esc(c.specLabel) + ' · ' + esc(ss) + '</span>'; }
    if (hc.sibling === 'source') { var bs = statusOf(c.src); if (bs !== null) extra += '<span class="chip link"' + goAttr(c.src) + '>' + esc(c.srcLabel) + ' · ' + esc(bs) + '</span>'; }
    var h = '<div class="hero" id="cv-top"><div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' + heroChips(m, c, extra);
    var lineRe = hc.line ? new RegExp('^' + reEsc(hc.line)) : null;
    if (lineRe && kvGet(hd.kv, lineRe)) h += '<p class="muted" style="font-size:13px;margin:12px 0 0">' + esc(hc.line) + ': ' + RI(kvGet(hd.kv, lineRe)) + '</p>';
    if (hc.legend && hd.legend.length) h += '<details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Легенда меток</summary><div class="cv-md" style="font-size:13.5px">' +
      hd.legend.map(function (l) { return '<div>' + RI(l) + '</div>'; }).join('') + '</div></details>';
    h += heroRest(hd, hc.line ? new RegExp('^(Задача|Статус|Автор|Редакция|' + reEsc(hc.line) + ')') : SHOWN);
    return h + '</div>';
  }
  // Открытые вопросы — из шапки и раздел, отданный блоку «questions».
  function questions(m, oqSec) {
    var h = heroOq(m.head, heroOpt(m).questions === 'numbered');
    if (oqSec) {
      var b = mdOf(oqSec, false).trim();
      h += '<div class="card" style="margin-top:16px"><h3>' + esc(oqSec.title) + '</h3><div class="cv-md">' + R(b) + '</div></div>';
    }
    return h ? '<div class="cv-q">' + h + '</div>' : '';
  }
  function heroItems(out, m, c, oqSec) {
    out.add(':hero', 'Шапка', hero(m, c));
    out.add(':questions', 'Открытые вопросы', questions(m, oqSec));
  }

  // ---------------------------------------------------------------- блоки
  // Блок раздела получает узел раздела, своё правило из описания вида и окружение (модель, соседи, оглавление).
  // own — блок сам выводит текст сразу под «## N.»; иначе его выводит движок перед блоком. render — что идёт в блок
  // раздела вместе с заголовком; parts — подразделы, которые встают отдельными блоками раскладки сразу за ним.
  function markKids(sec) { sec.children.forEach(function (k) { k.used = true; }); }
  var BLOCKS = {
    rows: { render: function () { return ''; }, parts: rowsParts },
    requirements: { render: function (sec, rule, env) {
      var h = brdReqs(sec, env.m, env.specM, env.c);
      env.m.frs.forEach(function (f) { env.heads.push({ level: 3, text: (f.id + ' ' + f.name).trim(), id: 'fr-' + f.n }); });
      return h;
    }, parts: function (sec, rule) {
      var dr = (rule && rule.data) || { num: '4.3' }, s43 = takeRule(sec, dr);
      return s43 ? [{ key: ruleKey(dr), title: s43.title, html: tableCards(s43, 'objects') }] : [];
    } },
    interactions: { own: true, render: function (sec, rule, env) {
      var h = specInts(sec, env.m, env.c);
      env.m.ints.forEach(function (x) { env.heads.push({ level: 3, text: x.id + ' ' + x.name, id: 'int-' + x.n }); });
      return h;
    } },
    release: { own: true, render: function (sec) { return sec.body.join('').trim() ? card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>') : ''; }, parts: releaseParts },
    trace: { own: true, render: function (sec, rule, env) { return specTrace(sec, env.m, env.srcM, env.c); } },
    steps: { own: true, render: function (sec) { markKids(sec); return stepsHtml(sec); } },
    touched: { own: true, render: function (sec) { markKids(sec); return touchedHtml(sec); } },
    card: { own: true, render: function (sec, rule) { markKids(sec); return card('<div class="cv-md">' + R(mdOf(sec, false)) + '</div>', rule.style || ''); } },
  };
  // «rows»: подразделы рядами — каждый пункт ряда отдельным блоком. Ряд из двух — по половине ширины, из трёх и
  // больше — по трети (переносятся по три); ряд из одного — во всю ширину. Пункт ряда — правило подраздела: "block"
  // (по умолчанию карточка), "style", "scroll", "small" (карточка мельче).
  function rowsParts(sec, rule, env) {
    var parts = [], rows = (rule.rows || []).map(function (row) { return Array.isArray(row) ? row : [row]; });
    var amap = assign(sec, [].concat.apply([], rows));
    rows.forEach(function (row) {
      var span = row.length >= 3 ? 4 : row.length === 2 ? 6 : 12;
      row.forEach(function (it) {
        var n = amap.get(it) || null;
        if (!n) return;
        n.used = true;
        parts.push({ key: ruleKey(it), title: n.title, html: itemHtml({ it: it, node: n }, env), span: span });
      });
    });
    return parts;
  }
  function itemHtml(x, env) {
    var it = x.it, node = x.node;
    if (!node) return '';
    var b = it.block || 'card';
    if (b === 'stories') return '<h3 class="cv-sub" style="margin-top:0">' + RI(secNum(node.title).name) + '</h3><div class="grid2">' +
      mdOf(node, false).trim().split(/\n\s*\n/).filter(function (p) { return p.trim(); }).map(function (p) { return card('<div class="story cv-md">' + R(p) + '</div>', 'goal'); }).join('') + '</div>';
    if (b === 'table-cards') return tableCards(node, it.cards);
    if (b === 'labeled') return labeledHtml(node);
    if (b !== 'card') warn('неизвестный блок подраздела "' + b + '"');
    var cls = [it.style, it.small ? 'mini' : ''].filter(Boolean).join(' ');
    if (it.scroll) return card('<h3>' + esc(secNum(node.title).name) + '</h3><div class="cv-md tw">' + R(mdOf(node, false)) + '</div>', cls);
    return sub(node, cls);
  }
  // «table-cards»: таблица подраздела — карточками: "roles" (роль и права), "services" (сервис, роль, владелец,
  // происхождение), "objects" (№, объект, что это, что меняется). Без таблицы — подраздел как есть.
  function tableCards(node, kind) {
    var t = table(node.body), h = '';
    if (kind === 'roles') {
      if (!t.rows.length) return sub(node);
      return '<h3 class="cv-sub">' + esc(secNum(node.title).name) + '</h3><div class="grid2">' + t.rows.map(function (r) {
        var name = r[0].replace(/\s*\(`?[A-Z_]+`?\)/, ''), code = (r[0].match(/`([A-Z_]+)`/) || [])[1];
        return card('<div class="role"><span class="av">' + esc(name.replace(/[`*]/g, '').trim()[0] || '?') + '</span><div><b>' + RI(name) + '</b>' + (code ? ' <code>' + esc(code) + '</code>' : '') +
          '<div style="margin-top:4px">' + RI(r.slice(1).join(' · ')) + '</div></div></div>');
      }).join('') + '</div>' + restCard(nonTable(node) + '\n' + kidsMd(node));
    }
    if (kind === 'services') {
      if (!(t.rows.length && t.head.length >= 3)) return sub(node);
      return '<h3 class="cv-sub">' + esc(secNum(node.title).name) + '</h3><div class="grid2">' + t.rows.map(function (r) {
        return card('<div class="svc"><b>' + RI(r[0]) + '</b><span>' + RI(r[3] || '') + '</span></div><div style="margin-top:6px">' + RI(r[1] || '') + '</div><div class="muted" style="font-size:13.5px;margin-top:4px">' + RI(r[2] || '') + '</div>' +
          (r.length > 4 ? '<div class="muted" style="font-size:13px;margin-top:4px">' + r.slice(4).map(RI).join(' · ') + '</div>' : ''));
      }).join('') + '</div>' + restCard(nonTable(node) + '\n' + kidsMd(node));
    }
    if (kind === 'objects') {
      if (!(t.rows.length && t.head.length >= 3)) return sub(node);
      var off = t.head.length >= 4 ? 1 : 0;
      return '<h3 class="cv-sub">' + esc(secNum(node.title).name) + '</h3><div class="grid3">' + t.rows.map(function (r) {
        return card('<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>' + (off ? '<span class="muted" style="font-weight:500">' + RI(r[0]) + '</span> ' : '') + RI(r[off]) + '</b>' +
          (/новый/i.test(r[off + 2] || '') ? '<span class="badge new">новый</span>' : '<span class="badge">меняется</span>') + '</div><p class="muted" style="font-size:13.5px">' +
          RI(r[off + 1]) + '</p><div style="font-size:14px">' + RI(r[off + 2] || '') + '</div>' +
          (r.length > off + 3 ? '<div class="muted" style="font-size:13px;margin-top:4px">' + r.slice(off + 3).map(RI).join(' · ') + '</div>' : ''), 'obj');
      }).join('') + '</div>' + restCard(nonTable(node) + '\n' + kidsMd(node));
    }
    warn('неизвестный вид карточек "' + kind + '"');
    return sub(node) + h;
  }
  // «labeled»: подраздел из строк «**Ключ:** значение» — «Суть» карточкой, остальные ключи сеткой, прочее как есть.
  function labeledHtml(what) {
    var parts = [], other = [], h = '';
    what.body.forEach(function (l) { var mm = l.match(/^\*\*(.+?):\*\*\s*(.*)$/); if (mm) parts.push(mm); else if (l.trim()) other.push(l); });
    var essence = parts.filter(function (p) { return /Суть/.test(p[1]); })[0], rest = parts.filter(function (p) { return !/Суть/.test(p[1]); });
    h += '<h3 class="cv-sub" style="margin-top:0">' + RI(secNum(what.title).name) + '</h3>';
    if (essence) h += card('<h3>' + esc(essence[1]) + '</h3><div class="story cv-md">' + RI(essence[2]) + '</div>', 'goal');
    if (rest.length) h += '<div class="grid2" style="margin-top:14px">' + rest.map(function (p) { return card('<h3>' + esc(p[1]) + '</h3><div>' + RI(p[2]) + '</div>'); }).join('') + '</div>';
    if (other.length) h += card('<div class="cv-md">' + R(other.join('\n')) + '</div>');
    return h + restCard(kidsMd(what));
  }
  // «requirements»: требования FR карточками с критериями приёмки; "data" — подраздел бизнес-данных карточками,
  // своим блоком (BLOCKS.requirements.parts).
  function brdReqs(sec, m, spec, c) {
    var s41 = m.s41, s42 = m.s42, h = '';
    if (s41) s41.used = true;
    if (s42) s42.used = true;
    var critCap = s42 ? '<div class="ac-cap">' + RI(secNum(s42.title).name) + '</div>' : '';
    // Критерий — с меткой своего FR, как в документе; «Дано / Когда / Тогда» — строками.
    var acHtml = function (cr) { var g = gwt(cr.text); return '<div class="ac"><span class="ac-id">' + esc(cr.fr) + '</span>' + (g ? gwtHtml(g) : '<div class="cv-md">' + RI(cr.text) + '</div>') + '</div>'; };
    if (s41) h += '<h3 class="cv-sub">' + RI(secNum(s41.title).name) + '</h3>';
    if (m.frIntro) h += card('<div class="cv-md">' + R(m.frIntro) + '</div>');
    var withCard = {};
    h += '<div class="stack">' + m.frs.map(function (f) {
      withCard[f.id] = 1;
      var tr = spec && spec.trace[f.id];
      var links = tr ? tr.ints.map(function (i) { return '<span class="chip link"' + goAttr(c.spec, 'int-' + i.split('-')[1]) + '>' + i + '</span>'; }).join('') : '';
      var crit = (m.crit[f.id] || []).map(acHtml).join('');
      return '<div class="card fr" id="fr-' + f.n + '"><div class="top"><div class="head"><span class="id">' + f.id + '</span><span class="name">' + RI(f.name) + '</span>' +
        (links ? '<span class="links"><span class="muted" style="font-size:12.5px">в спеке</span>' + links + '</span>' : '') + '</div><div class="cv-md">' + R(f.text.join('\n')) + '</div></div>' +
        (crit ? critCap + crit : '<div class="ac muted">Критерия приёмки нет</div>') + '</div>';
    }).join('') + '</div>';
    h += restCard(kidsMd(s41));
    // Критерии требований, у которых нет своей карточки (FR в 4.1 записан иначе или его нет), — отдельной карточкой.
    var orphan = Object.keys(m.crit).filter(function (k) { return !withCard[k]; });
    if (orphan.length) h += '<div class="card fr" style="margin-top:14px">' + (s42 ? '<div class="top"><h3>' + RI(secNum(s42.title).name) + '</h3></div>' : '') +
      orphan.map(function (k) { return m.crit[k].map(acHtml).join(''); }).join('') + '</div>';
    if (m.critOther.length) h += card('<h3>Критерии без требования</h3><ul class="cv-md">' + m.critOther.map(function (x) { return '<li>' + RI(x.text) + '</li>'; }).join('') + '</ul>');
    h += restCard(m.critText.join('\n') + '\n' + kidsMd(s42));
    return h;
  }
  function specInts(sec, m, c) {
    var h = sec.body.join('').trim() ? '<div class="cv-md muted" style="font-size:13.5px">' + R(bodyMd(sec)) + '</div>' : '';
    h += '<div class="stack">' + m.ints.map(function (x) {
      x.node.used = true;
      var groups = [['Изменение', /^(Существующий стык|Изменение)/], ['Контракт', /^Контракт/], ['Примеры', /^Пример/], ['Поведение', /^Поведение/], ['Ошибки', /^Ошибки/],
        ['Состояния UI', /^Состояния/], ['Авторизация', /^Авторизация/], ['Происхождение', /^Происхождение/]], seen = {}, shown = /^(Граница|Триггер|Трассировка)|^Вид$/;
      var kind = (x.fields.filter(function (f) { return f.name === 'Вид'; })[0] || {}).md;
      var det = groups.map(function (g) {
        var fs = x.fields.filter(function (f) { return g[1].test(f.name); });
        fs.forEach(function (f) { seen[f.name] = 1; });
        return fs.length ? '<details' + (/^(Изменение|Контракт|Поведение)$/.test(g[0]) ? ' open' : '') + '><summary>' + g[0] + '</summary><div class="body">' +
          fs.map(function (f) { return '<div class="f"><b>' + esc(f.name) + '</b><div class="cv-md">' + R(f.md) + '</div></div>'; }).join('') + '</div></details>' : '';
      }).join('');
      // «Трассировка» видна чипами FR; если в ней есть что-то кроме номеров — полностью в «Прочем».
      var other = x.fields.filter(function (f) {
        if (seen[f.name]) return false;
        if (/^Трассировка/.test(f.name)) return !!f.md.replace(/FR-\d+/g, '').replace(/[\s,;.]/g, '');
        return !shown.test(f.name);
      }), kids = kidsMd(x.node);
      if (other.length || kids.trim()) det += '<details><summary>Прочее</summary><div class="body">' + other.map(function (f) { return '<div class="f"><b>' + esc(f.name || '—') + '</b><div class="cv-md">' + R(f.md) + '</div></div>'; }).join('') +
        (kids.trim() ? '<div class="cv-md">' + R(kids) + '</div>' : '') + '</div></details>';
      var routes = x.routes.map(function (r) { return '<div class="route"><span class="verb ' + r.verb + '">' + r.verb + '</span>' + esc(r.path) + (r.query ? '<span class="muted">?' + esc(r.query) + '</span>' : '') + '</div>'; }).join('');
      var side = x.traceFr.map(function (fr) { return '<span class="chip link"' + goAttr(c.src, 'fr-' + fr.split('-')[1]) + '>' + fr + '</span>'; }).join('');
      var st = c.stageOf[x.id];
      if (st) side += '<span class="chip link stage"' + goAttr(st.path) + ' title="' + esc(st.title) + '">этап ' + esc(st.num) + '</span>';
      return '<div class="card int" id="int-' + x.n + '"><div class="top"><div><div class="ttl"><span class="id">' + x.id + '</span><span class="name">' + RI(x.name) + '</span></div>' +
        (x.origin || kind ? '<div class="orig">' + RI([x.origin, kind].filter(Boolean).join(' · ')) + '</div>' : '') + routes + (x.dir ? '<div class="dir">' + RI(x.dir) + '</div>' : '') + '</div><div class="cv-side">' +
        (side ? '<div class="chips">' + side + '</div>' : '') + '</div>' + (x.trigger ? '<div class="trig">Триггер: ' + RI(x.trigger) + '</div>' : '') + '</div>' + det + '</div>';
    }).join('') + '</div>';
    return h;
  }
  // «release»: подразделы выката — карточками, каждый своим блоком; чек-лист ("checklist") — галочками, последним.
  function releaseParts(sec, rule) {
    var cr = (rule && rule.checklist) || { num: '6.5' }, pre = takeRule(sec, cr), parts = [];
    sec.children.forEach(function (x) {
      if (x.used || x === pre) return;
      x.used = true;
      parts.push({ key: norm(secNum(x.title).name), title: x.title, html: sub(x) });
    });
    if (pre) {
      var items = [], tail = [];
      pre.body.forEach(function (l) { var mm = l.match(/^- \[[ x]\]\s*(.*)$/); if (mm) items.push(mm[1]); else if (l.trim()) tail.push(l); });
      parts.push({ key: ruleKey(cr), title: pre.title, html: card('<h3>' + esc(secNum(pre.title).name) + '</h3><ul class="chk">' + items.map(function (it) {
        return '<li' + (/^~~[\s\S]*~~$/.test(it.trim()) ? ' class="na"' : '') + '>' + RI(it) + '</li>';
      }).join('') + '</ul>' + (tail.length ? '<div class="cv-md">' + R(tail.join('\n')) + '</div>' : '') + (pre.children.length ? '<div class="cv-md">' + R(kidsMd(pre)) + '</div>' : '')) });
    }
    return parts;
  }
  function specTrace(sec, m, brd, c) {
    var frs = Object.keys(m.trace), ints = m.ints.map(function (x) { return x.id; });
    if (!frs.length || !ints.length) return card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>');
    var h = '<div class="card tw"><table class="matrix"><thead><tr><th></th>' + ints.map(function (i) { return '<th' + goAttr(c.spec, 'int-' + i.split('-')[1]) + '>' + i + '</th>'; }).join('') + '</tr></thead><tbody>' +
      frs.map(function (fr) {
        var name = brd ? (brd.frs.filter(function (f) { return f.id === fr; })[0] || {}).name : '';
        return '<tr><th' + goAttr(c.src, 'fr-' + fr.split('-')[1]) + '>' + fr + (name ? ' <span class="muted" style="font:13px var(--sans)">' + esc(name) + '</span>' : '') + '</th>' +
          ints.map(function (i) { return '<td>' + (m.trace[fr].ints.indexOf(i) >= 0 ? '<span class="dot"' + goAttr(c.spec, 'int-' + i.split('-')[1]) + ' title="' + fr + ' → ' + i + '"></span>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    // Тест-кейсы — по строке таблицы целиком: ячейки FR и взаимодействий как есть (там бывают метки и §), тест — Дано/Когда/Тогда.
    h += '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Тест-кейсы</summary><div class="stack" style="margin-top:10px">' + m.traceRows.map(function (row) {
      var g = gwt(row[2] || '');
      return card('<div style="margin-bottom:6px"><b>' + RI(row[0]) + '</b>' + (row[1] ? ' → ' + RI(row[1]) : '') + '</div>' + (g ? gwtHtml(g) : '<div>' + RI(row[2] || '') + '</div>') +
        (row.length > 3 ? '<div class="muted" style="margin-top:6px">' + row.slice(3).map(RI).join(' · ') + '</div>' : ''));
    }).join('') + '</div></details>';
    return h + restCard(nonTable(sec) + '\n' + kidsMd(sec));
  }

  // ---------------------------------------------------------------- движки
  // «sections» (БТ, спека): раздел — заголовок, блок по правилу (или текст как есть), не взятые подразделы — карточками.
  // «cards» (баг-репорт, запрос на правку): раздел — карточкой целиком; «pair» ставит два раздела рядом.
  function envOf(m, c) {
    return { m: m, c: c, heads: [],
      specM: statusOf(c.spec) !== null ? docModel(c.spec, fileText(c.spec)) : null,
      srcM: statusOf(c.src) !== null ? docModel(c.src, fileText(c.src)) : null };
  }
  // Раздел — блок «заголовок и что под ним»; за ним — части блока (parts) и подразделы, которые никто не взял
  // (noLeft — их уже вывел сам раздел).
  function sectionItems(out, sec, id, rule, B, env, h, noLeft) {
    var sk = nodeKey(sec, rule), heads = [{ level: 2, text: sec.title, id: id }];
    env.heads = heads;
    var parts = [];
    if (B) { if (!B.own) h += restCard(bodyMd(sec)); h += B.render(sec, rule, env); parts = B.parts ? B.parts(sec, rule, env) : []; }
    out.add(sk, sec.title, '<section class="blk" id="' + id + '">' + h + '</section>', 12, heads, true);
    parts.forEach(function (p) { out.add(sk + '/' + p.key, p.title, p.html, p.span); });
    if (!noLeft) sec.children.filter(function (c) { return !c.used; }).forEach(function (c) {
      var s = secNum(c.title);
      out.add(sk + '/' + norm(s.name), c.title, card('<h3>' + esc(s.num ? s.num + ' ' + s.name : s.name) + '</h3><div class="cv-md">' + R(mdOf(c, false)) + '</div>'));
    });
  }
  function sectionsOverview(m, c) {
    var view = m.view, env = envOf(m, c), qRule = ruleBy(view, 'questions'), oq = findTop(view, m.root, qRule), out = new Items();
    heroItems(out, m, c, oq);
    m.root.children.forEach(function (sec, i) {
      if (sec === oq) return;
      var rule = ruleFor(view, sec, m.root), B = rule && rule.block ? BLOCKS[rule.block] : null, h = secHead(sec);
      if (rule && rule.block && !B) warn('неизвестный блок "' + rule.block + '"');
      if (!B && rule && rule.style) h += BLOCKS.card.render(sec, rule, env);
      else if (!B && sec.body.join('').trim()) h += card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>');
      sectionItems(out, sec, 'cv-s-' + i, rule, B, env, h);
    });
    return out;
  }
  function cardsOverview(m, c) {
    var view = m.view, h1 = m.root, env = envOf(m, c), qRule = ruleBy(view, 'questions'), oq = findTop(view, h1, qRule), out = new Items();
    var pairs = (view.sections || []).filter(function (r) { return r.block === 'pair'; })
      .map(function (r) { return { rule: r, left: findTop(view, h1, r), right: findTop(view, h1, r.with) }; });
    heroItems(out, m, c, oq);
    h1.children.forEach(function (s, i) {
      if (s === oq) return;
      if (pairs.some(function (p) { return p.right === s && p.left; })) return;
      var id = 'cv-s-' + i, p = pairs.filter(function (x) { return x.left === s && x.right; })[0];
      // Пара — два блока рядом, по половине ширины; у второго в оглавлении — его требования FR.
      if (p) {
        var j = h1.children.indexOf(p.right), two = pairParts(s, p.right, m, c, env.specM, [id, 'cv-s-' + j], p.rule.style);
        out.add(nodeKey(s, p.rule), s.title, two[0], 6, [{ level: 2, text: s.title, id: id }], true);
        out.add(nodeKey(p.right, p.rule.with), p.right.title, two[1], 6, [{ level: 2, text: p.right.title, id: 'cv-s-' + j }].concat(
          m.frs.filter(function (f) { return f.sec === p.right; }).map(function (f) { return { level: 3, text: f.id, id: 'fr-' + f.n }; })), true);
        return;
      }
      var rule = ruleFor(view, s, h1), B = rule && rule.block && rule.block !== 'pair' ? BLOCKS[rule.block] : null, h = secHead(s);
      if (rule && rule.block && rule.block !== 'pair' && !B) warn('неизвестный блок "' + rule.block + '"');
      // Без блока раздел — карточкой целиком; блок, который берёт не весь раздел, — текст раздела над ним, подразделы
      // без правил — своими блоками под ним.
      if (!B) h += card('<div class="cv-md">' + R(mdOf(s, false)) + '</div>', (rule && rule.block !== 'pair' && rule.style) || '');
      sectionItems(out, s, id, rule, B, env, h, !B || B.own);
    });
    return out;
  }
  // ---------------------------------------------------------------- баг-репорт и запрос на правку
  // Устроены одинаково: шапка, пронумерованные разделы, требования строками «- **FR-n:** текст — 🔵 источник»,
  // ненумерованные «Открытые вопросы» (и у запроса — «Что рядом остаётся прежним»).
  function smallModel(text, kind) {
    var top = tree(text), h1 = top.children[0] || { title: '', body: [], children: [] };
    var m = { kind: kind, top: top, root: h1, head: header(h1), frs: [] };
    var tm = h1.title.match(/^(.+?):\s*(.+)$/);
    m.kindLabel = tm ? tm[1] : (kind === 'bug' ? 'Баг-репорт' : 'Запрос на правку'); m.title = tm ? tm[2] : h1.title;
    h1.children.forEach(function (sec) {
      var cur = null;
      sec.frLines = {};
      sec.body.forEach(function (l, i) {
        var f = l.match(/^- \*\*FR-(\d+):\*\*\s*(.*)$/);
        if (f) { cur = { id: 'FR-' + f[1], n: f[1], text: f[2], sec: sec }; m.frs.push(cur); sec.frLines[i] = 1; }
        else if (cur && /^\s+\S/.test(l)) { cur.text += ' ' + l.trim(); sec.frLines[i] = 1; }
        else if (/^\S/.test(l)) cur = null;
      });
    });
    // Хвост «— 🔵 …» — источник требования: строкой под ним.
    m.frs.forEach(function (f) {
      var mm = f.text.match(/^([\s\S]*?)\s+—\s+((?:🟢|🔵|🟡)[\s\S]*)$/);
      f.main = mm ? mm[1].replace(/[,;]\s*$/, '') : f.text; f.source = mm ? mm[2] : '';
    });
    return m;
  }
  // Модель документа — по его виду: kind "brd" / "spec" / "bug" / "cr" — разбор требований, взаимодействий и
  // трассировки; "doc" — только дерево разделов и шапка (вид для своего документа).
  function docModel(path, text) {
    var v = viewFor(path.split('/').pop()), k = kindOf(v), m;
    if (k === 'brd') m = brdModel(text, v);
    else if (k === 'spec') m = specModel(text, v);
    else if (k === 'bug' || k === 'cr') m = smallModel(text, k);
    else m = genericModel(text, v || {}, path.split('/').pop());
    m.view = v || {}; m.frs = m.frs || []; m.ints = m.ints || []; m.trace = m.trace || {};
    return m;
  }
  // Один «#» — шапка документа, его разделы — блоки. Заголовков верхнего уровня несколько или он не «#» (нет «#»,
  // документ начинается с «##») — разделы все они, шапка — имя файла, текст над ними — в шапке.
  // «Тип: название» в заголовке — только у документа со своим видом.
  function genericModel(text, v, name) {
    var top = tree(text), kids = top.children, one = kids.length === 1 && kids[0].level === 1;
    var h1 = one ? kids[0] : { level: 0, title: String(name || '').replace(/\.(md|markdown)$/i, ''), body: top.body, children: kids };
    if (!one) top = { level: 0, title: '', body: [], children: [h1] };
    var tm = v.id ? h1.title.match(/^(.+?):\s*(.+)$/) : null;
    return { kind: 'doc', top: top, root: h1, head: header(h1), kindLabel: tm ? tm[1] : (v.label || ''), title: tm ? tm[2] : h1.title };
  }
  // Первое слово раздела критичности («Средняя. …», «Высокая: …») — чипом в шапку.
  function critWord(sec) { var mm = sec && bodyMd(sec).match(/^([А-ЯЁA-Z][^.:;,\n]{0,24})[.:]/); return mm ? mm[1] : ''; }
  // Строки, которые не требования FR, — как есть.
  function nonFr(sec) { return (sec.body.filter(function (l, i) { return !(sec.frLines || {})[i]; }).join('\n') + '\n' + kidsMd(sec)).trim(); }
  function smallFr(f, c, specM) {
    var tr = specM && specM.trace[f.id];
    var links = tr ? tr.ints.map(function (i) { return '<span class="chip link"' + goAttr(c.spec, 'int-' + i.split('-')[1]) + '>' + i + '</span>'; }).join('') : '';
    return '<div class="card fr" id="fr-' + f.n + '"><div class="top"><div class="head"><span class="id">' + f.id + '</span>' +
      (links ? '<span class="links"><span class="muted" style="font-size:12.5px">в спеке</span>' + links + '</span>' : '') + '</div><div class="cv-md">' + RI(f.main) + '</div>' +
      (f.source ? '<div class="muted" style="font-size:13px;margin-top:6px">' + RI(f.source) + '</div>' : '') + '</div></div>';
  }
  function stepsHtml(s) {
    var items = [], rest = [];
    s.body.forEach(function (l) {
      var mm = l.match(/^\s*\d+[.)]\s+(.*)$/);
      if (mm) items.push(mm[1]); else if (items.length && /^\s{2,}\S/.test(l) && !rest.length) items[items.length - 1] += ' ' + l.trim(); else if (l.trim()) rest.push(l);
    });
    if (!items.length) return card('<div class="cv-md">' + R(mdOf(s, false)) + '</div>');
    var tail = (rest.join('\n') + '\n' + kidsMd(s)).trim();
    return '<ol class="steps">' + items.map(function (t, i) { return '<li><span class="sn">' + (i + 1) + '</span><span>' + RI(t) + '</span></li>'; }).join('') + '</ol>' +
      (tail ? '<div class="cv-md muted" style="margin-top:10px">' + R(tail) + '</div>' : '');
  }
  // Пара «как есть / как должно быть»: слева раздел текстом, справа — требования FR карточками.
  function pairParts(left, right, m, c, specM, ids, leftCls) {
    var frs = m.frs.filter(function (f) { return f.sec === right; }), other = nonFr(right);
    return [card('<h3>' + RI(secNum(left.title).name) + '</h3><div class="cv-md">' + R(mdOf(left, false)) + '</div>', leftCls, ids[0]),
      card('<h3>' + RI(secNum(right.title).name) + '</h3>' + (other ? '<div class="cv-md">' + R(other) + '</div>' : '') +
        '<div class="stack" style="margin-top:8px">' + frs.map(function (f) { return smallFr(f, c, specM); }).join('') + '</div>', 'expect', ids[1])];
  }
  function pairHtml(left, right, m, c, specM, ids, leftCls) { return '<div class="grid2">' + pairParts(left, right, m, c, specM, ids, leftCls).join('') + '</div>'; }
  function touchedHtml(s) {
    var t = table(s.body), rest = (nonTable(s) + '\n' + kidsMd(s)).trim();
    if (!t.rows.length || t.head.length < 3) return card('<div class="cv-md">' + R(mdOf(s, false)) + '</div>');
    var yes = t.rows.filter(function (r) { return /^да/i.test(r[1]); }), no = t.rows.filter(function (r) { return !/^да/i.test(r[1]); });
    var more = function (r) { return r.length > 3 ? '<div class="muted" style="font-size:13px;margin-top:6px">' + r.slice(3).map(RI).join(' · ') + '</div>' : ''; };
    var h = '<div class="stack">' + yes.map(function (r) {
      var p = r[2].split(/\s+→\s+/);
      return card('<h3>' + RI(r[0]) + ' — ' + RI(r[1]) + '</h3>' + (p.length === 2 ? '<div class="was"><div><span class="k">СЕЙЧАС</span>' + RI(p[0]) + '</div><div><span class="k now">СТАНЕТ</span>' + RI(p[1]) + '</div></div>'
        : '<div class="cv-md">' + RI(r[2]) + '</div>') + more(r));
    }).join('') + '</div>';
    if (no.length) h += '<div class="chips" style="margin-top:12px">' + no.map(function (r) {
      return '<span class="chip">' + RI(r[0]) + ' — ' + RI(r[1]) + (r[2] && !/^[—–-]?$/.test(r[2].trim()) ? ': ' + RI(r[2]) : '') + (r.length > 3 ? ' · ' + r.slice(3).map(RI).join(' · ') : '') + '</span>';
    }).join('') + '</div>';
    if (rest) h += '<div class="cv-md" style="margin-top:12px">' + R(rest) + '</div>';
    return h;
  }
  function smallSlides(m, c) {
    var h1 = m.root, out = [], bug = m.kind === 'bug', sec = function (re) { return child(h1, re); };
    var proc = sec(/^1\.?\s/), second = sec(/^2\.?\s/), left = sec(/^3\.?\s/), right = sec(/^4\.?\s/), check = bug ? null : sec(/^5\.?\s/), critS = bug ? sec(/^5\.?\s/) : sec(/^6\.?\s/);
    var same = sec(/остаётся прежним/i), crit = critWord(critS);
    out.push({ name: 'Титул', html: '<div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' +
      heroChips(m, c, crit ? '<span class="chip crit">критичность · ' + esc(crit) + '</span>' : '') + (proc ? '<div class="cv-md big" style="margin-top:28px">' + R(bodyMd(proc)) + '</div>' : '') });
    if (second) out.push({ name: secNum(second.title).name, html: '<h2>' + RI(secNum(second.title).name) + '</h2>' + (bug ? stepsHtml(second) : touchedHtml(second)) });
    if (left && right) out.push({ name: secNum(right.title).name, html: '<div style="font-size:19px">' + pairHtml(left, right, m, c, null, ['', ''], bug ? 'fact' : 'was-card') + '</div>' });
    if (check) out.push({ name: secNum(check.title).name, html: '<h2>' + RI(secNum(check.title).name) + '</h2>' + card('<div class="cv-md big">' + R(bodyMd(check)) + '</div>', 'goal') });
    if (same) out.push({ name: same.title, html: '<h2>' + RI(same.title) + '</h2><div class="cv-md big">' + R(bodyMd(same)) + '</div>' });
    if (critS) out.push({ name: secNum(critS.title).name, html: '<h2>' + RI(secNum(critS.title).name) + '</h2><div class="cv-md big">' + R(bodyMd(critS)) + '</div>' });
    return out;
  }

  // ---------------------------------------------------------------- ссылки FR-n / INT-n / #0 в тексте
  function linkRefs(root, m, c) {
    var brd = fileText(c.src) !== null ? docModel(c.src, fileText(c.src)) : null, spec = fileText(c.spec) !== null ? docModel(c.spec, fileText(c.spec)) : null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) if (/\b(FR|INT)-\d+|#0\b/.test(n.nodeValue) && !n.parentElement.closest('[data-cv-go], .id, .ac-id, a, pre, .cv-bar')) nodes.push(n);
    nodes.forEach(function (tn) {
      var frag = document.createDocumentFragment(), s = tn.nodeValue, last = 0, rx = /\b(FR|INT)-(\d+)\b|#0\b/g, mm, any = false;
      while ((mm = rx.exec(s))) {
        var target = null;
        if (mm[0] === '#0') { if (c.foundation) target = c.foundation; }
        else if (mm[1] === 'FR' && brd && brd.frs.some(function (f) { return f.n === mm[2]; })) target = c.src + '#fr-' + mm[2];
        else if (mm[1] === 'INT' && spec && spec.ints.some(function (x) { return x.n === mm[2]; })) target = c.spec + '#int-' + mm[2];
        if (!target) continue;
        any = true;
        frag.appendChild(document.createTextNode(s.slice(last, mm.index)));
        var a = document.createElement('a');
        a.textContent = mm[0]; a.setAttribute('data-cv-go', target); a.href = 'javascript:void 0';
        frag.appendChild(a);
        last = mm.index + mm[0].length;
      }
      if (!any) return;
      frag.appendChild(document.createTextNode(s.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  // ---------------------------------------------------------------- показ
  function slidesFor(m, c) {
    if (m.kind === 'bug' || m.kind === 'cr') return smallSlides(m, c);
    var out = [], hd = m.head;
    // Свой вид без «kind»: титул и по экрану на раздел.
    if (m.kind === 'doc') {
      out.push({ name: 'Титул', html: '<div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' + heroChips(m, c) });
      m.root.children.forEach(function (s) { out.push({ name: secNum(s.title).name, html: '<h2>' + RI(secNum(s.title).name) + '</h2><div class="cv-md">' + R(mdOf(s, false)) + '</div>' }); });
      return out;
    }
    function title(extra) { return '<div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' + heroChips(m, c) + (extra || ''); }
    if (m.kind === 'brd') {
      var s1 = child(m.root, /^1\.?\s/), s2 = child(m.root, /^2\.?\s/), s3 = child(m.root, /^3\.?\s/), s5 = child(m.root, /^5\.?\s/);
      var cust = child(s1, /^1\.3/), prob = child(s1, /^1\.1/), goal = child(s2, /^2\.1/), val = child(s2, /^2\.2/);
      out.push({ name: 'Титул', html: title(cust ? '<div class="cv-md big" style="margin-top:28px">' + R(bodyMd(cust)) + '</div>' : '') });
      if (prob) out.push({ name: 'Проблема', html: '<h2>Проблема</h2>' + card('<div class="cv-md big">' + R(bodyMd(prob)) + '</div>', 'problem') });
      if (goal) out.push({ name: 'Цель', html: '<h2>Цель</h2><div class="stack">' + bodyMd(goal).split(/\n\s*\n/).map(function (p) { return card('<div class="cv-md">' + R(p) + '</div>', 'goal'); }).join('') + '</div>' +
        (val ? '<div class="cv-md" style="margin-top:18px">' + R(bodyMd(val)) + '</div>' : '') });
      var inn = child(s3, /^3\.1/), outS = child(s3, /^3\.2/);
      if (inn || outS) out.push({ name: 'Объём', html: '<h2>Объём</h2><div class="grid2" style="font-size:18px">' + (inn ? sub(inn, 'scope-in') : '') + (outS ? sub(outS, 'scope-out') : '') + '</div>' });
      if (m.frs.length) out.push({ name: 'Требования', html: '<h2>Требования</h2><ul class="slist">' + m.frs.map(function (f) { return '<li><span class="fr"><span class="id">' + f.id + '</span></span><span class="big">' + RI(f.name) + '</span></li>'; }).join('') + '</ul>' });
      m.frs.forEach(function (f) {
        out.push({ name: f.id, html: '<div class="fr"><div class="head" style="margin-bottom:14px"><span class="id">' + f.id + '</span></div></div><h2>' + RI(f.name) + '</h2><div class="cv-md">' + R(f.text.join('\n')) + '</div>' +
          '<div class="stack" style="margin-top:22px">' + (m.crit[f.id] || []).map(function (cr) { var g = gwt(cr.text); return card(g ? gwtHtml(g) : RI(cr.text)); }).join('') + '</div>' });
      });
      var roles = child(s5, /^5\.3/);
      if (roles) out.push({ name: 'Роли', html: '<h2>Роли</h2><div class="cv-md">' + R(bodyMd(roles)) + '</div>' });
    } else {
      var w = child(m.root, /^1\.?\s/), what = child(w, /^1\.1/), svc = child(w, /^1\.2/);
      out.push({ name: 'Титул', html: title('<p class="big" style="margin-top:28px">Взаимодействий: <b>' + m.ints.length + '</b>' + (hd.oq.length ? ' · открытых вопросов: <b>' + hd.oq.length + '</b>' : '') + '</p>') });
      if (what) out.push({ name: 'Суть', html: '<h2>Что делаем</h2><div class="cv-md big">' + R(bodyMd(what)) + '</div>' });
      if (svc) out.push({ name: 'Сервисы', html: '<h2>Затронутые сервисы</h2><div class="cv-md">' + R(bodyMd(svc)) + '</div>' });
      if (m.ints.length) out.push({ name: 'Взаимодействия', html: '<h2>Взаимодействия</h2><ul class="slist">' + m.ints.map(function (x) {
        var st = c.stageOf[x.id];
        return '<li><b style="font-family:var(--mono);min-width:80px">' + x.id + '</b><span style="flex:1">' + RI(x.name) + '</span><span class="route">' +
          x.routes.map(function (r) { return '<span class="verb ' + r.verb + '">' + r.verb + '</span><span style="font-size:18px">' + esc(r.path) + '</span>'; }).join(' ') + '</span>' +
          (st ? '<span class="chip">этап ' + esc(st.num) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' });
      m.ints.forEach(function (x) {
        var beh = x.fields.filter(function (f) { return /^Поведение/.test(f.name); })[0];
        out.push({ name: x.id, html: '<div class="kind">' + x.id + ' ' + (x.origin ? RI(x.origin) : '') + '</div><h2>' + RI(x.name) + '</h2>' +
          x.routes.map(function (r) { return '<div class="route" style="margin:8px 0"><span class="verb ' + r.verb + '">' + r.verb + '</span>' + esc(r.path) + '</div>'; }).join('') +
          (x.dir ? '<p class="muted">' + RI(x.dir) + '</p>' : '') + (x.trigger ? '<p>Триггер: ' + RI(x.trigger) + '</p>' : '') +
          (x.traceFr.length ? '<div class="chips">' + x.traceFr.map(function (f) { return '<span class="chip">' + f + '</span>'; }).join('') + '</div>' : '') +
          (beh ? '<div class="cv-md" style="font-size:18px;margin-top:16px">' + R(beh.md) + '</div>' : '') });
      });
      var frs = Object.keys(m.trace);
      if (frs.length && m.ints.length) out.push({ name: 'Трассировка', html: '<h2>Требование → взаимодействие</h2><table class="matrix" style="font-size:18px"><thead><tr><th></th>' +
        m.ints.map(function (x) { return '<th>' + x.id + '</th>'; }).join('') + '</tr></thead><tbody>' + frs.map(function (fr) {
          return '<tr><th>' + fr + '</th>' + m.ints.map(function (x) { return '<td>' + (m.trace[fr].ints.indexOf(x.id) >= 0 ? '<span class="dot"></span>' : '') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>' });
      if (hd.oq.length) out.push({ name: 'Открытые вопросы', html: '<h2>Открытые вопросы</h2><ol class="oq" style="font-size:19px">' + hd.oq.map(function (q, i) { return '<li><span class="n">' + (i + 1) + '</span><span>' + RI(q) + '</span></li>'; }).join('') + '</ol>' });
      var order = child(child(m.root, /^6\.?\s/), /^6\.1/);
      if (order) out.push({ name: 'Выкат', html: '<h2>Порядок выката</h2><div class="cv-md big">' + R(bodyMd(order)) + '</div>' });
    }
    return out;
  }
  var SH = { slides: [], i: 0 };
  function showEl() {
    var el = document.getElementById('cvShow');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'cvShow'; el.className = 'cv'; el.hidden = true;
    el.innerHTML = '<div class="slide"><div class="inner" id="cvSlide"></div></div><div class="foot"><span id="cvSname"></span><span class="prog"><i id="cvSprog"></i></span><span id="cvScount"></span><span>← → листать · Esc — выйти</span></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (!e.target.closest('a, details, summary') && SH.i < SH.slides.length - 1) { SH.i++; draw(); } });
    return el;
  }
  function draw() {
    var sl = SH.slides[SH.i];
    document.getElementById('cvSlide').innerHTML = sl.html;
    document.getElementById('cvSname').textContent = sl.name;
    document.getElementById('cvScount').textContent = (SH.i + 1) + ' / ' + SH.slides.length;
    document.getElementById('cvSprog').style.width = ((SH.i + 1) / SH.slides.length * 100) + '%';
    showEl().querySelector('.slide').scrollTop = 0;
    api.mount(document.getElementById('cvSlide'));
  }
  function present(e) {
    CUR = e.path;
    var c = ctx(e.path), m = docModel(e.path, api.text(e));
    SH.slides = slidesFor(m, c); SH.i = 0;
    showEl().hidden = false; draw();
    try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {}); } catch (err) { /* без полного экрана */ }
  }
  function stopShow() { var el = document.getElementById('cvShow'); if (el) el.hidden = true; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (err) { /* уже */ } }

  // ---------------------------------------------------------------- точки входа для to-html
  // edit — кнопка «Редактировать форму» (её нет у .md, где блоков больше LIMIT).
  function bar(view, edit) {
    return '<div class="cv-bar"><span class="cv-seg"><button type="button" data-cv-mode="text" aria-pressed="' + (view === 'text') + '">Текст</button>' +
      '<button type="button" data-cv-mode="overview" aria-pressed="' + (view === 'overview') + '">Обзор</button></span>' +
      '<button type="button" class="cv-btn" data-cv-show>▶ Показ</button>' +
      (view === 'overview' && edit && window.CoddocLayout ? '<button type="button" class="cv-btn" data-cvg-edit title="Расставить блоки обзора: порядок, ширина, скрыть">Редактировать форму</button>' : '') + '</div>';
  }
  // Вызывается из show() to-html после обычной отрисовки: свой вид или null — оставить как есть.
  var drawn = null;
  function render(e, out) {
    var v = viewOf(e);
    drawn = null;
    if (!v || !api.has(e)) return null;
    // Пришли на заголовок обычной отрисовки (поиск, ссылка из другого документа) — в обзоре его нет: текстом.
    var want = (location.hash.match(/[#&]h=([^&]*)/) || [])[1];
    var foreign = !!want && !/^(cv-|fr-|int-)/.test(decodeURIComponent(want));
    if (mode(v) === 'text' || foreign) { drawn = 'text'; return { html: bar('text') + out.html, headings: out.headings }; }
    drawn = 'overview';
    CUR = e.path;
    var c = ctx(e.path), m = docModel(e.path, api.text(e)), k = kindOf(v);
    var cards = (v.layout || (k === 'bug' || k === 'cr' ? 'cards' : 'sections')) === 'cards';
    var items = cards ? cardsOverview(m, c) : sectionsOverview(m, c);
    if (v === GENERIC && items.list.length > LIMIT) items = cardsOverview(m, c);
    items.add(':outside', 'Текст вне документа', restCard(outsideMd(m)));
    var edit = !(v === GENERIC && items.list.length > LIMIT);
    // Блоки — на сетку своей раскладки (layout.js); без неё — подряд, как в документе.
    var L = window.CoddocLayout;
    var res = L ? L.render(v.id, v === GENERIC ? e.name : (v.label || v.id), items.list, api.repoPath ? api.repoPath(e.path) : e.path)
      : { html: items.list.map(function (x) { return x.html; }).join(''), headings: [].concat.apply([], items.list.map(function (x) { return x.heads; })) };
    // В правом оглавлении — текст заголовка без разметки (~~, **, `).
    res.headings.forEach(function (x) { x.text = x.text.replace(/~~|\*\*|`/g, ''); });
    return { html: bar('overview', edit) + '<div class="cv">' + res.html + '</div>', headings: res.headings };
  }
  function mounted(e, doc) {
    var on = drawn === 'overview';
    doc.classList.toggle('cv-wide', on);
    // Типографика to-html (.md) — для текста; обзору нужна своя, иначе она перебивает карточки.
    doc.classList.toggle('md', !on);
    if (!on) return;
    var c = ctx(e.path), m = docModel(e.path, api.text(e));
    linkRefs(doc.querySelector('.cv'), m, c);
    if (window.CoddocLayout) window.CoddocLayout.mounted(doc);
  }
  function go(target) {
    var i = target.indexOf('#'), path = i < 0 ? target : target.slice(0, i), id = i < 0 ? 'cv-top' : target.slice(i + 1);
    if (viewFor(path.split('/').pop())) store.set('mode', 'overview');
    location.hash = api.href(path, id);
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-cv-mode]');
    // Переключили вид — якорь заголовка прежнего вида больше не нужен.
    if (b) {
      var ce = api.get(api.current());
      store.set(modeKey(ce ? viewOf(ce) : null), b.getAttribute('data-cv-mode'));
      history.replaceState(null, '', api.href(api.current())); api.rerender(); return;
    }
    if (ev.target.closest('[data-cv-show]')) { var e = api.get(api.current()); if (e) present(e); return; }
    var g = ev.target.closest('[data-cv-go]');
    if (g && !ev.target.closest('#cvShow')) { ev.preventDefault(); go(g.getAttribute('data-cv-go')); }
  });
  document.addEventListener('keydown', function (ev) {
    var el = document.getElementById('cvShow');
    if (!el || el.hidden) return;
    if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'PageDown') { ev.preventDefault(); if (SH.i < SH.slides.length - 1) { SH.i++; draw(); } }
    else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); if (SH.i > 0) { SH.i--; draw(); } }
    else if (ev.key === 'Escape') { ev.stopPropagation(); stopShow(); }
  }, true);
  document.addEventListener('fullscreenchange', function () { var el = document.getElementById('cvShow'); if (!document.fullscreenElement && el && !el.hidden) el.hidden = true; });

  window.CoddocView = { attach: function (a) { api = a; if (window.CoddocLayout) window.CoddocLayout.attach(a); }, render: render, mounted: mounted,
    test: { slides: function () { return SH.slides.length; }, next: function () { SH.i++; draw(); }, present: function () { present(api.get(api.current())); } } };
})();
