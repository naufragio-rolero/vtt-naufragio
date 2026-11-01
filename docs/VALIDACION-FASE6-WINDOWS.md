# Validación de Fase 6 en Windows

Fecha: 28 de octubre de 2026. Rama: `feat/backend-multijugador`. Revisión exacta: **`68115afbcd301014fa7cf9ca67de06417291366c`**, paquete backend 0.6.0.

## Veredicto: NO APTO para el piloto ARMv7

El escenario básico con imágenes válidas funciona en tres clientes reales, pero existen fallos reproducibles de disponibilidad al interrumpir transferencias y al distribuir una imagen grande permitida a dos jugadores. Además, la suite completa y Playwright suministrado no están verdes.

**No se corrigió código, no se accedió a Raspberry y no se ejecutaron cambios SSH, despliegues, commits, merges ni pushes.** Único archivo añadido al repositorio: este informe. Los diagnósticos y sus datos sintéticos permanecen fuera del repositorio, en TEMP.

## Entorno, revisión y limitaciones del puesto Windows

- Node **22.23.4** y **24.18.0**, Windows x64.
- Edge/Chromium **156.0.4314.50**, Firefox **142.0.1**, Playwright temporal **1.56.1**. Contextos aislados, sin perfiles personales ni cuentas reales.
- Al empezar, árbol limpio en `a19e385`, con la referencia remota adelantada. El commit solicitado ya existía localmente y era descendiente. Se situó la rama exactamente en `68115afb`, sin fusionar ni crear commits.
- Windows impidió el reemplazo de varios archivos durante el checkout (`unable to unlink ...: Invalid argument`). Se completó escribiendo exclusivamente los blobs del commit solicitado y actualizando el índice. Git quedó limpio en esa revisión. Esto fue completar el checkout, no corregir la implementación.
- `npm ci --ignore-scripts` **se ejecutó desde `backend/` del workspace y falló**, también al reintentarlo al final, con `EPERM`, `syscall unlink`, `errno -4048`, sobre una dependencia existente (`backend/node_modules/accepts/README.md` en el primer intento). No se cambiaron ACL ni se forzó la eliminación. No se determina si la causa es bloqueo de archivo o permisos del entorno.
- Para continuar, se exportó con `git archive` el commit exacto a una carpeta temporal nueva. Allí, dentro de su `backend/`, **el mismo `npm ci --ignore-scripts` pasó**, instalando 24 paquetes y mostrando cero vulnerabilidades en esa ejecución de npm. No equivale a una auditoría completa de seguridad.
- Se comprobaron por hash Git los **105 archivos versionados** exportados: ninguno fue modificado por instalación, pruebas ni diagnósticos. El código original del workspace también permanece sin cambios respecto de `68115afb`.

Directorio de trabajo temporal de esta validación:

```text
%TEMP%\naufragio-fase6-validacion-ac1c94402aa44eb59d5f0a9c2325f8bf
```

Contiene `source/` —snapshot exacto—, logs, imágenes sintéticas y scripts de diagnóstico. No se incorporan esos scripts al repositorio. Todos los servicios de prueba escucharon únicamente en loopback de Windows.

## Resumen de ejecución

| Prueba | Resultado |
| --- | --- |
| Instalación en workspace | **Falla de entorno EPERM** indicada arriba. |
| Instalación limpia en snapshot temporal | **Pasa**, código de salida 0. |
| Suite completa Node 22 | **98/99**, una fallida; 347,700 s. |
| Suite completa Node 24 | **98/99**, una fallida; 268,097 s. |
| Regresión de las 96 pruebas anteriores | **Pasan las 96** en ambas versiones; el fallo corresponde a una prueba nueva de recursos. |
| `npm run build:frontend`, snapshot y workspace | **Pasa** en ambos; `dist/` generado y auditado también en la raíz del repositorio. |
| Auditoría de `dist/` | **Pasa**: lista pública y hashes correctos, sin archivos privados observados. |
| Playwright suministrado, sin cambios, sobre `dist/` | **Falla**, timeout al esperar el retrato; PNG de fixture inválido para ambos motores. |
| Diagnóstico Playwright con PNG válido y aserciones adicionales | **Pasa en Node 22 y 24**, raíz y subdirectorio, tres clientes reales. No reemplaza el resultado fallido del test suministrado. |
| Tamaños de manifiesto, píxeles y fragmentos | **Pasan** las comprobaciones auxiliares descritas abajo. |
| SHA-256 incorrecto, servidor y cliente | **Pasa el rechazo**; el cliente no publica el blob corrupto. |
| Aislamiento entre dos salas | **Pasa** en diagnóstico adicional. |
| Receptor desconectado con fragmento pendiente | **Falla**: se desconecta también al director. |
| PNG grande permitido para dos receptores | **Falla** en Node 22 y 24: `RATE_LIMITED` y pérdida del director. |
| Error del emisor en `asset-client.js` | **Falla** en ambos runtimes: `key is not defined` y rechazo posterior no gestionado. |

