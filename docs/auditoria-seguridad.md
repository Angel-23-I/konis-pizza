# Auditoría de seguridad y responsividad – Konys Pizza

| Dato | Valor |
|---|---|
| Fecha | 7 de noviembre de 2026 |
| Alcance | API de Supabase (tablas, funciones RPC, permisos y RLS), autenticación del panel, frontend (inyección de HTML, campos, encabezados HTTP), secretos y dependencias, y responsividad en celulares |
| Método | Pruebas con el rol público (`anon`) contra la API REST real, simulación de sesiones en SQL dentro de transacciones que se deshacen, revisión del código y medición en el navegador a 320, 390 y 740 × 360 px |

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | El rol público tenía permisos de tabla completos (incluido `TRUNCATE`, que RLS no cubre) | Media | ✅ Corregido |
| 2 | Cualquiera puede registrarse en Supabase Auth (`disable_signup: false`) | Media | ⚠️ Requiere acción en el panel de Supabase |
| 3 | Un dato de las notificaciones entraba al HTML sin escapar | Baja | ✅ Corregido |
| 4 | Se podían crear reservas en masa para llenar todas las mesas | Media | ✅ Corregido (límite por conexión) |
| 5 | El código de reserva se podía adivinar por fuerza bruta, y cancelar con él | Alta | ✅ Corregido (bloqueo tras 8 intentos) |
| 6 | La sesión del administrador no expiraba por inactividad | Baja | ✅ Corregido (30 minutos) |
| 7 | Faltaban `Cross-Origin-Opener-Policy` y `upgrade-insecure-requests` | Baja | ✅ Corregido |
| 8 | Protección contra contraseñas filtradas desactivada | Baja | ⚠️ Requiere acción en el panel de Supabase |
| 9 | Varios botones medían menos de 44 px y algunos campos causaban zoom en iPhone | Media (usabilidad) | ✅ Corregido |

## Lo que ya estaba bien

- Las 7 tablas tienen **RLS activo**; las reservas y notificaciones solo las ve el administrador.
- Todas las funciones fijan `search_path` (evita el secuestro de funciones por esquema).
- Las funciones internas (`validar_turno`, `reserva_a_json`, `identificar_reserva`, `es_admin`, el trigger) **no se pueden llamar desde la API**.
- La base valida cada dato aunque se salte el formulario: formato del nombre, celular colombiano, capacidad, fecha, horario y la restricción `reservas_sin_cruce` contra la doble reserva.
- **Sin secretos en el repositorio ni en el historial de git**; `.env` y `config.js` están ignorados; solo se usa la clave pública `anon`.
- Todo dato de la base se escapa antes de insertarse como HTML; no hay `eval`, `document.write` ni `insertAdjacentHTML`.
- Política de seguridad de contenido (CSP) estricta: durante la auditoría bloqueó incluso un `new Function()` de las propias pruebas.
- El script de Supabase se carga con *Subresource Integrity*; todos los enlaces externos llevan `rel="noopener"`.
- Solo se publica la carpeta `dist/`: `.env`, `package.json`, `supabase/` y `scripts/` responden 404.
- El inicio de sesión no revela si un correo existe ("Correo o contraseña incorrectos").

## Ajustes aplicados

### 1. Mínimo privilegio en las tablas (`supabase/seguridad.sql`)

Se quitaron todos los permisos por defecto y se otorgaron solo los necesarios:

| Tabla | Público (`anon`) | Usuario con sesión (`authenticated`) |
|---|---|---|
| mesas, horarios, platos | Leer | Leer, crear, editar y borrar (RLS limita a administradores) |
| reservas | — | Leer, editar y borrar (RLS limita a administradores) |
| notificaciones | — | Leer, marcar y borrar (RLS limita a administradores) |
| administradores | — | Leer su propio registro |
| intentos_busqueda | — | — |

Nadie puede ejecutar `TRUNCATE`. Ahora un intento de escritura del público se rechaza **antes** de llegar a RLS (dos capas en lugar de una).

### 4. Límite de reservas por conexión

`crear_reserva()` admite **5 reservas por conexión por hora** (`KP011`). La conexión se identifica con un hash SHA-256 de la IP que entrega Cloudflare (`cf-connecting-ip`); la IP nunca se guarda.

### 5. Bloqueo contra la fuerza bruta del código

Buscar, modificar y cancelar pasan por `identificar_reserva()`, que registra cada intento fallido y **bloquea 15 minutos tras 8 fallos** por conexión (`KP012`). Como lanzar un error desharía el registro del intento, la reserva no encontrada se responde como `{ error }` en lugar de un error de la base.

### 6. Cierre de sesión por inactividad

