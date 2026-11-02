/* =============================================================================
   Prueba de carga (opcional): catálogo sintético de 40,000 insumos y ~140,000
   renglones de matriz en una base VACÍA (después de 01 y 02, sin 03).
   Mide el recálculo completo y una cascada por cambio de precio.
   ========================================================================== */
SET NOCOUNT ON;
DECLARE @inicio datetime2 = SYSDATETIME();
INSERT apu.UnidadesMedida (Clave, Descripcion) VALUES (N'pza', N'Pieza');
DECLARE @ud smallint = SCOPE_IDENTITY();

-- 20,000 elementales (MAT, MO, EQ con costo capturado)
WITH n AS (SELECT TOP (20000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT apu.Insumos (Clave, Descripcion, UnidadId, TipoInsumoId, PrecioBase)
SELECT CONCAT(N'E', i), N'elemental', @ud, (i % 3) + 1, 1 + ABS(CHECKSUM(i * 7919)) % 5000 FROM n;

-- 4 niveles de 2,000 básicos con 5 componentes del nivel inferior
DECLARE @nivel int = 1;
CREATE TABLE #nivel (Nivel int, InsumoId int PRIMARY KEY);
CREATE TABLE #hijos (r int PRIMARY KEY, InsumoId int NOT NULL);
DECLARE @total int;
INSERT #nivel SELECT 0, InsumoId FROM apu.Insumos;
WHILE @nivel <= 4
BEGIN
    WITH n AS (SELECT TOP (2000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
    INSERT apu.Insumos (Clave, Descripcion, UnidadId, TipoInsumoId, TasaHerramienta)
    OUTPUT @nivel, inserted.InsumoId INTO #nivel
    SELECT CONCAT(N'B', @nivel, N'-', i), N'básico', @ud, 4, 0.03 FROM n;

    TRUNCATE TABLE #hijos;
    INSERT #hijos (r, InsumoId) SELECT ROW_NUMBER() OVER (ORDER BY InsumoId) - 1, InsumoId FROM #nivel WHERE Nivel = @nivel - 1;
    SET @total = @@ROWCOUNT;
    INSERT apu.APU_Detalle (PadreId, HijoId, Cantidad)
    SELECT p.InsumoId, h.InsumoId, MAX(0.1 + (ABS(CHECKSUM(p.InsumoId * 31 + x.k)) % 100) / 10.0)
      FROM #nivel p
     CROSS JOIN (VALUES (1), (2), (3), (4), (5)) x (k)
     CROSS APPLY (SELECT ABS(CHECKSUM(p.InsumoId * 131 + x.k * 977)) % @total AS r) d
      JOIN #hijos h ON h.r = d.r
     WHERE p.Nivel = @nivel
     GROUP BY p.InsumoId, h.InsumoId;
    SET @nivel += 1;
END;

-- 12,000 conceptos con 6–10 componentes de cualquier nivel
WITH n AS (SELECT TOP (12000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT apu.Insumos (Clave, Descripcion, UnidadId, TipoInsumoId, TasaHerramienta, TasaEquipoSeguridad)
SELECT CONCAT(N'C', i), N'concepto', @ud, 5, 0.03, 0.02 FROM n;

TRUNCATE TABLE #hijos;
INSERT #hijos (r, InsumoId) SELECT ROW_NUMBER() OVER (ORDER BY InsumoId) - 1, InsumoId FROM #nivel;
SET @total = @@ROWCOUNT;
INSERT apu.APU_Detalle (PadreId, HijoId, Cantidad)
SELECT c.InsumoId, h.InsumoId, MAX(0.01 + (ABS(CHECKSUM(c.InsumoId * 17 + x.k)) % 50) / 100.0)
  FROM apu.Insumos c
 CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7),(8)) x (k)
 CROSS APPLY (SELECT ABS(CHECKSUM(c.InsumoId * 7 + x.k * 1013)) % @total AS r) d
  JOIN #hijos h ON h.r = d.r
 WHERE c.TipoInsumoId = 5
 GROUP BY c.InsumoId, h.InsumoId;

SELECT (SELECT COUNT(*) FROM apu.Insumos) AS Insumos, (SELECT COUNT(*) FROM apu.APU_Detalle) AS RenglonesMatriz,
       DATEDIFF(millisecond, @inicio, SYSDATETIME()) AS MsCargaConTrigger;

DECLARE @t0 datetime2 = SYSDATETIME();
EXEC apu.usp_RecalcularTodo;
SELECT DATEDIFF(millisecond, @t0, SYSDATETIME()) AS MsRecalculoCompleto;

DECLARE @mat int = (SELECT TOP (1) HijoId FROM apu.APU_Detalle a JOIN apu.Insumos i ON i.InsumoId = a.HijoId
                     WHERE i.TipoInsumoId = 1 GROUP BY HijoId ORDER BY COUNT(*) DESC);
DECLARE @precio decimal(19,6) = (SELECT PrecioBase * 1.1 FROM apu.Insumos WHERE InsumoId = @mat), @n int;
SET @t0 = SYSDATETIME();
EXEC apu.usp_ActualizarPrecioInsumo @InsumoId = @mat, @Precio = @precio, @Recalculados = @n OUTPUT;
SELECT @n AS InsumosRecalculados, DATEDIFF(millisecond, @t0, SYSDATETIME()) AS MsCascada;
