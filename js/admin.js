/* ==========================================================
   Módulo administrador (admin.html)
   RF-08 a RF-14: acceso, mesas, horarios, reservas y carta.
   Usa el cliente `db` definido en js/supabase.js.
   El acceso se valida con Supabase Auth y la tabla
   administradores; las reglas RLS impiden cambios de
   cualquier otro usuario.
   ========================================================== */

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const NOMBRE_DIA = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo'
};
const ZONAS = { salon: 'Salón', terraza: 'Terraza' };
const CATEGORIAS = { pizzas: 'Konys pizza', entradas: 'Entradas y papas', postres: 'Postres', bebidas: 'Bebidas' };
const ESTADOS = { confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada' };
const HORARIO_BASE = {
  almuerzo: { hora_inicio: '12:30', hora_fin: '14:30' },
  noche: { hora_inicio: '17:00', hora_fin: '23:00' }
};

const estado = {
  seccion: 'inicio',
  mesas: [],
  horarios: [],
  platos: [],
  editandoMesa: null,
  editandoPlato: null,
  notificaciones: [],
  reservas: [],
  // Página actual de cada tabla (10 filas por página)
  paginas: { mesas: 1, reservas: 1, platos: 1, notificaciones: 1, hoy: 1 },
  reservasHoy: [],
  filtroNoti: 'todas',
  canal: null,
  intervalo: null
};

const $ = (id) => document.getElementById(id);

// Mismas reglas que las restricciones de la base de datos
const REGEX_MESA = /^[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ #-]*$/;
const REGEX_PLATO = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .,'&()-]*$/;
const REGEX_URL_FOTO = /^https:\/\/[^\s"'<>`]+$/;
const PRECIO_MAXIMO = 1000000;

/* ----------------------------------------------------------
   Utilidades
   ---------------------------------------------------------- */

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// "19:00:00" -> "19:00"
function hhmm(hora) {
  return hora ? hora.slice(0, 5) : '';
}

function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function formatoPrecio(valor) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);
}

function formatoFecha(fechaISO) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${fechaISO}T00:00:00Z`));
}

function hoyColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// Mensaje flotante (js/ui.js). esError: rojo; si no, verde.
function avisar(mensaje, esError = false) {
  notificar(mensaje, esError ? 'error' : 'ok');
}

function errorAmigable(error, porDefecto) {
  console.error(error);
  if (error?.code === '23505') return 'Ya existe un registro con ese nombre.';
  if (error?.code === '23503') return 'No se puede borrar porque tiene reservas asociadas. Mejor desactívala.';
  if (error?.code === '42501') return 'Tu sesión no tiene permisos para este cambio.';
  if (error?.code === '23514') return 'Algún dato no cumple el formato permitido. Revisa los campos.';
  return porDefecto;
}

const ICONO_EDITAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const ICONO_BORRAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

// Ejecuta un insert/update/delete y confirma que afectó al menos una fila.
// Con RLS, un cambio no permitido no da error: simplemente no toca filas.
async function escribir(consulta) {
  const { data, error } = await consulta.select();
  if (error) return { error };
  if (!data || data.length === 0) return { error: { code: '42501', message: 'Sin filas afectadas' } };
  return { data };
}

// Filas de esqueleto mientras llegan los datos
function filasCargando(columnas, filas = 4) {
  const celdas = '<td><span class="esqueleto-linea"></span></td>'.repeat(columnas);
  return `<tr class="fila-cargando" aria-hidden="true">${celdas}</tr>`.repeat(filas);
}

function filaVacia(columnas, texto) {
  return `<tr><td colspan="${columnas}" class="vacio">${texto}</td></tr>`;
}

/* ----------------------------------------------------------
   RF-08: acceso
   ---------------------------------------------------------- */

async function esAdministrador() {
  const { data, error } = await db.rpc('es_admin');
  return !error && data === true;
}

function mostrarLogin(mensaje = '') {
  $('panel').hidden = true;
  $('login').hidden = false;
  const error = $('login-error');
  error.textContent = mensaje;
  error.hidden = !mensaje;
}

async function mostrarPanel(sesion) {
  $('login').hidden = true;
  $('panel').hidden = false;
  $('usuario-correo').textContent = sesion.user.email ?? '';
  iniciarNotificaciones();
  await cambiarSeccion(estado.seccion);
}

async function iniciarSesion(evento) {
  evento.preventDefault();
  const correo = $('login-correo').value.trim();
  const clave = $('login-clave').value;
  if (!correo || !clave) {
    mostrarLogin('Escribe tu correo y tu contraseña.');
    return;
  }

  const boton = $('login-boton');
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: correo, password: clave });
    if (error) {
      mostrarLogin('Correo o contraseña incorrectos. Intenta de nuevo.');
      return;
    }
    if (!(await esAdministrador())) {
      await db.auth.signOut();
      mostrarLogin('Esta cuenta no tiene permisos de administrador.');
      return;
    }
    $('form-login').reset();
    await mostrarPanel(data.session);
  } catch (error) {
    console.error(error);
    mostrarLogin('No pudimos conectarnos. Revisa tu internet.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar al panel';
  }
}

async function cerrarSesion() {
  const salir = await confirmar({
    titulo: '¿Cerrar sesión?',
    mensaje: 'Tendrás que volver a escribir tu correo y contraseña para entrar al panel.',
    textoConfirmar: 'Cerrar sesión'
  });
  if (!salir) return;
  await conCarga($('boton-salir'), 'Saliendo…', async () => {
    detenerNotificaciones();
    await db.auth.signOut();
  });
  mostrarLogin();
  notificar('Sesión cerrada.', 'info');
}

/* ----------------------------------------------------------
   Navegación entre secciones
   ---------------------------------------------------------- */

const CARGADORES = {
  inicio: cargarDashboard,
  notificaciones: cargarNotificaciones,
  mesas: cargarMesas,
  horarios: cargarHorarios,
  reservas: prepararReservas,
  carta: cargarPlatos
};

async function cambiarSeccion(seccion) {
  estado.seccion = seccion;
  document.querySelectorAll('.sidebar-nav button').forEach((b) => {
    if (b.dataset.seccion === seccion) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  Object.keys(CARGADORES).forEach((s) => { $(`seccion-${s}`).hidden = s !== seccion; });
  await CARGADORES[seccion]();
}

/* ----------------------------------------------------------
   RF-09, RF-10, RF-13: mesas
   ---------------------------------------------------------- */

async function cargarMesas() {
  if (estado.mesas.length === 0) $('tabla-mesas').innerHTML = filasCargando(5);
  const { data, error } = await db.from('mesas').select('*').order('id');
  if (error) {
    $('tabla-mesas').innerHTML = filaVacia(5, 'No se pudieron cargar las mesas.');
    return;
  }
  estado.mesas = data;
  renderMesas();
}

function renderMesas() {
  const activas = estado.mesas.filter((m) => m.activa).length;
  $('resumen-mesas').textContent =
    `${activas} activas de ${estado.mesas.length}. Las mesas inactivas no aparecen para los clientes.`;

  const pagina = paginar(estado.mesas, estado.paginas.mesas);
  estado.paginas.mesas = pagina.pagina;
  renderPaginacion($('pag-mesas'), pagina, (n) => { estado.paginas.mesas = n; renderMesas(); }, ['mesa', 'mesas']);
  $('tabla-mesas').innerHTML = estado.mesas.length === 0
    ? filaVacia(5, 'Aún no hay mesas. Crea la primera con “Nueva mesa”.')
    : pagina.items.map((m) => `
      <tr class="${m.activa ? '' : 'inactivo'}">
        <th scope="row">${escapar(m.nombre)}</th>
        <td>${ZONAS[m.zona]}</td>
        <td>${m.capacidad} personas</td>
        <td>
          <button type="button" class="interruptor" role="switch" aria-checked="${m.activa}"
                  data-accion="alternar" data-id="${m.id}" aria-label="${escapar(m.nombre)} activa">
            ${m.activa ? 'Activa' : 'Inactiva'}
          </button>
        </td>
        <td class="acciones">
          <button type="button" class="boton-icono editar" data-accion="editar" data-id="${m.id}" aria-label="Editar ${escapar(m.nombre)}">${ICONO_EDITAR}</button>
          <button type="button" class="boton-icono borrar" data-accion="borrar" data-id="${m.id}" aria-label="Borrar ${escapar(m.nombre)}">${ICONO_BORRAR}</button>
        </td>
      </tr>`).join('');
}

async function alternarMesa(id, boton) {
  const mesa = estado.mesas.find((m) => m.id === id);
  const { error } = await conCarga(boton, '', () => escribir(db.from('mesas').update({ activa: !mesa.activa }).eq('id', id)));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo cambiar el estado.'), true);
    return;
  }
  mesa.activa = !mesa.activa;
  renderMesas();
  avisar(`${mesa.nombre} ahora está ${mesa.activa ? 'activa' : 'inactiva'}.`);
}

function abrirDialogoMesa(mesa = null) {
  estado.editandoMesa = mesa;
  $('dialogo-mesa-titulo').textContent = mesa ? `Editar ${mesa.nombre}` : 'Nueva mesa';
  $('mesa-nombre').value = mesa?.nombre ?? '';
  $('mesa-capacidad').value = mesa?.capacidad ?? 4;
  $('mesa-foto').value = mesa?.foto_url ?? '';
  document.querySelector(`input[name="mesa-zona"][value="${mesa?.zona ?? 'salon'}"]`).checked = true;
  $('mesa-error').hidden = true;
  $('dialogo-mesa').showModal();
  $('mesa-nombre').focus();
}

async function guardarMesa(evento) {
  evento.preventDefault();
  const datos = {
    nombre: $('mesa-nombre').value.trim().replace(/\s+/g, ' '),
    zona: document.querySelector('input[name="mesa-zona"]:checked').value,
    capacidad: Number($('mesa-capacidad').value),
    foto_url: $('mesa-foto').value.trim() || null
  };

  const error = $('mesa-error');
  if (!datos.nombre || datos.nombre.length > 20 || !REGEX_MESA.test(datos.nombre)) {
    error.textContent = 'El nombre solo puede tener letras, números, espacios, # y - (máximo 20).';
    error.hidden = false;
    return;
  }
  if (!['salon', 'terraza'].includes(datos.zona)) {
    error.textContent = 'Elige una zona válida.';
    error.hidden = false;
    return;
  }
  if (!Number.isInteger(datos.capacidad) || datos.capacidad < 1 || datos.capacidad > 30) {
    error.textContent = 'La capacidad debe ser un número entero entre 1 y 30.';
    error.hidden = false;
    return;
  }
  if (datos.foto_url && (datos.foto_url.length > 500 || !REGEX_URL_FOTO.test(datos.foto_url))) {
    error.textContent = 'La URL de la foto debe empezar por https:// y no tener espacios ni comillas.';
    error.hidden = false;
    return;
  }

  const editando = estado.editandoMesa;
  const consulta = editando
    ? db.from('mesas').update(datos).eq('id', editando.id)
    : db.from('mesas').insert(datos);
  const { error: errorDb } = await conCarga(evento.submitter, 'Guardando…', () => escribir(consulta));
  if (errorDb) {
    error.textContent = errorAmigable(errorDb, 'No se pudo guardar la mesa.');
    error.hidden = false;
    return;
  }

  $('dialogo-mesa').close();
  avisar(editando ? `${datos.nombre} se actualizó.` : `${datos.nombre} se creó y ya está disponible para reservas.`);
  await cargarMesas();
}

async function borrarMesa(id, boton) {
  const mesa = estado.mesas.find((m) => m.id === id);
  const seguro = await confirmar({
    titulo: `¿Borrar ${mesa.nombre}?`,
    mensaje: 'La mesa se eliminará por completo y no se puede deshacer. Si solo quieres que no se pueda reservar por un tiempo, usa el interruptor Activa/Inactiva.',
    textoConfirmar: 'Sí, borrar mesa',
    peligro: true
  });
  if (!seguro) return;
  const { error } = await conCarga(boton, '', () => escribir(db.from('mesas').delete().eq('id', id)));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo borrar la mesa.'), true);
    return;
  }
  avisar(`${mesa.nombre} fue borrada.`);
  await cargarMesas();
}

/* ----------------------------------------------------------
   RF-11: horarios
   ---------------------------------------------------------- */

async function cargarHorarios() {
  const { data, error } = await db.from('horarios').select('*');
  if (error) {
    $('tabla-horarios').innerHTML = filaVacia(4, 'No se pudieron cargar los horarios.');
    return;
  }
  estado.horarios = data;
  const duracion = data[0]?.duracion_slot ?? 60;
  $('duracion-slot').value = String(duracion);
  renderHorarios();
}

function buscarHorario(dia, jornada) {
  return estado.horarios.find((h) => h.dia_semana === dia && h.jornada === jornada);
}

function contarTurnos(inicio, fin, duracion) {
  if (!inicio || !fin) return 0;
  const minutos = aMinutos(fin) - aMinutos(inicio);
  return minutos > 0 ? Math.floor(minutos / duracion) : 0;
}

function celdaJornada(dia, jornada) {
  const h = buscarHorario(dia, jornada);
  const base = HORARIO_BASE[jornada];
  const activo = h ? h.activo : false;
  const id = `${dia}-${jornada}`;
  const nombre = jornada === 'almuerzo' ? 'almuerzo' : 'noche';
  return `
    <div class="jornada-celda${activo ? '' : ' apagada'}" data-dia="${dia}" data-jornada="${jornada}">
      <label class="campo-check"><input type="checkbox" id="${id}-activo" ${activo ? 'checked' : ''}
             aria-label="${NOMBRE_DIA[dia]}: atender en ${nombre}"> Abierto</label>
      <input type="time" id="${id}-inicio" value="${hhmm(h?.hora_inicio) || base.hora_inicio}" aria-label="${NOMBRE_DIA[dia]} ${nombre}: inicio">
      <span class="a">a</span>
      <input type="time" id="${id}-fin" value="${hhmm(h?.hora_fin) || base.hora_fin}" aria-label="${NOMBRE_DIA[dia]} ${nombre}: fin">
    </div>`;
}

function renderHorarios() {
  $('tabla-horarios').innerHTML = DIAS.map((dia) => `
    <tr data-dia="${dia}">
      <th scope="row">${NOMBRE_DIA[dia]}</th>
      <td>${celdaJornada(dia, 'almuerzo')}</td>
      <td>${celdaJornada(dia, 'noche')}</td>
      <td class="turnos-dia"></td>
    </tr>`).join('');
  actualizarTurnos();
}

// Muestra cuántos turnos por mesa salen con la configuración actual
function actualizarTurnos() {
  const duracion = Number($('duracion-slot').value);
  DIAS.forEach((dia) => {
    let total = 0;
    ['almuerzo', 'noche'].forEach((jornada) => {
      const id = `${dia}-${jornada}`;
      const activo = $(`${id}-activo`).checked;
      $(`${id}-activo`).closest('.jornada-celda').classList.toggle('apagada', !activo);
      if (activo) total += contarTurnos($(`${id}-inicio`).value, $(`${id}-fin`).value, duracion);
    });
    const celda = document.querySelector(`tr[data-dia="${dia}"] .turnos-dia`);
    celda.innerHTML = total > 0
      ? `<span class="pastilla turnos">${total} turnos</span>`
      : '<span class="pastilla cerrado">Cerrado</span>';
  });
}

async function guardarHorarios() {
  const duracion = Number($('duracion-slot').value);
  const filas = [];

  for (const dia of DIAS) {
    for (const jornada of ['almuerzo', 'noche']) {
      const id = `${dia}-${jornada}`;
      const activo = $(`${id}-activo`).checked;
      const inicio = $(`${id}-inicio`).value;
      const fin = $(`${id}-fin`).value;
      if (!inicio || !fin || aMinutos(fin) <= aMinutos(inicio)) {
        avisar(`${NOMBRE_DIA[dia]} (${jornada}): la hora de fin debe ser después de la de inicio.`, true);
        return;
      }
      if (activo && contarTurnos(inicio, fin, duracion) === 0) {
        avisar(`${NOMBRE_DIA[dia]} (${jornada}): la jornada es más corta que la duración de una reserva.`, true);
        return;
      }
      filas.push({ dia_semana: dia, jornada, hora_inicio: inicio, hora_fin: fin, duracion_slot: duracion, activo });
    }
  }

  const { error } = await conCarga($('guardar-horarios'), 'Guardando…',
    () => escribir(db.from('horarios').upsert(filas, { onConflict: 'dia_semana,jornada' })));
  if (error) {
    avisar(errorAmigable(error, 'No se pudieron guardar los horarios.'), true);
    return;
  }
  avisar('Horarios guardados. Los clientes ya ven los nuevos turnos.');
  await cargarHorarios();
}

/* ----------------------------------------------------------
   RF-12: reservas
   ---------------------------------------------------------- */

async function prepararReservas() {
  // Las mesas se necesitan para el filtro (también las inactivas)
  if (estado.mesas.length === 0) {
    const { data } = await db.from('mesas').select('*').order('id');
    estado.mesas = data ?? [];
  }
  const filtroMesa = $('filtro-mesa');
  const seleccion = filtroMesa.value;
  filtroMesa.innerHTML = '<option value="">Todas las mesas</option>' +
    estado.mesas.map((m) => `<option value="${m.id}">${escapar(m.nombre)}</option>`).join('');
  filtroMesa.value = seleccion;

  if (!$('filtro-fecha').dataset.iniciado) {
    $('filtro-fecha').value = hoyColombia();
    $('filtro-fecha').dataset.iniciado = 'si';
  }
  await cargarReservas();
}

// opciones.reiniciarPagina: false para quedarse en la página actual (al cambiar un estado)
async function cargarReservas(opciones) {
  if (opciones?.reiniciarPagina !== false) estado.paginas.reservas = 1;
  $('tabla-reservas').innerHTML = filasCargando(8);
  let consulta = db.from('reservas')
    .select('id, codigo, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado, mesas(nombre, zona)')
    .order('fecha')
    .order('hora_inicio');

  const fecha = $('filtro-fecha').value;
  const mesa = $('filtro-mesa').value;
  const estadoFiltro = $('filtro-estado').value;
  if (fecha) consulta = consulta.eq('fecha', fecha);
  if (mesa) consulta = consulta.eq('mesa_id', Number(mesa));
  if (estadoFiltro) consulta = consulta.eq('estado', estadoFiltro);

  const { data, error } = await consulta;
  if (error) {
    $('tabla-reservas').innerHTML = filaVacia(8, 'No se pudieron cargar las reservas.');
    return;
  }

  const confirmadas = data.filter((r) => r.estado === 'confirmada');
  const personas = confirmadas.reduce((suma, r) => suma + r.num_personas, 0);
  $('resumen-reservas').textContent =
    `${data.length} ${data.length === 1 ? 'reserva' : 'reservas'}` +
    (fecha ? ` el ${formatoFecha(fecha)}` : ' en total') +
    ` · ${confirmadas.length} confirmadas · ${personas} personas esperadas`;

  estado.reservas = data;
  renderReservas();
}

function renderReservas() {
  const data = estado.reservas;
  const pagina = paginar(data, estado.paginas.reservas);
  estado.paginas.reservas = pagina.pagina;
  renderPaginacion($('pag-reservas'), pagina, (n) => { estado.paginas.reservas = n; renderReservas(); }, ['reserva', 'reservas']);
  $('tabla-reservas').innerHTML = data.length === 0
    ? filaVacia(8, 'No hay reservas con estos filtros. Prueba con otra fecha o pulsa “Ver todas”.')
    : pagina.items.map((r) => `
      <tr>
        <th scope="row">${escapar(r.cliente_nombre)}</th>
        <td><code class="codigo">${escapar(r.codigo)}</code></td>
        <td>${escapar(r.mesas?.nombre)} · ${ZONAS[r.mesas?.zona] ?? ''}</td>
        <td>${formatoFecha(r.fecha)}</td>
        <td>${hhmm(r.hora_inicio)} – ${hhmm(r.hora_fin)}</td>
        <td>${r.num_personas}</td>
        <td>${r.cliente_contacto ? escapar(r.cliente_contacto) : '—'}</td>
        <td>
          <select class="estado-${r.estado}" data-reserva="${r.id}" aria-label="Estado de la reserva de ${escapar(r.cliente_nombre)}">
            ${Object.entries(ESTADOS).map(([valor, texto]) =>
              `<option value="${valor}" ${valor === r.estado ? 'selected' : ''}>${texto}</option>`).join('')}
          </select>
        </td>
      </tr>`).join('');
}

async function cambiarEstadoReserva(select) {
  const id = Number(select.dataset.reserva);
  const nuevo = select.value;
  select.disabled = true;
  select.setAttribute('aria-busy', 'true');
  const { error } = await escribir(db.from('reservas').update({ estado: nuevo }).eq('id', id));
  if (error) {
    // 23P01: al volver a "confirmada" el horario ya lo tomó otra reserva
    avisar(error.code === '23P01'
      ? 'No se puede confirmar: ese horario ya tiene otra reserva confirmada.'
      : errorAmigable(error, 'No se pudo cambiar el estado.'), true);
  } else {
    avisar(`Reserva marcada como ${ESTADOS[nuevo].toLowerCase()}.`);
  }
  await cargarReservas({ reiniciarPagina: false });
}

/* ----------------------------------------------------------
   RF-14: carta
   ---------------------------------------------------------- */

async function cargarPlatos() {
  if (estado.platos.length === 0) $('tabla-platos').innerHTML = filasCargando(5);
  const { data, error } = await db.from('platos').select('*').order('categoria').order('nombre');
  if (error) {
    $('tabla-platos').innerHTML = filaVacia(5, 'No se pudo cargar la carta.');
    return;
  }
  estado.platos = data;
  renderPlatos();
}

function renderPlatos() {
  const pagina = paginar(estado.platos, estado.paginas.platos);
  estado.paginas.platos = pagina.pagina;
  renderPaginacion($('pag-platos'), pagina, (n) => { estado.paginas.platos = n; renderPlatos(); }, ['plato', 'platos']);
  $('tabla-platos').innerHTML = estado.platos.length === 0
    ? filaVacia(5, 'La carta está vacía. Agrega el primer plato.')
    : pagina.items.map((p) => `
      <tr class="${p.disponible ? '' : 'inactivo'}">
        <th scope="row">${escapar(p.nombre)}${p.descripcion ? `<br><small class="texto-suave">${escapar(p.descripcion)}</small>` : ''}</th>
        <td>${CATEGORIAS[p.categoria]}</td>
        <td>${formatoPrecio(p.precio)}</td>
        <td>
          <button type="button" class="interruptor" role="switch" aria-checked="${p.disponible}"
                  data-accion="alternar" data-id="${p.id}" aria-label="${escapar(p.nombre)} visible">
            ${p.disponible ? 'Visible' : 'Oculto'}
          </button>
        </td>
        <td class="acciones">
          <button type="button" class="boton-icono editar" data-accion="editar" data-id="${p.id}" aria-label="Editar ${escapar(p.nombre)}">${ICONO_EDITAR}</button>
          <button type="button" class="boton-icono borrar" data-accion="borrar" data-id="${p.id}" aria-label="Borrar ${escapar(p.nombre)}">${ICONO_BORRAR}</button>
        </td>
      </tr>`).join('');
}

async function alternarPlato(id, boton) {
  const plato = estado.platos.find((p) => p.id === id);
  const { error } = await conCarga(boton, '', () => escribir(db.from('platos').update({ disponible: !plato.disponible }).eq('id', id)));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo cambiar la visibilidad.'), true);
    return;
  }
  plato.disponible = !plato.disponible;
  renderPlatos();
  avisar(`${plato.nombre} ${plato.disponible ? 'ya se muestra' : 'quedó oculto'} en la carta.`);
}

function abrirDialogoPlato(plato = null) {
  estado.editandoPlato = plato;
  $('dialogo-plato-titulo').textContent = plato ? `Editar ${plato.nombre}` : 'Nuevo plato';
  $('plato-nombre').value = plato?.nombre ?? '';
  $('plato-categoria').value = plato?.categoria ?? 'pizzas';
  $('plato-descripcion').value = plato?.descripcion ?? '';
  $('plato-precio').value = plato?.precio ?? '';
  $('plato-disponible').checked = plato?.disponible ?? true;
  $('contador-desc').textContent = $('plato-descripcion').value.length;
  $('plato-error').hidden = true;
  $('dialogo-plato').showModal();
  $('plato-nombre').focus();
}

async function guardarPlato(evento) {
  evento.preventDefault();
  const datos = {
    nombre: $('plato-nombre').value.trim().replace(/\s+/g, ' '),
    categoria: $('plato-categoria').value,
    descripcion: $('plato-descripcion').value.trim().replace(/\s+/g, ' ') || null,
    precio: Number($('plato-precio').value),
    disponible: $('plato-disponible').checked
  };

  const error = $('plato-error');
  if (datos.nombre.length < 2 || datos.nombre.length > 60 || !REGEX_PLATO.test(datos.nombre)) {
    error.textContent = 'El nombre debe tener de 2 a 60 caracteres: letras, números y . , \' & ( ) -';
    error.hidden = false;
    return;
  }
  if (!Object.keys(CATEGORIAS).includes(datos.categoria)) {
    error.textContent = 'Elige una categoría válida.';
    error.hidden = false;
    return;
  }
  if (datos.descripcion && (datos.descripcion.length > 200 || /[<>]/.test(datos.descripcion))) {
    error.textContent = 'La descripción admite máximo 200 caracteres y no puede tener < ni >.';
    error.hidden = false;
    return;
  }
  if ($('plato-precio').value === '' || !Number.isInteger(datos.precio) || datos.precio < 0 || datos.precio > PRECIO_MAXIMO) {
    error.textContent = 'El precio debe ser un número entero en pesos, sin puntos, hasta $1.000.000.';
    error.hidden = false;
    return;
  }

  const editando = estado.editandoPlato;
  const consulta = editando
    ? db.from('platos').update(datos).eq('id', editando.id)
    : db.from('platos').insert(datos);
  const { error: errorDb } = await conCarga(evento.submitter, 'Guardando…', () => escribir(consulta));
  if (errorDb) {
    error.textContent = errorAmigable(errorDb, 'No se pudo guardar el plato.');
    error.hidden = false;
    return;
  }

  $('dialogo-plato').close();
  avisar(editando ? `${datos.nombre} se actualizó.` : `${datos.nombre} se agregó a la carta.`);
  await cargarPlatos();
}

async function borrarPlato(id, boton) {
  const plato = estado.platos.find((p) => p.id === id);
  const seguro = await confirmar({
    titulo: `¿Borrar «${plato.nombre}»?`,
    mensaje: 'El plato se eliminará de la carta y no se puede deshacer. Si solo quieres esconderlo por un tiempo, usa el interruptor Visible/Oculto.',
    textoConfirmar: 'Sí, borrar plato',
    peligro: true
  });
  if (!seguro) return;
  const { error } = await conCarga(boton, '', () => escribir(db.from('platos').delete().eq('id', id)));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo borrar el plato.'), true);
    return;
  }
  avisar(`${plato.nombre} fue borrado.`);
  await cargarPlatos();
}

/* ----------------------------------------------------------
   Dashboard inicial: resumen del día
   ---------------------------------------------------------- */

const DIAS_ISO = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const CAMPOS_RESERVA = 'id, codigo, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado, creado_en, mesas(nombre, zona)';

function sumarDias(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function minutosAhoraColombia() {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date()).split(':').map(Number);
  return h * 60 + m;
}

// "19:00:00" -> "7:00 p. m."
function hora12(hora) {
  const min = aMinutos(hora);
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

function haceCuanto(fechaHora) {
  const segundos = (new Date(fechaHora) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const pasos = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']];
  let valor = segundos;
  for (const [limite, unidad] of pasos) {
    if (Math.abs(valor) < limite) return rtf.format(Math.round(valor), unidad);
    valor /= limite;
  }
  return rtf.format(Math.round(valor), 'year');
}

function chipEstado(estadoReserva) {
  return `<span class="chip-estado ${estadoReserva}">${ESTADOS[estadoReserva]}</span>`;
}

// Turnos por mesa que tiene un día según los horarios activos
function turnosDelDia(fechaISO) {
  const dia = DIAS_ISO[new Date(`${fechaISO}T00:00:00Z`).getUTCDay()];
  return estado.horarios
    .filter((h) => h.dia_semana === dia && h.activo)
    .reduce((total, h) => total + contarTurnos(hhmm(h.hora_inicio), hhmm(h.hora_fin), h.duracion_slot), 0);
}

async function cargarDashboard() {
  const hoy = hoyColombia();
  $('dash-fecha').textContent = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${hoy}T00:00:00Z`));

  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const [rango, recientes, mesas, horarios, canceladas] = await Promise.all([
    db.from('reservas').select(CAMPOS_RESERVA).gte('fecha', hoy).lte('fecha', sumarDias(hoy, 6)).order('hora_inicio'),
    db.from('reservas').select(CAMPOS_RESERVA).order('creado_en', { ascending: false }).limit(6),
    db.from('mesas').select('*').order('id'),
    db.from('horarios').select('*'),
    db.from('notificaciones').select('id', { count: 'exact', head: true }).eq('tipo', 'cancelada').gte('creado_en', hace7)
  ]);
  const error = rango.error || recientes.error || mesas.error || horarios.error;
  if (error) {
    avisar('No se pudo cargar el resumen.', true);
    return;
  }
  estado.mesas = mesas.data;
  estado.horarios = horarios.data;

  renderKpis(rango.data, hoy, canceladas.count ?? 0);
  renderReservasHoy(rango.data.filter((r) => r.fecha === hoy));
  renderGrafico(rango.data, hoy);
  renderRecientes(recientes.data);
  $('dash-actualizado').textContent = `Actualizado ${new Intl.DateTimeFormat('es-CO', { timeStyle: 'short' }).format(new Date())}`;
}

