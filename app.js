// Pinta data/ranking.json y lo vuelve a pedir cada 2 minutos.
(() => {
  'use strict';

  const REFRESH_MS = 2 * 60 * 1000;
  const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
  const ROLES = {
    TOP: ['top', 'Top'],
    JUNGLE: ['jungle', 'Jungla'],
    MIDDLE: ['middle', 'Mid'],
    BOTTOM: ['bottom', 'ADC'],
    UTILITY: ['utility', 'Support'],
  };
  const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const DIVS = ['IV', 'III', 'II', 'I'];

  const $ = (id) => document.getElementById(id);
  const table = $('board');
  const tbody = $('rows');
  const search = $('search');

  let data = null;
  let sort = { key: 'pos', dir: 'asc' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function score(j) {
    const t = TIER_ORDER.indexOf(j.tier);
    if (t < 0) return -1;
    return APEX.has(j.tier) ? 2800 + j.lp : t * 400 + DIVS.indexOf(j.division) * 100 + j.lp;
  }

  function changeCell(c) {
    if (!c) return '<span class="same">==</span>';
    return c > 0 ? `<span class="up">+${c}</span>` : `<span class="down">${c}</span>`;
  }

  function wrClass(wr) {
    if (wr >= 65) return 'wr-gold';
    if (wr >= 55) return 'wr-green';
    if (wr >= 50) return 'wr-white';
    return 'wr-red';
  }

  function minutesSince(iso) {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  }

  function statusCell(j) {
    if (j.enPartida == null) return '<span class="muted">—</span>';
    if (!j.enPartida) return '<span class="status status-off">Off</span>';
    const min = j.partidaDesde ? ` <small>${minutesSince(j.partidaDesde)} min</small>` : '';
    return `<span class="status status-live"><span class="dot" aria-hidden="true"></span>En partida${min}</span>`;
  }

  function progressText(j) {
    if (j.progreso == null) return null;
    const cls = j.progreso > 0 ? 'up' : j.progreso < 0 ? 'down' : 'same';
    return `<span class="${cls}">${j.progreso > 0 ? '+' : ''}${j.progreso} LP</span>`;
  }

  function tierCell(j) {
    if (j.pendiente) return '<span class="muted">—</span>';
    if (j.tier === 'UNRANKED') return '<div class="tier"><span class="muted">SIN CLASIFICAR</span></div>';
    const label = APEX.has(j.tier) ? j.tier : `${j.tier} ${j.division}`;
    const progress = progressText(j);
    return `<div class="tier"><img src="assets/emblems/${j.tier.toLowerCase()}.png" alt="" loading="lazy"><span>${esc(label)}<span class="tier-lp"> · ${j.lp} LP</span></span>${progress ? `<span class="tier-progress">${progress} en el reto</span>` : ''}</div>`;
  }

  function streakBadge(r) {
    if (!r) return '';
    const win = r.tipo === 'W';
    const icon = r.n >= 3 ? (win ? '🔥' : '🧊') : win ? '▲' : '▼';
    const text = `${r.n} ${win ? (r.n === 1 ? 'victoria' : 'victorias') : r.n === 1 ? 'derrota' : 'derrotas'} seguidas`;
    return `<span class="streak ${win ? 'streak-w' : 'streak-l'}" title="${text}"><span aria-hidden="true">${icon}</span>${r.n}<span class="visually-hidden"> ${text}</span></span>`;
  }

  function champCell(c) {
    if (!c) return '<span class="muted">—</span>';
    const title = `${c.nombre} · ${c.partidas} ${c.partidas === 1 ? 'partida' : 'partidas'}`;
    const img = c.icono ? `<img src="${esc(c.icono)}" alt="${esc(c.nombre)}" loading="lazy">` : `<span>${esc(c.nombre)}</span>`;
    return `<div class="champ" title="${esc(title)}">${img}<small>×${c.partidas}</small></div>`;
  }

  function ago(iso) {
    const min = minutesSince(iso);
    if (min < 60) return `hace ${Math.max(1, min)} min`;
    if (min < 48 * 60) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
  }

  function progressCell(j) {
    const text = progressText(j);
    if (!text) return '<span class="muted" title="Empieza a contar cuando el jugador esté clasificado">—</span>';
    const record = j.retoWins != null ? `<small>${j.retoWins}V ${j.retoLosses}D</small>` : '';
    return `<div class="stack">${text}${record}</div>`;
  }

  function lastCell(j) {
    if (!j.ultimaPartida) return '<span class="muted">—</span>';
    const today = j.partidasHoy ? `<small>hoy: ${j.partidasHoy}</small>` : '';
    return `<div class="stack" title="${esc(new Date(j.ultimaPartida).toLocaleString('es-MX'))}"><span>${ago(j.ultimaPartida)}</span>${today}</div>`;
  }

  function row(j) {
    const name = j.twitch
      ? `<a href="https://www.twitch.tv/${encodeURIComponent(j.twitch)}" target="_blank" rel="noopener">${esc(j.nombre)}</a>`
      : esc(j.nombre);
    const dot = j.enPartida == null ? '' : `<span class="dot name-dot ${j.enPartida ? 'live' : 'off'}" aria-hidden="true"></span>`;
    const stale = j.stale ? '<span class="stale" title="No se pudo actualizar; es el último dato conocido">⚠</span>' : '';
    const account = j.pendiente
      ? '<span class="muted pending">pendiente</span>'
      : `<a href="${esc(j.opgg)}" target="_blank" rel="noopener" title="Ver en op.gg">${esc(j.riotId)}</a>`;
    const role = ROLES[j.linea]
      ? `<img class="role" src="assets/positions/${ROLES[j.linea][0]}.png" alt="${ROLES[j.linea][1]}" title="${ROLES[j.linea][1]}">`
      : '<span class="muted">—</span>';
    const games = j.wins + j.losses;
    const record = games ? `${j.wins} / ${j.losses}` : '<span class="muted">—</span>';
    const wr = j.winrate == null ? '<span class="muted">—</span>' : `<span class="${wrClass(j.winrate)}">${j.winrate}%</span>`;
    const lp = j.pendiente || j.tier === 'UNRANKED' ? '<span class="muted">—</span>' : `${j.lp} LP`;
    const search = `${j.nombre} ${j.riotId ?? ''}`.toLowerCase();

    return `<tr data-search="${esc(search)}">
      <td class="c-pos">${j.pos}</td>
      <td class="c-change">${changeCell(j.cambio)}</td>
      <td class="c-name">${dot}${name}${streakBadge(j.racha)}${stale}<span class="name-account">${esc(j.riotId ?? 'pendiente')}</span></td>
      <td class="c-account">${account}</td>
      <td class="c-status">${statusCell(j)}</td>
      <td class="c-role">${role}</td>
      <td class="c-champ">${champCell(j.campeon)}</td>
      <td class="c-record">${record}</td>
      <td class="c-wr">${wr}</td>
      <td class="c-tier">${tierCell(j)}</td>
      <td class="c-lp">${lp}</td>
      <td class="c-progress">${progressCell(j)}</td>
      <td class="c-last">${lastCell(j)}</td>
    </tr>`;
  }

  function sorted(list) {
    const val = {
      pos: (j) => j.pos,
      games: (j) => j.wins + j.losses,
      winrate: (j) => j.winrate ?? -1,
      lp: (j) => score(j),
      progreso: (j) => j.progreso ?? -Infinity,
      ultima: (j) => (j.ultimaPartida ? Date.parse(j.ultimaPartida) : 0),
    }[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    // -Infinity (sin dato) va siempre al final, ordene como ordene.
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === vb) return a.pos - b.pos;
      if (va === -Infinity) return 1;
      if (vb === -Infinity) return -1;
      return (va - vb) * dir;
    });
  }

  function render() {
    if (!data) return;
    const live = data.jugadores.some((j) => j.enPartida != null);
    table.classList.toggle('no-status', !live);
    tbody.innerHTML = sorted(data.jugadores).map(row).join('');
    $('count').textContent = `${data.jugadores.length} jugadores`;
    applySearch();
    renderUpdated();
    const fuentes = {
      riot: 'Datos de la API oficial de Riot Games.',
      opgg: 'Datos de op.gg, renovados automáticamente cada ~15 minutos.',
      mock: 'Datos de prueba (no son reales).',
    };
    const desde = data.inicio
      ? ` "Reto" son los LP ganados desde el ${new Date(`${data.inicio}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.`
      : '';
    $('source').textContent = (fuentes[data.fuente] ?? '') + desde;
  }

  function renderUpdated() {
    if (!data) return;
    const min = minutesSince(data.actualizado);
    // ranking.json solo se reescribe cuando algo cambia, así que esto es el último cambio, no la última consulta.
    const text = min < 1 ? 'Último cambio hace un momento' : min < 60 ? `Último cambio hace ${min} min` : `Último cambio hace ${Math.floor(min / 60)} h`;
    const el = $('updated');
    el.textContent = text;
    el.title = new Date(data.actualizado).toLocaleString('es-MX');
  }

  function applySearch() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const tr of tbody.rows) {
      const hit = !q || tr.dataset.search.includes(q);
      tr.hidden = !hit;
      if (hit) shown++;
    }
    $('empty').hidden = shown > 0;
  }

  async function load() {
    try {
      const res = await fetch(`data/ranking.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
      $('error').hidden = true;
      render();
    } catch (err) {
      if (!data) {
        $('error').hidden = false;
        $('error').textContent = 'No se pudo cargar la tabla. Reintentando…';
        $('updated').textContent = 'Sin datos';
      }
    }
  }

  for (const th of document.querySelectorAll('th.sortable')) {
    th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.sort;
      // # empieza ascendente; el resto, de mayor a menor
      if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else sort = { key, dir: key === 'pos' ? 'asc' : 'desc' };
      for (const other of document.querySelectorAll('th.sortable')) other.removeAttribute('aria-sort');
      th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      render();
    });
  }

  // ---------- botón "Actualizar" ----------
  // Pide al Worker que lance el Action (renueva op.gg y regenera ranking.json), espera a que
  // termine y luego a que GitHub Pages sirva el JSON nuevo.

  const workerUrl = document.querySelector('meta[name="actualizar-url"]')?.content.replace(/\/$/, '');
  const refreshBtn = $('refresh');
  const refreshStatus = $('refresh-status');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function worker(path, method = 'GET') {
    const res = await fetch(workerUrl + path, { method });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(body.error || res.status);
    return body;
  }

  async function waitForRun(since) {
    // La ejecución tarda unos segundos en aparecer; luego ~1 min en terminar.
    for (let i = 0; i < 40; i++) {
      await wait(8000);
      const estado = await worker('/estado');
      const run = estado.ejecucion;
      if (run && Date.parse(run.creada) >= since - 10000 && run.status === 'completed') return estado;
    }
    throw new Error('tardó demasiado');
  }

  async function waitForData(previous) {
    // Tras el commit, GitHub Pages tarda ~30-60 s en publicar.
    for (let i = 0; i < 12; i++) {
      await load();
      if (data && data.actualizado !== previous) return true;
      await wait(10000);
    }
    return false;
  }

  async function refresh() {
    refreshBtn.disabled = true;
    const before = data?.actualizado;
    const since = Date.now();
    try {
      refreshStatus.textContent = 'Pidiendo la actualización…';
      const res = await worker('/actualizar', 'POST');
      if (!res.lanzado && res.motivo === 'reciente') {
        refreshStatus.textContent = 'Se actualizó hace menos de 2 min. Prueba en un momento.';
        return;
      }
      refreshStatus.textContent = 'Consultando op.gg… (1-2 min)';
      const { ejecucion: run, datosCambiados } = await waitForRun(res.lanzado ? since : Date.parse(res.ejecucion.creada));
      if (run.conclusion !== 'success') throw new Error('falló la actualización');
      // El Action solo hace commit si algo cambió; sin commit nuevo no habrá nada que publicar.
      if (!datosCambiados || Date.parse(datosCambiados) < Date.parse(run.creada)) {
        refreshStatus.textContent = 'Sin cambios: nadie ha jugado desde la última vez.';
        return;
      }
      refreshStatus.textContent = 'Publicando…';
      const changed = await waitForData(before);
      refreshStatus.textContent = changed ? '¡Tabla actualizada!' : 'Sin cambios: nadie ha jugado desde la última vez.';
    } catch (err) {
      refreshStatus.textContent = `No se pudo actualizar (${err.message}).`;
    } finally {
      refreshBtn.disabled = false;
    }
  }

  if (workerUrl) {
    $('refresh-box').hidden = false;
    refreshBtn.addEventListener('click', refresh);
  }

  search.addEventListener('input', applySearch);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; applySearch(); } });

  load();
  setInterval(load, REFRESH_MS);
  setInterval(renderUpdated, 30 * 1000);
})();
