/* ==========================================================
   Módulo cliente (index.html)
   RF-01 a RF-07: mesas, fecha, horarios, reserva,
   confirmación y carta digital.
   Usa el cliente `db` definido en js/supabase.js.
   ========================================================== */

const ZONA_HORARIA = 'America/Bogota';
const DIAS_A_MOSTRAR = 14;
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const JORNADAS = { almuerzo: 'Almuerzo', noche: 'Noche' };
const ZONAS = { salon: 'Salón', terraza: 'Terraza' };

// Estado de la página
const estado = {
  mesas: [],
  horarios: [],
  platos: [],
  ocupadosHoy: [],
  zona: 'todas',
  categoria: 'pizzas',
  reserva: {
    mesa: null,
    fecha: null,
    slot: null,       // { inicio, fin } en minutos
    personas: 2,
    ocupados: []      // reservas confirmadas de la mesa en la fecha elegida
  }
};

// Atajo para document.getElementById
const $ = (id) => document.getElementById(id);

/* ----------------------------------------------------------
   Utilidades de fecha y hora
   ---------------------------------------------------------- */

// Fecha (YYYY-MM-DD) y minutos actuales en la hora de Colombia
function ahoraColombia() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_HORARIA,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    minutos: Number(partes.hour) * 60 + Number(partes.minute)
  };
}

// Las fechas se manejan como texto ISO y se operan en UTC para evitar
// corrimientos por la zona horaria del navegador.
function fechaUTC(fechaISO) {
  return new Date(`${fechaISO}T00:00:00Z`);
}

function sumarDias(fechaISO, dias) {
  const fecha = fechaUTC(fechaISO);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function diaSemana(fechaISO) {
  return DIAS_SEMANA[fechaUTC(fechaISO).getUTCDay()];
}

function formatoFecha(fechaISO, opciones) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', ...opciones }).format(fechaUTC(fechaISO));
}

// "19:00:00" -> 1140
function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// 1140 -> "19:00"
function aHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 1140 -> "7:00 p. m."
function aHora12(minutos) {
  const h = Math.floor(minutos / 60);
  const m = String(minutos % 60).padStart(2, '0');
  const sufijo = h >= 12 ? 'p. m.' : 'a. m.';
  return `${h % 12 || 12}:${m} ${sufijo}`;
}

function formatoPrecio(valor) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);
}

/* ----------------------------------------------------------
   Validación de campos (la base de datos aplica las mismas reglas)
   ---------------------------------------------------------- */

const REGEX_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]*$/;
const REGEX_CELULAR = /^3\d{9}$/;
const MAX_NOMBRE = 50;

// Quita al escribir lo que no puede ir en un nombre: números, símbolos y espacios dobles
function limpiarNombre(valor) {
  return valor
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[ .'-]+/, '')
    .slice(0, MAX_NOMBRE);
}

// El celular solo admite dígitos, máximo 10. Si se pega con el
// indicativo de Colombia (+57 300…), se quita el 57.
function limpiarCelular(valor) {
  let digitos = valor.replace(/\D/g, '');
  if (digitos.length > 10 && digitos.startsWith('57')) digitos = digitos.slice(2);
  return digitos.slice(0, 10);
}

// Evita inyectar HTML con los datos que vienen de la base de datos
function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ----------------------------------------------------------
   Generación de slots (RF-04)
   ---------------------------------------------------------- */

// Slots de un día agrupados por jornada, según la tabla horarios
function slotsDelDia(fechaISO) {
  const dia = diaSemana(fechaISO);
  return estado.horarios
    .filter((h) => h.dia_semana === dia)
    .sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio))
    .map((h) => {
      const inicio = aMinutos(h.hora_inicio);
      const fin = aMinutos(h.hora_fin);
      const slots = [];
      for (let t = inicio; t + h.duracion_slot <= fin; t += h.duracion_slot) {
        slots.push({ inicio: t, fin: t + h.duracion_slot });
      }
      return { jornada: h.jornada, slots };
    });
}

function seCruzan(slot, reserva) {
  return slot.inicio < aMinutos(reserva.hora_fin) && aMinutos(reserva.hora_inicio) < slot.fin;
}

