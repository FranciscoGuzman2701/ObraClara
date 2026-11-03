/* =============================================================================
   Contabilidad por dimensiones (una base por empresa).
   -----------------------------------------------------------------------------
   · Una sola cuenta por concepto contable (501-01-001 Sueldos y salarios): el
     PROYECTO es una columna del movimiento, no una subcuenta. Los saldos "crecen
     horizontalmente": por proyecto, por unidad de negocio (zona, tipo de obra) o
     de toda la empresa, sobre la misma cuenta.
   · Las jerarquías se deducen de la clave (columnas calculadas):
       cuentas   501-01-001 → 501-01-000 → 501-00-000 → 500-000-000
       unidades  100-001-002 → 100-001 → 100
   · Reglas en la base: cuenta afectable, proyecto obligatorio donde la cuenta lo
     exige, póliza cuadrada.
   Ejecutar después de 01–03 (y 05 si se usa control de obra).
   ========================================================================== */
SET NOCOUNT ON;
GO
IF SCHEMA_ID(N'cont') IS NULL EXEC(N'CREATE SCHEMA cont');
GO

/* Clave sin segmentos finales en cero: 501-01-000 → 501-01, 500-000-000 → 500 (enlaza anchos distintos). */
CREATE OR ALTER FUNCTION cont.fn_NormalizarCuenta (@Clave nvarchar(30))
RETURNS nvarchar(30) WITH SCHEMABINDING
AS
BEGIN
    DECLARE @s nvarchar(30) = LTRIM(RTRIM(@Clave)), @p int;
    WHILE CHARINDEX(N'-', @s) > 0
    BEGIN
        SET @p = LEN(@s) - CHARINDEX(N'-', REVERSE(@s)) + 1;          -- posición del último guion
        IF SUBSTRING(@s, @p + 1, 30) LIKE N'%[1-9]%' BREAK;
        SET @s = LEFT(@s, @p - 1);
    END;
    RETURN @s;
END;
GO

/* Padre (normalizado): quita el último segmento; una cuenta de mayor (501) tiene por padre su género (500). */
CREATE OR ALTER FUNCTION cont.fn_PadreCuenta (@Clave nvarchar(30))
RETURNS nvarchar(30) WITH SCHEMABINDING
AS
BEGIN
    DECLARE @n nvarchar(30) = cont.fn_NormalizarCuenta(@Clave);
    IF CHARINDEX(N'-', @n) > 0 RETURN LEFT(@n, LEN(@n) - CHARINDEX(N'-', REVERSE(@n)));
    IF LEN(@n) < 2 OR SUBSTRING(@n, 2, 30) NOT LIKE N'%[1-9]%' RETURN NULL;
    RETURN LEFT(@n, 1) + REPLICATE(N'0', LEN(@n) - 1);
END;
GO

CREATE OR ALTER FUNCTION cont.fn_PadreUnidad (@Clave nvarchar(40))
RETURNS nvarchar(40) WITH SCHEMABINDING
AS
BEGIN
    DECLARE @r nvarchar(40) = REVERSE(@Clave);
    DECLARE @p int = CHARINDEX(N'-', @r);
    RETURN CASE WHEN @p = 0 THEN NULL ELSE LEFT(@Clave, LEN(@Clave) - @p) END;
END;
GO

CREATE TABLE cont.CuentasContables (
    Clave              nvarchar(30)  NOT NULL CONSTRAINT PK_CuentasContables PRIMARY KEY,
    Nombre             nvarchar(200) NOT NULL,
    Naturaleza         tinyint       NOT NULL CONSTRAINT CK_Cuentas_Naturaleza CHECK (Naturaleza IN (1, 2)),  -- 1 deudora, 2 acreedora
    Afectable          bit           NOT NULL,
    CodigoAgrupadorSat nvarchar(10)  NULL,
    RequiereProyecto   bit           NOT NULL CONSTRAINT DF_Cuentas_ReqProy DEFAULT (0),
    ClaveNormal AS cont.fn_NormalizarCuenta(Clave) PERSISTED NOT NULL,
    Padre AS cont.fn_PadreCuenta(Clave) PERSISTED,
    CONSTRAINT UQ_Cuentas_ClaveNormal UNIQUE (ClaveNormal),
    CONSTRAINT CK_Cuentas_Proyecto CHECK (RequiereProyecto = 0 OR Afectable = 1)
);
CREATE INDEX IX_Cuentas_Padre ON cont.CuentasContables (Padre);
-- los movimientos apuntan a la clave tal como está en el catálogo

