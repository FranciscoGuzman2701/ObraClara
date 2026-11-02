/* =============================================================================
   ObraClara Precios Unitarios — Vistas, funciones, trigger y procedimientos
   Las fórmulas replican exactamente las del dominio C# (ObraClara.Apu.Domain);
   la prueba de integración compara ambos motores insumo por insumo.
   ========================================================================== */
SET NOCOUNT ON;
GO

/* Aristas del grafo de dependencias de costo: matrices + maquinaria (combustible, aceite, operador) */
CREATE OR ALTER VIEW apu.vw_Dependencias
AS
    SELECT a.PadreId AS InsumoId, a.HijoId AS DependeDeId FROM apu.APU_Detalle a
    UNION ALL SELECT ch.InsumoId, ch.CombustibleInsumoId FROM apu.Insumos_CostoHorario_Detalle ch WHERE ch.CombustibleInsumoId IS NOT NULL
    UNION ALL SELECT ch.InsumoId, ch.LubricanteInsumoId  FROM apu.Insumos_CostoHorario_Detalle ch WHERE ch.LubricanteInsumoId  IS NOT NULL
    UNION ALL SELECT ch.InsumoId, ch.OperadorInsumoId    FROM apu.Insumos_CostoHorario_Detalle ch WHERE ch.OperadorInsumoId    IS NOT NULL;
GO

CREATE OR ALTER VIEW apu.vw_Catalogo
AS
    SELECT i.InsumoId, i.Clave, i.Descripcion, u.Clave AS Unidad, t.Clave AS Tipo, i.TipoInsumoId,
           i.PrecioBase, i.TasaHerramienta, i.TasaEquipoSeguridad,
           i.CostoMaterial, i.CostoManoObra, i.CostoEquipo, i.CostoHerramienta, i.CostoEquipoSeguridad, i.CostoDirecto,
           i.FechaCalculo, i.Activo
      FROM apu.Insumos i
      JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId
      JOIN apu.TiposInsumo t ON t.TipoInsumoId = i.TipoInsumoId;
GO

/* ---------------------------------------------------------------------------
   Matrices: tipos válidos y prevención de referencias circulares.
   Un ciclo hace infinito el cálculo en cascada; se rechaza en el momento de capturarlo.
   --------------------------------------------------------------------------- */
