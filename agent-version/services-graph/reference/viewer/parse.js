// parse.js — карточки services/*.md (форма v1, `service-map/reference/card.template.md`) и manifest.yaml → граф.
//
// Работает и в браузере (window.ServicesGraphParse), и под node (module.exports) — так его проверяет самотест.
// Вход: [[путь от папки слепка, текст], …] — карточки `<имя>.md`, `manifest.yaml`, история `_history/<имя>.md`.
// Выход: { nodes, edges, topics, issues } — см. build() внизу.
//
// Рёбра берутся со стороны того, кто вызывает: «Потребляемые API» и «Зависит от». «Кто меня потребляет» — зеркало,
// его строки только сверяются: строка без пары у вызывающего уходит в issues и рисуется лишь по флажку.
// События: публикующий → потребляющий, по совпадению топика у двух карточек.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ServicesGraphParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['backend', 'frontend', 'fullstack', 'lib'];

  function stripTicks(s) { return String(s || '').replace(/`/g, '').trim(); }
  // Пустая строка-форма: «—», «-», «— » в бэктиках.
  function isDash(s) { var t = stripTicks(s); return !t || /^[—–-]+$/.test(t); }
  function unq(s) {
    s = String(s || '').trim();
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) s = s.slice(1, -1);
    return s;
  }
  function lines(text) { return String(text || '').replace(/^﻿/, '').split(/\r?\n/); }

  // ---------------------------------------------------------------- manifest.yaml
  // Только то, что пишет service-map и человек: список `services:` с name, path, type, notes (строкой или блоком |).
  function parseManifest(text) {
    var out = [], cur = null, notes = null; // notes: { keyIndent, indent, buf }
    lines(text).forEach(function (raw) {
      if (notes) {
        if (!raw.trim()) { notes.buf.push(''); return; }
        var ind = raw.match(/^ */)[0].length;
        if (notes.indent === null && ind > notes.keyIndent) notes.indent = ind;
        if (notes.indent !== null && ind >= notes.indent) { notes.buf.push(raw.slice(notes.indent)); return; }
        cur.notes = notes.buf.join('\n').trim();
        notes = null;
      }
      if (/^\s*#/.test(raw)) return;
      var line = raw.replace(/\s+#.*$/, ''), m;
      if ((m = line.match(/^(\s*)-\s+(\w+):\s*(.*)$/))) {
        cur = { name: '', path: '', type: '', notes: '' };
        out.push(cur);
        line = m[1] + '  ' + m[2] + ': ' + m[3];
      }
      if (!cur) return;
      if ((m = line.match(/^(\s*)(name|path|type):\s*(.*)$/))) { cur[m[2]] = unq(m[3]); return; }
      if ((m = raw.match(/^(\s*)notes:\s*([|>][-+]?)?\s*(.*)$/))) {
        if (m[2]) notes = { keyIndent: m[1].length, indent: null, buf: [] };
        else cur.notes = unq(m[3]);
      }
    });
    if (notes && cur) cur.notes = notes.buf.join('\n').trim();
    return out.filter(function (s) { return s.name; });
  }

  // ---------------------------------------------------------------- карточка
  // Таблица: строки, начинающиеся с «|»; первая — шапка, «|---|» — разделитель. Ячейки делятся по «|», кроме «\|».
  function tableRows(sectionLines) {
    var rows = [], seenHeader = false;
    sectionLines.forEach(function (l) {
      var t = l.trim();
      if (t[0] !== '|') return;
      if (/^\|[\s:|-]+\|?$/.test(t)) return;
      if (!seenHeader) { seenHeader = true; return; }
      var cells = t.replace(/\\\|/g, '\u0000').replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) {
        return c.replace(/\u0000/g, '|').trim();
      });
      rows.push(cells);
    });
    return rows;
  }

  // Заголовки ### внутри секции, без пустой формы «—».
  function blockTitles(sectionLines) {
    var out = [];
    sectionLines.forEach(function (l) {
      var m = l.match(/^###\s+(.+?)\s*$/);
      if (m) out.push(m[1]);
    });
    return out;
  }

  function parseCard(text, file) {
    var all = lines(text), i = 0;
    var card = { file: file, service: '', type: '', description: '', scanned: '', updated: '', repo: '', title: '',
      sections: {}, order: [] };
    if (all[0] && all[0].trim() === '---') {
      for (i = 1; i < all.length && all[i].trim() !== '---'; i++) {
        var m = all[i].match(/^(\w+):\s*(.*)$/);
        if (!m) continue;
        var key = m[1], val = m[2];
        if (key === 'type') val = val.replace(/\s+#.*$/, '');
        if (key in card && typeof card[key] === 'string') card[key] = unq(val);
      }
      i++;
    }
    var cur = null, fence = false;
    for (; i < all.length; i++) {
      var l = all[i];
      // Блок кода — пример, а не данные: ни заголовков, ни строк таблиц из него не берём.
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
      if (fence) continue;
      {
        var h1 = l.match(/^#\s+(.+?)\s*$/);
        if (h1 && !card.title) { card.title = h1[1]; continue; }
        var h2 = l.match(/^##\s+(.+?)\s*$/);
        if (h2) {
          cur = h2[1].toLowerCase().replace(/\s+/g, ' ');
          card.sections[cur] = card.sections[cur] || [];
          card.order.push(h2[1]);
          continue;
        }
      }
      if (cur) card.sections[cur].push(l);
    }
    // Имя: шапка → заголовок «# имя — тип» → имя файла.
    if (!card.service && card.title) card.service = card.title.split(/\s+[—–-]\s+/)[0].replace(/`/g, '').trim();
    if (!card.service) card.service = file.replace(/^.*\//, '').replace(/\.md$/i, '');
    if (!card.type && card.title) {
      var t = (card.title.split(/\s+[—–-]\s+/)[1] || '').trim().toLowerCase();
      if (TYPES.indexOf(t) >= 0) card.type = t;
    }
    return card;
  }

  function section(card, name) {
    var keys = Object.keys(card.sections);
    for (var k = 0; k < keys.length; k++) if (keys[k].indexOf(name) === 0) return card.sections[keys[k]];
    return null;
  }

  // Карточка ли это вообще: шапка с service: или заголовок «# имя — тип», или хоть одна связочная секция.
  function looksLikeCard(card, text) {
    return /^---[\s\S]*?\nservice:/m.test(text) || /^#\s+\S.*\s[—–-]\s+(backend|frontend|fullstack|lib)\s*$/m.test(text) ||
      !!section(card, 'зависит от') || !!section(card, 'кто меня потребляет');
  }

  // События: блоки «### публикует `x`» или старая таблица «| публикует | `x` | … |».
  function events(card) {
    var sec = section(card, 'события'), out = [];
    if (!sec) return out;
    blockTitles(sec).forEach(function (t) {
      var m = t.match(/^(публикует|потребляет)\s+(.+)$/i);
      if (m && !isDash(m[2])) out.push({ dir: m[1].toLowerCase(), topic: stripTicks(m[2]) });
    });
    tableRows(sec).forEach(function (r) {
      var d = (r[0] || '').toLowerCase().trim();
      if ((d === 'публикует' || d === 'потребляет') && !isDash(r[1])) out.push({ dir: d, topic: stripTicks(r[1]), when: r[2] || '' });
    });
    return out;
  }

  // Счётчики для панели: сколько чего в карточке.
  function counts(card) {
    function blocks(name) {
      var s = section(card, name);
      return s ? blockTitles(s).filter(function (t) { return !isDash(t); }).length : null;
    }
    function rows(name) {
      var s = section(card, name);
      return s ? tableRows(s).filter(function (r) { return !isDash(r[0]); }).length : null;
    }
    return {
      endpoints: blocks('публичный контракт'), api: blocks('публичный api'), events: events(card).length,
      jobs: blocks('фоновые задачи'), entities: blocks('владеет данными'), screens: rows('экраны'), roles: rows('роли и доступ'),
    };
  }

  // ---------------------------------------------------------------- граф
  function build(files) {
    var manifest = [], cards = [], history = {}, issues = [];
    files.forEach(function (f) {
      var path = f[0], text = f[1];
      if (text == null) return;
      if (/(^|\/)manifest\.ya?ml$/i.test(path) && path.indexOf('/') < 0) { manifest = parseManifest(text); return; }
      var h = path.match(/^_history\/(.+)\.md$/i);
      if (h) { history[h[1]] = text; return; }
      if (path.indexOf('/') >= 0 || !/\.md$/i.test(path)) return;
      var card = parseCard(text, path);
      if (looksLikeCard(card, text)) { card.text = text; cards.push(card); }
    });

    var nodes = {}, byLower = {};
    function addNode(id, init) {
      if (!nodes[id]) { nodes[id] = init; byLower[id.toLowerCase()] = id; }
      return nodes[id];
    }
    manifest.forEach(function (s) {
      addNode(s.name, { id: s.name, type: TYPES.indexOf(s.type) >= 0 ? s.type : '', inManifest: true, hasCard: false,
        external: false, path: s.path, notes: s.notes, description: '', scanned: '', updated: '', counts: null,
        sections: [], text: '', history: history[s.name] || '', topicsAlone: [] });
    });
    cards.forEach(function (c) {
      var n = nodes[c.service] || nodes[byLower[c.service.toLowerCase()]];
      if (!n) {
        n = addNode(c.service, { id: c.service, type: '', inManifest: false, hasCard: true, external: false, path: c.repo,
          notes: '', description: '', scanned: '', updated: '', counts: null, sections: [], text: '',
          history: history[c.service] || '', topicsAlone: [] });
        if (manifest.length) issues.push({ kind: 'not-in-manifest', service: n.id });
      }
      if (n.hasCard && n.text) { issues.push({ kind: 'duplicate-card', service: n.id, file: c.file }); return; }
      n.hasCard = true;
      n.type = n.type || (TYPES.indexOf(c.type) >= 0 ? c.type : '');
      n.description = c.description; n.scanned = c.scanned; n.updated = c.updated;
      n.counts = counts(c); n.sections = c.order; n.text = c.text; n.file = c.file;
      c.node = n;
    });
    Object.keys(nodes).forEach(function (id) {
      if (nodes[id].inManifest && !nodes[id].hasCard) issues.push({ kind: 'no-card', service: id });
    });

    // Узел для имени из строки связи: свой сервис — по имени (без учёта регистра), иначе внешний.
    function target(rawName, why) {
      var name = stripTicks(rawName);
      if (!name || isDash(name) || /^не определено/i.test(name)) return null;
      var id = nodes[name] ? name : byLower[name.toLowerCase()];
      if (id && !nodes[id].external) return id;
      var ext = 'ext:' + name;
      addNode(ext, { id: ext, label: name, type: 'external', inManifest: false, hasCard: false, external: true,
        outsideMarked: /вне манифеста/i.test(why || ''), path: '', notes: '', description: '', scanned: '', updated: '',
        counts: null, sections: [], text: '', history: '', topicsAlone: [] });
      return ext;
    }

    var edges = {};
    function edge(kind, s, t) {
      var id = kind + ':' + s + '->' + t;
      if (!edges[id]) edges[id] = { id: id, kind: kind, source: s, target: t, items: [], topics: [] };
      return edges[id];
    }

    // Вызовы и зависимости — со стороны вызывающего.
    cards.forEach(function (c) {
      if (!c.node) return;
      var me = c.node.id;
      var api = section(c, 'потребляемые api');
      if (api) tableRows(api).forEach(function (r) {
        var t = target(r[0], r[2]);
        if (!t || t === me) return;
        edge('call', me, t).items.push({ call: isDash(r[1]) ? '' : stripTicks(r[1]), why: (r[2] || '').trim(), from: 'api' });
      });
      var dep = section(c, 'зависит от');
      if (dep) tableRows(dep).forEach(function (r) {
        var t = target(r[0], r[1]);
        if (!t || t === me) return;
        edge('call', me, t).items.push({ call: '', why: (r[1] || '').trim(), from: 'dep' });
      });
    });

    // Зеркала: у каждой строки «Кто меня потребляет» должна быть пара у названного сервиса.
    cards.forEach(function (c) {
      if (!c.node) return;
      var me = c.node.id, sec = section(c, 'кто меня потребляет');
      if (!sec) return;
      tableRows(sec).forEach(function (r) {
        var name = stripTicks(r[0]);
        if (!name || isDash(name)) return;
        var call = isDash(r[1]) ? '' : stripTicks(r[1]), why = (r[2] || '').trim();
        var src = nodes[name] ? name : byLower[name.toLowerCase()];
        var fwd = src && edges['call:' + src + '->' + me];
        var paired = !!fwd && fwd.items.some(function (it) { return !call || it.call === call || (!it.call && it.from === 'dep'); });
        if (paired) return;
        issues.push({ kind: 'one-sided', service: me, from: name, call: call, why: why });
        var s = src || target(name, '');
        if (s && s !== me) edge('mirror', s, me).items.push({ call: call, why: why, from: 'mirror' });
      });
    });

    // События: топик → кто публикует, кто потребляет.
    var topics = {};
    cards.forEach(function (c) {
      if (!c.node) return;
      events(c).forEach(function (e) {
        var t = topics[e.topic] || (topics[e.topic] = { topic: e.topic, pub: [], sub: [] });
        var list = e.dir === 'публикует' ? t.pub : t.sub;
        if (list.indexOf(c.node.id) < 0) list.push(c.node.id);
      });
    });
    Object.keys(topics).forEach(function (k) {
      var t = topics[k];
      t.pub.forEach(function (p) {
        t.sub.forEach(function (s) { if (p !== s) edge('event', p, s).topics.push(k); });
      });
      if (!t.pub.length || !t.sub.length) {
        t.pub.concat(t.sub).forEach(function (id) { nodes[id].topicsAlone.push({ topic: k, dir: t.pub.length ? 'pub' : 'sub' }); });
      }
    });

    // Внешний узел, к которому ведут только односторонние зеркала, показывается лишь вместе с ними.
    var solid = {};
    Object.keys(edges).forEach(function (k) {
      if (edges[k].kind !== 'mirror') { solid[edges[k].source] = true; solid[edges[k].target] = true; }
    });
    var nodeList = Object.keys(nodes).map(function (id) {
      var n = nodes[id];
      n.label = n.label || id;
      n.mirrorOnly = n.external && !solid[id];
      return n;
    });
    return {
      nodes: nodeList,
      edges: Object.keys(edges).map(function (k) { return edges[k]; }),
      topics: Object.keys(topics).sort().map(function (k) { return topics[k]; }),
      issues: issues,
      manifest: manifest.length > 0,
      cards: cards.length,
    };
  }

  return { build: build, parseManifest: parseManifest, parseCard: parseCard, tableRows: tableRows };
});