CREATE TABLE cont.UnidadesNegocio (
    Clave        nvarchar(40)  NOT NULL CONSTRAINT PK_UnidadesNegocio PRIMARY KEY,
    Descripcion  nvarchar(120) NOT NULL,
    Padre AS cont.fn_PadreUnidad(Clave) PERSISTED,
    Nivel AS (LEN(Clave) - LEN(REPLACE(Clave, N'-', N'')) + 1) PERSISTED,
    CONSTRAINT FK_Unidades_Padre FOREIGN KEY (Padre) REFERENCES cont.UnidadesNegocio (Clave)
);

CREATE TABLE cont.Proyectos (
    Clave          nvarchar(30)  NOT NULL CONSTRAINT PK_Proyectos PRIMARY KEY,
    Nombre         nvarchar(200) NOT NULL,
    UnidadNegocio  nvarchar(40)  NOT NULL CONSTRAINT FK_Proyectos_Unidad REFERENCES cont.UnidadesNegocio (Clave),
    PresupuestoId  int           NULL CONSTRAINT FK_Proyectos_Presupuesto REFERENCES apu.Presupuesto_Encabezado (PresupuestoId)
);

CREATE TABLE cont.Polizas (
    PolizaId   int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Polizas PRIMARY KEY,
    Folio      nvarchar(30)   NOT NULL CONSTRAINT UQ_Polizas_Folio UNIQUE,
    Fecha      date           NOT NULL,
    Concepto   nvarchar(200)  NOT NULL,
    Origen     nvarchar(30)   NOT NULL CONSTRAINT DF_Polizas_Origen DEFAULT (N'Manual')
);

CREATE TABLE cont.Movimientos (
    MovimientoId  bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_Movimientos PRIMARY KEY,
    PolizaId      int            NOT NULL CONSTRAINT FK_Mov_Poliza REFERENCES cont.Polizas (PolizaId) ON DELETE CASCADE,
    Cuenta        nvarchar(30)   NOT NULL CONSTRAINT FK_Mov_Cuenta REFERENCES cont.CuentasContables (Clave),
    Proyecto      nvarchar(30)   NULL CONSTRAINT FK_Mov_Proyecto REFERENCES cont.Proyectos (Clave),
    PartidaId     int            NULL,                       -- concepto del presupuesto (dimensión opcional)
    Cargo         decimal(19,2)  NOT NULL CONSTRAINT DF_Mov_Cargo DEFAULT (0),
    Abono         decimal(19,2)  NOT NULL CONSTRAINT DF_Mov_Abono DEFAULT (0),
    Concepto      nvarchar(200)  NULL,
    CONSTRAINT CK_Mov_CargoAbono CHECK (Cargo >= 0 AND Abono >= 0 AND (Cargo = 0 OR Abono = 0) AND Cargo + Abono > 0)
);
CREATE INDEX IX_Mov_Poliza ON cont.Movimientos (PolizaId);
-- reportes horizontales sobre millones de renglones: índice columnar
CREATE NONCLUSTERED COLUMNSTORE INDEX CS_Movimientos ON cont.Movimientos (PolizaId, Cuenta, Proyecto, Cargo, Abono);
GO

