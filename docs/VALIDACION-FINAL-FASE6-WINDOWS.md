# Validación final de Fase 6 en Windows

Fecha: **29 de octubre de 2026**. Rama: `feat/backend-multijugador`.
Commit: `5ad0991210738057df7b890725acd6237307ffd9`.

## Veredicto

**NO APTO para dar por superada la validación previa al piloto ARMv7: la prueba nueva de regresión falla de forma reproducible.**

**La limpieza del cliente sí queda comprobada:** cero temporizadores de 600 segundos activos después de completar, cancelar o cerrar transferencias, tanto con Node 22.23.4 como con Node 24.18.0. También pasan el PNG real de exactamente 12 MiB a dos jugadores, las interrupciones y los tres clientes Edge/Firefox en `/` y `/vtt/`.

El fallo restante se localiza en la sincronización de `backend/tests/asset-client-timers.test.js:96`: consulta el contador antes de que se registre el temporizador de la descarga sustituta. Un diagnóstico independiente que espera ese registro pasa con ambos runtimes. No se ha reproducido la antigua fuga del producto, pero **las suites originales no están verdes**. No se sustituye su resultado por el de los diagnósticos.

No se ha modificado código ni tests versionados. No se han realizado commits, merges, pushes, conexiones a Raspberry ni cambios de SSH o servicios.

## Preparación y evidencia

- Git comprobado antes de modificar archivos. Se conservan íntegros los informes anteriores sin seguimiento.
- Actualización de la rama al commit solicitado, disponible localmente: completada sin conflictos. La escritura del índice Git requirió permisos ampliados; no se publicaron cambios.
- Exportación limpia mediante `git archive` a TEMP. **107 archivos comprobados contra los blobs del commit; cero diferencias**, incluidos los módulos que usan los diagnósticos.
- `npm ci --ignore-scripts` desde `source/backend/`: **exit 0**, 24 paquetes, unos 34 s. Dependencias del lockfile instaladas con Node 24 y usadas también por Node 22. No se reutiliza `node_modules` del workspace.
- Versiones verificadas: **Node 22.23.4**, **Node 24.18.0**; Playwright **1.56.1**; Edge **156.0.4314.50** y Firefox **142.0.1**.
- Cuentas, contraseñas, SQLite e imágenes exclusivamente sintéticos. Perfiles de navegador temporales y separados.

Directorio de evidencias, scripts diagnósticos y exportación, fuera del repositorio:

```text
%TEMP%\naufragio-fase6-final-2d0206397f56438a87c433bfb90743ec
```

## Suites completas originales

Se ejecutó `node --test` sin filtros ni cambios de timeout. Ambas suites compartieron sesión y recursos; también se ejecutaba la aceptación de navegadores. Hubo tiempos muy superiores a los de la sesión anterior. Las repeticiones aisladas se detallan para distinguir los timeouts del fallo determinista del test nuevo.

| Runtime | Pruebas | Superadas | Fallidas | Canceladas por timeout | Omitidas | Duración de Node | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node 22.23.4 | 103 | 100 | 1 | 2 | 0 | 730,168 s | 1 |
| Node 24.18.0 | 103 | 101 | 1 | 1 | 0 | 623,542 s | 1 |

Las cancelaciones pertenecen al runner y sus plazos, no a una interrupción manual de la suite.

### Fallo reproducible de la prueba nueva

Archivo: **`backend/tests/asset-client-timers.test.js:96`**.

```text
AssertionError [ERR_ASSERTION]: only the replacement timer may survive
0 !== 1
actual: 0
expected: 1
```

Se reproduce dentro de ambas suites y ejecutando el archivo por separado con ambos runtimes, también al repetirlo tras terminar las suites:

```powershell
# Desde backend/ de la exportación limpia, con cada runtime:
node --test tests/asset-client-timers.test.js
```

**Diagnóstico:** `fakeSocket` registra la petición en `socket.requests` antes de devolver el resultado asíncrono. La espera de la línea 95 solo exige que existan dos peticiones. `downloadAll` todavía puede estar reanudando los `await` de `command` cuando la línea 96 consulta `outstanding.size`; el temporizador nuevo se crea después. En ese instante el anterior ya se ha cancelado correctamente y el nuevo aún no existe.

La reproducción independiente espera tanto la segunda petición como su temporizador: queda **uno** para el manifiesto nuevo y **cero** al cerrar. Esto apoya que el defecto está en la sincronización de la aserción. Pendiente para corregir desde ChatGPT: sincronizar la comprobación con el registro real del nuevo plazo, sin debilitar la exigencia de cancelar el anterior. **No se ha aplicado ningún parche.**

