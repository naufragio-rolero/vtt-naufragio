# Fase 7 — Backend detrás de Apache y acceso QR

## Diseño previo a la implementación

Base: rama `feat/backend-multijugador`, `cdff421`. Los cambios documentales previos del workspace se conservan. Esta fase se desarrolla y prueba exclusivamente en Windows: no se accede a Raspberry ni se modifica HTTPS, Apache, DNS o Pages.

No se reescriben salas, autoridad, permisos ni transporte de recursos. Las identidades temporales usan filas `users` con rol interno `user`, contraseña deliberadamente inutilizable, sesiones existentes y la misma `room_memberships`. Una tabla de identidad temporal fija su única sala y caducidad; la autenticación rechaza expresamente login por contraseña y cualquier promoción/conversión de estas identidades. Un invitado no obtiene capacidad de crear usuarios, emitir invitaciones o adquirir autoridad.

El QR identifica una ventana de admisión, no una sesión: token aleatorio de 256 bits, hash en SQLite, caducidad y revocación. La posesión solo permite solicitar acceso. Cada petición recibe una capacidad privada diferente para consultar su estado y reclamar una sesión **una sola vez**, después de aprobación del dueño de la sala. La reclamación crea la pertenencia con permisos denegados por defecto. Cerrar/revocar el QR invalida solicitudes no reclamadas; los ya admitidos se expulsan con la revocación de pertenencia existente. No se crean salas ni un namespace de juego alternativos.

El enlace utiliza un fragmento y la configuración pública relativa del despliegue, nunca un backend recibido del enlace. El fragmento se retira inmediatamente. La sesión temporal se conserva en sessionStorage de esa pestaña, con caducidad, para recargar/reconectar; no en localStorage ni en la URL. Si se pierde la capacidad antes de reclamar o se pierde la sesión, se debe solicitar otra aprobación. Los nombres son etiquetas, no pruebas de identidad; el director debe comprobar personalmente a quién admite.

El modo proxy es explícito y desactivado por defecto. Solo admite peticiones de loopback, con secreto de proxy sin valor por defecto y una única IP válida saneada por Apache. Se rechazan cabeceras duplicadas/listas y secretos incorrectos; en conexión directa se ignoran cabeceras reenviadas. Así otro proceso local o un cliente remoto no puede atribuirse direcciones por enviar X-Forwarded-For. Los límites por cuenta/conexión/sala existentes se conservan.

Se añadirán límites de solicitudes, invitados, duración y estado global, limpieza de metadatos temporales, pruebas de integración de la misma sincronización y pruebas móviles emuladas. La política de producción, instalación systemd, backup/restauración y rollback serán artefactos revisables sin aplicarlos.

## Implementación

### Identidad y admisión

Se añade la migración transaccional de esquema 3 a 4: `room_admissions`, `guest_requests` y `guest_accounts`. Solo contienen hashes de capacidades, etiquetas, vencimientos y relaciones con las tablas existentes. La contraseña de invitado es un marcador no verificable; además se rechaza explícitamente el login por contraseña. No se permite cambiar su contraseña, promoverlo, emitir invitaciones ni incorporarlo a otra sala. Tampoco puede adquirir una sala mediante un código habitual. La sesión se comprueba en HTTP, handshake y cada evento de juego; expulsar usa la revocación de pertenencia y desconexión existentes.

| Operación | Ruta | Autorización |
| --- | --- | --- |
| Generar/rotar QR | `POST /rooms/:id/admission` | Exclusivamente propietario director |
| Abrir, cerrar o revocar | `PATCH /rooms/:id/admission` | Propietario; cerrar rechaza solicitudes pendientes/aprobadas sin reclamar |
| Ver solicitudes | `GET /rooms/:id/admission` | Propietario; no devuelve capacidades privadas |
| Aprobar/rechazar | `POST /rooms/:id/admission/:requestId` | Propietario de esa misma sala |
| Solicitar | `POST /guest-requests` | Capacidad QR válida + nombre; sin sesión ni privilegios |
| Consultar/reclamar | `POST /guest-requests/status`, `/claim` | Capacidad privada de solicitud; claim aprobado y de un solo uso |

