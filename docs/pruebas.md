# Plan y resultados de pruebas – Konys Pizza

Etapa 5 del plan de desarrollo: pruebas de punta a punta, validaciones, seguridad, rendimiento y responsividad.

| Dato | Valor |
|---|---|
| Fecha de ejecución | 5 de noviembre de 2026 |
| Entorno | Servidor local `npm run dev` (carpeta `dist/`) en `http://localhost:3000`, con los mismos encabezados de seguridad que Vercel |
| Base de datos | Supabase, proyecto `konys-pizza` (PostgreSQL 17, us-east-1) |
| Navegador | Chrome 152 (Chromium) |
| Datos | 8 mesas, 14 horarios (2 jornadas × 7 días, turnos de 60 min), 45 platos de la carta real |

**Resultado general: 89 de 89 casos aprobados.**

| Grupo | Casos | Aprobados |
|---|---|---|
| Base de datos y reglas de negocio (BD) | 33 | 33 |
| Seguridad del sitio (SEG) | 7 | 7 |
| Rendimiento (REN) | 2 | 2 |
| Interfaz del cliente (UI) | 25 | 25 |
| Panel de administración (AD) | 14 | 14 |
| Responsividad (RES) | 8 | 8 |

## Cómo se ejecutaron

- **Base de datos:** consultas SQL con el rol público (`anon`) y simulando sesiones de usuario, todas dentro de una transacción que se deshace al final (`rollback`), para no dejar datos de prueba.
- **Interfaz:** se recorrieron los flujos en el navegador, escribiendo en los campos y pulsando los botones, y se compararon los mensajes y estados obtenidos con los esperados.
- **Seguridad y rendimiento:** peticiones HTTP con `curl` al sitio local y a la API de Supabase.
- Las únicas reservas reales que se crearon en las pruebas de interfaz se borraron al terminar. Al final se verificó que la base quedó igual que antes: 7 reservas, 8 mesas activas, 45 platos y el horario sin cambios.

---

## 1. Base de datos y reglas de negocio

Pruebas sobre la función `crear_reserva()` y las reglas RLS, llamando a la base directamente (sin pasar por el formulario).

