// Actualiza data/ranking.json.
// Fuente: API de Riot si hay RIOT_API_KEY; si no, lee los perfiles públicos de op.gg.
// Uso: node scripts/update.mjs [--mock] [--opgg] [--force]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PLAYERS_FILE = path.join(DATA, 'players.json');
const RANKING_FILE = path.join(DATA, 'ranking.json');
const STATE_FILE = path.join(DATA, 'state.json');

const MOCK = process.argv.includes('--mock');
const FORCE_OPGG = process.argv.includes('--opgg');
const FORCE = process.argv.includes('--force');

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const MATCH_CACHE_SIZE = 20;
const REQUEST_GAP_MS = 1250; // 100 peticiones / 2 min de la key de desarrollo

// ---------- utilidades ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');

function splitRiotId(riotId) {
  const i = riotId.lastIndexOf('#');
  return { gameName: riotId.slice(0, i), tagLine: riotId.slice(i + 1) };
}

function opggUrl(riotId) {
  const { gameName, tagLine } = splitRiotId(riotId);
  return `https://op.gg/lol/summoners/lan/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

// Puntaje para ordenar: más alto = mejor. -1 para sin clasificar.
function score(tier, division, lp) {
  const t = TIERS.indexOf(tier);
  if (t < 0) return -1;
  if (APEX.has(tier)) return TIERS.indexOf('DIAMOND') * 400 + 400 + lp;
  return t * 400 + DIVISIONS.indexOf(division) * 100 + lp;
}

function winrate(wins, losses) {
  const total = wins + losses;
  return total ? Math.round((wins / total) * 10000) / 100 : null;
}

// Fecha local (YYYY-MM-DD) en la zona horaria del reto.
function localDay(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function loadApiKey() {
  if (process.env.RIOT_API_KEY) return process.env.RIOT_API_KEY.trim();
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) {
    // .env mínimo: líneas CLAVE=valor
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*RIOT_API_KEY\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return null;
}

// ---------- cliente de Riot ----------

class RiotClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.last = 0;
  }

  // Devuelve el JSON, o null si es 404. Lanza en otros errores.
  async get(url, attempt = 1) {
    const wait = this.last + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();

    const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });
    if (res.status === 404) return null;
    if (res.status === 429 && attempt <= 3) {
      const retry = Number(res.headers.get('retry-after') || 10);
      console.warn(`  429 (límite de peticiones), reintento en ${retry}s`);
      await sleep(retry * 1000);
      return this.get(url, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Riot respondió ${res.status}: la API key no es válida o caducó`);
    }
    if (!res.ok) throw new Error(`Riot respondió ${res.status} en ${new URL(url).pathname}`);
    return res.json();
  }
}

async function fetchPlayer(riot, cfg, player, saved) {
  const { region, routing } = cfg;
  const { gameName, tagLine } = splitRiotId(player.riotId);

  let puuid = saved.riotId === player.riotId ? saved.puuid : null;
  if (!puuid) {
    const acc = await riot.get(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
    if (!acc) throw new Error(`no existe la cuenta ${player.riotId}`);
    puuid = acc.puuid;
    saved.matches = {};
  }
  saved.riotId = player.riotId;
  saved.puuid = puuid;

  const entries = await riot.get(`https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`);
  const solo = (entries || []).find((e) => e.queueType === 'RANKED_SOLO_5x5');

  const game = await riot.get(`https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`);

  let linea = player.linea;
  if (!linea) {
    const ids = (await riot.get(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${MATCH_CACHE_SIZE}`
    )) || [];
    const cache = saved.matches || {};
    for (const id of ids) {
      if (id in cache) continue;
      const match = await riot.get(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${id}`);
      const me = match?.info?.participants?.find((p) => p.puuid === puuid);
      cache[id] = me?.teamPosition || null;
    }
    saved.matches = Object.fromEntries(ids.map((id) => [id, cache[id]]));
    linea = mostCommon(Object.values(saved.matches).filter((p) => POSITIONS.includes(p)));
  }

  return {
    tier: solo?.tier ?? 'UNRANKED',
    division: solo && !APEX.has(solo.tier) ? solo.rank : null,
    lp: solo?.leaguePoints ?? 0,
    wins: solo?.wins ?? 0,
    losses: solo?.losses ?? 0,
    linea: linea || null,
    enPartida: Boolean(game),
    partidaDesde: game?.gameStartTime ? new Date(game.gameStartTime).toISOString() : null,
  };
}

// ---------- op.gg (sin key) ----------
// op.gg pone el resumen de SoloQ en la meta description del perfil:
//   "LANivia#FYRWN / Gold 2 52 LP / 10Win 2Lose Win rate 83% / ..."
//   "Ñemalodon#negan / Master 65 LP / 227Win 232Lose ..."
//   "akriiuwu#MOSCA / Lv. 33"  (sin clasificar)
// Solo refleja la última vez que alguien pulsó "Actualizar" en op.gg.

const OPGG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let opggLast = 0;

async function fetchFromOpgg(player) {
  const wait = opggLast + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  opggLast = Date.now();

  const res = await fetch(opggUrl(player.riotId), { headers: { 'User-Agent': OPGG_UA, 'Accept-Language': 'en' } });
  if (res.status === 404) throw new Error(`op.gg no tiene la cuenta ${player.riotId}`);
  if (!res.ok) throw new Error(`op.gg respondió ${res.status}`);
  const html = await res.text();
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc) throw new Error('op.gg cambió el formato de la página');

  const rank = desc.match(/\/ (Iron|Bronze|Silver|Gold|Platinum|Emerald|Diamond|Master|Grandmaster|Challenger)(?: ([1-4]))? (\d+) LP/i);
  const record = desc.match(/(\d+)Win (\d+)Lose/);
  const tier = rank ? rank[1].toUpperCase() : 'UNRANKED';
  return {
    tier,
    division: rank && !APEX.has(tier) ? DIVISIONS[4 - Number(rank[2])] : null,
    lp: rank ? Number(rank[3]) : 0,
    wins: rank && record ? Number(record[1]) : 0,
    losses: rank && record ? Number(record[2]) : 0,
    linea: player.linea || null,
    enPartida: null, // op.gg no lo da en el perfil
    partidaDesde: null,
  };
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (!best || n > counts.get(best)) best = v;
  return best;
}