function renderKpis(reservas, hoy, canceladas) {
  const deHoy = reservas.filter((r) => r.fecha === hoy);
  const confirmadas = deHoy.filter((r) => r.estado === 'confirmada');
  const completadas = deHoy.filter((r) => r.estado === 'completada').length;
  const canceladasHoy = deHoy.filter((r) => r.estado === 'cancelada').length;

  $('kpi-hoy').textContent = confirmadas.length;
  $('kpi-hoy-detalle').textContent = `${completadas} completadas · ${canceladasHoy} canceladas`;
  $('kpi-personas').textContent = confirmadas.reduce((suma, r) => suma + r.num_personas, 0);

  // Ocupación: turnos tomados (no cancelados) sobre el total de turnos de las mesas activas
  const mesasActivas = estado.mesas.filter((m) => m.activa).length;
  const total = turnosDelDia(hoy) * mesasActivas;
  const tomados = deHoy.filter((r) => r.estado !== 'cancelada').length;
  const porcentaje = total ? Math.round((tomados / total) * 100) : 0;
  $('kpi-ocupacion').textContent = total ? `${porcentaje} %` : 'Cerrado';
  $('kpi-ocupacion-barra').style.width = `${porcentaje}%`;
  $('kpi-ocupacion-detalle').textContent = total ? `${tomados} de ${total} turnos (${mesasActivas} mesas activas)` : 'Hoy no hay horario de atención';

  const ahora = minutosAhoraColombia();
  const proxima = confirmadas.find((r) => aMinutos(r.hora_inicio) >= ahora);
  $('kpi-proxima').textContent = proxima ? hora12(proxima.hora_inicio) : '—';
  $('kpi-proxima-detalle').textContent = proxima
    ? `${proxima.cliente_nombre} · ${proxima.mesas?.nombre} · ${proxima.num_personas} pers.`
    : 'No quedan reservas para hoy';

  const semana = reservas.filter((r) => r.estado === 'confirmada');
  $('kpi-semana').textContent = semana.length;
  $('kpi-semana-detalle').textContent = `${semana.reduce((suma, r) => suma + r.num_personas, 0)} personas en total`;
  $('kpi-canceladas').textContent = canceladas;
}

