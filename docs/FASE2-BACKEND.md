# Fase 2 — Cuentas, sesiones, invitaciones y permisos

> Informe histórico de la entrega del 26 de octubre. El 27 se completó la [validación temporal ARMv7](VALIDACION-ARMV7.md) y después la [Fase 3 local de salas/presencia](FASE3-BACKEND.md). Los resultados y límites siguientes describen la Fase 2 original, no el estado actual del namespace.

Fecha: 26 de octubre de 2026. Rama: `feat/backend-multijugador`. Se conserva la base de Fase 1 y se implementa exclusivamente acceso y autorización preparatoria. No se despliega ni se conecta a la Raspberry.

## Decisiones e implementación

- SQLite integrado en Node (`node:sqlite`), sin driver npm ni compilación adicional. Esquema versionado con tablas estrictas para usuarios, sesiones, invitaciones de alta y etiquetas. No persiste mapas, imágenes, tokens de tablero, posiciones ni contenido de partidas. La migración y las escrituras sensibles son transaccionales; las consultas parametrizadas no interpolan entradas.
- Alternativa a Argon2id: `scrypt` integrado en Node 22, N=32768, r=8, p=3, sal aleatoria de 16 bytes, resultado de 64 bytes y comparación segura. Es uno de los perfiles de OWASP (aproximadamente 32 MiB), elegido por la RAM limitada del inventario y para evitar un addon compilado en ARMv7. Una derivación activa y cuatro en cola; sin rebajar parámetros en las pruebas. Contraseñas de 15–128 puntos de código, hasta 512 bytes UTF-8, sin truncamiento.
- Bootstrap local interactivo, contraseña oculta y confirmada; sin cuenta predeterminada, sin argumentos secretos, sin contraseña por entorno/pipe ni endpoint remoto. Solo puede crear la primera cuenta; la comprobación se repite dentro de la transacción para evitar dos administradores iniciales simultáneos.
- Tokens opacos de sesión con 256 bits de entropía, almacenados únicamente como SHA-256. Bearer por cabecera, conservación prevista solo en memoria del cliente, sin cookies, JWT ni tokens en URLs. Expiración absoluta configurable (30 minutos por defecto), límite de cinco sesiones, logout individual/global, cambio de contraseña y revocación administrativa.
- Administración provisiona cuentas y roles; dirección emite invitaciones exclusivamente para cuentas ordinarias. Se vuelven a comprobar sesión/rol después del hash para no ejecutar una operación administrativa con una autorización revocada mientras se calculaba.
- Invitaciones `signup_…` independientes de sesiones y códigos de sala; token de 256 bits, un uso, caducidad y revocación. Solo se devuelve al emitirla y se almacena su hash. Consumo atómico, con nueva validación al registrar; rollback si la cuenta no puede crearse. Si el emisor se desactiva o cambia de rol se revocan sus invitaciones pendientes. No se habilita autorregistro libre ni se concede pertenencia a partidas.
- IDs estables `admin`, `director`, `user`; etiquetas en SQLite configurables solo por administración y reflejadas en la configuración pública. Cambiar una etiqueta no cambia capacidades. Las modificaciones de cuenta revocan sesiones; el último administrador activo se protege contra desactivación/degradación.
- Política central que prepara pertenencia, propiedad, asignación de tokens y permiso de dados. Ese contexto será obtenido por el servidor en Fase 3. Las rutas actuales no aceptan permisos del cliente, no crean salas ni suben recursos. Usuario ordinario recibe 403 al intentar esas acciones. Administración técnica no adquiere dirección de sala automáticamente.
- El namespace de juego comprueba identidad, pero rechaza también las sesiones válidas con `ROOM_AUTHORIZATION_UNAVAILABLE`. El diagnóstico técnico de Fase 1 sigue optativo y prohibido en producción.

El contrato HTTP, comandos locales, rangos de entorno y precauciones sobre SQLite están descritos en [backend/README.md](../backend/README.md). La pantalla publicada de Pages sigue sin integración de cuentas; no se modifica durante esta fase.

## Pruebas y resultados

Las pruebas usan datos aleatorios sintéticos, bases SQLite temporales o en memoria y puertos loopback efímeros en Windows x64. No usan cuentas de la Raspberry ni credenciales reales.

