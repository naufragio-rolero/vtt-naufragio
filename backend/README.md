# Backend local — Fase 1

Base portable en JavaScript ESM para Node **22.23.4**, con compatibilidad comprobada en Node **24.18.0**. Solo necesita Node y npm; no requiere Raspberry, Apache, Docker, base de datos ni compilación nativa. Una dependencia de ejecución: Socket.IO 4.8.4, fijada junto con sus transitivas en `package-lock.json`. El cliente Socket.IO solo es dependencia de pruebas.

## Instalar y ejecutar en desarrollo

Seleccionar Node 22 con el gestor habitual (`.nvmrc` fija 22.23.4), o usar un ejecutable portable de esa versión. Desde la raíz:

```text
cd backend
npm ci --ignore-scripts
npm test
npm start
```

Por defecto escucha en `http://127.0.0.1:3400`. El puerto es un valor de desarrollo, no una reserva en ningún servidor. `GET /health` devuelve salud del proceso y capacidades de esta fase. No certifica disponibilidad de cuentas, partidas o persistencia. El módulo `src/server.js` exporta `createBackend(config)` sin abrir puertos al importarse; pruebas pueden usar `listen(0)` y `close()`.

Para cargar variables desde fichero local, copiar `.env.example` a `.env` (en PowerShell: `Copy-Item .env.example .env`) y ejecutar `npm run start:env`. `npm start` usa las variables del proceso y no carga `.env` automáticamente. En un supervisor futuro, proporcionar el entorno por su mecanismo protegido. No registrar su contenido ni versionar el fichero real.

`SIGINT` y `SIGTERM` cierran Socket.IO y HTTP, con plazo máximo de cinco segundos en el ejecutable. Errores de arranque producen código de salida 1 y un código genérico. Ningún log de la aplicación contiene payloads, cabeceras, identidad, rutas de archivos o valores del entorno.

## Variables de entorno

| Variable | Valor por defecto | Regla |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` o `production`. |
| `HOST` | `127.0.0.1` | IP de enlace o `localhost`. Cualquier enlace adicional requiere decisión de despliegue. |
| `PORT` | `3400` | Entero 1–65535. |
| `ALLOWED_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | Orígenes exactos, separados por coma, sin rutas ni barra final. En producción es obligatorio y solo acepta HTTPS; fuera de producción permite HTTP únicamente en localhost/loopback. Sin comodines. |
| `SOCKET_PATH` | `/socket.io` | Ruta absoluta, configurable para un proxy; no acepta query, traversal ni colisión con rutas HTTP reservadas. |
| `MAX_BODY_BYTES` | `16384` | 256–1048576 bytes para JSON de las rutas POST reservadas, también con transferencia fragmentada. |
| `MAX_MESSAGE_BYTES` | `16384` | 256–1048576 bytes por paquete Engine.IO/payload WebSocket. |
| `RATE_WINDOW_MS` | `60000` | 100–3600000 ms. Ventana de límites de frecuencia. |
| `HTTP_RATE_LIMIT` | `120` | 1–10000 peticiones por peer y ventana. |
| `HANDSHAKE_RATE_LIMIT` | `20` | 1–1000 intentos aceptados de transporte por peer y ventana. |
| `EVENT_RATE_LIMIT` | `30` | 1–1000 eventos por conexión de diagnóstico y ventana; se desconecta al excederlo. |
| `CONNECTION_LIMIT` | `32` | 1–1000 transportes Engine.IO simultáneos, incluidas reservas de handshake. |
| `ENABLE_DIAGNOSTICS` | `false` | `true` habilita el namespace de diagnóstico, exclusivamente fuera de producción. |

Los límites por peer usan la dirección del socket; `X-Forwarded-For` no se confía. Detrás de un proxy todos sus clientes comparten ese presupuesto. Una futura integración deberá acordar límites en el proxy y cualquier confianza explícita en sus cabeceras. Las tablas de frecuencia están acotadas a 4096 peers y eliminan entradas caducadas. En esta fase no hay secrets de aplicación que provisionar.

## HTTP y Socket.IO

