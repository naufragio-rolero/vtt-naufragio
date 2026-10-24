# Naufragio VTT

MVP 0.1 de un tablero virtual ligero para El Naufragio, inspirado en la sencillez de Owlbear Rodeo 1.0.

**[Requisitos completos y plan de trabajo](docs/REQUISITOS.md)**

**[Referencias funcionales de Owlbear Rodeo](docs/REFERENCIAS-OWLBEAR.md)** — equivalencias con Owlbear 1.0/2.0, fuentes oficiales y criterios para conservar una experiencia sencilla. — fuente de referencia para arquitectura, alcance del MVP, decisiones confirmadas y tareas futuras.

## Funciones actuales

- Identificación **local** por nombre (sin cuentas ni contraseñas).
- Rejilla ajustable y opción de mostrarla u ocultarla.
- Cuatro tokens genéricos iniciales y posibilidad de añadir, renombrar, recolorear y eliminar otros.
- Arrastrar tokens con ratón o pantalla táctil; ajuste opcional a casillas.
- Desplazar el tablero, hacer zoom y centrar la vista.
- Mover el token seleccionado con las flechas del teclado.
- Guardado automático en el navegador mediante localStorage.
- Interfaz adaptable a escritorio y móvil, sin dependencias externas.

## Probar en local

Abrir el fichero `index.html` en un navegador moderno. Para servirlo como web estática se puede usar cualquier servidor de archivos local.

## Publicar en GitHub Pages

1. En el repositorio, abrir **Settings → Pages**.
2. En **Build and deployment**, elegir **Deploy from a branch**.
3. Seleccionar la rama `main` y la carpeta `/(root)`.
4. Guardar. La URL prevista es https://naufragio-rolero.github.io/vtt-naufragio/.

**Estado actual:** el repositorio es público. El código y la web publicada son accesibles públicamente; el prototipo no tiene control de acceso.

El proyecto no necesita un workflow personalizado de GitHub Actions.

## Límites deliberados del MVP

**No hay autenticación real, servidor ni multijugador.** El nombre elegido en pantalla solo identifica al usuario en *ese navegador* y no impide que nadie visite la web. GitHub Pages no ejecuta PHP ni WebSockets.

Las partidas, tokens y preferencias se guardan únicamente en el almacenamiento local del navegador; no se comparten entre dispositivos, y pueden perderse al borrar los datos del sitio. Evitar usar información privada o material sensible.

## Próximas fases

Consultar el [documento de requisitos](docs/REQUISITOS.md). La arquitectura acordada considera el navegador del máster como fuente oficial del estado de la partida, cachés autorizadas en los navegadores de jugadores y un backend futuro para autenticación y sincronización, **sin persistir partidas en el servidor**.

No se incluyen claves, cuentas de demostración falsas ni secretos en el frontend.