| ID | Requisito | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| BD-01 | RF-05 | Reserva válida (Mesa 3, 7:00 p. m., 4 personas, celular 3001112233) | Se crea con hora de fin calculada | Reserva Mesa 3, 19:00–20:00, estado `confirmada` | ✅ |
| BD-02 | CU-02 / 12.2 | Segunda reserva en el mismo turno y mesa | Rechazada | `KP005`: "Ese horario acaba de ser reservado. Elige otro." | ✅ |
| BD-03 | RF-05 | 5 personas en mesa de 4 | Rechazada | `KP002`: "Esta mesa recibe máximo 4 personas." | ✅ |
| BD-04 | RF-04 | Hora que no coincide con un turno (7:30 p. m.) | Rechazada | `KP004`: "Ese horario no está disponible para reservas." | ✅ |
| BD-05 | RF-03 | Hora fuera de las jornadas (3:00 p. m.) | Rechazada | `KP004` | ✅ |
| BD-06 | RF-03 | Fecha pasada | Rechazada | `KP003`: "Elige una fecha y hora futuras." | ✅ |
| BD-07 | Validación | Fecha a más de 30 días | Rechazada | `KP003`: "Solo se puede reservar con hasta 30 días de anticipación." | ✅ |
| BD-08 | Validación | Nombre con números (`Juan123`) | Rechazado | `KP006`: "Escribe un nombre válido…" | ✅ |
| BD-09 | RNF-05 | Nombre con HTML (`<script>alert(1)</script>`) | Rechazado | `KP006` | ✅ |
| BD-10 | Validación | Celular que empieza por 2 | Rechazado | `KP007`: "El teléfono debe tener 10 dígitos y empezar por 3." | ✅ |
| BD-11 | Validación | Celular de 5 dígitos | Rechazado | `KP007` | ✅ |
| BD-12 | Validación | Nombre con espacios de sobra (`"  Ana   María  "`) y celular con espacios | Se normalizan y se guarda | Guardado como "Ana María", celular sin espacios | ✅ |
| BD-13 | Anti-abuso | Tercera reserva con el mismo nombre el mismo día | Rechazada | `KP008`: "Ya tienes 2 reservas a tu nombre para ese día." | ✅ |
| BD-14 | Anti-abuso | Cuarta reserva activa con el mismo celular | Rechazada | `KP008`: "Este teléfono ya tiene 3 reservas activas…" | ✅ |
| BD-15 | RNF-05 | Público inserta directo en `reservas` (sin la función) | Bloqueado por RLS | `42501`: viola la política de seguridad | ✅ |
| BD-16 | RNF-05 | Público intenta desactivar todas las mesas | Ningún cambio | 8 de 8 mesas siguen activas | ✅ |
| BD-17 | RNF-05 | Público intenta borrar la carta | Ningún cambio | 45 platos siguen ahí | ✅ |
| BD-18 | RNF-05 | Público lee la tabla de reservas | No ve datos personales | 0 filas visibles | ✅ |
| BD-19 | RF-04 | `slots_ocupados()` para la grilla | Solo horas, sin nombres ni teléfonos | 3 turnos ocupados; campos: `mesa_id`, `hora_inicio`, `hora_fin` | ✅ |
| BD-20 | RF-08 | Público llama a `es_admin()` | Sin permiso | `42501`: permission denied | ✅ |
| BD-21 | RF-13 | Mesa 7 inactiva: ¿la ve el público? | No aparece | 7 mesas visibles | ✅ |
| BD-22 | RF-13 | Reservar la mesa inactiva | Rechazada | `KP001`: "La mesa no existe o no está disponible." | ✅ |
| BD-23 | RF-08 | Usuario con sesión pero **no** administrador modifica mesas | Ningún cambio | 0 filas modificadas | ✅ |
| BD-24 | RF-08 | Usuario no administrador lee reservas | No ve nada | 0 filas | ✅ |
| BD-25 | RF-12 | Administrador lee reservas | Ve todas | `es_admin = true`, 13 reservas visibles (las de la prueba incluidas) | ✅ |
| BD-26 | RF-13 | Administrador reactiva una mesa | Se guarda | 1 fila | ✅ |
| BD-27 | RF-11 | Administrador edita un horario | Se guarda | 1 fila | ✅ |
| BD-28 | RF-14 | Administrador crea un plato | Se guarda | 1 fila | ✅ |
| BD-29 | RF-12 | Administrador cancela una reserva | Se guarda | 1 fila | ✅ |
| BD-30 | RNF-05 | Foto de mesa con `javascript:alert(1)` | Rechazada | `23514` (restricción `mesas_foto_url_check`) | ✅ |
| BD-31 | Validación | Precio de $5.000.000 | Rechazado | `23514` (`platos_precio_check`) | ✅ |
| BD-32 | RNF-05 | Descripción con `<img onerror=…>` | Rechazada | `23514` (`platos_descripcion_check`) | ✅ |
| BD-33 | 12.2 | Volver a confirmar una reserva cancelada cuyo turno ya tomó otra persona | Rechazado | `23P01`: restricción `reservas_sin_cruce` | ✅ |

## 2. Seguridad del sitio

