# Integración del Rack 3D — L10 ALMACEN

## Qué cambió

La sección **Racks y Cajas** (`racks.html`) ahora muestra el visor 3D en lugar de la
cuadrícula de cajas. El visor **ya no usa datos de ejemplo**: dibuja exactamente los
racks y cajas que existen en Firestore y escribe de vuelta en la misma base.

## Archivos

| Archivo | Estado |
|---|---|
| `racks.html` | Reescrito: visor 3D integrado con el layout, sidebar y permisos del sistema |
| `rack3d.js` | **Nuevo**: motor 3D alimentado por los datos reales |
| `rack3d.css` | **Nuevo**: estilos del visor |
| `app.js` | Ampliado: `entradaRapida`, `salidaRapida`, `isAdminUser`, alimentación del visor |
| Resto de archivos | Sin cambios |

## Cómo está ligado a las otras secciones

- Los **racks** se dibujan con los niveles y slots que tiene cada rack en la colección
  `racks`. Solo aparecen los racks con status `active`.
- Las **cajas** que se ven en cada slot son los documentos reales de la colección
  `cajas`; la etiqueta impresa en la caja es su número real y su tamaño/color depende
  de cuántos componentes contiene (azul = poco, naranja = medio, verde = llena).
- El botón **+** de una caja registra una **ENTRADA** real: actualiza `componentes`
  del documento y escribe en `historial`.
- El botón **−** registra una **SALIDA** real: descuenta stock, borra el componente si
  llega a cero y escribe en `historial`.
- **+ Nueva caja** crea el documento de caja en ese slot (mismo formato de ubicación
  `RACK-NIVEL-SLOT-CAJA`), y **🗑** la elimina (solo admin).
- Todo movimiento se refleja de inmediato en **Inventario**, **Salida**, **Historial**
  y en la tabla de racks, porque se usa el mismo caché y las mismas colecciones.
- El buscador del visor busca por **componente, PN o número de caja** y hace parpadear
  y salir al frente las cajas donde está el material.

## Funciones conservadas

Agregar rack, activar/desactivar, eliminar rack, crear y eliminar cajas, imprimir
etiquetas, ir al formulario de entrada con la ubicación precargada, y la restricción
de administrador (`roberto.figueroa@gdl.fii-na.com`).

(La vista de lista anterior fue eliminada en la Actualización 6.) Antes: el botón *📋 Ver lista* desplegaba la
cuadrícula clásica de cajas por ubicación.

## Navegación del visor

Rack → Nivel/Slot → Caja. Clic para entrar, *Retroceder* para subir un nivel,
*Vista general* para volver al inicio, *⛶ Pantalla completa* (o `Esc` para salir).
Arrastrar gira la cámara; la rueda hace zoom.

---

## Actualización 2

- Se eliminó por completo la sección **Usuarios** (menú y `usuarios.html`).
- Los racks ahora se dibujan **pegados**, compartiendo parales, como en un almacén real.
- En *Racks y Cajas* aparece primero **Almacén 3D** y debajo la tarjeta de **Racks**.
- Nueva barra superior del visor: el HUD y los controles viven en una misma fila
  con `flex-wrap`, así no se encinan ni se cortan. En pantallas angostas se apilan.
- El botón **⛶ Ampliar** está dentro de esa barra y, al estar ampliado, cambia a
  **↩ Vista previa** (también se sale con `Esc`).
- Cada caja tiene un **selector de status**: *Caja con poco contenido*,
  *Contenido medio*, *Caja llena*. Se guarda en el campo `estado` del documento de la
  caja y cambia su tamaño y color en el 3D. Si una caja no tiene status asignado, se
  calcula solo según cuántos componentes contiene.

---

## Actualización 3

- **Autocompletado de materiales en cada caja del 3D:** al escribir el nombre del
  componente en el formulario de una caja, se muestran coincidencias de materiales
  que ya existen en cualquier otra caja del almacén (con su PN si lo tiene). Si
  seleccionas una sugerencia, se llena el nombre y el PN automáticamente. Si no
  seleccionas ninguna pero el nombre coincide exactamente con uno del catálogo, el
  sistema igual reconoce que es el mismo material y le asigna su número de parte al
  guardar, para que se sume como el mismo registro. Si no coincide con nada, se crea
  un material nuevo — igual que ya sucede en el formulario de Entrada normal.
