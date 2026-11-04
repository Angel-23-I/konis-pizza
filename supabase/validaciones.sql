-- ==========================================================
-- Konys Pizza – Validaciones estrictas (ejecutar después de schema.sql)
-- La base de datos aplica las mismas reglas que los formularios,
-- así no se pueden saltar llamando a la API directamente.
-- ==========================================================

-- reservas: nombre solo letras (2–50), celular colombiano de 10 dígitos que empieza por 3
alter table public.reservas drop constraint reservas_cliente_nombre_check;
alter table public.reservas drop constraint reservas_cliente_contacto_check;
alter table public.reservas drop constraint reservas_num_personas_check;
alter table public.reservas
  add constraint reservas_cliente_nombre_check check (
    length(cliente_nombre) between 2 and 50
    and cliente_nombre ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .''-]*$'
    and cliente_nombre !~ '\s{2,}'
  ),
  add constraint reservas_cliente_contacto_check check (cliente_contacto is null or cliente_contacto ~ '^3[0-9]{9}$'),
  add constraint reservas_num_personas_check check (num_personas between 1 and 30);

-- mesas: nombre corto y sin símbolos raros; foto solo por HTTPS
alter table public.mesas drop constraint mesas_nombre_check;
alter table public.mesas
  add constraint mesas_nombre_check check (
    length(nombre) between 1 and 20
    and nombre ~ '^[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ #-]*$'
  ),
  add constraint mesas_foto_url_check check (
    foto_url is null or (length(foto_url) <= 500 and foto_url ~ '^https://[^[:space:]"''<>`]+$')
  );

-- platos: nombre 2–60, descripción hasta 200 sin < >, precio hasta $1.000.000
alter table public.platos drop constraint platos_nombre_check;
alter table public.platos drop constraint platos_precio_check;
alter table public.platos
  add constraint platos_nombre_check check (
    length(nombre) between 2 and 60
    and nombre ~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .,''&()-]*$'
  ),
  add constraint platos_descripcion_check check (descripcion is null or (length(descripcion) <= 200 and descripcion !~ '[<>]')),
  add constraint platos_precio_check check (precio between 0 and 1000000);

-- crear_reserva: normaliza y valida cada dato con mensajes claros,
-- limita la anticipación a 30 días y frena reservas repetidas.
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
  v_mesa      public.mesas%rowtype;
  v_horario   public.horarios%rowtype;
  v_dia       text;
  v_ahora     timestamp := now() at time zone 'America/Bogota';
  v_nombre    text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_contacto  text := nullif(regexp_replace(coalesce(p_contacto, ''), '\s', '', 'g'), '');
  v_hora_fin  time;
  v_reserva   public.reservas%rowtype;
begin
  if length(v_nombre) not between 2 and 50
     or v_nombre !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .''-]*$' then
    raise exception 'Escribe un nombre válido (solo letras, de 2 a 50 caracteres).' using errcode = 'KP006';
  end if;

  if v_contacto is not null and v_contacto !~ '^3[0-9]{9}$' then
    raise exception 'El teléfono debe tener 10 dígitos y empezar por 3.' using errcode = 'KP007';
  end if;

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

  v_hora_fin := p_hora_inicio + make_interval(mins => v_horario.duracion_slot);

  begin
    insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin)
    values (p_mesa_id, v_nombre, v_contacto, p_num_personas, p_fecha, p_hora_inicio, v_hora_fin)
    returning * into v_reserva;
  exception when exclusion_violation then
    raise exception 'Ese horario acaba de ser reservado. Elige otro.' using errcode = 'KP005';
  end;

  return jsonb_build_object(
    'id', v_reserva.id,
    'mesa', v_mesa.nombre,
    'zona', v_mesa.zona,
    'fecha', v_reserva.fecha,
    'hora_inicio', to_char(v_reserva.hora_inicio, 'HH24:MI'),
    'hora_fin', to_char(v_reserva.hora_fin, 'HH24:MI'),
    'num_personas', v_reserva.num_personas,
    'cliente_nombre', v_reserva.cliente_nombre,
    'estado', v_reserva.estado
  );
end;
$$;
