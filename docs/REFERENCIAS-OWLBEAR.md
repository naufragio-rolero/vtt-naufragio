# Referencias de diseño y comportamiento: Owlbear Rodeo

> Documento de consulta para desarrollar **Naufragio VTT**. Referencias oficiales revisadas el 24 de octubre de 2026.
>
> Regla de producto: **replicar todo lo útil de la experiencia ligera de Owlbear Rodeo, especialmente 1.0, sin importar su complejidad innecesaria**.
>
> Este documento complementa [REQUISITOS.md](REQUISITOS.md). Si una función de Owlbear contradice una decisión de El Naufragio, prevalecen los requisitos de nuestro proyecto.

## 1. Qué versión tomamos como referencia

### Owlbear Rodeo 1.0: la filosofía principal

En Owlbear 1.0 el contenido del tablero estaba asociado a **un mapa**: se cargaba el mapa y sobre él se añadían tokens, dibujos y niebla. Esa simplicidad es el punto de partida de Naufragio VTT.

Referencia primaria: [Migrating from Owlbear Rodeo 1.0 to 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/).

Nuestras decisiones equivalentes:

- Una **partida** contiene varios **mapas**.
- Solo hay **un mapa activo**; el resto permanece en pausa con su estado intacto.
- Cada mapa es un contenedor de fondo, cuadrícula, tokens, objetos, etiquetas, niebla y demás capas.
- El máster controla los cambios de mapa y conserva el estado oficial en su navegador.
- La interacción central sigue siendo **colocar, seleccionar, arrastrar, redimensionar y ocultar**, sin fichas ni motor de reglas.

### Owlbear Rodeo 2.0: catálogo de buenas soluciones

La versión 2.0 desacopló recursos y escenas e introdujo un lienzo infinito que puede contener uno o varios mapas. Es una buena fuente para estudiar herramientas y gestión de recursos, **pero no cambiaremos nuestra unidad principal de juego a ese modelo más complejo**.

