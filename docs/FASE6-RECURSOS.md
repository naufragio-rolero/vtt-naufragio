# Fase 6 — Recursos activos compartidos (implementación)

Fecha: 28 de octubre de 2026. Rama: `feat/backend-multijugador`.

## Alcance implementado

La sala conserva el protocolo de movimientos y la autoridad criptográfica de las Fases 1–5. Se añade una **capa independiente de difusión de recursos públicos activos**, sin nuevas tablas SQLite ni almacenamiento de contenido del juego en el backend.

- El navegador del director almacena en IndexedDB, por API/cuenta/sala, el mapa activo, los retratos de tokens y la presentación pública de los tokens.
- Una sala nueva importa **una copia** del mapa y los nombres/colores de la mesa local, sin cambiar las claves o imágenes originales. Una sala anterior sin catálogo visual utiliza metadatos genéricos.
- Un director verificado publica un manifiesto para la **época de autoridad activa**. No existe catálogo de mapas ocultos ni subida de biblioteca privada al servidor.
- Los jugadores reciben primero los metadatos de la vista pública y solicitan solo los bytes nombrados en el manifiesto. El servidor exige autenticación, pertenencia y autoridad del director.
- Socket.IO retransmite fragmentos base64 de hasta **32 KiB**, esperando confirmación del receptor antes de aceptar el siguiente. El servidor calcula el resumen SHA-256 en streaming y los jugadores vuelven a verificarlo antes de renderizar.
- No se persisten en SQLite blobs, posiciones, mapas, retratos, manifiestos ni historial de recursos. Los metadatos y transferencias viven solo en la memoria acotada del proceso.
- Mantiene el Canvas, el modo local, la cuadrícula, zoom, movimientos y los límites de permisos existentes.

## Límites del protocolo

| Parámetro | Límite |
| --- | --- |
| Mapa PNG/JPEG/WebP | 12 MiB; dimensiones máximas 8000×8000 y 20 millones de píxeles |
| Retrato PNG/JPEG/WebP | 2 MiB por imagen; mismos límites de decodificación |
| Suma de recursos públicos | 24 MiB por manifiesto |
| Tokens públicos iniciales | 64; sin crear o borrar tokens en sala |
| Transferencias simultáneas | 4 por sala y 8 globales; máximo 1 por receptor |
| Tamaño de fragmento | 32768 bytes (32 KiB), un fragmento pendiente por transferencia; codificado en base64, por debajo del máximo de 64 KiB por mensaje |
| Expiración de inactividad | 15 segundos; 8 segundos para acuse del receptor |
| Tamaño máximo por frame Socket.IO (valor predeterminado) | 65536 bytes |
| Ritmo máximo de fragmentos por conexión | 2400 por ventana fija de 60 s; el emisor regula a no más de 25 fragmentos/s **sumando todos sus receptores**; el resto de eventos conserva su limitador |

El servidor no ofrece URL pública de archivos ni comparte el mapa por HTTP. Un identificador de transferencia cancelado devuelve `TRANSFER_NOT_FOUND` como conflicto recuperable (409): no desconecta al director. La ausencia del director detiene nuevas transferencias. Si se revoca una pertenencia, el barrido periódico cancela la transferencia pendiente. Los navegadores desconectados deben volver a solicitar el estado y los recursos activos; nada se recupera del backend después de reiniciar.

## Instrucciones de comprobación

Desde `backend/`, con Node 22 o 24 instalado y las dependencias del lockfile:

```powershell
npm ci --ignore-scripts
npm test
npm run build:frontend
npm run test:browser
```

La aceptación Playwright `backend/scripts/browser-integration.js` se ha ampliado para comprobar la recepción del mapa inicial, actualización del mapa, retrato de un token y disponibilidad tras logout/recarga. Requiere las herramientas temporales Edge/Firefox indicadas en `docs/FASE5-FRONTEND.md`. La suite `backend/tests/assets.test.js` comprueba ACL, manifiestos, transferencia fragmentada y cancelación sin pérdida de autoridad. `backend/tests/assets-resilience.test.js` añade la transmisión de 12 MiB a dos receptores y la recuperación de errores del emisor. **El presente cambio no incluye un informe de ejecución en Windows o ARMv7; ejecutar antes de considerar la Fase 6 validada.**

