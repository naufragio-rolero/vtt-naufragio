# Requisitos del proyecto — Naufragio VTT

> Documento vivo de producto y arquitectura. Consolidación inicial: 24 de octubre de 2026.
> Repositorio: naufragio-rolero/vtt-naufragio.
> Estado: decisiones acordadas y backlog, no especificación de implementación cerrada.
> Las prioridades son una propuesta de planificación; los requisitos identificados como pendientes no deben implementarse hasta definirse.

## 1. Visión y límites

**Referencia de producto:** [Owlbear Rodeo 1.0/2.0 — funcionalidades que queremos reproducir y simplificar](REFERENCIAS-OWLBEAR.md). La experiencia de Owlbear 1.0 inspira el uso de un mapa como centro de la mesa; las herramientas de 2.0 son referencias selectivas, no una obligación de replicar su complejidad.

Naufragio VTT es una mesa virtual ligera, accesible desde navegador, inspirada en la experiencia sencilla de Owlbear Rodeo 1.0. Debe servir para Naufragio d20, MicroRyF: Moderna, Heaven's Gate y cualquier otro juego, sin quedar acoplada a sus reglas.

Principios:

- Priorizar mapa, fichas, movimiento, comunicación y herramientas visuales de dirección.
- Poder usar imágenes y recursos propios, con interfaz sencilla y adaptable a escritorio y dispositivos táctiles.
- Separar catálogos reutilizables, partidas y copias colocadas en cada mapa.
- El máster dirige y controla la sala; los jugadores solo disponen de permisos explícitos.
- No desarrollar hojas de personaje ni un motor de reglas: **no hay atributos, habilidades, puntos de vida ni estadísticas de antagonistas**.
- Desplegar el mismo frontend estático tanto en GitHub Pages como en cualquier servidor web compatible; no atar las URLs de servicios al dominio ni a una Raspberry.
- No confundir el prototipo estático de GitHub Pages con la futura aplicación autenticada y multijugador.

## 2. Decisiones de producto confirmadas

| ID | Decisión |
| --- | --- |
| DEC-01 | Una **partida** es una colección de mapas; exactamente uno está activo durante el juego y los demás permanecen en pausa. |
| DEC-02 | Cada mapa conserva su estado independiente: fondo, cuadrícula, tokens, posiciones, visibilidad, niebla, objetos y demás elementos disponibles. |
| DEC-03 | Solo el máster o dueño de la sala puede cambiar el mapa activo; el cambio se comunica a todos los jugadores conectados. |
| DEC-04 | Los mapas en pausa no reciben movimientos ni automatizaciones de jugadores; conservan su estado al reactivarse. El máster sí puede prepararlos o editarlos en privado. |
| DEC-05 | El navegador del máster guarda y controla el **estado oficial de la partida**. Los demás navegadores mantienen únicamente cachés y preferencias autorizadas. |
| DEC-06 | El servidor futuro autentica, autoriza y retransmite eventos en tiempo real; **no persiste el contenido de las partidas**. Puede guardar cuentas, permisos y metadatos imprescindibles. |
| DEC-07 | El máster debe estar conectado para que la partida funcione. Ante una desconexión, la sala queda en espera hasta reconectar y recuperar su estado oficial. |
| DEC-08 | Sin registro público: la administración puede crear cuentas y habilitar perfiles de dirección; un máster autorizado puede emitir **invitaciones individuales** para que nuevos participantes creen su propia cuenta. No puede concederse a sí mismo ni a otros privilegios administrativos o de máster por esa vía. |
| DEC-09 | Catálogos de recursos reutilizables para tokens, antagonistas, mapas y participantes/jugadores. Los mapas de partida contienen **instancias independientes** de los recursos. |
| DEC-10 | Cambiar o borrar una instancia colocada no modifica el recurso original ni las otras copias. Los archivos de imagen podrán deduplicarse internamente. |
| DEC-11 | Los antagonistas son recursos visuales simples, reutilizables y controlados por el máster, no fichas con atributos. |
| DEC-12 | El requisito denominado **«versión sólo para hombres»** se difiere expresamente al final del proyecto y queda sin especificación hasta recibir definición del cliente. |
| DEC-13 | Los identificadores internos de roles y sus permisos son estables; sus **nombres visibles son configurables** (por defecto, Usuario, Máster y Administrador). Cambiar una etiqueta jamás concede permisos. |
| DEC-14 | Un usuario ordinario **no crea partidas ni sube mapas/tokens**. Solo puede unirse a las partidas autorizadas, mover tokens asignados y tirar dados si el máster activa ese permiso para la partida. |
| DEC-15 | El MVP incluye **exportar e importar partidas completas, mapas individuales y tokens** sin necesitar persistencia de contenido en el backend. |
| DEC-16 | El frontend será **independiente del alojamiento**; dispondrá de configuración visible para URL de autenticación/API, tiempo real y otros ajustes públicos del sitio. La Raspberry es un destino de referencia, no un requisito del producto. |

