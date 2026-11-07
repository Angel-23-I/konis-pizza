-- ==========================================================
-- Konys Pizza – Consultar, modificar y cancelar una reserva
-- Ejecutar después de validaciones.sql.
--
-- Cada reserva tiene un código corto (ej. K7F2QX) que aparece en el
-- comprobante. Para encontrarla se piden el celular Y el código: solo
-- con el celular, cualquiera que lo conozca podría ver o cambiar la
-- reserva de otra persona.
-- ==========================================================

-- Código de 6 caracteres sin letras ni números confusos (sin 0/O, 1/I/L)
create or replace function public.generar_codigo_reserva()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1), '')
  from generate_series(1, 6);
$$;

alter table public.reservas
  add column codigo text not null default public.generar_codigo_reserva();

alter table public.reservas
  add constraint reservas_codigo_check check (codigo ~ '^[A-Z0-9]{6}$');

create index reservas_contacto_codigo_idx on public.reservas (cliente_contacto, codigo);

-- Valida que la mesa esté activa, la capacidad, la fecha (futura y hasta
-- 30 días) y que la hora sea un turno real. Devuelve la hora de fin.
-- Es interna: no se puede llamar desde la API.
create or replace function public.validar_turno(
  p_mesa_id bigint,
  p_fecha date,
  p_hora_inicio time,
  p_num_personas integer
)
returns time
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mesa    public.mesas%rowtype;
  v_horario public.horarios%rowtype;
  v_ahora   timestamp := now() at time zone 'America/Bogota';
  v_dia     text;
begin
  select * into v_mesa from public.mesas where id = p_mesa_id and activa;
  if not found then
    raise exception 'La mesa no existe o no está disponible.' using errcode = 'KP001';
  end if;

  if p_num_personas is null or p_num_personas < 1 or p_num_personas > v_mesa.capacidad then
    raise exception 'Esta mesa recibe máximo % personas.', v_mesa.capacidad using errcode = 'KP002';
  end if;

  if p_fecha is null or p_hora_inicio is null or (p_fecha + p_hora_inicio) <= v_ahora then
    raise exception 'Elige una fecha y hora futuras.' using errcode = 'KP003';
  end if;

  if p_fecha > v_ahora::date + 30 then
    raise exception 'Solo se puede reservar con hasta 30 días de anticipación.' using errcode = 'KP003';
  end if;

  v_dia := (array['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'])[extract(isodow from p_fecha)::int];

  select * into v_horario
  from public.horarios h
  where h.dia_semana = v_dia
    and h.activo
    and p_hora_inicio >= h.hora_inicio
    and p_hora_inicio + make_interval(mins => h.duracion_slot) <= h.hora_fin
    and (extract(epoch from (p_hora_inicio - h.hora_inicio)) / 60)::int % h.duracion_slot = 0
  limit 1;
  if not found then
    raise exception 'Ese horario no está disponible para reservas.' using errcode = 'KP004';
  end if;

  return p_hora_inicio + make_interval(mins => v_horario.duracion_slot);
end;
$$;

-- Datos de una reserva para mostrarle al cliente
create or replace function public.reserva_a_json(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'codigo', r.codigo,
    'mesa_id', r.mesa_id,
    'mesa', m.nombre,
    'zona', m.zona,
    'capacidad', m.capacidad,
    'fecha', r.fecha,
    'hora_inicio', to_char(r.hora_inicio, 'HH24:MI'),
    'hora_fin', to_char(r.hora_fin, 'HH24:MI'),
    'num_personas', r.num_personas,
    'cliente_nombre', r.cliente_nombre,
    'cliente_contacto', r.cliente_contacto,
    'estado', r.estado
  )
  from public.reservas r
  join public.mesas m on m.id = r.mesa_id
  where r.id = p_id;
$$;