Para inspección manual, iniciar el backend y el frontend siguiendo `backend/README.md`, crear una sala desde la mesa local y unirse desde dos perfiles autorizados. En el panel de dirección, usar «Recursos compartidos» para elegir otro mapa, editar el nombre/color/tamaño de un token y asignarle un retrato. Comprobar que los tres Canvas muestran únicamente el mapa activo y el retrato público, conservando movimientos y permisos. Verificar el modo local tras abandonar la sala y que su mapa y tokens no han sido sustituidos.

## Decisiones pendientes y riesgos conocidos

1. **No ejecutar todavía el piloto en Raspberry.** El código y las nuevas pruebas requieren validación primero en Windows. No modificar SSH/Apache ni abrir puertos para esta fase.
2. El protocolo **no es un sistema de biblioteca de mapas**: la sala distribuye un único mapa activo; mapas ocultos y otros recursos del director nunca viajan al servidor.
3. Las imágenes originales quedan en el origen IndexedDB del director. Si se pierde ese almacenamiento, **no hay recuperación de recursos ni autoridad** desde el backend. Exportación/importación y recuperación segura pertenecen a Fase 7.
4. El streaming de 12 MiB puede tardar según ancho de banda y límites de rate limiting. **No hay todavía medición ARMv7 de imágenes**. Probar carga y capacidad antes del servicio permanente.
5. Los metadatos visuales del conjunto inicial se pueden editar; todavía no se puede añadir/borrar tokens dinámicamente, crear varias escenas privadas ni sincronizar visibilidad selectiva.
6. No guardar imágenes privadas o sensibles en el manifiesto: todos los integrantes autorizados de la sala reciben el conjunto público completo.

## Correcciones tras el informe NO APTO del 28/10/2026

La primera implementación de Fase 6 fue devuelta por la validación de Windows con cuatro incidencias. Se han corregido en esta rama y **requieren nueva ejecución por Codex antes de autorizar ARMv7**:

- **F6-01:** una transferencia expirada, cancelada o eliminada ya no se interpreta como un 404 que obliga a desconectar al director. El servidor mantiene la denegación estricta de errores de autenticación y permisos.
- **F6-02:** se amplía el fragmento a 32768 bytes y el emisor distribuye el presupuesto de mensajes entre todos sus receptores, a un máximo nominal de 25 fragmentos/s. Así un mapa permitido para dos jugadores puede completar el envío sin superar la cuota de 2400 eventos/minuto del backend.
- **F6-03:** el identificador del acuse pertenece ahora al ámbito correcto. Sus promesas se resuelven siempre, incluso en fallo del comando; el temporizador se cancela mediante `finally`. Se conserva el error original.
- **F6-04:** la fixture de PNG 1×1 ha sido sustituida en las tres apariciones por una imagen RGBA con CRC correcto, verificada independientemente.

**Importante:** corregido en código y cubierto por nuevas pruebas no significa que dichas pruebas hayan pasado en el entorno Windows. Este repositorio todavía no acredita la reevaluación funcional ni una ejecución ARMv7 de la Fase 6. No desplegar sin el informe posterior.

## Segunda reevaluación Windows: temporizador de recepción (29/10/2026)

El informe de Codex correspondiente a `1b0f9449` acreditó **102/102 pruebas Node 22 y 24**, Playwright completo y transmisión de un PNG real de 12 MiB a dos navegadores. Los problemas F6-01 a F6-04 se consideraron superados, pero el veredicto siguió siendo **NO APTO** por un temporizador receptor de 600 000 ms que no se cancelaba al terminar o cerrar.

Corrección de desarrollo posterior:

- `backend/client/asset-client.js`: función centralizada `settlePending`, que elimina el registro, cancela el `setTimeout` asociado y resuelve o rechaza el acuse. Se invoca en finalización, fallo, sustitución de manifiesto, suspensión de autoridad, desconexión y `close()`. La misma disciplina cubre los acuses del emisor.
- `backend/tests/asset-client-timers.test.js`: nueva regresión que comprueba los temporizadores del receptor en finalización con hash correcto, error de relay, cierre con descarga pendiente, cambio de manifiesto y suspensión de autoridad.