- **Rotación de cajas al ver un slot:** al entrar a un slot, las cajas vuelven a girar
  despacio sobre su propio eje (como antes). Al abrir una caja en específico, la
  rotación se detiene y la caja se endereza para mostrar su etiqueta de frente.
- **Nuevo status "Caja vacía":** además de *Poco contenido*, *Contenido medio* y
  *Caja llena*, ahora puedes marcar una caja como *Caja vacía* desde su selector de
  status. Una caja recién creada sin componentes se muestra como vacía por defecto.
- **Legibilidad de todos los campos de texto del visor:** el buscador principal y los
  campos dentro de cada caja (componente, PN, cantidad, salida) ahora fuerzan color de
  texto claro para que siempre se vea lo que escribes, sin que los estilos generales
  del sitio los opaquen.

---

## Actualización 4

- **Caja girando + contenido en texto al abrir una rejilla:** al entrar a un slot, cada
  caja sigue girando despacio y de forma lateral (horizontal, sobre su propio eje),
  pero ahora la tarjeta con el contenido en texto queda **un poco arriba** de la caja
  y su letrero (no encima), para que se vea la caja rotando debajo del texto. El fondo
  se mantiene oscuro/opaco igual que antes.
- **Cambiar un material de una caja a otra desde el visor 3D:** cada componente listado
  dentro de una caja tiene ahora un botón **↔** junto al de salida (**−**). Pide la caja
  destino y la cantidad, y mueve el registro usando la misma lógica que la nueva
  sección de Movimientos.
- **Nueva sección "Movimientos" (`movimientos.html`, ítem 06 del menú):**
  1. **Material en movimiento entre cajas** — busca un material por nombre, PN o
     número de caja, elige la caja destino (rack/nivel/slot/caja) y la cantidad; el
     material cambia por completo de ubicación en su registro.
  2. **Material en Tool Crib** — envía material desde cualquier caja al Tool Crib
     (nueva colección `toolcrib` en Firestore, un documento por material, agregado
     por nombre y no por caja). Debajo del formulario hay una tabla con todo lo que
     se ha mandado al Tool Crib: material, PN, cantidad acumulada, última caja de
     origen, responsable, comentarios y fecha.
  3. **Mover cajas de rack, nivel o slot** — mueve una caja completa (con todo su
     contenido) a otro rack/nivel/slot, conservando su número o asignándole uno
     nuevo si así se indica.
  Los tres movimientos quedan registrados en **Historial** con sus propias acciones:
  `MOVIMIENTO MATERIAL`, `ENVIO TOOL CRIB` y `MOVIMIENTO CAJA` (el filtro de
  Historial ya incluye estas opciones).
- El menú lateral se reordenó: **06 Movimientos** y **07 Historial** (antes Historial
  era el 06) en todas las páginas.

---

## Actualización 5

- **Cierre de sesión automático por inactividad (20 min):** cualquier página del
  sistema cierra la sesión sola si pasan 20 minutos sin ningún clic, tecla, scroll
  o toque. Se reinicia con cualquier actividad.
- **Deterrentes contra ver el código fuente:** se bloquea el clic derecho, F12,
  Ctrl+U, Ctrl+Shift+I/J/C y Ctrl+S. **Aviso honesto:** esto no puede impedir de
  forma absoluta que alguien vea el código de una página web (cualquier navegador
  permite abrir sus herramientas de desarrollo desde su propio menú); solo
  desalienta el acceso casual. La protección real de la base de datos depende de
  las **Reglas de Seguridad de Firestore** en la consola de Firebase, que están
  fuera de este código y conviene revisar aparte. Copiar y pegar texto normal
  sigue funcionando sin restricción.
- **Legibilidad garantizada en el visor 3D:** todos los textos de las tarjetas,
  el buscador, los botones y las etiquetas del visor 3D ahora tienen sombra y
  color reforzado para que siempre resalten sobre el fondo, sin importar qué
  tan claro se vea detrás.
