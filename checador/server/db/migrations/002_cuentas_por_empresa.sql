-- =============================================================================
-- Alta de usuarios por empresa sin dar al rol de aplicación acceso a la tabla
-- de cuentas (contraseñas). Estas funciones corren con los permisos de su
-- dueño (SECURITY DEFINER) y sólo hacen lo justo.
-- =============================================================================
SET search_path = checador, public;

/** Devuelve la cuenta del correo; si no existe la crea con la contraseña dada. */
CREATE FUNCTION cuenta_para_alta(p_email text, p_nombre text, p_password text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = checador, public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM cuentas WHERE lower(email) = lower(trim(p_email));
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Es una cuenta nueva: asigne una contraseña de mínimo 8 caracteres';
  END IF;
  INSERT INTO cuentas(email, nombre, password_hash)
  VALUES (lower(trim(p_email)), trim(p_nombre), crypt(p_password, gen_salt('bf', 10)))
  RETURNING id INTO v;
  RETURN v;
END $$;

/** Nombre y correo de las cuentas con acceso a la empresa de la sesión. */
CREATE FUNCTION usuarios_empresa()
RETURNS TABLE (cuenta_id uuid, nombre text, email text, rol rol_empresa, trabajador_id uuid, activa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = checador, public AS $$
  SELECT m.cuenta_id, c.nombre, c.email, m.rol, m.trabajador_id, m.activa
    FROM membresias m JOIN cuentas c ON c.id = m.cuenta_id
   WHERE m.empresa_id = current_setting('app.empresa_id', true)::uuid
$$;

REVOKE ALL ON FUNCTION cuenta_para_alta(text, text, text), usuarios_empresa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cuenta_para_alta(text, text, text), usuarios_empresa() TO checador_app;
