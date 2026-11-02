/* =============================================================================
   Control de obra: el punto de encuentro de los departamentos.
   -----------------------------------------------------------------------------
   · Presupuestos (ingeniería de costos) ya vive en apu.Presupuesto_*.
   · Obra / residencia  → apu.Control_Avances         (cantidad ejecutada por concepto)
   · Compras / finanzas → apu.Control_Avances.CostoReal (costo real imputado al concepto)
   · Almacén            → apu.Control_Consumos        (salidas reales de material)
   Todas las capturas llevan Departamento, Usuario y fecha: se sabe quién reportó qué.
   Las funciones fn_Analisis* y las vistas vw_BI_* son la fuente única para el tablero
   de la aplicación, Power BI, Excel o cualquier herramienta de análisis.
   Ejecutar después de 01, 02 y 03.
   ========================================================================== */
SET NOCOUNT ON;
GO

CREATE TABLE apu.Departamentos (
    DepartamentoId tinyint      NOT NULL CONSTRAINT PK_Departamentos PRIMARY KEY,
    Nombre         nvarchar(40) NOT NULL CONSTRAINT UQ_Departamentos_Nombre UNIQUE
);
INSERT apu.Departamentos VALUES (1, N'Presupuestos'), (2, N'Obra'), (3, N'Almacén'), (4, N'Compras'), (5, N'Finanzas'), (6, N'Dirección');

CREATE TABLE apu.Control_Avances (
    AvanceId           int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Control_Avances PRIMARY KEY,
    PresupuestoId      int            NOT NULL,
    PartidaId          int            NOT NULL,
    Fecha              date           NOT NULL,
    CantidadEjecutada  decimal(19,6)  NOT NULL CONSTRAINT DF_CA_Cantidad DEFAULT (0),
    CostoReal          decimal(19,2)  NOT NULL CONSTRAINT DF_CA_Costo DEFAULT (0),
    DepartamentoId     tinyint        NOT NULL CONSTRAINT FK_CA_Departamento REFERENCES apu.Departamentos (DepartamentoId),
    Usuario            nvarchar(80)   NOT NULL CONSTRAINT DF_CA_Usuario DEFAULT (SUSER_SNAME()),
    Nota               nvarchar(400)  NULL,
    RegistradoEn       datetime2(0)   NOT NULL CONSTRAINT DF_CA_Registrado DEFAULT (SYSDATETIME()),
    -- la partida pertenece al presupuesto (y el trigger exige que sea un concepto)
    CONSTRAINT FK_CA_Partida FOREIGN KEY (PresupuestoId, PartidaId) REFERENCES apu.Presupuesto_Detalle (PresupuestoId, PartidaId),
    CONSTRAINT CK_CA_Valores CHECK (CantidadEjecutada >= 0 AND CostoReal >= 0 AND (CantidadEjecutada > 0 OR CostoReal > 0))
);
CREATE INDEX IX_CA_Presupuesto ON apu.Control_Avances (PresupuestoId, PartidaId) INCLUDE (CantidadEjecutada, CostoReal, Fecha);

CREATE TABLE apu.Control_Consumos (
    ConsumoId       int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Control_Consumos PRIMARY KEY,
    PresupuestoId   int            NOT NULL CONSTRAINT FK_CC_Presupuesto REFERENCES apu.Presupuesto_Encabezado (PresupuestoId),
    InsumoId        int            NOT NULL,
    MaterialTipoId  AS CAST(1 AS tinyint) PERSISTED,
    Fecha           date           NOT NULL,
    Cantidad        decimal(19,6)  NOT NULL CONSTRAINT CK_CC_Cantidad CHECK (Cantidad > 0),
    DepartamentoId  tinyint        NOT NULL CONSTRAINT FK_CC_Departamento REFERENCES apu.Departamentos (DepartamentoId),
    Usuario         nvarchar(80)   NOT NULL CONSTRAINT DF_CC_Usuario DEFAULT (SUSER_SNAME()),
    Referencia      nvarchar(60)   NULL,           -- vale de salida, remisión
    RegistradoEn    datetime2(0)   NOT NULL CONSTRAINT DF_CC_Registrado DEFAULT (SYSDATETIME()),
    -- sólo materiales: el consumo de mano de obra y equipo se mide por el avance
    CONSTRAINT FK_CC_Material FOREIGN KEY (InsumoId, MaterialTipoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId)
);
CREATE INDEX IX_CC_Presupuesto ON apu.Control_Consumos (PresupuestoId, InsumoId) INCLUDE (Cantidad, Fecha);
GO