CREATE OR ALTER TRIGGER apu.trg_APU_Detalle_Validar ON apu.APU_Detalle
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    DECLARE @msg nvarchar(400);

    SELECT TOP (1) @msg = CONCAT(N'«', p.Clave, N'» no es compuesto: sólo básicos y conceptos tienen matriz')
      FROM inserted i JOIN apu.Insumos p ON p.InsumoId = i.PadreId WHERE p.TipoInsumoId NOT IN (4, 5);
    IF @msg IS NOT NULL THROW 50001, @msg, 1;

    SELECT TOP (1) @msg = CONCAT(N'«', h.Clave, N'» es un concepto de obra y no puede ser componente; conviértalo en básico')
      FROM inserted i JOIN apu.Insumos h ON h.InsumoId = i.HijoId WHERE h.TipoInsumoId = 5;
    IF @msg IS NOT NULL THROW 50002, @msg, 1;

    -- 1) Filtro barato para cargas masivas: BFS por NODOS (no por caminos) desde todos los hijos
    --    insertados. Si ningún padre insertado es alcanzable, no puede haber ciclo. Es el caso
    --    normal al importar conceptos: un concepto nunca es componente, así que nadie llega a él.
    CREATE TABLE #alcanzados (Id int NOT NULL PRIMARY KEY);
    CREATE TABLE #frontera   (Id int NOT NULL PRIMARY KEY);
    CREATE TABLE #nueva      (Id int NOT NULL PRIMARY KEY);
    INSERT #alcanzados (Id) SELECT DISTINCT HijoId FROM inserted;
    INSERT #frontera (Id) SELECT Id FROM #alcanzados;
    WHILE EXISTS (SELECT 1 FROM #frontera)
      AND NOT EXISTS (SELECT 1 FROM inserted i JOIN #alcanzados a ON a.Id = i.PadreId)
    BEGIN
        TRUNCATE TABLE #nueva;
        INSERT #nueva (Id)
        SELECT DISTINCT a.HijoId
          FROM apu.APU_Detalle a
          JOIN #frontera f ON f.Id = a.PadreId
         WHERE NOT EXISTS (SELECT 1 FROM #alcanzados x WHERE x.Id = a.HijoId);
        INSERT #alcanzados (Id) SELECT Id FROM #nueva;
        TRUNCATE TABLE #frontera;
        INSERT #frontera (Id) SELECT Id FROM #nueva;
    END;
    IF NOT EXISTS (SELECT 1 FROM inserted i JOIN #alcanzados a ON a.Id = i.PadreId) RETURN;

    -- 2) Prueba exacta sólo para las aristas sospechosas: descendientes de cada hijo; si alguno
    --    es el padre de esa misma arista, hay ciclo.
    WITH Sospechosas AS (
        SELECT i.PadreId, i.HijoId FROM inserted i JOIN #alcanzados a ON a.Id = i.PadreId
    ), Descendientes AS (
        SELECT s.PadreId AS Origen, s.HijoId AS Nodo, 1 AS Nivel FROM Sospechosas s
        UNION ALL
        SELECT d.Origen, a.HijoId, d.Nivel + 1
          FROM Descendientes d
          JOIN apu.APU_Detalle a ON a.PadreId = d.Nodo
         WHERE d.Nodo <> d.Origen AND d.Nivel < 100
    )
    SELECT TOP (1) @msg = CONCAT(N'Referencia circular: «', p.Clave, N'» terminaría conteniéndose a sí mismo')
      FROM Descendientes d JOIN apu.Insumos p ON p.InsumoId = d.Origen
     WHERE d.Nodo = d.Origen
    OPTION (MAXRECURSION 200);
    IF @msg IS NOT NULL THROW 50003, @msg, 1;
END;
GO

/* ---------------------------------------------------------------------------
   Pie de precio: CD → indirectos → financiamiento → utilidad → cargos adicionales.
   PU = (CD + I + F + U) / (1 − Σ cargos adicionales), redondeado a DecimalesPrecioUnitario.
   --------------------------------------------------------------------------- */
CREATE OR ALTER FUNCTION apu.fn_PieDePrecio (@CostoDirecto decimal(19,6), @SobrecostoId int)
RETURNS TABLE
AS
RETURN
    SELECT s.SobrecostoId,
           CONVERT(decimal(19,6), @CostoDirecto)                       AS CostoDirecto,
           x.IndOficina                                                AS IndirectoOficinaCentral,
           x.IndCampo                                                  AS IndirectoCampo,
           f.Financiamiento,
           u.Utilidad,
           pu.PrecioSinRedondear * ca.Tasa                             AS CargosAdicionales,
           pu.PrecioSinRedondear,
           ROUND(pu.PrecioSinRedondear, s.DecimalesPrecioUnitario)     AS PrecioUnitario
      FROM apu.Sobrecostos s
     CROSS APPLY (SELECT ISNULL(SUM(c.Tasa), 0) AS Tasa
                    FROM apu.Sobrecostos_CargosAdicionales c WHERE c.SobrecostoId = s.SobrecostoId) ca
     CROSS APPLY (SELECT @CostoDirecto * s.TasaIndirectoOficinaCentral AS IndOficina,
                         @CostoDirecto * s.TasaIndirectoCampo          AS IndCampo) x
     CROSS APPLY (SELECT (@CostoDirecto + x.IndOficina + x.IndCampo) * s.TasaFinanciamiento AS Financiamiento) f
     CROSS APPLY (SELECT (@CostoDirecto + x.IndOficina + x.IndCampo + f.Financiamiento) * s.TasaUtilidad AS Utilidad) u
     CROSS APPLY (SELECT CONVERT(decimal(28,10),
                         (@CostoDirecto + x.IndOficina + x.IndCampo + f.Financiamiento + u.Utilidad) / (1 - ca.Tasa)) AS PrecioSinRedondear) pu
     WHERE s.SobrecostoId = @SobrecostoId;
GO

/* ---------------------------------------------------------------------------
   Recalculo en cascada de abajo hacia arriba.
   1. Afectados = semillas + todo lo que depende de ellas (BFS por la vista de dependencias).
   2. Por niveles: en cada vuelta se calculan los afectados cuyas dependencias ya no están
      pendientes (Kahn). Cada nivel es una sola sentencia por tipo: set-based, sin cursores.
   3. Si quedan pendientes y ninguno está listo, hay un ciclo: se aborta todo.
   Serializado con sp_getapplock para que dos cascadas simultáneas no se pisen.
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE apu.usp_RecalcularCascada
    @Semillas      apu.ListaIds READONLY,
    @Recalculados  int = NULL OUTPUT,
    @Niveles       int = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT, XACT_ABORT ON;
    BEGIN TRANSACTION;
    EXEC sp_getapplock @Resource = N'apu.cascada', @LockMode = N'Exclusive', @LockOwner = N'Transaction';

    CREATE TABLE #pendientes (Id int NOT NULL PRIMARY KEY);
    CREATE TABLE #frontera   (Id int NOT NULL PRIMARY KEY);
    CREATE TABLE #nueva      (Id int NOT NULL PRIMARY KEY);
    CREATE TABLE #listos     (Id int NOT NULL PRIMARY KEY);

    INSERT #pendientes (Id) SELECT s.Id FROM @Semillas s WHERE EXISTS (SELECT 1 FROM apu.Insumos i WHERE i.InsumoId = s.Id);
    INSERT #frontera (Id) SELECT Id FROM #pendientes;

    -- 1. ancestros
    WHILE EXISTS (SELECT 1 FROM #frontera)
    BEGIN
        TRUNCATE TABLE #nueva;
        INSERT #nueva (Id)
        SELECT DISTINCT d.InsumoId
          FROM apu.vw_Dependencias d
          JOIN #frontera f ON f.Id = d.DependeDeId
         WHERE NOT EXISTS (SELECT 1 FROM #pendientes p WHERE p.Id = d.InsumoId);
        INSERT #pendientes (Id) SELECT Id FROM #nueva;
        TRUNCATE TABLE #frontera;
        INSERT #frontera (Id) SELECT Id FROM #nueva;
    END;

    SET @Recalculados = (SELECT COUNT(*) FROM #pendientes);
    SET @Niveles = 0;
    DECLARE @ahora datetime2(0) = SYSDATETIME();

    -- 2. por niveles
    WHILE EXISTS (SELECT 1 FROM #pendientes)
    BEGIN
        TRUNCATE TABLE #listos;
        INSERT #listos (Id)
        SELECT p.Id FROM #pendientes p
         WHERE NOT EXISTS (SELECT 1 FROM apu.vw_Dependencias d JOIN #pendientes q ON q.Id = d.DependeDeId
                            WHERE d.InsumoId = p.Id);
        IF @@ROWCOUNT = 0
            THROW 50003, N'Referencia circular en el catálogo: la cascada no puede resolverse', 1;
        SET @Niveles += 1;

        -- Elementales con costo capturado (MAT, MO sin FSR, EQ sin costo horario)
        UPDATE i SET
            CostoMaterial  = CASE WHEN i.TipoInsumoId = 1 THEN i.PrecioBase ELSE 0 END,
            CostoManoObra  = CASE WHEN i.TipoInsumoId = 2 THEN i.PrecioBase ELSE 0 END,
            CostoEquipo    = CASE WHEN i.TipoInsumoId = 3 THEN i.PrecioBase ELSE 0 END,
            MoPendienteHerramienta = CASE WHEN i.TipoInsumoId = 2 THEN i.PrecioBase ELSE 0 END,
            MoPendienteSeguridad   = CASE WHEN i.TipoInsumoId = 2 THEN i.PrecioBase ELSE 0 END,
            CostoHerramienta = 0, CostoEquipoSeguridad = 0, HerramientaPropia = 0, EquipoSeguridadPropio = 0,
            FechaCalculo = @ahora
          FROM apu.Insumos i JOIN #listos l ON l.Id = i.InsumoId
         WHERE i.TipoInsumoId = 1
            OR (i.TipoInsumoId = 2 AND NOT EXISTS (SELECT 1 FROM apu.Insumos_FSR_Detalle f WHERE f.InsumoId = i.InsumoId))
            OR (i.TipoInsumoId = 3 AND NOT EXISTS (SELECT 1 FROM apu.Insumos_CostoHorario_Detalle c WHERE c.InsumoId = i.InsumoId));

        -- Mano de obra con FSR:  salario real = (Sn·Tp + cuotas) / Tl  ≡  Sn · [Ps·(Tp/Tl) + Tp/Tl]
        UPDATE f SET
            DiasPagados = d.Tp, DiasLaborados = d.Tl, FactorIntegracion = d.Fi, SalarioBaseCotizacion = s.Sbc,
            CuotasAnuales = c.Cuotas,
            Ps  = c.Cuotas / (f.SalarioNominal * d.Tp),
            Fsr = (f.SalarioNominal * d.Tp + c.Cuotas) / (f.SalarioNominal * d.Tl),
            SalarioReal = (f.SalarioNominal * d.Tp + c.Cuotas) / d.Tl
          FROM apu.Insumos_FSR_Detalle f
          JOIN #listos l ON l.Id = f.InsumoId
          JOIN apu.ParametrosFsr p ON p.ParametrosFsrId = f.ParametrosFsrId
         CROSS APPLY (SELECT p.DiasCalendario + p.DiasAguinaldo + p.DiasVacaciones * p.TasaPrimaVacacional AS Tp,
                             p.DiasCalendario - ISNULL((SELECT SUM(n.Dias) FROM apu.ParametrosFsr_DiasNoLaborados n
                                                         WHERE n.ParametrosFsrId = p.ParametrosFsrId), 0) AS Tl,
                             CONVERT(decimal(19,10), (p.DiasCalendario + p.DiasAguinaldo + p.DiasVacaciones * p.TasaPrimaVacacional)
                                                     / p.DiasCalendario) AS Fi) d
         CROSS APPLY (SELECT CASE WHEN f.SalarioNominal * d.Fi < p.TopeSbcEnUmas * p.Uma
                                  THEN f.SalarioNominal * d.Fi ELSE p.TopeSbcEnUmas * p.Uma END AS Sbc) s
         CROSS APPLY (SELECT ISNULL(SUM(x.Importe), 0) AS Cuotas
                        FROM (SELECT q.Tasa * CASE q.BaseCalculo
                                         WHEN 1 THEN s.Sbc * p.DiasCalendario
                                         WHEN 2 THEN p.Uma * p.DiasCalendario
                                         WHEN 3 THEN CASE WHEN s.Sbc > 3 * p.Uma THEN (s.Sbc - 3 * p.Uma) * p.DiasCalendario ELSE 0 END
                                         WHEN 4 THEN f.SalarioNominal * d.Tp END AS Importe
                                FROM apu.ParametrosFsr_Cuotas q WHERE q.ParametrosFsrId = p.ParametrosFsrId) x) c;

        IF EXISTS (SELECT 1 FROM apu.Insumos_FSR_Detalle f JOIN #listos l ON l.Id = f.InsumoId
                    WHERE f.DiasLaborados <= 0 OR f.SalarioReal IS NULL)
            THROW 50004, N'Parámetros de FSR inválidos: los días laborados deben ser positivos', 1;

        UPDATE i SET
            CostoMaterial = 0, CostoEquipo = 0, CostoHerramienta = 0, CostoEquipoSeguridad = 0,
            HerramientaPropia = 0, EquipoSeguridadPropio = 0,
            CostoManoObra = f.SalarioReal, MoPendienteHerramienta = f.SalarioReal, MoPendienteSeguridad = f.SalarioReal,
            FechaCalculo = @ahora
          FROM apu.Insumos i
          JOIN #listos l ON l.Id = i.InsumoId
          JOIN apu.Insumos_FSR_Detalle f ON f.InsumoId = i.InsumoId;

        -- Maquinaria: costo horario (sus dependencias ya están calculadas en niveles anteriores)
        UPDATE ch SET
            Depreciacion     = (v.Vm - v.Vr) / ch.VidaEconomicaHoras,
            Inversion        = (v.Vm + v.Vr) / (2 * ch.HorasEfectivasAnio) * ch.TasaInteresAnual,
            Seguros          = (v.Vm + v.Vr) / (2 * ch.HorasEfectivasAnio) * ch.TasaSeguroAnual,
            Mantenimiento    = ch.CoeficienteMantenimiento * (v.Vm - v.Vr) / ch.VidaEconomicaHoras,
            Combustible      = ISNULL(ch.PotenciaHp * ch.FactorOperacion * ch.CoeficienteCombustible * comb.CostoDirecto, 0),
            Lubricantes      = ISNULL((ch.ConsumoAceiteHora
                                       + CASE WHEN ch.HorasEntreCambios > 0 THEN ch.CapacidadCarterLitros / ch.HorasEntreCambios ELSE 0 END)
                                      * lub.CostoDirecto, 0),
            Llantas          = CASE WHEN ch.ValorLlantas > 0 THEN ch.ValorLlantas / ch.VidaLlantasHoras ELSE 0 END,
            PiezasEspeciales = CASE WHEN ch.ValorPiezasEspeciales > 0 THEN ch.ValorPiezasEspeciales / ch.VidaPiezasHoras ELSE 0 END,
            Operacion        = ISNULL(op.CostoDirecto / ch.HorasEfectivasTurno, 0)
          FROM apu.Insumos_CostoHorario_Detalle ch
          JOIN #listos l ON l.Id = ch.InsumoId
         CROSS APPLY (SELECT ch.PrecioAdquisicion - ch.ValorLlantas - ch.ValorPiezasEspeciales AS Vm,
                             (ch.PrecioAdquisicion - ch.ValorLlantas - ch.ValorPiezasEspeciales) * ch.TasaValorRescate AS Vr) v
          LEFT JOIN apu.Insumos comb ON comb.InsumoId = ch.CombustibleInsumoId
          LEFT JOIN apu.Insumos lub  ON lub.InsumoId  = ch.LubricanteInsumoId
          LEFT JOIN apu.Insumos op   ON op.InsumoId   = ch.OperadorInsumoId;

        UPDATE i SET
            CostoMaterial = 0, CostoManoObra = 0, CostoHerramienta = 0, CostoEquipoSeguridad = 0,
            MoPendienteHerramienta = 0, MoPendienteSeguridad = 0, HerramientaPropia = 0, EquipoSeguridadPropio = 0,
            CostoEquipo = ch.CostoHorario, FechaCalculo = @ahora
          FROM apu.Insumos i
          JOIN #listos l ON l.Id = i.InsumoId
          JOIN apu.Insumos_CostoHorario_Detalle ch ON ch.InsumoId = i.InsumoId;

        -- Compuestos: Σ cantidad efectiva × desglose del hijo; herramienta y seguridad sobre la MO pendiente
        WITH Suma AS (
            SELECT a.PadreId,
                   SUM(a.CantidadEfectiva * h.CostoMaterial)          AS Mat,
                   SUM(a.CantidadEfectiva * h.CostoManoObra)          AS MO,
                   SUM(a.CantidadEfectiva * h.CostoEquipo)            AS Eq,
                   SUM(a.CantidadEfectiva * h.CostoHerramienta)       AS Her,
                   SUM(a.CantidadEfectiva * h.CostoEquipoSeguridad)   AS Seg,
                   SUM(a.CantidadEfectiva * h.MoPendienteHerramienta) AS PendHer,
                   SUM(a.CantidadEfectiva * h.MoPendienteSeguridad)   AS PendSeg
              FROM apu.APU_Detalle a
              JOIN #listos l ON l.Id = a.PadreId
              JOIN apu.Insumos h ON h.InsumoId = a.HijoId
             GROUP BY a.PadreId)
        UPDATE i SET
            CostoMaterial          = ISNULL(s.Mat, 0),
            CostoManoObra          = ISNULL(s.MO, 0),
            CostoEquipo            = ISNULL(s.Eq, 0),
            HerramientaPropia      = ISNULL(s.PendHer, 0) * i.TasaHerramienta,
            EquipoSeguridadPropio  = ISNULL(s.PendSeg, 0) * i.TasaEquipoSeguridad,
            CostoHerramienta       = ISNULL(s.Her, 0) + ISNULL(s.PendHer, 0) * i.TasaHerramienta,
            CostoEquipoSeguridad   = ISNULL(s.Seg, 0) + ISNULL(s.PendSeg, 0) * i.TasaEquipoSeguridad,
            MoPendienteHerramienta = CASE WHEN i.TasaHerramienta > 0 THEN 0 ELSE ISNULL(s.PendHer, 0) END,
            MoPendienteSeguridad   = CASE WHEN i.TasaEquipoSeguridad > 0 THEN 0 ELSE ISNULL(s.PendSeg, 0) END,
            FechaCalculo           = @ahora
          FROM apu.Insumos i
          JOIN #listos l ON l.Id = i.InsumoId
          LEFT JOIN Suma s ON s.PadreId = i.InsumoId
         WHERE i.TipoInsumoId IN (4, 5);

        DELETE p FROM #pendientes p JOIN #listos l ON l.Id = p.Id;
    END;

    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE apu.usp_RecalcularTodo
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @todos apu.ListaIds;
    INSERT @todos (Id) SELECT InsumoId FROM apu.Insumos;
    EXEC apu.usp_RecalcularCascada @Semillas = @todos;
END;
GO

/* Cambio de precio de un insumo elemental + cascada, en una sola transacción. */
CREATE OR ALTER PROCEDURE apu.usp_ActualizarPrecioInsumo
    @InsumoId int,
    @Precio   decimal(19,6),
    @Recalculados int = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT, XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE apu.Insumos SET PrecioBase = @Precio WHERE InsumoId = @InsumoId AND TipoInsumoId IN (1, 2, 3);
    IF @@ROWCOUNT = 0 THROW 50010, N'El insumo no existe o es compuesto (su costo sale de su matriz)', 1;
    DECLARE @s apu.ListaIds;
    INSERT @s (Id) VALUES (@InsumoId);
    EXEC apu.usp_RecalcularCascada @Semillas = @s, @Recalculados = @Recalculados OUTPUT;
    COMMIT;
END;
GO

/* ---------------------------------------------------------------------------
   Presupuesto: PU de venta e importe de cada concepto; capítulos y subcapítulos
   suman los importes (ya redondeados) de sus conceptos descendientes.
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE apu.usp_CalcularPresupuesto
    @PresupuestoId int
AS
BEGIN
    SET NOCOUNT, XACT_ABORT ON;
    DECLARE @sobrecosto int = (SELECT SobrecostoId FROM apu.Presupuesto_Encabezado WHERE PresupuestoId = @PresupuestoId);
    IF @sobrecosto IS NULL THROW 50020, N'Presupuesto inexistente', 1;

    BEGIN TRANSACTION;
    UPDATE d SET
        CostoDirectoUnitario = i.CostoDirecto,
        PrecioUnitario       = pp.PrecioUnitario,
        Importe              = ROUND(d.Cantidad * pp.PrecioUnitario, 2)
      FROM apu.Presupuesto_Detalle d
      JOIN apu.Insumos i ON i.InsumoId = d.InsumoId
     CROSS APPLY apu.fn_PieDePrecio(i.CostoDirecto, @sobrecosto) pp
     WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida = 3;

    WITH Ancestros AS (
        SELECT d.PadrePartidaId AS AncestroId, d.Importe
          FROM apu.Presupuesto_Detalle d
         WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida = 3
        UNION ALL
        SELECT p.PadrePartidaId, a.Importe
          FROM Ancestros a
          JOIN apu.Presupuesto_Detalle p ON p.PresupuestoId = @PresupuestoId AND p.PartidaId = a.AncestroId
         WHERE p.PadrePartidaId IS NOT NULL
    )
    UPDATE d SET Importe = ISNULL(s.Total, 0), CostoDirectoUnitario = NULL, PrecioUnitario = NULL
      FROM apu.Presupuesto_Detalle d
      LEFT JOIN (SELECT AncestroId, SUM(Importe) AS Total FROM Ancestros GROUP BY AncestroId) s ON s.AncestroId = d.PartidaId
     WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida < 3
    OPTION (MAXRECURSION 100);

    UPDATE e SET
        CostoDirecto = (SELECT ROUND(SUM(d.Cantidad * d.CostoDirectoUnitario), 2) FROM apu.Presupuesto_Detalle d
                         WHERE d.PresupuestoId = e.PresupuestoId AND d.TipoPartida = 3),
        Total        = (SELECT ISNULL(SUM(d.Importe), 0) FROM apu.Presupuesto_Detalle d
                         WHERE d.PresupuestoId = e.PresupuestoId AND d.TipoPartida = 3),
        FechaCalculo = SYSDATETIME()
      FROM apu.Presupuesto_Encabezado e WHERE e.PresupuestoId = @PresupuestoId;
    COMMIT;

    -- árbol con importes para la vista de presupuesto
    SELECT d.PartidaId, d.PadrePartidaId, d.TipoPartida, d.Clave, d.Descripcion, d.Orden, d.InsumoId,
           i.Clave AS ConceptoClave, u.Clave AS Unidad, d.Cantidad, d.CostoDirectoUnitario, d.PrecioUnitario, d.Importe
      FROM apu.Presupuesto_Detalle d
      LEFT JOIN apu.Insumos i ON i.InsumoId = d.InsumoId
      LEFT JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId
     WHERE d.PresupuestoId = @PresupuestoId
     ORDER BY d.Clave;
END;
GO

/* ---------------------------------------------------------------------------
   Explosión de insumos: volumen × cantidades efectivas a lo largo de toda la
   cadena de matrices, consolidado por insumo elemental. Resultado 1: insumos;
   resultado 2: herramienta menor, equipo de seguridad y costo directo total.
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE apu.usp_ExplosionInsumos
    @PresupuestoId int
AS
BEGIN
    SET NOCOUNT ON;
    CREATE TABLE #exp (NodoId int NOT NULL, Factor decimal(28,10) NOT NULL);

    WITH Explosion AS (
        SELECT d.InsumoId AS NodoId, CONVERT(decimal(28,10), d.Cantidad) AS Factor
          FROM apu.Presupuesto_Detalle d
         WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida = 3
        UNION ALL
        SELECT a.HijoId, CONVERT(decimal(28,10), e.Factor * a.CantidadEfectiva)
          FROM Explosion e
          JOIN apu.APU_Detalle a ON a.PadreId = e.NodoId
    )
    INSERT #exp (NodoId, Factor) SELECT NodoId, Factor FROM Explosion
    OPTION (MAXRECURSION 100);

    SELECT i.InsumoId, i.Clave, i.Descripcion, u.Clave AS Unidad, t.Clave AS Tipo,
           SUM(e.Factor) AS Cantidad, i.CostoDirecto AS CostoUnitario, SUM(e.Factor) * i.CostoDirecto AS Importe
      FROM #exp e
      JOIN apu.Insumos i ON i.InsumoId = e.NodoId
      JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId
      JOIN apu.TiposInsumo t ON t.TipoInsumoId = i.TipoInsumoId
     WHERE i.TipoInsumoId IN (1, 2, 3)
     GROUP BY i.InsumoId, i.Clave, i.Descripcion, u.Clave, t.Clave, i.TipoInsumoId, i.CostoDirecto
     ORDER BY i.TipoInsumoId, i.Clave;

    SELECT ISNULL(SUM(e.Factor * i.HerramientaPropia), 0)     AS Herramienta,
           ISNULL(SUM(e.Factor * i.EquipoSeguridadPropio), 0) AS EquipoSeguridad,
           (SELECT SUM(d.Cantidad * c.CostoDirecto) FROM apu.Presupuesto_Detalle d JOIN apu.Insumos c ON c.InsumoId = d.InsumoId
             WHERE d.PresupuestoId = @PresupuestoId AND d.TipoPartida = 3) AS CostoDirectoTotal
      FROM #exp e JOIN apu.Insumos i ON i.InsumoId = e.NodoId
     WHERE i.TipoInsumoId IN (4, 5);
END;
GO
