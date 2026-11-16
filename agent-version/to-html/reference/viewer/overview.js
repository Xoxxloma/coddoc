// overview.js — режим «Обзор» и «Показ» для документов петли внутри to-html.
// Узнаёт файл по имени: business_requirements.md — БТ, technical_specification.md — спека. Для них над документом
// появляются «Текст / Обзор» и «Показ»; остальные файлы to-html показывает как всегда. Всё на странице — текст
// документа: разбор только раскладывает его по блокам; не узнанный раздел — обычный markdown на своём месте.
// Ссылки FR-n / INT-n ищутся в той же папке; «#0» — фундамент эпика (_foundation/ выше по дереву); этап — по
// `owns:` в шапке stages/stage-NN.md. Экспорт и копирование в Confluence/Word берут обычную отрисовку — обзор их не задевает.
// Подключение к to-html: show() зовёт render() и mounted(), app.js отдаёт через attach() доступ к файлам и адресу.
(function () {
  'use strict';
  var md = window.markdownit({ html: false, linkify: true });
  var api = null;
  var KIND = { 'business_requirements.md': 'brd', 'technical_specification.md': 'spec' };

  var store = {
    get: function (k) { try { return sessionStorage.getItem('cv:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem('cv:' + k, v); } catch (e) { /* без памяти */ } },
  };
  function mode() { return store.get('mode') || 'overview'; }

  // ---------------------------------------------------------------- мелочи
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var MK = { '🟢': ['green', 'новое — спроектировано здесь'], '🔵': ['blue', 'подтверждено аналитиком'], '🟡': ['yellow', 'к валидации'],
    '❓': ['q', 'открытое решение'], '⚠️': ['w', 'требует уточнения'] };
  function marks(html) {
    return html.replace(/(🟢|🔵|🟡|❓|⚠️)/g, function (m) { return '<span class="mk ' + MK[m][0] + '" title="' + MK[m][1] + '">' + m + '</span>'; });
  }
  function R(text) { return marks(DOMPurify.sanitize(md.render(text || ''))); }
  function RI(text) { return marks(DOMPurify.sanitize(md.renderInline(text || ''))); }
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
  function bodyMd(node) { return node ? node.body.join('\n').trim() : ''; }
  function table(lines) {
    var rows = lines.filter(function (l) { return /^\s*\|/.test(l); }).map(function (l) {
      return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
    }).filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c); }); });
    return { head: rows[0] || [], rows: rows.slice(1) };
  }
  function secNum(title) { var m = title.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/); return m ? { num: m[1], name: m[2] } : { num: '', name: title }; }
  function header(h1) {
    var kv = {}, oq = [], oqNote = '', legend = [], md2 = null;
    h1.body.filter(function (l) { return /^>/.test(l); }).map(function (l) { return l.replace(/^>\s?/, ''); }).forEach(function (l) {
      var m = l.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (m) { kv[m[1].trim()] = m[2].trim(); md2 = /Открытые вопросы/i.test(m[1]) ? 'oq' : /Легенда/i.test(m[1]) ? 'legend' : null; return; }
      if (md2 === 'oq') { var n = l.match(/^\s*\d+\.\s+(.*)$/); if (n) oq.push(n[1]); else if (l.trim()) oqNote += (oqNote ? ' ' : '') + l.trim(); }
      else if (md2 === 'legend' && l.trim()) legend.push(l.trim());
    });
    return { kv: kv, oq: oq, oqNote: oqNote, legend: legend, rest: h1.body.filter(function (l) { return !/^>/.test(l); }).join('\n').trim() };
  }
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
  function brdModel(text) {
    var h1 = tree(text).children[0] || { title: '', body: [], children: [] };
    var m = { kind: 'brd', root: h1, head: header(h1), frs: [], crit: {}, critOther: [] };
    var tm = h1.title.match(/^(.+?):\s*(.+)$/);
    m.kindLabel = tm ? tm[1] : 'Бизнес-требования'; m.title = tm ? tm[2] : h1.title;
    var s4 = child(h1, /^4\.?\s/), s41 = child(s4, /^4\.1\.?\s/), s42 = child(s4, /^4\.2\.?\s/);
    if (s41) {
      var cur = null, intro = [];
      s41.body.forEach(function (l) {
        var f = l.match(/^\*\*FR-(\d+)\.\s*(.+?)\*\*\s*$/);
        if (f) { cur = { id: 'FR-' + f[1], n: f[1], name: f[2], text: [] }; m.frs.push(cur); } else if (cur) cur.text.push(l); else intro.push(l);
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
      });
    }
    return m;
  }
  function specModel(text) {
    var h1 = tree(text).children[0] || { title: '', body: [], children: [] };
    var m = { kind: 'spec', root: h1, head: header(h1), ints: [], trace: {} };
    var tm = h1.title.match(/^(.+?):\s*(.+)$/);
    m.kindLabel = tm ? tm[1] : 'Техническая спецификация'; m.title = tm ? tm[2] : h1.title;
    var s2 = child(h1, /^2\.?\s/);
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
    var s7 = child(h1, /^7\.?\s/);
    if (s7) table(s7.body).rows.forEach(function (row) {
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
  function leftovers(node) {
    return node.children.filter(function (c) { return !c.used; }).map(function (c) {
      var s = secNum(c.title);
      return card('<h3>' + esc(s.num ? s.num + ' ' + s.name : s.name) + '</h3><div class="cv-md">' + R(mdOf(c, false)) + '</div>');
    }).join('');
  }
  function sub(c, cls) { var s = secNum(c.title); return card('<h3>' + esc(s.name) + '</h3><div class="cv-md">' + R(bodyMd(c)) + '</div>', cls); }
  function heroChips(m, c, extra) {
    var kv = m.head.kv, h = '<div class="chips"><span class="chip"><b>' + esc(kvGet(kv, /^Задача/) || '') + '</b></span>' + statusChip(kvGet(kv, /Статус/)) +
      (kvGet(kv, /^Редакция/) ? '<span class="chip">редакция ' + esc(kvGet(kv, /^Редакция/)) + '</span>' : '') +
      (kvGet(kv, /^Автор/) ? '<span class="chip">автор ' + esc(kvGet(kv, /^Автор/)) + '</span>' : '') + (extra || '');
    if (c.epic) h += '<span class="chip link"' + goAttr(c.epic.path) + '>эпик ' + esc(c.epic.key) + '</span>';
    c.children.forEach(function (ch) { var st = statusOf(ch.path); if (st !== null) h += '<span class="chip link"' + goAttr(ch.path) + '>часть ' + esc(ch.key) + '</span>'; });
    if (c.foundation && m.kind === 'spec') h += '<span class="chip link"' + goAttr(c.foundation) + '>фундамент #0</span>';
    return h + '</div>';
  }

  // ---------------------------------------------------------------- обзор БТ
  function brdOverview(m, c) {
    var hd = m.head, specSt = statusOf(c.spec), heads = [];
    var h = '<div class="hero" id="cv-top"><div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' +
      heroChips(m, c, specSt !== null ? '<span class="chip link"' + goAttr(c.spec) + '>Спека · ' + esc(specSt) + '</span>' : '');
    if (hd.oq.length) h += '<div class="card" style="margin-top:16px"><h3>Открытые вопросы</h3><ol class="cv-md">' + hd.oq.map(function (q) { return '<li>' + RI(q) + '</li>'; }).join('') + '</ol></div>';
    else if (hd.oqNote) h += '<p class="muted" style="margin:14px 0 0">' + RI(hd.oqNote) + '</p>';
    if (hd.rest) h += '<div class="cv-md">' + R(hd.rest) + '</div>';
    h += '</div>';
    var specM = specSt !== null ? specModel(fileText(c.spec)) : null;
    m.root.children.forEach(function (sec, i) {
      var id = 'cv-s-' + i;
      heads.push({ level: 2, text: sec.title, id: id });
      h += '<section class="blk" id="' + id + '">' + secHead(sec);
      var n = secNum(sec.title).num;
      if (n === '1') h += brdContext(sec);
      else if (n === '2') h += brdGoal(sec);
      else if (n === '3') h += brdScope(sec);
      else if (n === '4') { h += brdReqs(sec, m, specM, c); m.frs.forEach(function (f) { heads.push({ level: 3, text: f.id + ' ' + f.name, id: 'fr-' + f.n }); }); }
      else if (n === '5') h += brdLimits(sec);
      else if (sec.body.join('').trim()) h += card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>');
      h += '<div class="stack" style="margin-top:14px">' + leftovers(sec) + '</div></section>';
    });
    return { html: h, headings: heads };
  }
  function brdContext(sec) {
    var type = take(sec, /^1\.0/), prob = take(sec, /^1\.1/), who = take(sec, /^1\.2/), cust = take(sec, /^1\.3/), now = take(sec, /^1\.4/);
    return '<div class="grid2">' + (prob ? sub(prob, 'problem') : '') + (type ? sub(type) : '') + '</div>' +
      '<div class="grid2" style="margin-top:14px">' + (who ? sub(who) : '') + (cust ? sub(cust) : '') + '</div>' + (now ? '<div style="margin-top:14px">' + sub(now) + '</div>' : '');
  }
  function brdGoal(sec) {
    var goal = take(sec, /^2\.1/), val = take(sec, /^2\.2/), risk = take(sec, /^2\.3/), h = '';
    if (goal) h += '<div class="grid2">' + bodyMd(goal).split(/\n\s*\n/).filter(function (p) { return p.trim(); }).map(function (p) { return card('<div class="story cv-md">' + R(p) + '</div>', 'goal'); }).join('') + '</div>';
    if (val) h += '<div style="margin-top:14px">' + sub(val) + '</div>';
    if (risk) h += '<div style="margin-top:14px">' + card('<h3>' + esc(secNum(risk.title).name) + '</h3><div class="cv-md tw">' + R(bodyMd(risk)) + '</div>') + '</div>';
    return h;
  }
  function brdScope(sec) {
    var inn = take(sec, /^3\.1/), out = take(sec, /^3\.2/), arch = take(sec, /^3\.3/), dep = take(sec, /^3\.4/);
    return '<div class="grid2">' + (inn ? sub(inn, 'scope-in') : '') + (out ? sub(out, 'scope-out') : '') + '</div>' +
      '<div class="grid2" style="margin-top:14px">' + (arch ? sub(arch) : '') + (dep ? sub(dep) : '') + '</div>';
  }
  function brdReqs(sec, m, spec, c) {
    var s41 = take(sec, /^4\.1/), s42 = take(sec, /^4\.2/), s43 = take(sec, /^4\.3/), h = '';
    if (m.frIntro) h += card('<div class="cv-md">' + R(m.frIntro) + '</div>');
    h += '<div class="stack">' + m.frs.map(function (f) {
      var tr = spec && spec.trace[f.id];
      var links = tr ? tr.ints.map(function (i) { return '<span class="chip link"' + goAttr(c.spec, 'int-' + i.split('-')[1]) + '>' + i + '</span>'; }).join('') : '';
      var crit = (m.crit[f.id] || []).map(function (cr) { var g = gwt(cr.text); return '<div class="ac">' + (g ? gwtHtml(g) : '<div class="cv-md">' + RI(cr.text) + '</div>') + '</div>'; }).join('');
      return '<div class="card fr" id="fr-' + f.n + '"><div class="top"><div class="head"><span class="id">' + f.id + '</span><span class="name">' + RI(f.name) + '</span>' +
        (links ? '<span class="links"><span class="muted" style="font-size:12.5px">в спеке</span>' + links + '</span>' : '') + '</div><div class="cv-md">' + R(f.text.join('\n')) + '</div></div>' +
        (crit || '<div class="ac muted">Критерия приёмки нет</div>') + '</div>';
    }).join('') + '</div>';
    if (m.critOther.length) h += card('<h3>Критерии без требования</h3><ul class="cv-md">' + m.critOther.map(function (x) { return '<li>' + RI(x.text) + '</li>'; }).join('') + '</ul>');
    if (s43) {
      var t = table(s43.body);
      if (t.rows.length && t.head.length >= 3) {
        var off = t.head.length >= 4 ? 1 : 0;
        h += '<h3 class="cv-sub">' + esc(secNum(s43.title).name) + '</h3><div class="grid3">' + t.rows.map(function (r) {
          return card('<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>' + RI(r[off]) + '</b>' +
            (/новый/i.test(r[off + 2] || '') ? '<span class="badge new">новый</span>' : '<span class="badge">меняется</span>') + '</div><p class="muted" style="font-size:13.5px">' +
            RI(r[off + 1]) + '</p><div style="font-size:14px">' + RI(r[off + 2] || '') + '</div>', 'obj');
        }).join('') + '</div>';
      } else h += sub(s43);
    }
    return h;
  }
  function brdLimits(sec) {
    var pr = take(sec, /^5\.1/), dl = take(sec, /^5\.2/), roles = take(sec, /^5\.3/), h = '<div class="grid2">' + (pr ? sub(pr) : '') + (dl ? sub(dl) : '') + '</div>';
    if (roles) {
      var t = table(roles.body);
      if (t.rows.length) h += '<h3 class="cv-sub">' + esc(secNum(roles.title).name) + '</h3><div class="grid2">' + t.rows.map(function (r) {
        var name = r[0].replace(/\s*\(`?[A-Z_]+`?\)/, ''), code = (r[0].match(/`([A-Z_]+)`/) || [])[1];
        return card('<div class="role"><span class="av">' + esc(name.replace(/[`*]/g, '').trim()[0] || '?') + '</span><div><b>' + RI(name) + '</b>' + (code ? ' <code>' + esc(code) + '</code>' : '') +
          '<div style="margin-top:4px">' + RI(r[1] || '') + '</div></div></div>');
      }).join('') + '</div>';
      else h += sub(roles);
    }
    return h;
  }

  // ---------------------------------------------------------------- обзор спеки
  function specOverview(m, c) {
    var hd = m.head, brdSt = statusOf(c.brd), heads = [];
    var h = '<div class="hero" id="cv-top"><div class="kind">' + esc(m.kindLabel) + '</div><h1>' + RI(m.title) + '</h1>' +
      heroChips(m, c, brdSt !== null ? '<span class="chip link"' + goAttr(c.brd) + '>БТ · ' + esc(brdSt) + '</span>' : '');
    if (kvGet(hd.kv, /^Источник/)) h += '<p class="muted" style="font-size:13px;margin:12px 0 0">Источник: ' + RI(kvGet(hd.kv, /^Источник/)) + '</p>';
    if (hd.oq.length) h += '<div class="card" style="margin-top:16px"><h3>Открытые вопросы · ' + hd.oq.length + '</h3><ol class="oq">' +
      hd.oq.map(function (q, i) { return '<li><span class="n">' + (i + 1) + '</span><span>' + RI(q) + '</span></li>'; }).join('') + '</ol></div>';
    else if (hd.oqNote) h += '<p class="muted" style="margin:14px 0 0">' + RI(hd.oqNote) + '</p>';
    if (hd.legend.length) h += '<details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Легенда меток</summary><div class="cv-md" style="font-size:13.5px">' +
      hd.legend.map(function (l) { return '<div>' + RI(l) + '</div>'; }).join('') + '</div></details>';
    h += '</div>';
    var brdM = brdSt !== null ? brdModel(fileText(c.brd)) : null;
    m.root.children.forEach(function (sec, i) {
      var id = 'cv-s-' + i;
      heads.push({ level: 2, text: sec.title, id: id });
      h += '<section class="blk" id="' + id + '">' + secHead(sec);
      var n = secNum(sec.title).num;
      if (n === '1') h += specIntro(sec);
      else if (n === '2') { h += specInts(sec, m, c); m.ints.forEach(function (x) { heads.push({ level: 3, text: x.id + ' ' + x.name, id: 'int-' + x.n }); }); }
      else if (n === '6') h += specRelease(sec);
      else if (n === '7') h += specTrace(sec, m, brdM, c);
      else if (sec.body.join('').trim()) h += card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>');
      h += '<div class="stack" style="margin-top:14px">' + leftovers(sec) + '</div></section>';
    });
    return { html: h, headings: heads };
  }
  function specIntro(sec) {
    var what = take(sec, /^1\.1/), svc = take(sec, /^1\.2/), h = '';
    if (what) {
      var parts = [], other = [];
      what.body.forEach(function (l) { var mm = l.match(/^\*\*(.+?):\*\*\s*(.*)$/); if (mm) parts.push(mm); else if (l.trim()) other.push(l); });
      var essence = parts.filter(function (p) { return /Суть/.test(p[1]); })[0], rest = parts.filter(function (p) { return !/Суть/.test(p[1]); });
      if (essence) h += card('<div class="story cv-md">' + RI(essence[2]) + '</div>', 'goal');
      if (rest.length) h += '<div class="grid2" style="margin-top:14px">' + rest.map(function (p) { return card('<h3>' + esc(p[1]) + '</h3><div>' + RI(p[2]) + '</div>'); }).join('') + '</div>';
      if (other.length) h += card('<div class="cv-md">' + R(other.join('\n')) + '</div>');
    }
    if (svc) {
      var t = table(svc.body);
      if (t.rows.length && t.head.length >= 3) h += '<h3 class="cv-sub">' + esc(secNum(svc.title).name) + '</h3><div class="grid2">' + t.rows.map(function (r) {
        return card('<div class="svc"><b>' + RI(r[0]) + '</b><span>' + RI(r[3] || '') + '</span></div><div style="margin-top:6px">' + RI(r[1] || '') + '</div><div class="muted" style="font-size:13.5px;margin-top:4px">' + RI(r[2] || '') + '</div>');
      }).join('') + '</div>';
      else h += sub(svc);
    }
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
      var other = x.fields.filter(function (f) { return !seen[f.name] && !shown.test(f.name); });
      if (other.length) det += '<details><summary>Прочее</summary><div class="body">' + other.map(function (f) { return '<div class="f"><b>' + esc(f.name || '—') + '</b><div class="cv-md">' + R(f.md) + '</div></div>'; }).join('') + '</div></details>';
      var routes = x.routes.map(function (r) { return '<div class="route"><span class="verb ' + r.verb + '">' + r.verb + '</span>' + esc(r.path) + (r.query ? '<span class="muted">?' + esc(r.query) + '</span>' : '') + '</div>'; }).join('');
      var side = x.traceFr.map(function (fr) { return '<span class="chip link"' + goAttr(c.brd, 'fr-' + fr.split('-')[1]) + '>' + fr + '</span>'; }).join('');
      var st = c.stageOf[x.id];
      if (st) side += '<span class="chip link stage"' + goAttr(st.path) + ' title="' + esc(st.title) + '">этап ' + esc(st.num) + '</span>';
      return '<div class="card int" id="int-' + x.n + '"><div class="top"><div><div class="ttl"><span class="id">' + x.id + '</span><span class="name">' + RI(x.name) + '</span></div>' +
        (x.origin || kind ? '<div class="orig">' + RI([x.origin, kind].filter(Boolean).join(' · ')) + '</div>' : '') + routes + (x.dir ? '<div class="dir">' + RI(x.dir) + '</div>' : '') + '</div><div class="cv-side">' +
        (side ? '<div class="chips">' + side + '</div>' : '') + '</div>' + (x.trigger ? '<div class="trig">Триггер: ' + RI(x.trigger) + '</div>' : '') + '</div>' + det + '</div>';
    }).join('') + '</div>';
    return h;
  }
  function specRelease(sec) {
    var pre = take(sec, /^6\.5/), h = '<div class="stack">' + sec.children.filter(function (x) { return !x.used && x !== pre; }).map(function (x) { x.used = true; return sub(x); }).join('') + '</div>';
    if (sec.body.join('').trim()) h = card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>') + h;
    if (pre) {
      var items = [], tail = [];
      pre.body.forEach(function (l) { var mm = l.match(/^- \[[ x]\]\s*(.*)$/); if (mm) items.push(mm[1]); else if (l.trim()) tail.push(l); });
      h += '<div style="margin-top:14px">' + card('<h3>' + esc(secNum(pre.title).name) + '</h3><ul class="chk">' + items.map(function (it) {
        return '<li' + (/^~~[\s\S]*~~$/.test(it.trim()) ? ' class="na"' : '') + '>' + RI(it) + '</li>';
      }).join('') + '</ul>' + (tail.length ? '<div class="cv-md">' + R(tail.join('\n')) + '</div>' : '')) + '</div>';
    }
    return h;
  }
  function specTrace(sec, m, brd, c) {
    var frs = Object.keys(m.trace), ints = m.ints.map(function (x) { return x.id; });
    if (!frs.length || !ints.length) return card('<div class="cv-md">' + R(bodyMd(sec)) + '</div>');
    var h = '<div class="card tw"><table class="matrix"><thead><tr><th></th>' + ints.map(function (i) { return '<th' + goAttr(c.spec, 'int-' + i.split('-')[1]) + '>' + i + '</th>'; }).join('') + '</tr></thead><tbody>' +
      frs.map(function (fr) {
        var name = brd ? (brd.frs.filter(function (f) { return f.id === fr; })[0] || {}).name : '';
        return '<tr><th' + goAttr(c.brd, 'fr-' + fr.split('-')[1]) + '>' + fr + (name ? ' <span class="muted" style="font:13px var(--sans)">' + esc(name) + '</span>' : '') + '</th>' +
          ints.map(function (i) { return '<td>' + (m.trace[fr].ints.indexOf(i) >= 0 ? '<span class="dot"' + goAttr(c.spec, 'int-' + i.split('-')[1]) + ' title="' + fr + ' → ' + i + '"></span>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    h += '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Тест-кейсы</summary><div class="stack" style="margin-top:10px">' + frs.map(function (fr) {
      var g = gwt(m.trace[fr].test);
      return card('<div style="margin-bottom:6px"><b>' + fr + '</b></div>' + (g ? gwtHtml(g) : '<div>' + RI(m.trace[fr].test) + '</div>'));
    }).join('') + '</div></details>';
    return h;
  }

  // ---------------------------------------------------------------- ссылки FR-n / INT-n / #0 в тексте
  function linkRefs(root, m, c) {
    var brd = fileText(c.brd) !== null ? brdModel(fileText(c.brd)) : null, spec = fileText(c.spec) !== null ? specModel(fileText(c.spec)) : null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) if (/\b(FR|INT)-\d+|#0\b/.test(n.nodeValue) && !n.parentElement.closest('[data-cv-go], .id, a, pre, .cv-bar')) nodes.push(n);
    nodes.forEach(function (tn) {
      var frag = document.createDocumentFragment(), s = tn.nodeValue, last = 0, rx = /\b(FR|INT)-(\d+)\b|#0\b/g, mm, any = false;
      while ((mm = rx.exec(s))) {
        var target = null;
        if (mm[0] === '#0') { if (c.foundation) target = c.foundation; }
        else if (mm[1] === 'FR' && brd && brd.frs.some(function (f) { return f.n === mm[2]; })) target = c.brd + '#fr-' + mm[2];
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
    var out = [], hd = m.head;
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
  }
  function present(e) {
    var kind = KIND[e.name], text = api.text(e), c = ctx(e.path), m = kind === 'brd' ? brdModel(text) : specModel(text);
    SH.slides = slidesFor(m, c); SH.i = 0;
    showEl().hidden = false; draw();
    try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {}); } catch (err) { /* без полного экрана */ }
  }
  function stopShow() { var el = document.getElementById('cvShow'); if (el) el.hidden = true; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (err) { /* уже */ } }

  // ---------------------------------------------------------------- точки входа для to-html
  function bar(view) {
    return '<div class="cv-bar"><span class="cv-seg"><button type="button" data-cv-mode="text" aria-pressed="' + (view === 'text') + '">Текст</button>' +
      '<button type="button" data-cv-mode="overview" aria-pressed="' + (view === 'overview') + '">Обзор</button></span>' +
      '<button type="button" class="cv-btn" data-cv-show>▶ Показ</button></div>';
  }
  // Вызывается из show() to-html после обычной отрисовки: свой вид или null — оставить как есть.
  var drawn = null;
  function render(e, out) {
    var kind = KIND[e.name];
    drawn = null;
    if (!kind || !api.has(e)) return null;
    // Пришли на заголовок обычной отрисовки (поиск, ссылка из другого документа) — в обзоре его нет: текстом.
    var want = (location.hash.match(/[#&]h=([^&]*)/) || [])[1];
    var foreign = !!want && !/^(cv-|fr-|int-)/.test(decodeURIComponent(want));
    if (mode() === 'text' || foreign) { drawn = 'text'; return { html: bar('text') + out.html, headings: out.headings }; }
    drawn = 'overview';
    var text = api.text(e), c = ctx(e.path), m = kind === 'brd' ? brdModel(text) : specModel(text);
    var res = kind === 'brd' ? brdOverview(m, c) : specOverview(m, c);
    return { html: bar('overview') + '<div class="cv">' + res.html + '</div>', headings: res.headings };
  }
  function mounted(e, doc) {
    var kind = KIND[e.name], on = drawn === 'overview';
    doc.classList.toggle('cv-wide', on);
    // Типографика to-html (.md) — для текста; обзору нужна своя, иначе она перебивает карточки.
    doc.classList.toggle('md', !on);
    if (!on) return;
    var c = ctx(e.path), m = kind === 'brd' ? brdModel(api.text(e)) : specModel(api.text(e));
    linkRefs(doc.querySelector('.cv'), m, c);
  }
  function go(target) {
    var i = target.indexOf('#'), path = i < 0 ? target : target.slice(0, i), id = i < 0 ? 'cv-top' : target.slice(i + 1);
    if (KIND[path.split('/').pop()]) store.set('mode', 'overview');
    location.hash = api.href(path, id);
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-cv-mode]');
    // Переключили вид — якорь заголовка прежнего вида больше не нужен.
    if (b) { store.set('mode', b.getAttribute('data-cv-mode')); history.replaceState(null, '', api.href(api.current())); api.rerender(); return; }
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

  window.CoddocView = { attach: function (a) { api = a; }, render: render, mounted: mounted,
    test: { slides: function () { return SH.slides.length; }, next: function () { SH.i++; draw(); }, present: function () { present(api.get(api.current())); } } };
})();