CREATE OR ALTER TRIGGER apu.trg_Control_Avances_Concepto ON apu.Control_Avances
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted i JOIN apu.Presupuesto_Detalle d ON d.PresupuestoId = i.PresupuestoId AND d.PartidaId = i.PartidaId
                WHERE d.TipoPartida <> 3)
        THROW 50030, N'El avance se reporta sobre conceptos de obra, no sobre capítulos', 1;
END;
GO

/* ---------------------------------------------------------------------------
   Análisis por concepto (mismas fórmulas que ObraClara.Apu.Domain.Analisis):
   EV = min(ejecutado, presupuestado) × CD · CPI = EV / costo real
   costo proyectado = real + (presupuestado − ejecutado)⁺ × CD / CPI
   Requiere el presupuesto calculado (usp_CalcularPresupuesto).
   --------------------------------------------------------------------------- */
CREATE OR ALTER FUNCTION apu.fn_AnalisisConceptos (@PresupuestoId int)
RETURNS TABLE
AS
RETURN
    SELECT d.PresupuestoId, d.PartidaId, d.Clave, i.Clave AS ConceptoClave, i.Descripcion, u.Clave AS Unidad,
           d.Cantidad AS CantidadPresupuestada, a.Ejecutado AS CantidadEjecutada,
           d.PrecioUnitario, d.CostoDirectoUnitario,
           d.Importe AS Venta, x.CostoPresupuestado, x.ValorGanado, a.CostoReal, x.Cpi,
           y.CostoProyectado,
           d.Importe - x.CostoPresupuestado AS MargenPresupuestado,
           d.Importe - y.CostoProyectado AS MargenProyectado,
           x.CostoPresupuestado - y.CostoProyectado AS Variacion,
           CASE WHEN a.Ejecutado > d.Cantidad THEN a.Ejecutado - d.Cantidad ELSE 0 END AS CantidadFueraDeAlcance,
           CASE WHEN a.Ejecutado > d.Cantidad THEN (a.Ejecutado - d.Cantidad) * d.PrecioUnitario ELSE 0 END AS ImporteFueraDeAlcance,
           CASE WHEN d.Cantidad > 0 THEN a.Ejecutado / d.Cantidad END AS PctAvance
      FROM apu.Presupuesto_Detalle d
      JOIN apu.Insumos i ON i.InsumoId = d.InsumoId
      JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId
     CROSS APPLY (SELECT ISNULL(SUM(c.CantidadEjecutada), 0) AS Ejecutado, ISNULL(SUM(c.CostoReal), 0) AS CostoReal
                    FROM apu.Control_Avances c WHERE c.PresupuestoId = d.PresupuestoId AND c.PartidaId = d.PartidaId) a
     CROSS APPLY (SELECT d.Cantidad * d.CostoDirectoUnitario AS CostoPresupuestado,
                         CASE WHEN a.Ejecutado < d.Cantidad THEN a.Ejecutado ELSE d.Cantidad END * d.CostoDirectoUnitario AS ValorGanado,
                         CASE WHEN d.Cantidad > a.Ejecutado THEN d.Cantidad - a.Ejecutado ELSE 0 END * d.CostoDirectoUnitario AS Restante) b
     CROSS APPLY (SELECT b.CostoPresupuestado, b.ValorGanado, b.Restante,
                         CASE WHEN a.CostoReal > 0 AND b.ValorGanado > 0
                              THEN CONVERT(decimal(19,8), b.ValorGanado / a.CostoReal) ELSE 1 END AS Cpi) x
     -- restante / CPI escrito como restante × real / ganado para no perder precisión
     CROSS APPLY (SELECT a.CostoReal + CASE WHEN a.CostoReal > 0 AND x.ValorGanado > 0
                                            THEN x.Restante * a.CostoReal / x.ValorGanado ELSE x.Restante END AS CostoProyectado) y
     WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida = 3;
