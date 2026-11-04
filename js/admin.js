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
const CATEGORIAS = { pizzas: 'Pizzas', entradas: 'Entradas', postres: 'Postres', bebidas: 'Bebidas' };
const ESTADOS = { confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada' };
const HORARIO_BASE = {
  almuerzo: { hora_inicio: '12:30', hora_fin: '14:30' },
  noche: { hora_inicio: '17:00', hora_fin: '23:00' }
};

const estado = {
  seccion: 'mesas',
  mesas: [],
  horarios: [],
  platos: [],
  editandoMesa: null,
  editandoPlato: null
};

const $ = (id) => document.getElementById(id);

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

let temporizadorAviso;
function avisar(mensaje, esError = false) {
  const aviso = $('aviso-flotante');
  aviso.textContent = mensaje;
  aviso.classList.toggle('error', esError);
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 3500);
}

function errorAmigable(error, porDefecto) {
  console.error(error);
  if (error?.code === '23505') return 'Ya existe un registro con ese nombre.';
  if (error?.code === '23503') return 'No se puede borrar porque tiene reservas asociadas. Mejor desactívala.';
  if (error?.code === '42501') return 'Tu sesión no tiene permisos para este cambio.';
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
  await db.auth.signOut();
  mostrarLogin();
}

/* ----------------------------------------------------------
   Navegación entre secciones
   ---------------------------------------------------------- */