- **Etiqueta del modelo 3D actualizada:** ahora dice
  `MODELO DE ALMACÉN · N cajas · N materiales distintos en el área · N materiales distintos en Tool Crib`.
- **Tool Crib — enviar con o sin caja:** al mandar material a Tool Crib ahora
  eliges si conservas la caja en el rack o si te la llevas también (liberando el
  espacio). Si la caja tiene otro material, el sistema no te deja llevártela
  vacía: te ofrece reubicar automáticamente ese material sobrante a otra caja
  primero.
- **Regresar material del Tool Crib:** nuevo bloque en Movimientos → *Mandar
  material a Tool Crib* para regresar todo o solo una parte del material,
  hacia una caja ya existente o hacia una caja nueva (con su propio rack,
  nivel, slot, número y capacidad).
- **Nueva sección "Mandar material a Scrap"** dentro de Movimientos: envía
  material a Scrap desde cualquier caja o desde el Tool Crib; incluye su
  propia tabla acumulada por material. Queda en Historial como `ENVIO SCRAP`
  (y el regreso de Tool Crib como `REGRESO TOOL CRIB`).
- **Movimientos ahora tiene un menú a la izquierda con 4 opciones** que
  cambian el panel de la derecha: *Mover Material de una caja a otra*,
  *Mover cajas de rack, slot o rejilla*, *Mandar material a Tool Crib*
  (incluye el regreso) y *Mandar material a Scrap*.
- **Categoría de materiales:** cada material puede clasificarse como
  *Consumible indirecto*, *Material en SAP*, *Material recibido de Taiwán sin
  registro en SAP*, *Material en validación de Scrap* o *Material en
  validación de envío a Tool Crib*. Se elige al registrar la entrada (en
  Entrada o desde el visor 3D) y se puede cambiar después.
- **Nueva sección "Categorías" (07 en el menú, `categorias.html`):**
  buscador inteligente, filtro por categoría (con chips de resumen), edición
  de categoría en línea, y botones para mandar cada material a Tool Crib o a
  Scrap directamente desde ahí. También hay un botón para ver todo lo de una
  categoría resaltado en el modelo 3D.
- **Búsqueda por categoría en el visor 3D:** el mismo buscador de siempre
  ahora también encuentra cajas por categoría de material, y desde Categorías
  puedes saltar directo a esa búsqueda en el 3D.
- **Tamaño/capacidad de cada caja:** al crear una caja nueva se puede definir
  su capacidad de espacio; cada material que se le agrega puede llevar cuánto
  espacio ocupa, y la tarjeta de la caja muestra una barra con el espacio
  usado contra el total.
- El menú lateral se reordenó otra vez: **07 Categorías** y **08 Historial**
  (antes Historial era el 07) en todas las páginas.

---

## Actualización 6

- **Movimientos en el menú lateral:** al hacer clic en *Movimientos* se despliega
  un submenú en la barra izquierda (como el de Baking) con las 4 opciones:
  *Material entre cajas*, *Mover cajas / slots*, *Material a Tool Crib* y
  *Material a Scrap*. Ya no hay menú interno dentro de la página de Movimientos;
  la opción elegida se marca en el submenú. Funciona igual desde cualquier página
  (`nav.js` nuevo, incluido en todas las páginas con sidebar).
- **Buscadores con fondo oscuro y letra blanca** (con ícono de lupa) en: Inventario,
  Historial, Registrar Salida, Registrar Entrada (campo Producto), Categorías,
  las tres búsquedas de Movimientos y sus listas de resultados/sugerencias.
- **Arreglo del buscador 3D (blanco sobre blanco):** al hacer clic dentro, el
  estilo global de los campos lo volvía blanco con letra blanca. Ahora el fondo
  se mantiene oscuro también al enfocar; lo mismo en los campos de cada caja
  (componente, PN, cantidad, espacio) y en sus selectores.
- **Encabezado del Modelo de Almacén ordenado:** título limpio y debajo tres
  chips: cajas · materiales distintos en el área · materiales distintos en Tool Crib.
