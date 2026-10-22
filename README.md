# SoloBoom LAN

Tabla de un reto de SoloQ entre amigos, al estilo del [SoloBoom Challenge](https://soloboom.net).
Es una página estática (GitHub Pages) que lee `data/ranking.json`. Un GitHub Action
actualiza ese archivo cada ~15 minutos.

## De dónde salen los datos

`scripts/update.mjs` elige la fuente sola:

| Fuente | Cuándo | Qué da | Ojo |
|---|---|---|---|
| **API de Riot** | si existe el secreto `RIOT_API_KEY` | elo, LP, W/L, línea principal, si está en partida | hace falta una key |
| **op.gg** | si no hay key | elo, LP, W/L | solo es tan fresco como la última vez que alguien pulsó **Actualizar** en el perfil de op.gg del jugador |

Con op.gg, después de jugar cada uno entra a su op.gg (el link de su cuenta en la tabla) y
pulsa **Actualizar**; a los ≤15 min aparece en la tabla.

## Publicarla en GitHub Pages

1. Crea un repositorio en GitHub y sube esta carpeta (`git push`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`,
   carpeta `/ (root)`.
3. **Actions**: actívalas si GitHub lo pide y ejecuta una vez *Actualizar tabla* con
   **Run workflow** para comprobar que funciona.

GitHub no garantiza los 15 minutos exactos: en horas de mucha carga el cron puede retrasarse.

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
- `linea`: `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM` o `UTILITY` para fijarla a mano. Con la API
  de Riot, si es `null` se calcula sola con las últimas 20 rankeds; con op.gg queda vacía.
- `twitch`: canal de Twitch; el nombre en la tabla pasa a ser un link.

## Cómo se ordena

Por elo (tier → división → LP); empate por winrate y luego por partidas jugadas. La columna de
cambio (`+2`, `-1`, `==`) compara con la posición al empezar el día (hora de Ciudad de México;
se cambia en `timezone` de `players.json`).
