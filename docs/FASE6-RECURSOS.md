# Fase 6 — Recursos activos compartidos (implementación)

Fecha: 28 de octubre de 2026. Rama: `feat/backend-multijugador`.

## Alcance implementado

La sala conserva el protocolo de movimientos y la autoridad criptográfica de las Fases 1–5. Se añade una **capa independiente de difusión de recursos públicos activos**, sin nuevas tablas SQLite ni almacenamiento de contenido del juego en el backend.

- El navegador del director almacena en IndexedDB, por API/cuenta/sala, el mapa activo, los retratos de tokens y la presentación pública de los tokens.
- Una sala nueva importa **una copia** del mapa y los nombres/colores de la mesa local, sin cambiar las claves o imágenes originales. Una sala anterior sin catálogo visual utiliza metadatos genéricos.
- Un director verificado publica un manifiesto para la **época de autoridad activa**. No existe catálogo de mapas ocultos ni subida de biblioteca privada al servidor.
- Los jugadores reciben primero los metadatos de la vista pública y solicitan solo los bytes nombrados en el manifiesto. El servidor exige autenticación, pertenencia y autoridad del director.
- Socket.IO retransmite fragmentos base64 de hasta **8 KiB**, esperando confirmación del receptor antes de aceptar el siguiente. El servidor calcula el resumen SHA-256 en streaming y los jugadores vuelven a verificarlo antes de renderizar.
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
| Tamaño de fragmento | 8192 bytes, un fragmento pendiente por transferencia |
| Expiración de inactividad | 15 segundos; 8 segundos para acuse del receptor |
| Tamaño máximo por frame Socket.IO (valor predeterminado) | 65536 bytes |
| Ritmo máximo de fragmentos por conexión | 2400 por ventana de `RATE_WINDOW_MS`; el resto de eventos conserva su limitador |

El servidor no ofrece URL pública de archivos ni comparte el mapa por HTTP. La ausencia del director detiene nuevas transferencias. Si se revoca una pertenencia, el barrido periódico cancela la transferencia pendiente. Los navegadores desconectados deben volver a solicitar el estado y los recursos activos; nada se recupera del backend después de reiniciar.

## Instrucciones de comprobación

Desde `backend/`, con Node 22 o 24 instalado y las dependencias del lockfile:

```powershell
npm ci --ignore-scripts
npm test
npm run build:frontend
npm run test:browser
```

La aceptación Playwright `backend/scripts/browser-integration.js` se ha ampliado para comprobar la recepción del mapa inicial, actualización del mapa, retrato de un token y disponibilidad tras logout/recarga. Requiere las herramientas temporales Edge/Firefox indicadas en `docs/FASE5-FRONTEND.md`. La nueva suite `backend/tests/assets.test.js` comprueba ACL, manifiestos y transferencia fragmentada. **El presente cambio no incluye un informe de ejecución en Windows o ARMv7; ejecutar antes de considerar la Fase 6 validada.**

Para inspección manual, iniciar el backend y el frontend siguiendo `backend/README.md`, crear una sala desde la mesa local y unirse desde dos perfiles autorizados. En el panel de dirección, usar «Recursos compartidos» para elegir otro mapa, editar el nombre/color/tamaño de un token y asignarle un retrato. Comprobar que los tres Canvas muestran únicamente el mapa activo y el retrato público, conservando movimientos y permisos. Verificar el modo local tras abandonar la sala y que su mapa y tokens no han sido sustituidos.

## Decisiones pendientes y riesgos conocidos

1. **No ejecutar todavía el piloto en Raspberry.** El código y las nuevas pruebas requieren validación primero en Windows. No modificar SSH/Apache ni abrir puertos para esta fase.
2. El protocolo **no es un sistema de biblioteca de mapas**: la sala distribuye un único mapa activo; mapas ocultos y otros recursos del director nunca viajan al servidor.
3. Las imágenes originales quedan en el origen IndexedDB del director. Si se pierde ese almacenamiento, **no hay recuperación de recursos ni autoridad** desde el backend. Exportación/importación y recuperación segura pertenecen a Fase 7.
4. El streaming de 12 MiB puede tardar según ancho de banda y límites de rate limiting. **No hay todavía medición ARMv7 de imágenes**. Probar carga y capacidad antes del servicio permanente.
5. Los metadatos visuales del conjunto inicial se pueden editar; todavía no se puede añadir/borrar tokens dinámicamente, crear varias escenas privadas ni sincronizar visibilidad selectiva.
6. No guardar imágenes privadas o sensibles en el manifiesto: todos los integrantes autorizados de la sala reciben el conjunto público completo.
