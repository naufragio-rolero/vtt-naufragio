# Backend multijugador — Despliegue portable y referencia Raspberry Pi

Actualización F7: [proxy de confianza, invitados temporales mediante QR y preparación de producción](FASE7-ACCESO-QR.md). El esquema SQLite pasa a 4, conservando autenticación, pertenencias y autoridad de las fases anteriores. Los artefactos systemd/Apache son propuestas sin aplicar; la autorización actual comprende exclusivamente código, pruebas Windows y documentación. La numeración histórica del plan siguiente se conserva: los informes de implementación F1–F7 concretan lo realmente entregado y sus limitaciones.

> Proyecto: **Naufragio VTT** · Repositorio: `naufragio-rolero/vtt-naufragio`
>
> Fecha del plan: 24 de octubre de 2026 · Actualización: 27 de octubre de 2026. Estado: **Fase 5 de integración del frontend implementada y validada localmente, sin despliegue**. Véanse [inventario](INVENTARIO-BACKEND-RASPBERRY.md), [Fase 1](FASE1-BACKEND.md), [Fase 2](FASE2-BACKEND.md), [validación ARMv7 de Fase 2](VALIDACION-ARMV7.md), [Fase 3](FASE3-BACKEND.md), [Fase 4](FASE4-BACKEND.md) y [Fase 5](FASE5-FRONTEND.md).
>
> Destinatario: Codex trabajando sobre un clon del repositorio en Windows y conectado a la Raspberry por SSH.

> **28 de octubre de 2026:** construcción de `dist/` y pruebas Windows; después de diagnosticar y autorizar expresamente la excepción SSH, piloto real ARMv7 con tres navegadores, cinco minutos de estabilidad y recuperación tras reinicio del backend. Limpieza remota y rollback SSH completos. [Informe, métricas, scripts y límites](PILOTO-PRIVADO-RASPBERRY.md). No hay backend público ni instalación permanente; Apache y demás servicios sin cambios.
>
> **Esta guía es de preparación, no una orden de desplegar automáticamente.** La Raspberry es nuestra instalación piloto, **no una dependencia del VTT**. Antes de desplegar en cualquier máquina, hay que inspeccionar sus servicios y confirmar las decisiones dependientes del entorno.

## 1. Punto de partida y objetivo

Naufragio VTT ya tiene un frontend estático 0.1.2 en GitHub Pages: identificación por apodo local, rejilla, tokens, carga y calibración de un mapa, temas claro/oscuro y guardado local. **No tiene autenticación real ni sincronización entre navegadores.**

Fuentes de verdad que Codex debe leer antes de tocar código:

1. [Requisitos funcionales y decisiones](REQUISITOS.md), especialmente DEC-01 a DEC-16, AUT, CFG, COL, MAP y DAT.
2. [Plan de mapas](PLAN-MAPAS.md), para respetar el formato y persistencia actuales.
3. [Referencias de Owlbear Rodeo](REFERENCIAS-OWLBEAR.md), manteniendo una experiencia sencilla.
4. [README del repositorio](../README.md) y el propio `index.html`/`app.js` para entender el prototipo.

**Objetivo del primer hito real:** una persona con perfil de dirección inicia sesión, crea una partida y obtiene un código; puede invitar a alguien nuevo para que cree una cuenta ordinaria. Al menos dos participantes autenticados entran desde navegadores diferentes, con permisos limitados, y todos ven el movimiento autorizado de un mismo token. Después se verificará con cuatro participantes, según el criterio de aceptación global.

**Despliegue piloto:** Raspberry para autenticación y retransmisión; GitHub Pages para el frontend. **Despliegues alternativos:** cualquier servidor web estático para la interfaz y cualquier host compatible para el backend, incluso en el mismo dominio mediante proxy.

## 2. Decisiones de producto que no deben renegociarse por accidente