Referencias: [Migración 1.0 → 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/), [Scenes](https://docs.owlbear.rodeo/docs/scenes/), [Assets](https://docs.owlbear.rodeo/docs/managing-assets/).

## 2. Matriz de equivalencias: de Owlbear a Naufragio

Las prioridades remiten a [REQUISITOS.md](REQUISITOS.md): P0 = MVP multijugador, P1 = herramientas posteriores, P2 = ambientación/futuro.

| Función y referencia oficial | Comportamiento a reproducir de forma sencilla | Prioridad |
| --- | --- | --- |
| [Rooms](https://docs.owlbear.rodeo/docs/rooms/) | Sala compartida por URL, con un máster y varios jugadores. **Diferencia deliberada:** en Naufragio se exige cuenta creada por administración, sin acceso anónimo. | P0 |
| [Migración 1.0 → 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/) | Un mapa central para jugar; cambiar a otro mapa conserva el anterior. No necesitamos un lienzo infinito con varios mapas simultáneos. | P0 |
| [Assets](https://docs.owlbear.rodeo/docs/managing-assets/) | Biblioteca reutilizable de mapas y tokens; añadir elementos mediante selección/arrastre. Un original puede dar lugar a muchas copias independientes. | P0 |
| [Images](https://docs.owlbear.rodeo/docs/images/) | Subir imágenes, colocarlas, moverlas, escalar, ocultar, mostrar y bloquear elementos. | P0 |
| [Aligning a Map](https://docs.owlbear.rodeo/docs/aligning-a-map/) | Calibrar un mapa importado mediante filas, columnas y referencias visuales para que sus casillas coincidan con la rejilla. | P0 |
| [Scenes](https://docs.owlbear.rodeo/docs/scenes/) | Rejilla visible/opcional, tamaño, opacidad y ajuste magnético; comenzar con cuadrícula cuadrada, ampliar tipos solo si aportan valor. | P0 |
| [Permissions](https://docs.owlbear.rodeo/docs/permissions/) | Director con control absoluto y jugadores limitados a elementos autorizados, particularmente sus propios tokens. Validación real en servidor y en la autoridad del máster. | P0 |
| [Fog](https://docs.owlbear.rodeo/docs/fog/) | Cubrir zonas, revelar habitaciones y mostrar al director una vista distinta de la de los jugadores. Comenzar con niebla manual rectangular o poligonal sencilla. | P1 |
| [Drawing](https://docs.owlbear.rodeo/docs/drawing/) | Dibujar a mano y usar figuras básicas para marcar zonas o improvisar un plano. Mantener herramientas elementales, sin editor vectorial sofisticado. | P1 |
| [Measure](https://docs.owlbear.rodeo/docs/measure/) | Regla temporal entre dos puntos; lectura de casillas/distancias sin imponer reglas de ningún sistema. | P1 |
| [Text](https://docs.owlbear.rodeo/docs/text/) | Etiquetas directamente sobre el mapa con tamaño, color y contraste ajustables. No es necesario replicar el editor completo de texto enriquecido. | P1 |
| [Assets](https://docs.owlbear.rodeo/docs/managing-assets/) | Búsqueda y categorías de biblioteca; en nuestro caso, jugadores, tokens, antagonistas, mapas y mobiliario. | P1 |
| [Casting / Sync View](https://docs.owlbear.rodeo/docs/casting/) | Opción para centrar o sincronizar la vista de los jugadores con la del máster. Un botón «Llevar a mi vista» es suficiente al principio. | P1 |
| [Scenes: grid types](https://docs.owlbear.rodeo/docs/scenes/) | Cuadrícula hexagonal o isométrica, tipos de línea y otras variantes solo si existe necesidad real; no son bloqueantes. | P2 |
| [Transfer from 1.0 to 2.0](https://docs.owlbear.rodeo/docs/migration/transfer-from-1-to-2/) | Inspiración para **exportar/importar el estado completo**. Usaremos un formato propio y documentado, no se promete compatibilidad con los archivos de Owlbear. | P0 |

La equivalencia es **funcional y de experiencia**, no de implementación interna ni de apariencia exacta.

## 3. Comportamientos que queremos conservar

### Interacción de mesa

- Arrastrar el fondo para desplazarse y usar rueda/botones para acercar o alejar.
- Arrastrar tokens con ratón o dedo; ajuste opcional a casillas.
- Seleccionar un elemento y mostrar pocas acciones claras: nombre, tamaño, mover, duplicar, ocultar, bloquear y borrar.
- Colocar un token del catálogo con muy pocos pasos.
- Mantener un catálogo separado de los tokens ya colocados: borrar una copia nunca borra el original.
- Arrastrar y escalar imágenes de fondo; ofrecer una herramienta explícita de alineación de cuadrícula.
- Control visual claro del mapa activo, acceso a los mapas en pausa para preparación privada del máster.

### Herramientas de dirección

- El máster decide quién puede mover y editar cada tipo de elemento.
- El máster prepara elementos ocultos y puede previsualizar qué ven los jugadores.
- Al cambiar de mapa, todos los jugadores cambian de forma sincronizada y el mapa anterior queda guardado.
- Niebla de guerra manual y fácil de revelar; automatizaciones complejas no forman parte del núcleo.
- Marcadores, texto y regla con controles simples y sin ventanas modales innecesarias.

### Persistencia y sesiones

- El catálogo vive en el navegador del máster; el servidor solo transmite cambios y administra identidad/accesos.
- Cada mapa conserva su propio estado, incluido el de sus instancias y capas.
- Los jugadores reciben solo los datos autorizados del mapa activo y pueden conservar caché local permitida.
- Exportación/importación obligatoria para evitar que borrar el almacenamiento del navegador destruya una campaña.
- Reconexión desde el estado oficial del máster. Si este desconecta, la partida espera.

## 4. Aspectos que **no** copiaremos automáticamente

| Owlbear o ecosistema VTT | Decisión para Naufragio VTT |
| --- | --- |
| Lienzo infinito con múltiples mapas simultáneos (2.0) | Una colección de mapas con exactamente uno activo. |
| Gran número de capas y tipos especializados de recurso | Empezar con fondo, token, mobiliario/objeto, dibujo/texto y niebla. Ampliar solo si una necesidad lo exige. |
| Sistema de extensiones y complementos | No crear una plataforma de plugins en el MVP. |
| Funciones de hojas de personaje o reglas de otros VTT | Expresamente fuera del alcance: sin estadísticas ni automatización de reglamentos. |
| Permisos anónimos de entrada | Cuentas creadas manualmente, contraseña y autorización explícita. |
| Persistencia en una nube ajena | Navegador del máster como origen del estado; caché local de jugadores y transporte mediante servidor propio. |
| Interfaz, iconos, logotipos o recursos originales de Owlbear | No copiar literalmente. Crear diseño y recursos de El Naufragio; tomar referencias de usabilidad y comportamiento. |

## 5. Funciones solicitadas por el proyecto que no dependen de copiar Owlbear

Estas funcionalidades se desarrollarán por requisitos propios; que una herramienta o extensión de Owlbear las permita no implica que estén disponibles de forma idéntica en su núcleo:

- Chat de texto entre usuarios conectados.
- Tiradas de dados y registro cronológico.
- Música dinámica por zonas con reproductores autorizados de Spotify/YouTube.
- Iluminación dinámica (antorchas, fuentes de luz y, en el futuro, sombras).
- Control de tamaño de letra en etiquetas o elementos por definir.
- Requisito «versión sólo para hombres»: aplazado al final, sin definición funcional.

## 6. Pautas para decidir qué entra al MVP

Ante una nueva función encontrada en Owlbear, documentar antes de programar:

1. **Problema real de mesa:** ¿qué permite hacer al máster o al jugador?
2. **Versión mínima:** ¿podemos resolverlo con un gesto y una propiedad sencilla?
3. **Modelo de datos:** ¿pertenece al catálogo, al mapa, a su instancia o a la partida?
4. **Permisos y secretos:** ¿qué pueden recibir o modificar los jugadores?
5. **Persistencia:** ¿qué conserva IndexedDB y cómo se exporta?
6. **Coste y mantenimiento:** ¿añade procesos o carga innecesaria a la Raspberry?
7. **Prioridad:** ¿bloquea una partida real o es una mejora posterior?

**Criterio de descarte:** si una funcionalidad requiere introducir hojas, estadísticas, automatizaciones de reglas, un ecosistema de plugins o una interfaz difícil de explicar, queda fuera del MVP salvo decisión explícita.

## 7. Lista de referencias oficiales

- [Documentación principal de Owlbear Rodeo](https://docs.owlbear.rodeo/)
- [Diferencias entre Owlbear Rodeo 1.0 y 2.0](https://docs.owlbear.rodeo/docs/migration/migrate-from-1-to-2/)
- [Habitaciones y enlaces de acceso](https://docs.owlbear.rodeo/docs/rooms/)
- [Gestión de escenas](https://docs.owlbear.rodeo/docs/scenes/)
- [Biblioteca y catálogo de recursos](https://docs.owlbear.rodeo/docs/managing-assets/)
- [Imágenes, capas y transformaciones](https://docs.owlbear.rodeo/docs/images/)
- [Alineación de mapas a la cuadrícula](https://docs.owlbear.rodeo/docs/aligning-a-map/)
- [Permisos por usuario y propiedad de fichas](https://docs.owlbear.rodeo/docs/permissions/)
- [Niebla de guerra](https://docs.owlbear.rodeo/docs/fog/)
- [Dibujo](https://docs.owlbear.rodeo/docs/drawing/)
- [Medición de distancias](https://docs.owlbear.rodeo/docs/measure/)
- [Texto sobre escenas](https://docs.owlbear.rodeo/docs/text/)
- [Presentación y sincronización de vista](https://docs.owlbear.rodeo/docs/casting/)
- [Migración/exportación de datos de Owlbear 1.0](https://docs.owlbear.rodeo/docs/migration/transfer-from-1-to-2/)

Estas fuentes sirven para analizar comportamiento. No autorizan a copiar código propietario, identidad visual, imágenes ni marcas.
