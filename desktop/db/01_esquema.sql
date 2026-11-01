/* =============================================================================
   ObraClara Precios Unitarios — Esquema SQL Server (2019+)
   -----------------------------------------------------------------------------
   Convenciones
   · Esquema [apu]. Importes decimal(19,6); coeficientes decimal(19,8);
     tasas decimal(9,6) como FRACCIÓN (0.03 = 3 %).
   · Subtipos (FSR de mano de obra, costo horario de maquinaria) con FK compuesta
     (InsumoId, TipoInsumoId) + columna de tipo fija: es imposible colgar un FSR
     de un material o un costo horario de un concreto.
   · Insumos guarda el DESGLOSE del costo directo (material, MO, equipo,
     herramienta, seguridad); CostoDirecto es columna calculada persistida.
   · APU_Detalle es el grafo de matrices. Lo protegen el trigger
     trg_APU_Detalle_Validar (tipos y ciclos) y los índices para recorrerlo
     hacia abajo (PK clúster por padre) y hacia arriba (IX por hijo).
   Ejecutar en orden: 01_esquema.sql, 02_programabilidad.sql, 03_datos_ejemplo.sql
   ========================================================================== */
SET NOCOUNT ON;
GO
IF SCHEMA_ID(N'apu') IS NULL EXEC(N'CREATE SCHEMA apu');
GO

/* ---------------------------------------------------------------- catálogos */
CREATE TABLE apu.UnidadesMedida (
    UnidadId     smallint      IDENTITY(1,1) NOT NULL CONSTRAINT PK_UnidadesMedida PRIMARY KEY,
    Clave        nvarchar(10)  NOT NULL CONSTRAINT UQ_UnidadesMedida_Clave UNIQUE,
    Descripcion  nvarchar(60)  NOT NULL
);

CREATE TABLE apu.TiposInsumo (
    TipoInsumoId tinyint       NOT NULL CONSTRAINT PK_TiposInsumo PRIMARY KEY,
    Clave        char(3)       NOT NULL CONSTRAINT UQ_TiposInsumo_Clave UNIQUE,
    Descripcion  nvarchar(60)  NOT NULL,
    EsCompuesto  bit           NOT NULL,
    CONSTRAINT CK_TiposInsumo_Valores CHECK (
        (TipoInsumoId = 1 AND Clave = 'MAT' AND EsCompuesto = 0) OR
        (TipoInsumoId = 2 AND Clave = 'MO'  AND EsCompuesto = 0) OR
        (TipoInsumoId = 3 AND Clave = 'EQ'  AND EsCompuesto = 0) OR
        (TipoInsumoId = 4 AND Clave = 'BAS' AND EsCompuesto = 1) OR
        (TipoInsumoId = 5 AND Clave = 'CON' AND EsCompuesto = 1))
);
INSERT apu.TiposInsumo (TipoInsumoId, Clave, Descripcion, EsCompuesto) VALUES
    (1, 'MAT', N'Material', 0), (2, 'MO', N'Mano de obra', 0), (3, 'EQ', N'Maquinaria y equipo', 0),
    (4, 'BAS', N'Básico / auxiliar', 1), (5, 'CON', N'Concepto de obra', 1);

/* ---------------------------------------------------------------- FSR */
CREATE TABLE apu.ParametrosFsr (
    ParametrosFsrId      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ParametrosFsr PRIMARY KEY,
    Nombre               nvarchar(80)  NOT NULL CONSTRAINT UQ_ParametrosFsr_Nombre UNIQUE,
    DiasCalendario       decimal(5,2)  NOT NULL CONSTRAINT DF_ParametrosFsr_DiasCal DEFAULT (365),
    DiasAguinaldo        decimal(5,2)  NOT NULL CONSTRAINT DF_ParametrosFsr_Aguinaldo DEFAULT (15),
    DiasVacaciones       decimal(5,2)  NOT NULL CONSTRAINT DF_ParametrosFsr_Vacaciones DEFAULT (12),
    TasaPrimaVacacional  decimal(9,6)  NOT NULL CONSTRAINT DF_ParametrosFsr_Prima DEFAULT (0.25),
    Uma                  decimal(19,6) NOT NULL,
    TopeSbcEnUmas        decimal(5,2)  NOT NULL CONSTRAINT DF_ParametrosFsr_Tope DEFAULT (25),
    CONSTRAINT CK_ParametrosFsr_Dias CHECK (DiasCalendario IN (365, 366) AND DiasAguinaldo >= 0 AND DiasVacaciones >= 0),
    CONSTRAINT CK_ParametrosFsr_Tasas CHECK (TasaPrimaVacacional >= 0 AND Uma > 0 AND TopeSbcEnUmas > 0)
);