### Timeouts y repeticiones sin cambios

| Prueba original | Suite completa | Repetición aislada |
| --- | --- | --- |
| `tests/assets-resilience.test.js:11`, 12 MiB a dos miembros | Agota 120.000 ms en Node 22 y 24 | **2/2 pasan**, exit 0, en ambos runtimes |
| `tests/lifecycle.test.js:20`, CLI con configuración inválida | Agota 10.000 ms en Node 22 | **2/2 pasan**, exit 0, Node 22 |

El archivo de resiliencia termina en **50,110 s** con Node 22 y **57,595 s** con Node 24. Su prueba de transferencia tarda respectivamente **48,191 s** y **54,917 s**. La repetición del archivo de ciclo de vida termina con exit 0 en **2,609 s de proceso**.

La contención de la ejecución conjunta es una explicación probable de estos timeouts, apoyada por las repeticiones. No se afirma haber probado causalidad ni haber superado una nueva ejecución completa en serie. Tras corregir el test determinista, conviene repetir las suites completas secuencialmente antes de aprobar el piloto.

## Limpieza explícita de temporizadores

### Repetición exacta de `residual-timer.mjs`

Se copió el diagnóstico anterior sin modificar su código, apuntando mediante su ubicación a la exportación nueva. En la repetición final con cada runtime:

```json
{
  "downloaded": true,
  "errors": [],
  "activeAfterClose": 0,
  "timeoutMs": [],
  "expectedActiveAfterClose": 0
}
```

**Exit 0** con Node 22 y 24. Los primeros intentos, durante la ejecución conjunta, mostraban cero temporizadores pero `downloaded: false` por la espera fija de 30 ms: no se consideraron prueba de una descarga completada. Se mantuvieron sus logs y se repitió el script sin cambiarlo cuando terminaron las suites.

### Finalización, cancelación, desconexión y sustitución

Diagnóstico adicional temporal `residual-lifecycle-awaited.mjs`, con el módulo real del cliente y socket sintético. Instrumenta los handles de **600.000 ms y 12.000 ms** y espera condiciones verificables, no un plazo fijo para dar por finalizada una descarga.

| Operación | Temporizadores de descarga antes | Tras la operación | Tras `close()` |
| --- | ---: | ---: | ---: |
| Completar y verificar SHA-256 | 1 | 0 | 0 |
| Cancelar mediante `assets:failed` | 1 | 0 | 0 |
| Cerrar con descarga pendiente | 1 | 0 | 0 |
| Desconectar | 1 | 0 | 0 |
| Perder la autoridad del director | 1 | 0 | 0 |
| Sustituir manifiesto | 1 anterior | 1 nuevo | 0 |

**Todas las rutas pasan con ambos runtimes**, exit 0, cero promesas rechazadas sin gestionar y cero handles instrumentados activos al finalizar. El caso de éxito exige que el blob haya sido publicado tras verificar el hash. Los primeros diagnósticos con esperas fijas de 30 ms fallaron bajo la ejecución conjunta; se conservan como tales y no sustituyen esta comprobación por condiciones.

En las transmisiones reales de 12 MiB se crean dos temporizadores de descarga y se comprueba que ambos están cancelados tras cerrar los clientes. El script solo restaura su instrumentación y hace limpieza de salvaguarda **después de medir**, sin ocultar handles activos; si quedan, marca exit 1.

## `dist/` y archivos públicos

`npm run build:frontend` en la copia limpia: **superado**.

| Auditoría | Resultado |
| --- | --- |
| Archivos | 18 públicos más `manifest.json` |
| Bytes públicos, sin el manifiesto | 187.359 |
| SHA-256 contra manifiesto | 18 correctos |
| Rutas privadas, bases de datos, claves o archivos inesperados | 0 |
| Patrones comprobados de claves privadas y tokens de sesión/alta | 0 coincidencias |

Los adaptadores públicos de IndexedDB son código del navegador, no datos guardados por el usuario. La revisión de rutas y patrones no constituye una detección universal de secretos. No se modificó el frontend publicado ni GitHub Pages.

## Tres clientes reales con Edge y Firefox

La aceptación Playwright **original sin cambios** se ejecutó contra `dist/` y terminó con **exit 0**, en **555,687 s de proceso**, con Node 24:

