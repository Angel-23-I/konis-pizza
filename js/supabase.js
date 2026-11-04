/* ==========================================================
   Conexión con Supabase
   La URL y la clave pública se leen de window.KONYS_CONFIG,
   que se genera en js/config.js a partir de las variables
   de entorno (ver scripts/generar-config.js).
   ========================================================== */

const config = window.KONYS_CONFIG || {};

if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
  console.error('Falta la configuración de Supabase. Revisa js/config.js o las variables de entorno.');
}

// Cliente único que usan cliente.js y admin.js
const db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