const CARGADORES = {
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

  $('tabla-mesas').innerHTML = estado.mesas.length === 0
    ? filaVacia(5, 'Aún no hay mesas. Crea la primera con “Nueva mesa”.')
    : estado.mesas.map((m) => `
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

async function alternarMesa(id) {
  const mesa = estado.mesas.find((m) => m.id === id);
  const { error } = await escribir(db.from('mesas').update({ activa: !mesa.activa }).eq('id', id));
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
    nombre: $('mesa-nombre').value.trim(),
    zona: document.querySelector('input[name="mesa-zona"]:checked').value,
    capacidad: Number($('mesa-capacidad').value),
    foto_url: $('mesa-foto').value.trim() || null
  };

  const error = $('mesa-error');
  if (!datos.nombre) {
    error.textContent = 'Escribe el nombre o número de la mesa.';
    error.hidden = false;
    return;
  }
  if (!Number.isInteger(datos.capacidad) || datos.capacidad < 1 || datos.capacidad > 30) {
    error.textContent = 'La capacidad debe ser un número entre 1 y 30.';
    error.hidden = false;
    return;
  }
  if (datos.foto_url && !/^https?:\/\//.test(datos.foto_url)) {
    error.textContent = 'La URL de la foto debe empezar con http:// o https://';
    error.hidden = false;
    return;
  }

  const editando = estado.editandoMesa;
  const consulta = editando
    ? db.from('mesas').update(datos).eq('id', editando.id)
    : db.from('mesas').insert(datos);
  const { error: errorDb } = await escribir(consulta);
  if (errorDb) {
    error.textContent = errorAmigable(errorDb, 'No se pudo guardar la mesa.');
    error.hidden = false;
    return;
  }

  $('dialogo-mesa').close();
  avisar(editando ? 'Mesa actualizada.' : 'Mesa creada.');
  await cargarMesas();
}

async function borrarMesa(id) {
  const mesa = estado.mesas.find((m) => m.id === id);
  if (!confirm(`¿Borrar ${mesa.nombre}? Esta acción no se puede deshacer.`)) return;
  const { error } = await escribir(db.from('mesas').delete().eq('id', id));
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

  const boton = $('guardar-horarios');
  boton.disabled = true;
  const { error } = await escribir(db.from('horarios').upsert(filas, { onConflict: 'dia_semana,jornada' }));
  boton.disabled = false;
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

async function cargarReservas() {
  let consulta = db.from('reservas')
    .select('id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado, mesas(nombre, zona)')
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
    $('tabla-reservas').innerHTML = filaVacia(7, 'No se pudieron cargar las reservas.');
    return;
  }

  const confirmadas = data.filter((r) => r.estado === 'confirmada');
  const personas = confirmadas.reduce((suma, r) => suma + r.num_personas, 0);
  $('resumen-reservas').textContent =
    `${data.length} ${data.length === 1 ? 'reserva' : 'reservas'}` +
    (fecha ? ` el ${formatoFecha(fecha)}` : ' en total') +
    ` · ${confirmadas.length} confirmadas · ${personas} personas esperadas`;

  $('tabla-reservas').innerHTML = data.length === 0
    ? filaVacia(7, 'No hay reservas con estos filtros.')
    : data.map((r) => `
      <tr>
        <th scope="row">${escapar(r.cliente_nombre)}</th>
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
  const { error } = await escribir(db.from('reservas').update({ estado: nuevo }).eq('id', id));
  if (error) {
    // 23P01: al volver a "confirmada" el horario ya lo tomó otra reserva
    avisar(error.code === '23P01'
      ? 'No se puede confirmar: ese horario ya tiene otra reserva confirmada.'
      : errorAmigable(error, 'No se pudo cambiar el estado.'), true);
  } else {
    avisar(`Reserva marcada como ${ESTADOS[nuevo].toLowerCase()}.`);
  }
  await cargarReservas();
}

/* ----------------------------------------------------------
   RF-14: carta
   ---------------------------------------------------------- */

async function cargarPlatos() {
  const { data, error } = await db.from('platos').select('*').order('categoria').order('nombre');
  if (error) {
    $('tabla-platos').innerHTML = filaVacia(5, 'No se pudo cargar la carta.');
    return;
  }
  estado.platos = data;
  renderPlatos();
}

function renderPlatos() {
  $('tabla-platos').innerHTML = estado.platos.length === 0
    ? filaVacia(5, 'La carta está vacía. Agrega el primer plato.')
    : estado.platos.map((p) => `
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

async function alternarPlato(id) {
  const plato = estado.platos.find((p) => p.id === id);
  const { error } = await escribir(db.from('platos').update({ disponible: !plato.disponible }).eq('id', id));
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
  $('plato-error').hidden = true;
  $('dialogo-plato').showModal();
  $('plato-nombre').focus();
}

async function guardarPlato(evento) {
  evento.preventDefault();
  const datos = {
    nombre: $('plato-nombre').value.trim(),
    categoria: $('plato-categoria').value,
    descripcion: $('plato-descripcion').value.trim() || null,
    precio: Number($('plato-precio').value),
    disponible: $('plato-disponible').checked
  };

  const error = $('plato-error');
  if (!datos.nombre) {
    error.textContent = 'Escribe el nombre del plato.';
    error.hidden = false;
    return;
  }
  if ($('plato-precio').value === '' || !Number.isInteger(datos.precio) || datos.precio < 0) {
    error.textContent = 'El precio debe ser un número entero en pesos, sin puntos.';
    error.hidden = false;
    return;
  }

  const editando = estado.editandoPlato;
  const consulta = editando
    ? db.from('platos').update(datos).eq('id', editando.id)
    : db.from('platos').insert(datos);
  const { error: errorDb } = await escribir(consulta);
  if (errorDb) {
    error.textContent = errorAmigable(errorDb, 'No se pudo guardar el plato.');
    error.hidden = false;
    return;
  }

  $('dialogo-plato').close();
  avisar(editando ? 'Plato actualizado.' : 'Plato agregado a la carta.');
  await cargarPlatos();
}

async function borrarPlato(id) {
  const plato = estado.platos.find((p) => p.id === id);
  if (!confirm(`¿Borrar "${plato.nombre}" de la carta? Si solo quieres esconderlo, usa el interruptor.`)) return;
  const { error } = await escribir(db.from('platos').delete().eq('id', id));
  if (error) {
    avisar(errorAmigable(error, 'No se pudo borrar el plato.'), true);
    return;
  }
  avisar(`${plato.nombre} fue borrado.`);
  await cargarPlatos();
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

  // Mesas
  $('nueva-mesa').addEventListener('click', () => abrirDialogoMesa());
  $('form-mesa').addEventListener('submit', guardarMesa);
  $('tabla-mesas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (boton.dataset.accion === 'alternar') alternarMesa(id);
    if (boton.dataset.accion === 'editar') abrirDialogoMesa(estado.mesas.find((m) => m.id === id));
    if (boton.dataset.accion === 'borrar') borrarMesa(id);
  });

  // Horarios
  $('tabla-horarios').addEventListener('input', actualizarTurnos);
  $('duracion-slot').addEventListener('change', actualizarTurnos);
  $('guardar-horarios').addEventListener('click', guardarHorarios);

  // Reservas
  ['filtro-fecha', 'filtro-mesa', 'filtro-estado'].forEach((id) => $(id).addEventListener('change', cargarReservas));
  $('filtros-reservas').addEventListener('submit', (e) => e.preventDefault());
  $('limpiar-filtros').addEventListener('click', () => {
    $('filtro-fecha').value = '';
    $('filtro-mesa').value = '';
    $('filtro-estado').value = '';
    cargarReservas();
  });
  $('tabla-reservas').addEventListener('change', (e) => {
    if (e.target.matches('select[data-reserva]')) cambiarEstadoReserva(e.target);
  });

  // Carta
  $('nuevo-plato').addEventListener('click', () => abrirDialogoPlato());
  $('form-plato').addEventListener('submit', guardarPlato);
  $('tabla-platos').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (boton.dataset.accion === 'alternar') alternarPlato(id);
    if (boton.dataset.accion === 'editar') abrirDialogoPlato(estado.platos.find((p) => p.id === id));
    if (boton.dataset.accion === 'borrar') borrarPlato(id);
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