| Superficie | Comportamiento |
| --- | --- |
| `GET /health` | 200, JSON `status`, `service`, versión de protocolo, fase y capacidades. Sin detalles del host. |
| `GET /settings/` | Herramienta local para preparar configuración pública; `/settings` redirige conservando el prefijo del despliegue. |
| `POST /auth/login`, `/auth/logout`, `/auth/register`, `/invitations`, `/rooms`, `/rooms/join`; `GET /rooms` | Contratos reservados. Responden 501 `FEATURE_NOT_AVAILABLE`. Los POST exigen un objeto JSON válido y acotado antes de devolver ese resultado. No crean cuentas, sesiones, invitaciones ni partidas. |
| Otras rutas/métodos | 404 o 405 con `Allow`. No se sirven archivos arbitrarios del repositorio. |
| Socket.IO, namespace `/` | Rechaza con `AUTH_UNAVAILABLE` incluso si el cliente envía un rol o token. No hay bypass de autenticación. |
| Socket.IO, namespace `/diagnostics` | Solo con `ENABLE_DIAGNOSTICS=true`. `system:ping` acepta exactamente `{ "version": 1, "id": "check-1" }` y confirma por ack `{ "ok": true, "version": 1, "id": "check-1" }`. No expone salas ni eventos de partida. |

Los errores HTTP usan `{ "error": { "code": "..." } }`. El diagnóstico responde a mensajes inválidos con `INVALID_MESSAGE`, eventos no disponibles con `EVENT_NOT_AVAILABLE` y excesos con `RATE_LIMITED`. El ID es una cadena de 1–64 letras ASCII, dígitos, guion o guion bajo; no se retransmite otro dato.

El control de origen se aplica tanto a HTTP como a polling y WebSocket; Socket.IO exige un `Origin` configurado incluso a clientes de pruebas no navegador. HTTP sin Origin se admite para herramientas de salud, pero no concede identidad. El control de origen nunca sustituye autenticación. No se sirve el bundle de cliente ni se habilita recuperación automática de estado o compresión WebSocket.

## Configuración pública y pantalla aislada

Abrir `/settings/`. El navegador carga `./site.config.json`, que el backend entrega desde `backend/public/site.config.json` si existe y es válido; si falta entrega `site.config.example.json`. El nombre de ejemplo `.invalid` no es un destino real. El fichero se valida antes de servirlo: campos desconocidos, incluidos secretos accidentales, producen un error genérico sin devolver su contenido.

La pantalla permite editar nombre del sitio, URLs de API/tiempo real, ruta Socket.IO y etiquetas de los IDs de rol estables `admin`, `director`, `user`. Muestra los orígenes efectivos y pide confirmarlos antes de consultar `/health`; la consulta no incluye credenciales, no sigue redirecciones y vence a los cinco segundos. Descargar el JSON solo prepara un archivo local para republicar. Editar etiquetas no cambia permisos. El botón de comprobación verifica HTTP, no la autenticación ni WebSocket.

`public/site.config.schema.json` describe la estructura; `public/site-config.js` añade la validación semántica compartida con la pantalla: HTTPS/WSS, sin usuario/contraseña, query o fragmento, rutas seguras, y HTTP/WS exclusivamente local con opción explícita de desarrollo. No cargar endpoints desde parámetros de URL. Esos artefactos se podrán reutilizar al integrar el frontend en otra fase.

```text
npm run validate:site -- public/site.config.example.json
npm run validate:site -- ruta/al/site.config.json --development
```

La interfaz del tablero, su persistencia y GitHub Pages continúan ejecutándose con los archivos actuales. La pantalla de ajustes de esta fase vive dentro del backend y todavía no está enlazada desde el tablero publicado. No hay API para guardar configuración global ni conexión automática a ningún host.

## Pruebas y pasos posteriores

`npm test` usa `node:test`, HTTP real y clientes Socket.IO en puertos loopback efímeros. No requiere credenciales ni acceso remoto. Resultados, versiones y límites verificados: [informe de Fase 1](../docs/FASE1-BACKEND.md).

La Fase 2 implementará cuentas, sesiones, invitaciones y permisos; la Fase 3, salas y presencia; la Fase 4, movimiento bajo autoridad del navegador del máster. Esta base no almacena contenido de partida, ni persiste datos ni escribe logs a disco. No reemplaza IndexedDB ni los formatos de exportación/importación exigidos para el MVP. Apache, SSL público, ARMv7 y operación en la Pi requieren una fase de despliegue posterior.
