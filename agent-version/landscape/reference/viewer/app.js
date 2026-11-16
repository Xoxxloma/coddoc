// app.js — страница карты сервисов: граф на cytoscape, панель сервиса, фильтры, фокус, путь.
// Данные: window.LANDSCAPE_DATA из data.js (его пишет pack.sh / pack.ps1); нет его — экран «перетащите папку».
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var TYPES = ['backend', 'frontend', 'fullstack', 'lib', 'external'];
  var TYPE_RU = { backend: 'бэкенд', frontend: 'фронт', fullstack: 'фулстек', lib: 'библиотека', external: 'внешняя' };
  var SHAPE = { backend: 'round-rectangle', frontend: 'ellipse', fullstack: 'round-octagon', lib: 'round-hexagon', external: 'round-rectangle' };

  var store = {
    get: function (k) { try { return window.localStorage.getItem('landscape.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem('landscape.' + k, v); } catch (e) { /* без памяти — не беда */ } },
  };
  var md = window.markdownit ? window.markdownit({ html: false, linkify: true }) : null;

  var S = {
    graph: null, cy: null, byId: {}, selected: null, selectedEdge: null, depth: 1, onlyNear: false, path: null,
    tab: 'links', layout: store.get('layout') || 'layers',
    show: { backend: true, frontend: true, fullstack: true, lib: true, external: true, call: true, event: true, mirror: false },
  };

  // ---------------------------------------------------------------- мелочи
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function b64utf8(b) {
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function svcLink(id) {
    var n = S.byId[id];
    return '<a class="svc" data-svc="' + esc(id) + '">' + esc(n ? n.label : id) + '</a>';
  }
  function renderMd(text) {
    var body = String(text || '').replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    if (!md) return '<pre>' + esc(body) + '</pre>';
    var html = md.render(body);
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
  }

  // ---------------------------------------------------------------- тема
  function initTheme() {
    var t = store.get('theme') || 'auto';
    document.documentElement.setAttribute('data-theme', t);
    $('#theme').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = { auto: 'light', light: 'dark', dark: 'auto' }[cur] || 'auto';
      document.documentElement.setAttribute('data-theme', next);
      store.set('theme', next);
      toast('Тема: ' + { auto: 'как в системе', light: 'светлая', dark: 'тёмная' }[next]);
      restyle();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { restyle(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
  }

  // Цвет узла лежит в его данных (по типу) — при смене темы перечитываем токены.
  function restyle() {
    if (!S.cy) return;
    var col = typeColors();
    S.cy.batch(function () { S.cy.nodes().forEach(function (n) { n.data('color', col[n.data('type') || 'backend']); }); });
    S.cy.style(cyStyle());
  }
  function typeColors() {
    var col = {};
    TYPES.forEach(function (t) { col[t] = css('--t-' + t); });
    return col;
  }

  // ---------------------------------------------------------------- стиль графа
  function cyStyle() {
    var ink = css('--ink'), paper = css('--paper'), ink3 = css('--ink-3');
    var st = [
      { selector: 'node', style: {
        'shape': 'data(shape)', 'width': 'data(w)', 'height': 34, 'label': 'data(label)',
        'font-family': css('--sans'), 'font-size': 12.5, 'font-weight': 600, 'color': ink,
        'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'ellipsis', 'text-max-width': 'data(tw)',
        'background-color': paper, 'border-width': 2, 'border-color': 'data(color)',
        'transition-property': 'opacity, border-width', 'transition-duration': '150ms',
      } },
      { selector: 'node[?nocard]', style: { 'border-style': 'dashed', 'color': ink3 } },
      { selector: 'node[?outside]', style: { 'border-style': 'dotted' } },
      { selector: 'node.external', style: { 'border-style': 'dashed', 'font-weight': 500, 'color': ink3, 'height': 28 } },
      { selector: 'node.match', style: { 'border-width': 4 } },
      { selector: 'node:selected, node.sel', style: { 'background-color': 'data(color)', 'color': paper, 'border-width': 3 } },
      { selector: 'edge', style: {
        'curve-style': 'bezier', 'width': 'data(width)', 'line-color': css('--e-call'),
        'target-arrow-shape': 'triangle', 'target-arrow-color': css('--e-call'), 'arrow-scale': 0.9,
        'font-family': css('--sans'), 'font-size': 10.5, 'color': css('--ink-2'),
        'text-background-color': paper, 'text-background-opacity': 0.9, 'text-background-padding': 2,
        'text-rotation': 'autorotate', 'transition-property': 'opacity', 'transition-duration': '150ms',
      } },
      // События — дугой: подписчик часто в том же слое, и прямая шла бы сквозь соседей по ряду.
      { selector: 'edge.event', style: { 'line-style': 'dashed', 'line-color': css('--e-event'), 'target-arrow-color': css('--e-event'),
        'target-arrow-shape': 'triangle-backcurve', 'curve-style': 'unbundled-bezier', 'control-point-distances': 46,
        'control-point-weights': 0.5 } },
      { selector: 'edge.mirror', style: { 'line-style': 'dotted', 'line-color': css('--e-mirror'), 'target-arrow-color': css('--e-mirror') } },
      { selector: 'edge.labeled, edge:selected', style: { 'label': 'data(label)' } },
      { selector: 'edge:selected', style: { 'width': 'data(wsel)', 'line-color': css('--accent'), 'target-arrow-color': css('--accent') } },
      { selector: '.faded', style: { 'opacity': 0.12 } },
      { selector: 'edge.near', style: { 'line-color': css('--accent'), 'target-arrow-color': css('--accent') } },
      { selector: 'edge.event.near', style: { 'line-color': css('--e-event'), 'target-arrow-color': css('--e-event') } },
      { selector: 'node.path', style: { 'border-color': css('--e-path'), 'border-width': 4, 'opacity': 1, 'z-index': 10 } },
      { selector: 'edge.path', style: { 'line-color': css('--e-path'), 'target-arrow-color': css('--e-path'), 'width': 4, 'opacity': 1, 'z-index': 10 } },
    ];
    return st;
  }

  // ---------------------------------------------------------------- данные → элементы cytoscape
  function elements(g) {
    var els = [], col = typeColors();
    g.nodes.forEach(function (n) {
      var t = n.external ? 'external' : (n.type || 'backend');
      var label = n.label;
      els.push({ group: 'nodes', classes: n.external ? 'external' : '', data: {
        id: n.id, label: label, type: t, shape: SHAPE[t],
        color: col[t], w: Math.max(56, Math.min(220, label.length * 7.4 + 26)),
        tw: Math.min(200, label.length * 7.4 + 6), nocard: !n.hasCard && !n.external, outside: !n.inManifest && n.hasCard && g.manifest,
      } });
    });
    g.edges.forEach(function (e) {
      var calls = e.items.filter(function (i) { return i.call; }).length;
      // Подпись — только когда она что-то говорит: число вызовов или топики; голая зависимость — без подписи.
      var label = e.kind === 'event' ? e.topics.join(', ')
        : calls > 1 ? calls + ' ' + plural(calls, 'вызов', 'вызова', 'вызовов') : calls === 1 ? e.items.filter(function (i) { return i.call; })[0].call : '';
      var weight = e.kind === 'event' ? e.topics.length : Math.max(1, e.items.length);
      els.push({ group: 'edges', classes: e.kind, data: {
        id: e.id, source: e.source, target: e.target, kind: e.kind, label: label,
        width: 1.3 + Math.min(weight, 8) * 0.35, wsel: 2.5 + Math.min(weight, 8) * 0.35,
      } });
    });
    return els;
  }

  // ---------------------------------------------------------------- загрузка
  function load(files, meta) {
    var g = window.LandscapeParse.build(files);
    if (!g.nodes.length) {
      showDrop('В папке нет карточек сервисов — ни одного <code>*.md</code> с шапкой <code>service:</code>.');
      return;
    }
    S.graph = g; S.byId = {};
    g.nodes.forEach(function (n) { S.byId[n.id] = n; });
    $('#drop').hidden = true;
    $('#root').textContent = meta && meta.root ? meta.root + (meta.made ? ' · ' + meta.made : '') : '';
    document.title = 'Карта сервисов' + (meta && meta.root ? ' — ' + meta.root : '');

    var names = $('#names');
    names.innerHTML = '';
    g.nodes.filter(function (n) { return !n.mirrorOnly; }).forEach(function (n) {
      var o = document.createElement('option'); o.value = n.label; names.appendChild(o);
    });

    if (S.cy) S.cy.destroy();
    S.cy = window.cytoscape({
      container: $('#cy'), elements: elements(g), style: cyStyle(),
      minZoom: 0.08, maxZoom: 4, selectionType: 'single', boxSelectionEnabled: false,
    });
    bindGraph();
    renderFilters();
    applyFilters();
    runLayout(true);

    var focus = meta && meta.focus;
    if (focus) {
      var id = findId(focus);
      if (id) setTimeout(function () { select(id, true); }, 650);
      else toast('Сервиса «' + focus + '» на карте нет');
    }
    if (!S.selected) renderOverview();
  }

  function findId(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return null;
    var list = S.graph.nodes.filter(function (n) { return !n.mirrorOnly; }), i;
    for (i = 0; i < list.length; i++) if (list[i].label.toLowerCase() === q || list[i].id.toLowerCase() === q) return list[i].id;
    for (i = 0; i < list.length; i++) if (list[i].label.toLowerCase().indexOf(q) >= 0) return list[i].id;
    return null;
  }

  // ---------------------------------------------------------------- раскладка
  function layoutOpts(name, first) {
    var visible = S.cy.elements(':visible');
    var base = { name: name, animate: !first, animationDuration: 450, padding: 40, fit: true, eles: visible };
    if (name === 'cose') {
      return Object.assign(base, { nodeRepulsion: function () { return 16000; }, idealEdgeLength: function () { return 120; },
        edgeElasticity: function () { return 90; }, gravity: 0.5, numIter: 2000, randomize: first, componentSpacing: 90,
        nodeOverlap: 24, nodeDimensionsIncludeLabels: true, animate: first ? false : 'end' });
    }
    if (name === 'layers') {
      return Object.assign(base, { name: 'preset', positions: layered(visible), animate: !first, animationDuration: 450 });
    }
    if (name === 'concentric') {
      return Object.assign(base, { concentric: function (n) { return n.degree(); }, levelWidth: function () { return 2; },
        minNodeSpacing: 18, avoidOverlap: true });
    }
    if (name === 'circle') return Object.assign(base, { avoidOverlap: true, spacingFactor: 1.05 });
    return Object.assign(base, { avoidOverlap: true, condense: true });
  }
  // «Слои»: кто вызывает — выше, кого вызывают — ниже. Слой — длина самой длинной цепочки вызовов до узла
  // (циклы рвутся на обратном ребре); внутри слоя — порядок по среднему положению соседей, чтобы меньше
  // пересечений; длинный слой переносится на несколько рядов. Узлы без вызовов — последним рядом.
  function layered(eles) {
    var nodes = eles.nodes(), calls = eles.edges().filter(function (e) { return e.data('kind') !== 'event'; });
    var callers = {}, callees = {}, level = {}, state = {};
    nodes.forEach(function (n) { callers[n.id()] = []; callees[n.id()] = []; });
    calls.forEach(function (e) {
      var s = e.source().id(), t = e.target().id();
      if (callers[t] && callees[s] && s !== t) { callers[t].push(s); callees[s].push(t); }
    });
    function lv(v) {
      if (level[v] != null) return level[v];
      if (state[v] === 1) return -1;
      state[v] = 1;
      var m = -1;
      callers[v].forEach(function (u) { var l = lv(u); if (l > m) m = l; });
      state[v] = 2;
      return (level[v] = m + 1);
    }
    var rows = [], lonely = [];
    nodes.forEach(function (n) {
      var id = n.id();
      if (!callers[id].length && !callees[id].length) { lonely.push(id); return; }
      var l = lv(id);
      (rows[l] = rows[l] || []).push(id);
    });
    rows = rows.filter(Boolean);
    // Порядок в слое: два прохода сверху вниз и снизу вверх по среднему индексу соседей.
    var idx = {};
    rows.forEach(function (r) { r.sort(); r.forEach(function (id, i) { idx[id] = i / Math.max(1, r.length - 1); }); });
    function sweep(list, near) {
      list.forEach(function (r) {
        r.forEach(function (id) {
          var ns = near[id].filter(function (x) { return idx[x] != null; });
          r['_' + id] = ns.length ? ns.reduce(function (a, x) { return a + idx[x]; }, 0) / ns.length : idx[id];
        });
        r.sort(function (a, b) { return r['_' + a] - r['_' + b]; });
        r.forEach(function (id, i) { idx[id] = i / Math.max(1, r.length - 1); });
      });
    }
    for (var k = 0; k < 3; k++) { sweep(rows.slice(1), callers); sweep(rows.slice(0, -1).reverse(), callees); }
    if (lonely.length) rows.push(lonely.sort());
    // Ширина ряда — не шире экрана с запасом; длинный слой — несколько рядов.
    var maxW = Math.max(900, S.cy.width() * 1.4), gapX = 26, pos = {}, y = 0;
    rows.forEach(function (r) {
      var lines = [[]], w = 0;
      r.forEach(function (id) {
        var nw = S.cy.getElementById(id).data('w') + gapX;
        if (w + nw > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; }
        lines[lines.length - 1].push(id); w += nw;
      });
      lines.forEach(function (line, li) {
        var total = line.reduce(function (a, id) { return a + S.cy.getElementById(id).data('w') + gapX; }, -gapX);
        var x = -total / 2;
        line.forEach(function (id, i) {
          var nw = S.cy.getElementById(id).data('w');
          pos[id] = { x: x + nw / 2 + (li % 2 ? 14 : 0), y: y };
          x += nw + gapX;
        });
        y += li < lines.length - 1 ? 62 : 120;
      });
    });
    return pos;
  }

  function runLayout(first) {
    if (!S.cy) return;
    var l = S.cy.layout(layoutOpts(S.layout, first));
    l.run();
  }

  // ---------------------------------------------------------------- фильтры
  function renderFilters() {
    var g = S.graph, cnt = {};
    TYPES.forEach(function (t) { cnt[t] = 0; });
    g.nodes.forEach(function (n) { if (!n.mirrorOnly) cnt[n.external ? 'external' : (n.type || 'backend')]++; });
    var ecnt = { call: 0, event: 0, mirror: 0 };
    g.edges.forEach(function (e) { ecnt[e.kind]++; });
    var html = '';
    TYPES.forEach(function (t) {
      if (!cnt[t]) return;
      html += '<button class="chip" data-f="' + t + '" aria-pressed="' + S.show[t] + '"><span class="sw ' + t + '"></span>' +
        (t === 'external' ? 'внешние' : t) + ' <span class="n">' + cnt[t] + '</span></button>';
    });
    html += '<span class="sep"></span>';
    html += '<button class="chip" data-f="call" aria-pressed="' + S.show.call + '"><span class="ln call"></span>вызовы <span class="n">' + ecnt.call + '</span></button>';
    if (ecnt.event) html += '<button class="chip" data-f="event" aria-pressed="' + S.show.event + '"><span class="ln event"></span>события <span class="n">' + ecnt.event + '</span></button>';
    if (ecnt.mirror) html += '<button class="chip" data-f="mirror" aria-pressed="' + S.show.mirror + '" title="Строки «Кто меня потребляет», у которых нет пары в карточке вызывающего"><span class="ln mirror"></span>без пары <span class="n">' + ecnt.mirror + '</span></button>';
    $('#filters').innerHTML = html;
  }

  function applyFilters() {
    var cy = S.cy, show = S.show;
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        var d = S.byId[n.id()], t = d.external ? 'external' : (d.type || 'backend');
        var vis = show[t] && (!d.mirrorOnly || show.mirror);
        n.style('display', vis ? 'element' : 'none');
      });
      cy.edges().forEach(function (e) {
        e.style('display', show[e.data('kind')] ? 'element' : 'none');
      });
      if (S.onlyNear && S.selected) {
        var keep = neighborhood(S.selected, S.depth);
        cy.nodes(':visible').forEach(function (n) { if (!keep.has(n.id())) n.style('display', 'none'); });
      }
    });
    highlight();
  }

  // Окрестность по видимым рёбрам, без учёта направления; depth 0 — весь граф.
  function neighborhood(id, depth) {
    var seen = new Set([id]), frontier = [id];
    for (var d = 0; d < (depth || 999) && frontier.length; d++) {
      var next = [];
      frontier.forEach(function (cur) {
        S.cy.getElementById(cur).connectedEdges().filter(function (e) { return S.show[e.data('kind')]; }).forEach(function (e) {
          [e.source().id(), e.target().id()].forEach(function (x) {
            var n = S.byId[x];
            if (!seen.has(x) && n && (!n.mirrorOnly || S.show.mirror)) { seen.add(x); next.push(x); }
          });
        });
      });
      frontier = next;
    }
    return seen;
  }

  function highlight() {
    var cy = S.cy;
    cy.batch(function () {
      cy.elements().removeClass('faded near labeled sel path');
      if (S.path) {
        cy.elements().addClass('faded');
        S.path.removeClass('faded').addClass('path labeled');
        return;
      }
      if (!S.selected) return;
      var keep = neighborhood(S.selected, S.depth);
      cy.getElementById(S.selected).addClass('sel');
      cy.nodes().forEach(function (n) { if (!keep.has(n.id())) n.addClass('faded'); });
      cy.edges().forEach(function (e) {
        var inside = keep.has(e.source().id()) && keep.has(e.target().id());
        if (!inside) e.addClass('faded');
        else if (e.source().id() === S.selected || e.target().id() === S.selected) e.addClass('near labeled');
      });
    });
  }

  // ---------------------------------------------------------------- выбор
  function select(id, center) {
    S.selected = id; S.selectedEdge = null; S.path = null;
    S.cy.elements().unselect();
    if (S.onlyNear) applyFilters(); else highlight();
    var n = S.cy.getElementById(id);
    if (center && n.length && n.visible()) S.cy.animate({ center: { eles: n }, zoom: Math.max(S.cy.zoom(), 1) }, { duration: 350 });
    renderService(id);
  }
  function clearSelection() {
    var hadOnly = S.onlyNear;
    S.selected = null; S.selectedEdge = null; S.path = null; S.onlyNear = false;
    S.cy.elements().unselect();
    if (hadOnly) { applyFilters(); runLayout(false); } else highlight();
    renderOverview();
  }
  function showPath(from, to) {
    var vis = S.cy.elements(':visible');
    var r = vis.aStar({ root: S.cy.getElementById(from), goal: S.cy.getElementById(to), directed: false });
    if (!r.found) { toast('Пути между ними по видимым связям нет'); return; }
    S.path = r.path;
    highlight();
    S.cy.animate({ fit: { eles: r.path, padding: 90 } }, { duration: 350 });
    var names = r.path.nodes().map(function (n) { return n.id(); });
    renderService(from, names);
  }

  // ---------------------------------------------------------------- граф: события мыши
  function bindGraph() {
    var cy = S.cy, tip = $('#tip');
    cy.on('tap', 'node', function (ev) {
      var id = ev.target.id();
      var shift = ev.originalEvent && ev.originalEvent.shiftKey;
      if (shift && S.selected && S.selected !== id) { showPath(S.selected, id); return; }
      select(id, false);
    });
    cy.on('dbltap', 'node', function (ev) {
      S.selected = ev.target.id(); S.onlyNear = true; S.depth = S.depth || 1;
      applyFilters(); runLayout(false); renderService(S.selected);
    });
    cy.on('tap', 'edge', function (ev) {
      S.selectedEdge = ev.target.id(); S.selected = null; S.path = null;
      highlight();
      cy.elements().not(ev.target.union(ev.target.connectedNodes())).addClass('faded');
      ev.target.addClass('labeled');
      renderEdge(ev.target.id());
    });
    cy.on('tap', function (ev) { if (ev.target === cy) clearSelection(); });
    cy.on('mouseover', 'node', function (ev) {
      var n = S.byId[ev.target.id()];
      if (!n) return;
      var c = n.counts, bits = [];
      if (c) {
        if (c.endpoints) bits.push(c.endpoints + ' ' + plural(c.endpoints, 'ручка', 'ручки', 'ручек'));
        if (c.screens) bits.push(c.screens + ' ' + plural(c.screens, 'экран', 'экрана', 'экранов'));
        if (c.events) bits.push(c.events + ' ' + plural(c.events, 'событие', 'события', 'событий'));
      }
      tip.innerHTML = '<b>' + esc(n.label) + '</b>' + (n.description ? esc(n.description) : (n.external ? 'вне манифеста, карточки нет' : '')) +
        (bits.length ? '<div class="muted">' + bits.join(' · ') + '</div>' : '');
      tip.hidden = false;
      if (!S.selected && !S.path) ev.target.connectedEdges(':visible').addClass('labeled');
    });
    cy.on('mouseout', 'node', function (ev) {
      tip.hidden = true;
      if (!S.selected && !S.path) ev.target.connectedEdges().removeClass('labeled');
    });
    cy.on('mouseover', 'edge', function (ev) { ev.target.addClass('labeled'); });
    cy.on('mouseout', 'edge', function (ev) {
      var e = ev.target;
      if (!(S.selected && (e.source().id() === S.selected || e.target().id() === S.selected)) && !(S.path && S.path.contains(e))) e.removeClass('labeled');
    });
    cy.on('mousemove', function (ev) {
      if (tip.hidden || !ev.originalEvent) return;
      var x = ev.originalEvent.clientX + 14, y = ev.originalEvent.clientY + 14;
      if (x + 330 > window.innerWidth) x = ev.originalEvent.clientX - 334;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    cy.on('drag', 'node', function () { tip.hidden = true; });
  }

  // ---------------------------------------------------------------- панель: обзор
  function renderOverview() {
    var g = S.graph, p = $('#panel');
    var own = g.nodes.filter(function (n) { return !n.external; });
    var ext = g.nodes.filter(function (n) { return n.external && !n.mirrorOnly; });
    var calls = g.edges.filter(function (e) { return e.kind === 'call'; }).length;
    var html = '<h2>Слепок сервисов</h2>';
    html += '<div class="stats">' +
      stat(own.length, plural(own.length, 'сервис', 'сервиса', 'сервисов')) +
      stat(calls, plural(calls, 'связь', 'связи', 'связей')) +
      stat(g.topics.length, plural(g.topics.length, 'топик', 'топика', 'топиков')) +
      (ext.length ? stat(ext.length, 'вне манифеста') : '') + '</div>';
    html += '<p class="hint"><b>Клик</b> — карточка сервиса и его связи. <b>Двойной клик</b> — только его окрестность. ' +
      '<b>Shift+клик</b> по второму — путь между ними. Узлы можно таскать, колесо — масштаб, <b>/</b> — поиск, <b>Esc</b> — сброс.</p>';

    html += '<h3>Обозначения</h3><div class="legend">' +
      '<span class="sw backend"></span><span>бэкенд</span><span class="sw frontend"></span><span>фронт</span>' +
      '<span class="sw fullstack"></span><span>фулстек</span><span class="sw lib"></span><span>библиотека</span>' +
      '<span class="sw external"></span><span>внешняя система — карточки нет</span>' +
      '<span class="ln call"></span><span>вызывает: стрелка к тому, кого вызывают; толще — больше вызовов</span>' +
      '<span class="ln event"></span><span>событие: от публикующего к подписчику</span>' +
      (g.edges.some(function (e) { return e.kind === 'mirror'; }) ? '<span class="ln mirror"></span><span>строка «Кто меня потребляет» без пары у вызывающего</span>' : '') +
      '</div>';

    var iss = g.issues, list = [];
    var by = function (k) { return iss.filter(function (i) { return i.kind === k; }); };
    var nocard = by('no-card'), notin = by('not-in-manifest'), one = by('one-sided'), dup = by('duplicate-card');
    if (nocard.length) list.push('В манифесте, но карточки нет: ' + nocard.map(function (i) { return svcLink(i.service); }).join(', ') +
      ' — <code>/service-map ' + esc(nocard.map(function (i) { return i.service; }).join(' ')) + '</code>');
    if (notin.length) list.push('Карточка есть, а в манифесте строки нет: ' + notin.map(function (i) { return svcLink(i.service); }).join(', '));
    if (dup.length) list.push('Две карточки на один сервис: ' + dup.map(function (i) { return esc(i.service) + ' (<code>' + esc(i.file) + '</code>)'; }).join(', '));
    if (one.length) list.push(one.length + ' ' + plural(one.length, 'строка', 'строки', 'строк') + ' «Кто меня потребляет» без пары у вызывающего — на графе по фильтру «без пары»');
    var alone = g.topics.filter(function (t) { return !t.pub.length || !t.sub.length; });
    if (alone.length) list.push(alone.length + ' ' + plural(alone.length, 'топик', 'топика', 'топиков') + ' без второй стороны в слепке: ' +
      alone.slice(0, 8).map(function (t) { return '<code>' + esc(t.topic) + '</code>'; }).join(', ') + (alone.length > 8 ? '…' : ''));
    if (list.length) html += '<h3>Что не сходится в слепке</h3><ul class="issues">' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';

    if (ext.length) html += '<h3>Внешние системы</h3><p>' + ext.map(function (n) { return svcLink(n.id); }).join(', ') + '</p>';
    p.innerHTML = html;
  }
  function stat(n, label) { return '<div class="stat"><b>' + n + '</b><span>' + esc(label) + '</span></div>'; }

  // ---------------------------------------------------------------- панель: сервис
  function renderService(id, pathIds) {
    var n = S.byId[id], g = S.graph, p = $('#panel');
    if (!n) return;
    var t = n.external ? 'external' : (n.type || '');
    var html = '<h2>' + esc(n.label) + (t ? ' <span class="badge ' + t + '">' + esc(TYPE_RU[t] || t) + '</span>' : '') +
      (!n.hasCard && !n.external ? ' <span class="badge warn">нет карточки</span>' : '') +
      (n.hasCard && !n.inManifest && g.manifest ? ' <span class="badge warn">нет в манифесте</span>' : '') + '</h2>';
    if (n.description) html += '<p>' + esc(n.description) + '</p>';
    if (n.external) html += '<p class="muted">Внешняя система или сервис вне манифеста: карточки нет, связи — из карточек соседей.</p>';
    var dates = [];
    if (n.scanned) dates.push('прочитан из кода ' + esc(n.scanned));
    if (n.updated) dates.push('обновлён ' + esc(n.updated));
    if (n.path) dates.push('<code>' + esc(n.path) + '</code>');
    if (dates.length) html += '<p class="muted">' + dates.join(' · ') + '</p>';
    if (n.notes) html += '<div class="notes">' + esc(n.notes) + '</div>';

    var c = n.counts;
    if (c) {
      var st = '';
      [['endpoints', 'ручка', 'ручки', 'ручек'], ['api', 'экспорт', 'экспорта', 'экспортов'], ['screens', 'экран', 'экрана', 'экранов'],
        ['events', 'событие', 'события', 'событий'], ['jobs', 'задача', 'задачи', 'задач'], ['entities', 'сущность', 'сущности', 'сущностей'],
        ['roles', 'роль', 'роли', 'ролей']].forEach(function (k) {
        if (c[k[0]]) st += stat(c[k[0]], plural(c[k[0]], k[1], k[2], k[3]));
      });
      if (st) html += '<div class="stats">' + st + '</div>';
    }

    html += '<div class="row">Окрестность: <span class="seg" id="depth">' + [1, 2, 3, 0].map(function (d) {
      return '<button data-d="' + d + '" aria-pressed="' + (S.depth === d) + '">' + (d || 'всё') + '</button>';
    }).join('') + '</span> <label class="chk"><input type="checkbox" id="only"' + (S.onlyNear ? ' checked' : '') + '> только она</label></div>';
    if (pathIds) {
      html += '<div class="row"><span>Путь: ' + pathIds.map(svcLink).join(' → ') + ' <span class="muted">(' + (pathIds.length - 1) + ' ' +
        plural(pathIds.length - 1, 'шаг', 'шага', 'шагов') + ')</span></span> <button class="btn" id="nopath">Сбросить</button></div>';
    } else {
      html += '<p class="hint"><b>Shift+клик</b> по другому сервису — путь до него.</p>';
    }

    var hasHist = !!n.history;
    html += '<div class="tabs" role="tablist">' +
      tabBtn('links', 'Связи') + (n.text ? tabBtn('card', 'Карточка') : '') + (hasHist ? tabBtn('hist', 'История') : '') + '</div>';
    var tab = S.tab;
    if ((tab === 'card' && !n.text) || (tab === 'hist' && !hasHist)) tab = 'links';
    html += '<div id="tabbody">' + (tab === 'card' ? '<div class="md">' + renderMd(n.text) + '</div>'
      : tab === 'hist' ? '<div class="md">' + renderMd(n.history) + '</div>' : linksHtml(id)) + '</div>';
    p.innerHTML = html;
    p.scrollTop = 0;
  }
  function tabBtn(key, label) {
    var tab = S.tab;
    return '<button role="tab" data-tab="' + key + '" aria-selected="' + (tab === key) + '">' + label + '</button>';
  }

  function linksHtml(id) {
    var g = S.graph, out = [], inn = [], pub = [], sub = [], mir = [];
    g.edges.forEach(function (e) {
      if (e.kind === 'call' && e.source === id) out.push(e);
      if (e.kind === 'call' && e.target === id) inn.push(e);
      if (e.kind === 'mirror' && e.target === id) mir.push(e);
    });
    g.topics.forEach(function (t) {
      if (t.pub.indexOf(id) >= 0) pub.push(t);
      if (t.sub.indexOf(id) >= 0) sub.push(t);
    });
    function items(e) {
      var li = e.items.map(function (i) {
        return '<li>' + (i.call ? '<code>' + esc(i.call) + '</code>' + (i.why ? ' — ' : '') : '') + esc(i.why || (i.call ? '' : 'зависимость без описания')) + '</li>';
      });
      return li.length ? '<ul>' + li.join('') + '</ul>' : '';
    }
    var h = '';
    h += '<h3>Вызывает · ' + out.length + '</h3>';
    h += out.length ? '<ul class="rel">' + out.map(function (e) { return '<li>' + svcLink(e.target) + items(e) + '</li>'; }).join('') + '</ul>'
      : '<p class="muted">Ни от кого не зависит.</p>';
    h += '<h3>Его вызывают · ' + inn.length + '</h3>';
    h += inn.length ? '<ul class="rel">' + inn.map(function (e) { return '<li>' + svcLink(e.source) + items(e) + '</li>'; }).join('') + '</ul>'
      : '<p class="muted">В слепке его никто не вызывает.</p>';
    if (pub.length) {
      h += '<h3>Публикует · ' + pub.length + '</h3><ul class="rel">' + pub.map(function (t) {
        return '<li><code>' + esc(t.topic) + '</code><ul><li>' + (t.sub.length ? 'слушают: ' + t.sub.map(svcLink).join(', ')
          : '<span class="muted">в слепке никто не слушает</span>') + '</li></ul></li>';
      }).join('') + '</ul>';
    }
    if (sub.length) {
      h += '<h3>Слушает · ' + sub.length + '</h3><ul class="rel">' + sub.map(function (t) {
        return '<li><code>' + esc(t.topic) + '</code><ul><li>' + (t.pub.length ? 'публикует: ' + t.pub.map(svcLink).join(', ')
          : '<span class="muted">публикующего в слепке нет</span>') + '</li></ul></li>';
      }).join('') + '</ul>';
    }
    if (mir.length) {
      h += '<h3>Без пары · ' + mir.length + '</h3><p class="hint">Строки «Кто меня потребляет» этой карточки, которых нет у вызывающего: ' +
        'связь потеряна у него или устарела здесь.</p><ul class="rel">' + mir.map(function (e) {
        return '<li>' + svcLink(e.source) + items(e) + '</li>';
      }).join('') + '</ul>';
    }
    return h;
  }

  // ---------------------------------------------------------------- панель: связь
  function renderEdge(eid) {
    var g = S.graph, e = null;
    g.edges.forEach(function (x) { if (x.id === eid) e = x; });
    if (!e) return;
    var html = '<h2>' + svcLink(e.source) + ' → ' + svcLink(e.target) + '</h2>';
    if (e.kind === 'event') {
      html += '<p class="muted">События: публикует ' + svcLink(e.source) + ', слушает ' + svcLink(e.target) + '.</p>';
      html += '<ul class="rel">' + e.topics.map(function (t) { return '<li><code>' + esc(t) + '</code></li>'; }).join('') + '</ul>';
    } else {
      html += '<p class="muted">' + (e.kind === 'mirror' ? 'Строки «Кто меня потребляет» у ' + svcLink(e.target) + ' без пары у ' + svcLink(e.source) + '.'
        : 'Из карточки ' + svcLink(e.source) + ': «Потребляемые API» и «Зависит от».') + '</p>';
      html += '<ul class="rel">' + e.items.map(function (i) {
        return '<li>' + (i.call ? '<code>' + esc(i.call) + '</code>' : '<span class="muted">без вызова</span>') +
          (i.why ? '<ul><li>' + esc(i.why) + '</li></ul>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    $('#panel').innerHTML = html;
  }

  // ---------------------------------------------------------------- панель и полоса: клики
  function bindUi() {
    $('#panel').addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-svc]');
      if (a) { select(a.getAttribute('data-svc'), true); return; }
      var d = ev.target.closest('[data-d]');
      if (d && S.selected) {
        S.depth = +d.getAttribute('data-d');
        if (S.onlyNear) { applyFilters(); runLayout(false); } else highlight();
        renderService(S.selected);
        return;
      }
      var tb = ev.target.closest('[data-tab]');
      if (tb && S.selected) { S.tab = tb.getAttribute('data-tab'); renderService(S.selected); return; }
      if (ev.target.id === 'nopath') { S.path = null; highlight(); renderService(S.selected); }
    });
    $('#panel').addEventListener('change', function (ev) {
      if (ev.target.id === 'only' && S.selected) {
        S.onlyNear = ev.target.checked;
        applyFilters(); runLayout(false);
      }
    });
    $('#filters').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-f]');
      if (!b) return;
      var f = b.getAttribute('data-f');
      S.show[f] = !S.show[f];
      b.setAttribute('aria-pressed', S.show[f]);
      S.path = null;
      applyFilters();
      if (S.selected && !S.cy.getElementById(S.selected).visible()) clearSelection();
      else if (S.selected) renderService(S.selected);
    });
    var sel = $('#layout');
    sel.value = S.layout;
    if (sel.value !== S.layout) { S.layout = 'layers'; sel.value = 'layers'; }
    sel.addEventListener('change', function () { S.layout = sel.value; store.set('layout', S.layout); runLayout(false); });
    $('#relayout').addEventListener('click', function () { runLayout(false); });
    $('#fit').addEventListener('click', function () { if (S.cy) S.cy.animate({ fit: { eles: S.cy.elements(':visible'), padding: 40 } }, { duration: 300 }); });
    $('#png').addEventListener('click', function () {
      if (!S.cy) return;
      var uri = S.cy.png({ full: true, scale: 2, bg: css('--bg') });
      var a = document.createElement('a');
      a.href = uri; a.download = 'landscape.png';
      document.body.appendChild(a); a.click(); a.remove();
    });

    var q = $('#q');
    q.addEventListener('input', function () {
      if (!S.cy) return;
      var v = q.value.trim().toLowerCase();
      S.cy.nodes().removeClass('match');
      if (v) S.cy.nodes().filter(function (n) { return n.data('label').toLowerCase().indexOf(v) >= 0; }).addClass('match');
      var exact = S.graph.nodes.some(function (n) { return n.label.toLowerCase() === v; });
      if (exact) { select(findId(v), true); }
    });
    q.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var id = findId(q.value);
        if (id) select(id, true); else toast('Не нашёл «' + q.value + '»');
      }
      if (ev.key === 'Escape') { q.value = ''; S.cy && S.cy.nodes().removeClass('match'); q.blur(); }
    });
    document.addEventListener('keydown', function (ev) {
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
      if (ev.key === '/' && !typing) { ev.preventDefault(); q.focus(); q.select(); }
      else if (ev.key === 'Escape' && !typing && S.cy) clearSelection();
      else if ((ev.key === 'f' || ev.key === 'F' || ev.key === 'а' || ev.key === 'А') && !typing && S.cy && !ev.metaKey && !ev.ctrlKey) $('#fit').click();
    });
  }

  // ---------------------------------------------------------------- без данных: перетащить папку
  function showDrop(msg) {
    var d = $('#drop');
    d.hidden = false;
    if (msg) d.querySelector('.muted').innerHTML = msg;
  }
  function bindDrop() {
    var d = $('#drop');
    ['dragenter', 'dragover'].forEach(function (k) {
      window.addEventListener(k, function (ev) { ev.preventDefault(); d.hidden = false; d.classList.add('over'); });
    });
    window.addEventListener('dragleave', function (ev) {
      if (!ev.relatedTarget) { d.classList.remove('over'); if (S.graph) d.hidden = true; }
    });
    window.addEventListener('drop', function (ev) {
      ev.preventDefault();
      d.classList.remove('over');
      readDropped(ev.dataTransfer).then(function (files) { useFiles(files, 'перетащенная папка'); });
    });
    $('#pick').addEventListener('change', function (ev) {
      var list = Array.prototype.slice.call(ev.target.files || []);
      Promise.all(list.map(function (f) {
        var rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
        return f.text().then(function (t) { return [rel, t]; });
      })).then(function (files) { useFiles(files, 'выбранная папка'); });
    });
  }
  function useFiles(files, how) {
    files = files.filter(function (f) { return /\.(md|ya?ml)$/i.test(f[0]) && !/^_pending\//.test(f[0]); });
    if (!files.length) { showDrop('Карточек не нашлось — нужна папка <code>services</code> с файлами <code>*.md</code>.'); return; }
    load(files, { root: how });
  }
  // Папка целиком: файлы верхнего уровня и _history/; одна папка внутри — заходим в неё (перетащили родителя).
  function readDropped(dt) {
    var items = Array.prototype.slice.call(dt.items || []);
    var entries = items.map(function (i) { return i.webkitGetAsEntry ? i.webkitGetAsEntry() : null; }).filter(Boolean);
    if (!entries.length) {
      return Promise.all(Array.prototype.slice.call(dt.files || []).map(function (f) {
        return f.text().then(function (t) { return [f.name, t]; });
      }));
    }
    function readDir(dir) {
      return new Promise(function (res) {
        var r = dir.createReader(), all = [];
        (function more() { r.readEntries(function (batch) { if (!batch.length) res(all); else { all = all.concat(batch); more(); } }, function () { res(all); }); })();
      });
    }
    function fileText(entry) { return new Promise(function (res) { entry.file(function (f) { f.text().then(res, function () { res(null); }); }, function () { res(null); }); }); }
    function collect(list, prefix) {
      return Promise.all(list.map(function (e) {
        if (e.isFile) return fileText(e).then(function (t) { return [[prefix + e.name, t]]; });
        if (e.isDirectory && !prefix && e.name === '_history') return readDir(e).then(function (sub) { return collect(sub.filter(function (x) { return x.isFile; }), '_history/'); });
        return Promise.resolve([]);
      })).then(function (parts) { return [].concat.apply([], parts); });
    }
    if (entries.length === 1 && entries[0].isDirectory) {
      return readDir(entries[0]).then(function (list) {
        var hasMd = list.some(function (e) { return e.isFile && /\.md$/i.test(e.name); });
        var svc = list.filter(function (e) { return e.isDirectory && e.name === 'services'; })[0];
        if (!hasMd && svc) return readDir(svc).then(function (l2) { return collect(l2, ''); });
        return collect(list, '');
      });
    }
    return collect(entries, '');
  }

  // Ручки для самотеста (DevTools-протокол): состояние и действия страницы.
  window.LandscapeApp = { state: S, select: select, clear: function () { clearSelection(); }, path: showPath };

  // ---------------------------------------------------------------- старт
  function boot() {
    initTheme();
    bindUi();
    bindDrop();
    if (!window.cytoscape || !window.LandscapeParse) { showDrop('Страница собрана не полностью: нет файлов из <code>vendor/</code>.'); return; }
    var D = window.LANDSCAPE_DATA;
    if (D && D.files) {
      var files = D.files.map(function (f) { return [f[0], f[1] == null ? null : b64utf8(f[1])]; });
      load(files, D);
    } else {
      showDrop();
    }
  }
  boot();
})();
