# Fase 3 — Partidas, pertenencia y presencia

Fecha: 27 de octubre de 2026. Rama: `feat/backend-multijugador`. Base conservada: `1348fde` (Fase 2). Backend local 0.3.0; esta numeración del paquete no declara terminado el MVP jugable 0.3.

## Condición previa cumplida

Antes de implementar salas se verificó temporalmente Node 22.23.4 y `node:sqlite` en la Raspberry ARMv7, sin instalación global ni modificación de servicios. Autenticación sintética y SQLite superados; scrypt mediana de hash 1621,08 ms, verificación 1615,06 ms; pico RSS del diagnóstico 101,15 MiB, RAM disponible mínima 433,6 MiB. Apache permaneció activo sin cambiar su PID principal y se eliminaron runtime, bases y procesos temporales. Véase [informe ARMv7 con método, límites y mediciones](VALIDACION-ARMV7.md).

La validación remota corresponde al backend de Fase 2. La Fase 3 se desarrolla y prueba exclusivamente en Windows; no se publica ni se deja ejecutando en la Raspberry.

## Implementación y decisiones

- Solo `director` crea partidas. Propietario fijado por la sesión del servidor e inmutable; un administrador técnico u otro director no obtiene autoridad sobre ellas.
- UUID interno y código de admisión `room_…` de 128 bits aleatorios, distinto de las invitaciones de alta `signup_…`. En SQLite solo se conserva SHA-256 del código. Se devuelve únicamente al crearlo/regenerarlo, tiene caducidad, se puede revocar y se comprueban colisiones incluso con códigos históricos.
- **Invitación nominativa y código son requisitos conjuntos** para obtener una nueva pertenencia. La invitación apunta a una cuenta activa existente, una partida y unos permisos explícitos; se consume atómicamente al entrar, caduca y se puede revocar. El código por sí solo no concede acceso. El alta de una cuenta sigue siendo independiente y no añade pertenencias automáticamente.
- Revocar/regenerar/caducar el código afecta a nuevas admisiones, no a miembros ya autorizados. Revocar un miembro desactiva su pertenencia, borra sus permisos y revoca invitaciones pendientes; sus conexiones a esa partida se expulsan. Para volver necesita una nueva invitación válida y un código vigente.
- Permisos por miembro: `diceAllowed` y `moveAssignedTokens`, ambos `false` por defecto; solo el propietario puede concederlos/revocarlos. No admiten roles ni subida de recursos. La política de movimiento sigue exigiendo además asignación del token, pertenencia y director conectado; todavía no existe API de tokens, asignaciones ni dados.
- SQLite migra transaccionalmente del esquema 1 al 2. Añade `rooms`, `room_codes`, `room_memberships`, `room_invitations`; conserva usuarios, sesiones, invitaciones de alta y etiquetas. Solo guarda IDs, nombre de partida, permisos, hashes y fechas; no contiene mapas, tokens, posiciones, imágenes ni estado oficial de juego.
- El namespace `/` solo admite `{token, roomId}` después de validar sesión actual, cuenta activa y pertenencia. Los canales internos los decide el servidor. No acepta identidad, rol, propietario ni destino de difusión aportados por el cliente.
- La presencia está en memoria y se difunde únicamente a miembros conectados de la misma partida. Usa `active` o `waiting` (presentación prevista: «En espera del máster»), propietario persistido y participantes deduplicados por cuenta. Al desconectar el director no se elige sustituto. Al reconectar la misma cuenta propietaria se recupera `active`; su conexión nueva sustituye a la antigua en esa partida. Las múltiples pestañas de participantes no duplican personas.
- Cada mensaje vuelve a comprobar sesión y pertenencia. Logout, revocación, cambio de rol, desactivación y cambio de miembro provocan revisión inmediata; hay además temporizador de expiración y barrido cada segundo para cambios de otra conexión administrativa. Un fallo inesperado de almacenamiento cierra las conexiones; no se continúa con permisos guardados en caché.
- Solo se admite `room:presence:get` con `{version:1}`. El servidor emite `room:presence` y, al sustituir al mismo propietario, `room:replaced`. Movimientos, imágenes, cambios de mapa, falsa presencia y cambios de sala mediante mensajes reciben `EVENT_NOT_AVAILABLE`. No se activa recuperación de eventos pasados.
- Límites conservados de HTTP/Engine.IO, origen exacto, tamaño, conexiones y frecuencia de eventos. Nuevos límites de admisión por cuenta y peer, 100 partidas por director y 100 invitaciones de partida pendientes por sala. No se confía en `X-Forwarded-For`.