// ---------- datos de prueba ----------

function mockPlayer(player, i) {
  // Generador determinista (mulberry32) con semilla por jugador.
  let seed = 1337 + i * 7919;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tier = TIERS[Math.floor(rand() * TIERS.length)];
  const wins = 20 + Math.floor(rand() * 180);
  const losses = Math.floor(wins * (0.5 + rand() * 0.6));
  const enPartida = rand() < 0.3;
  return {
    tier,
    division: APEX.has(tier) ? null : DIVISIONS[Math.floor(rand() * 4)],
    lp: APEX.has(tier) ? Math.floor(rand() * 1800) : Math.floor(rand() * 100),
    wins,
    losses,
    linea: player.linea || POSITIONS[Math.floor(rand() * POSITIONS.length)],
    enPartida,
    partidaDesde: enPartida ? new Date(Date.now() - Math.floor(rand() * 30 * 60000)).toISOString() : null,
  };
}

// ---------- principal ----------

async function main() {
  const cfg = await readJson(PLAYERS_FILE);
  const state = await readJson(STATE_FILE, { jugadores: {}, baseline: null });
  const previous = await readJson(RANKING_FILE, null);
  const prevByName = new Map((previous?.jugadores || []).map((j) => [j.nombre, j]));

  const key = MOCK || FORCE_OPGG ? null : loadApiKey();
  const fuente = MOCK ? 'mock' : key ? 'riot' : 'opgg';
  const riot = key ? new RiotClient(key) : null;
  console.log(`Fuente de datos: ${fuente}`);

  const rows = [];
  let failures = 0;
  for (const [i, player] of cfg.players.entries()) {
    const base = {
      nombre: player.nombre,
      riotId: player.riotId,
      twitch: player.twitch || null,
      opgg: player.riotId ? opggUrl(player.riotId) : null,
      pendiente: !player.riotId,
      stale: false,
    };
    if (!player.riotId) {
      rows.push({ ...base, tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0, linea: player.linea || null, enPartida: null, partidaDesde: null });
      continue;
    }
    try {
      const saved = (state.jugadores[player.nombre] ||= {});
      const data =
        fuente === 'mock' ? mockPlayer(player, i) :
        fuente === 'riot' ? await fetchPlayer(riot, cfg, player, saved) :
        await fetchFromOpgg(player);
      rows.push({ ...base, ...data });
      console.log(`✓ ${player.nombre} (${player.riotId}): ${data.tier} ${data.division ?? ''} ${data.lp} LP`);
    } catch (err) {
      failures++;
      console.error(`✗ ${player.nombre} (${player.riotId}): ${err.message}`);
      const old = prevByName.get(player.nombre);
      rows.push(old ? { ...old, ...base, stale: true } : { ...base, tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0, linea: null, enPartida: null, partidaDesde: null, stale: true });
      if (/API key/.test(err.message)) break; // con la key inválida no tiene sentido seguir
    }
  }
  if (failures === cfg.players.filter((p) => p.riotId).length && failures > 0) {
    console.error('Fallaron todos los jugadores; no se actualiza ranking.json.');
    process.exit(1);
  }

  for (const r of rows) {
    r.winrate = winrate(r.wins, r.losses);
    r._score = r.pendiente ? -2 : score(r.tier, r.division, r.lp);
  }
  rows.sort((a, b) =>
    b._score - a._score ||
    (a._score < 0 ? a.nombre.localeCompare(b.nombre, 'es') : 0) ||
    (b.winrate ?? 0) - (a.winrate ?? 0) ||
    (b.wins + b.losses) - (a.wins + a.losses)
  );

  // Cambio de posición respecto al inicio del día local.
  const now = new Date();
  const today = localDay(now, cfg.timezone);
  if (!state.baseline || state.baseline.dia !== today) {
    const prevPos = Object.fromEntries((previous?.jugadores || []).map((j) => [j.nombre, j.pos]));
    rows.forEach((r, i) => { prevPos[r.nombre] ??= i + 1; });
    state.baseline = { dia: today, posiciones: prevPos };
  }

  const jugadores = rows.map(({ _score, ...r }, i) => {
    const pos = i + 1;
    const start = state.baseline.posiciones[r.nombre] ?? pos;
    return {
      pos,
      cambio: start - pos,
      nombre: r.nombre,
      riotId: r.riotId,
      tier: r.tier,
      division: r.division,
      lp: r.lp,
      wins: r.wins,
      losses: r.losses,
      winrate: r.winrate,
      linea: r.linea,
      enPartida: r.enPartida,
      partidaDesde: r.partidaDesde,
      twitch: r.twitch,
      opgg: r.opgg,
      pendiente: r.pendiente,
      stale: r.stale,
    };
  });

  const ranking = { actualizado: now.toISOString(), region: cfg.regionLabel, fuente, jugadores };
  const changed = FORCE || !previous || JSON.stringify(previous.jugadores) !== JSON.stringify(jugadores);

  await writeJson(STATE_FILE, state);
  if (changed) {
    await writeJson(RANKING_FILE, ranking);
    console.log(`ranking.json actualizado (${jugadores.length} jugadores)`);
  } else {
    console.log('Sin cambios en el ranking; ranking.json no se reescribe.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