- **Cuatro colores de status** (Caja vacía = rojo, Poco contenido = azul, Contenido
  medio = naranja, Caja llena = verde). La leyenda de abajo a la izquierda ahora
  muestra los cuatro y se pinta desde el mismo código que colorea las cajas, así
  siempre coinciden.
- **Tamaño de caja:** nuevo selector *Tamaño de caja* (Chica / Mediana / Grande)
  debajo del status. Se guarda en el campo `tamano` de la caja y es lo único que
  define su dimensión en el 3D (el status ahora solo cambia el color). Las cajas
  sin tamaño guardado se ven Medianas. Al mover una caja de rack/slot conserva su tamaño.
- **Se eliminó el botón "Ver lista"** del visor 3D (y la vista de lista asociada).

---

## Actualización 7

- **Cajas apoyadas una sobre otra (sin flotar):** en cada slot las cajas se acomodan
  en una rejilla sobre la repisa y, cuando ya no caben en el piso, se colocan
  encima de la caja de abajo. La altura de cada pila se calcula con la altura real
  de cada caja (chica/mediana/grande), así siempre quedan pegadas.
- **Auto-ajustable:** si un slot tiene muchas cajas (15, 30 o más), todas se reducen
  de forma uniforme lo necesario para que quepan dentro del slot sin salirse de la
  repisa ni chocar con el nivel de arriba.
- **Galería al abrir un slot:** las cajas ya no se encimen. Se reparten en una
  rejilla de pantalla: arriba cada caja 3D girando y debajo su tarjeta con el
  contenido, el status, el tamaño y los campos de entrada de siempre. Las columnas
  se ajustan al ancho disponible; con muchas cajas la galería se desplaza con la
  rueda del mouse (las cajas 3D siguen a su tarjeta). Dentro de la galería, las
  proporciones chica/mediana/grande se conservan.
- **Al guardar** algo en una caja la galería conserva la posición del scroll.
- **Detalles:** la tarjeta de inspección de una sola caja ya no se corta por arriba y
  la cantidad de cada componente (campo numérico de salida) ahora se ve.

---

## Actualización 8

- **Cero espacio entre cajas apiladas:** antes había un pequeño margen (6 mm) también
  en la dirección vertical, que a cierta distancia de cámara se veía como un hueco
  entre una caja y la de abajo. Ahora el espaciado vertical es 0: cada caja se apoya
  exactamente en el tope de la de abajo (pegadas de verdad), y el espacio de aire
  queda solo entre columnas/filas vecinas (para distinguir una caja de la de al lado).
- **Galería del slot más espaciada:** más separación entre tarjetas (antes 18px, ahora
  22–26px) y columnas un poco más angostas (230px en vez de 250px), así entran más
  columnas en pantalla y las cajas no se ven encimadas. La caja 3D girando también se
  ve más grande (hasta 210px de alto cuando hay pocas cajas en el slot).
- **Confirmado:** el tamaño de una caja (Chica/Mediana/Grande) es el único que define
  sus dimensiones en el 3D; el status (vacía/poco/medio/llena) solo cambia el color,
  nunca el tamaño — se puede definir al crearla o cambiarla después desde su selector
  "Tamaño de caja", sin depender de si tiene contenido o no.

---

## Actualización 9

- **Tarjeta de caja simplificada en el visor 3D:** se quitó el botón **↔** (mover
  material a otra caja) de cada componente listado, y se quitó la fila de
  **categoría/espacio** del formulario rápido de la caja. La categoría y el
  espacio que ocupa un material ahora se asignan únicamente desde **Registrar
  Entrada**, que ya tenía esos campos.
- **Número de caja único en todo el almacén:** ya no puede existir, por
  ejemplo, una "Caja 01" en dos racks o slots distintos — el sistema lo revisa
  al crear cualquier caja nueva (desde Racks y Cajas, el visor 3D o Registrar
  Entrada) y bloquea el número si ya está en uso en cualquier otra ubicación.
- **Numeración automática:** al crear una caja nueva, el número propuesto por
  default es el siguiente entero disponible después del más alto ya
  registrado (se puede cambiar por cualquier otra etiqueta si se prefiere).
- **Crear cajas desde Registrar Entrada:** con rack, nivel y slot elegidos,
  el botón **+ Nueva caja en este slot** crea la caja ahí mismo y la deja
  lista para registrar la entrada, sin salir del formulario.