Los tiempos de la suite incluyen procesos concurrentes del puesto Windows; no se usan como benchmark ARMv7. El aviso experimental de `node:sqlite` en Node 22 es esperado. Para la aceptación diagnóstica de Node 22 se capturó también el código real del proceso hijo: **0**, evitando confundir ese aviso con `NativeCommandError` de PowerShell.

## Tres navegadores: resultados funcionales con imagen válida

Se creó en un script temporal un PNG ilustrado sintético de **256×256, 3558 bytes**, con cuadrícula, recinto y zona azul. Se utilizó como mapa y retrato. En la copia temporal del test se sustituyó únicamente la fixture de imagen y sus dimensiones, se instrumentaron observaciones y se añadieron verificaciones. **No se alteró ningún módulo del producto, ni siquiera en el snapshot.**

| Escenario | Director | Jugador A | Jugador B | Resultado |
| --- | --- | --- | --- | --- |
| Raíz `/` | Edge | Firefox | Edge, otro contexto | Mismo mapa, presentación de tokens y retrato. |
| Subdirectorio `/vtt/`, Socket.IO `/transport/socket.io` | Firefox | Edge | Edge, otro contexto | Mismo resultado. |

En ambos escenarios y runtimes:

1. El director inicia sesión y crea la sala copiando su mesa local. Los dos jugadores se incorporan con invitación nominativa y código.
2. Los tres reciben el mapa inicial y el retrato. El jugador no ve el editor de recursos.
3. Se cambia el mapa activo por `nuevo-mapa.png`; los tres muestran el nuevo mapa.
4. Se publica nombre `Exploradora`, color `#2458a6` y tamaño 1,5. Se comprueban esos valores en los tres clientes.
5. Una cuenta adicional, en un contexto nuevo y sin caché de sala, recibe invitación y entra tarde: obtiene mapa actual, retrato y tokens coincidentes. Ese contexto se cierra después.
6. Se recarga un jugador, inicia sesión y reabre la sala: recupera los recursos actuales y el mismo estado de tokens.
7. El jugador A mueve su token; los tres estados convergen. El jugador B no puede mover el token ajeno; también se comprueba la denegación al saltarse la interfaz. El director mueve otro token. Versiones finales de ambos: `[1,1]`.
8. Logout del director deja espera; nuevo login y recarga del director recuperan autoridad, posiciones, mapa y retrato. Un contexto sin estado oficial no recupera autoridad; la segunda pestaña respeta Web Locks.
9. Al salir se conserva el JSON original del tablero local, sus IDs y el blob original de IndexedDB. El modo local, sin backend, conserva mapa, tokens, tema y rejilla tras recargar.

Se inspeccionaron visualmente las capturas de raíz y subruta, guardadas en `evidence-valid/` y `evidence-valid-node22/` del directorio temporal. Las aserciones comparan los tres estados; las capturas muestran el director, no se presentan como tres capturas independientes. No hubo errores de página en las ejecuciones diagnósticas que terminaron en `pass`. Se observaron respuestas transitorias `DIRECTOR_NOT_READY` durante recuperación, con recuperación final correcta.

Los 96 tests previos cubren además autenticación, roles, permisos, asignaciones, reconexión y aislamiento de movimientos. La sonda adicional de recursos creó dos salas y dos directores conectados a sus respectivas salas: el receptor A solo observó el manifiesto A y el B solo el B; una petición con `roomId` de otra sala devolvió `INVALID_MESSAGE`.

## Fallos exactos y reproducción

### F6-01 — Un error recuperable de transferencia desconecta al director

**Prioridad alta.** Afecta disponibilidad de toda la partida, no únicamente al receptor.

- `backend/src/rooms/assets.js:129` y `:159`: transferencia ausente → `TRANSFER_NOT_FOUND`, HTTP lógico 404.
- `backend/src/rooms/presence.js:124`: cualquier error 404 provoca `socket.disconnect(true)`.
- `backend/tests/assets.test.js:72` y `:73`: secuencia que expone el problema en la suite suministrada.

Reproducción adicional con sockets reales:

