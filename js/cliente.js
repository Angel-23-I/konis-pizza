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
    ocupados: [],     // reservas confirmadas de la mesa en la fecha elegida
    modo: 'crear',    // 'crear' o 'editar'
    existente: null   // reserva que se está modificando (modo editar)
  },
  miReserva: null     // reserva encontrada en la sección "Mi reserva"
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

// existente: reserva a modificar (con su codigo y contacto). Sin ella, se crea una nueva.
function abrirReserva(mesaId, existente = null) {
  const mesa = estado.mesas.find((m) => m.id === mesaId);
  if (!mesa) return;

  const r = estado.reserva;
  const dias = diasDisponibles();
  r.mesa = mesa;
  r.slot = null;
  r.ocupados = [];
  r.modo = existente ? 'editar' : 'crear';
  r.existente = existente;
  r.personas = existente ? Math.min(existente.num_personas, mesa.capacidad) : Math.min(2, mesa.capacidad);
  const fechaPropia = existente && dias.find((d) => d.fecha === existente.fecha && d.habilitado);
  r.fecha = fechaPropia ? existente.fecha : (dias.find((d) => d.habilitado)?.fecha ?? null);

  $('modal-titulo').textContent = mesa.nombre;
  $('modal-detalle').textContent = `${ZONAS[mesa.zona]} · hasta ${mesa.capacidad} personas`;
  $('modal-foto').innerHTML = imagenMesa(mesa);
  $('form-reserva').reset();
  limpiarError();
  $('campo-nombre').removeAttribute('aria-invalid');
  $('campo-contacto').removeAttribute('aria-invalid');
  // En modo edición el nombre y el celular no cambian: identifican la reserva
  $('campo-nombre').value = existente ? existente.cliente_nombre : '';
  $('campo-contacto').value = existente ? (existente.cliente_contacto ?? '') : '';
  $('campo-nombre').readOnly = Boolean(existente);
  $('campo-contacto').readOnly = Boolean(existente);
  $('aviso-edicion').hidden = !existente;
  if (existente) {
    $('aviso-edicion').textContent = `Estás modificando la reserva ${existente.codigo} ` +
      `(${formatoFecha(existente.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}, ${aHora12(aMinutos(existente.hora_inicio))}). ` +
      'Elige la nueva fecha, hora o número de personas.';
  }
  $('boton-confirmar').textContent = textoBotonConfirmar();
  validarNombreEnVivo();
  validarCelularEnVivo();

  $('vista-reserva').hidden = false;
  $('vista-confirmacion').hidden = true;
  $('modal-reserva').classList.remove('estrecho');
  $('modal-reserva').showModal();

  renderDias();
  renderPersonas();
  actualizarResumen();
  if (r.fecha) {
    elegirFecha(r.fecha).then(() => {
      // Al editar, su turno actual queda marcado para que pueda cambiar solo las personas
      if (existente && r.fecha === existente.fecha && !r.slot) {
        const inicio = aMinutos(existente.hora_inicio);
        const fin = aMinutos(existente.hora_fin);
        if (!yaPaso(r.fecha, { inicio, fin })) elegirSlot(inicio, fin, { enfocar: false });
      }
    });
  } else $('lista-slots').innerHTML = '<p class="mensaje-slots">No hay días con horarios disponibles en las próximas dos semanas.</p>';
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
    r.ocupados = sinReservaPropia(await cargarOcupados(fecha, r.mesa.id), fecha);
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

function elegirSlot(inicio, fin, { enfocar = true } = {}) {
  const primeraVez = !estado.reserva.slot && enfocar;
  estado.reserva.slot = { inicio, fin };
  limpiarError();
  renderSlots();
  actualizarResumen();

  // Paso 3: al elegir la primera hora aparecen los datos y se lleva al cliente ahí
  if (primeraVez) {
    $('bloque-datos').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('campo-nombre').focus({ preventScroll: true });
  }
}

function renderPersonas() {
  const { personas, mesa } = estado.reserva;
  $('personas-valor').textContent = personas;
  $('personas-menos').disabled = personas <= 1;
  $('personas-mas').disabled = personas >= mesa.capacidad;

  // Flujo alternativo del CU-02: avisar el máximo permitido
  const aviso = $('aviso-capacidad');
  aviso.hidden = personas < mesa.capacidad || !estado.reserva.slot;
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
  $('ind-datos').classList.toggle('hecho', Boolean(slot) && datosValidos());

  // Los datos solo se muestran (y se pueden llenar) después de elegir una hora
  const hayHora = Boolean(slot);
  $('bloque-datos').disabled = !hayHora;
  $('datos-campos').hidden = !hayHora;
  $('datos-pendiente').hidden = hayHora;
  if (!hayHora) $('aviso-capacidad').hidden = true;
  else if (estado.reserva.mesa) $('aviso-capacidad').hidden = personas < estado.reserva.mesa.capacidad;

  // Confirmar solo se activa cuando todo está completo y es válido
  const boton = $('boton-confirmar');
  if (!boton.dataset.cargando) {
    boton.disabled = !(hayHora && datosValidos());
    boton.title = !hayHora ? 'Primero elige una hora' : (datosValidos() ? '' : 'Completa tus datos');
  }
}

function textoBotonConfirmar() {
  return estado.reserva.modo === 'editar' ? 'Guardar cambios' : 'Confirmar reserva';
}

// Al editar, el turno actual de la reserva no cuenta como ocupado
function sinReservaPropia(ocupados, fecha) {
  const propia = estado.reserva.modo === 'editar' ? estado.reserva.existente : null;
  if (!propia || propia.fecha !== fecha) return ocupados;
  return ocupados.filter((o) => hhmm(o.hora_inicio) !== propia.hora_inicio);
}

function hhmm(hora) {
  return hora.slice(0, 5);
}

function datosValidos() {
  const nombre = $('campo-nombre').value.trim();
  const celular = $('campo-contacto').value;
  return nombre.length >= 2 && REGEX_NOMBRE.test(nombre) && (celular === '' || REGEX_CELULAR.test(celular));
}

// Mensaje bajo un campo: 'neutro', 'pendiente', 'ok' o 'error'
function mostrarEstadoCampo(campo, ayuda, tipo, texto) {
  ayuda.textContent = texto;
  ayuda.className = `ayuda ${tipo}`;
  campo.classList.toggle('valido', tipo === 'ok');
  if (tipo === 'error') campo.setAttribute('aria-invalid', 'true');
  else campo.removeAttribute('aria-invalid');
}

function validarNombreEnVivo() {
  const campo = $('campo-nombre');
  const nombre = campo.value.trim();
  if (nombre === '') {
    mostrarEstadoCampo(campo, $('ayuda-nombre'), 'neutro', 'Solo letras y espacios, máximo 50.');
  } else if (nombre.length < 2) {
    mostrarEstadoCampo(campo, $('ayuda-nombre'), 'pendiente', 'Escribe al menos 2 letras.');
  } else {
    mostrarEstadoCampo(campo, $('ayuda-nombre'), 'ok', '✓ Nombre válido');
  }
}

// Validación del celular mientras se escribe: dice qué falta o qué está mal
function validarCelularEnVivo(alSalir = false) {
  const campo = $('campo-contacto');
  const celular = campo.value;
  const ayuda = $('ayuda-contacto');
  if (celular === '') {
    mostrarEstadoCampo(campo, ayuda, 'neutro', 'Opcional · celular de 10 dígitos que empiece por 3.');
  } else if (!celular.startsWith('3')) {
    mostrarEstadoCampo(campo, ayuda, 'error', 'Debe empezar por 3 (celular colombiano).');
  } else if (celular.length < 10) {
    const faltan = 10 - celular.length;
    const texto = `Faltan ${faltan} ${faltan === 1 ? 'dígito' : 'dígitos'}.`;
    mostrarEstadoCampo(campo, ayuda, alSalir ? 'error' : 'pendiente', alSalir ? `Número incompleto: ${texto.toLowerCase()}` : texto);
  } else {
    mostrarEstadoCampo(campo, ayuda, 'ok', '✓ Número válido');
  }
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
  boton.dataset.cargando = 'si';
  boton.textContent = r.modo === 'editar' ? 'Guardando…' : 'Confirmando…';
  limpiarError();

  try {
    // Paso 10 del flujo: verificar otra vez que el slot siga libre
    r.ocupados = sinReservaPropia(await cargarOcupados(r.fecha, r.mesa.id), r.fecha);
    if (estadoSlot(r.fecha, r.slot, r.ocupados) === 'ocupado') {
      r.slot = null;
      renderSlots();
      actualizarResumen();
      mostrarError('Ese horario acaba de ser reservado. Elige otro.');
      return;
    }

    // El servidor vuelve a validar todo y evita la doble reserva
    const { data, error } = r.modo === 'editar'
      ? await db.rpc('modificar_reserva', {
          p_contacto: r.existente.cliente_contacto,
          p_codigo: r.existente.codigo,
          p_fecha: r.fecha,
          p_hora_inicio: aHora(r.slot.inicio),
          p_num_personas: r.personas
        })
      : await db.rpc('crear_reserva', {
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
    if (r.modo === 'editar') {
      estado.miReserva = data;
      renderMiReserva();
    }
    refrescarDisponibilidad();
  } catch (error) {
    console.error(error);
    mostrarError('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.');
  } finally {
    boton.dataset.cargando = '';
    boton.textContent = textoBotonConfirmar();
    actualizarResumen();
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
  $('comp-codigo').textContent = reserva.codigo;

  const editada = estado.reserva.modo === 'editar';
  $('confirmacion-titulo').textContent = editada ? '¡Reserva actualizada!' : '¡Tu mesa está reservada!';
  $('confirmacion-subtitulo').textContent = editada
    ? 'Estos son los nuevos datos de tu reserva.'
    : 'Muestra este comprobante al llegar a Konys Pizza.';
  $('comp-nota-codigo').textContent = reserva.cliente_contacto
    ? 'Guarda este código: con él y tu celular puedes cambiar o cancelar la reserva en «Mi reserva».'
    : 'No dejaste celular: si necesitas cambiarla, escríbenos por WhatsApp con este código.';

  $('vista-reserva').hidden = true;
  $('vista-confirmacion').hidden = false;
  $('modal-reserva').classList.add('estrecho');
  $('modal-reserva').scrollTop = 0;
  $('confirmacion-titulo').focus();
}

/* ----------------------------------------------------------
   Mi reserva: buscar con celular + código, modificar o cancelar
   ---------------------------------------------------------- */

const REGEX_CODIGO = /^[A-Z0-9]{6}$/;

function limpiarCodigo(valor) {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function mostrarErrorBuscar(mensaje) {
  $('error-buscar').textContent = mensaje;
  $('error-buscar').hidden = !mensaje;
}

async function buscarMiReserva(evento) {
  evento.preventDefault();
  const celular = limpiarCelular($('buscar-celular').value);
  const codigo = limpiarCodigo($('buscar-codigo').value);
  $('reserva-encontrada').hidden = true;

  if (!REGEX_CELULAR.test(celular)) {
    $('buscar-celular').setAttribute('aria-invalid', 'true');
    $('buscar-celular').focus();
    mostrarErrorBuscar('Escribe el celular de 10 dígitos que empieza por 3.');
    return;
  }
  if (!REGEX_CODIGO.test(codigo)) {
    $('buscar-codigo').setAttribute('aria-invalid', 'true');
    $('buscar-codigo').focus();
    mostrarErrorBuscar('El código tiene 6 letras o números. Lo encuentras en tu comprobante.');
    return;
  }

  const boton = $('boton-buscar');
  boton.disabled = true;
  boton.textContent = 'Buscando…';
  mostrarErrorBuscar('');
  try {
    const { data, error } = await db.rpc('buscar_reserva', { p_contacto: celular, p_codigo: codigo });
    if (error) {
      mostrarErrorBuscar(error.code?.startsWith('KP') ? error.message : 'No pudimos buscar tu reserva. Intenta de nuevo.');
      return;
    }
    estado.miReserva = data;
    renderMiReserva();
  } catch (error) {
    console.error(error);
    mostrarErrorBuscar('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Buscar mi reserva';
  }
}

function renderMiReserva() {
  const r = estado.miReserva;
  if (!r) {
    $('reserva-encontrada').hidden = true;
    return;
  }
  const activa = r.estado === 'confirmada';
  $('mi-codigo').textContent = r.codigo;
  $('mi-nombre').textContent = r.cliente_nombre;
  $('mi-mesa').textContent = `${r.mesa} · ${ZONAS[r.zona]}`;
  $('mi-fecha').textContent = formatoFecha(r.fecha, { weekday: 'long', day: 'numeric', month: 'long' });
  $('mi-hora').textContent = `${aHora12(aMinutos(r.hora_inicio))} – ${aHora12(aMinutos(r.hora_fin))}`;
  $('mi-personas').textContent = r.num_personas;
  $('mi-estado').textContent = activa ? 'Confirmada' : 'Cancelada';
  $('mi-estado').className = activa ? 'estado-ok' : 'estado-cancelada';
  $('mi-acciones').hidden = !activa;
  $('reserva-encontrada').hidden = false;
}

function modificarMiReserva() {
  const r = estado.miReserva;
  if (!estado.mesas.some((m) => m.id === r.mesa_id)) {
    mostrarErrorBuscar('Esa mesa no está disponible por ahora. Escríbenos por WhatsApp para cambiar tu reserva.');
    return;
  }
  abrirReserva(r.mesa_id, r);
}

async function cancelarMiReserva() {
  const r = estado.miReserva;
  const cuando = `${formatoFecha(r.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} a las ${aHora12(aMinutos(r.hora_inicio))}`;
  if (!confirm(`¿Cancelar tu reserva del ${cuando}? La mesa quedará libre para otras personas y no se puede deshacer.`)) return;

  const boton = $('boton-cancelar');
  boton.disabled = true;
  boton.textContent = 'Cancelando…';
  try {
    const { data, error } = await db.rpc('cancelar_reserva', { p_contacto: r.cliente_contacto, p_codigo: r.codigo });
    if (error) {
      mostrarErrorBuscar(error.code?.startsWith('KP') ? error.message : 'No pudimos cancelar la reserva. Intenta de nuevo.');
      return;
    }
    estado.miReserva = data;
    renderMiReserva();
    refrescarDisponibilidad();
  } catch (error) {
    console.error(error);
    mostrarErrorBuscar('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Cancelar reserva';
  }
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
    validarNombreEnVivo();
    actualizarResumen();
  });
  $('campo-contacto').addEventListener('input', () => {
    const campo = $('campo-contacto');
    const limpio = limpiarCelular(campo.value);
    if (campo.value !== limpio) campo.value = limpio;
    validarCelularEnVivo();
    actualizarResumen();
  });
  $('campo-contacto').addEventListener('blur', () => validarCelularEnVivo(true));
  $('form-reserva').addEventListener('submit', confirmarReserva);

  // Mi reserva
  $('form-buscar').addEventListener('submit', buscarMiReserva);
  $('buscar-celular').addEventListener('input', () => {
    const campo = $('buscar-celular');
    const limpio = limpiarCelular(campo.value);
    if (campo.value !== limpio) campo.value = limpio;
    campo.removeAttribute('aria-invalid');
  });
  $('buscar-codigo').addEventListener('input', () => {
    const campo = $('buscar-codigo');
    const limpio = limpiarCodigo(campo.value);
    if (campo.value !== limpio) campo.value = limpio;
    campo.removeAttribute('aria-invalid');
  });
  $('boton-modificar').addEventListener('click', modificarMiReserva);
  $('boton-cancelar').addEventListener('click', cancelarMiReserva);

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
