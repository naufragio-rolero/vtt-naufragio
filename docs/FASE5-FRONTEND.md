# Fase 5 — Integración del frontend multijugador

Rama: `feat/backend-multijugador`. Base conservada: `ffde467`. Fecha: 27 de octubre de 2026. Alcance aprobado para esta entrega: integrar el tablero existente con las Fases 1–4. **No incluye los recursos/imágenes que figuraban como Fase 5 en el plan original.** No se publica en Pages ni se conecta a la Raspberry.

## Funciones implementadas

- Se conserva el Canvas y sus herramientas locales: rejilla, zoom, desplazamiento, temas, tokens y mapa local. `app.js` expone un puente pequeño al controlador `frontend/multiplayer.js`; el tablero no se sustituye por otra aplicación.
- Configuración pública opcional `site.config.json`, relativa al sitio. Sin ella se inicia en local. La pantalla existente de ajustes se integra en un diálogo y permite descargar el JSON o aplicarlo **solo a ese navegador**. Se validan destinos y contexto localhost/HTTPS; no se aceptan cambios por URL. Antes de enviar contraseñas hay que revisar los destinos y confirmarlos. No se permite cambiar endpoints durante una sesión.
- Login/logout, expiración, formulario de alta habilitado tras validar una invitación `account_signup`, rechazo de reutilización y limpieza de contraseñas después de enviarlas. Administración puede provisionar perfiles de dirección utilizando el endpoint existente; no hay credenciales de ejemplo ni autorregistro público.
- Solo el rol interno `director` ve creación de partidas/invitaciones de alta. El propietario administra invitaciones nominativas a usuarios registrados, códigos, permisos de movimiento y asignaciones. El usuario ve sus partidas y su ID para recibir una invitación; necesita además el código al incorporarse.
- Etiquetas visibles recibidas de `/roles`, con la configuración pública como valor inicial. Los permisos siempre dependen de IDs `admin/director/user` y propiedad, nunca del texto de la etiqueta. Las etiquetas globales siguen siendo administrables con `PUT /roles`; cambiar un JSON local no cambia roles ni permisos del servidor.
- Integración directa de `backend/client/token-client.js`: el jugador propone una posición; el director valida y guarda el diario antes de aceptar; los tres tableros aplican solo posiciones confirmadas. Durante un arrastre se muestra una previsualización atenuada y se envía **una solicitud al soltar**, no una por `pointermove`. Cancelar el gesto no envía movimiento. Las flechas evitan repetición automática y hay como máximo una solicitud propia pendiente.
- Presencia, estado conectado/en espera, reconexión, errores de autorización y sincronización. El director sigue necesitando firma y estado local coincidente; una sesión nueva no recupera autoridad por sí sola.

## Datos anteriores y límite del conjunto de tokens

La mesa local continúa en `naufragio-vtt-mvp-v1` y el mapa en `naufragio-vtt-local-assets`. Entrar en una sala guarda una copia de la vista local en memoria y suspende sus escrituras: **las posiciones compartidas nunca sustituyen la mesa local**. Al salir o cerrar sesión se recupera esa mesa; al recargar, su almacenamiento permanece disponible. Un mapa cuyo blob no se encuentre conserva sus metadatos en lugar de eliminarlos automáticamente.

Crear una sala toma una **copia** de los tokens locales. Los IDs antiguos (`starter-*`, `token-*`, etc.) se convierten en UUID únicamente en esa copia, con versiones iniciales 0. No se reescriben IDs, nombres, colores, mapas o posiciones de la mesa anterior. Si hay más de 64 tokens, la operación se detiene **antes** de crear la sala; no se trunca ni elimina ninguno.

El protocolo comparte solo UUID, versión y posición. En la sala, los clientes representan los tokens con nombres genéricos T1…T64 y colores deterministas según UUID. Los nombres/colores privados del prototipo no se transmiten. Añadir, borrar, renombrar o recolorear tokens y manipular mapas se deshabilita durante la sala: el conjunto inicial permanece fijo. Los ajustes de vista en sala son personales y temporales; volver a local recupera también sus ajustes anteriores.