- Modo local sin backend: Edge y Firefox; mapa, tokens, tema, cuadrícula, zoom y recarga.
- `/`: director Edge, jugador A Firefox y jugador B Edge con contexto independiente.
- `/vtt/`: director Firefox y dos jugadores Edge separados; Socket.IO bajo `/transport/socket.io`.
- Mapa inicial, PNG corregido, retrato público y cambio de mapa recibidos.
- Movimientos convergentes, versiones finales `[1, 1]`.
- Movimiento indebido bloqueado en interfaz y en petición directa por socket.
- Invitaciones y asignaciones; cierre de sesión del director, estado en espera, recuperación y recarga con IndexedDB.
- Protección de segunda pestaña mediante Web Locks; rechazo de un contexto sin estado oficial.
- Tablero local original conservado al abandonar: JSON, identificadores y blob.
- Cero errores `pageerror` en las aserciones; comprobaciones de higiene de secretos de la aceptación superadas.

Se usaron permisos de ejecución ampliados para que Firefox pudiera lanzar sus subprocesos de pestañas, como en la validación anterior. No se deshabilitó su sandbox ni se cambiaron preferencias de seguridad.

### PNG válido de exactamente 12 MiB

Mismo archivo sintético de la reevaluación anterior: PNG RGBA **1740 × 1740**, píxeles de ruido y bloque auxiliar PNG con CRC válido para alcanzar **12.582.912 bytes**. No es un buffer arbitrario etiquetado como imagen.

```text
SHA-256: 2710f8b7a6de0fb7eb31cff6aedda3bfccc2572849fb16a9ab9db5c76d193208
```

Se repitió la extensión temporal de Playwright, importando **exclusivamente el código de la exportación nueva**. Carga por la interfaz real, comprueba el hash del blob usado para renderizar en los tres contextos y exige el mapa decodificado; después vuelve al mapa pequeño y repite el flujo de movimientos, permisos y recuperación.

| Escenario | Recepción y decodificación en los tres clientes | Pico RSS Node del ensayo | CPU usuario / sistema |
| --- | ---: | ---: | ---: |
| `/`, director Edge, jugadores Firefox/Edge | 39,753 s | 166,29 MiB | 3,890 / 1,125 s |
| `/vtt/`, director Firefox, jugadores Edge/Edge | 35,834 s | 191,39 MiB | 3,672 / 0,921 s |

Aceptación ampliada completa: **exit 0**, **228,526 s de proceso**. Sin `RATE_LIMITED`, expulsión del director ni error de página. Los tres blobs coinciden con el SHA-256 esperado.

Este RSS reúne backend y controlador Playwright, **excluye Edge/Firefox** y no representa memoria ARMv7. Las capturas conservadas son del director; las aserciones, no tres capturas simultáneas, acreditan el estado de los tres clientes.

## Backend aislado: memoria, transmisión e interrupciones

Ensayo adicional con backend en proceso hijo y tres clientes usando `createAssetClient` real. Límites del protocolo sin ampliar; dos receptores reciben el PNG completo y con hash correcto, sin errores ni `RATE_LIMITED`.

| Medición | Node 22.23.4 | Node 24.18.0 |
| --- | ---: | ---: |
| Tiempo de transferencia a ambos | 38,446 s | 53,725 s |
| Pico RSS backend | 87,43 MiB | 95,17 MiB |
| RSS final backend | 72,76 MiB | 78,87 MiB |
| Heap usado final | 14,96 MiB | 13,08 MiB |
| CPU usuario acumulada | 9,156 s | 6,296 s |
| CPU sistema acumulada | 1,968 s | 1,437 s |
| Temporizadores de 600 s activos tras cerrar | **0** | **0** |

Muestreo RSS cada 10 ms. CPU y pico incluyen la preparación de cuentas; las ejecuciones comparten recursos con otros ensayos. No comparar estas cifras como benchmark de runtimes ni extrapolarlas a ARMv7. No se hizo prueba de estabilidad prolongada.

**Interrupción real:** se desconecta un receptor al recibir el primer fragmento del PNG de 12 MiB. El otro termina con el hash correcto en **19,434 s con Node 22** y **18,663 s con Node 24**. El director sigue conectado después de otros 12,5 s de observación. Aparecen únicamente los errores recuperables esperados `TRANSFER_INTERRUPTED` y `TRANSFER_NOT_FOUND`; quedan **cero temporizadores de 600 s activos tras cerrar**. Picos de backend: 87,67 y 95,16 MiB respectivamente.

