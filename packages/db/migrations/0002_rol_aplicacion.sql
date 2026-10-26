-- =============================================================================
-- Rol de aplicación sujeto a RLS.
-- La API se conecta con el usuario dueño del esquema y, en cada transacción,
-- ejecuta:  SET LOCAL ROLE oc_app;  SET LOCAL oc.empresa_id = '<uuid>';
-- Así las políticas de Row Level Security aplican siempre al tráfico de la API,
-- mientras que las migraciones (dueño) no quedan restringidas.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oc_app') THEN
    CREATE ROLE oc_app NOLOGIN;
  END IF;
END $$;

GRANT oc_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA oc TO oc_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA oc TO oc_app;
-- borrados permitidos sólo en tablas de detalle editables en borrador
GRANT DELETE ON oc.requisicion_lineas, oc.oc_lineas, oc.cotizacion_lineas, oc.evidencias TO oc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA oc TO oc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA oc TO oc_app;
-- la auditoría y el libro mayor sólo admiten inserción
REVOKE UPDATE ON oc.mov_presupuestales, oc.auditoria FROM oc_app;

-- obra_miembros y empresa_roles no tienen empresa_id propio: se protegen por usuario
ALTER TABLE oc.obra_miembros ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_obra_miembros ON oc.obra_miembros USING (obra_id IN
  (SELECT id FROM oc.obras WHERE empresa_id = current_setting('oc.empresa_id', true)::uuid));
ALTER TABLE oc.empresa_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_empresa_roles ON oc.empresa_roles
  USING (empresa_id = current_setting('oc.empresa_id', true)::uuid);