| Tema | Decisión |
| --- | --- |
| Identificación | Sin registro público: la administración provisiona cuentas y perfiles de dirección; cada máster autorizado puede generar invitaciones de alta de un solo uso para **cuentas ordinarias**. |
| Acceso | Pantalla «Crear partida» **solo para dirección** y «Unirse a partida» para participantes autorizados. La invitación de alta de cuenta y el código de partida son cosas diferentes; ninguno sustituye una sesión autenticada. |
| Roles | IDs internos estables (`admin`, `director`, `user`), con **nombres visibles configurables**; cambiar una etiqueta no cambia permisos. |
| Partida | Colección de mapas con **exactamente uno activo**; el resto está en pausa. |
| Autoridad | El **navegador del máster** es la fuente oficial del contenido y posiciones. |
| Servidor | Autentica, valida pertenencia, coordina sesiones y retransmite mensajes. **No persiste mapas, imágenes, niebla, tokens ni estados de partida.** |
| Metadatos | Puede guardar cuentas, permisos y metadatos mínimos de salas necesarios para el acceso. |
| Desconexión del máster | La sala queda **en espera**; no se elige otro máster ni se aceptan movimientos oficiales mientras no reconecte. |
| Caches de jugadores | Solo información autorizada del mapa activo; nunca enviar material de mapas pausados ni capas secretas. |
| Permisos de usuario | **Denegación por defecto:** no crea partidas, no sube mapas ni imágenes de tokens y no edita recursos globales. Solo entra en salas autorizadas, mueve tokens asignados y tira dados si el director lo permite cuando esa herramienta esté disponible. |
| Permisos de dirección | Crear partidas, invitar a cuentas ordinarias, administrar invitados y permisos, subir mapas y tokens, activar mapas, exportar e importar contenido. |
| Frontend portable | Se aloja en GitHub Pages o en otro servidor web estático. Configuración pública del sitio y pantalla de ajustes para endpoints de autenticación, tiempo real y nombres de roles. |
| Exportación MVP | En la versión jugable 0.3 se exportan/importan **partidas completas, mapas individuales y tokens**, con sus recursos. |
| Alcance visual | No construir hojas de personaje, atributos ni reglas de combate antes del MVP compartido. |
| Primer escenario | Pocos usuarios simultáneos; optimizar simplicidad y seguridad antes que escalado prematuro. |

**Importante:** hay **dos clases de invitación**. Una invitación de **alta de cuenta** permite registrarse una sola vez como usuario, caduca y no concede permisos elevados; un **código de partida** identifica una sala para cuentas ya autenticadas. Son independientes, aleatorios, revocables y no sustituyen una autorización. Generar códigos impredecibles (por ejemplo, 12 caracteres aleatorios sin caracteres ambiguos), evitar colisiones y limitar intentos.

## 3. Arquitectura objetivo

~~~text
Windows (Git + Codex) ──► GitHub ──► Frontend estático
                    (Pages / Nginx / Apache / otro host)
                                      │
                               site.config.json
                                      │ HTTPS + WSS
                                      ▼
                         Proxy TLS o mismo origen
                                      │
                             Backend portable
                            Node.js + Socket.IO
                        ├─ cuentas / invitaciones
                        ├─ roles / salas / permisos
                        ├─ retransmisión de eventos
                        └─ SQLite (solo identidad
                           y metadatos imprescindibles)
                                      ▲
                             máster autoritativo
                         (estado en su IndexedDB)

Piloto Raspberry: Codex desde Windows ── SSH ──► Pi
~~~

- En el despliegue Raspberry, Node debe escuchar **solo en `127.0.0.1`**; el puerto **3400 es una propuesta**, no un puerto ya reservado. En otros hosts, usar enlace interno equivalente.
- Para Raspberry, aprovechar Nginx o Caddy **solo si el inventario confirma que está instalado**. En otros alojamientos usar el proxy compatible existente. No introducir un segundo proxy sin necesidad.
- Publicar la API en un origen HTTPS **configurable por despliegue** (subdominio o misma sede mediante proxy), pendiente de decidir para la Raspberry. No inventar DNS, IP pública ni credenciales.
- Preferir `systemd` para operar un servicio sencillo e independiente; usar Docker únicamente si la Raspberry ya sigue ese patrón y compensa.
- Directorio propuesto **solo para Raspberry**: `/mnt/ssd/services/naufragio-vtt`. **No existe confirmado** y debe validarse antes de crearlo; el backend no debe contener esa ruta hardcodeada.
- El código fuente del backend irá en `backend/` dentro de **este mismo repositorio**, separado del frontend estático.
- En la Raspberry, no tocar Heaven's Gate (`/mnt/ssd/html/hg`) ni reiniciar/cambiar sus servicios sin análisis y autorización. En otros hosts aplicar aislamiento análogo.

### Frontend portable y pantalla «Configuración del sitio»

Requisito **P0**: la misma carpeta de frontend debe funcionar en GitHub Pages o en un servidor web estático convencional, en raíz o subruta, sin depender de la Raspberry. Los endpoints nunca deben quedar fijados en `app.js` ni inferirse de forma rígida desde GitHub Pages.

