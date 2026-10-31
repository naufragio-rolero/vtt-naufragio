# Backend e integración local — Fases 1–7

Fase 7: [acceso QR, proxy de confianza, preparación y rollback](../docs/FASE7-ACCESO-QR.md). Cambios desarrollados y probados localmente; no habilitan el backend público ni modifican Pages. El acceso ocasional usa aprobación del director y las mismas sesiones/pertenencias/permisos, con identidad temporal restringida a una sala.

`npm run test:browser:qr` ejecuta la aceptación adicional QR con Edge/Firefox, emulación móvil, WebSocket/polling y PNG real de 12 MiB. Usa las mismas variables `BROWSER_TOOLS_DIR`/`PLAYWRIGHT_BROWSERS_PATH` de la guía de navegadores; opcionalmente `BROWSER_QR_REPORT` guarda solo resultados saneados. Genera dist temporal, cuentas sintéticas y servidores de loopback, y los limpia al terminar. Ejecutar después de la suite, sin pruebas pesadas concurrentes.

Para que un QR real pueda abrir la mesa sin configurar servidores en cada móvil, el alojamiento estático debe servir un `site.config.json` público válido. La plantilla propuesta es `deploy/site.config.json`; `npm run build:frontend -- --config deploy/site.config.json` prepara el artefacto para la futura API HTTPS, **sin publicarlo ni contactar con ella**. Para ensayos locales utilizar endpoints localhost y origen permitido concordante. Sin configuración publicada se muestra un error comprensible en incorporación, sin aceptar un backend suministrado por el enlace.

Validación posterior: [Windows y piloto privado ARMv7](../docs/PILOTO-PRIVADO-RASPBERRY.md). Tres clientes reales contra Raspberry, cinco minutos de estabilidad, reinicio del backend y recuperación aprobados; limpieza y rollback SSH verificados. `npm run build:frontend` genera `../dist/` solo con archivos del navegador y manifiesto; `npm run serve:dist` lo sirve en loopback. Para validar ese artefacto con los navegadores existentes, ejecutar `test:browser` con `BROWSER_USE_DIST=1`. El preflight `scripts/pilot-preflight.ps1` detiene el piloto si SSH deniega forwarding; no modifica políticas ni servicios. Los scripts `pilot-*` nuevos son herramientas de prueba controlada, no parte del servicio público ni autorización permanente.

Backend portable en JavaScript ESM para Node **22.23.4**, comprobado también con Node **24.18.0**. Usa HTTP, SQLite y criptografía integrados en Node; Socket.IO 4.8.4 es la única dependencia de ejecución de npm. No requiere instalar addons ni compilar dependencias nativas. La rama de trabajo integra el Canvas con este backend; Pages aún conserva el prototipo publicado anterior. [Guía y aceptación real de Fase 5](../docs/FASE5-FRONTEND.md).

## Preparación e inicio

Seleccionar Node 22 mediante `.nvmrc` o el gestor habitual, y trabajar dentro de `backend/`:

```text
npm ci --ignore-scripts
npm run test:serial
```

En PowerShell, para preparar el entorno y crear la primera cuenta:

```powershell
Copy-Item .env.example .env
npm run bootstrap:admin:env
npm run start:env
```

El comando de bootstrap pide usuario, contraseña y confirmación en una terminal interactiva. La contraseña no se muestra ni se acepta por argumento, variable de entorno o entrada canalizada. Solo funciona con una base sin cuentas, y vuelve a comprobar esa condición dentro de la transacción. No existe endpoint HTTP de bootstrap ni cuenta predeterminada. No ejecutar el comando en una terminal grabada o compartida. No versionar `.env`, bases, backups ni credenciales.

`npm start` y `npm run bootstrap:admin` usan el entorno del proceso; las variantes `:env` cargan `.env`. **Usar la misma configuración y ruta SQLite para bootstrap y servicio.** No iniciar sesión pasando contraseñas en comandos de shell; el formulario integrado recoge la contraseña sin persistirla.