El [contrato operativo y HTTP/Socket.IO](../backend/README.md) incluye rutas, cuerpos y variables nuevas. La pantalla de ajustes local refleja las capacidades disponibles; el tablero y GitHub Pages no se modifican.

## Pruebas

Windows x64, datos exclusivamente sintéticos, puertos efímeros loopback, SQLite en memoria o directorios temporales eliminados tras cerrar los servidores. Sin cambios de dependencias ni compilaciones nativas. Las dos versiones se ejecutan sucesivamente, con los parámetros reales de scrypt.

| Runtime y comando desde `backend/` | Resultado |
| --- | --- |
| Node 24.18.0, `node --test --test-reporter=spec` | **69/69**, 0 fallos, 0 omitidas; 35,15 s. |
| Node 22.23.4, `node --test --test-reporter=spec` | **69/69**, 0 fallos, 0 omitidas; 54,13 s. Emite el aviso experimental de SQLite, sin ocultarlo. |
| Ambas versiones, `node scripts/validate-site.js public/site.config.example.json` | Configuración pública válida. |

`git diff --check` no detectó errores de espacios. Se mantuvieron intactos `index.html`, `app.js`, `styles.css` y la configuración de Pages. No se añadieron dependencias npm; el cambio de versión 0.3.0 solo identifica el incremento del paquete backend.

Se conservan los casos de autenticación y transporte de las fases anteriores, actualizando las expectativas de las rutas ahora implementadas. Se añaden 17 pruebas:

1. Creación exclusiva por dirección, propietario de sesión y rechazo de campos de suplantación/contenido.
2. Código sin invitación insuficiente; alta/sesión/código aleatorio no intercambiables; consumo y permisos iniciales denegados.
3. Permisos administrados solo por propietario y aislados por partida; rechazo de flags desconocidos o tipos incorrectos.
4. Códigos caducados, revocados y regenerados; no expulsan por sí solos a miembros existentes.
5. Invitaciones de sala caducadas/revocadas/reutilizadas, retirada de miembro y nueva invitación sin heredar permisos.
6. Director ajeno sin autoridad sobre partida/invitaciones de otro propietario.
7. Colisión de códigos históricos y generación de un nuevo valor.
8. Límite de admisiones por cuenta y peer, sin evasión por cabeceras reenviadas.
9. Mensajes de presencia malformados, versión incorrecta y límite de frecuencia con desconexión.
10. Handshake con sesión/pertenencia/origen incorrectos mediante polling y WebSocket.
11. Espera, reconexión, sustitución del mismo director y deduplicación de pestañas sin elección de autoridad.
12. Aislamiento de participantes/permisos/difusión entre partidas; rechazo de movimiento, imágenes y presencia falsificada.
13. Expulsión de un miembro solo de la partida revocada; no puede reentrar con código antiguo.
14. Logout, degradación del propietario y desactivación de participante revisan sockets activos.
15. Expiración de sesiones de director y participante.
16. Migración desde esquema 1, preservación de cuenta, claves foráneas y rollback de escrituras.
17. Reinicio/reapertura conservan propietario, pertenencias, permisos e invitación pendiente; ausencia de secretos en claro; la presencia arranca en espera sin director conectado.

## Límites y decisiones pendientes

1. Integrar acceso, invitaciones, salas y etiqueta «En espera» en el frontend en una fase explícita; hoy son API y protocolo, sin una nueva interfaz de tablero. El flujo combinado de alta y admisión se mantiene como dos pasos deliberados y autorizados por separado.
2. Asignaciones de tokens, retransmisión de posiciones y confirmaciones autoritativas, imágenes y herramientas visuales siguen pendientes. Los flags persistidos preparan esa autorización, no habilitan eventos de juego. No se considera completado COL-01/02/03 ni el MVP por disponer de presencia.
3. Definir archivo/eliminación de partidas, retención de códigos/invitaciones históricos y paginación (listados limitados a 1000); no se añade transferencia de propiedad.
4. Concretar recuperación de cuentas y respaldo/restauración consistente de SQLite WAL antes de operar. La base no permite recuperar contenido de partidas, que permanece en el navegador del director.
5. Medir carga sostenida y concurrencia de acceso en ARMv7, aceptar la latencia observada de scrypt y decidir plataforma posterior a Node 22. La Fase 3 todavía no se ha ensayado remotamente.
6. Acordar host, origen HTTPS, proxy WSS, usuario, límites de servicio y rate limiting de proxy. Esta entrega no instala, publica ni modifica Apache, Heaven's Gate o Pages.
