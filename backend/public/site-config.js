const fields = ['schemaVersion', 'siteName', 'apiBaseUrl', 'realtimeBaseUrl', 'socketPath', 'roleLabels'];
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function validateSiteConfig(value, { development = false } = {}) {
  const invalid = field => { throw new Error(`Configuración no válida: ${field}`); };
  if (!exactKeys(value, fields)) invalid('campos');
  if (value.schemaVersion !== 1) invalid('schemaVersion');
  if (!text(value.siteName, 80)) invalid('siteName');
  for (const field of ['apiBaseUrl', 'realtimeBaseUrl']) {
    if (!text(value[field], 2048) || !/^(https?|wss?):\/\/[^/\s]+(?:\/[^\s]*)?$/.test(value[field])) invalid(field);
    let url;
    try { url = new URL(value[field]); } catch { invalid(field); }
    const secure = field === 'apiBaseUrl' ? ['https:'] : ['https:', 'wss:'];
    const insecure = field === 'apiBaseUrl' ? ['http:'] : ['http:', 'ws:'];
    if (url.username || url.password || /[?#\s\\]/.test(value[field]) ||
        !(secure.includes(url.protocol) || (development && localHosts.has(url.hostname) && insecure.includes(url.protocol)))) invalid(field);
  }
  if (typeof value.socketPath !== 'string' || value.socketPath.length > 200 ||
      !/^\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value.socketPath) ||
      /^\/(health|settings|auth|rooms|invitations|users|roles|resources)(\/|$)/.test(value.socketPath) ||
      value.socketPath.split('/').some(segment => segment === '.' || segment === '..')) invalid('socketPath');
  if (!exactKeys(value.roleLabels, ['admin', 'director', 'user'])) invalid('roleLabels');
  for (const label of Object.values(value.roleLabels)) if (!text(label, 40)) invalid('roleLabels');
  return {
    schemaVersion: 1, siteName: value.siteName,
    apiBaseUrl: value.apiBaseUrl, realtimeBaseUrl: value.realtimeBaseUrl, socketPath: value.socketPath,
    roleLabels: { admin: value.roleLabels.admin, director: value.roleLabels.director, user: value.roleLabels.user }
  };
}