## 3. Modelo conceptual

### 3.1 Identidad y autorización

- **Cuenta:** identidad de acceso con credenciales gestionadas por el servicio de autenticación; se provisiona administrativamente o mediante invitación individual emitida por un máster autorizado.
- **Invitación de alta:** enlace/código de un solo uso y caducidad limitada que permite crear una cuenta ordinaria, sin autorregistro público ni escalado de rol.
- **Invitación a partida:** código/enlace diferente, vinculado a la sala; invita a una cuenta ya autenticada a una partida concreta.
- **Participante/usuario:** nombre visible, avatar opcional y relación con su cuenta. No crea partidas ni importa imágenes; solo puede mover los tokens asignados y usar herramientas expresamente permitidas.
- **Máster:** participante propietario de la sala y autoridad final sobre acciones, mapas, visibilidad, subidas de recursos y permisos de los usuarios. Puede emitir invitaciones de alta de cuentas ordinarias.
- **Administrador:** gestiona despliegue, configuración global y las cuentas con privilegios de dirección.
- **Etiquetas de rol:** configurables para la interfaz. Los identificadores internos y capacidades permanecen independientes de su traducción o nombre visible.

No se debe confundir la identificación por apodo de la versión 0.1 con autenticación.

### 3.2 Partida y mapas

- **Partida:** identificador, nombre, máster, participantes autorizados, colección ordenada de mapas y referencia al único mapa activo.
- **Mapa de catálogo:** escenario reutilizable. Puede disponer de imagen original y configuración base.
- **Mapa de partida:** copia o instancia del escenario incorporada a la partida. Almacena su estado propio y puede editarse sin alterar el mapa del catálogo.
- **Estados de mapa:** activo o en pausa. Un mapa nuevo puede prepararse en privado antes de activarlo.
- Los jugadores solo visualizan el mapa activo y únicamente la información que el máster permita conocer. No deben recibir por adelantado datos secretos de mapas en pausa.
- En la primera versión no se trasladan automáticamente tokens entre mapas: se colocan o copian explícitamente.

### 3.3 Catálogos e instancias

- **Catálogo de tokens:** biblioteca de imágenes y plantillas genéricas.
- **Catálogo de antagonistas:** especialización visual del catálogo de tokens para enemigos, criaturas u oponentes.
- **Catálogo de jugadores:** participantes conocidos y, cuando proceda, su vínculo con los tokens que pueden mover. No supone almacenar atributos del personaje.
- **Catálogo de mapas:** fondos o escenarios reutilizables.
- **Instancia de token:** referencia a un recurso de catálogo, posición, dimensiones, rotación futura si se aprueba, nombre/etiqueta, color, visibilidad y propietario/autorización.
- **Instancia de mapa:** referencia al recurso original y estado independiente de los elementos colocados. Un mismo fondo puede utilizarse varias veces sin replicar innecesariamente sus bytes.

Ejemplo: un «Guardia de Ylat» del catálogo puede colocarse tres veces en unas catacumbas; cada copia se mueve, edita o elimina de manera independiente. El original sigue disponible.

## 4. Requisitos funcionales

**Leyenda:** P0 = imprescindible para el MVP multijugador; P1 = siguiente fase de herramientas; P2 = fase posterior de ambientación; PD = pendiente de definición.

### Acceso y colaboración