Por defecto escucha en `http://127.0.0.1:3400`. `/health` indica salud del proceso y capacidades, sin detalles del host; no verifica disponibilidad exterior ni una sala. `createBackend(config)` no escucha al importarse y expone `listen()` y `close()`. `SIGINT`/`SIGTERM` cierran HTTP, sockets y SQLite con un plazo de cinco segundos en el ejecutable. Los errores de arranque terminan con código 1 y un mensaje fijo sin valores del entorno.

## SQLite y contraseñas

La base contiene `users`, `sessions`, `signup_invitations`, `role_labels`, `rooms`, `room_codes`, `room_memberships`, `room_invitations`, `room_authority` y `token_assignments`; desde F7 añade `room_admissions`, `guest_requests` y `guest_accounts`. Guarda identidad, propietarios, pertenencias y permisos, además de clave pública/revisión/hash para verificar continuidad del estado del director. No persiste instantáneas, movimientos, coordenadas ni claves privadas. El esquema 4 migra automáticamente desde versiones anteriores, en transacciones por versión, con tablas estrictas, claves foráneas y `BEGIN IMMEDIATE`. Las consultas usan parámetros. El archivo y su directorio se crean con permisos POSIX 0600/0700; en Windows hay que proteger además la carpeta mediante ACL del propietario. En producción la base no debe estar en un directorio publicado.

Se usa `node:sqlite` incluido en Node; en Node 22 su API emite un aviso experimental. No se emplean opciones exclusivas de Node 24. WAL y `synchronous=FULL` permiten durabilidad; respaldar solo el archivo principal mientras hay escrituras puede perder datos, por lo que se incorpora `npm run backup -- <origen.sqlite> <destino-nuevo.sqlite>` con backup online e integridad; procedimiento privado de recuperación en Fase 7. Una versión de esquema desconocida impide arrancar. Operación prevista: un único proceso backend, no un clúster.

Se ha elegido **scrypt de `node:crypto`**, disponible en Node 22, para evitar addons Argon2 y problemas de compilación/ABI en ARMv7. Parámetros fijos: **N=32768, r=8, p=3**, sal aleatoria de 16 bytes y resultado de 64 bytes; el formato guarda algoritmo y parámetros. Este perfil consume aproximadamente 32 MiB por derivación y figura entre las alternativas de OWASP. `maxmem` se limita a 48 MiB. Hay una sola derivación activa y hasta cuatro en espera; al llenarse la cola se responde 503. Se usa `timingSafeEqual` y una derivación de coste equivalente para cuentas inexistentes. Las contraseñas nuevas requieren 15–128 puntos de código Unicode y hasta 512 bytes UTF-8; se preservan espacios y no se truncan.

