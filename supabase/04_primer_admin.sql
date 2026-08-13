-- =========================================================================
--  CREAR EL PRIMER SUPERADMINISTRADOR
--  Ejecuta esto DESPUÉS de crear el usuario en Authentication → Users
--  (Supabase Dashboard → Authentication → Add user → email + password).
--  Copia el UUID que Supabase le asigna y pégalo abajo.
-- =========================================================================

insert into public.profiles (id, nombre, cargo, role, activo)
values (
  '5ab3c115-6148-42f4-ae0c-92c4d29eb34c',
  'Departamento Administrativo de Planeación',
  'Secretaría de Equidad de Género',
  'superadmin',
  true
);

-- Para crear admins adicionales (no superadmin), repite el proceso con:
-- role = 'admin_equidad'