| ID | Prioridad | Requisito |
| --- | --- | --- |
| AUT-01 | P0 | Solo cuentas provisionadas por administración o registradas con invitación de alta válida emitida por un máster autorizado pueden acceder; no existe autorregistro público. |
| AUT-02 | P0 | Roles internos estables (admin, director y usuario) con permisos verificados por el servidor y **etiquetas visibles configurables**. |
| AUT-03 | P0 | Solo el rol director/máster puede crear salas, invitar a usuarios autorizados y revocar acceso. URL de sala sin depender de que su nombre sea secreto. |
| AUT-04 | P0 | Un máster puede emitir y revocar invitaciones de **alta de cuenta ordinaria**: aleatorias, de un solo uso, caducables y sin privilegios de dirección. La administración también puede provisionar cuentas. |
| AUT-05 | P0 | Separar la invitación de alta de la invitación/código de **partida**; entrar en una sala requiere cuenta autenticada y autorización. |
| AUT-06 | P0 | Por defecto el usuario solo puede unirse a partidas autorizadas, mover tokens que le hayan asignado y tirar dados cuando el máster habilite esa capacidad por partida; todo lo demás se deniega. |
| AUT-07 | P0 | Solo los perfiles de dirección autorizados pueden crear partidas, subir mapas o imágenes de tokens, administrar recursos, activar mapas y asignar permisos. |
| AUT-08 | P0 | La configuración de nombres visibles de roles no modifica permisos ni permite convertirse en director o administrador. |
| AUT-09 | P0 | Las invitaciones a partida podrán definir permisos iniciales explícitos, pero no se habilitan dados, edición ni subida automáticamente por el mero hecho de aceptar la invitación. |
| COL-01 | P0 | Varios participantes conectados simultáneamente al mismo tablero con cambios visibles en tiempo real. |
| COL-02 | P0 | Autorizar cada acción sobre tokens y escenas; el máster puede manipular todos los elementos, asignar control de tokens a usuarios y conceder/revocar el permiso de tiradas. |
| COL-03 | P0 | Incorporarse o reconectarse solicitando al máster el estado permitido del mapa activo. |
| COL-04 | P0 | El máster puede activar otro mapa y todos los jugadores conectados cambian a él. |
| COL-05 | P0 | Si el máster desconecta, mostrar sala en espera; no elegir unilateralmente a otro navegador como autoridad. |

### Mapas y recursos

| ID | Prioridad | Requisito |
| --- | --- | --- |
| MAP-01 | P0 | Crear una partida con uno o más mapas y un solo mapa activo. |
| MAP-02 | P0 | Añadir una imagen propia como fondo y calibrarla respecto a una cuadrícula. |
| MAP-03 | P0 | Desplazar, escalar y alinear fondo y rejilla; elegir tamaño de casilla y activar o desactivar el ajuste. |
| MAP-04 | P0 | Mantener el estado de cada mapa al ponerlo en pausa y volver a activarlo. |
| MAP-05 | P0 | Preparar mapas y elementos ocultos sin exponerlos a jugadores. |
| MAP-06 | P0 | Ajustar manualmente la imagen arrastrando bordes y esquinas, modificando ancho y alto de forma independiente para calibrar mapas con rejillas imperfectas. |
| CAT-01 | P0 | Crear, consultar y reutilizar tokens y mapas de catálogo. |
| CAT-02 | P0 | Crear antagonistas sencillos desde una imagen, nombre y propiedades visuales. |
| CAT-03 | P0 | Colocar múltiples copias independientes de un mismo recurso en cualquier mapa. |
| CAT-04 | P0 | Relacionar tokens con participantes/jugadores autorizados. |
| TOK-01 | P0 | Subir imágenes para tokens y utilizarlas en el tablero. |
| TOK-02 | P0 | Mover, duplicar, cambiar tamaño, editar nombre/color y eliminar instancias de tokens. |
| TOK-03 | P0 | Respetar los permisos de movimiento y edición establecidos por el máster. |
| TOK-04 | P1 | Ampliar propiedades visuales de tokens según las necesidades detectadas en pruebas, sin estadísticas de juego. |

### Despliegue y configuración del sitio

