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

  function tierCell(j) {
    if (j.pendiente) return '<span class="muted">—</span>';
    if (j.tier === 'UNRANKED') return '<div class="tier"><span class="muted">SIN CLASIFICAR</span></div>';
    const label = APEX.has(j.tier) ? j.tier : `${j.tier} ${j.division}`;
    return `<div class="tier"><img src="assets/emblems/${j.tier.toLowerCase()}.png" alt="" loading="lazy"><span>${esc(label)}<span class="tier-lp"> · ${j.lp} LP</span></span></div>`;
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
      <td class="c-name">${dot}${name}${stale}<span class="name-account">${esc(j.riotId ?? 'pendiente')}</span></td>
      <td class="c-account">${account}</td>
      <td class="c-server">${esc(data.region)}</td>
      <td class="c-status">${statusCell(j)}</td>
      <td class="c-role">${role}</td>
      <td class="c-record">${record}</td>
      <td class="c-wr">${wr}</td>
      <td class="c-tier">${tierCell(j)}</td>
      <td class="c-lp">${lp}</td>
    </tr>`;
  }

  function sorted(list) {
    const val = {
      pos: (j) => j.pos,
      games: (j) => j.wins + j.losses,
      winrate: (j) => j.winrate ?? -1,
      lp: (j) => score(j),
    }[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (val(a) - val(b)) * dir || a.pos - b.pos);
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
      opgg: 'Datos leídos de op.gg: se actualizan cuando alguien pulsa "Actualizar" en el perfil de op.gg del jugador.',
      mock: 'Datos de prueba (no son reales).',
    };
    $('source').textContent = fuentes[data.fuente] ?? '';
  }

  function renderUpdated() {
    if (!data) return;
    const min = minutesSince(data.actualizado);
    const text = min < 1 ? 'Actualizado hace un momento' : min < 60 ? `Actualizado hace ${min} min` : `Actualizado hace ${Math.floor(min / 60)} h`;
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

  search.addEventListener('input', applySearch);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; applySearch(); } });

  load();
  setInterval(load, REFRESH_MS);
  setInterval(renderUpdated, 30 * 1000);
})();