CREATE TABLE apu.ParametrosFsr_DiasNoLaborados (
    ParametrosFsrId  int           NOT NULL CONSTRAINT FK_FsrDias_Parametros REFERENCES apu.ParametrosFsr (ParametrosFsrId) ON DELETE CASCADE,
    Concepto         nvarchar(80)  NOT NULL,
    Dias             decimal(5,2)  NOT NULL CONSTRAINT CK_FsrDias_Dias CHECK (Dias >= 0),
    CONSTRAINT PK_ParametrosFsr_DiasNoLaborados PRIMARY KEY (ParametrosFsrId, Concepto)
);

/* BaseCalculo: 1 = SBC, 2 = UMA, 3 = excedente de SBC sobre 3 UMA, 4 = salario pagado (nómina) */
CREATE TABLE apu.ParametrosFsr_Cuotas (
    ParametrosFsrId  int           NOT NULL CONSTRAINT FK_FsrCuotas_Parametros REFERENCES apu.ParametrosFsr (ParametrosFsrId) ON DELETE CASCADE,
    Concepto         nvarchar(80)  NOT NULL,
    BaseCalculo      tinyint       NOT NULL CONSTRAINT CK_FsrCuotas_Base CHECK (BaseCalculo BETWEEN 1 AND 4),
    Tasa             decimal(12,8) NOT NULL CONSTRAINT CK_FsrCuotas_Tasa CHECK (Tasa BETWEEN 0 AND 1),   -- primas de riesgo llevan 7 decimales (0.0758875)
    CONSTRAINT PK_ParametrosFsr_Cuotas PRIMARY KEY (ParametrosFsrId, Concepto)
);

/* ---------------------------------------------------------------- insumos */
CREATE TABLE apu.Insumos (
    InsumoId              int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Insumos PRIMARY KEY,
    Clave                 nvarchar(30)   NOT NULL CONSTRAINT UQ_Insumos_Clave UNIQUE,
    Descripcion           nvarchar(400)  NOT NULL,
    UnidadId              smallint       NOT NULL CONSTRAINT FK_Insumos_Unidad REFERENCES apu.UnidadesMedida (UnidadId),
    TipoInsumoId          tinyint        NOT NULL CONSTRAINT FK_Insumos_Tipo REFERENCES apu.TiposInsumo (TipoInsumoId),
    -- MAT: precio puesto en obra; MO sin FSR / EQ sin análisis: costo directo capturado
    PrecioBase            decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_PrecioBase DEFAULT (0),
    TasaHerramienta       decimal(9,6)   NOT NULL CONSTRAINT DF_Insumos_TasaHer DEFAULT (0),
    TasaEquipoSeguridad   decimal(9,6)   NOT NULL CONSTRAINT DF_Insumos_TasaSeg DEFAULT (0),
    -- desglose del costo directo unitario (lo mantienen los procedimientos de cálculo)
    CostoMaterial         decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_CMat DEFAULT (0),
    CostoManoObra         decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_CMO DEFAULT (0),
    CostoEquipo           decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_CEq DEFAULT (0),
    CostoHerramienta      decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_CHer DEFAULT (0),
    CostoEquipoSeguridad  decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_CSeg DEFAULT (0),
    MoPendienteHerramienta decimal(19,6) NOT NULL CONSTRAINT DF_Insumos_PendHer DEFAULT (0),
    MoPendienteSeguridad  decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_PendSeg DEFAULT (0),
    HerramientaPropia     decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_HerProp DEFAULT (0),
    EquipoSeguridadPropio decimal(19,6)  NOT NULL CONSTRAINT DF_Insumos_SegProp DEFAULT (0),
    CostoDirecto AS (CostoMaterial + CostoManoObra + CostoEquipo + CostoHerramienta + CostoEquipoSeguridad) PERSISTED,
    FechaCalculo          datetime2(0)   NULL,
    Activo                bit            NOT NULL CONSTRAINT DF_Insumos_Activo DEFAULT (1),
    Version               rowversion     NOT NULL,
    CONSTRAINT UQ_Insumos_Id_Tipo UNIQUE (InsumoId, TipoInsumoId),       -- destino de las FK de subtipo
    CONSTRAINT CK_Insumos_Precio CHECK (PrecioBase >= 0),
    CONSTRAINT CK_Insumos_Tasas CHECK (TasaHerramienta BETWEEN 0 AND 1 AND TasaEquipoSeguridad BETWEEN 0 AND 1),
    -- herramienta y equipo de seguridad sólo en compuestos; precio base sólo en elementales
    CONSTRAINT CK_Insumos_CargosCompuestos CHECK (TipoInsumoId IN (4, 5) OR (TasaHerramienta = 0 AND TasaEquipoSeguridad = 0)),
    CONSTRAINT CK_Insumos_PrecioElementales CHECK (TipoInsumoId IN (1, 2, 3) OR PrecioBase = 0)
);
-- lecturas masivas del catálogo (grids, búsquedas por tipo) sin tocar el clúster
CREATE INDEX IX_Insumos_Tipo ON apu.Insumos (TipoInsumoId, Clave)
    INCLUDE (Descripcion, UnidadId, CostoDirecto, Activo);

