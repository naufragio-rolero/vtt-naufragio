# Backend multijugador — Plan de implementación en Raspberry Pi

> Proyecto: **Naufragio VTT** · Repositorio: `naufragio-rolero/vtt-naufragio`
>
> Fecha: 24 de octubre de 2026 · Estado: **plan preparado; Raspberry pendiente de inventario por SSH**.
>
> Destinatario: Codex trabajando sobre un clon del repositorio en Windows y conectado a la Raspberry por SSH.
>
> **Esta guía es de preparación, no una orden de desplegar automáticamente.** Primero hay que inspeccionar los servicios reales y confirmar las decisiones que dependan del entorno.

## 1. Punto de partida y objetivo

Naufragio VTT ya tiene un frontend estático 0.1.2 en GitHub Pages: identificación por apodo local, rejilla, tokens, carga y calibración de un mapa, temas claro/oscuro y guardado local. **No tiene autenticación real ni sincronización entre navegadores.**

Fuentes de verdad que Codex debe leer antes de tocar código:

1. [Requisitos funcionales y decisiones](REQUISITOS.md), especialmente DEC-01 a DEC-12, AUT, COL, MAP y DAT.
2. [Plan de mapas](PLAN-MAPAS.md), para respetar el formato y persistencia actuales.
3. [Referencias de Owlbear Rodeo](REFERENCIAS-OWLBEAR.md), manteniendo una experiencia sencilla.
4. [README del repositorio](../README.md) y el propio `index.html`/`app.js` para entender el prototipo.

**Objetivo del primer hito real:** un máster inicia sesión, crea una sala y obtiene un código; al menos dos jugadores autenticados entran desde navegadores diferentes y todos ven el movimiento de un mismo token en tiempo real. Después se verificará con cuatro jugadores, según el criterio de aceptación global.

La Raspberry actuará como servidor de autenticación y retransmisión, mientras GitHub Pages podrá seguir alojando el frontend durante las pruebas.

## 2. Decisiones de producto que no deben renegociarse por accidente

| Tema | Decisión |
| --- | --- |
| Identificación | Cuentas y contraseñas **creadas por la administración**; sin registro público ni credenciales ficticias publicadas. |
| Acceso | Pantalla «Crear partida» o «Unirse a partida». El código de la sala **no sustituye** el inicio de sesión. |
| Roles | Administrador, máster/propietario y jugador; cada acción se autoriza. |
| Partida | Colección de mapas con **exactamente uno activo**; el resto está en pausa. |
| Autoridad | El **navegador del máster** es la fuente oficial del contenido y posiciones. |
| Servidor | Autentica, valida pertenencia, coordina sesiones y retransmite mensajes. **No persiste mapas, imágenes, niebla, tokens ni estados de partida.** |
| Metadatos | Puede guardar cuentas, permisos y metadatos mínimos de salas necesarios para el acceso. |
| Desconexión del máster | La sala queda **en espera**; no se elige otro máster ni se aceptan movimientos oficiales mientras no reconecte. |
| Caches de jugadores | Solo información autorizada del mapa activo; nunca enviar material de mapas pausados ni capas secretas. |
| Alcance visual | No construir hojas de personaje, atributos, reglas de combate ni herramientas avanzadas antes del MVP compartido. |
| Primer escenario | Pocos usuarios simultáneos; optimizar simplicidad y seguridad antes que escalado prematuro. |

**Importante:** un código de invitación identifica la sala, pero no es una contraseña ni otorga permisos por sí mismo. Generarlo criptográficamente (por ejemplo, 12 caracteres aleatorios sin caracteres ambiguos), evitar colisiones, permitir renovarlo y limitar intentos de entrada. Un alias legible opcional no sustituye al código seguro.

## 3. Arquitectura objetivo

~~~text
Windows (Git + Codex) ── SSH ──► Raspberry Pi
          │                          │
          └──── commits / PR ──► GitHub
                                  │
                            GitHub Pages
                             (frontend)
                                  │ HTTPS + WSS
                                  ▼
                       Proxy TLS existente
                                  │ 127.0.0.1:3400
                                  ▼
                     Node.js LTS + Socket.IO
                       ├─ usuarios / sesiones
                       ├─ salas / códigos / permisos
                       ├─ retransmisión de eventos
                       └─ SQLite (solo identidad y
                          metadatos mínimos)
                                  ▲
                         máster autoritativo
                       (estado en IndexedDB)