function renderReservasHoy(reservas = estado.reservasHoy) {
  estado.reservasHoy = reservas;
  const lista = $('dash-hoy');
  const pagina = paginar(reservas, estado.paginas.hoy);
  estado.paginas.hoy = pagina.pagina;
  renderPaginacion($('pag-hoy'), pagina, (n) => { estado.paginas.hoy = n; renderReservasHoy(); }, ['reserva hoy', 'reservas hoy']);
  if (reservas.length === 0) {
    lista.innerHTML = '<li class="vacio-panel">No hay reservas para hoy. Las nuevas aparecen aquí solas, sin recargar.</li>';
    return;
  }
  const ahora = minutosAhoraColombia();
  lista.innerHTML = pagina.items.map((r) => {
    const yaPaso = r.estado === 'confirmada' && aMinutos(r.hora_fin) <= ahora;
    return `
      <li class="item-hoy${yaPaso ? ' por-cerrar' : ''}${r.estado === 'cancelada' ? ' cancelada' : ''}">
        <span class="item-hoy-hora">${hora12(r.hora_inicio)}</span>
        <div class="item-hoy-info">
          <strong>${escapar(r.cliente_nombre)}</strong>
          <span>${escapar(r.mesas?.nombre)} · ${r.num_personas} pers. · <code class="codigo">${escapar(r.codigo)}</code>
            ${r.cliente_contacto ? ` · <a href="tel:+57${escapar(r.cliente_contacto)}">${escapar(r.cliente_contacto)}</a>` : ''}</span>
          ${yaPaso ? '<span class="nota-cierre">Ya pasó la hora: márcala como completada o cancelada.</span>' : ''}
        </div>
        <div class="item-hoy-acciones">
          ${r.estado === 'confirmada'
            ? `<button type="button" class="btn btn-secundario btn-pequeno" data-reserva-estado="completada" data-id="${r.id}">Llegó</button>
               <button type="button" class="boton-icono borrar" data-reserva-estado="cancelada" data-id="${r.id}" aria-label="Cancelar la reserva de ${escapar(r.cliente_nombre)}">${ICONO_BORRAR}</button>`
            : chipEstado(r.estado)}
        </div>
      </li>`;
  }).join('');
}

