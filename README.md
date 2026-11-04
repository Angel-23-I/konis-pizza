# Konys Pizza – Sistema de Reservas de Mesas

Aplicación web para que los clientes de **Konys Pizza** (Cra. 36 con calle 41, Bucaramanga) reserven mesa en línea, viendo la disponibilidad en tiempo real, y para que el administrador gestione mesas, horarios, reservas y la carta digital.

Hoy las reservas se toman a mano por llamada, WhatsApp o Instagram, lo que causa reservas dobles, poca visibilidad de la disponibilidad y clientes perdidos fuera del horario de atención. Esta aplicación digitaliza ese proceso.

## Funcionalidades

**Módulo cliente** (sin registro)
- Ver las mesas del salón y la terraza con su capacidad y disponibilidad.
- Elegir fecha y hora entre los turnos libres (almuerzo 12:30–2:30 p. m. y noche 5:00–11:00 p. m.).
- Confirmar la reserva con nombre, número de personas y teléfono opcional.
- Consultar la carta digital por categorías.

**Panel de administración** (`/admin`, protegido con contraseña)
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
├── css/
│   └── styles.css
├── js/
│   ├── supabase.js         # Conexión con Supabase
│   ├── cliente.js          # Lógica del módulo cliente
│   ├── admin.js            # Lógica del módulo administrador
│   └── config.js           # Generado al compilar (no se sube a GitHub)
├── scripts/
│   └── generar-config.js   # Crea js/config.js desde las variables de entorno
├── supabase/
│   ├── schema.sql          # Tablas, funciones y reglas de seguridad (RLS)
│   └── seed.sql            # Datos de prueba
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
2. En el *SQL Editor* de Supabase ejecuta `supabase/schema.sql` y luego `supabase/seed.sql`.
3. Copia `.env.example` como `.env` y escribe la URL y la clave `anon` de tu proyecto de Supabase (*Project Settings → API*).
4. Genera la configuración y abre un servidor local:
   ```bash
   npm run dev
   ```
5. Abre la dirección que aparece en la terminal. El panel está en `/admin`.

## Despliegue en Vercel

1. Importa el repositorio de GitHub en Vercel.
2. En *Settings → Environment Variables* agrega `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. Cada `git push` a `main` genera un despliegue nuevo. Vercel ejecuta `npm run build`, que crea `js/config.js` con esas variables.

> La clave `anon` de Supabase es pública por diseño: la seguridad real de los datos la dan las reglas de *Row Level Security* (RLS) configuradas en Supabase.

## Seguridad de los datos

- El público solo puede **leer** mesas activas, horarios activos y platos disponibles.
- Las reservas se crean únicamente con la función `crear_reserva()`, que valida en el servidor la capacidad de la mesa, la fecha, que el horario exista y que el turno esté libre.
- Una restricción de la base de datos impide que dos reservas confirmadas de la misma mesa se crucen, aunque dos clientes confirmen al mismo tiempo.
- Los nombres y teléfonos de las reservas solo los ve el administrador.
- El administrador inicia sesión con Supabase Auth y debe estar registrado en la tabla `administradores`.

## Créditos

Proyecto académico desarrollado por Angel Infante.