El panel cierra la sesión tras **30 minutos sin actividad** y también si la sesión se cierra en otra pestaña.

### 7. Encabezados HTTP

Se agregaron `Cross-Origin-Opener-Policy: same-origin` y la directiva `upgrade-insecure-requests` (esta última solo en Vercel; en local, que usa `http://localhost`, se omite).

### Robustez del diálogo de confirmación

Durante las pruebas se vio que algunos navegadores retrasan el evento `close` de los diálogos. La confirmación ahora responde directamente al clic, a la tecla Esc y al clic en el fondo.

## Pruebas de seguridad realizadas

| ID | Prueba | Resultado |
|---|---|---|
| S-01 | Público borra todas las reservas por la API | `permission denied for table reservas` |
| S-02 | Público lee las reservas | `permission denied` |
| S-03 | Público desactiva una mesa | `permission denied for table mesas` |
| S-04 | Público lee los intentos de búsqueda | `permission denied` |
| S-05 | Público llama la función interna `identificar_reserva` | `permission denied for function` |
| S-06 | Público lee las mesas (permitido) | Responde las mesas |
| S-07 | Público se agrega como administrador | Rechazado |
| S-08 | Seis reservas seguidas desde la misma conexión | Las 5 primeras OK; la sexta `KP011` |
| S-09 | Ocho códigos inventados para cancelar una reserva | Los 8 `KP010`; el noveno intento `KP012` (bloqueado) |
| S-10 | Administrador: editar mesa, crear mesa, guardar horarios, cambiar estado, marcar notificaciones, crear y borrar plato, leer reservas | Las 8 operaciones funcionan con los permisos nuevos |
| S-11 | Usuario con sesión pero **no** administrador edita mesas o lee reservas | 0 filas |
| S-12 | Buscar, modificar y cancelar desde "Mi reserva" con el nuevo formato `{ error }` | Funciona; la cancelación genera su notificación |
| S-13 | Diálogo de confirmación: aceptar, cancelar, Esc y clic en el fondo | Responde `true` / `false` / `false` / `false` |

Todas las reservas, notificaciones e intentos creados por las pruebas se borraron al terminar.

## Responsividad en celulares

Se midió de forma automática, en cada página y estado: desbordes laterales, objetivos táctiles menores de 44 px, campos con letra menor de 16 px (en iPhone provocan zoom al tocarlos) y textos menores de 12 px.

| Página / estado | Antes | Después |
|---|---|---|
| Inicio (320 px) | Enlace de WhatsApp de 20 px; "PIZZA" en 11 px | Sin hallazgos |
| Modal de reserva (320 px) | "Cambiar de mesa" 36 px, botones − / + 39 px, mes de cada día en 11 px | Sin hallazgos (44 px) |
| Acceso al panel | Botón "Volver al inicio" 40 px | Sin hallazgos |
| Dashboard | "Ver todas" y "Ver actividad" 29 px; campana y "Actualizar" 40 px | Sin hallazgos |
| Reservas (filtros) y Horarios | Campos en 14 px: zoom automático en iPhone | 16 px, sin zoom |
| Carta y notificaciones | Paginación 40 px; cerrar mensaje 32 px | 44 px |
| Celular horizontal (740 × 360) | — | Sin scroll lateral; el modal hace scroll interno y "Confirmar" se alcanza |

Además, se agregó `viewport-fit=cover` y márgenes para la muesca y la barra inferior del iPhone (*safe areas*), para que el botón de WhatsApp y los mensajes no queden debajo de ellas, y espacio al final de la página para que el botón flotante no tape el pie.

## Acciones pendientes (en el panel de Supabase)

1. **Desactivar el registro público:** *Authentication → Sign In / Providers → Allow new users to sign up* → desactivado. Hoy cualquiera puede crear cuentas (sin permisos de administrador, pero podrían abusar del envío de correos).
2. **Activar la protección contra contraseñas filtradas:** *Authentication → Passwords → Leaked password protection* (puede requerir plan de pago).
3. Si en el futuro se crean tablas nuevas, recordar que Supabase les da permisos por defecto al público: revisar sus permisos y activar RLS.

## Riesgos residuales aceptados

- Los límites por conexión se pueden esquivar cambiando de IP (por ejemplo, con muchas conexiones distintas). Para un restaurante es un nivel razonable; una protección mayor requeriría un CAPTCHA o verificar el celular por SMS.
- Las funciones `crear_reserva`, `buscar_reserva`, `modificar_reserva`, `cancelar_reserva` y `slots_ocupados` son públicas a propósito (el cliente reserva sin registrarse); el asesor de Supabase las marca como aviso esperado.
