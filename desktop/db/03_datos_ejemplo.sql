/* =============================================================================
   Datos de ejemplo: catálogo de vivienda y presupuesto "Casa habitación tipo".
   Mismo contenido que ObraClara.Apu.Application.CatalogoDemo (una prueba de
   integración verifica que ambos den los mismos costos). Cuotas ilustrativas.
   ========================================================================== */
SET NOCOUNT, XACT_ABORT ON;
BEGIN TRANSACTION;

INSERT apu.UnidadesMedida (Clave, Descripcion) VALUES
    (N'm3', N'Metro cúbico'), (N'm2', N'Metro cuadrado'), (N'm', N'Metro lineal'), (N'kg', N'Kilogramo'),
    (N'ton', N'Tonelada'), (N'pza', N'Pieza'), (N'lt', N'Litro'), (N'jor', N'Jornada'), (N'hr', N'Hora'),
    (N'lote', N'Lote'), (N'pt', N'Pie tablón');

SET IDENTITY_INSERT apu.ParametrosFsr ON;
INSERT apu.ParametrosFsr (ParametrosFsrId, Nombre, Uma) VALUES (1, N'FSR 2026 (ejemplo)', 113.14);
SET IDENTITY_INSERT apu.ParametrosFsr OFF;

INSERT apu.ParametrosFsr_DiasNoLaborados (ParametrosFsrId, Concepto, Dias) VALUES
    (1, N'Domingos', 52), (1, N'Festivos (LFT art. 74)', 7), (1, N'Vacaciones', 12),
    (1, N'Mal tiempo', 3), (1, N'Costumbre', 2), (1, N'Enfermedad no profesional', 1);

INSERT apu.ParametrosFsr_Cuotas (ParametrosFsrId, Concepto, BaseCalculo, Tasa) VALUES
    (1, N'Riesgo de trabajo (clase V)', 1, 0.0758875),
    (1, N'Enf. y mat. cuota fija', 2, 0.204),
    (1, N'Enf. y mat. excedente 3 UMA', 3, 0.011),
    (1, N'Prestaciones en dinero', 1, 0.007),
    (1, N'Gastos médicos pensionados', 1, 0.0105),
    (1, N'Invalidez y vida', 1, 0.0175),
    (1, N'Guarderías y prest. sociales', 1, 0.01),
    (1, N'Retiro', 1, 0.02),
    (1, N'Cesantía y vejez (tasa de ejemplo)', 1, 0.0315),
    (1, N'INFONAVIT', 1, 0.05),
    (1, N'Impuesto sobre nómina (ejemplo)', 4, 0.03);

DECLARE @u TABLE (Clave nvarchar(10) PRIMARY KEY, Id smallint);
INSERT @u SELECT Clave, UnidadId FROM apu.UnidadesMedida;

SET IDENTITY_INSERT apu.Insumos ON;
INSERT apu.Insumos (InsumoId, Clave, Descripcion, UnidadId, TipoInsumoId, PrecioBase, TasaHerramienta, TasaEquipoSeguridad)
SELECT v.Id, v.Clave, v.Descripcion, u.Id, v.Tipo, v.Precio, v.Her, v.Seg
  FROM (VALUES
    (1,  N'MAT-CEM',    N'Cemento gris CPC 30R',                                  N'ton', 1, 3200.00, 0,    0),
    (2,  N'MAT-ARE',    N'Arena',                                                 N'm3',  1, 380.00,  0,    0),
    (3,  N'MAT-GRA',    N'Grava 3/4"',                                            N'm3',  1, 420.00,  0,    0),
    (4,  N'MAT-AGU',    N'Agua',                                                  N'm3',  1, 35.00,   0,    0),
    (5,  N'MAT-TAB',    N'Tabique rojo recocido 7x14x28',                         N'pza', 1, 3.80,    0,    0),
    (6,  N'MAT-DIE',    N'Diésel',                                                N'lt',  1, 25.80,   0,    0),
    (7,  N'MAT-ACE',    N'Aceite para motor',                                     N'lt',  1, 120.00,  0,    0),
    (20, N'MO-PEON',    N'Peón',                                                  N'jor', 2, 0,       0,    0),
    (21, N'MO-OFAL',    N'Oficial albañil',                                       N'jor', 2, 0,       0,    0),
    (22, N'MO-OPER',    N'Operador de equipo ligero',                             N'jor', 2, 0,       0,    0),
    (30, N'EQ-REV',     N'Revolvedora 1 saco, 8 HP diésel',                       N'hr',  3, 0,       0,    0),
    (40, N'BAS-CUA1',   N'Cuadrilla: 1 oficial albañil + 1 peón',                 N'jor', 4, 0,       0,    0),
    (41, N'BAS-MOR14',  N'Mortero cemento-arena 1:4',                             N'm3',  4, 0,       0.03, 0),
    (42, N'BAS-CON150', N'Concreto f''c=150 kg/cm² hecho en obra',               N'm3',  4, 0,       0.03, 0),
    (50, N'CON-FIR10',  N'Firme de concreto f''c=150 de 10 cm',                   N'm2',  5, 0,       0.03, 0.02),
    (51, N'CON-MUR14',  N'Muro de tabique rojo 14 cm asentado con mortero 1:4',  N'm2',  5, 0,       0.03, 0.02),
    (52, N'CON-APL',    N'Aplanado de mortero 1:4 en muros, 2 cm',                N'm2',  5, 0,       0.03, 0.02)
  ) v (Id, Clave, Descripcion, Unidad, Tipo, Precio, Her, Seg)
  JOIN @u u ON u.Clave = v.Unidad;
