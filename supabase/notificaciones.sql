-- ==========================================================
-- Konys Pizza – Notificaciones para el administrador
-- Ejecutar después de gestion_reservas.sql.
--
-- Un trigger en reservas registra cada reserva nueva, modificada o
-- cancelada por un cliente. Los cambios que hace el propio
-- administrador desde el panel no generan notificación.
-- ==========================================================

create table public.notificaciones (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('nueva', 'modificada', 'cancelada')),
  reserva_id bigint references public.reservas (id) on delete set null,
  -- Copia de los datos al momento del evento (no cambia si luego se edita la reserva)
  datos      jsonb not null,
  leida      boolean not null default false,
  creado_en  timestamptz not null default now()
);

create index notificaciones_creado_idx on public.notificaciones (creado_en desc);
create index notificaciones_no_leidas_idx on public.notificaciones (leida) where not leida;
create index notificaciones_reserva_idx on public.notificaciones (reserva_id);

alter table public.notificaciones enable row level security;

create policy "Admin ve notificaciones" on public.notificaciones
  for select to authenticated using ((select public.es_admin()));
create policy "Admin marca notificaciones" on public.notificaciones
  for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "Admin borra notificaciones" on public.notificaciones
  for delete to authenticated using ((select public.es_admin()));

create or replace function public.notificar_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo  text;
  v_mesa  text;
  v_datos jsonb;
begin
  -- Los cambios del administrador no se le notifican a él mismo
  if public.es_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tipo := 'nueva';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then
    v_tipo := 'cancelada';
  elsif (new.fecha, new.hora_inicio, new.num_personas) is distinct from (old.fecha, old.hora_inicio, old.num_personas) then
    v_tipo := 'modificada';
  else
    return new;
  end if;

  select nombre into v_mesa from public.mesas where id = new.mesa_id;

  v_datos := jsonb_build_object(
    'codigo', new.codigo,
    'cliente_nombre', new.cliente_nombre,
    'mesa', v_mesa,
    'fecha', new.fecha,
    'hora_inicio', to_char(new.hora_inicio, 'HH24:MI'),
    'num_personas', new.num_personas
  );
  if v_tipo = 'modificada' then
    v_datos := v_datos || jsonb_build_object(
      'antes', jsonb_build_object(
        'fecha', old.fecha,
        'hora_inicio', to_char(old.hora_inicio, 'HH24:MI'),
        'num_personas', old.num_personas
      )
    );
  end if;

  insert into public.notificaciones (tipo, reserva_id, datos) values (v_tipo, new.id, v_datos);
  return new;
end;
$$;

revoke execute on function public.notificar_reserva() from public, anon, authenticated;

create trigger reservas_notificar
  after insert or update on public.reservas
  for each row execute function public.notificar_reserva();

-- Notificaciones en tiempo real para el panel (Supabase Realtime respeta RLS)
alter publication supabase_realtime add table public.notificaciones;
