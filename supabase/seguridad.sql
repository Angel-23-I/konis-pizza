-- ==========================================================
-- Konys Pizza – Endurecimiento de seguridad (auditoría)
-- Ejecutar después de notificaciones.sql.
--
-- 1. Mínimo privilegio: cada rol solo tiene los permisos de tabla que usa.
--    RLS sigue filtrando filas; esto agrega una segunda capa y bloquea
--    TRUNCATE, que RLS no cubre.
-- 2. Límite de reservas por conexión (5 por hora) contra el llenado masivo.
-- 3. Bloqueo de 15 minutos tras 8 intentos fallidos de celular + código,
--    contra la fuerza bruta del código de reserva.
-- La conexión se identifica con un hash de la IP (cf-connecting-ip):
-- la IP nunca se guarda.
-- ==========================================================

-- ---------- 1. Mínimo privilegio ----------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.mesas, public.horarios, public.platos to anon, authenticated;
grant insert, update, delete on public.mesas, public.horarios, public.platos to authenticated;
grant select, update, delete on public.reservas to authenticated;
grant select, update, delete on public.notificaciones to authenticated;
grant select on public.administradores to authenticated;

-- ---------- Identificador de la conexión ----------
create or replace function public.origen_solicitud()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when ip is null or ip = '' then null
    else encode(extensions.digest('konys:' || ip, 'sha256'), 'hex')
  end
  from (
    select coalesce(
      current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip',
      split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1)
    ) as ip
  ) h;
$$;

alter table public.reservas add column origen text;
create index reservas_origen_idx on public.reservas (origen, creado_en);

-- Intentos fallidos de buscar una reserva (solo los ven las funciones)
create table public.intentos_busqueda (
  id        bigint generated always as identity primary key,
  origen    text not null,
  creado_en timestamptz not null default now()
);
create index intentos_busqueda_origen_idx on public.intentos_busqueda (origen, creado_en);
alter table public.intentos_busqueda enable row level security;
revoke all on public.intentos_busqueda from anon, authenticated;

-- ---------- 3. Identificar la reserva con límite de intentos ----------
-- Devuelve el id o null. No lanza error al no encontrarla para que el
-- intento fallido quede registrado (un error desharía el registro).
create or replace function public.identificar_reserva(p_contacto text, p_codigo text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_origen   text := public.origen_solicitud();
  v_contacto text := regexp_replace(coalesce(p_contacto, ''), '\D', '', 'g');
  v_codigo   text := upper(trim(coalesce(p_codigo, '')));
  v_id       bigint;
begin
  if v_origen is not null and (
    select count(*) from public.intentos_busqueda
    where origen = v_origen and creado_en > now() - interval '15 minutes'
  ) >= 8 then
    raise exception 'Demasiados intentos. Espera 15 minutos o escríbenos por WhatsApp.' using errcode = 'KP012';
  end if;

  if v_contacto !~ '^3[0-9]{9}$' or v_codigo !~ '^[A-Z0-9]{6}$' then
    raise exception 'Revisa el celular (10 dígitos) y el código de 6 caracteres.' using errcode = 'KP009';
  end if;

  select id into v_id
  from public.reservas
  where cliente_contacto = v_contacto
    and codigo = v_codigo
    and estado = 'confirmada'
    and (fecha + hora_inicio) > (now() at time zone 'America/Bogota');

  if v_id is null and v_origen is not null then
    insert into public.intentos_busqueda (origen) values (v_origen);
  end if;
  return v_id;
end;
$$;

-- Respuesta uniforme cuando no se encuentra (sin lanzar error)
create or replace function public.error_no_encontrada()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('error', 'No encontramos una reserva activa con ese celular y código.', 'code', 'KP010');
$$;

drop function public.buscar_reserva(text, text);
create function public.buscar_reserva(p_contacto text, p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint := public.identificar_reserva(p_contacto, p_codigo);
begin
  if v_id is null then
    return public.error_no_encontrada();
  end if;
  return public.reserva_a_json(v_id);
end;
$$;

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
  v_id       bigint := public.identificar_reserva(p_contacto, p_codigo);
  v_mesa_id  bigint;
  v_hora_fin time;
begin
  if v_id is null then
    return public.error_no_encontrada();
  end if;

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

create or replace function public.cancelar_reserva(p_contacto text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := public.identificar_reserva(p_contacto, p_codigo);
begin
  if v_id is null then
    return public.error_no_encontrada();
  end if;
  update public.reservas set estado = 'cancelada' where id = v_id;
  return public.reserva_a_json(v_id);
end;
$$;

-- La función anterior ya no se usa
drop function public.buscar_reserva_cliente(text, text);

-- ---------- 2. crear_reserva con límite por conexión ----------
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
  v_origen   text := public.origen_solicitud();
  v_nombre   text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_contacto text := nullif(regexp_replace(coalesce(p_contacto, ''), '\s', '', 'g'), '');
  v_hora_fin time;
  v_id       bigint;
begin
  if v_origen is not null and (
    select count(*) from public.reservas
    where origen = v_origen and creado_en > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Se hicieron muchas reservas desde esta conexión. Intenta más tarde o escríbenos por WhatsApp.' using errcode = 'KP011';
  end if;

  if length(v_nombre) not between 2 and 50
     or v_nombre !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .''-]*$' then
    raise exception 'Escribe un nombre válido (solo letras, de 2 a 50 caracteres).' using errcode = 'KP006';
  end if;

  if v_contacto is not null and v_contacto !~ '^3[0-9]{9}$' then
    raise exception 'El teléfono debe tener 10 dígitos y empezar por 3.' using errcode = 'KP007';
  end if;

  v_hora_fin := public.validar_turno(p_mesa_id, p_fecha, p_hora_inicio, p_num_personas);

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
    insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, origen)
    values (p_mesa_id, v_nombre, v_contacto, p_num_personas, p_fecha, p_hora_inicio, v_hora_fin, v_origen)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Ese horario acaba de ser reservado. Elige otro.' using errcode = 'KP005';
  end;

  return public.reserva_a_json(v_id);
end;
$$;

-- ---------- Permisos de las funciones ----------
revoke execute on function public.origen_solicitud() from public, anon, authenticated;
revoke execute on function public.identificar_reserva(text, text) from public, anon, authenticated;
revoke execute on function public.error_no_encontrada() from public, anon, authenticated;
revoke execute on function public.buscar_reserva(text, text) from public;
revoke execute on function public.modificar_reserva(text, text, date, time, integer) from public;
revoke execute on function public.cancelar_reserva(text, text) from public;
revoke execute on function public.crear_reserva(bigint, date, time, text, integer, text) from public;
grant execute on function public.buscar_reserva(text, text) to anon, authenticated;
grant execute on function public.modificar_reserva(text, text, date, time, integer) to anon, authenticated;
grant execute on function public.cancelar_reserva(text, text) to anon, authenticated;
grant execute on function public.crear_reserva(bigint, date, time, text, integer, text) to anon, authenticated;