/* Mano de obra: FSR por insumo (salario nominal) sobre parámetros anuales compartidos */
CREATE TABLE apu.Insumos_FSR_Detalle (
    InsumoId              int            NOT NULL CONSTRAINT PK_Insumos_FSR_Detalle PRIMARY KEY,
    TipoInsumoId          AS CAST(2 AS tinyint) PERSISTED,
    ParametrosFsrId       int            NOT NULL CONSTRAINT FK_FsrDetalle_Parametros REFERENCES apu.ParametrosFsr (ParametrosFsrId),
    SalarioNominal        decimal(19,6)  NOT NULL CONSTRAINT CK_FsrDetalle_Salario CHECK (SalarioNominal > 0),
    -- resultados (usp_CalcularFsr)
    DiasPagados           decimal(9,4)   NULL,
    DiasLaborados         decimal(9,4)   NULL,
    FactorIntegracion     decimal(19,10) NULL,
    SalarioBaseCotizacion decimal(19,6)  NULL,
    CuotasAnuales         decimal(19,6)  NULL,
    Ps                    decimal(19,10) NULL,
    Fsr                   decimal(19,10) NULL,
    SalarioReal           decimal(19,6)  NULL,
    CONSTRAINT FK_FsrDetalle_Insumo FOREIGN KEY (InsumoId, TipoInsumoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId) ON DELETE CASCADE
);
CREATE INDEX IX_FsrDetalle_Parametros ON apu.Insumos_FSR_Detalle (ParametrosFsrId);

