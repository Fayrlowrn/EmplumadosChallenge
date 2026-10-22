# Emplumados Challenge

Tabla de un reto de SoloQ entre amigos, al estilo del [SoloBoom Challenge](https://soloboom.net).
Es una página estática (GitHub Pages) que lee `data/ranking.json`. Un GitHub Action
actualiza ese archivo cada ~15 minutos.

## De dónde salen los datos

`scripts/update.mjs` elige la fuente sola:

| Fuente | Cuándo | Qué da | Ojo |
|---|---|---|---|
| **API de Riot** | si existe el secreto `RIOT_API_KEY` | elo, LP, W/L, línea principal, si está en partida | hace falta una key |
| **op.gg** | si no hay key | elo, LP, W/L | usa la renovación interna de op.gg (no oficial) |

Con op.gg, el updater primero renueva cada perfil con las mismas Server Actions que usa el botón
"Update" de op.gg, y después lo lee. No es una API pública: si op.gg cambia su web puede dejar de
funcionar; en ese caso los datos siguen saliendo, solo que sin renovar
(`node scripts/update.mjs --opgg --sin-renovar` lee sin renovar).

## Publicarla en GitHub Pages

1. Crea un repositorio en GitHub y sube esta carpeta (`git push`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`,
   carpeta `/ (root)`.
3. **Actions**: actívalas si GitHub lo pide y ejecuta una vez *Actualizar tabla* con
   **Run workflow** para comprobar que funciona.

GitHub no garantiza los 15 minutos exactos: en horas de mucha carga el cron puede retrasarse.

## Botón "Actualizar" (Cloudflare Worker)

La página es pública y no puede llevar un token de GitHub, así que el botón llama a un
Worker (`worker/`) que guarda el token y lanza el Action. El Worker no deja lanzarlo si ya hay
una ejecución en curso o si la última empezó hace menos de 2 minutos.

1. Crea una cuenta gratis en <https://dash.cloudflare.com/sign-up>.
2. En la carpeta `worker/`: `npx wrangler login` (autoriza en el navegador) y luego
   `npx wrangler deploy`. Al terminar imprime la URL, p. ej.
   `https://emplumados-actualizar.<tu-subdominio>.workers.dev`.
3. Crea un token *fine-grained* en <https://github.com/settings/personal-access-tokens/new>:
   - Repository access: **Only select repositories → EmplumadosChallenge**
   - Permissions → Repository → **Actions: Read and write**
4. En `worker/`: `npx wrangler secret put GITHUB_TOKEN` y pega el token cuando lo pida.
5. Pon la URL del paso 2 en `index.html`:
   `<meta name="actualizar-url" content="https://emplumados-actualizar....workers.dev">`.
   Mientras esté vacía, el botón no aparece.

## Usar la API de Riot (opcional, más datos)

1. Entra a <https://developer.riotgames.com> con tu cuenta de Riot.
2. La **Development API Key** del panel sirve para probar, pero **caduca cada 24 h**.
3. Para una key permanente: **Register Product → Personal API Key**, describe el proyecto
   (tablero de un reto entre amigos, no comercial, ~8 jugadores) y espera la aprobación.
4. En el repo: **Settings → Secrets and variables → Actions → New repository secret**,
   nombre `RIOT_API_KEY`, valor: la key. Nunca la pongas en un archivo del repo.

Si la key caduca, el Action falla con "la API key no es válida o caducó". Bórrala o renuévala.

## Probar en local

```bash
node scripts/update.mjs --mock     # datos inventados, sin red
node scripts/update.mjs --opgg     # datos reales de op.gg
python -m http.server 8765         # y abre http://localhost:8765
```

Para usar la API de Riot en local, crea un archivo `.env` (ya está en `.gitignore`) con
`RIOT_API_KEY=...` y corre `node scripts/update.mjs`.

## Editar jugadores

`data/players.json`:

```json
{ "nombre": "Farid", "riotId": "LANivia#FYRWN", "linea": null, "twitch": null }
```

- `riotId`: nombre#tag exacto. `null` = pendiente (sale al final de la tabla).
- `linea`: `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM` o `UTILITY`. op.gg no dice la línea de cada
  partida, así que se fija a mano. Con la API de Riot, si es `null` se calcula con sus rankeds.
- `twitch`: canal de Twitch; el nombre en la tabla pasa a ser un link.

## Stats del reto

`inicio` en `players.json` (fecha `AAAA-MM-DD`, hora de `timezone`) marca el comienzo del reto:

- **Reto**: LP ganados desde la primera foto de cada jugador ya clasificado tomada a partir de
  `inicio` (cuenta divisiones: subir de Oro II 80 LP a Oro I 20 LP son +40). Debajo, V/D del reto.
  Si se cambia `inicio`, la foto se vuelve a tomar en la siguiente actualización.
- **Racha**: victorias o derrotas seguidas en SoloQ (🔥/🧊 desde 3).
- **Main**: campeón más jugado en SoloQ desde `inicio`.
- **Última**: hace cuánto jugó su última SoloQ y cuántas lleva hoy.

Las partidas se van guardando en `data/state.json` en cada actualización: op.gg solo muestra
las ~10 más recientes, así que las stats cubren el reto desde que se empezaron a guardar.

## Cómo se ordena

Por elo (tier → división → LP); empate por winrate y luego por partidas jugadas. La columna de
cambio (`+2`, `-1`, `==`) compara con la posición al empezar el día (hora de Ciudad de México;
se cambia en `timezone` de `players.json`).