// Barras verticales de un solo color (una serie: el título la nombra, sin leyenda).
// Etiqueta directa solo en el máximo; cada barra tiene tooltip y hay una tabla para lectores de pantalla.
function renderGrafico(reservas, hoy) {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(hoy, i);
    const del = reservas.filter((r) => r.fecha === fecha && r.estado === 'confirmada');
    return {
      fecha,
      cantidad: del.length,
      personas: del.reduce((suma, r) => suma + r.num_personas, 0),
      etiqueta: i === 0 ? 'Hoy' : formatoFecha(fecha).split(',')[0].replace('.', ''),
      completa: new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${fecha}T00:00:00Z`))
    };
  });
  const maximo = Math.max(...dias.map((d) => d.cantidad), 1);
  const indiceMaximo = dias.findIndex((d) => d.cantidad === maximo && d.cantidad > 0);

  const grafico = $('dash-grafico');
  grafico.setAttribute('aria-label', `Reservas confirmadas por día: ${dias.map((d) => `${d.completa}, ${d.cantidad}`).join('; ')}`);
  grafico.innerHTML = `
    <div class="grafico-barras">
      ${dias.map((d, i) => `
        <div class="grafico-columna" tabindex="0" data-tooltip="${escapar(d.completa)}: ${d.cantidad} ${d.cantidad === 1 ? 'reserva' : 'reservas'} · ${d.personas} personas">
          <span class="grafico-valor"${i === indiceMaximo ? '' : ' hidden'}>${d.cantidad}</span>
          <span class="grafico-barra${d.cantidad === 0 ? ' vacia' : ''}" data-alto="${Math.round((d.cantidad / maximo) * 100)}"></span>
        </div>`).join('')}
    </div>
    <div class="grafico-eje">
      ${dias.map((d, i) => `<span class="${i === 0 ? 'hoy' : ''}">${escapar(d.etiqueta)}</span>`).join('')}
    </div>
    <div class="grafico-tooltip" id="grafico-tooltip" role="tooltip" hidden></div>`;
  // El alto se asigna desde JS (la CSP no permite atributos style en el HTML)
  grafico.querySelectorAll('.grafico-barra').forEach((barra) => barra.style.setProperty('--alto', `${barra.dataset.alto}%`));

  $('dash-grafico-tabla').innerHTML = `<caption>Reservas confirmadas por día</caption>
    <tr><th scope="col">Día</th><th scope="col">Reservas</th><th scope="col">Personas</th></tr>
    ${dias.map((d) => `<tr><td>${escapar(d.completa)}</td><td>${d.cantidad}</td><td>${d.personas}</td></tr>`).join('')}`;
}

function mostrarTooltipGrafico(columna) {
  const tooltip = $('grafico-tooltip');
  if (!tooltip) return;
  tooltip.textContent = columna.dataset.tooltip;
  tooltip.hidden = false;
  const caja = $('dash-grafico').getBoundingClientRect();
  const barra = columna.getBoundingClientRect();
  const izquierda = Math.min(Math.max(barra.left - caja.left + barra.width / 2, 80), caja.width - 80);
  tooltip.style.left = `${izquierda}px`;
}

function renderRecientes(reservas) {
  const lista = $('dash-recientes');
  lista.innerHTML = reservas.length === 0
    ? '<li class="vacio-panel">Aún no hay reservas.</li>'
    : reservas.map((r) => `
      <li class="item-reciente">
        <span class="avatar" aria-hidden="true">${escapar(r.cliente_nombre.charAt(0).toUpperCase())}</span>
        <div>
          <strong>${escapar(r.cliente_nombre)}</strong>
          <span>${escapar(r.mesas?.nombre)} · ${formatoFecha(r.fecha)} · ${hora12(r.hora_inicio)} · ${r.num_personas} pers.</span>
        </div>
        <div class="item-reciente-lado">
          ${chipEstado(r.estado)}
          <time datetime="${escapar(r.creado_en)}">${haceCuanto(r.creado_en)}</time>
        </div>
      </li>`).join('');
}

async function cambiarEstadoDesdeDashboard(boton) {
  const nuevo = boton.dataset.reservaEstado;
  if (nuevo === 'cancelada') {
    const seguro = await confirmar({
      titulo: '¿Cancelar esta reserva?',
      mensaje: 'El turno quedará libre para otros clientes. El cliente no recibe aviso automático: si dejó celular, escríbele.',
      textoConfirmar: 'Sí, cancelar reserva',
      textoCancelar: 'Volver',
      peligro: true
    });
    if (!seguro) return;
  }
  const { error } = await conCarga(boton, nuevo === 'completada' ? 'Guardando…' : '',
    () => escribir(db.from('reservas').update({ estado: nuevo }).eq('id', Number(boton.dataset.id))));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo cambiar el estado.'), true);
    return;
  }
  avisar(nuevo === 'completada' ? 'Listo: el cliente llegó y la reserva quedó completada.' : 'Reserva cancelada. El turno quedó libre.');
  await cargarDashboard();
}

/* ----------------------------------------------------------
   Notificaciones (con tiempo real)
   ---------------------------------------------------------- */

const TIPOS_NOTIFICACION = {
  nueva: { titulo: 'Nueva reserva', icono: '<path d="M12 5v14M5 12h14"/>' },
  modificada: { titulo: 'Reserva modificada', icono: '<path d="M4 20h4L19 9l-4-4L4 16z"/>' },
  cancelada: { titulo: 'Reserva cancelada', icono: '<path d="M6 6l12 12M18 6L6 18"/>' }
};

function textoReserva(d) {
  return `${formatoFecha(d.fecha)} · ${hora12(d.hora_inicio)} · ${d.num_personas} pers.`;
}

async function cargarNotificaciones() {
  const { data, error } = await db.from('notificaciones').select('*').order('creado_en', { ascending: false }).limit(100);
  if (error) {
    $('lista-notificaciones').innerHTML = '<li class="vacio-panel">No se pudieron cargar las notificaciones.</li>';
    return;
  }
  estado.notificaciones = data;
  renderNotificaciones();
}

function renderNotificaciones() {
  const sinLeer = estado.notificaciones.filter((n) => !n.leida).length;
  $('resumen-notificaciones').textContent = sinLeer
    ? `${sinLeer} sin leer · reservas nuevas, modificadas o canceladas por los clientes.`
    : 'Estás al día · reservas nuevas, modificadas o canceladas por los clientes.';
  $('marcar-todas').disabled = sinLeer === 0;

  const todas = estado.filtroNoti === 'sin-leer' ? estado.notificaciones.filter((n) => !n.leida) : estado.notificaciones;
  const pagina = paginar(todas, estado.paginas.notificaciones);
  estado.paginas.notificaciones = pagina.pagina;
  renderPaginacion($('pag-notificaciones'), pagina, (n) => {
    estado.paginas.notificaciones = n;
    renderNotificaciones();
    $('titulo-notificaciones').scrollIntoView({ block: 'start' });
  }, ['notificación', 'notificaciones']);
  const visibles = pagina.items;
  $('lista-notificaciones').innerHTML = todas.length === 0
    ? `<li class="vacio-panel">${estado.filtroNoti === 'sin-leer' ? 'No tienes notificaciones sin leer.' : 'Aún no hay notificaciones.'}</li>`
    : visibles.map((n) => {
      const tipo = TIPOS_NOTIFICACION[n.tipo];
      const d = n.datos;
      return `
        <li class="notificacion ${n.tipo}${n.leida ? ' leida' : ''}">
          <span class="notificacion-icono" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${tipo.icono}</svg>
          </span>
          <div class="notificacion-cuerpo">
            <p class="notificacion-titulo">
              ${n.leida ? '' : '<span class="punto-no-leida"><span class="solo-lectores">Sin leer: </span></span>'}
              <strong>${tipo.titulo}</strong> · ${escapar(d.cliente_nombre)}
            </p>
            <p>${escapar(d.mesa)} · ${textoReserva(d)} · código <code class="codigo">${escapar(d.codigo)}</code></p>
            ${d.antes ? `<p class="notificacion-antes">Antes: ${textoReserva(d.antes)}</p>` : ''}
            <time datetime="${escapar(n.creado_en)}">${haceCuanto(n.creado_en)}</time>
          </div>
          <div class="notificacion-acciones">
            <button type="button" class="btn btn-secundario btn-pequeno" data-ver-fecha="${escapar(d.fecha)}" data-noti="${n.id}">Ver en reservas</button>
            ${n.leida ? '' : `<button type="button" class="enlace-boton" data-leer="${n.id}">Marcar como leída</button>`}
          </div>
        </li>`;
    }).join('');
}

async function actualizarContador() {
  const { count, error } = await db.from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false);
  if (error) return;
  const texto = count > 99 ? '99+' : String(count);
  ['contador-campana', 'contador-menu'].forEach((id) => {
    $(id).textContent = texto;
    $(id).hidden = count === 0;
  });
  $('campana').setAttribute('aria-label', count ? `Notificaciones, ${count} sin leer` : 'Notificaciones');
  document.title = `${count ? `(${texto}) ` : ''}Konys Pizza – Panel de administración`;
}

async function marcarLeidas(ids) {
  if (ids.length === 0) return;
  const { error } = await escribir(db.from('notificaciones').update({ leida: true }).in('id', ids));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo marcar como leída.'), true);
    return;
  }
  estado.notificaciones.forEach((n) => { if (ids.includes(n.id)) n.leida = true; });
  renderNotificaciones();
  actualizarContador();
}

async function verEnReservas(fecha) {
  $('filtro-fecha').value = fecha;
  $('filtro-fecha').dataset.iniciado = 'si';
  $('filtro-mesa').value = '';
  $('filtro-estado').value = '';
  await cambiarSeccion('reservas');
}

// Tiempo real: llega una notificación nueva sin recargar. Además, cada minuto se
// revisa el contador por si la conexión en tiempo real se interrumpe.
function iniciarNotificaciones() {
  detenerNotificaciones();
  estado.canal = db.channel('notificaciones-admin')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, ({ new: nueva }) => {
      estado.notificaciones.unshift(nueva);
      actualizarContador();
      avisar(`${TIPOS_NOTIFICACION[nueva.tipo].titulo}: ${nueva.datos.cliente_nombre}, ${nueva.datos.mesa}`);
      if (estado.seccion === 'notificaciones') renderNotificaciones();
      if (estado.seccion === 'inicio') cargarDashboard();
    })
    .subscribe();
  estado.intervalo = setInterval(() => {
    actualizarContador();
    if (estado.seccion === 'inicio' && !document.hidden) cargarDashboard();
  }, 60000);
  actualizarContador();
}

function detenerNotificaciones() {
  if (estado.canal) db.removeChannel(estado.canal);
  clearInterval(estado.intervalo);
  estado.canal = null;
}

/* ----------------------------------------------------------
   Eventos
   ---------------------------------------------------------- */

function registrarEventos() {
  $('form-login').addEventListener('submit', iniciarSesion);
  $('boton-salir').addEventListener('click', cerrarSesion);

  document.querySelector('.sidebar-nav').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-seccion]');
    if (boton) cambiarSeccion(boton.dataset.seccion);
  });
  // Campana y enlaces "Ver …" que llevan a otra sección
  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('[data-seccion-ir]');
    if (enlace) cambiarSeccion(enlace.dataset.seccionIr);
  });

  // Dashboard
  $('dash-refrescar').addEventListener('click', async (e) => {
    await conCarga(e.currentTarget, 'Actualizando…', cargarDashboard);
    notificar('Resumen actualizado.', 'info');
  });
  $('dash-hoy').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-reserva-estado]');
    if (boton) cambiarEstadoDesdeDashboard(boton);
  });
  document.querySelector('[data-ir-reservas="hoy"]').addEventListener('click', () => verEnReservas(hoyColombia()));
  const grafico = $('dash-grafico');
  ['mouseover', 'focusin'].forEach((tipo) => grafico.addEventListener(tipo, (e) => {
    const columna = e.target.closest('.grafico-columna');
    if (columna) mostrarTooltipGrafico(columna);
  }));
  ['mouseleave', 'focusout'].forEach((tipo) => grafico.addEventListener(tipo, () => {
    if ($('grafico-tooltip')) $('grafico-tooltip').hidden = true;
  }));

  // Notificaciones
  document.querySelectorAll('[data-filtro-noti]').forEach((boton) => {
    boton.addEventListener('click', () => {
      estado.filtroNoti = boton.dataset.filtroNoti;
      estado.paginas.notificaciones = 1;
      document.querySelectorAll('[data-filtro-noti]').forEach((b) => {
        b.classList.toggle('activo', b === boton);
        b.setAttribute('aria-pressed', b === boton);
      });
      renderNotificaciones();
    });
  });
  $('marcar-todas').addEventListener('click', async (e) => {
    const ids = estado.notificaciones.filter((n) => !n.leida).map((n) => n.id);
    await conCarga(e.currentTarget, 'Marcando…', () => marcarLeidas(ids));
    notificar(`${ids.length} ${ids.length === 1 ? 'notificación marcada' : 'notificaciones marcadas'} como leídas.`);
  });
  $('lista-notificaciones').addEventListener('click', async (e) => {
    const leer = e.target.closest('[data-leer]');
    if (leer) {
      await conCarga(leer, 'Marcando…', () => marcarLeidas([Number(leer.dataset.leer)]));
      return;
    }
    const ver = e.target.closest('[data-ver-fecha]');
    if (ver) {
      const noti = estado.notificaciones.find((n) => n.id === Number(ver.dataset.noti));
      if (noti && !noti.leida) marcarLeidas([noti.id]);
      await conCarga(ver, 'Abriendo…', () => verEnReservas(ver.dataset.verFecha));
      notificar(`Reservas del ${formatoFecha(ver.dataset.verFecha)}.`, 'info');
    }
  });

  // Mesas
  $('nueva-mesa').addEventListener('click', () => abrirDialogoMesa());
  $('form-mesa').addEventListener('submit', guardarMesa);
  $('tabla-mesas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (boton.dataset.accion === 'alternar') alternarMesa(id, boton);
    if (boton.dataset.accion === 'editar') abrirDialogoMesa(estado.mesas.find((m) => m.id === id));
    if (boton.dataset.accion === 'borrar') borrarMesa(id, boton);
  });

  // Horarios
  $('tabla-horarios').addEventListener('input', actualizarTurnos);
  $('duracion-slot').addEventListener('change', actualizarTurnos);
  $('guardar-horarios').addEventListener('click', guardarHorarios);

  // Reservas
  ['filtro-fecha', 'filtro-mesa', 'filtro-estado'].forEach((id) => $(id).addEventListener('change', cargarReservas));
  $('filtros-reservas').addEventListener('submit', (e) => e.preventDefault());
  $('limpiar-filtros').addEventListener('click', async (e) => {
    $('filtro-fecha').value = '';
    $('filtro-mesa').value = '';
    $('filtro-estado').value = '';
    await conCarga(e.currentTarget, 'Cargando…', cargarReservas);
    notificar('Mostrando todas las reservas.', 'info');
  });
  $('tabla-reservas').addEventListener('change', (e) => {
    if (e.target.matches('select[data-reserva]')) cambiarEstadoReserva(e.target);
  });

  // Carta
  $('nuevo-plato').addEventListener('click', () => abrirDialogoPlato());
  $('plato-descripcion').addEventListener('input', () => {
    $('contador-desc').textContent = $('plato-descripcion').value.length;
  });
  // Campos numéricos: solo dígitos (evita "e", "-", "." y pegar texto)
  ['plato-precio', 'mesa-capacidad'].forEach((id) => {
    $(id).addEventListener('input', () => {
      const limpio = $(id).value.replace(/\D/g, '');
      if ($(id).value !== limpio) $(id).value = limpio;
    });
  });
  $('mesa-nombre').addEventListener('input', () => {
    const campo = $('mesa-nombre');
    const limpio = campo.value.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ #-]/g, '').slice(0, 20);
    if (campo.value !== limpio) campo.value = limpio;
  });
  $('form-plato').addEventListener('submit', guardarPlato);
  $('tabla-platos').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (boton.dataset.accion === 'alternar') alternarPlato(id, boton);
    if (boton.dataset.accion === 'editar') abrirDialogoPlato(estado.platos.find((p) => p.id === id));
    if (boton.dataset.accion === 'borrar') borrarPlato(id, boton);
  });

  // Botones "Cancelar" de los diálogos
  document.querySelectorAll('.dialogo').forEach((dialogo) => {
    dialogo.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar]') || e.target === dialogo) dialogo.close();
    });
  });
}

/* ----------------------------------------------------------
   Inicio: si ya hay una sesión de administrador, entrar directo
   ---------------------------------------------------------- */

async function iniciar() {
  registrarEventos();
  const { data } = await db.auth.getSession();
  if (data.session && (await esAdministrador())) {
    await mostrarPanel(data.session);
  } else {
    if (data.session) await db.auth.signOut();
    mostrarLogin();
  }
}

iniciar();
