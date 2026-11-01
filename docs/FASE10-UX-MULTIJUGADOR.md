# Fase 10 — La mesa como centro de la partida

Fecha: 1 de noviembre de 2026. Rama de trabajo: `feat/phase10-table-ux`, derivada de `feat/backend-multijugador`.

**Implementación local terminada; no publicada.** La beta, su backend, SQLite real, perfiles, mapas y servicios no se han modificado. No se ha hecho push, merge a `main`, cambio de Apache, certificados, DNS, SSH, memoria ni arranque.

## Causas originales y solución

| Problema | Causa | Comportamiento implementado |
| --- | --- | --- |
| Solicitudes QR invisibles | El refresco se ejecutaba solo con `qrDialog.open`; cerrar el diálogo detenía la consulta | Consulta autenticada del director durante su estancia en la sala, cada 3 s, sin solapamiento y con descarte de respuestas de salas anteriores |
| Admisión modificada al abrir Invitar | El primer clic llamaba a la generación de un QR | Abrir solo consulta. Generar, cerrar admisión y revocar requieren acciones explícitas distintas |
| Jugadores y permisos escondidos | Pertenencias y presencia estaban en administración multijugador | Panel Jugadores sobre la mesa: conexión, autorizados desconectados, solicitudes, permisos y asignaciones |
| Edición lejos de la ficha | Selección y formularios de recursos separados | Acción Editar ficha junto al token; Enter/E sobre la selección abre el mismo editor |
| Mapas publicados al seleccionar | Los controles locales y compartidos importaban directamente | Selección o arrastre → validación → vista previa y escala/origen → Usar este mapa |
| Fichas perdidas fuera del mapa | Solo existía el límite global de coordenadas del protocolo | Área de escena compartida y persistida, validada en el servidor al solicitar y confirmar movimientos |
| Dados sin función jugable | Existía permiso, pero no servicio de tiradas | Bandeja local o pública, resultado calculado por servidor, historial y rechazo de falsificaciones |

## Controles finales

- **Cargar mapa / Gestionar mapa:** diálogo único para PNG, JPEG y WebP; arrastre y selector accesible, vista previa, nombre, píxeles, formato y MiB, anchura/altura y origen en casillas, encaje de vista, confirmación y retirada. Abrir con mapa actual permite reajustarlo. Cancelar no publica ni guarda. Se conservan 12 MiB, 20 Mpx y 8000 px por lado.
- **Área jugable:** ajustar/restablecer al mapa, rectángulo independiente o desactivar. Contorno visible; las coordenadas son las de la cuadrícula, con origen y escala fraccionarios. No limita cámara ni zoom.
- **Jugadores:** panel desplegable sin abandonar el tablero. Contador y aviso privado al director cuando aparecen solicitudes; nombre, estado y antigüedad. Aprobar/rechazar individualmente, asignar fichas, movimiento, dados y retirada de acceso. El jugador recibe presencia y sus propios permisos; no recibe solicitudes ni administración.
- **Editar ficha:** botón situado junto a la selección, ratón, teclado o toque. Código visible de solo lectura, nombre, color, tamaño, retrato, asignación y permisos de los participantes seleccionados; Guardar y Cancelar. La edición conserva IDs y posiciones oficiales. Los permisos son de participante en la sala, no una autorización independiente por ficha. En local se conservan tamaño y retratos en el almacenamiento existente; también se puede eliminar una ficha local.
- **Dados:** bandeja con d4/d6/d8/d10/d12/d20/d100, cantidad, modificador o notación estricta. Muestra autor, resultados individuales, total, hora y procedencia. Se diferencia expresamente Local de Servidor. Las bandejas de jugadores y dados se alternan; los diálogos conservan el comportamiento de foco nativo.
- **Invitar:** QR y enlace, generar explícitamente, abrir/cerrar admisión y revocar. Cerrar la ventana no cambia la admisión. Regenerar indica que revoca el anterior. El secreto del QR se muestra solo al generarlo: no se recupera desde su hash tras recargar.
- **Partida y ajustes:** cuentas, creación y entrada en salas, destinos públicos y administración avanzada. Las operaciones fundamentales anteriores están disponibles desde la mesa. Se retiran de la vista los antiguos editores laterales de mapas y apariencia.

