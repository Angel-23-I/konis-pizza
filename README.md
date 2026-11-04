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
   git clone https://github.com/<usuario>/konys-reservas-app.git
   cd konys-reservas-app
   ```
2. Copia `.env.example` como `.env` y escribe la URL y la clave `anon` de tu proyecto de Supabase (*Project Settings → API*).
3. Genera la configuración y abre un servidor local:
   ```bash
   npm run dev
   ```
4. Abre la dirección que aparece en la terminal. El panel está en `/admin`.

## Despliegue en Vercel

1. Importa el repositorio de GitHub en Vercel.
2. En *Settings → Environment Variables* agrega `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. Cada `git push` a `main` genera un despliegue nuevo. Vercel ejecuta `npm run build`, que crea `js/config.js` con esas variables.

> La clave `anon` de Supabase es pública por diseño: la seguridad real de los datos la dan las reglas de *Row Level Security* (RLS) configuradas en Supabase.

## Créditos

Proyecto académico desarrollado por Angel Infante.