GO

/* Desperdicio por material: consumo real vs. lo que el avance justifica (con y sin merma). */
CREATE OR ALTER FUNCTION apu.fn_AnalisisDesperdicio (@PresupuestoId int)
RETURNS TABLE
AS
RETURN
    WITH Ejecutado AS (
        SELECT d.InsumoId, SUM(c.CantidadEjecutada) AS Cantidad
          FROM apu.Control_Avances c
          JOIN apu.Presupuesto_Detalle d ON d.PresupuestoId = c.PresupuestoId AND d.PartidaId = c.PartidaId
         WHERE c.PresupuestoId = @PresupuestoId
         GROUP BY d.InsumoId
        HAVING SUM(c.CantidadEjecutada) > 0
    ), Explosion AS (
        SELECT e.InsumoId AS NodoId, CONVERT(decimal(28,10), e.Cantidad) AS ConMerma, CONVERT(decimal(28,10), e.Cantidad) AS SinMerma
          FROM Ejecutado e
        UNION ALL
        SELECT a.HijoId, CONVERT(decimal(28,10), x.ConMerma * a.CantidadEfectiva),
               CONVERT(decimal(28,10), x.SinMerma * a.CantidadEfectiva / (1 + a.TasaMerma))
          FROM Explosion x JOIN apu.APU_Detalle a ON a.PadreId = x.NodoId
    ), Teorico AS (
        SELECT x.NodoId AS InsumoId, SUM(x.SinMerma) AS TeoricoSinMerma, SUM(x.ConMerma) AS PermitidoConMerma
          FROM Explosion x JOIN apu.Insumos i ON i.InsumoId = x.NodoId
         WHERE i.TipoInsumoId = 1
         GROUP BY x.NodoId
    ), Real AS (
        SELECT InsumoId, SUM(Cantidad) AS Real FROM apu.Control_Consumos WHERE PresupuestoId = @PresupuestoId GROUP BY InsumoId
    )
    SELECT i.InsumoId, i.Clave, i.Descripcion, u.Clave AS Unidad, i.CostoDirecto AS CostoUnitario,
           ISNULL(t.TeoricoSinMerma, 0) AS TeoricoSinMerma, ISNULL(t.PermitidoConMerma, 0) AS PermitidoConMerma,
           ISNULL(r.Real, 0) AS Real,
           ISNULL(r.Real, 0) - ISNULL(t.PermitidoConMerma, 0) AS Excedente,
           (ISNULL(r.Real, 0) - ISNULL(t.PermitidoConMerma, 0)) * i.CostoDirecto AS ImporteExcedente
      FROM Teorico t
      FULL JOIN Real r ON r.InsumoId = t.InsumoId
      JOIN apu.Insumos i ON i.InsumoId = COALESCE(t.InsumoId, r.InsumoId)
      JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId;
GO

/* ---------------------------------------------------------------------------
   Vistas para Power BI / Excel (Datos → Obtener datos → SQL Server). Cubren todos
   los presupuestos; el filtro por obra se hace en la herramienta.
   --------------------------------------------------------------------------- */
CREATE OR ALTER VIEW apu.vw_BI_Conceptos
AS
    SELECT e.Clave AS Obra, e.Nombre AS NombreObra, a.*
      FROM apu.Presupuesto_Encabezado e
     CROSS APPLY apu.fn_AnalisisConceptos(e.PresupuestoId) a;