La reclamación, creación de identidad, sesión y pertenencia se realizan en una transacción. El QR admite varias solicitudes distintas mientras esté abierto; **no** es una sesión reutilizable. Robar el QR no permite reclamar la solicitud de otra persona. Un nombre repetido sigue siendo una etiqueta no autenticada: la lista muestra un identificador corto distinto para que el director elija la solicitud correcta. La aprobación requiere comprobar al participante presencialmente. No hay identidad federada ni verificación de teléfono.

Valores predeterminados: QR 1 hora (configurable 1 minuto–4 horas), solicitud 5 minutos (máximo 15), sesión temporal 30 minutos (máximo 4 horas), 16 invitados activos por sala (máximo 32), 20 nuevas solicitudes por IP/5 minutos, consulta 30/minuto por solicitud. Hay un techo global de 1000 admisiones, solicitudes e identidades temporales por tabla. Un invitado obtiene una única sesión por reclamación y conserva el límite global de 32 conexiones; se añade un límite de 4 conexiones por cuenta. Permisos de movimiento y dados iniciales: **false**; asignar un token no activa por sí solo el permiso de movimiento.

Las filas caducadas/revocadas se purgan al iniciar el servicio y antes de las operaciones de admisión; la caducidad se exige siempre aunque aún no se haya purgado una fila. La sesión expira en tiempo real mediante el mecanismo existente. No se implementa retención de historial de invitados. Una sesión cerrada o perdida exige nueva solicitud/aprobación. Si se pierde la respuesta de una reclamación ya consumida, también debe solicitarse de nuevo; no se vuelve a entregar el secreto.

### Interfaz y flujos

Acceso habitual: administrador provisiona director → invitación individual de alta → cuenta ordinaria → invitación nominativa a partida + código de sala. Continúa intacto.

Acceso temporal: director conectado → «Invitar con QR» → QR y enlace → nombre en `join.html` → espera → aprobación → entrada automática a la sala. Desde el diálogo se cierra/reabre la admisión, se rechaza, rota o revoca el QR. Los admitidos se gestionan en la lista habitual de miembros: permisos, asignación y «Retirar acceso». La presencia existente identifica los conectados.

El QR se genera localmente con `qrcode-generator@2.0.4` (MIT), fijado y copiado sin modificar en `frontend/vendor/`; no usa un servicio de terceros. `jsqr@1.4.0` decodifica el QR en pruebas y no se publica. Ambas son dependencias de desarrollo, no del backend de producción. No se añade framework.

`join.html` tiene formulario adaptable, controles de 48 px, estados en español y región de estado accesible. El QR del director incluye margen blanco y escala entera. El enlace es relativo al sitio (`/join.html` o `/vtt/join.html`) y contiene solo `#join=…`; se elimina el fragmento antes de realizar peticiones. Volver a escanear en la misma pestaña inicia una nueva solicitud. La configuración viene exclusivamente del `site.config.json` público de ese despliegue: nunca se toma una URL de backend de la invitación. No se requiere configurar servidores en el móvil.

Las capacidades se envían en cuerpos POST; las sesiones, por Bearer/Socket.IO auth. La sesión de invitado y solicitud pendiente se guardan **solo en sessionStorage de la pestaña**, para recarga/reconexión. No se usan cookies ni localStorage para estos secretos. La recuperación entre pestañas/dispositivos no está garantizada; cerrar la pestaña requiere otra aprobación. Una XSS del mismo origen podría leer sessionStorage: el sitio no debe incorporar scripts de terceros ni contenido HTML suministrado por participantes. Los nombres se insertan mediante textContent.

### Proxy y límites

`TRUST_PROXY_LOOPBACK=false` sigue siendo el modo directo: ninguna cabecera reenviada determina la IP. Con `true` se exige HOST de loopback, secreto privado de 32 bytes hex y cabeceras únicas: `X-Naufragio-Proxy-Token`, `X-Forwarded-For` con una única IP válida y `X-Forwarded-Proto: https`. Se rechaza origen de transporte no loopback, token incorrecto, duplicados o listas. La identidad se verifica también en peticiones polling y upgrades. El secreto de proxy no autentica usuarios ni concede pertenencias; únicamente autentica la procedencia del proxy.