1. Director verificado publica un manifiesto válido y un jugador pide el mapa.
2. Se desconecta el jugador antes de que llegue el fragmento del director. El relay elimina la transferencia.
3. El director envía el fragmento ya preparado para ese identificador.
4. Recibe `TRANSFER_NOT_FOUND` y su socket queda **desconectado**; la autoridad oficial se suspende.

Salida observada en Node 22 y 24:

```json
{"code":"TRANSFER_NOT_FOUND","directorStillConnected":false}
```

La prueba suministrada produce el mismo efecto por otra vía: tras rechazar un fragmento mal formado, intenta terminar la transferencia ya eliminada. Ese 404 desconecta al director. La siguiente aserción falla exactamente con:

```text
actual:   'DIRECTOR_NOT_READY'
expected: 'ASSET_NOT_FOUND'
```

**Causa comprobada:** la política general de desconexión para 404 se aplica a una ausencia de transferencia que también puede surgir legítimamente por concurrencia/desconexión. No se aplicó corrección ni se alteró la expectativa del test original.

### F6-02 — Una imagen permitida no llega a dos jugadores por el límite de fragmentos

**Prioridad alta, bloqueo para el piloto.**

- `backend/src/rooms/presence.js:106`: 2400 eventos `assets:chunk` por socket emisor y 60 000 ms.
- `backend/src/rooms/presence.js:113` y `:124`: superar el límite devuelve `RATE_LIMITED` y desconecta al director.
- `backend/client/asset-client.js:130`: bucle de fragmentos sin regulación temporal del presupuesto por conexión.
- `backend/src/rooms/assets.js:6` y `:7`: fragmentos de 8192 bytes y mapas de hasta 12 MiB.

Reproducción:

1. Generar un PNG válido de ruido RGBA, **1740×1740, 12 115 903 bytes**; está por debajo de 12 MiB y de los límites de dimensiones/píxeles.
2. Publicarlo desde un director verificado y solicitarlo desde dos jugadores, manteniendo todos los límites originales.
3. Transferir con el acuse descendente previsto, un fragmento cada vez. No se envían fragmentos simultáneos fuera del protocolo.
4. Se necesitan **1479 fragmentos por jugador, 2958 en total**. Tras **2400 acuses** el siguiente envío falla.

Observado en ambos runtimes: **un receptor completo, el segundo incompleto, `RATE_LIMITED`, director desconectado**. No hace falta tráfico malicioso ni superar el tamaño permitido. El presupuesto equivale a 18,75 MiB/min por conexión del director, compartido por sus receptores; el cliente no espera a la ventana siguiente.

El mapa pequeño de la aceptación positiva no encuentra este límite y no demuestra que el tamaño máximo funcione con dos jugadores.

### F6-03 — `key` fuera de ámbito al gestionar el error de envío

**Prioridad media/alta en recuperación de errores.**

- `backend/client/asset-client.js:135`: `const key` se declara dentro del ejecutor de `new Promise`.
- `backend/client/asset-client.js:145` y `:146`: el `catch` exterior intenta utilizar esa variable.
- `backend/client/asset-client.js:137`: queda pendiente el temporizador del acuse.

Reproducción aislada, importando el módulo real sin modificarlo:

1. Crear el cliente director con un socket de diagnóstico, época activa y blob sintético cuyo hash coincide.
2. Simular `assets:requested` y hacer que `emitWithAck('assets:chunk', ...)` devuelva `{ok:false,error:{code:'TRANSFER_NOT_FOUND'}}`.
3. Esperar el temporizador de 12 segundos.

Salida observada en Node 22 y 24:

```json
{"errors":["key is not defined"],"unhandled":["TRANSFER_TIMEOUT"]}
```

El primer error oculta el error original de la transferencia y evita la limpieza pretendida; después se rechaza sin gestionar la promesa del acuse. Es una reproducción del módulo ESM con socket de diagnóstico, distinta de las pruebas reales de transporte de F6-01/F6-02.

### F6-04 — Fixture PNG corrupta bloquea el Playwright suministrado

**Fallo de prueba, no evidencia de que el producto rechace imágenes válidas.**

- `backend/scripts/browser-integration.js:198`: PNG base64 utilizado para el retrato; la misma fixture aparece en `:78` y `:129`.
- `backend/scripts/browser-integration.js:200` y `:202`: se carga y se espera un retrato que nunca se publica.
- `frontend/multiplayer.js:323`: `createImageBitmap(file)` rechaza ese contenido durante validación.

El PNG tiene **CRC incorrecto en el bloque IDAT**; la descompresión zlib por sí sola sí termina. La ruta previa basada en `Image` llegó a mostrar el mapa, pero no demuestra que `createImageBitmap` acepte la misma entrada.