Referencias: [OWASP, perfiles de scrypt](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt), [Node 22, crypto.scrypt](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [SQLite integrado en Node](https://nodejs.org/api/sqlite.html). La [validación controlada ARMv7](../docs/VALIDACION-ARMV7.md) midió aproximadamente 1,6 s por hash/verificación y 101,15 MiB de RSS máximo del diagnóstico completo. Antes de producción faltan carga concurrente/sostenida y plan de actualización de Node 22.

## Sesiones, usuarios e invitaciones

Las sesiones son tokens opacos `sess_…` con 256 bits aleatorios. Se devuelven en el cuerpo JSON del login y se envían únicamente mediante `Authorization: Bearer …`. Guardar el token de cuenta solo en memoria; los invitados temporales usan sessionStorage de la pestaña para recuperar su admisión tras recarga; no introducirlo en URLs, localStorage, ficheros de configuración o logs. No se usan cookies ni JWT, ni hace falta una clave de firma del servicio para sesiones. La clave local de continuidad de partida descrita más abajo es independiente de la sesión. SQLite conserva únicamente SHA-256 del token. La sesión tiene caducidad absoluta, sin renovación automática; se admiten hasta cinco sesiones activas por cuenta.

Cada petición consulta la sesión y el rol actual. Logout revoca la sesión actual; logout-all, cambio de contraseña y cambio administrativo de cuenta revocan las sesiones correspondientes. El administrador también puede revocar sesiones de otra cuenta. Desactivar o cambiar el rol de un emisor revoca sus invitaciones pendientes. No se puede desactivar ni degradar al último administrador activo. La creación administrativa vuelve a comprobar la sesión después del hash; la primera cuenta y el consumo de una invitación se verifican de nuevo dentro de la transacción.

El administrador puede provisionar cuentas `admin`, `director` y `user`. Los directores solo emiten invitaciones de alta ordinaria. Una invitación lleva prefijo `signup_…`, 256 bits aleatorios, una caducidad y un único uso. El token solo se muestra en la respuesta de emisión; los listados no incluyen token ni hash. Compartirlo por un canal privado y enviarlo en el cuerpo del registro. No se construyen enlaces con tokens en la URL. La validación pública habilita el formulario integrado de alta; el registro vuelve a validar antes de consumirla. Un intento fallido de crear cuenta no consume la invitación. No se recibe una sesión ni acceso a partidas por registrarse.

Invitaciones de alta y códigos de partida son independientes. Una cuenta nueva necesita además una invitación nominativa de partida y su código vigente para adquirir pertenencia. Expiradas, revocadas, usadas o con emisor sin permiso producen el mismo error de invitación de alta.

## Contrato HTTP

Los cuerpos JSON son estrictos: se rechazan campos desconocidos. Los nombres de usuario tienen 3–32 caracteres ASCII (`a-z`, dígitos, punto, guion y guion bajo; primero alfanumérico) y se almacenan en minúsculas. Los identificadores de cuenta/invitación son UUID. Las rutas protegidas exigen Bearer; sin sesión devuelven 401 y con rol insuficiente 403.

| Ruta | Acceso y cuerpo | Resultado |
| --- | --- | --- |
| `GET /health` | Público | Salud, fase 4; autenticación, salas y eventos de tokens disponibles, `gameEvents=true`. |
| `POST /auth/login` | Público: `username`, `password` | 200: `token`, `expiresAt`, `user`. Fallo uniforme 401 para contraseña incorrecta, cuenta ausente o desactivada. |
| `GET /auth/me` | Sesión | 200: `user` con `id`, `username`, `role`, `disabled`; sin hash. |
| `POST /auth/logout`, `/auth/logout-all` | Sesión; objeto vacío | 204. |
| `POST /auth/password` | Sesión: `currentPassword`, `newPassword` | 204 y revocación de todas las sesiones propias; exige volver a iniciar sesión. |
| `GET /users` | Administrador | Listado de hasta 1000 cuentas, sin hashes. |
| `POST /users` | Administrador: `username`, `password`, `role` | 201: `user`. |
| `PATCH /users/:id` | Administrador: `role` y/o `disabled` booleano | 200: `user`; revoca sesiones e invitaciones pendientes del afectado. |
| `POST /users/:id/revoke-sessions` | Administrador; objeto vacío | 204. |
| `POST /invitations` | Administrador/director: objeto vacío u `expiresInSeconds` | 201: `invitation` con ID, token, expiración, `kind=account_signup` y `role=user`. |
| `GET /invitations` | Director: propias; administrador: todas | Hasta 1000 metadatos, sin tokens/hashes. |
| `POST /invitations/:id/revoke` | Emisor o administrador; objeto vacío | 204; no revela invitaciones ajenas al director. |
| `POST /auth/invitations/validate` | Público: `token` | 200 con validez, tipo, rol ordinario y caducidad; fallo 400 `INVALID_INVITATION`. |
| `POST /auth/register` | Invitación válida: `username`, `password`, `invitationToken` | 201: `user`, siempre ordinario. No admite `role` ni permisos. |
| `GET /roles` | Público | Etiquetas visibles de roles. |
| `PUT /roles` | Administrador: `admin`, `director`, `user`, etiquetas de 1–40 caracteres | Etiquetas actualizadas; los IDs/permisos permanecen estables. |
| `POST /resources` | Perfil de dirección | 501; subida todavía no implementada. Usuario ordinario y administrador sin dirección reciben 403. |

Los errores HTTP son `{ "error": { "code": "..." } }`; las respuestas no incluyen trazas ni valores de entrada. Los logs de aplicación solo emiten códigos fijos. 404/405 se usan para rutas/métodos no admitidos; 409 para conflicto de usuario o último administrador; 429 para límites de intentos/cuota; 503 cuando no hay capacidad de hash. Para futuros clientes se necesita un recolector privado de contraseña y memoria de sesión, no ejemplos de credenciales en scripts.

## Permisos y Socket.IO

Los IDs internos son `admin`, `director`, `user`; los nombres visibles se leen de SQLite. Solo el administrador modifica etiquetas. La configuración pública servida en `/settings/site.config.json` incorpora esas etiquetas efectivas. El administrador técnico no obtiene autoridad sobre partidas por su rol; utiliza un perfil de dirección separado cuando sea necesario.

`src/auth/permissions.js` aplica denegación por defecto. Entrar exige pertenencia autorizada comprobada por `src/rooms/service.js`. Los flags `moveAssignedTokens` y `diceAllowed` empiezan en `false` y solo el propietario puede cambiarlos. Un movimiento de jugador exige además asignación explícita del token y director verificado conectado; conceder el flag no permite mover cualquier token. La dirección verificada puede mover todos los tokens de su sala. Ese contexto se obtiene del servidor antes de retransmitir y antes de confirmar. Todavía no hay tiradas, mapas ni recursos.

El namespace `/` exige exactamente `handshake.auth = {token, roomId}`. Valida identidad actual, cuenta activa, pertenencia y autoridad del propietario antes de unirse al canal interno de partida; sesión inválida produce `UNAUTHENTICATED` y partida inexistente/no autorizada `ROOM_ACCESS_DENIED`. Los campos adicionales se rechazan. Un socket pertenece a una única partida; otra partida requiere una nueva conexión autorizada. No se sirven bundles de cliente ni se activa recuperación automática de eventos. El namespace técnico `/diagnostics` conserva el ping versionado de Fase 1, solo cuando se habilita explícitamente fuera de producción.

Contrato de presencia:

| Dirección / evento | Cuerpo |
| --- | --- |
| Cliente → servidor, `room:presence:get` | Exactamente `{version:1}`. Ack `{ok:true,presence}` o `{ok:false,error:{code}}`. |
| Servidor → miembros de la misma partida, `room:presence` | `{version:1,roomId,ownerId,state,participants}`; `state` es `active` o `waiting`; participantes `{id,username,role}` con papel local `director`/`participant`. |
| Servidor → conexión antigua del mismo propietario, `room:replaced` | `{version:1,roomId}`, seguido de desconexión. |

El cliente presenta `waiting` como «En espera del máster». `active` requiere propietario conectado **y prueba válida del estado local**. El director reconectado sustituye a su socket anterior solo después de esa prueba; pestañas ordinarias se deduplican por cuenta. Cada evento consulta la autorización; los cambios de sesión/cuenta/pertenencia revisan inmediatamente las conexiones. Hay temporizadores de expiración y barrido cada segundo para cambios administrativos externos. Tras reiniciar se necesita probar de nuevo el estado, no basta conectarse. Solo se admiten presencia y los eventos de tokens siguientes; imágenes, mapas, chat, dados o emisiones falsificadas del servidor reciben `EVENT_NOT_AVAILABLE`. Un exceso de frecuencia desconecta.

## Contrato de sincronización de tokens

Todos los mensajes usan exactamente los campos indicados, incluyendo `version:1` y `roomId` igual al del handshake. IDs de evento, estado, token, sincronización y época son UUID v4. No se acepta `actorId`, rol, permisos o asignaciones aportados en solicitudes de movimiento. El backend añade la identidad al retransmitir. Los acks son `{ok:true,...resultado}` o `{ok:false,error:{code}}`.

| Cliente → servidor | Campos adicionales | Acceso y resultado |
| --- | --- | --- |
| `authority:claim` | `challenge`, `snapshot`, `publicKey`, `signature` | Propietario: prueba de estado/dispositivo; ack `epoch`, `revision`. |
| `token:assign` | `epoch`, `eventId`, `tokenId`, `assignmentVersion`, `userIds` | Director verificado: reemplaza asignaciones por lista de miembros activos; ack siguiente `assignmentVersion`. Versión inicial 0 por token/época. |
| `token:move:request` | `epoch`, `eventId`, `baseRevision`, `tokenId`, `tokenVersion`, `position:{x,y}` | Miembro autorizado: ack `status=pending`, ID; duplicados devuelven resultado resuelto. Solo se retransmite al director. |
| `token:move:accept` | `epoch`, `eventId`, `revision`, `stateDigest` | Socket del director verificado: revisión siguiente y resumen del candidato guardado localmente. Ack `status=committed` y `movement`, o resultado rechazado previo. |
| `token:move:reject` | `epoch`, `eventId`, `reason:"DIRECTOR_REJECTED"` | Director verificado; ack `status=rejected`, motivo y revisión sin modificar estado. |
| `tokens:sync:request` | `epoch`, `eventId` | Miembro: pide instantánea al director; ack `status=pending`, `syncId`. |
| `tokens:sync:provide` | `epoch`, `syncId`, `snapshot` | Director verificado: valida contra el punto actual y entrega únicamente al solicitante. |

| Servidor → cliente | Contenido |
| --- | --- |
| `authority:challenge` | Solo propietario: `version`, `roomId`, `challenge`, `expected` nulo o `{stateId,revision,digest}`. |
| `room:authority` | Miembros: `version`, `roomId`, `state` (`active`/`waiting`), `epoch` o nulo, `revision` o nula. |
| `token:move:requested` | Solo director verificado: solicitud validada e `actorId` calculado por el servidor. |
| `token:move:committed` | Solo miembros actuales: `version`, `roomId`, `epoch`, `eventId`, `actorId`, `revision`, `tokenId`, `tokenVersion`, `position`. |
| `token:move:rejected` | Solicitante y director: `version`, `roomId`, `epoch`, `eventId`, `status`, `reason`, `revision`. |
| `tokens:sync:requested` | Solo director: `version`, `roomId`, `epoch`, `syncId`. |
| `tokens:snapshot` | Miembros al validar autoridad o solicitante al sincronizar: `version`, `roomId`, `epoch`, `snapshot`. |

Una instantánea tiene `{stateId,revision,tokens:[{id,tokenVersion,x,y}]}`: hasta 64 tokens públicos, versiones/revisión enteras seguras no negativas, coordenadas finitas entre −1 000 000 y 1 000 000. Primer estado con revisión y versiones 0. El conjunto inicial permanece fijo en esta fase. Solo se persisten las asignaciones como permisos; no las posiciones ni instancias. Cada solicitud dura hasta 10 s; hasta 128 resultados/propuestas por sala, resultados durante 60 s; hasta 32 sincronizaciones pendientes de 10 s y 32 usuarios por asignación. La frecuencia global de eventos continúa limitada.

`baseRevision` debe coincidir al solicitar y `tokenVersion` debe seguir vigente al confirmar. Una propuesta pendiente bloquea ese token; propuestas de tokens distintos pueden confirmarse en secuencia, asignando revisiones globales consecutivas. Un ID reutilizado con otro contenido produce `EVENT_ID_REUSED`; versiones antiguas, `STALE_MOVE`/`STALE_EPOCH`; conflicto pendiente, `TOKEN_BUSY`; sin director probado, `DIRECTOR_NOT_READY`. Tras un rechazo no se confirma esa propuesta; el jugador conserva/restaura el último estado confirmado y reintenta con nuevo ID cuando corresponda. No se aplica movimiento optimista como estado oficial.

### Cliente separado y continuidad del director

`client/token-client.js` ofrece `createTokenClient(socket,{roomId,director,store,initialTokens,acceptMove,onChange})`, métodos `move()`, `assign()`, `sync()`, `close()` y estado observable. El consumidor proporciona un socket autenticado y cerrado inicialmente. Registrar el cliente antes de conectarlo; solo dirección necesita `store`. `initialTokens` se usa exclusivamente al establecer la primera autoridad de una sala sin punto de control. `frontend/multiplayer.js` integra este cliente con el tablero; el servicio de API no publica el código del frontend.

El backend fija una clave pública ECDSA P-256 y un resumen SHA-256 al crear el primer estado. Al reconectar exige instantánea coincidente y firma nueva del reto, ligada a sala/ID/revisión/resumen; `publicKey` es JWK público exacto `{kty:"EC",crv:"P-256",x,y}` y `signature` es ECDSA IEEE P1363 de 64 bytes en base64url sin padding. El formato canónico y la firma se comparten entre Node y navegador. Nunca se transmite la clave privada.

El cliente guarda un diario `current`/`staged` antes de aceptar, y lo consolida al recibir confirmación. Tras un fallo compara ambos candidatos con el resumen confirmado. `client/indexeddb-store.js` proporciona persistencia por sala y exclusión Web Locks entre pestañas; resuelve escrituras en `transaction.oncomplete`, con durabilidad `strict`. Un almacén alternativo debe garantizar guardado durable y acceso exclusivo. Además de tests sintéticos/fallos, Fase 5 verifica el adaptador, recarga, nuevo login y segunda pestaña en Firefox y Edge reales.

La integración añade `tokens:permissions:get` con `{version:1,roomId}` y ack `{ok:true,permissions}`, más el evento privado `tokens:permissions` con `{version:1,roomId,permissions}`. Se revalidan sesión y pertenencia aun en espera. Solo se entregan asignaciones propias al participante; el propietario también recibe las asignaciones de la sala y sus versiones por época. No cambia el contrato de movimientos; esta ampliación permite que la interfaz adapte controles sin convertirse en autoridad de permisos. Véase el detalle en el informe de Fase 5.

Perder los datos locales o la clave deja la sala en espera; iniciar sesión desde otro dispositivo no recupera IndexedDB. No existe reset, transferencia automática ni respaldo de contenido en el backend. La clave del diario no se guarda en configuración pública, sesión, URL, logs, SQLite ni exportaciones públicas. Véanse [método, pruebas y límites](../docs/FASE4-BACKEND.md).

## Contrato de partidas

Todas las rutas exigen Bearer. «Propietario» exige tanto rol actual `director` como propiedad persistida; los otros directores reciben 404 y los perfiles sin dirección, 403. Identificadores UUID, nombres de 1–80 caracteres sin controles, cuerpos estrictos y consultas sin parámetros URL.

| Ruta | Acceso y cuerpo | Resultado |
| --- | --- | --- |
| `POST /rooms` | Director: `{name}` | 201: `{room,admissionCode}`; sala `{id,ownerId,name,createdAt}`, código `{code,expiresAt}`. |
| `GET /rooms` | Sesión | `{rooms}`: solo pertenencias activas, sin códigos. |
| `GET /rooms/:id` | Miembro activo | `{room,permissions,isOwner}`. Sin acceso: 404 uniforme. |
| `POST /rooms/:id/code/rotate` | Propietario: `{}` | `{admissionCode}` nuevo; revoca el anterior. |
| `POST /rooms/:id/code/revoke` | Propietario: `{}` | 204; impide nuevas admisiones. |
| `POST /rooms/:id/invitations` | Propietario: `{userId,permissions?,expiresInSeconds?}` | 201: `{invitation}` nominativa `kind=room_membership`. Reemplaza invitación pendiente del mismo destinatario. |
| `GET /room-invitations` | Sesión | `{invitations}` pendientes propias, sin código ni token de alta. |
| `POST /rooms/:id/invitations/:invitationId/revoke` | Propietario: `{}` | 204. |
| `POST /rooms/join` | Sesión: `{code}` | `{room,permissions,isOwner}`; exige código e invitación propia válidos para nueva pertenencia. Repetir como miembro activo es idempotente con código vigente. |
| `GET /rooms/:id/members` | Propietario | `{members}` con `userId`, `username`, `permissions`. |
| `PATCH /rooms/:id/members/:userId` | Propietario: `{permissions}` | `{userId,permissions}`; modificación parcial de flags booleanos. |
| `POST /rooms/:id/members/:userId/revoke` | Propietario: `{}` | 204; retira pertenencia y permisos, revoca invitaciones pendientes y desconecta de esa partida. |

`permissions` solo admite `diceAllowed` y `moveAssignedTokens`, ambos falsos por defecto; no concede roles globales ni subida de archivos. El propietario no puede revocarse ni cambiar su propia pertenencia. Invitaciones duran entre 60 s y el máximo configurado y son de un uso; aceptar no concede dirección aunque el invitado tenga ese rol global.

Los códigos tienen prefijo `room_`, 128 bits aleatorios y hash SHA-256 en SQLite, comprobado contra valores históricos para no reutilizarlos. Solo se muestran al crearlos/rotarlos: compartirlos en privado, enviarlos en JSON y no guardarlos en URLs ni logs. Caducar/revocar el código no retira pertenencias ya concedidas: para expulsar se usa la ruta de revocación del miembro. Código inválido, ausencia de invitación o propietario desactivado/sin dirección producen el mismo 404 `ROOM_ACCESS_DENIED`.

## Entorno, límites y configuración pública

Configuración de desarrollo: `HOST=127.0.0.1`, `PORT=3400`, `NODE_ENV=development`, `SOCKET_PATH=/socket.io`, `ALLOWED_ORIGINS` exactos, `MAX_BODY_BYTES=16384`, `MAX_MESSAGE_BYTES=65536`, `RATE_WINDOW_MS=60000`, `HTTP_RATE_LIMIT=120`, `HANDSHAKE_RATE_LIMIT=20`, `EVENT_RATE_LIMIT=120`, `CONNECTION_LIMIT=32`, `ENABLE_DIAGNOSTICS=false`. Fase 5 eleva el presupuesto de eventos de 30 a 120/min para solicitudes/aceptaciones y controles, manteniendo agregación por gesto, una solicitud propia pendiente y las demás cotas. Los rangos se validan en `src/config.js` y se ejemplifican en `.env.example`.

| Variable nueva | Valor por defecto | Regla |
| --- | --- | --- |
| `DATABASE_PATH` | `backend/data/naufragio.sqlite`, relativo al módulo; `:memory:` en tests | Ruta configurable; un valor relativo del entorno se resuelve desde el directorio de ejecución. Memoria prohibida en producción. |
| `AUTH_RATE_LIMIT` | `10` | 1–100 intentos por peer y por nombre de cuenta. |
| `AUTH_WINDOW_MS` | `300000` | Ventana de 100–3600000 ms. |
| `SESSION_TTL_SECONDS` | `1800` | 60–3600 segundos, caducidad absoluta. |
| `INVITATION_TTL_SECONDS` | `86400` | 60–604800 segundos; máximo de duración que un emisor puede solicitar. |
| `ROOM_CODE_TTL_SECONDS` | `86400` | 60–604800 segundos para códigos de admisión. |
| `ROOM_INVITATION_TTL_SECONDS` | `86400` | 60–604800 segundos; máximo de invitaciones nominativas de partida. |
| `ROOM_JOIN_RATE_LIMIT` | `10` | 1–100 intentos de admisión por cuenta y peer durante `AUTH_WINDOW_MS`. |

Los límites de intentos se aplican al login por peer y por nombre normalizado, y a registro/validación de invitación/cambio de contraseña/provisión por peer. La admisión a partida se limita por cuenta y peer. Incluyen intentos correctos e incorrectos. Se mantienen en memoria acotada y caducan; reiniciar el proceso los reinicia. Una cuenta puede tener hasta cinco sesiones; un emisor, 50 invitaciones de alta activas; un director, 100 partidas; una partida, 100 invitaciones pendientes. En modo directo se ignoran cabeceras reenviadas; detrás de Apache F7 incorpora un modo explícito de confianza con loopback, secreto privado y cabeceras saneadas. Cada IP validada mantiene su propio límite. Orígenes se comprueban en HTTP, polling y WebSocket; CORS nunca sustituye la sesión. Producción exige orígenes HTTPS y rechaza diagnóstico.

`/settings/` permite revisar endpoints y preparar/descargar el JSON público sin escribir configuración global. `site.config.schema.json` y `site-config.js` comprueban campos, URLs HTTPS/WSS, localhost explícito de desarrollo y rutas. La comprobación de salud requiere confirmación del destino efectivo, omite credenciales y redirecciones, y tiene timeout. Las etiquetas se administran mediante `PUT /roles`, no por modificar un fichero local del cliente.

```text
npm run validate:site -- public/site.config.example.json
```

## Validación y siguientes fases

`npm run test:serial` ejecuta pruebas locales con contraseñas/tokens aleatorios de pruebas, SQLite temporal o en memoria, HTTP y Socket.IO en loopback, incluido un director y dos jugadores que convergen en el mismo estado. Véanse [resultados y límites de Fase 4](../docs/FASE4-BACKEND.md) e informes históricos de [Fase 3](../docs/FASE3-BACKEND.md) y [Fase 2](../docs/FASE2-BACKEND.md). No se crean cuentas reales en la base de desarrollo durante los tests. La prueba remota serial anterior corresponde a Fase 2, descrita en [VALIDACION-ARMV7.md](../docs/VALIDACION-ARMV7.md).

`npm run frontend` sirve el frontend con lista pública explícita en loopback:8080; no expone `.env`, DB ni `.git`. La pantalla integrada permite login/alta, provisión administrativa de dirección, salas, invitaciones, asignaciones y Canvas sincronizado. La [Fase 5](../docs/FASE5-FRONTEND.md) incluye comandos de Windows y `npm run test:browser` para la aceptación opcional con herramientas temporales. No se han añadido dependencias de producción.

Mapas/retratos compartidos están implementados en F6 y QR/backup en F7. Siguen pendientes exportación/importación, publicación, recuperación de cuentas/diario, retención/paginación, carga sostenida ARMv7 y runtime posterior a Node 22. No se despliega backend ni se modifican Apache, Heaven's Gate o la configuración/publicación de Pages.


## Fase 6 — Mapa activo y retratos compartidos (rama de desarrollo)

El director puede distribuir el mapa activo y los retratos públicos de los tokens de la sala. Los blobs originales permanecen en IndexedDB del director; el backend únicamente retransmite fragmentos acotados con SHA-256, sin persistencia de recursos. El modo local no se modifica. El cliente permite cambios de mapa, nombre, color, tamaño y retrato de los tokens iniciales, sin crear ni borrar tokens durante la sesión.

Consultar [Fase 6 y protocolo de recursos](../docs/FASE6-RECURSOS.md) para límites, aislamiento entre salas y procedimiento de pruebas. Las regresiones locales y los límites de despliegue de la rama actual se documentan en Fase 7; no confundirlos con una validación pública WSS.
