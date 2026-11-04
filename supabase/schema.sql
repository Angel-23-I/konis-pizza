-- ==========================================================
-- Konys Pizza – Esquema de base de datos (Supabase / PostgreSQL)
-- Tablas: mesas, horarios, reservas, platos (sección 10 del documento)
-- ==========================================================

create extension if not exists btree_gist with schema extensions;

-- ----------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------

create table public.mesas (
  id         bigint generated always as identity primary key,
  nombre     text not null unique check (length(trim(nombre)) between 1 and 40),
  zona       text not null check (zona in ('salon', 'terraza')),
  capacidad  integer not null check (capacidad between 1 and 30),
  activa     boolean not null default true,
  foto_url   text,
  creado_en  timestamptz not null default now()
);

create table public.horarios (
  id            bigint generated always as identity primary key,
  dia_semana    text not null check (dia_semana in ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo')),
  jornada       text not null check (jornada in ('almuerzo', 'noche')),
  hora_inicio   time not null,
  hora_fin      time not null,
  duracion_slot integer not null default 60 check (duracion_slot between 15 and 240),
  activo        boolean not null default true,
  unique (dia_semana, jornada),
  check (hora_fin > hora_inicio)
);

create table public.reservas (
  id               bigint generated always as identity primary key,
  mesa_id          bigint not null references public.mesas (id) on delete restrict,
  cliente_nombre   text not null check (length(trim(cliente_nombre)) between 2 and 80),
  cliente_contacto text check (length(cliente_contacto) <= 30),
  num_personas     integer not null check (num_personas >= 1),
  fecha            date not null,
  hora_inicio      time not null,
  hora_fin         time not null,
  estado           text not null default 'confirmada' check (estado in ('confirmada', 'cancelada', 'completada')),
  creado_en        timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  -- Evita la doble reserva: dos reservas confirmadas de la misma mesa
  -- no pueden cruzarse en el tiempo (aunque cambie la duración del slot).
  constraint reservas_sin_cruce exclude using gist (
    mesa_id with =,
    tsrange(fecha + hora_inicio, fecha + hora_fin) with &&
  ) where (estado = 'confirmada')
);

create index reservas_fecha_idx on public.reservas (fecha);
create index reservas_mesa_idx on public.reservas (mesa_id);

create table public.platos (
  id          bigint generated always as identity primary key,
  nombre      text not null check (length(trim(nombre)) between 1 and 80),
  categoria   text not null check (categoria in ('pizzas', 'entradas', 'postres', 'bebidas')),
  descripcion text,
  precio      integer not null check (precio >= 0), -- pesos colombianos (COP)
  disponible  boolean not null default true
);

-- Usuarios de Supabase Auth que pueden entrar al panel /admin
create table public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ----------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------

-- ¿El usuario autenticado es administrador?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.administradores where user_id = (select auth.uid())
  );
$$;

-- Horas ocupadas de un día (sin datos personales), para pintar la grilla de slots.
create or replace function public.slots_ocupados(p_fecha date, p_mesa_id bigint default null)
returns table (mesa_id bigint, hora_inicio time, hora_fin time)
language sql
stable
security definer
set search_path = ''
as $$
  select r.mesa_id, r.hora_inicio, r.hora_fin
  from public.reservas r
  where r.fecha = p_fecha
    and r.estado = 'confirmada'
    and (p_mesa_id is null or r.mesa_id = p_mesa_id)
  order by r.mesa_id, r.hora_inicio;
$$;

-- Crea una reserva validando todo en el servidor (RF-05, CU-02):
-- mesa activa, capacidad, fecha futura, slot válido según el horario y slot libre.
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
  v_hora_fin  time;
  v_reserva   public.reservas%rowtype;
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

  v_dia := (array['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'])[extract(isodow from p_fecha)::int];

  -- El slot debe caer dentro de una jornada activa y alinearse con su duración
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
    values (p_mesa_id, trim(p_nombre), nullif(trim(p_contacto), ''), p_num_personas, p_fecha, p_hora_inicio, v_hora_fin)
    returning * into v_reserva;
  exception when exclusion_violation then
    -- Condición de carrera: otro cliente tomó el slot primero
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

revoke execute on function public.es_admin() from public;
revoke execute on function public.slots_ocupados(date, bigint) from public;
revoke execute on function public.crear_reserva(bigint, date, time, text, integer, text) from public;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.slots_ocupados(date, bigint) to anon, authenticated;
grant execute on function public.crear_reserva(bigint, date, time, text, integer, text) to anon, authenticated;

-- ----------------------------------------------------------
-- Seguridad: Row Level Security
-- Público: lee mesas activas, horarios activos y platos disponibles.
-- Las reservas solo se crean con crear_reserva() y solo el admin las ve.
-- Administrador: control total de todas las tablas.
-- ----------------------------------------------------------

alter table public.mesas enable row level security;
alter table public.horarios enable row level security;
alter table public.reservas enable row level security;
alter table public.platos enable row level security;
alter table public.administradores enable row level security;

-- mesas
create policy "Público ve mesas activas" on public.mesas for select to anon using (activa);
create policy "Usuarios ven mesas" on public.mesas for select to authenticated using (activa or (select public.es_admin()));
create policy "Admin crea mesas" on public.mesas for insert to authenticated with check ((select public.es_admin()));
create policy "Admin edita mesas" on public.mesas for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "Admin borra mesas" on public.mesas for delete to authenticated using ((select public.es_admin()));

-- horarios
create policy "Público ve horarios activos" on public.horarios for select to anon using (activo);
create policy "Usuarios ven horarios" on public.horarios for select to authenticated using (activo or (select public.es_admin()));
create policy "Admin crea horarios" on public.horarios for insert to authenticated with check ((select public.es_admin()));
create policy "Admin edita horarios" on public.horarios for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "Admin borra horarios" on public.horarios for delete to authenticated using ((select public.es_admin()));

-- reservas (el público solo reserva mediante crear_reserva)
create policy "Admin ve reservas" on public.reservas for select to authenticated using ((select public.es_admin()));
create policy "Admin edita reservas" on public.reservas for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "Admin borra reservas" on public.reservas for delete to authenticated using ((select public.es_admin()));

-- platos
create policy "Público ve platos disponibles" on public.platos for select to anon using (disponible);
create policy "Usuarios ven platos" on public.platos for select to authenticated using (disponible or (select public.es_admin()));
create policy "Admin crea platos" on public.platos for insert to authenticated with check ((select public.es_admin()));
create policy "Admin edita platos" on public.platos for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "Admin borra platos" on public.platos for delete to authenticated using ((select public.es_admin()));

create policy "Cada admin ve su registro" on public.administradores
  for select to authenticated using (user_id = (select auth.uid()));