GO

CREATE OR ALTER VIEW apu.vw_BI_Desperdicio
AS
    SELECT e.PresupuestoId, e.Clave AS Obra, e.Nombre AS NombreObra, d.*
      FROM apu.Presupuesto_Encabezado e
     CROSS APPLY apu.fn_AnalisisDesperdicio(e.PresupuestoId) d;
GO

/* Serie de tiempo: avance y costo real acumulados por semana y concepto (curvas S). */
CREATE OR ALTER VIEW apu.vw_BI_AvanceSemanal
AS
    SELECT e.Clave AS Obra, d.Clave AS Partida, i.Descripcion AS Concepto,
           DATEADD(day, 1 - DATEPART(weekday, c.Fecha), c.Fecha) AS Semana,
           SUM(c.CantidadEjecutada) AS CantidadEjecutada, SUM(c.CostoReal) AS CostoReal,
           SUM(c.CantidadEjecutada * d.CostoDirectoUnitario) AS ValorGanado,
           SUM(c.CantidadEjecutada * d.PrecioUnitario) AS VentaEjecutada
      FROM apu.Control_Avances c
      JOIN apu.Presupuesto_Encabezado e ON e.PresupuestoId = c.PresupuestoId
      JOIN apu.Presupuesto_Detalle d ON d.PresupuestoId = c.PresupuestoId AND d.PartidaId = c.PartidaId
      JOIN apu.Insumos i ON i.InsumoId = d.InsumoId
     GROUP BY e.Clave, d.Clave, i.Descripcion, DATEADD(day, 1 - DATEPART(weekday, c.Fecha), c.Fecha);
GO

/* Bitácora de capturas por departamento: quién alimentó qué y cuándo. */
CREATE OR ALTER VIEW apu.vw_BI_Capturas
AS
    SELECT N'Avance' AS Tipo, c.PresupuestoId, c.Fecha, dp.Nombre AS Departamento, c.Usuario, c.RegistradoEn
      FROM apu.Control_Avances c JOIN apu.Departamentos dp ON dp.DepartamentoId = c.DepartamentoId
    UNION ALL
    SELECT N'Consumo', c.PresupuestoId, c.Fecha, dp.Nombre, c.Usuario, c.RegistradoEn
      FROM apu.Control_Consumos c JOIN apu.Departamentos dp ON dp.DepartamentoId = c.DepartamentoId;
GO

/* Datos de ejemplo (mismos que CatalogoDemo.CrearControl): dos cortes de obra. */
INSERT apu.Control_Avances (PresupuestoId, PartidaId, Fecha, CantidadEjecutada, CostoReal, DepartamentoId, Usuario) VALUES
    (1, 2, '2026-09-07', 60,  16000, 2, N'residente'), (1, 2, '2026-09-14', 25,  8500,  2, N'residente'),
    (1, 5, '2026-09-21', 80,  37000, 2, N'residente'), (1, 5, '2026-09-28', 60,  29000, 2, N'residente'),
    (1, 7, '2026-10-05', 300, 60000, 2, N'residente'), (1, 7, '2026-10-12', 160, 32000, 2, N'residente');
INSERT apu.Control_Consumos (PresupuestoId, InsumoId, Fecha, Cantidad, DepartamentoId, Usuario, Referencia) VALUES
    (1, 1, '2026-09-30', 4.00, 3, N'almacen', N'VS-101'), (1, 1, '2026-10-14', 4.10, 3, N'almacen', N'VS-118'),
    (1, 2, '2026-10-14', 19.80, 3, N'almacen', N'VS-119'), (1, 3, '2026-09-10', 6.20, 3, N'almacen', N'VS-090'),
    (1, 4, '2026-10-14', 5.60, 3, N'almacen', N'VS-120'), (1, 5, '2026-09-28', 8350, 3, N'almacen', N'VS-104');
GO
