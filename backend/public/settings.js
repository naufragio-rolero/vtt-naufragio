import { validateSiteConfig } from './site-config.js';

const get = id => document.getElementById(id);
const status = message => { get('status').textContent = message; };
function current() {
  return validateSiteConfig({
    schemaVersion: 1,
    ...Object.fromEntries(['siteName', 'apiBaseUrl', 'realtimeBaseUrl', 'socketPath'].map(key => [key, get(key).value])),
    roleLabels: Object.fromEntries(['admin', 'director', 'user'].map(key => [key, get(key).value]))
  }, { development: get('development').checked });
}
function showDestination() {
  try {
    const config = current();
    const api = new URL(config.apiBaseUrl);
    const realtime = new URL(config.realtimeBaseUrl);
    get('destination').textContent = `Origen API: ${api.origin} · URL: ${api.href} · Origen tiempo real: ${realtime.origin} · Ruta: ${config.socketPath}`;
    return config;
  } catch (error) { get('destination').textContent = error.message; throw error; }
}
for (const input of document.querySelectorAll('input:not(#confirm)')) {
  input.addEventListener('input', () => {
    get('confirm').checked = false;
    try { showDestination(); } catch { /* Inline validation message already shown. */ }
  });
}
get('validate').addEventListener('click', () => {
  try { showDestination(); status('Configuración válida.'); } catch (error) { status(error.message); }
});
get('download').addEventListener('click', () => {
  try {
    const config = showDestination();
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'site.config.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('JSON preparado para publicar mediante el proceso de despliegue.');
  } catch (error) { status(error.message); }
});
get('check').addEventListener('click', async () => {
  try {
    const config = showDestination();
    if (!get('confirm').checked) throw new Error('Revisa el destino y marca la confirmación.');
    get('check').disabled = true;
    status('Comprobando salud de la API…');
    const url = `${config.apiBaseUrl.replace(/\/$/, '')}/health`;
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok || body.status !== 'ok' || body.service !== 'naufragio-vtt' || body.protocolVersion !== 1) throw new Error();
    status('API accesible. Las capacidades disponibles se habilitan por fases.');
  } catch { status('No se pudo confirmar la API. Revisa el destino, la confirmación, CORS y la conexión.'); }
  finally { get('check').disabled = false; }
});
try {
  const response = await fetch('./site.config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  const value = await response.json();
  const usesLocal = [value.apiBaseUrl, value.realtimeBaseUrl].some(url => /^(http|ws):/.test(url));
  get('development').checked = usesLocal;
  const config = validateSiteConfig(value, { development: usesLocal });
  for (const key of ['siteName', 'apiBaseUrl', 'realtimeBaseUrl', 'socketPath']) get(key).value = config[key];
  for (const key of ['admin', 'director', 'user']) get(key).value = config.roleLabels[key];
  showDestination();
  status('Configuración cargada (o plantilla si aún no hay fichero local). Revisa los destinos antes de comprobar.');
} catch { status('No se pudo cargar la plantilla pública.'); }