function yaPaso(fechaISO, slot) {
  const ahora = ahoraColombia();
  return fechaISO < ahora.fecha || (fechaISO === ahora.fecha && slot.inicio <= ahora.minutos);
}

// Estado de un slot para una mesa: 'libre' u 'ocupado'
function estadoSlot(fechaISO, slot, ocupadosMesa) {
  if (yaPaso(fechaISO, slot)) return 'ocupado';
  return ocupadosMesa.some((r) => seCruzan(slot, r)) ? 'ocupado' : 'libre';
}

function slotsLibres(fechaISO, ocupadosMesa) {
  return slotsDelDia(fechaISO)
    .flatMap((j) => j.slots)
    .filter((s) => estadoSlot(fechaISO, s, ocupadosMesa) === 'libre').length;
}

/* ----------------------------------------------------------
   Carga de datos desde Supabase
   ---------------------------------------------------------- */

async function cargarOcupados(fechaISO, mesaId = null) {
  const parametros = { p_fecha: fechaISO };
  if (mesaId) parametros.p_mesa_id = mesaId;
  const { data, error } = await db.rpc('slots_ocupados', parametros);
  if (error) throw error;
  return data;
}

async function cargarDatos() {
  const hoy = ahoraColombia().fecha;
  const [mesas, horarios, platos, ocupados] = await Promise.all([
    db.from('mesas').select('id, nombre, zona, capacidad, foto_url').order('id'),
    db.from('horarios').select('dia_semana, jornada, hora_inicio, hora_fin, duracion_slot'),
    db.from('platos').select('id, nombre, categoria, descripcion, precio').order('id'),
    cargarOcupados(hoy).then((data) => ({ data }), (error) => ({ error }))
  ]);

  const error = mesas.error || horarios.error || platos.error || ocupados.error;
  if (error) throw error;

  estado.mesas = mesas.data;
  estado.horarios = horarios.data;
  estado.platos = platos.data;
  estado.ocupadosHoy = ocupados.data;
}

/* ----------------------------------------------------------
   RF-01: tarjetas de mesas
   ---------------------------------------------------------- */

const ICONO_MESA = `
  <svg width="120" height="100" viewBox="0 0 120 100" aria-hidden="true">
    <rect x="30" y="22" width="60" height="56" rx="10" fill="#FFFFFF" stroke="#0F2B3D" stroke-width="2.5"/>
    <rect x="42" y="6" width="36" height="10" rx="5" fill="#0F2B3D"/>
    <rect x="42" y="84" width="36" height="10" rx="5" fill="#0F2B3D"/>
    <rect x="14" y="38" width="10" height="24" rx="5" fill="#0F2B3D"/>
    <rect x="96" y="38" width="10" height="24" rx="5" fill="#0F2B3D"/>
  </svg>`;