| ID | Requisito | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| SEG-01 | RNF-05 | Encabezados HTTP de seguridad | CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Los 5 presentes | ✅ |
| SEG-02 | RNF-05 | Acceso a archivos internos (`.env`, `package.json`, `supabase/schema.sql`, `scripts/…`, `vercel.json`, `README.md`) | No se publican | Los 6 devuelven 404 | ✅ |
| SEG-03 | RNF-05 | Script de Supabase con *Subresource Integrity* | Atributo `integrity` en las páginas que lo usan | Presente en `index.html` y `admin.html` | ✅ |
| SEG-04 | RNF-05 | Sin estilos ni scripts en línea (CSP estricta) | 0 coincidencias | 0 en `index.html`, `admin.html` y `404.html` | ✅ |
| SEG-05 | – | Rutas que no existen (`/no-existe`, `/mesas/x/y`) | Código 404 y página propia | 404 con "Página no encontrada – Konys Pizza" | ✅ |
| SEG-06 | RNF-05 | Conexión a la base por HTTPS | URL `https://…supabase.co` | HTTPS | ✅ |
| SEG-07 | RNF-05 | Incrustar el sitio dentro de un iframe (*clickjacking*) | El navegador lo bloquea | Bloqueado por `X-Frame-Options: DENY` | ✅ |

## 3. Rendimiento

| ID | Requisito | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| REN-01 | RNF-03 | Carga de la página principal | Menos de 3 s | 92 ms hasta poder usarla (`DOMContentLoaded`), 498 ms con todo cargado | ✅ |
| REN-02 | RNF-03 | Consultas a Supabase (5 intentos) | Menos de 1 s | Mesas: 147–180 ms · Turnos ocupados: 148–167 ms | ✅ |

## 4. Interfaz del cliente

| ID | Requisito | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| UI-01 | RNF-03 | Abrir la página principal | Carga rápida y sin errores | 498 ms; consola sin errores del sitio | ✅ |
| UI-02 | RF-01 | Tarjetas de mesas | 8 mesas con zona, capacidad y disponibilidad de hoy | 8 tarjetas, "Disponibilidad para hoy, jueves, 5 de noviembre" | ✅ |
| UI-03 | RF-01 | Filtro por zona | Salón / Terraza / Todas | 4 / 4 / 8 | ✅ |
| UI-04 | RF-02 | Clic en la Mesa 6 | Se abre el modal con sus datos | "Mesa 6 · Terraza · hasta 4 personas" | ✅ |
| UI-05 | RF-03 | Días disponibles | 14 días; los que no tienen turnos futuros, deshabilitados | 14 días; solo hoy deshabilitado (ya pasaron las 10 p. m.) | ✅ |
| UI-06 | RF-04 | Turnos del día elegido | Almuerzo y noche según la tabla `horarios` | 8 turnos (12:30, 13:30, 17:00 a 22:00) | ✅ |
| UI-07 | CU-02 | Confirmar sin elegir hora | Mensaje de error | "Elige un día y una hora disponibles." | ✅ |
| UI-08 | RF-04 | Elegir un turno | Se actualiza el resumen | "vie, 6 de nov / 12:30 p. m. – 1:30 p. m." | ✅ |
| UI-09 | RF-05 | Confirmar sin nombre | Error y campo marcado | Mensaje de error y `aria-invalid=true` | ✅ |
| UI-10 | Validación | Escribir números, HTML y 80 letras en el nombre | Se eliminan y se limita a 50 | `Juan123 <b>!!` → `Juan b`; 80 letras → 50 | ✅ |
| UI-11 | Validación | Pegar celular con indicativo o letras | Solo dígitos, sin el 57 | `+57 (300) 123-4567` → `3001234567`; `abc300` → `300` | ✅ |
| UI-12 | Validación | Celular que empieza por 2 | Mensaje de error | "El teléfono debe tener 10 dígitos y empezar por 3." | ✅ |
| UI-13 | CU-02 (alterno) | Pasarse de la capacidad | Contador detenido en el máximo y aviso | Se detiene en 4, botón "+" deshabilitado, aviso visible | ✅ |
| UI-14 | RF-05 | Reserva completa de punta a punta | Se guarda y muestra confirmación | Confirmación en 531 ms | ✅ |
| UI-15 | RF-06 | Comprobante | Número, nombre, mesa, fecha, hora y personas | "KP-0036 · Prueba Interfaz · Mesa 6 · Terraza · viernes, 6 de noviembre · 7:00 – 8:00 p. m. · 3" | ✅ |
| UI-16 | RF-06 | Formulario tras confirmar | Se oculta | Oculto (`display: none`) | ✅ |
| UI-17 | RF-04 | Volver a abrir la misma mesa y fecha | El turno reservado aparece ocupado | 7:00 p. m. deshabilitado | ✅ |
| UI-18 | 12.2 | **Condición de carrera:** otro cliente toma el turno mientras el formulario está abierto | Mensaje de error, el turno se bloquea y no se confirma | "Ese horario acaba de ser reservado. Elige otro."; 8:00 p. m. deshabilitado | ✅ |
| UI-19 | 12.2 | Saltar el navegador y llamar directo a la API con un turno ocupado | Rechazado por el servidor | `KP005` | ✅ |
| UI-20 | RF-07 | Carta por categorías | Pizzas 20, entradas 10, postres 2, bebidas 13 | Igual; primero la Bukara | ✅ |
| UI-21 | RF-07 | Íconos de la carta | Varían según el plato | 9 íconos distintos solo en pizzas | ✅ |
| UI-22 | RF-07 | Precios | Formato en pesos colombianos | "$ 29.900" | ✅ |
| UI-23 | – | Enlaces de contacto | WhatsApp, Instagram, Facebook y Clubify; externos con `rel="noopener"` | 5 / 2 / 1 / 1, todos con `noopener` | ✅ |
| UI-24 | – | Mapa de ubicación | Se muestra con título accesible | iframe de 420 px con título descriptivo | ✅ |
| UI-25 | Accesibilidad | Imágenes | Ninguna rota y todas con `alt` | 10 imágenes: 0 rotas, 0 sin `alt` | ✅ |