/* Maquinaria: datos y resultado del costo horario */
CREATE TABLE apu.Insumos_CostoHorario_Detalle (
    InsumoId                 int            NOT NULL CONSTRAINT PK_Insumos_CostoHorario_Detalle PRIMARY KEY,
    TipoInsumoId             AS CAST(3 AS tinyint) PERSISTED,
    PrecioAdquisicion        decimal(19,6)  NOT NULL,
    ValorLlantas             decimal(19,6)  NOT NULL CONSTRAINT DF_CH_Llantas DEFAULT (0),
    ValorPiezasEspeciales    decimal(19,6)  NOT NULL CONSTRAINT DF_CH_Piezas DEFAULT (0),
    TasaValorRescate         decimal(9,6)   NOT NULL,
    VidaEconomicaHoras       decimal(19,4)  NOT NULL,
    HorasEfectivasAnio       decimal(19,4)  NOT NULL,
    TasaInteresAnual         decimal(9,6)   NOT NULL,
    TasaSeguroAnual          decimal(9,6)   NOT NULL,
    CoeficienteMantenimiento decimal(9,6)   NOT NULL,
    PotenciaHp               decimal(19,4)  NOT NULL CONSTRAINT DF_CH_Hp DEFAULT (0),
    FactorOperacion          decimal(9,6)   NOT NULL CONSTRAINT DF_CH_Fo DEFAULT (0),
    CoeficienteCombustible   decimal(19,8)  NOT NULL CONSTRAINT DF_CH_Coef DEFAULT (0),
    CombustibleInsumoId      int            NULL,
    CombustibleTipoId        AS CAST(1 AS tinyint) PERSISTED,
    CapacidadCarterLitros    decimal(19,4)  NOT NULL CONSTRAINT DF_CH_Carter DEFAULT (0),
    HorasEntreCambios        decimal(19,4)  NOT NULL CONSTRAINT DF_CH_Cambios DEFAULT (0),
    ConsumoAceiteHora        decimal(19,8)  NOT NULL CONSTRAINT DF_CH_Aceite DEFAULT (0),
    LubricanteInsumoId       int            NULL,
    LubricanteTipoId         AS CAST(1 AS tinyint) PERSISTED,
    VidaLlantasHoras         decimal(19,4)  NOT NULL CONSTRAINT DF_CH_VidaLlantas DEFAULT (0),
    VidaPiezasHoras          decimal(19,4)  NOT NULL CONSTRAINT DF_CH_VidaPiezas DEFAULT (0),
    OperadorInsumoId         int            NULL,
    OperadorTipoId           AS CAST(2 AS tinyint) PERSISTED,
    HorasEfectivasTurno      decimal(9,4)   NOT NULL CONSTRAINT DF_CH_Turno DEFAULT (8),
    -- resultados (usp_CalcularCostoHorario), $/hora efectiva
    Depreciacion             decimal(19,6)  NULL,
    Inversion                decimal(19,6)  NULL,
    Seguros                  decimal(19,6)  NULL,
    Mantenimiento            decimal(19,6)  NULL,
    Combustible              decimal(19,6)  NULL,
    Lubricantes              decimal(19,6)  NULL,
    Llantas                  decimal(19,6)  NULL,
    PiezasEspeciales         decimal(19,6)  NULL,
    Operacion                decimal(19,6)  NULL,
    CostoHorario AS (Depreciacion + Inversion + Seguros + Mantenimiento + Combustible + Lubricantes + Llantas + PiezasEspeciales + Operacion) PERSISTED,
    CONSTRAINT FK_CH_Insumo      FOREIGN KEY (InsumoId, TipoInsumoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId) ON DELETE CASCADE,
    CONSTRAINT FK_CH_Combustible FOREIGN KEY (CombustibleInsumoId, CombustibleTipoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId),
    CONSTRAINT FK_CH_Lubricante  FOREIGN KEY (LubricanteInsumoId, LubricanteTipoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId),
    CONSTRAINT FK_CH_Operador    FOREIGN KEY (OperadorInsumoId, OperadorTipoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId),
    CONSTRAINT CK_CH_Valores CHECK (
        PrecioAdquisicion > 0 AND ValorLlantas >= 0 AND ValorPiezasEspeciales >= 0
        AND ValorLlantas + ValorPiezasEspeciales < PrecioAdquisicion
        AND TasaValorRescate >= 0 AND TasaValorRescate < 1
        AND VidaEconomicaHoras > 0 AND HorasEfectivasAnio > 0
        AND (ValorLlantas = 0 OR VidaLlantasHoras > 0)
        AND (ValorPiezasEspeciales = 0 OR VidaPiezasHoras > 0)
        AND (CapacidadCarterLitros = 0 OR HorasEntreCambios > 0)
        AND (OperadorInsumoId IS NULL OR HorasEfectivasTurno > 0))
);
-- cascada hacia arriba: ¿qué máquinas dependen de este combustible / aceite / operador?
CREATE INDEX IX_CH_Combustible ON apu.Insumos_CostoHorario_Detalle (CombustibleInsumoId) WHERE CombustibleInsumoId IS NOT NULL;
CREATE INDEX IX_CH_Lubricante  ON apu.Insumos_CostoHorario_Detalle (LubricanteInsumoId)  WHERE LubricanteInsumoId IS NOT NULL;
CREATE INDEX IX_CH_Operador    ON apu.Insumos_CostoHorario_Detalle (OperadorInsumoId)    WHERE OperadorInsumoId IS NOT NULL;