~~~

- El servidor Node debe escuchar **solo en `127.0.0.1`**; el puerto **3400 es una propuesta**, no un puerto ya reservado.
- El proxy será Nginx o Caddy **solo si el inventario confirma que está instalado**. No introducir un segundo proxy sin necesidad.
- Publicar la API en un subdominio HTTPS **pendiente de decidir y configurar**. No inventar DNS, IP pública ni credenciales.
- Preferir `systemd` para operar un servicio sencillo e independiente; usar Docker únicamente si la Raspberry ya sigue ese patrón y compensa.
- Directorio propuesto de despliegue: `/mnt/ssd/services/naufragio-vtt`. **No existe confirmado** y debe validarse el espacio, permisos y organización actual antes de crearlo.
- El código fuente del backend irá en `backend/` dentro de **este mismo repositorio**, separado del frontend estático.
- No tocar la web Heaven's Gate, localizada en `/mnt/ssd/html/hg`, ni reiniciar/cambiar sus servicios sin análisis y autorización.

### Qué persiste en cada lugar

| Lugar | Permitido | Prohibido |
| --- | --- | --- |
| Navegador del máster | Partida, mapas activos y pausados, recursos, tokens y estado oficial en IndexedDB. | Secretos de acceso permanentes expuestos en JS o almacenamiento local. |
| Navegador de jugador | Preferencias, caché autorizada y recursos recibidos del mapa activo. | Mapas pausados, secretos de dirección y datos fuera de su permiso. |
| Raspberry / SQLite | Usuarios, hashes de contraseña, roles, propietarios, pertenencias y metadatos mínimos de salas. | Contenido persistente de mapas, imágenes, niebla, tokens, posiciones o historial privado de partida. |
| Memoria temporal de Raspberry | Conexiones, presencia, colas acotadas y fragmentos de transmisión necesarios para retransmitir. | Copias indefinidas o volcados a disco del estado de partida. |
| GitHub público | Código, pruebas, documentación y ejemplos sin datos reales. | Contraseñas, claves, tokens, `.env` real, certificados privados, base SQLite real o inventarios con datos sensibles. |

**Consecuencia deliberada:** si el máster pierde su almacenamiento local, el servidor no podrá recuperar el contenido de la partida. La futura exportación/importación de respaldos es imprescindible; no prometer recuperación que todavía no existe.

## 4. Preparación desde Windows

En PowerShell (Git instalado):

~~~powershell
git clone https://github.com/naufragio-rolero/vtt-naufragio.git
cd vtt-naufragio
git status
git switch -c feat/backend-multijugador
~~~

- Abrir **esta carpeta clonada** en Codex para que lea la documentación y escriba el backend versionado.
- Configurar acceso SSH a la Raspberry mediante el método normal del usuario. Comprobarlo desde PowerShell con `ssh USUARIO@HOST`, sustituyendo los marcadores por los valores reales.
- No colocar contraseñas en prompts, scripts, comandos con parámetros visibles ni archivos del repositorio. Usar la autenticación SSH ya configurada.
- Codex trabajará sobre la copia local y usará SSH **solo para inventario, pruebas y despliegue autorizados**.
- Los cambios deben quedar en Git con commits verificables y un informe de despliegue; no dejar la única copia del código dentro de la Raspberry.
- Antes de fusionar, hacer `git fetch` y revisar diferencias con `main`; no sobrescribir trabajo concurrente.

## 5. Fase 0 — Inventario de Raspberry (solo lectura)

Codex debe ejecutar por SSH y registrar un **resumen saneado** de resultados (sin credenciales ni información privada):

~~~bash
cat /etc/os-release
uname -m
node --version
npm --version
systemctl is-active nginx caddy docker
sudo ss -lntp
df -h /mnt/ssd
~~~

Interpretación: si Node/npm no están instalados, tomar nota; **no instalar todavía**. Si `nginx`, `caddy` o `docker` no existen, la comprobación puede devolver un estado de error sin que eso signifique un problema del servidor.

Comprobaciones adicionales sin modificación:

- Qué servicio termina HTTPS actualmente y cómo recibe las conexiones WebSocket, sin exponer configuración sensible.
- Si el DNS y la conectividad exterior permiten un subdominio nuevo, o si existe CG-NAT y sería necesario un túnel ya aprobado.
- Versión de SO, arquitectura, memoria disponible, espacio SSD, puertos ocupados y usuario bajo el que corren los servicios.
- Si existen copias de seguridad o controles de firewall que condicionen el despliegue.
- Cómo se despliegan actualmente servicios independientes (directamente, Docker, `systemd`, etc.).
- Qué impacto tendría reiniciar o recargar el proxy compartido con Heaven's Gate.

**Entrega de esta fase:** `docs/INVENTARIO-BACKEND-RASPBERRY.md` con conclusiones técnicas y los bloqueos que requieren decisión, **sin secretos, IPs privadas innecesarias, credenciales ni volcados completos de configuración**.

### Paradas obligatorias

No ejecutar cambios con impacto sin resolver primero:

1. Dominio/subdominio real y método de exposición (proxy, túnel o configuración de red).
2. Puerto, directorio y usuario de servicio definitivos si los propuestos ya están ocupados.
3. Estrategia de integración con el proxy y condiciones de recarga sin interrumpir Heaven's Gate.
4. Confirmación de cómo se gestionarán usuarios administradores y secretos iniciales.
5. Compatibilidad del runtime Node LTS seleccionado con el sistema operativo de la Pi.

## 6. Fase 1 — Backend local y pruebas automáticas

Estructura orientativa:

~~~text
backend/
  package.json
  package-lock.json
  .env.example
  src/
    server.*
    config.*
    auth/
    rooms/
    realtime/
    storage/
  tests/
~~~

El lenguaje concreto (JS o TS) se decidirá al iniciar el backend; preferir pocas dependencias y una arquitectura comprensible. El frontend no debe depender del backend para seguir funcionando como demo local mientras se migra.

Implementación mínima:

- Node.js en rama **LTS mantenida**, con versiones fijadas mediante lockfile.
- API HTTP para salud del servicio, autenticación, creación, listado autorizado y unión a salas.
- Socket.IO para unión a canales de sala, presencia, peticiones de movimiento, confirmaciones y difusión.
- Validación estricta de mensajes y límites de tamaño/frecuencia.
- Gestión centralizada de errores, sin revelar trazas o secretos al cliente.
- Tests sin requerir la Raspberry para la mayoría de casos.
- Configuración sensible en variables de entorno; `.env.example` solo contendrá nombres y marcadores.
- `.gitignore` debe excluir `.env`, claves, DB reales, logs y archivos temporales.

## 7. Fase 2 — Cuentas y seguridad

- **Sin alta pública.** El administrador crea usuarios; el máster no crea cuentas arbitrarias por accidente.
- Contraseñas almacenadas solo con **hash lento y sal**, preferentemente Argon2id, nunca texto plano ni cifrado reversible.
- Sesiones/token de vida breve, revocación y expiración. Para la primera versión puede exigirse volver a iniciar sesión tras recargar.
- **No guardar tokens de sesión duraderos en localStorage ni insertar credenciales en URLs.**
- El frontend GitHub Pages y la API tienen orígenes distintos: restringir CORS a los orígenes permitidos y comprobar también el encabezado Origin de las conexiones WebSocket. **CORS no es autenticación.**
- Autenticar cada conexión Socket.IO y **autorizar cada evento** por usuario, sala, papel y propiedad del token.
- Limitar intentos de login y códigos fallidos; errores uniformes para no facilitar enumeración de usuarios/salas.
- Protección frente a suplantación de máster, falsificación de identificadores de token, repetición de eventos, cargas enormes y emisión a salas ajenas.
- No exponer el puerto Node en Internet; utilizar HTTPS/WSS del proxy con certificados válidos.
- No incluir datos de jugadores o secretos en logs de depuración.

