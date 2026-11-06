-- ==========================================================
-- Konys Pizza – Carta real (tomada de https://soyclubify.com/d/konys)
-- Reemplaza los platos de ejemplo. Ejecutar después de validaciones.sql.
-- Precios en pesos colombianos (COP).
-- ==========================================================

delete from public.platos;

insert into public.platos (nombre, categoria, descripcion, precio) values
  -- Konys pizza (todas traen papitas al horno)
  ('Bukara (Ganadora Pizza Master 2023)', 'pizzas', 'Homenaje a la Ciudad Bonita: carne de hamburguesa jugosa y mermelada de tocineta ahumada en reducción de miel y panela, sobre salsa napolitana.', 29900),
  ('Konys Dulcinea (de temporada)', 'pizzas', 'Nuestra conopizza de temporada.', 29900),
  ('Colombianísima', 'pizzas', 'Carne desmechada, maduritos fritos y maicitos frescos, coronados con un trozo de arepa de maíz.', 29900),
  ('Lasagna', 'pizzas', 'Carne molida sazonada, tocineta ahumada y queso parmesano gratinado en salsa blanca y napolitana.', 29900),
  ('Ikónica', 'pizzas', 'Trozos de nuggets de pollo, jamón ahumado y queso cheddar.', 29900),
  ('Carbonara', 'pizzas', 'Tocineta y jamón ahumados, maíz dulce y queso parmesano sobre salsa blanca cremosa.', 29900),
  ('Hawaiana', 'pizzas', 'Tocineta y jamón ahumados con piña OroMiel: el equilibrio entre dulce y salado.', 27900),
  ('Mexicana', 'pizzas', 'Carne molida sazonada, maíz tierno, pimentón y cebolla caramelizada, con nachos y un toque picante Tex-Mex.', 27900),
  ('Chicken', 'pizzas', 'Trozos de pollo horneado y maíz tierno sobre nuestra clásica salsa napolitana.', 27900),
  ('Veggie', 'pizzas', 'Champiñones frescos, maíz tierno, cebolla caramelizada y queso parmesano.', 27900),
  ('BBQ', 'pizzas', 'Pollo en salsa BBQ con un toque ranchero y cebolla caramelizada.', 27900),
  ('Teriyork', 'pizzas', 'Pollo jugoso, carne molida sazonada, cebolla caramelizada y pimentón fresco.', 27900),
  ('Especial', 'pizzas', 'Pollo marinado, tocineta ahumada y champiñones frescos en salsa napolitana.', 29900),
  ('Carnes (Pepperoni)', 'pizzas', 'Pepperoni picante, cábano y jamón ahumado.', 29900),
  ('Mar & Tierra', 'pizzas', 'Camarones jugosos, pollo marinado, pimentón fresco y maíz tierno.', 30900),
  ('Marinera', 'pizzas', 'Camarón fresco, pulpo tierno y palmito en la salsa especial de la casa.', 30900),
  ('Italianísima', 'pizzas', 'Jamón serrano madurado, tomates asados y un toque de pesto, con queso parmesano.', 31900),
  ('Bondiola', 'pizzas', 'Bondiola de cerdo ahumada, champiñones frescos y queso parmesano sobre salsa napolitana.', 31900),
  ('Combo Amigos x4', 'pizzas', 'Cuatro Konys clásicas, papas al horno (400 g) y cuatro granizados en dos sabores tradicionales.', 142000),
  ('Combo Parche x6', 'pizzas', 'Seis Konys clásicas, papas al horno (600 g) y seis granizados en tres sabores tradicionales.', 210000),

  -- Entradas, desgranados, papas y lasaña
  ('Entrada mini Konitos', 'entradas', 'Cinco mini Konys rellenos de queso gratinado y napolitana. Sabores: hawaiano, pepperoni o solo queso.', 15000),
  ('Nachos enchulados', 'entradas', 'Nachos crocantes con queso rallado, tártara de la casa y piña caramelizada. Para compartir.', 13000),
  ('Desgranado de carne', 'entradas', 'En kono de masa crocante: mazorca, carne desmechada, chorizo santarosano, salsita Konys y mozzarella, con papas al horno.', 38500),
  ('Desgranado de pollo', 'entradas', 'En kono de masa crocante: mazorca, pollo, tocineta ahumada, salsita Konys y mozzarella, con papas al horno.', 37500),
  ('Papas locas', 'entradas', 'Papas al horno sin aceite con chorizo, salchicha llanera, carne de hamburguesa, maicitos, salsas de la casa y queso rallado.', 39000),
  ('Chicken fries mini', 'entradas', 'Papas al horno sin aceite con nuggets de pollo, mozzarella derretido y salsas de la casa.', 22000),
  ('Chorifries mini', 'entradas', 'Papas al horno sin aceite con chorizo artesanal, quesito costeño y salsas de la casa.', 22000),
  ('Salchifries mini', 'entradas', 'Papas al horno sin aceite con salchichas horneadas, quesito costeño y salsas de la casa.', 22000),
  ('Porción de papas', 'entradas', '200 g de papitas fritas sin aceite.', 7900),
  ('Lasaña (sabor del día)', 'entradas', 'Acompañada de papas fritas sin aceite y salsa de la casa.', 31800),

  -- Postres
  ('Copa helado clásica', 'postres', null, 4900),
  ('Copa helado ikónica', 'postres', null, 7900),

  -- Bebidas
  ('Granizado tradicional', 'bebidas', 'Limón, naranja, mandarina, yerbabuena o maracumango.', 9900),
  ('Cerezada', 'bebidas', 'Granizado de cereza.', 12990),
  ('Piña colada (granizado)', 'bebidas', null, 12990),
  ('Limonada de coco', 'bebidas', 'Granizado de limonada de coco.', 12990),
  ('Soda Lulo Fizz', 'bebidas', 'Mermelada de lulo, limón, soda, perlas explosivas de maracuyá y ginger ale.', 12900),
  ('Soda de arándanos', 'bebidas', 'Sirope natural y arándanos frescos, limón, soda y perlas explosivas de cereza.', 12900),
  ('Soda frutos rojos', 'bebidas', 'Sirope natural de frutos rojos, fresa picada, limón, soda y perlas explosivas de cereza.', 12900),
  ('Soda de maracuyá', 'bebidas', 'Sirope natural de maracuyá, limón, soda y perlas explosivas de maracuyá.', 12900),
  ('Limonada de panela', 'bebidas', 'Limonada de panela natural, refrescante.', 7000),
  ('Gaseosa Postobón 400 ml', 'bebidas', null, 6000),
  ('Coca-Cola 400 ml (original o Zero)', 'bebidas', null, 6000),
  ('Jugo Hit 500 ml', 'bebidas', null, 6000),
  ('Agua con o sin gas', 'bebidas', null, 6000);