Se ha realizado una **comprobación aislada del código real del cliente con un socket y temporizadores simulados**: ninguna de estas rutas deja un temporizador de 600 segundos registrado. No sustituye el test completo Node 22/24 ni las pruebas Playwright. **Sigue prohibido el piloto ARMv7 hasta que Codex ejecute la nueva suite y repita el diagnóstico de temporizadores en Windows.**

## Tercera reevaluación Windows (29/10/2026): carrera del test y contención del equipo

El informe sobre `5ad09912` concluyó **NO APTO** por una única aserción fallida de la prueba nueva de temporizadores y cancelaciones de plazo bajo fuerte carga compartida. Los diagnósticos independientes del **producto** fueron satisfactorios: dos jugadores recibieron un PNG real de 12 MiB con SHA-256 correcto, Edge/Firefox superaron la aceptación y la limpieza observada fue de cero temporizadores residuales en Node 22 y 24.

### Corrección de la carrera de prueba

En `backend/tests/asset-client-timers.test.js`, el transporte sintético registra la segunda petición **antes** de que se resuelva su `await`. Esperar solo dos solicitudes permitía evaluar la existencia del segundo temporizador demasiado pronto. Ahora la regresión:

1. Captura el identificador del temporizador del manifiesto anterior.
2. Exige que **ese identificador desaparezca** al sustituir el manifiesto.
3. Espera la segunda solicitud **y el nuevo temporizador** (exactamente uno, distinto del anterior).
4. Comprueba que `close()` también elimina el segundo temporizador.

Se conserva la misma exigencia de limpieza: no hay temporizadores permitidos tras el cierre. El helper de espera utiliza un plazo verificable, no una pausa fija arbitraria.

### Protocolo de validación reproducible

**No ejecutar suites de Node 22, Node 24 ni Playwright al mismo tiempo en el mismo Windows.** Los timeouts anteriores de 120 s (transferencia grande) y 10 s (CLI) ocurrieron durante ejecución conjunta de múltiples cargas pesadas y pasaron de forma aislada; esto **sugiere contención**, no demuestra por sí solo causalidad.

Desde una exportación limpia del commit a comprobar, instalar con `npm ci --ignore-scripts` y ejecutar **en secuencia** (cada proceso debe haber terminado y liberado sus recursos antes de iniciar el siguiente):

1. Node 22: `node --test tests/asset-client-timers.test.js`. Debe terminar con exit 0, incluida la sustitución de manifiesto.
2. Node 22: `npm run test:serial`. Ejecuta **todos los archivos de prueba** con concurrencia entre archivos limitada a uno; no reduce ni excluye las aserciones.
3. Node 24: repetir la prueba de temporizadores y `npm run test:serial`, también sin procesos de Node 22 en paralelo.
4. Ejecutar `npm run build:frontend`, revisar hashes y lista de `dist/`.
5. Con Node 24, ejecutar Playwright original con `BROWSER_USE_DIST=1` y Edge/Firefox disponibles; después, **por separado**, el ensayo de imagen PNG real de 12 MiB con dos receptores y los diagnósticos de interrupciones/SHA-256.
6. Repetir el diagnóstico de temporizadores con ambos runtimes; comprobar ausencia de handles de 600 000/12 000 ms, rechazos sin gestionar y procesos residuales.

Se conserva `npm test` (`node --test`) para desarrollo; se incorpora `npm run test:serial` como validación prepiloto reproducible en equipos de recursos compartidos. Registrar el código de salida real, duración, pruebas fallidas/canceladas y las métricas de cada **ejecución individual**. No presentar pruebas aisladas como una suite completa ni declarar APTO si alguna comprobación de aceptación falla.

**Esta actualización corrige las pruebas y el procedimiento, no añade funciones nuevas al producto.** La Fase 6 **continúa pendiente** hasta que se ejecute esta secuencia y se obtenga el informe formal. No modificar la Raspberry ni fusionar con `main`.