const ICONO_PERSONAS = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>
  </svg>`;

function imagenMesa(mesa) {
  return mesa.foto_url
    ? `<img src="${escapar(mesa.foto_url)}" alt="" loading="lazy">`
    : ICONO_MESA;
}

function renderMesas() {
  const lista = $('lista-mesas');
  const hoy = ahoraColombia().fecha;
  const mesas = estado.mesas.filter((m) => estado.zona === 'todas' || m.zona === estado.zona);

  $('mesas-subtitulo').textContent =
    `Disponibilidad para hoy, ${formatoFecha(hoy, { weekday: 'long', day: 'numeric', month: 'long' })}.`;

  if (mesas.length === 0) {
    lista.innerHTML = '<p class="estado-vacio">No hay mesas disponibles en esta zona por ahora.</p>';
    return;
  }

  lista.innerHTML = mesas.map((mesa) => {
    const libres = slotsLibres(hoy, estado.ocupadosHoy.filter((r) => r.mesa_id === mesa.id));
    const textoEstado = libres === 0
      ? 'Sin horarios hoy · elige otro día'
      : `${libres} ${libres === 1 ? 'horario libre' : 'horarios libres'} hoy`;
    return `
      <button type="button" class="mesa${libres === 0 ? ' llena' : ''}" data-mesa="${mesa.id}"
              aria-label="Reservar ${escapar(mesa.nombre)}, ${ZONAS[mesa.zona]}, hasta ${mesa.capacidad} personas. ${textoEstado}">
        <span class="mesa-imagen ${mesa.zona}">
          ${imagenMesa(mesa)}
          <span class="mesa-zona">${ZONAS[mesa.zona]}</span>
        </span>
        <span class="mesa-cuerpo">
          <span class="mesa-fila">
            <span class="mesa-nombre">${escapar(mesa.nombre)}</span>
            <span class="mesa-capacidad">${ICONO_PERSONAS} Hasta ${mesa.capacidad}</span>
          </span>
          <span class="mesa-fila">
            <span class="mesa-estado">${textoEstado}</span>
            <span class="mesa-accion" aria-hidden="true">Reservar →</span>
          </span>
        </span>
      </button>`;
  }).join('');
}

function renderCargandoMesas() {
  $('lista-mesas').innerHTML = '<div class="esqueleto"></div>'.repeat(4);
}

function renderErrorCarga() {
  $('mesas-subtitulo').textContent = '';
  $('lista-mesas').innerHTML = `
    <div class="estado-vacio error">
      <p>No pudimos cargar las mesas. Revisa tu conexión e inténtalo de nuevo.</p>
      <p><button type="button" class="btn btn-secundario" id="reintentar">Reintentar</button></p>
    </div>`;
  $('reintentar').addEventListener('click', iniciar);
}

/* ----------------------------------------------------------
   RF-07: carta digital
   ---------------------------------------------------------- */

// Trazos de los íconos de la carta (viewBox 24×24, línea con currentColor)
const TRAZOS_PLATO = {
  cono: '<path d="M6 9h12l-6 12z"/><path d="M5 9a7 5 0 0 1 14 0"/><circle cx="10" cy="7" r="0.9" fill="currentColor"/><circle cx="14" cy="6.5" r="0.9" fill="currentColor"/><path d="M9.5 13h5M10.7 16.5h2.6"/>',
  trofeo: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  combo: '<path d="M3 10h8l-4 10zM13 10h8l-4 10z"/><path d="M3 10a4 3 0 0 1 8 0M13 10a4 3 0 0 1 8 0"/>',
  camaron: '<path d="M18 6c-6-2-13 1-13 7 0 3 2 5 5 5h2"/><path d="M12 18l-2 3M12 18l2 3"/><path d="M18 6c1 3-1 6-4 7M9 10l1 2M12 9l1 2"/><circle cx="16" cy="7.5" r="0.8" fill="currentColor"/>',
  pollo: '<path d="M15.5 4.5a5 5 0 0 1 3 8.5c-2 2-4.5 2-6.5 1L9 17.5"/><path d="M15.5 4.5a5 5 0 0 0-5 6c.3 1.3.9 2.3 1.5 3.5"/><path d="M9 17.5a2 2 0 1 1-3 2.5 2 2 0 1 1-1-3 2 2 0 1 1 4 .5z"/>',
  hoja: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l8-8"/>',
  chile: '<path d="M6 18c6 1 12-4 12-10"/><path d="M18 8c-3 0-5 2-6 5s-3 5-6 5"/><path d="M18 8c0-2 1-3 3-3"/>',
  pina: '<ellipse cx="12" cy="15" rx="5" ry="6"/><path d="M9 12l6 6M15 12l-6 6"/><path d="M12 9V4M12 9 9 5M12 9l3-4"/>',
  maiz: '<path d="M12 3c3 0 4 4 4 8s-1 9-4 10c-3-1-4-6-4-10s1-8 4-8z"/><path d="M8 13c-3 0-5 3-5 7 3 0 6-1 8-3M16 13c3 0 5 3 5 7-3 0-6-1-8-3"/>',
  papas: '<path d="M6 10h12l-1.5 10h-9z"/><path d="M7.5 10V6M9.5 10V3.5M12 10V4.5M14.5 10V3M16.5 10V6"/>',
  nachos: '<path d="M4 18 12 4l8 14z"/><circle cx="10" cy="13" r="1" fill="currentColor"/><circle cx="14" cy="14" r="1" fill="currentColor"/><circle cx="12" cy="10" r="0.8" fill="currentColor"/>',
  lasana: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M3 16.5h18"/><path d="M8 7c0-1.5 1.5-1.5 1.5-3M14 7c0-1.5 1.5-1.5 1.5-3"/>',
  konitos: '<path d="M3 9h5l-2.5 9zM9.5 9h5L12 18zM16 9h5l-2.5 9z"/><path d="M3 9a2.5 2 0 0 1 5 0M9.5 9a2.5 2 0 0 1 5 0M16 9a2.5 2 0 0 1 5 0"/>',
  helado: '<path d="M5 12h14l-2 8H7z"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 7c0-2 1-3 2-4"/>',
  granizado: '<path d="M6 8h12l-1.5 13h-9z"/><path d="M5.5 8a6.5 4 0 0 1 13 0"/><path d="M13 5l3-3"/>',
  soda: '<path d="M6 4h12l-1.5 17h-9z"/><circle cx="10" cy="15" r="1"/><circle cx="13.5" cy="11" r="1.2"/><circle cx="11" cy="8" r="0.8"/>',
  limon: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/>',
  botella: '<path d="M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z"/><path d="M8 13h8"/>',
  jugo: '<path d="M7 7h10v14H7z"/><path d="M7 7l2-3h6l2 3M14 4V1"/><path d="M10 12h4"/>',
  agua: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>'
};

// Se usa la primera regla cuyo patrón aparezca en el nombre (sin tildes).
// El orden importa: "Chicken fries" debe dar papas y no pollo.
const REGLAS_ICONO = [
  [/pizza master|bukara/, 'trofeo'],
  [/combo/, 'combo'],
  [/desgranado/, 'maiz'],
  [/papas|fries/, 'papas'],
  [/konitos/, 'konitos'],
  [/nachos/, 'nachos'],
  [/lasan|lasagna/, 'lasana'],
  [/helado|copa/, 'helado'],
  [/soda/, 'soda'],
  [/granizado|cerezada|pina colada|limonada de coco/, 'granizado'],
  [/limonada/, 'limon'],
  [/gaseosa|coca/, 'botella'],
  [/jugo/, 'jugo'],
  [/agua/, 'agua'],
  [/\bmar\b|marinera|camaron/, 'camaron'],
  [/hawaian/, 'pina'],
  [/mexican/, 'chile'],
  [/veggie/, 'hoja'],
  [/chicken|pollo|bbq|ikonica/, 'pollo']
];

const ICONO_POR_CATEGORIA = { pizzas: 'cono', entradas: 'konitos', postres: 'helado', bebidas: 'granizado' };

function iconoPlato(plato) {
  const nombre = plato.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const regla = REGLAS_ICONO.find(([patron]) => patron.test(nombre));
  const clave = regla ? regla[1] : (ICONO_POR_CATEGORIA[plato.categoria] ?? 'cono');
  return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS_PLATO[clave]}</svg>`;
}