## 5. Panel de administración

| ID | Requisito | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| AD-01 | RF-08 | Abrir `/admin` sin sesión | Pantalla de acceso, panel oculto, botones para volver al inicio | Correcto, 3 enlaces al inicio | ✅ |
| AD-02 | RF-08 | Entrar con campos vacíos | Mensaje de error | "Escribe tu correo y tu contraseña." | ✅ |
| AD-03 | RF-10 | Listado de mesas | Todas las mesas | 8 filas | ✅ |
| AD-04 | RNF-05 | Cambiar una mesa sin sesión (panel forzado) | La base lo rechaza y se avisa | "Tu sesión no tiene permisos para este cambio." | ✅ |
| AD-05 | Validación | Nombre de mesa con HTML | Se eliminan los símbolos | `Mesa <b>9</b>;` → `Mesa b9b` | ✅ |
| AD-06 | RF-09 | Capacidad 45 | Rechazada | "La capacidad debe ser un número entero entre 1 y 30." | ✅ |
| AD-07 | RNF-05 | Foto con `javascript:` | Rechazada | "La URL de la foto debe empezar por https://…" | ✅ |
| AD-08 | RF-11 | Jornada con fin antes del inicio | Rechazada | "Lunes (noche): la hora de fin debe ser después de la de inicio." | ✅ |
| AD-09 | RF-11 | Cambiar el fin de la jornada | Los turnos se recalculan | Lunes: 7 turnos al cerrar a las 10 p. m. | ✅ |
| AD-10 | RF-12 | Reservas sin sesión | No se muestran datos | "No hay reservas con estos filtros." | ✅ |
| AD-11 | RF-14 | Listado de la carta | Todos los platos, también los ocultos | 45 platos | ✅ |
| AD-12 | Validación | Plato con `<script>` en el nombre | Rechazado | Mensaje de formato permitido | ✅ |
| AD-13 | Validación | Precio con puntos (`25.000`) | Se limpia | `25000` | ✅ |
| AD-14 | Validación | Precio de $2.500.000 | Rechazado | "…hasta $1.000.000." | ✅ |

