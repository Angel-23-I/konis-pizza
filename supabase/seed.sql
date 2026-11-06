-- ==========================================================
-- Konys Pizza – Datos de prueba
-- Mesas y horarios de ejemplo y reservas en los próximos días.
-- La carta real se carga con supabase/carta.sql.
-- ==========================================================

insert into public.mesas (nombre, zona, capacidad) values
  ('Mesa 1', 'salon', 2),
  ('Mesa 2', 'salon', 4),
  ('Mesa 3', 'salon', 4),
  ('Mesa 4', 'salon', 6),
  ('Mesa 5', 'terraza', 2),
  ('Mesa 6', 'terraza', 4),
  ('Mesa 7', 'terraza', 6),
  ('Mesa 8', 'terraza', 8);

-- Dos jornadas todos los días, reservas de 60 minutos (RF-11)
insert into public.horarios (dia_semana, jornada, hora_inicio, hora_fin, duracion_slot)
select d.dia, j.jornada, j.inicio, j.fin, 60
from unnest(array['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']) as d(dia)
cross join (values
  ('almuerzo', time '12:30', time '14:30'),
  ('noche',    time '17:00', time '23:00')
) as j(jornada, inicio, fin);

-- Los platos de la carta real están en supabase/carta.sql

-- Reservas de ejemplo para mañana y pasado mañana (hora de Colombia)
insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin)
select m.id, r.nombre, r.contacto, r.personas,
       (now() at time zone 'America/Bogota')::date + r.dias,
       r.inicio, r.inicio + interval '60 minutes'
from (values
  ('Mesa 2', 'Laura Gómez',    '3110000001', 2, 1, time '12:30'),
  ('Mesa 8', 'Familia Díaz',   '3000000002', 7, 1, time '17:00'),
  ('Mesa 1', 'Camila Ortiz',   null,         2, 1, time '18:00'),
  ('Mesa 6', 'Juan Pérez',     '3200000003', 4, 1, time '19:00'),
  ('Mesa 2', 'Sergio Vera',    '3170000004', 3, 1, time '20:00'),
  ('Mesa 7', 'Valentina Rey',  '3010000005', 6, 2, time '21:00'),
  ('Mesa 6', 'María Silva',    null,         3, 2, time '19:00')
) as r(mesa, nombre, contacto, personas, dias, inicio)
join public.mesas m on m.nombre = r.mesa;