function renderCarta() {
  const platos = estado.platos.filter((p) => p.categoria === estado.categoria);
  $('lista-platos').innerHTML = platos.length === 0
    ? '<p class="estado-vacio">Pronto tendremos platos en esta categoría.</p>'
    : platos.map((p) => `
        <article class="plato">
          <span class="plato-icono ${p.categoria}">${iconoPlato(p)}</span>
          <div class="plato-info">
            <div class="plato-fila">
              <h3 class="plato-nombre">${escapar(p.nombre)}</h3>
              <span class="plato-precio">${formatoPrecio(p.precio)}</span>
            </div>
            ${/pizza master/i.test(p.nombre) ? '<span class="plato-insignia">Ganadora Pizza Master</span>' : ''}
            ${p.descripcion ? `<p class="plato-desc">${escapar(p.descripcion)}</p>` : ''}
          </div>
        </article>`).join('');
}

/* ----------------------------------------------------------
   RF-02 a RF-05: flujo de reserva
   ---------------------------------------------------------- */

// Días que se pueden elegir: con horario activo y algún slot futuro
function diasDisponibles() {
  const hoy = ahoraColombia().fecha;
  return Array.from({ length: DIAS_A_MOSTRAR }, (_, i) => {
    const fecha = sumarDias(hoy, i);
    const slots = slotsDelDia(fecha).flatMap((j) => j.slots);
    const habilitado = slots.some((s) => !yaPaso(fecha, s));
    return { fecha, habilitado, extra: i >= 7 };
  });
}

