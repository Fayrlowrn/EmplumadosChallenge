# SoloBoom entre amigos — especificación

Recreación del tablero del SoloBoom Challenge (soloboom.net) para un grupo de amigos en LAN.
Se publica en **GitHub Pages**; un **GitHub Action** consulta la API de Riot cada ~15 min y
hace commit de `data/ranking.json`. No hay servidor: la página es estática y lee ese JSON.

## Archivos

```
index.html            página (HTML + CSS + JS vanilla, sin build, sin frameworks)
app.js                lee data/ranking.json y pinta la tabla
styles.css
assets/emblems/       emblemas de liga, YA EN EL REPO: {iron,bronze,silver,gold,platinum,emerald,
                      diamond,master,grandmaster,challenger}.png (160 px de ancho, recortados)
assets/positions/     íconos de línea, YA EN EL REPO: {top,jungle,middle,bottom,utility}.png
                      (136×136, blancos sobre transparente; teñirlos de dorado con CSS filter)
data/players.json     configuración: jugadores y región (lo edita el usuario)
data/ranking.json     salida del updater (lo lee la página)
data/state.json       estado interno del updater (puuid, caché de partidas, línea base diaria)
scripts/update.mjs    updater (Node 24, sin dependencias: fetch nativo)
.github/workflows/update.yml
README.md             cómo sacar la API key, configurar el secreto y activar Pages
```

## Updater (`scripts/update.mjs`)

Fuente de datos: API de Riot si hay `RIOT_API_KEY`; si no (o con `--opgg`), lee la meta
description del perfil público de op.gg (elo, LP, W/L; sin línea ni estado de partida, que
quedan `null`). `ranking.json` lleva `"fuente": "riot" | "opgg" | "mock"`.

- Lee `RIOT_API_KEY` del entorno (o de `.env` en local, parseado a mano, sin dotenv).
  **Nunca** escribe la key en ningún archivo ni la imprime en logs.
- `--mock`: no llama a Riot; genera un `ranking.json` verosímil para los jugadores de
  `players.json` (para probar la página sin key). Determinista (semilla fija).
- Por jugador con `riotId` no nulo (`gameName#tagLine`):
  1. `GET https://{routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`
     → `puuid`. Cachear en `state.json`; solo se pide si no está en caché o si el riotId cambió.
     `gameName`/`tagLine` van con `encodeURIComponent` (hay nombres con Ñ y acentos).
  2. `GET https://{region}.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}`
     → entrada con `queueType === "RANKED_SOLO_5x5"`: tier, rank, leaguePoints, wins, losses.
     Sin entrada → "UNRANKED".
  3. `GET https://{region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{puuid}`
     → 200 = en partida (guardar `gameQueueConfigId` y `gameStartTime`), 404 = no.
  4. Línea principal: si `linea` está fijada en players.json, usarla. Si no:
     `GET https://{routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&count=20`,
     y para cada matchId **no cacheado** en `state.json` pedir
     `GET https://{routing}.api.riotgames.com/lol/match/v5/matches/{matchId}` y guardar solo
     `{teamPosition}` del participante con ese puuid. La línea = moda de teamPosition
     (TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY) de las últimas 20. Caché acotada a 20 por jugador.
- Rate limit: los límites de la key de desarrollo son 20 req/s y 100 req/2 min. Espaciar las
  peticiones (~1.25 s entre peticiones). En 429, respetar `Retry-After` y reintentar (máx. 3).
  Un error en un jugador no tumba al resto: ese jugador conserva su último dato conocido y se
  marca `stale: true`.
- Orden: puntaje = índice de tier × 400 + índice de división × 100 + LP
  (IRON..DIAMOND con división IV..I; MASTER/GRANDMASTER/CHALLENGER sin división, solo LP encima
  de DIAMOND I). Desempate: winrate y luego más partidas. UNRANKED y jugadores sin riotId
  ("pendiente") al final, en orden alfabético.