- Cargar un fichero público y **relativo a la ruta base** del despliegue, por ejemplo `site.config.json`, con URL base de API/autenticación, URL de tiempo real (o la misma API), ruta Socket.IO, nombre del sitio y etiquetas visibles de roles.
- Incluir una pantalla **«Configuración del sitio»** que muestre el estado de conexión, permita validar una configuración de prueba y preparar cambios. El administrador puede comprobar conectividad y descargar el JSON configurado.
- **Límite del alojamiento estático:** una pantalla HTML no puede guardar un cambio global en los archivos de GitHub Pages. Para publicar ajustes comunes, se debe actualizar/republicar `site.config.json` mediante el proceso de despliegue. Si un backend ofrece administración autenticada, podrá disponer de una API propia para guardar configuración global allí; no confundirla con escribir en Pages.
- Un ajuste local del navegador es útil para desarrollo, **no concede privilegios ni modifica la configuración de los demás visitantes**. No aceptar cambios de endpoint por parámetros de URL ni redirecciones ocultas: mostrar siempre el origen efectivo de autenticación antes de introducir credenciales y advertir de cualquier cambio.
- No insertar secretos, tokens, contraseñas, claves de firma o credenciales en ese JSON: cualquier visitante puede leerlo.
- Validar HTTPS/WSS en producción y permitir HTTP local solo en desarrollo; comprobar formato de endpoints, conectividad y respuestas con mensajes de error claros.
- Configurar el backend con una lista explícita de orígenes frontend autorizados; no fijar únicamente `https://naufragio-rolero.github.io`. Para WebSocket, comprobar el origen además de CORS. La autenticación y autorización siguen siendo obligatorias aunque el origen esté permitido.
- Los nombres visibles `Usuario`, `Máster` y `Administrador` son **etiquetas iniciales**, no IDs de autorización. Usar internamente capacidades/roles estables (`user`, `director`, `admin`).

Ejemplo **público y sin secretos**:

~~~json
{
  "siteName": "Naufragio VTT",
  "apiBaseUrl": "https://api.ejemplo.invalid",
  "realtimeBaseUrl": "https://api.ejemplo.invalid",
  "socketPath": "/socket.io",
  "roleLabels": {
    "user": "Usuario",
    "director": "Máster",
    "admin": "Administrador"
  }
}
~~~

El dominio `ejemplo.invalid` es un marcador, **no** una dirección desplegada. Se decide el formato definitivo del archivo tras comprobar cómo se sirve el frontend en una subruta y cómo funciona la autenticación entre orígenes.

### Qué persiste en cada lugar

| Lugar | Permitido | Prohibido |
| --- | --- | --- |
| Navegador del máster | Partida, mapas activos y pausados, recursos, tokens y estado oficial en IndexedDB. | Secretos de acceso permanentes expuestos en JS o almacenamiento local. |
| Navegador de jugador | Preferencias, caché autorizada y recursos recibidos del mapa activo. | Mapas pausados, secretos de dirección y datos fuera de su permiso. |
| Backend / SQLite (Raspberry u otro host) | Usuarios, hashes de contraseña, roles, invitaciones de alta de un solo uso, propietarios, pertenencias y metadatos mínimos de salas. | Contenido persistente de mapas, imágenes, niebla, tokens, posiciones o historial privado de partida. |
| Memoria temporal del backend | Conexiones, presencia, colas acotadas y fragmentos de transmisión necesarios para retransmitir. | Copias indefinidas o volcados a disco del estado de partida. |
| GitHub público y cualquier hosting estático | Código, pruebas, documentación y configuración **pública** de endpoints/nombres. | Contraseñas, claves, tokens, `.env` real, certificados privados, base SQLite real o inventarios con datos sensibles. |

**Consecuencia deliberada:** si el máster pierde su almacenamiento local, el servidor no podrá recuperar el contenido de la partida. La **exportación/importación de partidas, mapas y tokens forma parte del MVP 0.3** y es imprescindible para cambiar de navegador y recuperar contenido; no prometer recuperación que todavía no existe.

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

Para la **instalación piloto Raspberry**, Codex debe ejecutar por SSH y registrar un **resumen saneado** de resultados (sin credenciales ni información privada). En otros hosts se realizará un inventario equivalente adaptado al sistema, nunca se reutilizarán órdenes Linux sin revisarlas:

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
6. Origen público del frontend, ubicación de `site.config.json` y lista de orígenes permitidos de la API.

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

El lenguaje concreto (JS o TS) se decidirá al iniciar el backend; preferir pocas dependencias y una arquitectura comprensible. El frontend no debe depender del backend para seguir funcionando como demo local mientras se migra. Las rutas y la configuración de backend deben ser portables y no referirse a Raspberry por defecto.

Implementación mínima:

