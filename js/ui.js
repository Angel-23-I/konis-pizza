/* ==========================================================
   Componentes de interfaz compartidos (cliente y panel)
   - confirmar(): diálogo de confirmación propio (reemplaza confirm())
   - notificar(): mensajes flotantes de éxito, error o información
   - conCarga(): pone un botón en estado "cargando" mientras dura una acción
   Todo se construye con el DOM y textContent: nada de HTML con datos.
   ========================================================== */

const ICONOS_UI = {
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>',
  cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
  peligro: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pregunta: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17v.5"/>'
};

function iconoUI(nombre, tamano = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', tamano);
  svg.setAttribute('height', tamano);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONOS_UI[nombre]; // trazos fijos, no datos del usuario
  return svg;
}

/* ----------------------------------------------------------
   Diálogo de confirmación
   ---------------------------------------------------------- */

let dialogoConfirmar;

function crearDialogoConfirmar() {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo dialogo-confirmar';
  dialogo.setAttribute('aria-labelledby', 'confirmar-titulo');
  dialogo.setAttribute('aria-describedby', 'confirmar-mensaje');

  const caja = document.createElement('div');
  caja.className = 'confirmar-caja';

  const icono = document.createElement('span');
  icono.className = 'confirmar-icono';

  const titulo = document.createElement('h2');
  titulo.id = 'confirmar-titulo';

  const mensaje = document.createElement('p');
  mensaje.id = 'confirmar-mensaje';

  const botones = document.createElement('div');
  botones.className = 'dialogo-botones';
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'btn btn-secundario';
  cancelar.dataset.respuesta = 'no';
  const aceptar = document.createElement('button');
  aceptar.type = 'button';
  aceptar.dataset.respuesta = 'si';
  botones.append(cancelar, aceptar);

  caja.append(icono, titulo, mensaje, botones);
  dialogo.append(caja);
  document.body.append(dialogo);
  return dialogo;
}

// Uso: if (await confirmar({ titulo, mensaje, textoConfirmar: 'Sí, borrar', peligro: true })) { ... }
function confirmar({ titulo, mensaje, textoConfirmar = 'Aceptar', textoCancelar = 'Cancelar', peligro = false }) {
  dialogoConfirmar ??= crearDialogoConfirmar();
  const dialogo = dialogoConfirmar;
  const icono = dialogo.querySelector('.confirmar-icono');
  icono.className = `confirmar-icono${peligro ? ' peligro' : ''}`;
  icono.replaceChildren(iconoUI(peligro ? 'peligro' : 'pregunta', 26));
  dialogo.querySelector('#confirmar-titulo').textContent = titulo;
  dialogo.querySelector('#confirmar-mensaje').textContent = mensaje;
  const cancelar = dialogo.querySelector('[data-respuesta="no"]');
  const aceptar = dialogo.querySelector('[data-respuesta="si"]');
  cancelar.textContent = textoCancelar;
  aceptar.textContent = textoConfirmar;
  aceptar.className = `btn ${peligro ? 'btn-peligro-solido' : 'btn-primario'}`;

  return new Promise((resolver) => {
    // Responde con el primer evento que llegue (clic, Esc o cierre) y una sola vez:
    // no depende solo del evento "close", que algunos navegadores retrasan.
    let resuelto = false;
    const terminar = (respuesta) => {
      if (resuelto) return;
      resuelto = true;
      dialogo.removeEventListener('click', alHacerClic);
      dialogo.removeEventListener('cancel', alCancelar);
      dialogo.removeEventListener('close', alCerrar);
      if (dialogo.open) dialogo.close(respuesta ? 'si' : 'no');
      resolver(respuesta);
    };
    const alHacerClic = (evento) => {
      const boton = evento.target.closest('[data-respuesta]');
      if (boton) terminar(boton.dataset.respuesta === 'si');
      else if (evento.target === dialogo) terminar(false); // clic en el fondo
    };
    const alCancelar = () => terminar(false); // tecla Esc
    const alCerrar = () => terminar(dialogo.returnValue === 'si');
    dialogo.addEventListener('click', alHacerClic);
    dialogo.addEventListener('cancel', alCancelar);
    dialogo.addEventListener('close', alCerrar);
    dialogo.returnValue = 'no';
    dialogo.showModal();
    // En acciones destructivas el foco empieza en "Cancelar"
    (peligro ? cancelar : aceptar).focus();
  });
}

/* ----------------------------------------------------------
   Mensajes flotantes (toasts)
   ---------------------------------------------------------- */

function contenedorNotificaciones() {
  let contenedor = document.getElementById('notificaciones-flotantes');
  if (!contenedor) {
    contenedor = document.createElement('div');
    contenedor.id = 'notificaciones-flotantes';
    contenedor.className = 'notificaciones-flotantes';
    document.body.append(contenedor);
  }
  return contenedor;
}

