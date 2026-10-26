export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function sendError(response, error, report = () => {}) {
  const known = error instanceof HttpError;
  if (!known) report({ code: 'INTERNAL_ERROR' });
  if (!response.headersSent) {
    response.setHeader('Connection', 'close');
    sendJson(response, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR' } });
  } else response.destroy();
}