- Node.js en rama **LTS mantenida**, con versiones fijadas mediante lockfile.
- API HTTP para salud del servicio, autenticación, invitaciones de alta, creación, listado autorizado y unión a salas.
- Socket.IO para unión a canales de sala, presencia, peticiones de movimiento, confirmaciones y difusión.
- Validación estricta de mensajes y límites de tamaño/frecuencia.
- Gestión centralizada de errores, sin revelar trazas o secretos al cliente.
- Tests sin requerir la Raspberry para la mayoría de casos.
- Configuración sensible del backend en variables de entorno; `.env.example` solo contendrá nombres y marcadores. Añadir un `site.config.example.json` **público** y el esquema/validador correspondiente para el frontend.
- `.gitignore` debe excluir `.env`, claves, DB reales, logs y archivos temporales.

### Estado al cerrar Fase 1 — 26 de octubre de 2026 (histórico)

Implementados en [`backend/`](../backend/README.md): Node 22.23.4 como referencia, ESM compatible con Node 24+, HTTP, `/health`, Socket.IO, validación/límites, configuración por entorno, lockfile y 27 pruebas superadas en Node 22.23.4 y 24.18.0. La pantalla de ajustes y los artefactos de configuración pública se sirven aislados desde el backend local, sin modificar el tablero de GitHub Pages.

En aquella entrega, las superficies de autenticación/invitaciones/salas de la lista anterior eran contratos reservados que respondían 501, y Socket.IO denegaba el namespace de juego hasta incorporar identidad. El namespace diagnóstico opcional solo comprueba transporte/mensajes y se prohíbe en producción. Las funciones de acceso, salas, presencia, movimiento y difusión se completan secuencialmente en las fases 2–5. Ninguna prueba de aceptación multijugador se considera satisfecha por estos contratos. En Fase 1 no había persistencia ni instalación remota. [Resultados y límites de la validación](FASE1-BACKEND.md).

## 7. Fase 2 — Cuentas, invitaciones y permisos

- **Sin alta pública.** La administración crea perfiles de dirección y cuentas; un máster autorizado puede emitir **invitaciones individuales de un solo uso** para que nuevos jugadores creen sus cuentas ordinarias. El máster no crea cuentas con permisos de dirección o administración por esa vía.
- El formulario de alta solo puede activarse tras comprobar una invitación válida, no usada, no revocada y no caducada. El enlace/token de alta debe distinguirse del código de sala y no aparecer en logs ni compartirse automáticamente.
- El máster puede invitar a un usuario **ya registrado** a su partida o emitir una invitación combinada: alta de cuenta ordinaria seguida de pertenencia a esa partida. La cuenta no recibe automáticamente derechos sobre otras partidas.
- Separar IDs internos estables (`admin`, `director`, `user`) de **etiquetas visibles configurables**. Cambiar «Máster» por «Director de juego» no altera las capacidades del rol.
- Denegar por defecto todas las operaciones no expresamente concedidas al usuario: crear partida, invitar a perfiles elevados, subir imágenes, crear mapas/tokens de catálogo, cambiar el mapa activo y editar contenido ajeno.
- Permitir al usuario únicamente entrar en salas autorizadas, mover **tokens asignados** y **tirar dados cuando el director active el permiso en esa partida**. Preparar este control desde 0.2; el interfaz de dados y su historial continúan en la fase 0.4 mientras no se acuerde anticiparlos.
- La subida/importación de imágenes de mapas, tokens y antagonistas corresponde exclusivamente al director/máster autorizado. La exportación/importación completa del estado de partida también queda restringida a dirección por defecto.

### Matriz mínima de permisos

| Acción | Administrador técnico | Director/máster de la partida | Usuario ordinario |
| --- | --- | --- | --- |
| Configurar servicio y nombres globales de roles | Sí | No | No |
| Provisionar directores/administradores | Sí | No | No |
| Emitir invitación de alta de usuario ordinario | Sí | Sí | No |
| Crear partidas | Si dispone también de capacidad de dirección | Sí | **No** |
| Unirse a partida | Con autorización | Sí, si es propietario | Solo invitado/autorizado |
| Subir mapas, imágenes y tokens | Según permiso de dirección | **Sí** | **No** |
| Activar mapas y asignar tokens | Según permiso de dirección | **Sí** | **No** |
| Mover tokens | Según asignación | Todos los de su partida | Solo los asignados |
| Tirar dados, si la herramienta existe | Según autorización | Sí | **No**, salvo permiso concedido por director |
| Exportar/importar partida, mapa o recurso | Según autorización | **Sí** | **No**, por defecto |