Los cuatro directorios de datos aislados contienen únicamente SQLite sintético de 122.880 bytes. Diez tablas previas de cuentas, sesiones, salas y permisos; `integrity_check: ok`. No aparecen imágenes en esos directorios ni nuevas tablas de contenido. No se afirma haber trazado todas las escrituras del sistema Windows.

## Comprobaciones adicionales y cierre de recursos

- Diagnósticos de protocolo e aislamiento: **6/6 superados** con cada runtime, contando el contenedor de subpruebas. Límites de mapa/retrato/total/píxeles y fragmentos excesivos, rechazo de SHA-256 incorrecto, manifiestos separados entre dos salas y solicitud cruzada rechazada como `INVALID_MESSAGE`.
- Cliente con bytes alterados: `HASH_MISMATCH`, `blobPublished: false`.
- Error forzado de fragmento en el emisor: tras 12,5 s con cada runtime, solo `TRANSFER_NOT_FOUND`, cero rechazos sin gestionar, sin `key is not defined` ni `TRANSFER_TIMEOUT` tardío. Ambos diagnósticos terminan con exit 0.
- Las dos suites y todos los diagnósticos han terminado; backends y navegadores se cierran en sus bloques de limpieza. La comprobación final registra **0 procesos Node y 0 procesos con perfiles Playwright temporales**. No queda ningún proceso del ensayo que mantenga servidores o conexiones abiertas. Esto no exige eliminar estados TCP `TIME_WAIT` del sistema operativo ni afecta a conexiones de otras aplicaciones.
- La comprobación explícita de handles acredita cero temporizadores instrumentados activos; no se usa únicamente la terminación del proceso como prueba de limpieza.
- Las evidencias y SQLite sintéticos se conservan en TEMP para revisión. No queda un despliegue activo. Git mantiene el commit solicitado, cero diferencias de archivos versionados y solo tres informes sin seguimiento: los dos anteriores y este.

## Evidencias y reproducción

- `source-verification.json`, `dist-audit.json`: identidad y distribución pública.
- `suite-node22.txt`, `suite-node24.txt`, `*-exit.json`: resultados completos originales, incluidos fallos y cancelaciones.
- `timer-test-node*.txt`, `timer-test-repeat-node*.txt`: fallo aislado reproducible de la aserción.
- `resilience-isolated-node*.txt`, `lifecycle-tests-isolated-node22.txt`: repeticiones de los ensayos cancelados.
- `residual-node*.txt`: primer intento del script anterior; `residual-repeat-node*.txt`: repetición con descarga completada.
- `lifecycle-awaited-node*.txt`, `residual-lifecycle-awaited.mjs`: limpieza por cada ruta y handles activos.
- `playwright-original-node24.txt`, `playwright-large.txt`, `browser-large.mjs`, `evidence-large/`: aceptación real y capturas.
- `large-valid-node*.txt`, `interrupted-node*.txt`: bytes, hashes, memoria, CPU y temporizadores de transferencias reales.
- `protocol-node*.txt`, `sender-error-node*.txt`, `client-hash.txt`, `cleanup.json`: comprobaciones adicionales y ausencia de procesos al terminar.

Desde la copia limpia, con cada runtime:

```powershell
$validation = Join-Path $env:TEMP 'naufragio-fase6-final-2d0206397f56438a87c433bfb90743ec'
Set-Location "$validation/source/backend"
npm ci --ignore-scripts
node --test
node --test tests/asset-client-timers.test.js
node --test tests/assets-resilience.test.js
npm run build:frontend
```

Para repetir los diagnósticos conservados:

```powershell
$validation = Join-Path $env:TEMP 'naufragio-fase6-final-2d0206397f56438a87c433bfb90743ec'
Set-Location $validation
node residual-timer.mjs
node residual-lifecycle-awaited.mjs
```

Los ensayos con proceso hijo requieren `NAUFRAGIO_SNAPSHOT` apuntando a `source/` y `NAUFRAGIO_DIAG_ROOT` a **un directorio nuevo** para bootstrap. Las evidencias se conservan en TEMP; los diagnósticos no se incorporan al repositorio.

## Decisión pendiente

La fuga original de 600 segundos está solucionada en las rutas comprobadas y los ensayos grandes son satisfactorios. Corregir la sincronización del test nuevo y obtener suites completas sin fallos ni cancelaciones antes de declarar **APTO** el commit para el piloto. No se ha hecho ningún despliegue ni medición nueva en Raspberry.
