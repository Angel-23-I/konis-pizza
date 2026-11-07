Angel David Infante Espinel - 01220371056
# Konys Pizza – Sistema de Reservas de Mesas

Aplicación web para que los clientes de **Konys Pizza** (Cra. 36 con calle 41, Bucaramanga) reserven mesa en línea, viendo la disponibilidad en tiempo real, y para que el administrador gestione mesas, horarios, reservas y la carta digital.

Hoy las reservas se toman a mano por llamada, WhatsApp o Instagram, lo que causa reservas dobles, poca visibilidad de la disponibilidad y clientes perdidos fuera del horario de atención. Esta aplicación digitaliza ese proceso.

## Funcionalidades

**Módulo cliente** (sin registro)
- Ver las mesas del salón y la terraza con su capacidad y disponibilidad.
- Elegir fecha y hora entre los turnos libres (almuerzo 12:30–2:30 p. m. y noche 5:00–11:00 p. m.).
- Confirmar la reserva con nombre, número de personas y teléfono opcional. Los datos se piden después de elegir la hora, y el celular se valida mientras se escribe.
- Consultar, modificar (fecha, hora o personas) o cancelar una reserva en «Mi reserva», con el celular y el código del comprobante.
- Consultar la carta digital por categorías.

**Panel de administración** (`/admin`, protegido con contraseña)
- Dashboard de inicio: reservas y personas de hoy, ocupación, próxima reserva, gráfico de los próximos 7 días y reservas recientes.
- Notificaciones en tiempo real (con campana y contador) cuando un cliente crea, modifica o cancela una reserva.
- Registrar mesas y activarlas o desactivarlas.
- Definir el horario de atención por día y la duración de cada reserva.
- Consultar las reservas filtrando por fecha y por mesa.
- Gestionar los platos de la carta.

## Tecnologías