-- Busca la reserva activa (confirmada y futura) por celular + código
create or replace function public.buscar_reserva_cliente(p_contacto text, p_codigo text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contacto text := regexp_replace(coalesce(p_contacto, ''), '\D', '', 'g');
  v_codigo   text := upper(trim(coalesce(p_codigo, '')));
  v_id       bigint;
begin
  if v_contacto !~ '^3[0-9]{9}$' or v_codigo !~ '^[A-Z0-9]{6}$' then
    raise exception 'Revisa el celular (10 dígitos) y el código de 6 caracteres.' using errcode = 'KP009';
  end if;

  select id into v_id
  from public.reservas
  where cliente_contacto = v_contacto
    and codigo = v_codigo
    and estado = 'confirmada'
    and (fecha + hora_inicio) > (now() at time zone 'America/Bogota');

  if v_id is null then
    raise exception 'No encontramos una reserva activa con ese celular y código.' using errcode = 'KP010';
  end if;
  return v_id;
end;
$$;

-- crear_reserva: igual que antes, ahora usando validar_turno y devolviendo el código
create or replace function public.crear_reserva(
  p_mesa_id bigint,
  p_fecha date,
  p_hora_inicio time,
  p_nombre text,
  p_num_personas integer,
  p_contacto text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora    timestamp := now() at time zone 'America/Bogota';
  v_nombre   text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_contacto text := nullif(regexp_replace(coalesce(p_contacto, ''), '\s', '', 'g'), '');
  v_hora_fin time;
  v_id       bigint;
begin
  if length(v_nombre) not between 2 and 50
     or v_nombre !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .''-]*$' then
    raise exception 'Escribe un nombre válido (solo letras, de 2 a 50 caracteres).' using errcode = 'KP006';
  end if;

  if v_contacto is not null and v_contacto !~ '^3[0-9]{9}$' then
    raise exception 'El teléfono debe tener 10 dígitos y empezar por 3.' using errcode = 'KP007';
  end if;

  v_hora_fin := public.validar_turno(p_mesa_id, p_fecha, p_hora_inicio, p_num_personas);

  -- Anti-abuso: máximo 3 reservas activas por teléfono y 2 por nombre en el mismo día
  if v_contacto is not null and (
    select count(*) from public.reservas
    where cliente_contacto = v_contacto and estado = 'confirmada' and fecha >= v_ahora::date
  ) >= 3 then
    raise exception 'Este teléfono ya tiene 3 reservas activas. Escríbenos por WhatsApp si necesitas más.' using errcode = 'KP008';
  end if;

  if (
    select count(*) from public.reservas
    where lower(cliente_nombre) = lower(v_nombre) and fecha = p_fecha and estado = 'confirmada'
  ) >= 2 then
    raise exception 'Ya tienes 2 reservas a tu nombre para ese día.' using errcode = 'KP008';
  end if;

  begin
    insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin)
    values (p_mesa_id, v_nombre, v_contacto, p_num_personas, p_fecha, p_hora_inicio, v_hora_fin)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Ese horario acaba de ser reservado. Elige otro.' using errcode = 'KP005';
  end;

  return public.reserva_a_json(v_id);
end;
$$;

-- Consultar una reserva propia
create or replace function public.buscar_reserva(p_contacto text, p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.reserva_a_json(public.buscar_reserva_cliente(p_contacto, p_codigo));
end;
$$;

-- Cambiar fecha, hora y número de personas (misma mesa)
create or replace function public.modificar_reserva(
  p_contacto text,
  p_codigo text,
  p_fecha date,
  p_hora_inicio time,
  p_num_personas integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       bigint := public.buscar_reserva_cliente(p_contacto, p_codigo);
  v_mesa_id  bigint;
  v_hora_fin time;
begin
  select mesa_id into v_mesa_id from public.reservas where id = v_id;
  v_hora_fin := public.validar_turno(v_mesa_id, p_fecha, p_hora_inicio, p_num_personas);

  begin
    update public.reservas
    set fecha = p_fecha, hora_inicio = p_hora_inicio, hora_fin = v_hora_fin, num_personas = p_num_personas
    where id = v_id;
  exception when exclusion_violation then
    raise exception 'Ese horario acaba de ser reservado. Elige otro.' using errcode = 'KP005';
  end;

  return public.reserva_a_json(v_id);
end;
$$;

-- Cancelar una reserva propia (libera el turno)
create or replace function public.cancelar_reserva(p_contacto text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := public.buscar_reserva_cliente(p_contacto, p_codigo);
begin
  update public.reservas set estado = 'cancelada' where id = v_id;
  return public.reserva_a_json(v_id);
end;
$$;

-- Permisos: las funciones internas no se exponen en la API
revoke execute on function public.generar_codigo_reserva() from public, anon, authenticated;
revoke execute on function public.validar_turno(bigint, date, time, integer) from public, anon, authenticated;
revoke execute on function public.reserva_a_json(bigint) from public, anon, authenticated;
revoke execute on function public.buscar_reserva_cliente(text, text) from public, anon, authenticated;

revoke execute on function public.buscar_reserva(text, text) from public;
revoke execute on function public.modificar_reserva(text, text, date, time, integer) from public;
revoke execute on function public.cancelar_reserva(text, text) from public;
grant execute on function public.buscar_reserva(text, text) to anon, authenticated;
grant execute on function public.modificar_reserva(text, text, date, time, integer) to anon, authenticated;
grant execute on function public.cancelar_reserva(text, text) to anon, authenticated;
