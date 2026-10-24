# Trabajo activo — Importación y calibración de mapas

> Naufragio VTT · Iteraciones locales 0.1.1–0.1.2 · 24 de octubre de 2026
>
> Estado: implementación del primer bloque del frontend en GitHub Pages.
> Referencias: [Requisitos](REQUISITOS.md) (MAP-02, MAP-03, DAT-01) y [Owlbear Rodeo](REFERENCIAS-OWLBEAR.md) (Aligning a Map, Scenes).
>
> Estas entregas son incrementos del prototipo local; no alteran la hoja de ruta del MVP multijugador 0.2–0.3.

## Objetivo

Desde un navegador de escritorio o móvil:

1. Seleccionar una imagen PNG, JPEG o WebP del dispositivo.
2. Utilizarla como fondo del tablero bajo la rejilla y los tokens.
3. Ajustar su anchura en casillas y desplazarla horizontal/verticalmente, incluida una posición fraccionaria, hasta alinear una cuadrícula impresa en la imagen con la cuadrícula virtual.
4. Encajar la imagen en la vista sin cambiar su proporción.
5. Recargar la página y recuperar imagen, ajuste, tokens y nombre local.

## Alcance de la primera entrega

- **Un mapa local activo** sobre el tablero actual. Es deliberadamente previo a la colección de mapas/partidas.
- Importación desde fichero; no se enviará la imagen al servidor de GitHub Pages.
- Persistencia de imagen binaria en IndexedDB del navegador y de metadatos/ajustes existentes en localStorage, sin duplicar el archivo como base64.
- Controles de anchura en casillas, desplazamiento X/Y, alineación mediante arrastre y encuadre automático.
- Rejilla por encima del fondo, con ajuste de opacidad.
- Conservación de los cuatro tokens actuales, zoom, nombre local y acciones previas.
- Validación de formatos y límites de peso/resolución apropiados para la prueba móvil.
- Opción explícita de retirar el fondo, sin borrar los tokens.

## Fuera de esta entrega

- Cuentas y contraseñas reales, salas, sincronización WebSocket, acceso de terceros.
- Catálogo reutilizable, colección de mapas, mapas en pausa y copias de mapas.
- Subida a la Raspberry, nube o GitHub; las imágenes siguen en el dispositivo que las importe.
- Exportación/importación de la partida completa y respaldos externos.
- Niebla, dibujos, iluminación y sonido.

Estos puntos siguen en el [documento general de requisitos](REQUISITOS.md), no se consideran descartados.

## Decisiones de implementación

- Conservar el sistema de coordenadas actual: tokens expresados en unidades de casilla.
- Guardar el fondo mediante un objeto con nombre, dimensiones originales, anchura y altura independientes en casillas y desplazamiento X/Y; inicialmente se conserva la proporción original, pero la edición posterior admite deformación deliberada para calibrar fondos imperfectos.
- Mantener separados metadatos y Blob, permitiendo evolucionar después hacia identificadores de mapa dentro de una partida.
- El tamaño de la casilla virtual cambia la escala física del fondo y de los tokens por igual; la cantidad de casillas ocupadas por la imagen se ajusta independientemente.
- Al entrar en modo «Mover mapa», arrastrar la imagen altera su offset. Fuera de ese modo, arrastrar el fondo mueve la cámara del tablero.
- No guardar secretos, credenciales ni archivos en el repositorio público.

## Comprobaciones manuales de aceptación

- [ ] En móvil y escritorio, entrar con un apodo y ver los tokens iniciales.
- [ ] Importar un PNG/JPEG/WebP válido desde el dispositivo.
- [ ] Ver la imagen debajo de la rejilla y de los tokens sin deformación.
- [ ] Ajustar anchura y altura en casillas, de forma independiente, y comprobar que las líneas de la imagen se alinean con la rejilla.
- [ ] Mover el fondo con el modo de alineación y comprobar también los campos X/Y.
- [ ] Desactivar ese modo y desplazar el tablero sin modificar el fondo.
- [ ] Encajar la imagen en pantalla; conservar los botones y rueda de zoom.
- [ ] Recargar y comprobar que permanecen la imagen, los ajustes y las fichas.
- [ ] Sustituir la imagen sin conservar incorrectamente las dimensiones de la anterior.
- [ ] Rechazar imágenes de formato/tamaño no permitido sin perder el mapa anterior.
- [ ] Retirar el fondo tras confirmar y conservar el resto de la mesa.
- [ ] Comprobar que ningún recurso de imagen se sube a un servicio remoto.

## Próximos bloques

1. **Modelo de partida y colección de mapas:** varios mapas, uno activo, otros en pausa, estado aislado.
2. **Catálogos:** plantillas de mapas, tokens, jugadores y antagonistas, más instancias.
3. **Persistencia completa:** IndexedDB estructurado, exportación/importación de respaldos.
4. **Multijugador:** autenticación y sincronización con máster autoritativo y servidor de retransmisión.

## Advertencias

El estado todavía depende del almacenamiento del navegador: limpiar datos del sitio puede destruir el mapa importado. La futura exportación/importación será imprescindible. GitHub Pages seguirá siendo un frontend estático y la identificación por nombre no es autenticación.

## Ampliación 0.1.2 — Estiramiento manual y temas

- **Modo «Estirar imagen»:** muestra ocho tiradores (cuatro esquinas y cuatro bordes) en el lienzo; arrastrar uno modifica anchura y/o altura en casillas.
- **Anclaje:** al arrastrar el borde izquierdo o superior, se mueve ese borde y permanece fijo el borde opuesto. La anchura y altura quedan entre 1 y 200 casillas.
- **Distorsión intencionada:** no hay bloqueo de proporciones. Esto permite adaptar imágenes cuya rejilla original no coincida exactamente con la mesa.
- **Exclusión de modos:** «Mover imagen» y «Estirar imagen» son excluyentes para evitar gestos ambiguos; los tokens se siguen pudiendo mover fuera de los tiradores.
- **Persistencia:** los tamaños ajustados se guardan en localStorage. Los mapas 0.1.1 se migran automáticamente: se calcula su altura inicial a partir de anchura y proporción original.
- **Temas:** selector claro/oscuro en «La mesa». El claro es la opción inicial para instalaciones nuevas; se almacena la elección en localStorage, sin alterar el archivo de imagen.
- **Gráfico del lienzo:** colores de mesa, rejilla y herramientas adaptados al tema; el fondo importado se representa sin modificación cromática.

### Pruebas específicas para 0.1.2

- [ ] Arrastrar un tirador de esquina y comprobar cambios simultáneos en anchura y altura.
- [ ] Arrastrar un tirador lateral y comprobar que modifica una sola dimensión.
- [ ] Arrastrar el borde izquierdo/superior y confirmar que el borde opuesto mantiene su posición.
- [ ] Cambiar entre «Mover imagen» y «Estirar imagen» y comprobar que se desactiva el modo anterior.
- [ ] Mover tokens mientras el modo de estiramiento está activo, fuera de los tiradores.
- [ ] Usar los tiradores desde un teléfono mediante gestos táctiles.
- [ ] Recargar y confirmar la restauración de la altura/anchura independientes.
- [ ] Abrir un estado de 0.1.1 y comprobar que se migra conservando la proporción.
- [ ] Alternar tema claro/oscuro y recargar; comprobar legibilidad y persistencia.
- [ ] Comprobar que se sigue usando el tema claro en una instalación nueva.

La entrega 0.1.2 sigue siendo local; todavía no incorpora cuentas, salas compartidas ni multijugador.