Referencias de implementación: [Socket.IO — Rooms](https://socket.io/docs/v4/rooms/), [Socket.IO — CORS y allowRequest](https://socket.io/docs/v4/handling-cors/), [Socket.IO — Reverse proxy](https://socket.io/docs/v4/reverse-proxy/) y [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## 8. Fase 3 — Crear y unirse a partidas

Flujos:

1. Usuario autenticado abre «Crear partida» (si tiene permiso de máster) o «Unirse a partida».
2. El máster crea la partida, recibe un identificador interno estable y un **código de invitación aleatorio y único**.
3. Un jugador ya autenticado introduce el código. El backend verifica la sala y sus permisos; el máster puede retirar el acceso.
4. Se muestran participantes conectados y estado de la sala.
5. El máster es el **único** que activa mapas; los jugadores no reciben datos de otros mapas.
6. Cuando el máster está ausente, los jugadores ven «En espera del máster» y no pueden emitir cambios oficiales.
7. En la reconexión, el máster confirma su autoridad y envía a cada jugador **solo el estado permitido** del mapa activo.

Los códigos deben poder caducar o regenerarse. La persistencia mínima de metadatos de sala en SQLite está permitida; el contenido de la partida sigue exclusivamente en navegadores.

## 9. Fase 4 — Sincronización autoritativa

Primer recorrido de un movimiento:

1. Jugador solicita mover el token `T1` mediante un evento identificado.
2. Backend comprueba sesión, pertenencia a sala y límites; retransmite la petición **al máster**, nunca la aplica como verdad final.
3. Navegador del máster valida el permiso sobre `T1`, actualiza su estado oficial y emite la confirmación/versionado.
4. Backend retransmite el cambio a los jugadores autorizados; todos actualizan la pantalla.
5. En caso de rechazo o conflicto, el jugador restaura el último estado confirmado.

Requisitos técnicos:

- Mensajes con versión/protocolo, ID de evento y sala; validación de tipos y límites.
- Acuses de recibo, protección contra duplicados y control de versiones para reconexiones.
- No aceptar que el último cliente que escriba gane automáticamente al máster.
- Los tokens deben conservar el comportamiento local actual cuando no haya sala conectada.
- Medir latencia y rendimiento con dos navegadores primero y cuatro jugadores después.
- No confiar únicamente en que los botones estén ocultos: el permiso debe verificarse en backend y máster.

## 10. Fase 5 — Mapas e imágenes entre navegadores

El mapa actual vive en IndexedDB del navegador que lo importó; **los otros navegadores no pueden verlo por arte de magia**.

Secuencia prevista:

1. El máster anuncia el mapa activo y un manifiesto autorizado de recursos.
2. Cada jugador comprueba qué imágenes del mapa activo tiene en caché.
3. El máster transmite las que falten a través del canal definido; la Raspberry **solo retransmite temporalmente**, sin guardarlas en disco.
4. Transferencia en fragmentos, con límites de tamaño, controles de tipo, identificadores de recurso, integridad y reintentos acotados.
5. Solo tras completar la recepción se muestra el fondo; el estado del tablero sigue siendo autoritativo del máster.
6. Nunca difundir imágenes secretas o mapas pausados a usuarios sin permiso.

En el primer hito de prueba puede usarse una cuadrícula con tokens genéricos, sin imágenes. **No declarar completo el MVP jugable** hasta verificar después el envío del mapa real.

## 11. Fase 6 — Despliegue aislado y operación

Después de aprobar el inventario:

1. Preparar directorio y usuario de servicio de permisos mínimos; instalar Node LTS compatible sin sustituir versiones usadas por otros proyectos.
2. Instalar dependencias reproducibles del `backend/` y ejecutar tests.
3. Configurar `systemd`: arranque automático, `Restart=on-failure`, usuario no privilegiado, entorno separado y restricciones de acceso a disco.
4. Probar `GET /health` localmente por loopback, **antes** de publicar la API.
5. Integrar el proxy actual con HTTPS/WSS hacia el puerto interno y un subdominio; validar primero su configuración.
6. Habilitar restricciones de origen, límites de conexión, protección de login y registros sin datos sensibles.
7. Confirmar que Heaven's Gate y el resto de servicios siguen respondiendo antes y después.
8. Probar desde Windows y desde un teléfono con otra red, sin usar credenciales reales en capturas, logs o commits.
9. Dejar documentadas operaciones de arranque, parada, reinicio, actualización y rollback sin tocar servicios ajenos.

**No ejecutar** aperturas de puertos, modificaciones DNS, cambios de proxy compartido ni despliegue público sin una revisión expresa de la configuración observada y de su impacto.

## 12. Pruebas de aceptación

### Hito técnico 0.2 — Sala y conexión

- [ ] Una cuenta provisionada puede iniciar sesión; una no provisionada no puede registrarse ni acceder.
- [ ] Un máster crea una sala y obtiene un código único.
- [ ] Dos jugadores autorizados se unen por código desde navegadores distintos.
- [ ] Un código inexistente/caducado o una sesión inválida no permite entrar.
- [ ] Se muestra presencia y estado conectado/en espera.
- [ ] Dos clientes ven la posición confirmada de un token sin recargar.
- [ ] El máster puede rechazar un movimiento no autorizado.
- [ ] Al desconectar el máster, la sala se pausa; al reconectar se recupera desde su navegador.
- [ ] No se expone ningún puerto backend directamente a Internet.
- [ ] No se escriben mapas ni tokens como datos persistentes en la Raspberry.

### Hito jugable 0.3 — Partida completa

- [ ] Cuatro jugadores pueden permanecer conectados sin conflictos.
- [ ] Se cambia de mapa activo y los demás mapas permanecen en pausa.
- [ ] Los jugadores no reciben recursos secretos o de mapas inactivos.
- [ ] Se envían y almacenan en caché imágenes autorizadas sin persistirlas en servidor.
- [ ] El estado del máster sobrevive al cierre y apertura de su navegador.
- [ ] Exportación/importación de respaldo de partida (según DAT-04).
- [ ] Se mantienen tokens, rejilla, calibración y temas existentes.
- [ ] Se verifica que los demás servicios de Raspberry siguen operativos.

## 13. Entregables de Codex por fase

| Fase | Entregable |
| --- | --- |
| 0 — Inventario | `docs/INVENTARIO-BACKEND-RASPBERRY.md`; decisiones pendientes, sin secretos. |
| 1 — Base | `backend/` con instrucciones de desarrollo, tests y `.env.example`. |
| 2 — Acceso | Autenticación administrativa, tests de rechazo y permisos. |
| 3 — Salas | Crear/unirse, código seguro, presencia y reconexión. |
| 4 — Eventos | Demostración reproducible de tokens sincronizados y rechazo de movimientos ilegales. |
| 5 — Recursos | Protocolo de imágenes con pruebas de autorización, fragmentación y caché. |
| 6 — Operación | `docs/DESPLIEGUE-BACKEND.md` con configuración observada, rollback, comprobaciones y decisiones confirmadas. |

Cada fase debe actualizar este documento, los requisitos cuando corresponda y el README. No afirmar que una fase está terminada solo porque compila: debe pasar sus pruebas de aceptación.

## 14. Instrucción de arranque para Codex (copiable)

> Estás trabajando en el repositorio `naufragio-rolero/vtt-naufragio`, clonado en Windows, y tienes acceso SSH a nuestra Raspberry Pi. Lee COMPLETAMENTE `README.md`, `docs/REQUISITOS.md`, `docs/PLAN-MAPAS.md`, `docs/REFERENCIAS-OWLBEAR.md` y este documento antes de actuar.
>
> Tu primera tarea es exclusivamente la **Fase 0 — Inventario de Raspberry** de este documento. Comprueba sistema operativo, versiones de Node/npm, proxy existente, `systemd`, Docker si existe, puertos, espacio SSD y compatibilidad con los servicios actuales. No instales nada, no abras puertos, no cambies DNS, no alteres Heaven's Gate (`/mnt/ssd/html/hg`) ni reinicies servicios compartidos.
>
> Escribe `docs/INVENTARIO-BACKEND-RASPBERRY.md` con los resultados saneados, las decisiones pendientes y una propuesta concreta y segura de implementación del backend. No vuelques secretos, IPs sensibles, claves, archivos `.env` ni configuraciones completas a Git. Valida que el informe es coherente con el diseño de máster autoritativo y sin persistencia del contenido de partidas en servidor. Prepara el commit en una rama de trabajo y **avisa de los puntos que requieren decisión antes de comenzar instalaciones o despliegue**.
>
> Después de aprobar el inventario avanzaremos secuencialmente por las fases de este documento, implementando código versionado, tests y documentación reproducible. Mantén GitHub Pages funcionando durante la transición.

---

**Criterio rector:** conseguir un multijugador fiable y ligero al estilo Owlbear Rodeo, sin rehacer innecesariamente el tablero local ni convertir la Raspberry en un almacén de nuestras partidas.