La barra se distribuye en varias filas cuando es necesario. Los paneles se sitúan debajo de su altura real, con desplazamiento interno y controles de al menos 44 px en las acciones principales. No se añade un framework ni dependencias de ejecución.

## Backend, persistencia y protocolo

### Admisión y presencia

Se reutilizan `GET /rooms/:id/admission`, las decisiones existentes, las pertenencias y `room:presence`. El endpoint de solicitudes sigue limitado al propietario. La consulta vive hasta salir/cerrar sesión/abandonar la página, tiene timeout y usa el limitador HTTP existente. No hay una nueva difusión de solicitudes a toda la sala. Los refrescos sin cambios conservan los controles de solicitudes para evitar perder el foco cada tres segundos.

Las solicitudes siguen en SQLite y se recuperan al recargar, iniciar sesión y reabrir la sala. La sesión ordinaria del director continúa siendo de memoria: no se empieza a guardar su credencial en localStorage. Se añade `created_at`; para solicitudes previas a la migración se indica antigüedad desconocida, sin inventar una fecha. La caducidad y retirada de acceso mantienen las reglas anteriores.

### Escena y movimientos

`room_scene` guarda revisión, modo (`map`, `custom`, `free`), límites y tamaños de fichas. Los eventos nuevos son `scene:get`, `scene:set` y `room:scene`. Solo el socket director con autoridad activa puede cambiarla; las revisiones evitan sobrescribir cambios obsoletos.

La publicación del manifiesto de recursos valida también el área derivada del mapa y los tamaños. Si hay fichas fuera, se rechaza el cambio con `TOKENS_OUTSIDE_BOARD`; el director debe moverlas o modificar/desactivar los límites y confirmar de nuevo. No se recolocan silenciosamente.

`token:move:request` y su confirmación verifican límites en servidor. Se usa centro `(x + 0.5, y + 0.5)` y radio `.34 × tamaño` en casillas, el mismo cuerpo circular dibujado por el tablero; sombras y halo de selección son decorativos. Las posiciones confirmadas existen en memoria durante la autoridad activa para validar cambios de escena, y siguen sin escribirse en SQLite. Se mantienen los checkpoints, firmas, versiones, asignaciones e IndexedDB del director.

Sin mapa, el director puede configurar un rectángulo. Desactivar conserva el movimiento libre. Una mesa local anterior sin configuración de límites mantiene el modo libre si ya tenía mapa; los mapas nuevos parten del modo mapa. En salas compartidas antiguas, una primera publicación incompatible se rechaza y se informa al director, sin desplazar fichas.

### Recursos

Se reutilizan el almacén local y `room-media-store`, SHA-256, fragmentos de 32 KiB, acknowledgements y el ritmo compartido del emisor. La vista previa usa URL temporal revocada y decodificación asíncrona. Ningún mapa privado se sube automáticamente a SQLite ni al servidor.

Si falla la publicación, se restaura la fuente y el registro anterior del director. Si falla una descarga, el receptor mantiene su último mapa verificado y recupera el nuevo al reconectar. Se muestra progreso por transferencia; no es un porcentaje agregado de todos los jugadores. El encaje se realiza después de decodificar el nuevo mapa.

### Dados

Eventos `dice:roll`, `dice:result`, `dice:history:get` y `dice:history`. La petición contiene exclusivamente versión, sala, `eventId`, `issuedAt` y notación. El servidor deriva autor y permisos de la sesión/pertenencia, exige director con autoridad activa y usa `crypto.randomInt`. El cliente nunca suministra resultados.

Límites: 1–50 dados de los siete tipos admitidos, modificador ±1000, notación de hasta 32 caracteres, seis tiradas por diez segundos por cuenta y sala, antigüedad de petición ±60 s y rechazo de ID repetido. Se mantienen también los límites generales de eventos y tamaño de frame. No se usa `eval`.