// tipo: 'ok' | 'error' | 'info'
function notificar(mensaje, tipo = 'ok') {
  const aviso = document.createElement('div');
  aviso.className = `toast ${tipo}`;
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  const texto = document.createElement('span');
  texto.textContent = mensaje;

  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'toast-cerrar';
  cerrar.setAttribute('aria-label', 'Cerrar mensaje');
  cerrar.append(iconoUI('cerrar', 16));

  aviso.append(iconoUI(tipo), texto, cerrar);
  contenedorNotificaciones().append(aviso);

  const quitar = () => {
    aviso.classList.add('saliendo');
    setTimeout(() => aviso.remove(), 250);
  };
  cerrar.addEventListener('click', quitar);
  setTimeout(quitar, tipo === 'error' ? 6000 : 3500);
}

/* ----------------------------------------------------------
   Botones con estado de carga
   ---------------------------------------------------------- */

// Deshabilita el botón, muestra un indicador y el texto dado mientras corre accion().
// Devuelve lo que devuelva accion(). Evita dobles clics.
async function conCarga(boton, textoCargando, accion) {
  if (!boton || boton.dataset.cargando) return undefined;
  const contenidoOriginal = [...boton.childNodes].map((n) => n.cloneNode(true));
  const estabaDeshabilitado = boton.disabled;
  boton.dataset.cargando = 'si';
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  const indicador = document.createElement('span');
  indicador.className = 'indicador-carga';
  indicador.setAttribute('aria-hidden', 'true');
  if (textoCargando) boton.replaceChildren(indicador, document.createTextNode(` ${textoCargando}`));
  else boton.replaceChildren(indicador);
  try {
    return await accion();
  } finally {
    if (boton.isConnected) {
      boton.replaceChildren(...contenidoOriginal);
      boton.disabled = estabaDeshabilitado;
      boton.removeAttribute('aria-busy');
      delete boton.dataset.cargando;
    }
  }
}

/* ----------------------------------------------------------
   Paginación (10 filas por página)
   ---------------------------------------------------------- */

const FILAS_POR_PAGINA = 10;

// Devuelve los elementos de la página pedida (ajustada al rango válido)
function paginar(lista, pagina, porPagina = FILAS_POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const inicio = (actual - 1) * porPagina;
  return {
    items: lista.slice(inicio, inicio + porPagina),
    pagina: actual,
    paginas,
    total: lista.length,
    desde: lista.length ? inicio + 1 : 0,
    hasta: Math.min(inicio + porPagina, lista.length)
  };
}

// Números visibles: 1 … 4 5 6 … 12
function numerosDePagina(actual, paginas) {
  const numeros = new Set([1, paginas, actual - 1, actual, actual + 1]);
  const lista = [...numeros].filter((n) => n >= 1 && n <= paginas).sort((a, b) => a - b);
  return lista.flatMap((n, i) => (i > 0 && n - lista[i - 1] > 1 ? ['…', n] : [n]));
}

// Dibuja los controles en el contenedor; alCambiar(pagina) se llama al elegir otra página.
// Con una sola página solo muestra el conteo.
function renderPaginacion(contenedor, info, alCambiar, nombre = 'elementos') {
  if (!contenedor) return;
  contenedor.replaceChildren();
  if (info.total === 0) return;

  // nombre puede ser ['reserva', 'reservas'] para usar el singular cuando hay uno solo
  if (Array.isArray(nombre)) nombre = info.total === 1 ? nombre[0] : nombre[1];
  const resumen = document.createElement('p');
  resumen.className = 'paginacion-resumen';
  resumen.textContent = info.paginas > 1
    ? `Mostrando ${info.desde}–${info.hasta} de ${info.total} ${nombre}`
    : `${info.total} ${nombre}`;
  contenedor.append(resumen);
  if (info.paginas <= 1) return;

  const lista = document.createElement('div');
  lista.className = 'paginacion-botones';

  const boton = (texto, pagina, etiqueta, actual = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `paginacion-boton${actual ? ' actual' : ''}`;
    b.textContent = texto;
    b.setAttribute('aria-label', etiqueta);
    if (actual) b.setAttribute('aria-current', 'page');
    b.disabled = pagina < 1 || pagina > info.paginas || actual;
    b.addEventListener('click', () => alCambiar(pagina));
    return b;
  };

  lista.append(boton('Anterior', info.pagina - 1, 'Página anterior'));
  numerosDePagina(info.pagina, info.paginas).forEach((n) => {
    if (n === '…') {
      const separador = document.createElement('span');
      separador.className = 'paginacion-separador';
      separador.setAttribute('aria-hidden', 'true');
      separador.textContent = '…';
      lista.append(separador);
    } else {
      lista.append(boton(String(n), n, `Página ${n}`, n === info.pagina));
    }
  });
  lista.append(boton('Siguiente', info.pagina + 1, 'Página siguiente'));
  contenedor.append(lista);
}