El administrador técnico **no es automáticamente** propietario de las partidas: administración global y dirección de sala son capacidades diferentes.
- Contraseñas almacenadas solo con **hash lento y sal**, preferentemente Argon2id, nunca texto plano ni cifrado reversible.
- Sesiones/token de vida breve, revocación y expiración. Para la primera versión puede exigirse volver a iniciar sesión tras recargar.
- **No guardar tokens de sesión duraderos en localStorage ni insertar credenciales en URLs.**
- Según el despliegue, frontend y API pueden compartir origen o no: restringir CORS a la lista explícita de orígenes configurados y comprobar también el encabezado Origin de las conexiones WebSocket. **CORS no es autenticación.**
- Autenticar cada conexión Socket.IO y **autorizar cada evento** por usuario, sala, papel y propiedad del token.
- Limitar intentos de login y códigos fallidos; errores uniformes para no facilitar enumeración de usuarios/salas.
- Protección frente a suplantación de máster, falsificación de identificadores de token, repetición de eventos, cargas enormes y emisión a salas ajenas.
- No exponer el puerto Node en Internet; utilizar HTTPS/WSS del proxy con certificados válidos.
- No incluir datos de jugadores o secretos en logs de depuración.

Referencias de implementación: [Socket.IO — Rooms](https://socket.io/docs/v4/rooms/), [Socket.IO — CORS y allowRequest](https://socket.io/docs/v4/handling-cors/), [Socket.IO — Reverse proxy](https://socket.io/docs/v4/reverse-proxy/) y [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### Implementación local de Fase 2 — 26 de octubre de 2026

La API incorpora cuentas en SQLite integrado en Node, scrypt con perfil OWASP compatible con Node 22 sin addons, bootstrap de administrador por terminal privada, login/logout, caducidad/revocación, administración de roles/cuentas, invitaciones ordinarias caducables y de un solo uso, etiquetas configurables y política central de permisos. Se comprueba de nuevo la autorización tras el cálculo de contraseña y dentro de las transacciones de consumo/provisión. [Contrato y operación local](../backend/README.md), [pruebas, límites y decisiones](FASE2-BACKEND.md).

La Fase 2 prepara permisos de sala sin crear aún salas, asignaciones ni presencia. La invitación de alta no concede pertenencia a una partida. El namespace de juego comprueba la identidad y sigue denegando también a cuentas válidas hasta completar autorización de salas en Fase 3. La invitación combinada alta/pertenencia descrita arriba queda pendiente de ese modelo. No se modifica Pages, Apache ni la Raspberry.

## 8. Fase 3 — Crear y unirse a partidas

Flujos:

1. Una persona con capacidad de dirección ve «Crear partida» y «Unirse a partida»; el usuario ordinario **solo ve «Unirse a partida»**.
2. El director crea la partida, recibe un identificador interno estable y un **código de sala aleatorio y único**.
3. Si el invitado aún no tiene cuenta, el director emite una **invitación de alta de cuenta ordinaria** (de un solo uso); tras registrarse puede acceder a la partida invitada.
4. Si ya tiene cuenta, recibe directamente la invitación/código de partida. El backend valida sesión, pertenencia y permisos; el director puede retirar el acceso.
5. Se muestran participantes conectados, estado de sala y tokens asignados a cada usuario. La invitación a partida puede llevar un conjunto explícito de permisos asignados por el director (por ejemplo, dados), pero **nunca se habilitan por defecto por recibir la invitación**.
6. Solo el director puede subir imágenes, activar mapas, conceder/revocar el permiso de dados y asignar control de tokens; los usuarios no reciben datos de otros mapas.
7. Cuando el director está ausente, los usuarios ven «En espera del máster» y no pueden emitir cambios oficiales.
8. En la reconexión, el director confirma su autoridad y envía a cada participante **solo el estado permitido** del mapa activo.

Los códigos deben poder caducar o regenerarse. La persistencia mínima de metadatos de sala en SQLite está permitida; el contenido de la partida sigue exclusivamente en navegadores.

### Implementación local de Fase 3 — 27 de octubre de 2026

Superada primero la [validación aislada de Node 22/SQLite/autenticación en ARMv7](VALIDACION-ARMV7.md), con limpieza verificada y sin cambios de servicios. Se implementan en Windows creación exclusiva por dirección, códigos aleatorios con hash/caducidad/revocación, invitaciones nominativas a cuentas existentes, pertenencias y flags por partida denegados por defecto. La admisión exige código e invitación: no concede acceso por conocer el código o por registrarse.

El namespace solo se abre a miembros autorizados para presencia. La desconexión del propietario deja la partida en espera y su reconexión recupera autoridad sin elegir sustituto. No hay asignaciones, movimientos, mapas, imágenes ni nueva interfaz de tablero; los puntos del flujo que requieren esos contenidos siguen pendientes. El alta y la invitación a partida son dos pasos independientes; la presentación combinada queda pendiente. Se migran únicamente metadatos SQLite y se superan 69 pruebas con Node 22 y 24. [Contrato](../backend/README.md) e [informe y decisiones](FASE3-BACKEND.md). Los criterios de aceptación con navegadores reales de la sección 12 siguen sin darse por satisfechos.

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
- No confiar únicamente en que los botones estén ocultos: el permiso debe verificarse en backend y máster. El usuario no puede falsificar una subida, una tirada no autorizada ni un movimiento de un token ajeno.

### Implementación local de Fase 4 — 27 de octubre de 2026

Solicitudes, aceptación/rechazo del director y confirmaciones de movimiento por Socket.IO, con asignaciones explícitas, permiso por partida, revalidación al confirmar, ID/época/revisiones/versiones y aislamiento por sala. Los mensajes se retransmiten y los puntos de control solo guardan clave pública, revisión y hash; no se persisten posiciones. Un cliente separado del tablero conserva el diario oficial en almacenamiento local y prueba su estado mediante firma de un reto antes de recuperar autoridad. Una segunda sesión no sustituye al director verificado sin esa prueba.

Se añaden pruebas de tres clientes simulados con estado final idéntico, concurrencia, revocaciones, suplantación, pérdidas de mensajes, desconexión y recuperación del diario. No se modifica el frontend publicado ni se conecta a la Raspberry durante esta fase. Quedan pendientes integración visual, pruebas en navegadores reales y carga ARMv7 de movimientos. [Contrato](../backend/README.md) e [informe de Fase 4](FASE4-BACKEND.md). No se consideran completados los criterios globales de aceptación en navegadores ni el MVP.

## 10. Fase 5 — Integración del frontend; recursos pendientes

### Alcance aprobado e implementación local — 27 de octubre de 2026

La instrucción posterior del proyecto dedica esta entrega exclusivamente a integrar el Canvas existente con autenticación, salas y tokens de Fases 1–4. Sustituye el alcance de imágenes previsto originalmente para Fase 5; la secuencia de recursos que sigue se conserva como trabajo pendiente, sin renumerar ni autorizar su implementación.

Se entregan configuración pública relativa a raíz/subruta, acceso y alta por invitación, provisión administrativa de dirección, participantes, permisos/asignaciones, presencia y movimientos confirmados por gesto. Se preserva la mesa local; las salas usan una copia de hasta 64 tokens genéricos fijos. El diario real de IndexedDB y Web Locks protege la autoridad del director; un perfil sin estado no puede recuperarla.

Regresión: **93/93 pruebas en Node 22.23.4 y 24.18.0**, conservando las 88 anteriores. Aceptación real de tres clientes en Edge/Firefox, raíz y subruta con prefijo Socket.IO: convergencia, movimiento indebido, espera, recuperación, exclusión entre pestañas y conservación de datos locales. El modo local también se comprueba sin backend. [Resultados, capturas y reproducción en Windows](FASE5-FRONTEND.md).

No se despliega ni conecta nada a Raspberry ni se publica Pages. Siguen pendientes imágenes, exportaciones, pruebas exteriores/táctiles, carga ARMv7 de movimientos y revisión operativa. No se declara completo el MVP ni la aceptación de un despliegue público de la sección 12. Las notas de fases anteriores describen su estado histórico.

### Mapas e imágenes entre navegadores — trabajo pendiente

El mapa actual vive en IndexedDB del navegador que lo importó; **los otros navegadores no pueden verlo por arte de magia**.

Secuencia prevista:

1. Solo el director/máster puede importar/subir imágenes y anuncia el mapa activo junto con un manifiesto autorizado de recursos.
2. Cada jugador comprueba qué imágenes del mapa activo tiene en caché.
3. El máster transmite las que falten a través del canal definido; la Raspberry **solo retransmite temporalmente**, sin guardarlas en disco.
4. Transferencia en fragmentos, con límites de tamaño, controles de tipo, identificadores de recurso, integridad y reintentos acotados.
5. Solo tras completar la recepción se muestra el fondo; el estado del tablero sigue siendo autoritativo del máster.
6. Nunca difundir imágenes secretas o mapas pausados a usuarios sin permiso.

En el primer hito de prueba puede usarse una cuadrícula con tokens genéricos, sin imágenes. **No declarar completo el MVP jugable** hasta verificar el envío del mapa real y la exportación/importación autónoma de partidas, mapas y tokens.

### Exportaciones/importaciones obligatorias en MVP 0.3

1. **Partida completa:** un paquete descargable y autocontenido con colección de mapas, mapa activo, catálogos, instancias, permisos relevantes y todos los recursos gráficos necesarios para reabrir la partida en otro navegador.
2. **Mapa individual:** fondo, dimensiones, calibración, cuadrícula, tokens y demás elementos de ese mapa con sus recursos; se puede importar como un mapa nuevo en otra partida.
3. **Token individual / recurso de catálogo:** imagen y propiedades visuales, con identidad de recurso independiente de sus instancias; importar no altera otras copias ya colocadas.
4. Versionar el manifiesto de exportación, validar esquema, integridad, rutas y tamaños; bloquear archivos maliciosos y referencias fuera del paquete. Definir conducta ante colisiones (crear copia por defecto; sobrescribir solo con confirmación explícita).
5. Descargar/exportar y abrir/importar **desde el navegador del director**, sin necesitar que la Raspberry almacene archivos. Excluir contraseñas, tokens de sesión, invitaciones y secretos del paquete.
6. Probar recorrido completo: exportar en navegador A, abrir en navegador B, importar, verificar imágenes, posiciones, mapas activos/pausados y referencias de tokens. El formato exacto (ZIP + JSON u otro) se decidirá antes de implementar.
7. Aunque todavía no exista multijugador, estos formatos deben permitir respaldo y recuperación del estado local y evolucionar sin pérdida con versiones del esquema.

## 11. Fase 6 — Despliegue aislado y operación

Después de aprobar el inventario **del host elegido**, aplicar las siguientes instrucciones a la Raspberry piloto o adaptarlas al servidor correspondiente. La lógica del backend nunca debe depender de `systemd`, rutas del SSD o nombres de host específicos:

1. Preparar directorio y usuario de servicio de permisos mínimos; instalar Node LTS compatible sin sustituir versiones usadas por otros proyectos.
2. Instalar dependencias reproducibles del `backend/` y ejecutar tests.
3. En Raspberry/Linux con este patrón, configurar `systemd`: arranque automático, `Restart=on-failure`, usuario no privilegiado, entorno separado y restricciones de acceso a disco; en otros hosts usar un supervisor equivalente.
4. Probar `GET /health` localmente por loopback, **antes** de publicar la API.
5. Integrar el proxy del despliegue con HTTPS/WSS hacia el puerto interno o mediante mismo origen; validar primero su configuración. Publicar `site.config.json` con el endpoint real y añadir el origen exacto del frontend a la lista permitida del backend.
6. Habilitar restricciones de origen, límites de conexión, protección de login y registros sin datos sensibles.
7. Confirmar que Heaven's Gate y el resto de servicios siguen respondiendo antes y después.
8. Probar desde Windows y desde un teléfono con otra red, sin usar credenciales reales en capturas, logs o commits. Repetir el smoke test alojando el frontend tanto en Pages como en un servidor web estático convencional.
9. Dejar documentadas operaciones de arranque, parada, reinicio, actualización y rollback sin tocar servicios ajenos.

**No ejecutar** aperturas de puertos, modificaciones DNS, cambios de proxy compartido ni despliegue público sin una revisión expresa de la configuración observada y de su impacto.

## 12. Pruebas de aceptación

### Hito técnico 0.2 — Sala y conexión

- [ ] Una cuenta provisionada puede iniciar sesión; no existe formulario de autorregistro libre.
- [ ] Un máster emite una invitación de alta de **un solo uso** y caducidad limitada; el invitado crea una cuenta ordinaria, sin capacidad de elevar su rol.
- [ ] Una invitación de alta no es un código de partida; ambos flujos son independientes y revocables.
- [ ] Un director/máster crea una sala y obtiene un código único; el usuario ordinario **no puede crear** partidas ni emitir invitaciones de cuenta.
- [ ] Dos jugadores autorizados se unen por código desde navegadores distintos.
- [ ] Un código inexistente/caducado o una sesión inválida no permite entrar.
- [ ] Se muestra presencia y estado conectado/en espera.
- [ ] Dos clientes ven la posición confirmada de un token sin recargar.
- [ ] El máster puede rechazar un movimiento de token no asignado; el usuario no puede subir mapas, tokens ni cambiar escenas.
- [ ] El permiso de dados está **apagado por defecto** y solo el director puede concederlo/revocarlo en esa sala; cuando haya tiradas, se rechazan también en el backend.
- [ ] Renombrar las etiquetas visibles de roles no cambia los permisos reales.
- [ ] La pantalla «Configuración del sitio» valida la URL de API/tiempo real, muestra conexión y permite generar una configuración de despliegue sin guardar secretos.
- [ ] El frontend funciona en GitHub Pages y servido desde otro servidor web, con URL de backend configurada y rutas relativas correctas.
- [ ] Al desconectar el máster, la sala se pausa; al reconectar se recupera desde su navegador.
- [ ] No se expone ningún puerto backend directamente a Internet.
- [ ] No se escriben mapas ni tokens como datos persistentes en la Raspberry.

### Hito jugable 0.3 — Partida completa

- [ ] Cuatro jugadores pueden permanecer conectados sin conflictos.
- [ ] Se cambia de mapa activo y los demás mapas permanecen en pausa.
- [ ] Los jugadores no reciben recursos secretos o de mapas inactivos.
- [ ] Se envían y almacenan en caché imágenes autorizadas sin persistirlas en servidor.
- [ ] El estado del máster sobrevive al cierre y apertura de su navegador.
- [ ] Exportación/importación de **partida completa** con todos sus recursos y mapas (DAT-04).
- [ ] Exportación/importación de **un mapa individual** con fondo, calibración y tokens (DAT-07).
- [ ] Exportación/importación de **un token o recurso de catálogo** con imagen y propiedades (DAT-08).
- [ ] Los tres paquetes pasan validación y se restauran correctamente en otro navegador; no contienen secretos.
- [ ] Se mantienen tokens, rejilla, calibración y temas existentes.
- [ ] Se verifica que los demás servicios de Raspberry siguen operativos.

## 13. Entregables de Codex por fase

| Fase | Entregable |
| --- | --- |
| 0 — Inventario | `docs/INVENTARIO-BACKEND-RASPBERRY.md`; decisiones pendientes, sin secretos. |
| 1 — Base | `backend/` con instrucciones, tests y `.env.example`; configuración pública del frontend, validación de endpoints y pantalla de ajustes. |
| 2 — Acceso | Autenticación, invitaciones de alta de usuario ordinario, roles con etiquetas configurables, pruebas de denegación por defecto y permisos por partida. |
| 3 — Salas | Crear/unirse solo según rol, código de partida separado de invitación de alta, presencia y reconexión. |
| 4 — Eventos | Demostración reproducible de tokens sincronizados y rechazo de movimientos ilegales. |
| 5 — Recursos | Subida solo por director, transmisión autorizada, fragmentación, caché y **exportación/importación autónoma de partida, mapa y token**. |
| 6 — Operación | `docs/DESPLIEGUE-BACKEND.md` con guía portable y anexo específico Raspberry: configuración observada, rollback, comprobaciones y decisiones confirmadas. |

Cada fase debe actualizar este documento, los requisitos cuando corresponda y el README. No afirmar que una fase está terminada solo porque compila: debe pasar sus pruebas de aceptación.

## 14. Instrucción de arranque para Codex (copiable)

> Estás trabajando en el repositorio `naufragio-rolero/vtt-naufragio`, clonado en Windows, y tienes acceso SSH a nuestra Raspberry Pi. Lee COMPLETAMENTE `README.md`, `docs/REQUISITOS.md`, `docs/PLAN-MAPAS.md`, `docs/REFERENCIAS-OWLBEAR.md` y este documento antes de actuar.
>
> Tu primera tarea es exclusivamente la **Fase 0 — Inventario de Raspberry** de este documento. Comprueba sistema operativo, versiones de Node/npm, proxy existente, `systemd`, Docker si existe, puertos, espacio SSD y compatibilidad con los servicios actuales. No instales nada, no abras puertos, no cambies DNS, no alteres Heaven's Gate (`/mnt/ssd/html/hg`) ni reinicies servicios compartidos.
>
> Escribe `docs/INVENTARIO-BACKEND-RASPBERRY.md` con los resultados saneados, las decisiones pendientes y una propuesta concreta y segura de implementación del backend. No vuelques secretos, IPs sensibles, claves, archivos `.env` ni configuraciones completas a Git. Valida que el informe es coherente con el diseño de máster autoritativo, sin persistencia del contenido de partidas en servidor, **frontend desplegable en Pages o cualquier servidor web, invitaciones de alta emitidas por dirección, roles visuales configurables, permisos mínimos de usuario y exportación/importación de partida, mapa y token en el MVP**. Prepara el commit en una rama de trabajo y **avisa de los puntos que requieren decisión antes de comenzar instalaciones o despliegue**.
>
> Después de aprobar el inventario avanzaremos secuencialmente por las fases de este documento, implementando código versionado, tests y documentación reproducible. Mantén GitHub Pages funcionando durante la transición y no acoples el backend a Raspberry ni al dominio de Pages.

---

**Criterio rector:** conseguir un multijugador fiable y ligero al estilo Owlbear Rodeo, con frontend portable, acceso por invitación y exportaciones completas; sin rehacer innecesariamente el tablero local ni convertir ningún backend en un almacén de nuestras partidas.