SQLite conserva resultados públicos con ID, autor, dados, valores, modificador, total y hora. Se devuelven las últimas 50 tiradas; internamente se retiene una ventana contra repeticiones, con máximo 256 registros por sala. Se recupera el historial al reconectar e incluso tras reiniciar un backend sintético. Los permisos se vuelven a comprobar para cada tirada y cada destinatario. El modo local utiliza Web Crypto en el navegador, sin presentarse como verificado por el servidor.

### Migraciones y rollback

La base pasa de v4 a **v7**: v5 añade fecha de solicitud nullable; v6 añade escena; v7 añade historial de dados. Las migraciones son transaccionales. Antes de migrar una base existente se genera una copia consistente con `VACUUM INTO`, sufijo `.pre-phase10-<fecha>.sqlite` y permisos restrictivos. Esto complementa el backup operativo previo, no lo sustituye.

`backend/scripts/rollback-phase10.js ORIGEN DESTINO_NUEVO` crea mediante backup online una **copia** compatible con v4. Conserva usuarios, sesiones, pertenencias, solicitudes y checkpoints actuales; retira de esa copia las tablas/campo nuevos y valida integridad. **El origen v7 permanece intacto**, con límites e historial conservados. No cambia configuración, enlaces ni servicios y no sobrescribe destinos existentes. Las funciones exclusivas de Fase 10 no existen en el frontend anterior.

## Pruebas y evidencias

| Verificación | Resultado |
| --- | --- |
| Suite Node completa con concurrencia 2 | **128/128**, cero fallos; [registro](evidencia-fase10/pruebas-node.txt) |
| Migración reforzada y copia de rollback; build y namespace beta | **6/6** en ejecución focalizada posterior; preservación de solicitudes v4, checkpoint y original v7 |
| Aceptación nueva en raíz, Edge, tres contextos | **Superada**; mapa de 12 MiB, interrupción, mapa previo y recuperación SHA-256; [informe](evidencia-fase10/browser-source.json) |
| Aceptación nueva de `dist`, `/vtt/`, polling y Firefox táctil | **Superada**, cero errores de página; [informe](evidencia-fase10/browser-dist.json) |
| Regresión anterior `browser-integration.js`, adaptada a los nuevos controles | **Superada** en Edge/Firefox: modo local en ambos, raíz y `/vtt/`, prefijo de transporte `/transport`, alta, permisos, movimientos, reconexión, Web Locks y preservación de IndexedDB |
| QR y recursos ampliados `browser-qr.js` | **Superada** en WebSocket/raíz y polling/`/vtt/`, tres clientes, dos invitados, expulsión, caducidad, SHA-256 y recuperación; [informe](evidencia-fase10/regresion-qr.json) |
| Sesiones prolongadas | Pruebas de reloj acelerado y revocación superadas dentro de la suite. No se repite automáticamente el ensayo completo de tres horas de Fase 9: no cambian supervisor, duración, watchdog ni límites de sesión |

Se conserva el [primer intento de la suite](evidencia-fase10/pruebas-node-inicial.txt): 126/127, con una expectativa obsoleta que consideraba inexistente `dice:roll`. Se corrigió para exigir rechazo del mensaje inválido. Firefox necesitó ejecutarse fuera del aislamiento local para crear páginas. Otro intento de navegador detectó distinta presentación regional de la hora; la comparación ahora comprueba los datos completos del resultado, y la interfaz usa el formato español.

Los recorridos nuevos comprueban dos solicitudes con QR cerrado, recuperación del director al recargar, aprobar/rechazar, administración privada, retrato y tamaño local tras recarga, edición compartida sin cambio de posiciones, selección/arrastre/cancelación de mapa, movimientos fuera de límites por ratón/teclado/táctil y protocolo, y dados idénticos e historial tras recarga. Las pruebas de backend cubren además caducidad, expulsión, aislamiento, permisos, falsificaciones, frecuencia, persistencia y límites de entrada.

Ejecutar desde `backend/`, con Playwright instalado fuera del repositorio:

```powershell
npm test
# Configurar BROWSER_TOOLS_DIR y PLAYWRIGHT_BROWSERS_PATH del entorno local.
npm run test:browser:phase10
# Opcionales: BROWSER_USE_DIST=1, PHASE10_BASE=/vtt/,
# PHASE10_TRANSPORT=polling, PHASE10_FIREFOX=1, PHASE10_LARGE=1.
node --test tests/phase10-migration.test.js tests/build-frontend.test.js
```

