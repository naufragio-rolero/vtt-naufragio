# Fase 1 — Base portable del backend

Fecha: 26 de octubre de 2026. Rama de trabajo: `feat/backend-multijugador`. Implementación local, sin despliegue. Runtime seleccionado por el usuario: **Node.js 22** para Raspberry ARMv7; código ESM y dependencias sin compilación nativa, preparado y probado también con Node 24.

## Entrega y alcance

Se creó `backend/` con configuración estricta mediante variables de entorno, HTTP nativo de Node, `GET /health`, Socket.IO 4.8.4 con lockfile, control de origen para ambos transportes, límites de tamaño/frecuencia/conexiones y errores centralizados sin trazas ni valores sensibles. Importar el módulo no inicia el servicio. La instancia dispone de arranque y cierre explícitos, y el ejecutable atiende señales con un plazo de cierre acotado.

La ruta de ajustes local incluye ejemplo público, esquema JSON, validador reutilizable, carga de fichero de despliegue, validación de endpoints, comprobación HTTP deliberada y descarga del JSON. Solo sirve archivos explícitos; no publica el repositorio. Ver [comandos y contrato](../backend/README.md).

Las fases del plan se mantienen separadas: las rutas de acceso, invitaciones y salas quedan reservadas con 501; el namespace de juego rechaza todas las conexiones hasta integrar autenticación. Para comprobar Socket.IO existe un namespace diagnóstico opcional, desactivado por defecto y rechazado por configuración en producción. No es una sala de juego ni una cuenta de prueba. Presencia, permisos, movimiento y retransmisión de contenido siguen pendientes de las fases 2–5. Los criterios globales de aceptación 0.2/0.3 no se marcan completos.

La pantalla local y el validador preparan CFG-02/03/05; la integración de carga/ajustes en el tablero publicado y su prueba en varios alojamientos quedan pendientes. No se modificaron `index.html`, `app.js`, `styles.css`, `.nojekyll`, workflows ni configuración de Pages. No se realizó conexión SSH ni operación en la Raspberry durante esta implementación.

## Pruebas ejecutadas y resultados

Entorno: Windows, pruebas loopback sobre arquitectura x64. Node 22.23.4 se descargó como binario precompilado a una carpeta temporal, sin cambiar el Node del sistema; Node 24.18.0 ya estaba disponible. Las versiones fijadas de Socket.IO no requieren scripts de instalación.

| Comprobación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts --no-fund` desde `backend/` | Instalación reproducible desde lockfile; 24 paquetes; auditoría de npm: 0 vulnerabilidades comunicadas en esta ejecución. |
| Node 22.23.4: `node --test --test-reporter=spec` | **27/27**, sin fallos, omitidas ni canceladas. |
| Node 24.18.0: `node --test --test-reporter=spec` | **27/27**, sin fallos, omitidas ni canceladas. |
| Validador CLI sobre el ejemplo público en Node 22 y 24 | Válido, salida 0 en ambas versiones. |
| Revisión de diferencias de archivos del tablero respecto a HEAD | Sin cambios. |
| Revisión de whitespace del diff antes del commit | Sin errores. |

Las 27 pruebas cubren:

- Configuración inmutable, valores de entorno, rutas portables y rechazo de orígenes de producción inválidos; límites con caducidad y estado acotado.
- Salud real por HTTP, método incorrecto, ruta desconocida, cabeceras y preflight CORS, rechazo de orígenes ajenos, ausencia de trazas/configuración sensible.
- Contratos de cuentas/salas cerrados, JSON inválido, content type incorrecto y límites de cuerpo con `Content-Length` y transferencia fragmentada.
- Frecuencia HTTP y rechazo de suplantación mediante `X-Forwarded-For`.
- Pantalla/recursos locales, carga de configuración real o ejemplo y rechazo de campos adicionales que pudieran contener secretos; rutas arbitrarias inaccesibles.
- Socket.IO sobre **polling y WebSocket**, ack versionado, validación estricta de mensajes y rechazo de acciones de sala/orígenes ajenos.
- Namespace de juego cerrado ante roles/tokens falsificados, diagnóstico desactivado por defecto, frames excesivos y frecuencia por socket.
- Límites de conexión, incluidos handshakes paralelos, Origin ausente y bundle de cliente no servido.
- Cierre idempotente del servidor, arranque CLI con configuración inválida y fallo controlado por puerto ocupado.

Los comandos se reproducen seleccionando la versión de Node y ejecutando `npm ci`, `npm test` y `npm run validate:site -- public/site.config.example.json` dentro de `backend/`. Los datos usados son sintéticos; no hay credenciales reales o secretos de arranque.

## Límites de la evidencia y pendientes

Las pruebas confirman funcionamiento local en Windows x64, no ejecución en ARMv7. No se ha probado interacción visual de la pantalla en navegador, certificado público, proxy Apache, acceso desde otra red, usuarios reales ni carga de una mesa completa. La política de proxy debe diseñarse antes de habilitar el servicio fuera de loopback: ahora se ignoran cabeceras reenviadas y el proxy compartiría el límite por peer.

Node 22 queda elegido para este incremento, conservando el aviso de EOL del inventario para planificar la actualización. Dominio, puerto/ruta de proxy, usuario/directorio de servicio, secretos iniciales, firewall, backup de metadatos y pruebas externas siguen sujetos a las decisiones del [inventario](INVENTARIO-BACKEND-RASPBERRY.md). La base no persiste cuentas ni contenido de partidas; la autoridad del máster y exportación/importación del MVP permanecen como requisitos de las siguientes fases.

La configuración real de conexión `docs/RASPBERRY_SSH.md` permanece como información local ignorada por Git, junto con `.env`, claves, bases de datos, logs y temporales. Solo el inventario saneado se incorpora al historial.