Comprobación directa en motores reales:

```text
Edge:    InvalidStateError: The source image could not be decoded.
Firefox: InvalidStateError: An attempt was made to use an object that is not, or is no longer, usable
```

La prueba original termina con:

```text
stage: / active public map and portrait transfer
TimeoutError: page.waitForFunction: Timeout 30000ms exceeded.
```

La condición que agota el plazo es `sharedView()?.portraits.includes(id)`. El director conserva mapa pero `portraits: []` y muestra el mensaje genérico de error. Con un PNG válido en el diagnóstico temporal se completa la aceptación de raíz y subruta. **La fixture original permanece intacta en el repositorio y su ejecución sigue siendo fallida.**

## Integridad, límites y persistencia

Comprobaciones adicionales sobre el código original:

- Manifiesto con mapa declarado de 12 MiB aceptado; 12 MiB + 1 rechazado.
- Retratos declarados de 2 MiB aceptados dentro del presupuesto; 2 MiB + 1 rechazado.
- Suma declarada de 24 MiB aceptada; 24 MiB + 1 rechazada, aun respetando los tamaños individuales.
- 25 millones de píxeles rechazados; fragmento de **8193 bytes** rechazado como `INVALID_CHUNK`.
- Bytes con SHA-256 incorrecto: servidor devuelve `HASH_MISMATCH`, sin finalización satisfactoria. El cliente ESM también rechaza el blob corrupto y no lo publica (`blobPublished: false`).
- Estas pruebas de límites de manifiesto validan declaraciones; no equivalen a transmitir satisfactoriamente 24 MiB. La prueba de transferencia grande demuestra el bloqueo antes descrito.
- El backend aislado conserva las diez tablas de las fases anteriores y `PRAGMA integrity_check` devuelve `ok`. No se añadieron tablas de recursos. Tras cerrar el proceso, su directorio de datos Node 22 contenía únicamente `media-probe.sqlite`, de 122 880 bytes.
- No se observaron archivos de imagen escritos por el backend en su directorio de datos. `assets.js` no importa almacenamiento ni filesystem: retiene manifiestos y estado de transferencias en memoria y calcula SHA-256 incrementalmente. No se realizó una traza global de todas las escrituras del sistema operativo; no se presenta esta inspección como tal.

## Rendimiento y memoria observados

La sonda grande separa **el backend en un proceso hijo** del generador PNG y de los sockets emisores/receptores; sus cifras RSS no incluyen los buffers de los clientes. Se muestrea `process.memoryUsage()` cada 10 ms. La ventana incluye provisión de cuentas sintéticas y el ensayo de transferencia; no garantiza detectar todos los picos instantáneos.

| Medida | Node 22 | Node 24 |
| --- | ---: | ---: |
| Pico RSS del proceso backend | **84,01 MiB** | **92,48 MiB** |
| RSS al recoger métricas | 65,55 MiB | 72,33 MiB |
| Heap usado al recoger métricas | 13,61 MiB | 16,22 MiB |
| CPU acumulada usuario / sistema, fixture + ensayo | 10,265 / 1,796 s | 7,781 / 1,906 s |
| Pared del envío hasta el rechazo por cuota | 7,378 s | 10,150 s |
| Destinatarios completos | 1 de 2 | 1 de 2 |

No se calcula utilización CPU dividiendo esos contadores por la duración del envío: incluyen también la provisión previa. Tampoco se afirma throughput máximo ni tiempo total para dos receptores, porque la transferencia falla. Son **Windows x64, no ARMv7**; estas cifras no acreditan rendimiento, temperatura o estabilidad en Raspberry. No se midió memoria de decodificación de imágenes máximas en Firefox/Edge ni carga sostenida de múltiples cambios de mapas grandes.

## Auditoría de `dist/`

Resultado tanto en el snapshot limpio como en `dist/` de la raíz del workspace, generado al cerrar la validación:

- **18 archivos públicos + `manifest.json`**, sin archivos inesperados.
- **186 234 bytes** de contenido público, aparte del manifiesto; SHA-256 de los 18 archivos coincide con lo declarado.
- Sin `backend/`, `src/`, `node_modules/`, scripts, tests, `.git`, `.env`, SQLite, claves o certificados privados.
- Sin material PEM privado ni tokens de sesión/alta completos detectados en la inspección.
- `client/indexeddb-store.js` y `frontend/room-media-store.js` son **adaptadores públicos** incluidos deliberadamente; no son el contenido privado de IndexedDB ni contienen las imágenes/cuentas de los usuarios.