El fragmento Apache preparado sanea cabeceras antes de introducir las propias y usa `CONN_REMOTE_ADDR`, la IP del socket Apache, para no heredar una atribución modificada por `mod_remoteip`. No se confía en `Forwarded` ni `X-Real-IP`. `ProxyAddHeaders Off` evita concatenar otra IP. [Variables de Apache](https://httpd.apache.org/docs/2.4/expr.html), [orden de RequestHeader](https://httpd.apache.org/docs/2.4/mod/mod_headers.html).

Se conservan límites HTTP por IP, intentos de contraseña por cuenta/IP, eventos por conexión y recursos por sala. El perfil de producción propone 600 peticiones HTTP/minuto/IP porque los participantes de una jornada pueden compartir NAT; no se elevan límites de contraseñas. El polling Engine.IO tiene controles de origen, conexión y tamaño propios. Límite HTTP JSON: 16384 bytes; Socket.IO: 65536; fragmento binario: 32768 (base64 ~43,7 KiB más sobre); mapa: 12 MiB; retrato: 2 MiB; manifest: máximo 24 MiB de recursos. El servidor retransmite un fragmento pendiente por transferencia con backpressure, sin guardar archivos de imagen. Integridad SHA-256 y autoridad del navegador del director se conservan.

## Instalación futura: propuesta revisable, no aplicada

Artefactos: `backend/deploy/naufragio-vtt.service`, `backend/deploy/backend.env.example`, `backend/deploy/site.config.json` y `backend/deploy/apache-proxy.conf.example`. Se requiere **autorización nueva** para ejecutar cualquiera de las operaciones siguientes en producción. Esta fase no ha conectado por SSH ni ha modificado la infraestructura.

1. Reauditar salud, RAM/temperatura, SSD montado, espacio y puertos. Registrar las respuestas y certificados de los seis sitios del inventario HTTPS; guardar privadamente copia exacta del vhost API. Confirmar módulos `proxy`, `proxy_http`, `headers`, SSL y Apache >=2.4.47 para `upgrade=websocket`. Si faltan módulos, presentar ese cambio por separado antes de aplicarlo. [Proxy HTTP con upgrade negociado](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass).
2. Crear únicamente el usuario/grupo de sistema `naufragio-vtt`, sin login ni privilegios, y directorios `/opt/naufragio-vtt/releases/<commit>/`, `/opt/naufragio-vtt/runtime/`, `/etc/naufragio-vtt/` y `/mnt/ssd/services/naufragio-vtt/{data,backups}`. Código/runtime propiedad de root, no escribibles por el servicio. Datos 0700 del usuario VTT, configuración privada 0600 root. Ninguna ruta dentro de `/mnt/ssd/html` ni de Heaven's Gate. `RequiresMountsFor` evita arrancar sobre la raíz si falta SSD.
3. Preparar en Windows un staging nuevo desde el commit aprobado, `npm ci --omit=dev --ignore-scripts`, solo código backend/contratos/clientes necesarios, sin `.env`, cuentas, DB, tests, informes ni secretos. Descargar Node **22.23.4 ARMv7** del artefacto ya fijado en [validación ARMv7](VALIDACION-ARMV7.md), verificar su SHA-256 y registrar también el del paquete transferido. Extraer en el runtime privado, nunca sobre Node del sistema. Node 24 se prueba en Windows: no demuestra disponibilidad ARMv7. Antes de instalación permanente confirmar soporte y política de actualizaciones de Node 22.
4. Crear configuración privada a partir de la plantilla (no copiarla sin completar). `NODE_ENV=production`, HOST/PORT loopback 3400, SQLite SSD, origen exacto `https://naufragio-rolero.github.io`, mensajes 65536, diagnóstico desactivado. Generar **privadamente** 32 bytes aleatorios hex, guardar el mismo valor en `TRUSTED_PROXY_TOKEN` y en un nuevo include raíz `/etc/apache2/secrets/naufragio-vtt-proxy.conf` con `RequestHeader set X-Naufragio-Proxy-Token`. No imprimirlo, incluirlo en argumentos, logs ni versionarlo. Los workers de Apache no necesitan leer ese fichero tras el parseo privilegiado. No añadir secretos al frontend.
5. Si existe una base de VTT, hacer antes backup consistente y probar su integridad; no sustituir cuentas. Para una base nueva, ejecutar el bootstrap interactivo existente con el usuario de servicio y **la misma ruta SQLite/configuración**, mediante una sesión privilegiada controlada que cargue el fichero sin mostrarlo; no conceder al usuario de servicio acceso general a la configuración root. Contraseña oculta, sin argumentos/entorno/logs. No hay credenciales predeterminadas. La migración 4 se ejecuta al abrir SQLite; nunca ejecutar una versión antigua contra esquema 4.
6. Revisar/verificar la unidad con `systemd-analyze verify`, instalarla únicamente para VTT, `systemctl daemon-reload` y arrancar solo esa unidad. Probar primero sin proxy público. El control local de salud debe incluir las tres cabeceras privadas en memoria desde la configuración, sin poner el secreto en la línea de comandos. Comprobar con `ss` exclusivamente `127.0.0.1:3400`. La unidad limita heap 64 MiB, CPU a un núcleo, RSS máximo 192 MiB, umask 0077, sin capacidades, filesystem solo escribible en datos y logs a journal con identificador propio. Son límites propuestos: validar consumo real F7 antes de habilitar arranque automático.
7. Introducir el fragmento de proxy **solo en el vhost HTTPS API existente**, conservando certificado, nombres, logs propios y vhost HTTP/ACME. No tocar otros vhosts. Orden específico `/socket.io/` antes de `/`; HTTP permanece disponible para polling y negocia upgrade WebSocket, sin forzar Connection/Upgrade a todas las solicitudes. Mantener HTTP-01/renovación existentes fuera del proxy. Validar `apache2ctl configtest` antes de **reload**, nunca restart. Si falla, no recargar. Volver a comprobar los seis sitios, certificados y challenge después de cada reload.
8. Tras autorización independiente de publicación del frontend, ejecutar desde backend `npm run build:frontend -- --config deploy/site.config.json` para generar `dist/` con un `site.config.json` público válido que apunte a `https://api.naufragio.net` en API/realtime y `/socket.io`. No autorizar otros orígenes ni añadir la subruta Pages a CORS (el origen es solo esquema/host). Sin esa configuración publicada el móvil no puede descubrir el backend por QR; no se ha cambiado Pages en esta fase.
9. Verificar desde fuera de la LAN WSS **y polling**, cabeceras falsificadas, tres participantes, QR/expulsión, mapas reales de 12 MiB/retratos, desconexión y recuperación, y cinco minutos de estabilidad monitorizando todos los servicios. No declarar esa prueba superada por las pruebas locales. Detener solo VTT si RSS >160 MiB, MemAvailable <192 MiB, temperatura >=75 °C o aparece degradación. No abrir 3400 ni cambiar firewall, DNS, certificados o SSH. Autorizar enable de la unidad únicamente tras aceptación.

### Backup consistente y recuperación

Comando implementado: `node backend/scripts/database-backup.js <SQLite-origen> <destino-nuevo>`, también `npm run backup -- <origen> <destino>` desde backend. Usa `node:sqlite.backup`, incluye WAL confirmado, verifica `integrity_check`/claves foráneas, rechaza sobrescritura, enlaces del archivo origen y origen=destino. Destino debe estar en un directorio privado existente; fichero POSIX 0600. Puede ejecutarse mientras el servicio escribe. No copiar únicamente el `.sqlite` vivo. Los snapshots contienen hashes, sesiones y nombres: protegerlos igual que la base, no incluirlos en dist ni Git.

Propuesta operativa: backup diario fuera de la carga de juego, antes de cada actualización y antes de migraciones; retener siete diarios y cuatro semanales, con copia cifrada fuera del mismo SSD. Programar un timer **propio de VTT** requiere autorización adicional; no modificar el timer Certbot. El servicio no necesita escribir en backups ni conocer el destino de la copia externa. Probar restauración en un directorio/puerto de ensayo antes de confiar en ella.

Recuperación: parar únicamente `naufragio-vtt`; verificar proceso/listener cerrados y no copiar durante escritura. Conservar privadamente el conjunto actual DB/WAL/SHM para diagnóstico. Abrir el backup en readonly, comprobar integridad, claves foráneas y versión de esquema compatible. Copiarlo con permisos/propietario correctos a un **directorio de datos nuevo y privado**; actualizar solo DATABASE_PATH de VTT hacia esa copia, evitando mezclar WAL antiguo. Arrancar VTT y comprobar login/pertenencias/permisos; revocar sesiones si hubo pérdida o exposición. Los mapas/posiciones/clave privada del director **no están en el backup de SQLite**: requieren conservar IndexedDB del navegador oficial. El reinicio del backend no reconstruye esos contenidos.

### Rollback

Si falla el proxy o aparece regresión atribuible: restaurar solo la copia del vhost API previa (403 estático), retirar solo su include nuevo, configtest y reload; verificar de nuevo los seis sitios/certificados. No borrar certificados ni modificar HTTP/ACME. Parar y deshabilitar solo la unidad VTT, confirmar ausencia del listener 3400 y sus procesos. Conservar DB y backups privados, no borrarlos para hacer rollback. Para volver a un código con esquema 3, restaurar además el backup anterior a migración en un directorio nuevo: cambiar solo el enlace `current` no basta. Eliminar runtime/release/usuario únicamente después, con rutas/propiedad verificadas y autorización si hay datos que conservar. No actuar sobre servicios ajenos ni reiniciar la Raspberry.

## Pruebas y resultados

Entorno: Windows x64, Node 22.23.4 y 24.18.0; Edge 156.0.4314.50 y Firefox 142.0.1 con Playwright 1.56.1. Pruebas pesadas ejecutadas **en secuencia**. Toda identidad, contraseña, imagen y base de las pruebas es sintética. No se accedió a Raspberry ni se alteraron cuentas o datos reales.

| Prueba final | Resultado | Duración |
| --- | --- | --- |
| `npm ci --ignore-scripts`, Node 22, copia limpia | Exit 0; 26 paquetes, auditoría npm sin vulnerabilidades notificadas | 8 s según npm |
| Temporizadores, Node 22 | 1/1, exit 0; éxito, fallo, cambio de autoridad, sustitución y cierre limpian deadlines | 0,329 s |
| `test:serial`, Node 22 | **116/116**, exit 0; 0 fallos/cancelaciones/omisiones | **233,064 s** |
| `npm ci --ignore-scripts`, Node 24, misma copia | Exit 0; lockfile reproducible; sin scripts de paquetes | 6 s según npm |
| Temporizadores, Node 24 | 1/1, exit 0 | 0,313 s |
| `test:serial`, Node 24 | **116/116**, exit 0; 0 fallos/cancelaciones/omisiones | **172,963 s** |
| Build sin configuración | 24 archivos públicos + manifest; 252939 bytes de contenido | SHA-256 y doble build idéntico |
| Build con configuración HTTPS propuesta | 25 archivos públicos + manifest; 253222 bytes de contenido | SHA-256, lista exacta y escaneo de secretos aprobados |
| Aceptación existente desde dist | Exit 0; local Edge/Firefox, tres participantes en `/` y `/vtt/`, prefijo alternativo `/transport` | Conserva mapa local, IndexedDB, Web Locks, altas y permisos |

Las 116 pruebas incluyen las 103 anteriores y 13 nuevas: proxy (4), admisión temporal (5), backup online (1), QR decodificable/integridad del vendor (2) y migración 3→4 con reinicio/sesión temporal persistente (1). La prueba de temporizadores ya forma parte de esas 116; su ejecución explícita adicional no se cuenta como una prueba distinta.

La auditoría de dist comprueba todos los hashes de manifest, reproduce el resultado dos veces, compara cada archivo real contra la lista pública y busca material de clave privada y capacidades completas. No publica `backend/`, src, tests, scripts, node_modules, datos, `.env` ni claves. El JSON de configuración propuesto contiene únicamente URLs HTTPS públicas, etiquetas y ruta Socket.IO. No ha sido subido a Pages ni utilizado para contactar con la API real.

### Incidencias durante el desarrollo y validación

- `npm ci` en el workspace original devolvió `EPERM` al eliminar `backend/node_modules/cookie/index.js`. No se cambió su ACL ni se forzó el borrado; todas las ejecuciones finales se hicieron desde una copia temporal limpia del código, sin `.git`, bases, secretos ni instrucciones SSH privadas. Ambas instalaciones limpias terminaron con exit 0.
- Firefox dentro del aislamiento no podía crear páginas (`Cannot read properties of undefined (reading '_page')`); una prueba mínima fuera del aislamiento funcionó y allí se ejecutó la aceptación. No se atribuye ese fallo al VTT.
- La primera identidad interna temporal excedía el formato de usuario existente: se corrigió a 32 caracteres, conservando la validación de cuentas. Volver a escanear en la misma pestaña podía conservar la solicitud rechazada por ser navegación de fragmento; se añadió su reprocesamiento. Ambos casos están cubiertos en la aceptación final.
- El simulador reforzado usaba inicialmente `conn.close()` para cortar una descarga polling; eso pide cierre ordenado y puede esperar el drenaje hasta 30 segundos, en lugar de cortar la conexión. Se cambió a descarte `conn.close(true)` y se espera la detección del corte antes de medir deadlines. No se relajan las exigencias de SHA-256, conexión del director, segundo receptor completo, cero deadlines de 600 s ni cierre de todos los engines.

### Aceptación QR final: tres clientes y móvil emulado

[Resultado JSON](evidencia-fase7/browser-qr.json), [aceptación existente](evidencia-fase7/browser-existing.json) y [auditoría completa de dist](evidencia-fase7/dist-audit.json).

| Escenario | PNG real a dos jugadores | SHA-256 del PNG sintético | Ejecución completa |
| --- | --- | --- | --- |
| `/`, WebSocket | **12582912 bytes, 34,439 s** | `26eb22b863f25a94cd02e2cb15f4edf46f7e1c637546d67362cc39fbea96dff6` | Exit 0; 115,791 s |
| `/vtt/`, solo polling | **12582912 bytes, 46,671 s** | `fd1595e0821950bef014cfe569eb674f270bfb8c7688e252bd89abf0c81f5f53` | Exit 0; 143,825 s |

En ambos: director Edge, jugador Firefox táctil 390×844 y segundo jugador Edge móvil 393×852, en contextos independientes. El ensayo decodifica los píxeles del QR con jsQR y compara el enlace exacto; ambos jugadores introducen nombre y solicitan acceso; se aprueba a uno y se rechaza al otro. Solo el aprobado entra. El rechazado no puede reclamar sesión; vuelve a escanear en la misma pestaña, recibe una aprobación distinta y se incorporan los tres.

Se verifican pertenencia normal y permisos iniciales apagados, bloqueo de creación de salas y acceso cruzado, asignación y permiso explícitos, movimiento autorizado y convergencia, movimiento ajeno denegado en UI y mediante un Socket.IO de navegador que evita la interfaz. Se transfieren mapa PNG real decodificado, retrato y un segundo mapa de 12 MiB, con corte abrupto del primer receptor durante un fragmento. El director permanece conectado; el segundo receptor termina con hash correcto y el primero recupera el mapa al reconectar y después de una recarga. Caducidad y revocación del QR se comprueban con el reloj de la fixture; expulsar un miembro retira inmediatamente su sesión y lo desconecta.

Se comprueba el transporte efectivo en el servidor. Para probar polling sin cambiar la configuración del producto, la fixture hace WebSocket no disponible en el navegador y verifica que las tres conexiones usan polling. No simula WSS público ni atraviesa Apache.

**En ambos escenarios: cero temporizadores de 600 s tras completar, cancelar y salir; cero pageerror, rechazos sin gestionar y capacidades en URL/referrer.** Se instrumentan setTimeout/clearTimeout antes de cargar la aplicación y se comprueba limpieza del receptor cancelado antes de reconectarlo. Todos los contextos se cierran en finally, el backend deja de escuchar y su registro y contador Engine.IO quedan a cero. No hubo `RATE_LIMITED` que impidiera las transmisiones; las suites también verifican expresamente ese presupuesto.

El proceso Node que incluye backend **y controlador Playwright/PNG** alcanzó 336 MiB RSS en raíz y 591 MiB durante subruta (CPU acumulada por escenario: 23,890 y 45,157 s). **No es la RAM aislada del backend ni incluye toda la RAM de los navegadores; no se usa para dimensionar Raspberry.** Se añade `node scripts/resource-probe.js`: proceso backend separado, tres clientes sintéticos, PNG real de 12 MiB, SHA-256 y muestreo de RSS/CPU/latencia de health; no inicia servicios ni escribe imágenes.

### Consumo del backend separado, Windows

[Node 22](evidencia-fase7/resource-node22.json), [Node 24](evidencia-fase7/resource-node24.json). Ambos comandos terminaron con exit 0, cero errores y proceso hijo cerrado. El backend no recibe ni conserva el PNG completo: los blobs y clientes del diagnóstico viven en el proceso padre. SQLite de esta sonda es **en memoria**; no mide SSD, Apache o TLS.

| Métrica | Node 22.23.4 | Node 24.18.0 |
| --- | --- | --- |
| Pico RSS del backend | **88 MiB** | **92 MiB** |
| RSS al terminar transferencia | 72 MiB | 79 MiB |
| CPU total del hijo, incluida provisión/contraseñas | 10,093 s | 7,093 s |
| Tiempo de vida hasta la medición | 39,135 s | 34,561 s |
| PNG real a dos clientes, 12582912 bytes y SHA-256 correcto | 31,074 s | 31,040 s |
| Muestras health durante transferencia | 60 | 61 |
| RTT health mediana / p95 | 9,64 / **28,61 ms** | 13,63 / **30,11 ms** |

La entrega incluye el pacing conservador existente de fragmentos (40 ms compartidos entre receptores); estos tiempos no son una medida de ancho de banda disponible. El perfil es acotado, no un ensayo de horas ni una demostración general de ausencia de fugas. La caducidad de temporizadores y la terminación de procesos sí se verifican explícitamente. Node 22 mantiene el aviso experimental esperado de SQLite.

Se validó además que la plantilla de producción rechaza arrancar sin secreto de proxy y, con un secreto sintético no registrado, configura loopback:3400, origen exacto de Pages y límites 16384/65536. [Resultado](evidencia-fase7/template-audit.json). La sintaxis efectiva Apache/systemd y sus límites del kernel requieren verificación futura en Linux; no se ejecutó `configtest` ni `systemd-analyze` contra producción.

Ningún resultado público WSS ni medición ARMv7 nueva se deduce de estas pruebas Windows.

## Limitaciones y pendientes

- Publicación HTTPS/WSS real, unidad systemd y fragmento Apache **preparados, no aplicados ni validados contra Apache durante esta fase**.
- Probar con móviles físicos: escaneo óptico desde monitor/proyector, Safari/iOS, teclado virtual, permisos/portapapeles, suspensión del navegador, mala Wi-Fi y reconexión tras bloqueo. Emular viewport/touch no acredita estos casos.
- La Raspberry no decodifica imágenes; los móviles sí. Un mapa de 20 megapíxeles puede requerir aproximadamente 80 MB solo para píxeles RGBA, además del archivo y cachés. Los ensayos usaron un PNG válido de 1740×1740 con tamaño exacto 12 MiB, no el peor caso de memoria gráfica admitido. Verificar dispositivos de poca RAM antes de jornadas.
- Validar recursos y límites propuestos con F7 en ARMv7, incluyendo SSD, kernel/systemd y presión de memoria junto a servicios existentes. Windows no equivale a Raspberry.
- La respuesta de claim no es recuperable; una pérdida de red entre creación de sesión y recepción exige nueva aprobación. Capacidad QR y nombres no autentican identidad física.
- Cierre/rotación de QR detiene admisión, no expulsa invitados admitidos; «Retirar acceso» y vencimiento sí lo hacen. Tras sesión caducada/cierre de pestaña no hay recuperación de identidad entre dispositivos.
- La IP pública del registro A sigue necesitando mantenimiento automático decidido y autorizado; no se ha cambiado DNS ni creado tareas de actualización.
- Una sola instancia backend con SQLite. Sin clúster, nuevo catálogo, exportaciones, chat, dados ni transferencia de autoridad. Se conservan límites de Fases 1–6.

## Veredicto y operaciones que requieren autorización

**APTO CON LIMITACIONES**: backend y QR funcionales en el entorno local verificado, con compatibilidad Node 22/24 y regresiones automatizadas superadas. **No equivale a autorizar instalación ni a declarar listo el servicio público.** Faltan validación ARMv7 de F7, dispositivos físicos y la ruta real Apache HTTPS/WSS/polling.

Operaciones concretas pendientes, en orden y con la autorización específica indicada al principio:

1. Auditoría privilegiada de recursos/SSD/puertos, módulos/configuración efectiva y baseline de los seis sitios; confirmar política de actualizaciones ARMv7 y backup privado previo de VTT si existe.
2. Crear usuario/directorios exclusivos, instalar runtime y release privados verificados, completar configuración/secreto y bootstrap interactivo **solo si no existen cuentas**. Probar/restaurar backup de ensayo. Instalar y verificar la unidad nueva, inicialmente sin enable.
3. Arrancar solo VTT en loopback, medir con F7 en ARMv7 y detener ante presión/regresiones; verificar backup SSD, shutdown y recuperación reales.
4. Autorizar e introducir únicamente el proxy del vhost API con el include secreto: configtest, reload y comprobación de los seis sitios, certificados y renovación HTTP-01. No habilitar un listener público 3400.
5. Autorizar la publicación del dist/configuración pública en Pages u otro alojamiento, por un cambio separado; ejecutar desde red externa y móviles reales el flujo QR y las pruebas HTTPS/WSS/polling/12 MiB, incluidas revocación y reconexión. Después decidir enable del servicio y programación de backups.
6. Decidir y autorizar por separado el mantenimiento del registro A ante cambios de IP pública. No se ha implementado ni contactado con STRATO.

El código de aplicación y tests de la copia validada se compararon por SHA-256 contra el workspace: coinciden. Las evidencias no contienen contraseñas, tokens QR/solicitud/sesión ni claves. Los cambios documentales anteriores del usuario permanecen aparte del incremento F7.

### Limpieza verificada

[Comprobaciones finales](evidencia-fase7/cleanup.json): cero procesos Node y cero procesos de navegador de pruebas detectados, cero engines y listeners propios tras close, cero directorios de fixtures QR. Se borró la copia limpia completa con sus dependencias, artefactos, logs y bases, después de copiar únicamente resultados saneados. También se verificaron como exclusivamente sintéticas y eliminaron tres carpetas de backup de iteraciones fallidas, y el JSON temporal inicial. Las rutas de borrado se comprobaron bajo TEMP, con nombre exacto y sin junctions; no se borraron las herramientas Node/Playwright preexistentes compartidas. Ningún proceso o recurso del piloto quedó en Raspberry: **esta fase no accedió a ella**.

Reproducir desde backend, siempre en secuencia: `npm ci --ignore-scripts`; `node --test tests/asset-client-timers.test.js`; `npm run test:serial` con Node 22 y repetir con Node 24; `npm run build:frontend -- --config deploy/site.config.json`; `BROWSER_USE_DIST=1` + `npm run test:browser`; `npm run test:browser:qr`; `node scripts/resource-probe.js` con ambos runtimes. Los scripts de navegador requieren las herramientas locales indicadas en backend/README y generan sus propias fixtures, no usan credenciales reales. Los [resultados de suites](evidencia-fase7/tests-summary.json) registran los conteos y tiempos exactos.

Código y pruebas versionados en `3c93bba` sobre `cdff421`, exclusivamente en `feat/backend-multijugador`; la documentación/evidencias se versionan en el commit posterior. No se hace merge a main, push ni instalación. Los informes anteriores que ya estaban modificados o sin versionar no se incluyen en estos commits.