- Cambio de posición: `state.json` guarda la posición de cada jugador al inicio del día
  (en `timezone` de players.json). `cambio = posiciónInicioDelDía - posiciónActual`.
  Al cambiar de día se toma la línea base nueva.
- `ranking.json`:
  ```json
  {
    "actualizado": "ISO-8601",
    "region": "LAN",
    "jugadores": [
      {
        "pos": 1, "cambio": 2,
        "nombre": "Farid", "riotId": "LANivia#FYRWN",
        "tier": "GOLD", "division": "II", "lp": 52,
        "wins": 10, "losses": 2, "winrate": 83.33,
        "linea": "MIDDLE",
        "enPartida": false, "partidaDesde": null,
        "twitch": null, "opgg": "https://op.gg/lol/summoners/lan/LANivia-FYRWN",
        "pendiente": false, "stale": false
      }
    ]
  }
  ```
  El op.gg usa `{gameName}-{tagLine}` con encodeURIComponent.
- Escribe JSON con indentación de 2 espacios y solo reescribe `ranking.json` si cambió algo
  además de `actualizado` (para no generar commits vacíos). Con `--force` lo escribe siempre.

## Página

Debe verse como el tablero de SoloBoom 5 (captura de referencia): fondo azul marino muy
oscuro, filas anchas separadas por una línea sutil, todo centrado, tipografía sans
(Google Fonts "Barlow" y "Barlow Condensed", como soloboom.net).

Columnas, en orden:
1. `#` posición, en negrita.
2. Cambio: `==` gris si 0, `+N` verde (#a3e635) si sube, `-N` rojo (#f87171) si baja.
3. Participante (nombre), negrita. Si tiene `twitch`, es link a twitch.tv/{twitch}.
4. Cuenta: Riot ID, link a op.gg (nueva pestaña). Pendiente → texto gris "pendiente".
5. Servidor: "LAN".
6. Estado: "En partida" verde con un punto pulsante (y minutos transcurridos desde
   `partidaDesde`) u "Off" en rojo suave (#f87171), como en la captura.
7. Línea: ícono dorado de la posición (assets/positions), con `title` accesible.
8. W / L, p. ej. "184 / 68".
9. Winrate: ≥ 65 % dorado (#fbbf24), ≥ 55 % verde (#a3e635), ≥ 50 % blanco, < 50 % rojo.
   Sin partidas: "—".
10. Emblema de liga (assets/emblems, ~64 px) con el texto debajo en mayúsculas
    ("CHALLENGER I", "GOLD II"; para MASTER+ sin división se muestra solo el tier). Unranked:
    texto "SIN CLASIFICAR" sin imagen.
11. LP, alineado a la derecha, tamaño pequeño ("2106 LP").

Encabezado de página: título "SOLOBOOM" estilo soloboom.net (dorado/rojo sobre oscuro), subtítulo
con el número de jugadores y "Actualizado hace X min" calculado en el navegador a partir de
`actualizado` (se refresca cada 30 s). Buscador que filtra filas por texto. Ordenar al hacer clic
en encabezados de #, W/L, Winrate y LP (por defecto por #). La página vuelve a pedir
`data/ranking.json?t=<timestamp>` cada 2 minutos sin recargar.

Responsive: en ≤ 720 px se ocultan Servidor, Línea, W/L y Estado pasa a un punto de color
junto al nombre; sin scroll horizontal; márgenes laterales de 16 px.
Accesibilidad: `<table>` real con `<th scope="col">`, contraste AA, `alt` en las imágenes.

## GitHub Action (`.github/workflows/update.yml`)

- `on: schedule: cron "*/15 * * * *"` + `workflow_dispatch`.
- `permissions: contents: write`. `concurrency` para que no corran dos a la vez.
- Node 24, `node scripts/update.mjs` con `RIOT_API_KEY: ${{ secrets.RIOT_API_KEY }}`.
- Si cambió `data/`, commit con el bot `github-actions[bot]` y push.
- Si falta el secreto, el job termina en error con un mensaje claro.
