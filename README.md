# Naufragio VTT

MVP 0.1 de un tablero virtual ligero para El Naufragio, inspirado en la sencillez de Owlbear Rodeo 1.0.

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

**Visibilidad:** en GitHub Free para organizaciones, Pages requiere un repositorio público. Si el repositorio sigue siendo privado, habrá que comprobar si el plan permite Pages o cambiar su visibilidad deliberadamente. El sitio publicado es público incluso cuando su código pueda ser privado.

El proyecto no necesita un workflow personalizado de GitHub Actions.

## Límites deliberados del MVP

**No hay autenticación real, servidor ni multijugador.** El nombre elegido en pantalla solo identifica al usuario en *ese navegador* y no impide que nadie visite la web. GitHub Pages no ejecuta PHP ni WebSockets.

Las partidas, tokens y preferencias se guardan únicamente en el almacenamiento local del navegador; no se comparten entre dispositivos, y pueden perderse al borrar los datos del sitio. Evitar usar información privada o material sensible.

## Próximas fases

1. Backend de usuarios y roles, contraseñas almacenadas mediante hash seguro.
2. Salas persistentes y autorización de acceso en servidor.
3. Sincronización en tiempo real mediante WebSockets con validación de acciones.
4. Mapas propios, escenas, niebla de guerra y permisos del director.
5. Pruebas de aislamiento y seguridad antes de desplegar el backend en la Raspberry Pi.

No se incluyen claves, cuentas de demostración falsas ni secretos en el frontend.