| ID | Prioridad | Requisito |
| --- | --- | --- |
| CFG-01 | P0 | El frontend estático funciona en GitHub Pages o en cualquier servidor web compatible, en dominio raíz o subruta, sin cambiar su código fuente. |
| CFG-02 | P0 | Disponer de una pantalla «Configuración del sitio» para consultar/editar los ajustes públicos: URL de autenticación/API, dirección de tiempo real, ruta Socket.IO y etiquetas visibles de roles. |
| CFG-03 | P0 | La configuración pública se carga desde un fichero versionable de despliegue (por ejemplo, `site.config.json`); en alojamiento estático, la pantalla permite preparar/descargar cambios para republicarlos, porque no puede escribir por sí misma un archivo global en GitHub Pages. |
| CFG-04 | P0 | En un despliegue con backend de administración, solo un administrador autenticado puede cambiar la configuración global mediante API; un cambio local de URL no otorga confianza ni privilegios. |
| CFG-05 | P0 | Nunca guardar claves privadas ni credenciales en la configuración estática. Validar esquema HTTPS/WSS y probar conexión; permitir localhost únicamente para desarrollo. |
| CFG-06 | P0 | Backend desplegable en Raspberry u otro servidor con Node.js, sin rutas, puertos, dominios o dependencias de Raspberry codificados dentro de la aplicación. |

### Apariencia

| ID | Prioridad | Requisito |
| --- | --- | --- |
| VIS-01 | P0 | Ofrecer interfaz clara y oscura mediante selector accesible; usar el tema claro inicialmente y conservar la preferencia en el navegador de cada participante. |

### Persistencia y recuperación

| ID | Prioridad | Requisito |
| --- | --- | --- |
| DAT-01 | P0 | Guardar automáticamente el estado oficial de todas las partidas y mapas en IndexedDB del navegador del máster. |
| DAT-02 | P0 | Mantener en los navegadores de jugadores una caché local con el subconjunto de datos autorizado. |
| DAT-03 | P0 | No almacenar mapas, fichas, posiciones, niebla ni otros estados de partida de forma persistente en el backend. |
| DAT-04 | P0 | Exportar e importar una partida completa, incluidos sus mapas y recursos, para copia de seguridad y recuperación. |
| DAT-05 | P0 | Restaurar la partida y el mapa activo después de cerrar y volver a abrir el navegador del máster. |
| DAT-06 | P0 | Resolver reconexiones y cambios concurrentes bajo la autoridad del estado que mantiene el máster; los datos de un jugador no prevalecen automáticamente sobre el máster. |
| DAT-07 | P0 | Exportar e importar **mapas individuales**, con fondo, calibración, tokens colocados y recursos que les correspondan. |
| DAT-08 | P0 | Exportar e importar **tokens individuales y de catálogo**, incluyendo imagen y propiedades visuales, sin alterar otras instancias. |
| DAT-09 | P0 | Las exportaciones deben ser autocontenidas, versionadas y validadas al importar; permitir restaurar en otro navegador sin depender de datos del servidor. |

### Herramientas de partida

| ID | Prioridad | Requisito |
| --- | --- | --- |
| JUE-01 | P1 | Chat de texto para los participantes conectados. |
| JUE-02 | P1 | Tiradas de dados desde la interfaz y registro cronológico de resultados; **cuando esta herramienta esté disponible**, el usuario solo podrá utilizarla si el máster concede el permiso correspondiente para la partida. |
| JUE-03 | P1 | Niebla de guerra manual, controlada por el máster, con ocultación efectiva para los jugadores. |
| JUE-04 | P1 | Etiquetas, anotaciones y mobiliario/objetos colocables sobre los mapas. |
| JUE-05 | P1 | Control del tamaño de letra; elementos exactos sobre los que se aplicará, pendientes de detalle. |

### Ambientación e ideas posteriores

| ID | Prioridad | Requisito |
| --- | --- | --- |
| AMB-01 | P2 | Música dinámica asociada a zonas o situaciones del mapa, usando enlaces o reproductores autorizados de Spotify y/o YouTube. |
| AMB-02 | P2 | Controles de reproducción adecuados para cada jugador y el máster, respetando restricciones de navegador y servicio. |
| AMB-03 | P2 | Iluminación dinámica: antorchas, fuentes de luz, radios y, si procede, sombras/obstáculos. |
| DIF-01 | PD, al final | «Versión sólo para hombres»: requisito mencionado por el cliente, no prioritario y todavía sin definición funcional. No tomar decisiones de implementación hasta concretarlo. |

## 5. Hoja de ruta