SET IDENTITY_INSERT apu.Insumos OFF;

INSERT apu.Insumos_FSR_Detalle (InsumoId, ParametrosFsrId, SalarioNominal) VALUES (20, 1, 400), (21, 1, 600), (22, 1, 550);

INSERT apu.Insumos_CostoHorario_Detalle (
    InsumoId, PrecioAdquisicion, TasaValorRescate, VidaEconomicaHoras, HorasEfectivasAnio, TasaInteresAnual,
    TasaSeguroAnual, CoeficienteMantenimiento, PotenciaHp, FactorOperacion, CoeficienteCombustible, CombustibleInsumoId,
    CapacidadCarterLitros, HorasEntreCambios, ConsumoAceiteHora, LubricanteInsumoId, OperadorInsumoId, HorasEfectivasTurno)
VALUES (30, 85000, 0.10, 6000, 1200, 0.12, 0.03, 0.6, 8, 0.7, 0.1514, 6, 2, 100, 0.005, 7, 22, 8);

INSERT apu.APU_Detalle (PadreId, HijoId, Cantidad, Rendimiento, TasaMerma, Orden) VALUES
    -- cuadrilla
    (40, 21, 1, NULL, 0, 1), (40, 20, 1, NULL, 0, 2),
    -- mortero 1:4
    (41, 1, 0.35, NULL, 0.02, 1), (41, 2, 1.15, NULL, 0, 2), (41, 4, 0.25, NULL, 0, 3), (41, 20, 0, 2.5, 0, 4),
    -- concreto f'c=150 (lleva revolvedora y cuadrilla)
    (42, 1, 0.29, NULL, 0.02, 1), (42, 2, 0.53, NULL, 0, 2), (42, 3, 0.70, NULL, 0, 3), (42, 4, 0.22, NULL, 0, 4),
    (42, 30, 0, 4, 0, 5), (42, 40, 0, 5, 0, 6),
    -- firme
    (50, 42, 0.10, NULL, 0.03, 1), (50, 40, 0, 25, 0, 2),
    -- muro
    (51, 5, 54, NULL, 0.03, 1), (51, 41, 0.028, NULL, 0.05, 2), (51, 40, 0, 8, 0, 3),
    -- aplanado
    (52, 41, 0.02, NULL, 0.05, 1), (52, 40, 0, 12, 0, 2);

SET IDENTITY_INSERT apu.Sobrecostos ON;
INSERT apu.Sobrecostos (SobrecostoId, Nombre, TasaIndirectoOficinaCentral, TasaIndirectoCampo, TasaFinanciamiento, TasaUtilidad)
VALUES (1, N'Vivienda 2026', 0.08, 0.04, 0.012, 0.10);
SET IDENTITY_INSERT apu.Sobrecostos OFF;
INSERT apu.Sobrecostos_CargosAdicionales (SobrecostoId, Concepto, Tasa) VALUES
    (1, N'Inspección y vigilancia (5 al millar)', 0.005), (1, N'Capacitación CMIC (2 al millar)', 0.002);

SET IDENTITY_INSERT apu.Presupuesto_Encabezado ON;
INSERT apu.Presupuesto_Encabezado (PresupuestoId, Clave, Nombre, SobrecostoId) VALUES (1, N'VIV-01', N'Casa habitación tipo', 1);
SET IDENTITY_INSERT apu.Presupuesto_Encabezado OFF;

SET IDENTITY_INSERT apu.Presupuesto_Detalle ON;
INSERT apu.Presupuesto_Detalle (PartidaId, PresupuestoId, PadrePartidaId, TipoPartida, Clave, Descripcion, Orden, InsumoId, Cantidad) VALUES
    (1, 1, NULL, 1, N'01',       N'Cimentación', 1, NULL, NULL),
    (2, 1, 1,    3, N'01.01',    N'Firme',       1, 50,   85),
    (3, 1, NULL, 1, N'02',       N'Albañilería', 2, NULL, NULL),
    (4, 1, 3,    2, N'02.01',    N'Muros',       1, NULL, NULL),
    (5, 1, 4,    3, N'02.01.01', N'Muros',       1, 51,   210),
    (6, 1, 3,    2, N'02.02',    N'Acabados',    2, NULL, NULL),
    (7, 1, 6,    3, N'02.02.01', N'Aplanados',   1, 52,   420);
SET IDENTITY_INSERT apu.Presupuesto_Detalle OFF;

COMMIT;

EXEC apu.usp_RecalcularTodo;
EXEC apu.usp_CalcularPresupuesto @PresupuestoId = 1;
GO