- **"Caja seleccionada" con su número:** el campo ahora muestra la ubicación
  completa y, entre paréntesis, el número de caja — por ejemplo
  `A-03-01-06 (caja 06)`.
- **Editar materiales ya registrados — solo administrador:** en Inventario,
  `roberto.figueroa@gdl.fii-na.com` ve un botón **✏ Editar** junto a cada
  material para corregir cantidad, Part Number y comentarios. El cambio queda
  en Historial como `ACTUALIZACION`.
- **Borrar movimientos del Historial — solo administrador:** la tabla de
  Historial ahora tiene una columna de acciones con un botón **🗑** (solo
  visible para el administrador) que borra ese movimiento de forma
  permanente. Se agregó el filtro "Solo Actualizaciones" al desplegable de
  tipos.

---

## Actualización 10

- **Categoría de material directamente desde el visor 3D:** dentro de una caja
  abierta en el rack 3D ya no hace falta ir a Registrar Entrada para
  clasificar un material. Cada componente listado tiene su propio selector
  de categoría (Consumible indirecto, Material en SAP, Material recibido de
  Taiwán sin registro en SAP, Material en validación de Scrap, Material en
  validación de envío a Tool Crib), y el formulario para agregar un
  componente nuevo también incluye ese mismo selector antes de guardar.
  El status de la caja (vacía/poco/medio/llena) y su tamaño (chica/mediana/
  grande) ya vivían en esa misma tarjeta y se mantienen igual — ahora las
  tres asignaciones (status, tamaño y categoría) se hacen sin salir del
  slot/caja dentro del 3D.

---

## Actualización 11 — Tiempo real y avisos flotantes

- **Todo se refleja al instante para todos los usuarios conectados.** `app.js`
  ahora escucha en vivo (Firestore `onSnapshot`) las colecciones `cajas`,
  `racks`, `toolcrib` y `scrap`. Cuando alguien registra, mueve, elimina o
  actualiza algo, las pantallas abiertas de los demás se actualizan solas, sin
  recargar: Inventario, Racks y visor 3D, Tool Crib, Scrap, Categorías y las
  listas desplegables de Movimientos. La página de Historial también se
  actualiza sola.