| Versión | Objetivo | Condición de salida |
| --- | --- | --- |
| **0.1 — Prototipo local** | Nombre local, rejilla, tokens genéricos, zoom, movimiento y guardado simple en localStorage. | Ya implementado en GitHub Pages; **no** es un sistema autenticado ni multijugador. |
| **0.2 — Conexión y salas** | Frontend portable y configurable, invitaciones de alta y de partida, cuentas reales, roles configurables en su etiqueta, permisos restrictivos, sala compartida, sincronización y reconexión. | Máster y jugadores invitados acceden sin registro público; un usuario no puede crear partidas ni subir recursos. |
| **0.3 — MVP jugable** | Partida como colección de mapas, fondo/calibración, catálogos, tokens personalizados, IndexedDB y **exportación/importación de partidas, mapas y tokens por separado**. | Una partida puede prepararse, jugarse, pausar mapas, exportarse, trasladarse a otro navegador y restaurarse. |
| **0.4 — Herramientas de dirección** | Niebla manual, chat, dados e historial, etiquetas/mobiliario y tipografía ajustable. | Permite sesiones más completas sin integrar reglas. |
| **0.5 — Ambientación** | Música contextual por zonas e iluminación dinámica. | Se estudiará por separado su viabilidad, experiencia, coste y condiciones de terceros. |
| **Fase final sin fecha** | Requisito DIF-01, una vez que el cliente lo concrete. | Pendiente. |

Las versiones son hitos de trabajo orientativos, no fechas prometidas.

## 6. Criterios de aceptación del MVP (v0.3)

1. El máster puede iniciar sesión con credenciales reales y abrir una partida privada.
2. Al menos cuatro jugadores de prueba acceden desde navegadores distintos y solo con autorización.
3. La partida contiene varios mapas independientes y solo uno está activo.
4. El máster puede subir un fondo, ajustar la cuadrícula, crear o importar tokens y colocar varias copias de un antagonista.
5. El movimiento de tokens autorizados se ve en el resto de navegadores conectados sin recargar.
6. Activar otro mapa hace cambiar a todos los jugadores; el anterior mantiene sus posiciones y elementos.
7. El jugador no recibe información de mapas en pausa ni de capas ocultas sin autorización.
8. El máster puede cerrar y reabrir su navegador y recuperar la colección de mapas, sus estados y el mapa activo.
9. Se pueden exportar e importar por separado una partida completa, un mapa y un token con sus recursos, validando el formato y restaurando en otro navegador.
10. El frontend funciona en GitHub Pages y en un servidor web convencional configurando el endpoint de autenticación/tiempo real desde la configuración pública del sitio.
11. Un máster puede emitir una invitación de alta de un solo uso; una persona invitada crea una cuenta ordinaria sin autorregistro público.
12. El usuario no puede crear partidas, subir mapas o tokens ni manipular fichas ajenas; el permiso de tiradas está denegado por defecto y puede ser concedido y revocado por el máster.
13. Cambiar los nombres visibles de «Usuario» y «Máster» no modifica las autorizaciones.
14. Al perder conexión el máster, la sala entra en espera y no asigna autoridad a un cliente arbitrario.

El objetivo inicial de capacidad es una mesa pequeña (aproximadamente 5–8 participantes), sujeto a pruebas reales de rendimiento.

## 7. Seguridad, límites y despliegue

- GitHub Pages es **uno de los posibles alojamientos** del frontend estático, no un requisito exclusivo; sirve igualmente un servidor web convencional. Ninguno convierte los archivos estáticos en un backend de autenticación o WebSockets.
- Para el multijugador se necesita un servicio backend separado, ligero y **portable** (Raspberry u otro servidor), con HTTPS/WSS, control de origen, sesiones y límites de recursos; los endpoints serán configurables por despliegue.
- Contraseñas con hash adaptativo seguro (por ejemplo Argon2id), nunca en código frontend ni texto claro; cuentas provisionadas por administración o mediante invitaciones de alta emitidas por un máster autorizado, sin registro público.
- Proteger todas las rutas de recursos, cargas de archivos y acciones en tiempo real según usuario, sala y rol; autorización de cada operación en el backend.
- Aceptar únicamente formatos de imagen explícitamente permitidos y validados; límites de tamaño, dimensiones y cuota. Archivos fuera del directorio ejecutable o público sin control.
- No enviar al cliente imágenes, escenas o metadatos ocultos que sus permisos no autoricen, aunque la interfaz pueda ocultarlos visualmente.
- Aislar el nuevo servicio de Heaven's Gate y el resto de aplicaciones alojadas en la Raspberry Pi; limitar CPU/memoria/conexiones y probar su comportamiento antes de abrirlo.
- El estado de la partida no se almacena permanentemente en el servidor. Ello reduce la carga y exige una estrategia explícita de respaldo local, pérdida de dispositivo y exportación.
- Los catálogos y las imágenes deben mantenerse en almacenamiento del navegador del máster; los jugadores no deben acumular secretos en sus cachés.
- Mantener una interfaz táctil y de escritorio; renderizado de tableros preferentemente en el navegador de cada participante.