/* Matrices de precio unitario (grafo dirigido acíclico padre → hijo) */
CREATE TABLE apu.APU_Detalle (
    PadreId          int            NOT NULL CONSTRAINT FK_APU_Padre REFERENCES apu.Insumos (InsumoId),
    HijoId           int            NOT NULL CONSTRAINT FK_APU_Hijo  REFERENCES apu.Insumos (InsumoId),
    Cantidad         decimal(19,8)  NOT NULL CONSTRAINT DF_APU_Cantidad DEFAULT (0),
    Rendimiento      decimal(19,8)  NULL,
    TasaMerma        decimal(9,6)   NOT NULL CONSTRAINT DF_APU_Merma DEFAULT (0),
    Orden            smallint       NOT NULL CONSTRAINT DF_APU_Orden DEFAULT (0),
    -- cantidad por unidad del padre: 1/rendimiento o cantidad, más merma
    CantidadEfectiva AS (CONVERT(decimal(19,8),
        CASE WHEN Rendimiento > 0 THEN 1.0 / Rendimiento ELSE Cantidad END * (1 + TasaMerma))) PERSISTED,
    CONSTRAINT PK_APU_Detalle PRIMARY KEY CLUSTERED (PadreId, HijoId),   -- lectura de una matriz = un rango del clúster
    CONSTRAINT CK_APU_NoAutoReferencia CHECK (PadreId <> HijoId),
    CONSTRAINT CK_APU_Cantidad CHECK ((Rendimiento IS NULL AND Cantidad > 0) OR Rendimiento > 0),
    CONSTRAINT CK_APU_Merma CHECK (TasaMerma >= 0 AND TasaMerma < 1)
);
-- recorrido hacia arriba (¿en qué matrices se usa este insumo?) cubierto sin lookups
CREATE INDEX IX_APU_Hijo ON apu.APU_Detalle (HijoId) INCLUDE (PadreId, CantidadEfectiva);

/* ---------------------------------------------------------------- sobrecostos */
CREATE TABLE apu.Sobrecostos (
    SobrecostoId                int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sobrecostos PRIMARY KEY,
    Nombre                      nvarchar(80)   NOT NULL CONSTRAINT UQ_Sobrecostos_Nombre UNIQUE,
    TasaIndirectoOficinaCentral decimal(9,6)   NOT NULL,
    TasaIndirectoCampo          decimal(9,6)   NOT NULL,
    TasaFinanciamiento          decimal(9,6)   NOT NULL,
    TasaUtilidad                decimal(9,6)   NOT NULL,   -- bruta (antes de ISR y PTU)
    DecimalesPrecioUnitario     tinyint        NOT NULL CONSTRAINT DF_Sobrecostos_Dec DEFAULT (2),
    CONSTRAINT CK_Sobrecostos_Tasas CHECK (
        TasaIndirectoOficinaCentral BETWEEN 0 AND 1 AND TasaIndirectoCampo BETWEEN 0 AND 1
        AND TasaFinanciamiento BETWEEN 0 AND 1 AND TasaUtilidad BETWEEN 0 AND 1 AND DecimalesPrecioUnitario <= 6)
);

CREATE TABLE apu.Sobrecostos_CargosAdicionales (
    SobrecostoId  int           NOT NULL CONSTRAINT FK_CargosAd_Sobrecosto REFERENCES apu.Sobrecostos (SobrecostoId) ON DELETE CASCADE,
    Concepto      nvarchar(80)  NOT NULL,
    Tasa          decimal(9,6)  NOT NULL CONSTRAINT CK_CargosAd_Tasa CHECK (Tasa >= 0 AND Tasa < 0.5),
    CONSTRAINT PK_Sobrecostos_CargosAdicionales PRIMARY KEY (SobrecostoId, Concepto)
);