### Capturas reales de navegador

| Control | Escritorio | Móvil emulado |
| --- | --- | --- |
| Jugadores | [Captura](evidencia-fase10/jugadores-escritorio.png) | [Captura](evidencia-fase10/jugadores-movil.png) |
| Mapa y vista previa | [Captura](evidencia-fase10/mapa-escritorio.png) | [Captura](evidencia-fase10/mapa-movil.png) |
| Editor de ficha | [Captura](evidencia-fase10/ficha-escritorio.png) | [Captura](evidencia-fase10/ficha-movil.png) |
| Dados e historial | [Captura](evidencia-fase10/dados-escritorio.png) | [Captura](evidencia-fase10/dados-movil.png) |

## Rendimiento y ARMv7

No hay dependencias nuevas de ejecución ni módulos nativos nuevos. Se conserva Node y `node:sqlite` del backend actual, Socket.IO fijado, los fragmentos con backpressure y el frontend sin framework. La consulta de admisión añade una petición cada tres segundos por director, incluso con QR cerrado. El historial está acotado; la escena contiene como máximo los tamaños del conjunto existente de fichas.

La prueba real con imagen de 12 MiB verifica integridad y recuperación, no establece un benchmark de Raspberry. **No se han medido RSS, CPU, temperatura ni latencias de esta versión en ARMv7.** Las métricas y el ensayo de tres horas documentados en Fase 9 corresponden al release anterior. Se requiere comprobación focalizada ARMv7 en una ventana de mantenimiento autorizada; no se afirma que esta versión haya dirigido ya una partida humana de tres horas.

La regresión ampliada local transfirió 12 MiB a dos invitados en **37,98 s con WebSocket** y **43,84 s con polling**. Terminó sin errores de página, rechazos de promesas sin tratar, filtraciones de secretos por URL/referer ni timers residuales de 600 s. El informe mide RSS conjunto del backend y conductor de pruebas Windows (379/589 MiB), con fixtures y automatización: no representa el consumo aislado del backend en Raspberry ni permite compararlo con sus límites operativos.

## Publicación coordinada, pendiente de autorización

Preparación local reproducible:

```powershell
cd backend
npm run prepare:phase10
# Para incluir la configuración pública validada del sitio:
npm run prepare:phase10 -- --config RUTA_A_SITE_CONFIG_PUBLICO
```

El candidato se genera en `artifacts/phase10/dist/`, con manifiesto SHA-256 y namespace **`phase9-beta`**, igual que la beta. Sin `--config` se prepara el código sin destinos públicos; al publicar deben conservarse y validarse los destinos actuales. No renombrar las claves del tablero, la base local de imágenes ni los almacenes de autoridad/recursos del director. El artefacto queda ignorado por Git y no se copia a ninguna web.

Se ha generado además `artifacts/phase10/backend-source.zip` desde el backend versionado de `ebcc3d1`, sin dependencias locales, `.env` real ni bases de partidas. [Metadatos y hashes del candidato](evidencia-fase10/candidato-local.json). El ZIP requiere las dependencias fijadas y el runtime compatible del release; no incluye un runtime ARM nuevo.

Antes de actualizar, el operador debe:

1. Obtener autorización del propietario y acordar una ventana sin juego. Verificar ausencia de propietario y jugadores conectados; si hay cualquiera conectado, **no parar, reiniciar ni reemplazar** el backend. No basta con observar una pestaña del navegador.
2. Inventariar release/enlace `current`, configuración pública publicada, unidad/supervisor y seis sitios. Conservar copia verificable del release anterior y del frontend `/beta/`. Registrar hashes y rutas de recuperación fuera de la raíz pública.
3. Crear backup consistente de la SQLite real mediante `database-backup.js` en un directorio privado. La ruta documentada en Fase 9 es `/mnt/ssd/naufragio-vtt/data/naufragio.sqlite`; verificar la configuración vigente antes de usarla. Validar integridad y claves foráneas del backup. Conservar también el perfil e IndexedDB del navegador director: SQLite no contiene sus originales ni su clave privada.
4. Preparar el nuevo backend en un release independiente y el frontend en staging, conservando configuración, namespaces y versiones compatibles. Probar primero una copia de la base real, no una base vacía. No cambiar Apache, certificados, DNS, SSH, kernel, memoria ni arranque.
5. Con servicio confirmado sin participantes, migrar y validar el backend; publicar el frontend correspondiente en la misma ventana. No dejar el nuevo frontend apuntando al backend antiguo, que desconoce escenas y dados.
6. En ventana atendida, verificar salud, identidad, solicitudes con QR cerrado, dos decisiones distintas, mapa, ficha, límites y dados con permisos. Comprobar seis sitios existentes (Heaven's Gate, foro, proxy con su 404 esperado, Bibprof, Ordenanthia y galería), sus respuestas previstas y los servicios vigilados. No se han ejecutado estas sondas remotas durante este encargo.
7. Mantener el controlador y supervisor anteriores; cerrar la ventana según el procedimiento de Fase 9. Registrar comprobaciones, recursos y cualquier autorización de apertura posterior.

Rollback si falla la validación, siempre sin participantes:

1. Detener la ventana mediante su procedimiento existente y conservar backup consistente nuevo de la base v7 y todos los originales del director.
2. Preparar con `rollback-phase10.js` una copia compatible v4 de la base **actual**, sin sobrescribir la original. Esto evita volver a una copia antigua y perder altas/admisiones posteriores. Si aún no hubo ninguna escritura útil, también puede usarse el backup previo validado.
3. Restaurar release y frontend anteriores juntos, y apuntar el backend a la copia validada. Conservar la base v7 y sus backups; no borrar perfiles ni datos de imágenes. No ejecutar el rollback destructivo de fases antiguas.
4. Validar servicio, recuperación del director y los seis sitios. Si no se puede garantizar la conservación de cambios posteriores, mantener la ventana cerrada y preparar una corrección hacia delante.

## Estado de Git y límites explícitos

Commits funcionales creados en esta rama:

| Commit | Contenido |
| --- | --- |
| `54c09f3` | Solicitudes QR independientes del diálogo y panel de jugadores |
| `ab2f593` | Flujo confirmado de mapas y límites de escena autorizados |
| `d046932` | Editor contextual de fichas local y compartido |
| `c532dc4` | Dados verificados, permisos e historial |
| `a2ce974` | Controles responsivos, pruebas de navegador y capturas |
| `ebcc3d1` | Preparación local de publicación y copia de rollback |

El commit de este informe y las evidencias finales se identifica con `git log -1` tras la entrega. No se modifica `main`, `deploy/phase9-beta` ni la rama de aplicación. Se conservan sin incorporar las modificaciones previas de `docs/PILOTO-PRIVADO-RASPBERRY.md` y los documentos/evidencias ARMv7 y Windows que ya estaban sin seguimiento al comenzar.

Pendientes y límites:

- Publicación, backup **real** y comprobación de servicios/sitios: pendientes de ventana y autorización. Solo se han migrado bases sintéticas locales.
- Validación física Android/iOS, lectores de pantalla y ensayo humano: pendientes. Las capturas móviles son emulación y se han enviado eventos táctiles de Chromium; no equivalen a teléfonos físicos.
- Admisión por consulta controlada: latencia habitual de hasta tres segundos más red. No hay push privado de solicitudes.
- Se mantiene el conjunto inicial de fichas en cada sala: añadir/eliminar fichas durante una sala compartida continúa fuera del protocolo existente. Se pueden editar, asignar y mover las iniciales; crear fichas locales antes de crear la sala.
- No hay tiradas ocultas ni reglas de sistemas concretos. El historial público conserva 50 visibles, no un registro permanente ilimitado.
- Las cuentas/directores deben volver a iniciar sesión tras recargar; los invitados conservan su recuperación temporal existente. Se recuperan solicitudes y sala desde el backend, no se persiste la credencial del director.
- No se han modificado los mecanismos de duración ni supervisión; no se ha repetido automáticamente la prueba completa de tres horas ni se presenta como validación prolongada de Fase 10.