| Tecnología | Uso |
|---|---|
| HTML5, CSS3, JavaScript (ES6+) | Interfaz y lógica del cliente, sin frameworks |
| [Supabase](https://supabase.com) | Base de datos (PostgreSQL) y API |
| [Vercel](https://vercel.com) | Despliegue continuo desde GitHub |
| GitHub | Control de versiones |

## Enlaces

- **Aplicación desplegada:** _pendiente_
- **Video explicativo:** _pendiente_
- **Documento de proyecto y mockups:** carpeta [`docs/`](docs/)

## Estructura del proyecto

```
konys-reservas-app/
├── index.html              # Página principal (cliente)
├── admin.html              # Panel de administración
├── 404.html                # Página de error para rutas que no existen
├── imgs/                   # Logo y fotos reales del restaurante
├── css/
│   └── styles.css
├── js/
│   ├── supabase.js         # Conexión con Supabase
│   ├── ui.js               # Diálogo de confirmación, mensajes y botones con carga
│   ├── cliente.js          # Lógica del módulo cliente
│   └── admin.js            # Lógica del módulo administrador
├── scripts/
│   └── generar-config.js   # Build: copia el sitio a dist/ y crea dist/js/config.js
├── supabase/
│   ├── schema.sql          # Tablas, funciones y reglas de seguridad (RLS)
│   ├── validaciones.sql    # Formatos permitidos y límites anti-abuso
│   ├── gestion_reservas.sql # Código de reserva; consultar, modificar y cancelar
│   ├── notificaciones.sql  # Notificaciones automáticas y en tiempo real
│   ├── seguridad.sql       # Mínimo privilegio y límites contra abuso
│   ├── seed.sql            # Mesas, horarios y reservas de prueba
│   └── carta.sql           # Carta real de Konys (45 platos)
├── docs/
│   └── mockups/            # Wireframes de baja fidelidad
├── .env.example
├── .gitignore
├── package.json
├── vercel.json
└── README.md
```

## Cómo ejecutarlo en local

Requisitos: [Node.js](https://nodejs.org) 18 o superior y un proyecto creado en Supabase.

1. Clona el repositorio:
   ```bash
   git clone https://github.com/Angel-23-I/konis-pizza.git
   cd konis-pizza
   ```
2. En el *SQL Editor* de Supabase ejecuta, en este orden, `supabase/schema.sql`, `supabase/validaciones.sql`, `supabase/gestion_reservas.sql`, `supabase/notificaciones.sql`, `supabase/seguridad.sql`, `supabase/seed.sql` y `supabase/carta.sql`.
3. Copia `.env.example` como `.env` y escribe la URL y la clave `anon` de tu proyecto de Supabase (*Project Settings → API*).
4. Genera la configuración y abre un servidor local:
   ```bash
   npm run dev
   ```
5. Abre la dirección que aparece en la terminal. El panel está en `/admin`.

> El servidor local sirve la carpeta `dist/`. Si cambias el código, vuelve a ejecutar `npm run build` (o `npm run dev`).
> Si cambias `vercel.json` (por ejemplo, la política de seguridad), detén el servidor con `Ctrl + C` y vuelve a ejecutar `npm run dev`: el servidor solo lee los encabezados al arrancar.

## Despliegue en Vercel

1. Importa el repositorio de GitHub en Vercel.
2. En *Settings → Environment Variables* agrega `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. Cada `git push` a `main` genera un despliegue nuevo. Vercel ejecuta `npm run build`, que copia a `dist/` solo los archivos públicos (HTML, CSS y JS) y crea `dist/js/config.js` con esas variables.

> La clave `anon` de Supabase es pública por diseño: la seguridad real de los datos la dan las reglas de *Row Level Security* (RLS) configuradas en Supabase.

## Seguridad de los datos

- El público solo puede **leer** mesas activas, horarios activos y platos disponibles.
- Las reservas se crean únicamente con la función `crear_reserva()`, que valida en el servidor la capacidad de la mesa, la fecha, que el horario exista y que el turno esté libre.
- Una restricción de la base de datos impide que dos reservas confirmadas de la misma mesa se crucen, aunque dos clientes confirmen al mismo tiempo.
- Los nombres y teléfonos de las reservas solo los ve el administrador.
- El administrador inicia sesión con Supabase Auth y debe estar registrado en la tabla `administradores`.

## Validación de campos

Los formularios filtran lo que se escribe y la base de datos vuelve a validar todo, así que las reglas no se pueden saltar llamando a la API directamente.

| Campo | Regla |
|---|---|
| Nombre del cliente | Solo letras, espacios, `.`, `'` y `-`; de 2 a 50 caracteres |
| Teléfono | Opcional; celular de 10 dígitos que empieza por 3 (se quita el `+57` si se pega) |
| Personas | De 1 hasta la capacidad de la mesa |
| Fecha | Desde ahora hasta 30 días de anticipación |
| Nombre de mesa | Letras, números, espacios, `#` y `-`; máximo 20 |
| Capacidad de mesa | Entero de 1 a 30 |
| Foto de mesa | Opcional; solo enlaces `https://`, máximo 500 caracteres |
| Nombre de plato | De 2 a 60 caracteres; letras, números y `. , ' & ( ) -` |
| Descripción de plato | Máximo 200 caracteres, sin `<` ni `>` |
| Precio | Entero en pesos, de 0 a 1.000.000 |

Límites anti-abuso: máximo 3 reservas activas por teléfono, 2 por nombre en el mismo día y 5 por conexión por hora; tras 8 búsquedas fallidas de celular y código, la conexión se bloquea 15 minutos. Detalle completo en [docs/auditoria-seguridad.md](docs/auditoria-seguridad.md).

## Seguridad del sitio

- Encabezados HTTP en `vercel.json`: *Content-Security-Policy* estricta (sin scripts en línea), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS.
- El script de Supabase se carga con *Subresource Integrity* (`integrity`): si el CDN lo altera, el navegador no lo ejecuta.
- Todo dato que viene de la base se escapa antes de mostrarse, para evitar inyección de HTML.
- Solo se publica la carpeta `dist/`: `package.json`, `supabase/`, `scripts/` y `.env` nunca quedan accesibles.

## Créditos

Proyecto académico desarrollado por Angel Infante.
