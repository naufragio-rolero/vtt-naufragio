# Fase 4 — Sincronización autoritativa de tokens

Fecha: 27 de octubre de 2026. Rama: `feat/backend-multijugador`. Base conservada: `4c33a42`. Backend 0.4.0; esta versión del paquete no representa la fase de herramientas 0.4 del producto.

> Informe histórico de Fase 4. La integración visual y la validación de IndexedDB/Web Locks en Firefox y Edge se entregan después en [Fase 5](FASE5-FRONTEND.md); sus resultados no se atribuyen retroactivamente a esta fase.

## Alcance

Implementación y pruebas exclusivamente locales en Windows, manteniendo Node 22 y 24. No se ha conectado a la Raspberry, instalado ni desplegado nada. Permanecen intactos los archivos del tablero publicado y Pages. No se añaden dependencias, imágenes, mapas, chat, dados, fichas de personaje ni herramientas visuales.

Se entrega un protocolo Socket.IO y un cliente sin interfaz, en [`backend/client/`](../backend/client/token-client.js), separado del tablero. La prueba de tres clientes utiliza ese mismo cliente de protocolo, no tres copias de una lógica inventada dentro del test. El contrato compartido está en [`shared/token-state.js`](../backend/shared/token-state.js) y la coordinación del backend en [`rooms/token-sync.js`](../backend/src/rooms/token-sync.js).

## Autoridad, estado local y reconexión

1. La cuenta debe seguir siendo propietaria y tener rol `director`. Conectar o iniciar sesión no concede autoridad de movimiento.
2. En la primera apertura, el cliente crea una clave ECDSA P-256 mediante WebCrypto y guarda de forma privada la clave y el estado inicial de tokens **antes** de solicitar autoridad. El backend fija únicamente la clave pública, ID de estado, revisión y resumen SHA-256 de ese estado.
3. Cada nueva conexión recibe un reto aleatorio de un solo uso. El director presenta la instantánea completa de tokens y firma el reto junto con sala, ID de estado, revisión y resumen. El backend valida la firma y vuelve a calcular el resumen; todos deben coincidir con el último punto confirmado.
4. Sin clave local o sin estado coincidente, la conexión no recupera autoridad. No se interpreta una cuenta autenticada, un booleano del cliente ni la caché de un jugador como prueba de IndexedDB. Una segunda sesión tampoco expulsa al director válido hasta completar esta comprobación.
5. Una prueba válida crea una época UUID nueva y vincula la autoridad a ese socket. Sustituye solo al propietario anterior, cancela propuestas pendientes y difunde el estado inicial verificado. Los mensajes de otra época no se aceptan.
6. La desconexión, caducidad/revocación de sesión o pérdida del rol del director suspende movimientos oficiales y deja `waiting`. No se elige sucesor. Tras reiniciar el backend se repite la prueba contra el punto de control persistido.

El resumen se construye de forma determinista: tokens ordenados por UUID; hash de `[id, tokenVersion, x, y]` por token; hash final de ID de estado, revisión y lista ordenada de IDs/versiones/hashes. El backend mantiene versiones y hashes en memoria para comprobar transiciones sin conservar una copia de posiciones como estado oficial. Recibe instantáneas solo para validar/retransmitir; no las escribe en SQLite.

### Diario local y exclusión entre pestañas

El cliente usa un almacén con `load()` y `save()` asíncronos. `save()` debe resolver al completar su transacción durable. Antes de aceptar un movimiento, guarda `{current, staged}`: estado anterior y candidato. Solo envía la aceptación después de ese guardado; tras el acuse confirmado consolida `staged` como `current`.

Si se pierde el acuse o falla el guardado final, la reconexión compara ambos candidatos con el resumen del backend. Recupera el candidato confirmado, o descarta el que nunca se confirmó. Si ninguno coincide, se mantiene en espera. Un fallo local cierra ese cliente y detiene sus manejadores pendientes; no continúa aceptando movimientos.

El adaptador [`indexeddb-store.js`](../backend/client/indexeddb-store.js) espera `transaction.oncomplete`, solicita durabilidad `strict` y usa Web Locks para excluir dos controladores de la misma sala en ese origen. Si falta el bloqueo o ya está ocupado, falla de forma cerrada. Los almacenes alternativos deben garantizar también acceso exclusivo al diario. La clave privada pertenece al almacenamiento privado del navegador; nunca a `site.config.json`, SQLite, URLs, logs ni repositorio.

## Solicitudes, permisos y conflictos