function abrirReserva(mesaId) {
  const mesa = estado.mesas.find((m) => m.id === mesaId);
  if (!mesa) return;

  const r = estado.reserva;
  r.mesa = mesa;
  r.slot = null;
  r.ocupados = [];
  r.personas = Math.min(2, mesa.capacidad);
  r.fecha = diasDisponibles().find((d) => d.habilitado)?.fecha ?? null;

  $('modal-titulo').textContent = mesa.nombre;
  $('modal-detalle').textContent = `${ZONAS[mesa.zona]} · hasta ${mesa.capacidad} personas`;
  $('modal-foto').innerHTML = imagenMesa(mesa);
  $('form-reserva').reset();
  limpiarError();
  $('campo-nombre').removeAttribute('aria-invalid');
  $('campo-contacto').removeAttribute('aria-invalid');

  $('vista-reserva').hidden = false;
  $('vista-confirmacion').hidden = true;
  $('modal-reserva').classList.remove('estrecho');
  $('modal-reserva').showModal();

  renderDias();
  renderPersonas();
  actualizarResumen();
  if (r.fecha) elegirFecha(r.fecha);
  else $('lista-slots').innerHTML = '<p class="mensaje-slots">No hay días con horarios disponibles en las próximas dos semanas.</p>';
}

function renderDias() {
  $('lista-dias').innerHTML = diasDisponibles().map((d) => {
    const elegido = d.fecha === estado.reserva.fecha;
    const etiqueta = formatoFecha(d.fecha, { weekday: 'long', day: 'numeric', month: 'long' });
    return `
      <button type="button" class="dia${d.extra ? ' extra' : ''}" data-fecha="${d.fecha}"
              aria-pressed="${elegido}" aria-label="${etiqueta}${d.habilitado ? '' : ', sin horarios'}"
              ${d.habilitado ? '' : 'disabled'}>
        <span class="dia-semana">${formatoFecha(d.fecha, { weekday: 'short' }).replace('.', '').toUpperCase()}</span>
        <span class="dia-numero">${formatoFecha(d.fecha, { day: 'numeric' })}</span>
        <span class="dia-mes">${formatoFecha(d.fecha, { month: 'short' }).replace('.', '')}</span>
      </button>`;
  }).join('');
}

async function elegirFecha(fecha) {
  const r = estado.reserva;
  r.fecha = fecha;
  r.slot = null;
  renderDias();
  actualizarResumen();
  limpiarError();

  $('lista-slots').innerHTML = '<p class="mensaje-slots">Consultando horarios…</p>';
  try {
    r.ocupados = await cargarOcupados(fecha, r.mesa.id);
  } catch (error) {
    console.error(error);
    $('lista-slots').innerHTML = '<p class="mensaje-slots">No pudimos consultar los horarios. Intenta de nuevo.</p>';
    return;
  }
  // Si el cliente cambió de fecha mientras se consultaba, no pintar datos viejos
  if (r.fecha === fecha) renderSlots();
}