El diario usa el adaptador real de IndexedDB y Web Locks de Fase 4. Su clave de almacenamiento incluye API, cuenta y sala para separar instalaciones/perfiles. La clave privada y el diario nunca van a configuración pública, sesiones, URLs o backend. No se generan claves nuevas para sustituir un estado perdido de una sala ya inicializada. Si falta estado/clave, se muestra un error y no se adquiere autoridad; una mesa ya dirigida por otro socket verificado no se interrumpe por ese intento.

## Extensión mínima y justificada del backend

No se cambia el formato de movimientos, firmas, puntos de control ni la base SQLite. Para poder adaptar controles a permisos reales se añade:

| Mensaje | Acceso / contenido |
| --- | --- |
| Cliente → `tokens:permissions:get` | Exactamente `{version:1,roomId}` de su handshake; exige sesión y pertenencia, incluso en espera. Ack `{ok:true,permissions}`. |
| Servidor → `tokens:permissions` | `{version:1,roomId,permissions}`, enviado privadamente al socket al conectar y cuando cambian sus metadatos. |

Un participante recibe `isOwner`, `moveAssignedTokens` y **solo sus propios** `assignedTokenIds`. El propietario recibe también `assignments:[{tokenId,userId}]` y `assignmentVersions` de la época actual. No se entregan hashes, claves ni sesiones. Se revalida la pertenencia antes de emitir. Esta información adapta la interfaz; el backend conserva todas las comprobaciones de cada solicitud y aceptación.

El presupuesto predeterminado `EVENT_RATE_LIMIT` pasa de 30 a **120 por minuto** para acomodar solicitud/aceptación y controles de una mesa pequeña. Se mantienen límites de frames, conexiones, caducidad, pertenencia y cola. No significa transmisión continua a 120 Hz: se envía al finalizar cada gesto y se espera su resolución. Las pruebas de frecuencia con límites explícitos de las fases anteriores se conservan.

El cliente Socket.IO 4.8.4 ya fijado por el lockfile se distribuye como ESM local en `frontend/vendor/`, con licencia MIT y prueba de igualdad de bytes. No se añade una dependencia de ejecución ni un CDN. `npm run sync:browser-client` reproduce el archivo desde la dependencia instalada.

## Cómo probar desde Windows

### 1. Backend

Seleccionar Node **22.23.4** o **24.18.0** y abrir una terminal en `backend/`:

```powershell
npm ci --ignore-scripts
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
npm run bootstrap:admin:env
npm run start:env
```

El bootstrap solo se ejecuta si no existen cuentas; pide usuario y contraseña oculta. No repetirlo contra una base existente. Tanto bootstrap como servicio deben usar el mismo `.env`/`DATABASE_PATH`. No se incluyen cuentas ni contraseñas predeterminadas. El valor de desarrollo propuesto es API loopback en puerto 3400, con orígenes frontend explícitos en `ALLOWED_ORIGINS`.

### 2. Frontend y configuración

En otra terminal dentro de `backend/`:

```powershell
npm run frontend
```

Abrir `http://127.0.0.1:8080/`. Este servidor sirve únicamente los archivos públicos necesarios y escucha en loopback; deniega `.env`, `.git`, bases de datos e instrucciones SSH. No usarlo para publicar en Internet.

En **Multijugador → Configuración del sitio**:

1. Para este ejemplo local, API y tiempo real: `http://127.0.0.1:3400`; ruta `/socket.io`.
2. Marcar HTTP/WS de localhost, revisar los destinos, confirmar y pulsar **Usar en este navegador**.
3. En el acceso, confirmar los destinos e iniciar sesión con la cuenta creada mediante bootstrap.
4. Provisionar un perfil de dirección con una contraseña propia y comunicarlo por un canal privado. Cerrar la sesión administrativa y acceder con ese perfil.

Estos valores son ejemplos de Windows, no direcciones de Raspberry ni constantes del frontend. `FRONTEND_PORT` permite cambiar 8080 y `FRONTEND_BASE_PATH=/vtt/` servir una subruta; ajustar también `ALLOWED_ORIGINS` si cambia el origen. Usar siempre el mismo origen frontend al recuperar el diario (hostname, puerto y protocolo): `localhost` y `127.0.0.1` tienen almacenamiento diferente.