- Solo se registran los tokens del conjunto público inicial (hasta 64), con UUID, versión y coordenadas. No hay atributos, imágenes, creación/borrado dinámico ni mapas en este protocolo.
- SQLite guarda asignaciones `(room_id, token_id, user_id)` como permisos, sin contenido de token. Solo el socket del director verificado las cambia; cada asignación lleva ID, época y versión de asignación para impedir que una repetición antigua restaure un permiso. Se pueden asignar varios participantes al mismo token.
- Un participante necesita pertenencia activa, sesión actual, flag `moveAssignedTokens=true`, asignación de ese token y director verificado conectado. El director verificado puede mover cualquier token registrado sin asignación ni flag de participante. Otro director invitado tiene permisos de participante en esa sala.
- La solicitud incluye ID UUID, versión de protocolo, sala, época, revisión base, ID y versión de token y posición finita. La revisión base debe coincidir con la vigente al recibirla. Se comprueban límites y permisos antes de retransmitir exclusivamente al director; no se difunde la propuesta como estado oficial.
- Solo una propuesta puede estar pendiente por token. Propuestas simultáneas sobre tokens diferentes pueden aceptarse en orden; dos sobre el mismo token producen `TOKEN_BUSY` y requieren reintento contra la versión confirmada. No se aplica «última escritura gana».
- El director acepta o rechaza. Al aceptar, el backend vuelve a comprobar sesión, pertenencia, permiso y asignación del solicitante, época y versión del token, revisión siguiente y resumen del candidato. Solo entonces actualiza el punto de control y difunde una confirmación a miembros actuales de esa sala.
- Retirar permisos, asignación o pertenencia invalida solicitudes pendientes. Revocar pertenencia o cambiar administrativamente una cuenta elimina además sus asignaciones pertinentes. Un rechazo no modifica la revisión ni las posiciones.
- Un ID repetido con el mismo contenido devuelve el resultado ya resuelto; con otro contenido/actor se rechaza. No se vuelve a difundir una confirmación por repetir el acuse. Las versiones impiden que un movimiento confirmado vuelva a aplicarse tras expirar la caché de resultados.
- La reconexión de jugadores y la detección de un hueco en revisiones solicitan una instantánea **al director**. El backend valida que coincida con el punto actual y la retransmite solo al solicitante. No reconstruye posiciones desde SQLite.

## Persistencia y límites

Migración por versión, transaccional, de esquema 2 a 3 (también se mantienen las rutas desde 0 y 1):

Antes de actualizar una instalación con datos se necesita una copia privada y consistente de SQLite. El backend anterior rechaza el esquema 3; no se implementa una migración inversa ni un rollback automático de la base.

| Tabla nueva | Columnas | Finalidad |
| --- | --- | --- |
| `room_authority` | `room_id`, `state_id`, `public_key`, `revision`, `state_digest` | Verificar continuidad del estado/dispositivo del director tras reconexión/reinicio. |
| `token_assignments` | `room_id`, `token_id`, `user_id` | Asignación de permisos, sin posiciones ni atributos. |

No se persisten instantáneas, movimientos, coordenadas, imágenes ni claves privadas. Las posiciones en propuestas y resultados son mensajes temporales de retransmisión: pendientes hasta 10 s y registros resueltos otros 60 s (hasta 70 s en total, más el intervalo de purga); máximo 128 registros por sala. Como solo hay una pendiente por token, hay hasta 64 propuestas simultáneas. Hay como máximo 32 solicitudes de resincronización pendientes por sala (10 s), 32 destinatarios por asignación y los límites existentes de frames, frecuencia, conexiones y origen. El barrido de presencia purga caducados y revisa permisos cada segundo; la aceptación también comprueba el plazo inmediatamente. Se libera la coordinación en memoria al desaparecer las conexiones de la sala o cerrar el proceso.

La retención de resultados es acotada y no constituye un historial durable. Al caducar una solicitud/rechazo, un nuevo intento requiere un nuevo ID y versiones actuales. No existe garantía de entrega exactamente una vez entre reinicios; se garantiza que no se confirma dos veces la misma transición de versión. Se opera con un único proceso backend.

## Pruebas y reproducción

Desde `backend/`, seleccionar Node 22.23.4 o 24.18.0 y ejecutar:

```text
node --test --test-reporter=spec
node --test --test-concurrency=1 --test-reporter=spec
node --test --test-name-pattern="three simulated clients" tests/token-sync.test.js
node scripts/validate-site.js public/site.config.example.json
```