function renderSlots() {
  const r = estado.reserva;
  const jornadas = slotsDelDia(r.fecha);

  $('lista-slots').innerHTML = jornadas.map((j) => `
    <div class="jornada">
      <span class="jornada-nombre">${JORNADAS[j.jornada] ?? escapar(j.jornada)}</span>
      <div class="slots">
        ${j.slots.map((s) => {
          const ocupado = estadoSlot(r.fecha, s, r.ocupados) === 'ocupado';
          const elegido = r.slot && r.slot.inicio === s.inicio;
          return `
            <button type="button" class="slot" data-inicio="${s.inicio}" data-fin="${s.fin}"
                    aria-pressed="${Boolean(elegido)}"
                    aria-label="${aHora12(s.inicio)}${ocupado ? ', ocupado' : ''}"
                    ${ocupado ? 'disabled' : ''}>${aHora(s.inicio)}</button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function elegirSlot(inicio, fin) {
  estado.reserva.slot = { inicio, fin };
  limpiarError();
  renderSlots();
  actualizarResumen();
}

function renderPersonas() {
  const { personas, mesa } = estado.reserva;
  $('personas-valor').textContent = personas;
  $('personas-menos').disabled = personas <= 1;
  $('personas-mas').disabled = personas >= mesa.capacidad;

  // Flujo alternativo del CU-02: avisar el máximo permitido
  const aviso = $('aviso-capacidad');
  aviso.hidden = personas < mesa.capacidad;
  aviso.textContent = `Esta mesa recibe máximo ${mesa.capacidad} ${mesa.capacidad === 1 ? 'persona' : 'personas'}. ` +
    'Para grupos más grandes elige una mesa con más capacidad.';
  actualizarResumen();
}

function cambiarPersonas(delta) {
  const r = estado.reserva;
  r.personas = Math.min(r.mesa.capacidad, Math.max(1, r.personas + delta));
  renderPersonas();
}

function actualizarResumen() {
  const { fecha, slot, personas } = estado.reserva;
  $('resumen-fecha').textContent = fecha ? formatoFecha(fecha, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin elegir';
  $('resumen-hora').textContent = slot ? `${aHora12(slot.inicio)} – ${aHora12(slot.fin)}` : 'Sin elegir';
  $('resumen-personas').textContent = personas;

  $('ind-fecha').classList.toggle('hecho', Boolean(fecha));
  $('ind-hora').classList.toggle('hecho', Boolean(slot));
  $('ind-datos').classList.toggle('hecho', $('campo-nombre').value.trim().length >= 2);
}

function mostrarError(mensaje) {
  const error = $('error-reserva');
  error.textContent = mensaje;
  error.hidden = false;
}

function limpiarError() {
  $('error-reserva').hidden = true;
}

// RF-05: validar y guardar la reserva
async function confirmarReserva(evento) {
  evento.preventDefault();
  const r = estado.reserva;
  const nombre = limpiarNombre($('campo-nombre').value).trim();
  const contacto = limpiarCelular($('campo-contacto').value);

  if (!r.fecha || !r.slot) {
    mostrarError('Elige un día y una hora disponibles.');
    return;
  }
  if (nombre.length < 2 || !REGEX_NOMBRE.test(nombre)) {
    $('campo-nombre').setAttribute('aria-invalid', 'true');
    $('campo-nombre').focus();
    mostrarError('Escribe tu nombre para la reserva (solo letras, mínimo 2).');
    return;
  }
  if (contacto && !REGEX_CELULAR.test(contacto)) {
    $('campo-contacto').setAttribute('aria-invalid', 'true');
    $('campo-contacto').focus();
    mostrarError('El teléfono debe tener 10 dígitos y empezar por 3.');
    return;
  }

  const boton = $('boton-confirmar');
  boton.disabled = true;
  boton.textContent = 'Confirmando…';
  limpiarError();

  try {
    // Paso 10 del flujo: verificar otra vez que el slot siga libre
    r.ocupados = await cargarOcupados(r.fecha, r.mesa.id);
    if (estadoSlot(r.fecha, r.slot, r.ocupados) === 'ocupado') {
      r.slot = null;
      renderSlots();
      actualizarResumen();
      mostrarError('Ese horario acaba de ser reservado. Elige otro.');
      return;
    }

    // crear_reserva vuelve a validar todo en el servidor y evita la doble reserva
    const { data, error } = await db.rpc('crear_reserva', {
      p_mesa_id: r.mesa.id,
      p_fecha: r.fecha,
      p_hora_inicio: aHora(r.slot.inicio),
      p_nombre: nombre,
      p_num_personas: r.personas,
      p_contacto: contacto || null
    });

    if (error) {
      if (['KP004', 'KP005'].includes(error.code)) {
        r.slot = null;
        await elegirFecha(r.fecha);
      }
      mostrarError(error.code?.startsWith('KP') ? error.message : 'No pudimos guardar tu reserva. Intenta de nuevo.');
      return;
    }

    mostrarConfirmacion(data);
    refrescarDisponibilidad();
  } catch (error) {
    console.error(error);
    mostrarError('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Confirmar reserva';
  }
}

/* ----------------------------------------------------------
   RF-06: confirmación
   ---------------------------------------------------------- */

function mostrarConfirmacion(reserva) {
  $('comp-numero').textContent = `N.º KP-${String(reserva.id).padStart(4, '0')}`;
  $('comp-nombre').textContent = reserva.cliente_nombre;
  $('comp-mesa').textContent = `${reserva.mesa} · ${ZONAS[reserva.zona]}`;
  $('comp-fecha').textContent = formatoFecha(reserva.fecha, { weekday: 'long', day: 'numeric', month: 'long' });
  $('comp-hora').textContent = `${aHora12(aMinutos(reserva.hora_inicio))} – ${aHora12(aMinutos(reserva.hora_fin))}`;
  $('comp-personas').textContent = reserva.num_personas;

  $('vista-reserva').hidden = true;
  $('vista-confirmacion').hidden = false;
  $('modal-reserva').classList.add('estrecho');
  $('modal-reserva').scrollTop = 0;
  $('confirmacion-titulo').focus();
}

async function refrescarDisponibilidad() {
  try {
    estado.ocupadosHoy = await cargarOcupados(ahoraColombia().fecha);
    renderMesas();
  } catch (error) {
    console.error(error);
  }
}

/* ----------------------------------------------------------
   Eventos
   ---------------------------------------------------------- */

function registrarEventos() {
  // Menú móvil
  const menuBoton = $('menu-boton');
  const menu = $('menu');
  menuBoton.addEventListener('click', () => {
    const abierto = menu.classList.toggle('abierto');
    menuBoton.setAttribute('aria-expanded', abierto);
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      menu.classList.remove('abierto');
      menuBoton.setAttribute('aria-expanded', 'false');
    }
  });

  // Filtro por zona
  document.querySelectorAll('.filtro-boton').forEach((boton) => {
    boton.addEventListener('click', () => {
      estado.zona = boton.dataset.zona;
      document.querySelectorAll('.filtro-boton').forEach((b) => {
        const activo = b === boton;
        b.classList.toggle('activo', activo);
        b.setAttribute('aria-pressed', activo);
      });
      renderMesas();
    });
  });

  // Elegir mesa (RF-02)
  $('lista-mesas').addEventListener('click', (e) => {
    const tarjeta = e.target.closest('[data-mesa]');
    if (tarjeta) abrirReserva(Number(tarjeta.dataset.mesa));
  });

  // Pestañas de la carta
  document.querySelectorAll('.pestana').forEach((pestana) => {
    pestana.addEventListener('click', () => {
      estado.categoria = pestana.dataset.categoria;
      document.querySelectorAll('.pestana').forEach((p) => {
        const activa = p === pestana;
        p.classList.toggle('activa', activa);
        p.setAttribute('aria-selected', activa);
      });
      renderCarta();
    });
  });

  // Modal: fecha, hora, personas, envío y cierre
  $('lista-dias').addEventListener('click', (e) => {
    const dia = e.target.closest('[data-fecha]');
    if (dia && !dia.disabled) elegirFecha(dia.dataset.fecha);
  });
  $('lista-slots').addEventListener('click', (e) => {
    const slot = e.target.closest('[data-inicio]');
    if (slot && !slot.disabled) elegirSlot(Number(slot.dataset.inicio), Number(slot.dataset.fin));
  });
  $('personas-menos').addEventListener('click', () => cambiarPersonas(-1));
  $('personas-mas').addEventListener('click', () => cambiarPersonas(1));
  $('campo-nombre').addEventListener('input', () => {
    const campo = $('campo-nombre');
    const limpio = limpiarNombre(campo.value);
    if (campo.value !== limpio) campo.value = limpio;
    campo.removeAttribute('aria-invalid');
    actualizarResumen();
  });
  $('campo-contacto').addEventListener('input', () => {
    const campo = $('campo-contacto');
    const limpio = limpiarCelular(campo.value);
    if (campo.value !== limpio) campo.value = limpio;
    campo.removeAttribute('aria-invalid');
  });
  $('form-reserva').addEventListener('submit', confirmarReserva);

  const modal = $('modal-reserva');
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]')) modal.close();
    if (e.target.closest('[data-ir-carta]')) {
      modal.close();
      $('carta').scrollIntoView();
    }
    // Clic en el fondo oscuro (fuera de la caja) cierra el modal
    if (e.target === modal) modal.close();
  });
}

/* ----------------------------------------------------------
   Inicio
   ---------------------------------------------------------- */

async function iniciar() {
  renderCargandoMesas();
  try {
    await cargarDatos();
    renderMesas();
    renderCarta();
  } catch (error) {
    console.error(error);
    renderErrorCarga();
  }
}

registrarEventos();
iniciar();