Para otro servidor estático o Pages se usan los mismos módulos y un `site.config.json` público en la raíz **de ese despliegue**, incluida una subruta. Copiar HTML/CSS/JS, `frontend/`, `backend/client/`, `backend/shared/` y los ajustes públicos de `backend/public/`; excluir datos, `.env`, `.git`, scripts y archivos privados. En producción frontend/API requieren HTTPS y la allowlist del backend. No se ha publicado ninguno de estos cambios.

`realtimeBaseUrl` representa origen y prefijo de despliegue; `socketPath` se añade al prefijo. Por ejemplo, base `https://ejemplo.invalid/transport` más `/socket.io` implica ruta `/transport/socket.io`. Se usa el namespace `/`; no se interpreta el prefijo como namespace. API y servicio de tiempo real pueden tener orígenes diferentes si el despliegue los autoriza.

### 3. Recorrido de tres navegadores

1. El director crea una partida con la copia de sus tokens locales y conserva el código mostrado. No compartirlo en URLs ni logs.
2. Cada jugador usa un navegador/perfil independiente, configura el mismo backend y obtiene una cuenta provisionada o mediante invitación de alta. Cada uno comparte su ID de cuenta con el director.
3. El director invita ambos IDs **a esa partida**, concede movimiento asignado y comparte el código en privado. Cada jugador se une con ese código.
4. El director actualiza participantes, asigna T1 a A y T2 a B. Se pueden seleccionar varios destinatarios de una asignación.
5. Cerrar el diálogo y arrastrar T1 desde A. Al soltar, los tres muestran la posición confirmada. B no puede mover T1. El director puede mover cualquiera.
6. Cerrar sesión en el director: los jugadores quedan **En espera del director** y no pueden mover oficialmente. Iniciar sesión de nuevo en ese mismo navegador y abrir la partida; el diario recupera la autoridad.
7. Recargar el director, volver a entrar y comprobar las mismas posiciones. Abrirla desde otra pestaña debe respetar Web Locks; un perfil sin diario no adquiere autoridad.
8. Volver a la mesa local: mapa, IDs, nombres y posiciones anteriores permanecen disponibles.

## Pruebas y evidencia

Validación realizada en Windows el 27 de octubre de 2026, con datos sintéticos y sin conectar a Raspberry:

| Ejecución | Resultado |
| --- | --- |
| `npm test`, Node 22.23.4 | **93/93**, sin fallos ni omisiones; 211,104 s. |
| `npm test`, Node 24.18.0 | **93/93**, sin fallos ni omisiones; 153,472 s. |
| Validador CLI de configuración pública, Node 22 y 24 | Válida, salida 0 en ambos. |
| Aceptación multijugador real, Node 22 y 24 | **Aprobada** en raíz y `/vtt/`, incluyendo prefijo Socket.IO `/transport`. |
| Modo local sin backend, Node 22 y 24 | **Aprobado** en Edge y Firefox; mapa/tokens y ajustes conservados tras recargar. |

Las 88 pruebas anteriores permanecen, junto con cinco nuevas: copia segura de tokens/UUID/límite de 64, distribución y licencia del cliente vendorizado, cálculo del destino Socket.IO, servidor estático con lista permitida en raíz/subruta y privacidad/actualización de permisos. Se conserva el aviso experimental de `node:sqlite`.

Motores reales: **Microsoft Edge (Chromium) 156.0.4314.42** y **Firefox 142.0.1**, ejecutados sin interfaz en perfiles temporales. En raíz dirige Edge y juegan Firefox/Edge; en subruta dirige Firefox y juegan Edge/Edge, con contextos independientes. No se afirma haber usado tres productos de navegador distintos.

En ambos recorridos se verifican login, invitaciones nominativas, entrada por código, asignaciones, un solo movimiento por arrastre, igualdad de posiciones/versiones en tres clientes, rechazo de movimiento ajeno incluso saltándose la interfaz, movimiento por dirección, espera tras logout y recuperación después de login y recarga. Las versiones finales de los dos tokens movidos por jugadores son `[1,1]`. También pasan alta por invitación/rechazo de reutilización, provisión administrativa, Web Locks entre pestañas, rechazo de otro perfil sin estado y conservación de la mesa y blob locales. No hay errores de página. El escenario local independiente comprueba arrastre, creación/borrado de tokens, tema, rejilla, zoom y mapa tras recarga sin arrancar ningún backend.