/* Reglas de cada renglón y cuadre de cada póliza afectada (los renglones se insertan juntos). */
CREATE OR ALTER TRIGGER cont.trg_Movimientos_Validar ON cont.Movimientos
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @msg nvarchar(400);
    SELECT TOP (1) @msg = CONCAT(N'La cuenta ', c.Clave, N' es de título; use una subcuenta afectable')
      FROM inserted i JOIN cont.CuentasContables c ON c.Clave = i.Cuenta WHERE c.Afectable = 0;
    IF @msg IS NOT NULL THROW 50040, @msg, 1;

    SELECT TOP (1) @msg = CONCAT(N'La cuenta ', c.Clave, N' ', c.Nombre, N' exige proyecto')
      FROM inserted i JOIN cont.CuentasContables c ON c.Clave = i.Cuenta WHERE c.RequiereProyecto = 1 AND i.Proyecto IS NULL;
    IF @msg IS NOT NULL THROW 50041, @msg, 1;

    SELECT TOP (1) @msg = CONCAT(N'Póliza ', p.Folio, N' descuadrada: cargos ', FORMAT(s.Cargos, 'N2'), N' ≠ abonos ', FORMAT(s.Abonos, 'N2'))
      FROM (SELECT PolizaId FROM inserted UNION SELECT PolizaId FROM deleted) a
      JOIN cont.Polizas p ON p.PolizaId = a.PolizaId
     CROSS APPLY (SELECT ISNULL(SUM(m.Cargo), 0) AS Cargos, ISNULL(SUM(m.Abono), 0) AS Abonos
                    FROM cont.Movimientos m WHERE m.PolizaId = a.PolizaId) s
     WHERE s.Cargos <> s.Abonos;
    IF @msg IS NOT NULL THROW 50042, @msg, 1;
END;
GO

/* Ancestro de una unidad en un nivel (1 = raíz). */
CREATE OR ALTER FUNCTION cont.fn_UnidadEnNivel (@Clave nvarchar(40), @Nivel int)
RETURNS TABLE
AS
RETURN
    WITH Linea AS (
        SELECT u.Clave, u.Padre, u.Nivel FROM cont.UnidadesNegocio u WHERE u.Clave = @Clave
        UNION ALL
        SELECT p.Clave, p.Padre, p.Nivel FROM Linea l JOIN cont.UnidadesNegocio p ON p.Clave = l.Padre
    )
    SELECT TOP (1) l.Clave, u.Descripcion FROM Linea l JOIN cont.UnidadesNegocio u ON u.Clave = l.Clave
     WHERE l.Nivel <= @Nivel ORDER BY l.Nivel DESC;
GO

/* ---------------------------------------------------------------------------
   Saldos por cuenta (incluidas sus cuentas de título) y columna de agrupación:
   @Nivel = 0 → proyecto; 1, 2, 3… → nodo de la unidad de negocio en ese nivel;
   @PorDescripcion = 1 → suma entre ramas por la descripción del nivel
   (toda la "OBRA PUBLICA" del país). Mismas reglas que el dominio C#.
   --------------------------------------------------------------------------- */
CREATE OR ALTER FUNCTION cont.fn_Saldos (@Nivel int, @PorDescripcion bit, @Desde date, @Hasta date)
RETURNS TABLE
AS
RETURN
    WITH Base AS (
        SELECT m.Cuenta, m.Cargo, m.Abono,
               CASE WHEN m.Proyecto IS NULL THEN N'(sin proyecto)'
                    WHEN @Nivel = 0 THEN CONCAT(pr.Clave, N' ', pr.Nombre)
                    WHEN @PorDescripcion = 1 THEN
                         CASE WHEN un.Nivel < @Nivel THEN N'(otras)' ELSE UPPER(LTRIM(RTRIM(u.Descripcion))) END
                    ELSE CONCAT(u.Clave, N' ', u.Descripcion) END AS Columna
          FROM cont.Movimientos m
          JOIN cont.Polizas p ON p.PolizaId = m.PolizaId
          LEFT JOIN cont.Proyectos pr ON pr.Clave = m.Proyecto
          LEFT JOIN cont.UnidadesNegocio un ON un.Clave = pr.UnidadNegocio
         OUTER APPLY cont.fn_UnidadEnNivel(pr.UnidadNegocio, @Nivel) u
         WHERE (@Desde IS NULL OR p.Fecha >= @Desde) AND (@Hasta IS NULL OR p.Fecha <= @Hasta)
    ), Linea AS (                                   -- la cuenta del movimiento y todas sus cuentas de título (por clave normalizada)
        SELECT b.Cuenta AS Origen, cont.fn_NormalizarCuenta(b.Cuenta) AS Normal FROM (SELECT DISTINCT Cuenta FROM Base) b
        UNION ALL
        SELECT l.Origen, cont.fn_PadreCuenta(l.Normal) FROM Linea l WHERE cont.fn_PadreCuenta(l.Normal) IS NOT NULL
    )
    SELECT c.Clave AS Cuenta, c.Nombre, b.Columna,
           SUM(CASE WHEN c.Naturaleza = 1 THEN b.Cargo - b.Abono ELSE b.Abono - b.Cargo END) AS Saldo
      FROM Base b
      JOIN Linea l ON l.Origen = b.Cuenta
      JOIN cont.CuentasContables c ON c.ClaveNormal = l.Normal
     GROUP BY c.Clave, c.Nombre, b.Columna;