El artefacto utilizado por los navegadores procede del constructor original de `68115afb`; no se editaron sus módulos para sortear errores.

## Reproducción y evidencias temporales

Todos los archivos siguientes están exclusivamente en el directorio TEMP indicado al principio:

| Archivo | Evidencia |
| --- | --- |
| `suite-node22.txt`, `suite-node24.txt` | Suite original completa y fallo exacto. |
| `playwright-provided.txt`, `playwright-instrumented.txt` | Fallo original y condición de retrato identificada. |
| `png-diagnostic.txt`, `png-crc.cjs` | Decodificación Edge/Firefox y comprobación de CRC. |
| `playwright-valid-fixtures.txt`, `playwright-valid-node22-confirmed.txt` | Aceptación ampliada con imagen válida. |
| `playwright-valid-node22-exit.json` | Código real del proceso Node 22: 0. |
| `evidence-valid/`, `evidence-valid-node22/` | Capturas de mapa ilustrado y retrato. |
| `protocol-diagnostic-final.txt`, `protocol-diagnostic-final-node22.txt` | Tres subpruebas auxiliares correctas y una fallida de desconexión; el padre también figura fallido en el runner, no son dos defectos diferentes. |
| `client-error-diagnostic.txt`, `client-error-node22.txt` | Error de ámbito y rechazo no gestionado. |
| `client-hash-diagnostic.txt` | SHA-256 del cliente: rechazo y ningún blob publicado. |
| `isolation-diagnostic.txt` | Manifiestos separados por sala y denegación cruzada. |
| `rate-memory-diagnostic.txt`, `rate-memory-node22.txt` | Cuota de fragmentos, receptores incompletos y memoria del backend aislado. |
| `dist-audit.json`, `audit-source.cjs` | Auditoría pública e integridad del snapshot. |

Para repetir las pruebas originales desde una copia limpia de la revisión:

```powershell
Set-Location <snapshot>\backend
npm.cmd ci --ignore-scripts
node --test
& '<ruta a Node 22>\node.exe' --test
npm.cmd run build:frontend
$env:BROWSER_TOOLS_DIR = Join-Path $env:TEMP 'naufragio-vtt-browser-tools'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:TEMP 'naufragio-vtt-browser-binaries'
$env:BROWSER_USE_DIST = '1'
node scripts/browser-integration.js
```

Para las reproducciones auxiliares ya preparadas, situarse en el directorio temporal:

```powershell
$validation = Join-Path $env:TEMP 'naufragio-fase6-validacion-ac1c94402aa44eb59d5f0a9c2325f8bf'
Set-Location $validation
$env:NAUFRAGIO_CHECK_ROOT = $validation
node --test protocol-diagnostic.mjs
node --test isolation-diagnostic.mjs
node client-error-diagnostic.mjs
node client-hash-diagnostic.mjs
$env:NAUFRAGIO_SNAPSHOT = Join-Path $validation 'source'
$env:NAUFRAGIO_DIAG_ROOT = Join-Path $validation ('repro-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $env:NAUFRAGIO_DIAG_ROOT | Out-Null
node rate-memory-diagnostic.mjs
```

Usar una raíz de datos nueva en cada ensayo grande: no reutilizar la SQLite sintética anterior. Los scripts de diagnóstico pueden terminar con salida fallida precisamente para dejar constancia de un defecto; los scripts observacionales imprimen el error aunque su proceso termine con 0. No deben confundirse esos códigos con una validación satisfactoria del producto.

## Cierre y condiciones para reevaluar

- Procesos HTTP/Socket.IO, contextos Playwright y procesos hijos de estas ejecuciones cerrados mediante teardown/finally. Evidencias y scripts temporales conservados para revisar el diagnóstico; sin credenciales reales.
- Ninguna conexión a Raspberry durante esta validación; SSH, Apache, firewall, certificados y Heaven's Gate no se inspeccionaron ni modificaron.
- No commits, merges ni pushes. El único cambio de trabajo del repositorio es este informe sin versionar; el código sigue exactamente en `68115afb`.
- Para reevaluar el piloto hace falta corregir **desde el flujo de desarrollo solicitado por el usuario** los defectos identificados, restaurar las pruebas suministradas y repetir imágenes grandes con dos receptores y transferencias interrumpidas. Las pruebas positivas con mapas pequeños no permiten omitir esos bloqueos.

**Conclusión: NO APTO.** El mapa ilustrado y los tokens pueden compartirse correctamente en tres navegadores con entradas válidas pequeñas, pero actualmente una operación permitida o la desconexión de un jugador puede hacer perder al director la conexión y la autoridad de la sala.