Capturas de los tableros con datos sintéticos: [raíz](evidencia-fase5/fase5-root.png) y [subruta](evidencia-fase5/fase5-subdirectory.png). No contienen contraseñas, códigos ni invitaciones; las aserciones automatizadas son la evidencia del protocolo y la persistencia.

La aceptación automatizada está en `backend/scripts/browser-integration.js`. Arranca HTTP/Socket.IO y el servidor estático en loopback/puertos efímeros, crea credenciales sintéticas aleatorias, usa perfiles aislados y cierra servidores/contextos al finalizar. No abre la base real de desarrollo ni guarda trazas con cabeceras o contraseñas.

Se utiliza Playwright **1.56.1** como herramienta temporal de pruebas, no como dependencia de producción. Reproducción opcional, desde `backend/`:

```powershell
$browserTools = Join-Path $env:TEMP 'naufragio-vtt-browser-tools'
npm.cmd install --prefix $browserTools playwright@1.56.1 --ignore-scripts --no-audit --no-fund
$env:BROWSER_TOOLS_DIR = $browserTools
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'naufragio-vtt-browser-binaries'
node (Join-Path $browserTools 'node_modules/playwright/cli.js') install firefox
npm run test:browser
```

El script utiliza Edge instalado (`channel: msedge`) y el Firefox aislado de Playwright. No usa el perfil personal del navegador. Un navegador sin interfaz ejecuta el motor real, Canvas, IndexedDB, WebCrypto y Web Locks; los screenshots no sustituyen las aserciones de estado. Si esos binarios no están disponibles, ejecutar el procedimiento manual anterior y registrar versiones, pasos, resultados y fallos; no confundirlo con una validación automatizada.

## Archivos y responsabilidades

| Archivos | Cambio |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Diálogos integrados, controles y puente Canvas; previsualización y aislamiento de la mesa local. |
| `frontend/multiplayer.js`, `board-model.js` | Sesión, salas, permisos, configuración, conversión de tokens y enlace con el cliente autoritativo. |
| `frontend/vendor/` | Socket.IO ESM fijado, licencia y reproducción. |
| `backend/public/settings.*` | Reutilización de la configuración existente en iframe con validación de origen y emisor. |
| `backend/src/rooms/token-sync.js`, `src/config.js`, `.env.example` | Metadatos privados de permisos y presupuesto de eventos; sin cambios de esquema ni posiciones persistentes. |
| `backend/scripts/`, `tests/frontend.test.js`, `tests/config.test.js` | Servidor local limitado, reproducción del cliente, aceptación real y regresión. |
| `backend/package*.json`, README e informes | Versión 0.5.0, comandos, resultados, alcance y límites. |

## Problemas encontrados y límites

- Se corrigió una carrera entre la carga asíncrona de la plantilla y los campos de configuración: permanecen deshabilitados hasta cargar y el ajuste recibido del padre se conserva. La comunicación del iframe verifica origen y ventana emisora.
- Playwright no trataba el propio `fieldset` como un control deshabilitado en una aserción. La prueba verifica ahora su propiedad `disabled` y el bloqueo efectivo del campo de usuario, manteniendo el rechazo de una invitación usada.
- La conexión usa credenciales solo en memoria y exige iniciar sesión de nuevo tras recargar. Los ajustes públicos locales sí persisten; los endpoints no se guardan junto con credenciales.
- Sigue pendiente transferir autoridad entre dispositivos, recuperar una clave perdida, sincronizar metadatos visuales de tokens, crear/borrar tokens durante una sala y transmitir mapas/imágenes. No se simula ninguna de estas funciones.
- No hay publicación, pruebas de red exterior, móvil/táctil real ni carga sostenida. Las capturas y aceptación son de escritorio en Windows. Para instalación en Raspberry faltan host/runtime futuro, origen HTTPS, proxy WSS, límites medidos, backup consistente y plan de operación del inventario. La validación ARMv7 anterior no mide esta integración.
- Las imágenes y exportaciones del MVP permanecen pendientes; esta fase prueba un tablero compartido de tokens públicos, no el MVP completo.