GO

/* Balanza horizontal lista para ver: cuentas en renglones, agrupación en columnas (PIVOT dinámico). */
CREATE OR ALTER PROCEDURE cont.usp_BalanzaHorizontal
    @Nivel int = 2, @PorDescripcion bit = 0, @Desde date = NULL, @Hasta date = NULL, @PrefijoCuenta nvarchar(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * INTO #s FROM cont.fn_Saldos(@Nivel, @PorDescripcion, @Desde, @Hasta) OPTION (MAXRECURSION 50);
    IF @PrefijoCuenta IS NOT NULL DELETE #s WHERE Cuenta NOT LIKE @PrefijoCuenta + N'%';
    DECLARE @cols nvarchar(max) = (SELECT STRING_AGG(QUOTENAME(Columna), N',') WITHIN GROUP (ORDER BY Columna)
                                     FROM (SELECT DISTINCT Columna FROM #s) x);
    IF @cols IS NULL BEGIN SELECT CAST(NULL AS nvarchar(30)) AS Cuenta WHERE 1 = 0; RETURN; END;
    DECLARE @sql nvarchar(max) = N'
        SELECT Cuenta, Nombre, ' + @cols + N', Total
          FROM (SELECT s.Cuenta, s.Nombre, s.Columna, s.Saldo, SUM(s.Saldo) OVER (PARTITION BY s.Cuenta) AS Total FROM #s s) d
         PIVOT (SUM(Saldo) FOR Columna IN (' + @cols + N')) p
         ORDER BY Cuenta;';
    EXEC sys.sp_executesql @sql;
END;
GO

/* Para Power BI / Excel: un renglón por movimiento con todas sus dimensiones aplanadas. */
CREATE OR ALTER VIEW cont.vw_BI_Movimientos
AS
    SELECT DB_NAME() AS Empresa, p.Folio, p.Fecha, YEAR(p.Fecha) AS Anio, MONTH(p.Fecha) AS Mes, p.Origen,
           m.Cuenta, c.Nombre AS NombreCuenta, c.CodigoAgrupadorSat,
           LEFT(m.Cuenta, 1) + REPLICATE(N'0', CHARINDEX(N'-', m.Cuenta + N'-') - 2) AS Genero,
           LEFT(m.Cuenta, CHARINDEX(N'-', m.Cuenta + N'-') - 1) AS CuentaMayor,
           m.Proyecto, pr.Nombre AS NombreProyecto, pr.UnidadNegocio,
           n1.Descripcion AS Nivel1, n2.Descripcion AS Nivel2, n3.Descripcion AS Nivel3,
           m.Cargo, m.Abono,
           CASE WHEN c.Naturaleza = 1 THEN m.Cargo - m.Abono ELSE m.Abono - m.Cargo END AS Saldo,
           m.Concepto
      FROM cont.Movimientos m
      JOIN cont.Polizas p ON p.PolizaId = m.PolizaId
      JOIN cont.CuentasContables c ON c.Clave = m.Cuenta
      LEFT JOIN cont.Proyectos pr ON pr.Clave = m.Proyecto
     OUTER APPLY cont.fn_UnidadEnNivel(pr.UnidadNegocio, 1) n1
     OUTER APPLY cont.fn_UnidadEnNivel(pr.UnidadNegocio, 2) n2
     OUTER APPLY cont.fn_UnidadEnNivel(pr.UnidadNegocio, 3) n3;
GO