- **Aviso flotante discreto (esquina inferior derecha).** Cada vez que alguien
  hace una entrada, salida, movimiento de material o de caja, envío/regreso de
  Tool Crib, envío a Scrap, eliminación o actualización, aparece una tarjeta
  pequeña que dice **quién lo hizo y qué hizo** (ej. "Roberto Figueroa
  registró una entrada — 10 × Resistor — R1-01-02-03"). Dura unos segundos, se
  cierra con un clic y se apilan máximo 4. Quien hizo la acción ve "Tú".
- **Sin interrumpir a nadie:** si alguien está escribiendo en una tarjeta del
  visor 3D, el visor espera a que termine antes de refrescarse para no borrarle
  lo que escribe. Las listas de Movimientos conservan lo que ya estaba
  seleccionado.
- Cada movimiento del historial ahora guarda además `ts` (hora exacta) y `sid`
  (identificador de la sesión). Los movimientos anteriores siguen funcionando
  igual; solo no generan aviso porque son viejos.
- Ajustes de constantes al inicio del bloque "TIEMPO REAL" de `app.js`:
  `TR_TOAST_MS` (duración del aviso) y `TR_TOAST_MAX` (cuántos a la vez).
- **Reglas de Firestore:** los avisos consultan `historial` filtrando por `ts`;
  con las reglas actuales de lectura no hay que cambiar nada.

Archivos modificados: `app.js`, `movimientos.html`, `CAMBIOS.md`.

---

## Actualización 12 — Inventario sumado por material y solo mayúsculas

- **Inventario por cantidades totales:** si el mismo material está en varias
  cajas (aunque sea con mayúsculas/minúsculas distintas), aparece en **una sola
  fila** con la cantidad **total sumada**. La columna *Cajas / Ubicación* sigue
  mostrando en qué cajas está y cuánto hay en cada una (ej. `A-03-01-04 × 55`).
  Los materiales que ya estaban registrados se suman automáticamente en la
  vista, sin tocar los datos guardados.
- **Acciones por caja:** el administrador edita o elimina el material caja por
  caja (✏ / 🗑 con el número de caja al lado).
- **Registro nuevo:** si el material ya existe en la misma caja, se suma; si no
  se escribe PN y el material ya existe en otra caja, hereda su PN.
- **Solo mayúsculas:** todos los campos de texto y comentarios (incluidos los
  del visor 3D y los buscadores) convierten lo escrito a mayúsculas. No afecta
  correo, contraseña, números ni campos de solo lectura. Lo que se guarda
  (material, PN, comentarios) también queda en mayúsculas, incluso lo capturado
  en ventanas emergentes de edición.
- Exportar a Excel ahora escribe las cajas de cada material separadas por " | ".

Archivos modificados: `app.js`, `stock.html`, `CAMBIOS.md`.

## v8 — Historial, llenado y Registrar Entrada

- **Historial**: ahora se ordena del movimiento más reciente al más viejo (por marca de tiempo `ts`; los registros viejos sin `ts` se ordenan leyendo su fecha).
- **Espacio que ocupa / capacidad**: eliminado de Registrar Entrada, del visor 3D (barra de espacio), de la creación de cajas y del regreso desde Tool Crib. Se conservan el **tamaño de caja** (chica / mediana / grande) y el **status** (vacía / poco contenido / medio / llena).
- **Registrar Entrada → + Nueva caja en este slot**: abre un panel para elegir número de caja (sugerido automático), tamaño y status, igual que en el 3D; al crearla queda seleccionada en el formulario.


---

## Update: Chat + etiquetas con más de 3 materiales

**Archivos nuevos:** `chat.html`
**Archivos modificados:** `app.js`, `etiquetas.js`, `entrada.html` y el menú lateral (opción 10 Chat) de todas las páginas con menú.

### Chat (menú 10)
- Lista de usuarios con punto **verde** (conectado) o **rojo** (inactivo, con "hace X min"). Un usuario aparece en la lista cuando ha entrado al sistema después de este update (o si ya existe en la colección `usuarios`).
- Mensajes privados 1 a 1. Solo los ven quien los envía y quien los recibe.
- Al llegar un mensaje aparece un aviso flotante en cualquier página; al pulsarlo abre `chat.html` con esa conversación. El menú muestra el contador de no leídos y parpadea.
- Los mensajes se marcan como "✓ visto" cuando el otro usuario los abre.

### Etiquetas
- Más de 3 materiales en la caja: el campo Material dice **"MÁS DE 3 MATERIALES EN ESTA CAJA"** y el material que te llevas se anota en la tabla.
- Todas las etiquetas con más de un material tienen en la tabla una columna nueva **MATERIAL** (con espacio para anotarlo; los movimientos registrados en el sistema ya salen con el nombre).
- Si el material no tiene P/N o Medida, esas líneas **ya no se escriben** en la etiqueta.
- Si la caja ya tenía etiqueta de "más de 3 materiales", agregar otro material no obliga a cambiarla físicamente.

### Reglas de Firestore a agregar (colecciones nuevas `presencia` y `mensajes`)
```
match /presencia/{email} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.token.email.lower() == email;
}
match /mensajes/{id} {
  allow create: if request.auth != null
    && request.resource.data.de == request.auth.token.email.lower();
  allow read: if request.auth != null
    && (resource.data.de == request.auth.token.email.lower()
        || resource.data.para == request.auth.token.email.lower());
  allow update: if request.auth != null
    && resource.data.para == request.auth.token.email.lower()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['leido']);
}
```
(Sin estas reglas el chat no funciona, y sin la regla de `mensajes` no se garantiza que cada mensaje sea visible solo para su destinatario.)

---

## Update: Material de migración — cajas pendientes de acomodar

**Archivos modificados:** `app.js`, `rack3d.js`, `rack3d.css`, `racks.html`, `historial.html`, `CAMBIOS.md`
(no hay archivos nuevos ni colecciones nuevas en Firestore: **no hay que cambiar las reglas**).

### Qué es "material de migración"
Todas las cajas que ya estaban registradas antes de este update. No se sabe todavía en qué
posición real del rack está cada una, así que **dejan de dibujarse dentro de los racks** y se
muestran aparte, a un lado, como **pendientes de acomodar**. No se modifica ningún dato guardado:
una caja cuenta como de migración si no tiene el campo `migracion` (las cajas viejas no lo tienen).
Toda caja **nueva** se crea con `migracion:false` y funciona exactamente como siempre.

### Racks y Cajas (visor 3D)
- **Área "PENDIENTES DE ACOMODAR"** a la derecha del último rack: tarima con letrero y el total,
  con las cajas pendientes en rejilla (apiladas si son muchas). La vista general se encuadra para
  que se vean los racks y el área.
- Clic en el área (o en una caja pendiente) → la cámara se acerca y se abre un **panel con la lista**
  de pendientes (número de caja, piezas y materiales), con filtro por caja o material.
- **Acomodar una caja:** abre un rack → nivel → rejilla (slot). Abajo aparece
  **"Nº de caja pendiente" + "📥 Acomodar caja aquí"** (con autocompletado de los números pendientes).
  Al ingresar el número se abre una ventana con **el contenido de la caja** y la posición destino.
  **Confirmar y guardar** → la caja desaparece de pendientes y pasa al rack, en esa posición, con todo
  su contenido, estado, tamaño y categorías. Es una sola operación atómica (crea en el slot y borra
  el registro pendiente a la vez).
- Si el número no es pendiente avisa por qué: no existe, ya fue acomodada (y dónde), o es material nuevo.
- Si otro usuario acomoda la misma caja al mismo tiempo, el sistema lo detecta y no duplica nada.
- El buscador del 3D también encuentra (y hace parpadear) las cajas pendientes.
- El chip de arriba muestra cuántas cajas hay **en racks** y, aparte, cuántas están **pendientes**.
  "Materiales distintos en el área" cuenta también lo pendiente.

### Otras secciones
- **Inventario:** las cajas pendientes aparecen como `CAJA 06 · PENDIENTE DE ACOMODAR` en vez de una
  ubicación provisional. Las cantidades siguen sumándose igual.
- **Historial:** el acomodo queda como `ACOMODO CAJA` (nuevo filtro) y genera el aviso flotante.
- **Mover cajas / slots, Registrar Entrada, Imprimir etiquetas de slots:** no incluyen las pendientes
  (todavía no están en ningún slot). Una caja pendiente se acomoda desde el visor; ya acomodada se
  puede mover y usar como cualquier otra.
- **Eliminar rack** ya no borra las cajas pendientes (no están dentro del rack).
- El número de caja sigue siendo único en todo el almacén, también contra las pendientes. Las
  etiquetas físicas no cambian (van por número de caja).

---

## Update: Solo rack A + Tarimas 1 a 4

**Archivos modificados:** `app.js`, `rack3d.js`, `CAMBIOS.md` (sin cambios en Firestore ni en reglas).

- **Solo el rack A está activo.** Los demás racks quedan inactivos (no se borra nada). Todo el material registrado en el rack A se dibuja en su posición, sin pasar por pendientes.
- **Tarimas T1–T4**, vistas de frente: **Tarima 1 a la izquierda** del rack; **Tarimas 2, 3 y 4 a la derecha**. Cada una es una ubicación de 1 nivel y 1 slot (`T1-01-01-05`), así que se puede registrar y guardar material en todas (Registrar Entrada, Salida, Movimientos, 3D, Inventario, Historial, etiquetas). En el 3D, clic en la tarima abre directo sus cajas; en los selectores aparecen como "Tarima N" con nivel y slot ya seleccionados.
- **Pendientes de registro** quedan después de las tarimas (a la derecha). Ahí está todo el material que no está en el rack A ni en una tarima (incluido el de racks inactivos); se acomoda como siempre desde un slot del rack A o desde una tarima.
- Las tarimas no se administran en la tabla de Racks (están siempre activas, se definen en `app.js`: `TARIMAS_ALMACEN`; el rack activo en `RACKS_ACTIVOS_FIJOS`).
