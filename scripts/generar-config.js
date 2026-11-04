/* ==========================================================
   Genera js/config.js con las credenciales públicas de Supabase.

   En Vercel se ejecuta automáticamente en cada despliegue
   (npm run build) usando las variables de entorno
   SUPABASE_URL y SUPABASE_ANON_KEY. En local, crea un archivo
   .env (ver .env.example) y corre: npm run build

   js/config.js está en .gitignore: nunca se sube al repositorio.
   ========================================================== */

const fs = require('fs');
const path = require('path');

// Lee un archivo .env local (solo para desarrollo) sin dependencias externas
const rutaEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(rutaEnv)) {
  for (const linea of fs.readFileSync(rutaEnv, 'utf8').split(/\r?\n/)) {
    const coincidencia = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (coincidencia && !process.env[coincidencia[1]]) {
      process.env[coincidencia[1]] = coincidencia[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en las variables de entorno.');
  process.exit(1);
}

const contenido = `// Archivo generado por scripts/generar-config.js. No editar a mano.
window.KONYS_CONFIG = ${JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY }, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, '..', 'js', 'config.js'), contenido);
console.log('js/config.js generado correctamente.');