| Validación final | Resultado |
| --- | --- |
| Node 24.18.0, `node --test --test-reporter=spec` | **88/88**, 0 fallos, canceladas u omitidas; 138,87 s. |
| Node 22.23.4, `node --test --test-concurrency=1 --test-reporter=spec` | **88/88**, 0 fallos, canceladas u omitidas; 377,96 s. Aviso experimental de SQLite conservado. |
| Validador del ejemplo público en ambas versiones | Válido, salida 0. |
| `git diff --cached --check` y diferencias de archivos publicados respecto a la base | Sin errores de espacios; sin cambios del tablero/Pages. |

Se añaden 19 pruebas sobre las 69 de Fase 3. También se superó una ejecución completa de Node 22 con concurrencia predeterminada (88/88, 248,05 s), antes de corregir la expectativa de orden del test de instantáneas. La última ejecución secuencial comprueba la corrección final; la concurrencia de movimientos dentro de los tests sigue activa. Parte de las ejecuciones de ambas versiones coincidió en Windows. No comparar runtimes a partir de estas duraciones: difieren concurrencia de archivos y carga del host.

La muestra de dos solicitudes simultáneas hasta convergencia de los tres clientes fue de **133,03 ms** en la ejecución final de Node 24 y **70,86 ms** en la de Node 22. Son diagnósticos de loopback sin percentiles ni aislamiento de carga; no constituyen un benchmark comparativo ni evidencia de rendimiento en Raspberry.

Las pruebas nuevas cubren convergencia de director y dos jugadores mediante polling/WebSocket, movimientos simultáneos, pérdida de una confirmación y resincronización, permiso de dirección sobre cualquier token, duplicados, versiones obsoletas, rechazo, permisos/asignaciones retirados mientras se decide, aislamiento entre salas, suplantación, desconexión y caducidad de solicitudes, datos locales ausentes/alterados, clave/firma incorrectas, sustitución solo después de probar estado, diario confirmado/no confirmado, fallos de escritura local, reinicio real del backend, migración de esquema y columnas sin contenido. La exclusión Web Locks se prueba con un proveedor simulado.

La prueba de tres clientes imprime la latencia de dos solicitudes hasta que los tres alcanzan la revisión 2. Es una muestra de loopback Windows, sujeta a carga de la suite, **no una medición ARMv7 ni una prueba de rendimiento desde navegadores reales**. La prueba de reinicio cierra SQLite, busca marcadores sintéticos de coordenadas/secretos en el archivo y comprueba el esquema permitido, además de recuperar autoridad con el estado original.

En las primeras pasadas se corrigió la respuesta a una aceptación tardía de una solicitud ya rechazada y la gestión de confirmaciones en cola tras un fallo del diario local. Una regresión adicional detectó que un test comparaba el orden aleatorio de UUID de entrada con la salida canónica ordenada: se corrigió la expectativa y ahora fuerza un orden inverso para comprobar esa normalización de forma determinista. No se redujo el coste de scrypt ni se ocultaron avisos del runtime para obtener los resultados.

## Límites pendientes

1. Integración del cliente en el tablero e IndexedDB real en navegadores: el código publicado permanece intacto. Se prueba el cliente con almacenes simulados y fallos inyectados; falta validar manualmente persistencia, cuota/evicción, cierre inesperado y Web Locks en los navegadores objetivo. No se declara completada la aceptación visual del MVP.
2. Si se pierde IndexedDB o la clave privada y no hay un candidato local coincidente, la sala permanece en espera. No hay restauración desde el backend ni transferencia/reset automático; se debe definir recuperación explícita sin saltarse la continuidad de autoridad. Una exportación pública nunca debe incorporar esa clave.
3. El conjunto actual es público para los miembros autorizados. Tokens ocultos, cambios de mapa, creación/borrado de tokens e imágenes requieren protocolos posteriores; no introducirlos como campos extra.
4. Falta medir carga sostenida, latencia de movimientos y criptografía en ARMv7. La [validación ARMv7 anterior](VALIDACION-ARMV7.md) pertenece a Fase 2 y no se reutiliza como evidencia de esta fase. Siguen pendientes runtime posterior a Node 22, proxy HTTPS/WSS, límites operativos y despliegue.
5. Los valores por defecto de frecuencia son deliberadamente bajos; las pruebas funcionales elevan el presupuesto de eventos en su entorno sintético. Antes de habilitar arrastres reales se debe decidir agrupación/frecuencia de movimientos y medir su convivencia con otros servicios.
