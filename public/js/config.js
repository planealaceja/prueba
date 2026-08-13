// =============================================================================
// CONFIGURACIÓN — reemplaza estos dos valores con los de tu proyecto Supabase
// (Project Settings → API). La "anon key" es pública por diseño: la seguridad
// real la dan las políticas RLS y las funciones RPC del backend, no esta clave.
// NUNCA pongas aquí la "service_role key": esa es secreta y no debe usarse
// en el navegador.
// =============================================================================
window.ATLAS_CONFIG = {
  SUPABASE_URL: "https://laeeoaklxdweanafmgfb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZWVvYWtseGR3ZWFuYWZtZ2ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDk0OTQsImV4cCI6MjEwMjIyNTQ5NH0.vLknBAAvrLfbydVHjkgBBFKR5Cy_m-2CONuLSkXEjTc",
  MUNICIPIO_NOMBRE: "Municipio de La Ceja del Tambo",
  MAPA_CENTRO: [6.025, -75.433],   // [lat, lng] — ajusta a tu municipio
  MAPA_ZOOM: 13
};