> El inicio de sesión con la cuenta real del administrador y los cambios guardados desde el panel los probó el administrador con su contraseña. Los permisos de esa cuenta se verificaron en la base de datos (BD-25 a BD-29).

## 6. Responsividad (RNF-02)

| ID | Tamaño | Caso | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| RES-01 | Celular 375 × 812 | Página principal | Sin scroll horizontal | Ancho del documento 375 px | ✅ |
| RES-02 | Celular 375 × 812 | Menú móvil | Abre con el botón y se cierra al elegir una sección | Abre (`aria-expanded=true`) y se cierra | ✅ |
| RES-03 | Celular 375 × 812 | Modal de reserva | Pantalla completa, turnos en 3 columnas, días con scroll lateral, botones táctiles | 375 × 812, 3 columnas, días con scroll, botones ≥ 40 px | ✅ |
| RES-04 | Celular 375 × 812 | Acceso y panel de administración | Sin scroll horizontal; tablas con scroll propio | 375 px; la tabla se desplaza dentro de su caja | ✅ |
| RES-05 | Celular 375 × 812 | Página 404 | Sin scroll horizontal, estilos y logo cargados | 375 px, fuente Poppins y logo cargados | ✅ |
| RES-06 | Tablet 768 × 1024 | Página principal y modal | Sin scroll horizontal; turnos en 6 columnas | 768 px, 6 columnas | ✅ |
| RES-07 | Escritorio 1198 × 916 | Modal de reserva | Ajustado a su contenido, sin franja vacía | Modal 754 px = contenido 754 px | ✅ |
| RES-08 | Portátil 1366 × 650 | Modal en pantalla baja | Scroll interno y botón "Confirmar" alcanzable | Scroll interno; botón visible al final | ✅ |

---

## Errores encontrados y corregidos durante el desarrollo

| # | Error | Causa | Corrección |
|---|---|---|---|
| 1 | Algunos errores de `crear_reserva()` no se podían capturar | Los códigos `P0002`–`P0004` ya los reserva PostgreSQL (`P0004` = *assert_failure*) | Códigos propios `KP001`–`KP008` |
| 2 | Tras confirmar, el formulario seguía visible sobre el comprobante | El `display: flex` del CSS anulaba el atributo `hidden` | Regla global `[hidden] { display: none !important; }` |
| 3 | El panel decía "guardado" sin haber guardado | Con RLS, un cambio no permitido no da error: afecta 0 filas | Toda escritura del panel comprueba que afectó al menos una fila |
| 4 | Tarjetas y botones ya no se levantaban al pasar el mouse | Las animaciones de entrada con `fill-mode: both` fijaban `transform` | Cambio a `fill-mode: backwards` |
| 5 | El modal de reserva dejaba una franja vacía abajo | `height: auto` en un `<dialog>` con `inset: 0` lo estira a toda la pantalla | `height: fit-content` |
| 6 | Un celular pegado como `+57 300…` quedaba mal | El filtro conservaba el 57 del indicativo | Se quita el 57 cuando sobran dígitos |
| 7 | Vercel publicaría `package.json`, `supabase/` y `scripts/` | `outputDirectory: "."` | El build copia a `dist/` solo HTML, CSS, JS e imágenes |

## Pendiente por probar

- **RNF-07 Compatibilidad:** las pruebas se hicieron en Chrome (y Edge, que usa el mismo motor). Falta revisar a mano en **Firefox** y **Safari**. Algunas animaciones, como la transición entre páginas y la aparición al hacer scroll, solo existen en Chrome y Edge; en los demás navegadores la página funciona igual, sin esas animaciones.
- **RNF-04 Disponibilidad:** se verifica después del despliegue en Vercel.
- **Repetir las pruebas sobre la URL pública** de Vercel después del despliegue.
