/* ==========================================================
   Build del sitio: copia a dist/ solo los archivos públicos
   (HTML, CSS y JS) y genera dist/js/config.js con las
   credenciales públicas de Supabase.

   En Vercel se ejecuta automáticamente en cada despliegue
   (npm run build) usando las variables de entorno
   SUPABASE_URL y SUPABASE_ANON_KEY. En local, crea un archivo
   .env (ver .env.example) y corre: npm run build

   dist/ está en .gitignore: nunca se sube al repositorio.
   ========================================================== */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist');

// Archivos y carpetas que se publican. Todo lo demás (package.json,
// supabase/, scripts/, docs/) queda fuera del sitio.
const PUBLICOS = ['index.html', 'admin.html', 'css', 'js'];

// Lee un archivo .env local (solo para desarrollo) sin dependencias externas
const rutaEnv = path.join(raiz, '.env');
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

// La URL debe ser de Supabase y con HTTPS (RNF-05)
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL)) {
  console.error('SUPABASE_URL debe tener la forma https://<proyecto>.supabase.co');
  process.exit(1);
}

fs.rmSync(destino, { recursive: true, force: true });
for (const elemento of PUBLICOS) {
  fs.cpSync(path.join(raiz, elemento), path.join(destino, elemento), { recursive: true });
}

const contenido = `// Archivo generado por scripts/generar-config.js. No editar a mano.
window.KONYS_CONFIG = ${JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY }, null, 2)};
`;
fs.writeFileSync(path.join(destino, 'js', 'config.js'), contenido);

// En local, el servidor `serve` aplica los mismos encabezados de seguridad
// que Vercel (vercel.json) para poder probar la CSP antes de desplegar.
if (!process.env.VERCEL) {
  const vercel = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
  const globales = vercel.headers.find((h) => h.source === '/(.*)').headers;
  fs.writeFileSync(path.join(destino, 'serve.json'), JSON.stringify({
    cleanUrls: true,
    headers: [{ source: '**', headers: globales.filter((h) => h.key !== 'Strict-Transport-Security') }]
  }, null, 2));
}

console.log('Sitio generado en dist/ con js/config.js.');
