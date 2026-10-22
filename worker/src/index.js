// Intermediario del botón "Actualizar": lanza el Action del repo sin exponer el token.
//   POST /actualizar  → lanza el workflow (si no hay uno corriendo o recién lanzado)
//   GET  /estado      → estado de la última ejecución del workflow
// Secreto requerido: GITHUB_TOKEN (fine-grained, solo este repo, permiso Actions: read & write).

const COOLDOWN_MS = 2 * 60 * 1000; // op.gg no deja renovar el mismo perfil más seguido

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && pathname === '/estado') {
        return json({ ejecucion: await latestRun(env) });
      }

      if (request.method === 'POST' && pathname === '/actualizar') {
        if (!allowed.includes(origin)) return json({ error: 'origen no permitido' }, 403);

        const run = await latestRun(env);
        if (run && (run.status !== 'completed' || Date.now() - Date.parse(run.creada) < COOLDOWN_MS)) {
          return json({ lanzado: false, motivo: run.status !== 'completed' ? 'en-curso' : 'reciente', ejecucion: run });
        }

        await github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, {
          method: 'POST',
          body: JSON.stringify({ ref: env.BRANCH }),
        });
        return json({ lanzado: true }, 202);
      }

      return json({ error: 'no encontrado' }, 404);
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  },
};

async function latestRun(env) {
  const data = await github(env, `/actions/workflows/${env.WORKFLOW}/runs?per_page=1`);
  const run = data.workflow_runs?.[0];
  return run ? { id: run.id, status: run.status, conclusion: run.conclusion, creada: run.created_at } : null;
}

async function github(env, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'emplumados-actualizar',
    },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  return res.status === 204 ? null : res.json();
}
