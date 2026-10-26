-- =============================================================================
-- Las vistas se evalúan por defecto con los privilegios de su DUEÑO, y el dueño
-- no está sujeto a RLS: sin esto, una vista de KPIs vería datos de todas las
-- empresas. security_invoker (PG15+) hace que respeten el RLS de quien consulta.
-- =============================================================================
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'oc' LOOP
    EXECUTE format('ALTER VIEW %I.%I SET (security_invoker = true)', v.schemaname, v.viewname);
  END LOOP;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA oc TO oc_app;  -- incluye vistas