/* ---------------------------------------------------------------- presupuestos */
CREATE TABLE apu.Presupuesto_Encabezado (
    PresupuestoId  int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Presupuesto_Encabezado PRIMARY KEY,
    Clave          nvarchar(30)   NOT NULL CONSTRAINT UQ_Presupuesto_Clave UNIQUE,
    Nombre         nvarchar(200)  NOT NULL,
    Cliente        nvarchar(200)  NULL,
    SobrecostoId   int            NOT NULL CONSTRAINT FK_Presupuesto_Sobrecosto REFERENCES apu.Sobrecostos (SobrecostoId),
    Fecha          date           NOT NULL CONSTRAINT DF_Presupuesto_Fecha DEFAULT (CONVERT(date, SYSDATETIME())),
    Moneda         char(3)        NOT NULL CONSTRAINT DF_Presupuesto_Moneda DEFAULT ('MXN'),
    CostoDirecto   decimal(19,2)  NULL,
    Total          decimal(19,2)  NULL,
    FechaCalculo   datetime2(0)   NULL
);

/* TipoPartida: 1 = capítulo, 2 = subcapítulo, 3 = concepto de obra */
CREATE TABLE apu.Presupuesto_Detalle (
    PartidaId          int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_Presupuesto_Detalle PRIMARY KEY NONCLUSTERED,
    PresupuestoId      int            NOT NULL CONSTRAINT FK_PresDet_Presupuesto REFERENCES apu.Presupuesto_Encabezado (PresupuestoId) ON DELETE CASCADE,
    PadrePartidaId     int            NULL,
    TipoPartida        tinyint        NOT NULL CONSTRAINT CK_PresDet_Tipo CHECK (TipoPartida BETWEEN 1 AND 3),
    Clave              nvarchar(30)   NOT NULL,
    Descripcion        nvarchar(400)  NOT NULL CONSTRAINT DF_PresDet_Desc DEFAULT (N''),
    Orden              int            NOT NULL CONSTRAINT DF_PresDet_Orden DEFAULT (0),
    InsumoId           int            NULL,
    ConceptoTipoId     AS CAST(CASE WHEN TipoPartida = 3 THEN 5 END AS tinyint) PERSISTED,
    Cantidad           decimal(19,6)  NULL,
    -- resultados (usp_CalcularPresupuesto)
    CostoDirectoUnitario decimal(19,6) NULL,
    PrecioUnitario     decimal(19,6)  NULL,
    Importe            decimal(19,2)  NULL,
    CONSTRAINT UQ_PresDet_Presupuesto_Partida UNIQUE (PresupuestoId, PartidaId),
    CONSTRAINT UQ_PresDet_Clave UNIQUE (PresupuestoId, Clave),
    -- el padre pertenece al mismo presupuesto
    CONSTRAINT FK_PresDet_Padre FOREIGN KEY (PresupuestoId, PadrePartidaId) REFERENCES apu.Presupuesto_Detalle (PresupuestoId, PartidaId),
    -- una partida de concepto sólo puede apuntar a un insumo tipo CON
    CONSTRAINT FK_PresDet_Concepto FOREIGN KEY (InsumoId, ConceptoTipoId) REFERENCES apu.Insumos (InsumoId, TipoInsumoId),
    CONSTRAINT CK_PresDet_Concepto CHECK (
        (TipoPartida = 3 AND InsumoId IS NOT NULL AND Cantidad IS NOT NULL AND Cantidad >= 0 AND PadrePartidaId IS NOT NULL)
        OR (TipoPartida < 3 AND InsumoId IS NULL AND Cantidad IS NULL)),
    CONSTRAINT CK_PresDet_Raiz CHECK (PadrePartidaId IS NOT NULL OR TipoPartida = 1)
);
-- el árbol se lee por presupuesto y padre en orden: clúster sobre esa ruta
CREATE CLUSTERED INDEX CX_PresDet_Arbol ON apu.Presupuesto_Detalle (PresupuestoId, PadrePartidaId, Orden);
CREATE INDEX IX_PresDet_Insumo ON apu.Presupuesto_Detalle (InsumoId) INCLUDE (PresupuestoId, Cantidad) WHERE InsumoId IS NOT NULL;

/* ---------------------------------------------------------------- tipos tabla */
CREATE TYPE apu.ListaIds AS TABLE (Id int NOT NULL PRIMARY KEY);
GO