| Comprobación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts --offline --no-audit --no-fund` | Instalación reproducible desde lockfile y caché local; 24 paquetes. No hay dependencias nuevas de ejecución respecto a Fase 1. |
| Node 22.23.4: `node --test --test-reporter=spec` | **52/52**, sin fallos, cancelaciones ni pruebas omitidas; aproximadamente 45,8 s. Incluye el aviso experimental de SQLite, sin ocultarlo. |
| Node 24.18.0: `npm test -- --test-reporter=spec` | **52/52**, sin fallos, cancelaciones ni pruebas omitidas; aproximadamente 33,6 s. |

Las suites se ejecutaron en paralelo entre versiones; estas duraciones no constituyen un benchmark de autenticación ni una estimación de rendimiento de la Raspberry. Para reproducir: seleccionar una de las versiones, entrar en `backend/`, ejecutar `npm ci --ignore-scripts` y `npm test`. Las pruebas mantienen los parámetros reales de scrypt. No se creó ninguna cuenta real en la base de desarrollo.

La suite conserva las comprobaciones de Fase 1 y añade:

- Bootstrap sin credenciales por defecto, política de contraseña, rechazo de canalización/argumentos, entrada oculta y restauración del terminal, carrera de dos bootstraps.
- Login uniforme para usuarios inexistentes, desactivados o contraseña incorrecta; sesión actual, logout, logout-all, caducidad y rechazo de cookies/query como transporte de identidad.
- Provisión administrativa, rechazo de elevación por directores/usuarios, inyección de campos de rol/permisos en alta/login y denegación de salas/recursos a usuarios ordinarios.
- Cambio de contraseña, revocación de todas las sesiones afectadas, cambio de rol, desactivación, revocación administrativa y protección del último administrador.
- Invitaciones caducadas, usadas, revocadas, fuera del ámbito del director o del tipo incorrecto; cuota y duración máxima; registro simultáneo de un solo uso y rollback ante nombre duplicado.
- Revocación durante el hash de registro/provisión, para verificar que la autorización se vuelve a comprobar antes de escribir.
- Etiquetas de rol configurables sin concesión de permisos, modelo de tokens asignados/dados y ausencia de privilegios implícitos de administración sobre partidas.
- Persistencia SQLite tras reapertura, salts diferentes, ausencia de contraseñas y tokens opacos sin hash en el archivo, esquema sin contenido de partidas y rechazo de versiones desconocidas.
- Coste real de scrypt y cola acotada, límites de intento por peer/cuenta, expiración de la ventana e imposibilidad de eludirlos con nombre en mayúsculas o `X-Forwarded-For`.
- Namespace de juego inaccesible tanto con sesión válida como inválida/revocada, mediante polling y WebSocket.

En la primera pasada se ajustaron dos pruebas heredadas: el detector de trazas confundía el aviso experimental de Node 22 con una traza, y una limpieza de ficheros temporal de Windows eliminaba la base antes de cerrarla. Se corrigieron la expresión de detección y el orden de cierre/limpieza; no se ocultaron los avisos del runtime ni se redujo el coste de contraseña.

## Límites y decisiones pendientes

1. Validación realizada en Windows x64; la ejecución, latencia y memoria en ARMv7 requieren comprobarse en una fase autorizada. Node 22 emite un aviso de API SQLite experimental. Se conserva el pin y se debe planificar su actualización antes del EOL. La entrada oculta se verifica con un terminal simulado y el rechazo de entrada canalizada con un proceso real; no se ha completado un bootstrap manual en una terminal privada real durante esta entrega.
2. No hay interfaz de login/registro en el tablero de Pages; la fase entrega API y comando local. El cliente futuro deberá recoger contraseñas de forma privada, mantener la sesión en memoria y validar la invitación antes de habilitar el formulario.
3. Las salas, pertenencias, permisos por token y presencia todavía no se persisten ni administran. El modelo central no debe recibir contexto de permisos desde mensajes del cliente. No abrir el namespace de juego hasta completar esas comprobaciones en Fase 3.
4. Rate limiting en memoria, por peer/cuenta, de un solo proceso; reiniciar lo restablece. Detrás de proxy se comparte el peer y no se confía en cabeceras reenviadas. Los límites externos y la confianza del proxy se acordarán antes de publicar.
5. Definir procedimiento de recuperación de cuentas/contraseñas perdidas y custodia de administradores adicionales. No hay recuperación por correo, MFA ni consulta de contraseñas. El cambio propio requiere la contraseña anterior.
6. Definir retención de invitaciones caducadas/usadas/revocadas, paginación más allá del límite actual de 1000 metadatos y copia consistente/restauración de SQLite con WAL. En Windows se deben aplicar ACL a la carpeta privada de datos; en Linux el código crea directorio y fichero con permisos restrictivos.
7. No hay secretos globales que crear para firmar tokens: son opacos y revocables en SQLite. La primera contraseña se introduce únicamente en la terminal privada del comando de bootstrap. Dominio, proxy HTTPS, UFW, directorio/usuario definitivo y recuperación del host siguen pendientes del inventario y de la fase operativa.

Referencias: [OWASP, almacenamiento de contraseñas/scrypt](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt), [Node 22, criptografía](https://nodejs.org/docs/latest-v22.x/api/crypto.html), [Node, SQLite](https://nodejs.org/api/sqlite.html). Esta entrega conserva el máster autoritativo y la prohibición de guardar contenido de partidas en servidor.