## 8. Cuestiones aún no cerradas

Estas decisiones no deben confundirse con requisitos ya acordados:

- Alcance exacto del ajuste tipográfico: etiquetas de mapa, nombres de tokens, chat, interfaz o todos ellos.
- Formatos de imagen, tamaños máximos y procedimiento de alineación con cuadrículas ya dibujadas.
- Tratamiento de personajes que cambian de mapa (copia manual inicialmente; automatización posterior por valorar).
- Política de actualización de recursos originales después de crear instancias (por defecto, las instancias no cambian).
- Formato concreto del paquete de exportación (que **debe existir en el MVP** para partidas, mapas y tokens), versionado e importación validada, y plan de recuperación si se borra IndexedDB.
- Política de gestión global de configuración del sitio: fichero público de despliegue como base, pantalla de administración y posible API para instalaciones con backend de configuración.
- Alcance del catálogo de jugadores frente a las cuentas de autenticación: fichas visuales, permisos y perfiles, sin estadísticas.
- Notación de dados, visibilidad del registro, retención de mensajes y alcance del chat.
- Funcionamiento exacto de zonas musicales, reproducción simultánea, permisos y límites de Spotify/YouTube.
- Nivel de precisión, obstáculos, cálculos y optimización de la iluminación dinámica.
- Significado y condiciones del requisito DIF-01, aplazado por petición del cliente.

## 9. Regla de mantenimiento

Cualquier implementación deberá contrastarse con este documento antes de introducir reglas, dependencias, almacenamiento servidor o funciones no previstas. Si una decisión cambia, actualizar aquí su estado y reflejarla en las notas de desarrollo. El código existente no prueba que una función futura esté terminada.

Estado al 26 de octubre de 2026: existe una [base local de backend y pruebas de Fase 1](FASE1-BACKEND.md) para Node 22/24. Se prepararon configuración pública y pantalla aislada del backend; su integración con el tablero publicado sigue pendiente. Esto no completa AUT, COL, los hitos 0.2/0.3 ni cambia DEC-05/06: no hay persistencia de contenido de partidas en el servidor. Las siguientes fases incorporarán identidad, salas y eventos con el máster como autoridad.

Incremento local de [Fase 2](FASE2-BACKEND.md): cuentas, hashes, sesiones e invitaciones en SQLite; bootstrap privado, expiración/revocación, roles internos y etiquetas configurables, validación y permisos comprobados por backend. Se preparan AUT-01/02/04/08 y la denegación de operaciones de usuario ordinario; las pertenencias, asignaciones y autorizaciones por partida siguen pendientes de Fase 3. El namespace de juego continúa cerrado. Esta API local aún no está integrada en el frontend publicado ni completa los hitos 0.2/0.3.

Incremento del 27 de octubre, [Fase 3](FASE3-BACKEND.md), posterior a la [validación temporal ARMv7](VALIDACION-ARMV7.md): creación de partidas por dirección, códigos e invitaciones nominativas independientes del alta, pertenencia y permisos por partida denegados por defecto (AUT-03/05/09, preparación de AUT-06/07). Socket.IO autoriza miembros y transmite presencia, espera y reconexión del propietario sin elección de otra autoridad (base de COL-05). Solo persisten metadatos; el namespace no admite movimientos, imágenes ni herramientas de juego. Asignación de tokens, sincronización y frontend autenticado siguen pendientes; no se declaran completos los hitos 0.2/0.3 ni COL-01/02/03. Las notas de Fases 1 y 2 anteriores se conservan como historial.
