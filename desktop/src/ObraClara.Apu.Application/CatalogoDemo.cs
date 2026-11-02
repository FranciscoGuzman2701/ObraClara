using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Application;

/// <summary>
/// Catálogo y presupuesto de ejemplo (vivienda). Es el mismo contenido que
/// db/03_datos_ejemplo.sql; una prueba de integración verifica que ambos coincidan.
/// Las cuotas son ilustrativas: ajústelas a las tablas vigentes del IMSS y de su estado.
/// </summary>
public static class CatalogoDemo
{
    public static ParametrosFsr Fsr2026 { get; } = new()
    {
        Id = 1,
        Nombre = "FSR 2026 (ejemplo)",
        Uma = 113.14m,
        DiasNoLaborados =
        [
            new("Domingos", 52), new("Festivos (LFT art. 74)", 7), new("Vacaciones", 12),
            new("Mal tiempo", 3), new("Costumbre", 2), new("Enfermedad no profesional", 1),
        ],
        Cuotas =
        [
            new("Riesgo de trabajo (clase V)", BaseCuota.SalarioBaseCotizacion, 0.0758875m),
            new("Enf. y mat. cuota fija", BaseCuota.Uma, 0.204m),
            new("Enf. y mat. excedente 3 UMA", BaseCuota.ExcedenteTresUma, 0.011m),
            new("Prestaciones en dinero", BaseCuota.SalarioBaseCotizacion, 0.007m),
            new("Gastos médicos pensionados", BaseCuota.SalarioBaseCotizacion, 0.0105m),
            new("Invalidez y vida", BaseCuota.SalarioBaseCotizacion, 0.0175m),
            new("Guarderías y prest. sociales", BaseCuota.SalarioBaseCotizacion, 0.01m),
            new("Retiro", BaseCuota.SalarioBaseCotizacion, 0.02m),
            new("Cesantía y vejez (tasa de ejemplo)", BaseCuota.SalarioBaseCotizacion, 0.0315m),
            new("INFONAVIT", BaseCuota.SalarioBaseCotizacion, 0.05m),
            new("Impuesto sobre nómina (ejemplo)", BaseCuota.SalarioPagado, 0.03m),
        ],
    };

    public static ParametrosSobrecosto Sobrecosto { get; } = new()
    {
        Id = 1,
        Nombre = "Vivienda 2026",
        TasaIndirectoOficinaCentral = 0.08m,
        TasaIndirectoCampo = 0.04m,
        TasaFinanciamiento = 0.012m,
        TasaUtilidad = 0.10m,
        CargosAdicionales = [new("Inspección y vigilancia (5 al millar)", 0.005m), new("Capacitación CMIC (2 al millar)", 0.002m)],
    };

    public static CatalogoInsumos Crear()
    {
        var c = new CatalogoInsumos();
        c.AgregarParametrosFsr(Fsr2026);

        Insumo Mat(int id, string clave, string desc, string ud, decimal precio)
        {
            var i = c.Agregar(new Insumo(id, clave, desc, ud, TipoInsumo.MAT));
            i.FijarPrecioBase(precio);
            return i;
        }
        Insumo Mo(int id, string clave, string desc, decimal salarioNominal)
        {
            var i = c.Agregar(new Insumo(id, clave, desc, "jor", TipoInsumo.MO));
            i.FijarManoObra(new DatosManoObra(salarioNominal, Fsr2026.Id));
            return i;
        }
        Insumo Compuesto(int id, string clave, string desc, string ud, TipoInsumo tipo, decimal her, decimal seg,
            params (int Hijo, decimal Cantidad, decimal? Rendimiento, decimal Merma)[] comps)
        {
            var i = c.Agregar(new Insumo(id, clave, desc, ud, tipo));
            i.FijarCargosSobreManoObra(her, seg);
            foreach (var (hijo, cant, rend, merma) in comps)
                c.AgregarComponente(id, new ComponenteApu { HijoId = hijo, Cantidad = cant, Rendimiento = rend, TasaMerma = merma });
            return i;
        }

        Mat(1, "MAT-CEM", "Cemento gris CPC 30R", "ton", 3200m);
        Mat(2, "MAT-ARE", "Arena", "m3", 380m);
        Mat(3, "MAT-GRA", "Grava 3/4\"", "m3", 420m);
        Mat(4, "MAT-AGU", "Agua", "m3", 35m);
        Mat(5, "MAT-TAB", "Tabique rojo recocido 7x14x28", "pza", 3.80m);
        Mat(6, "MAT-DIE", "Diésel", "lt", 25.80m);
        Mat(7, "MAT-ACE", "Aceite para motor", "lt", 120m);

        Mo(20, "MO-PEON", "Peón", 400m);
        Mo(21, "MO-OFAL", "Oficial albañil", 600m);
        Mo(22, "MO-OPER", "Operador de equipo ligero", 550m);

        var revolvedora = c.Agregar(new Insumo(30, "EQ-REV", "Revolvedora 1 saco, 8 HP diésel", "hr", TipoInsumo.EQ));
        revolvedora.FijarMaquinaria(new ParametrosCostoHorario
        {
            PrecioAdquisicion = 85_000m, TasaValorRescate = 0.10m, VidaEconomicaHoras = 6_000m, HorasEfectivasAnio = 1_200m,
            TasaInteresAnual = 0.12m, TasaSeguroAnual = 0.03m, CoeficienteMantenimiento = 0.6m,
            PotenciaHp = 8m, FactorOperacion = 0.7m, CoeficienteCombustible = 0.1514m, CombustibleInsumoId = 6,
            CapacidadCarterLitros = 2m, HorasEntreCambios = 100m, ConsumoAceiteHora = 0.005m, LubricanteInsumoId = 7,
            OperadorInsumoId = 22, HorasEfectivasTurno = 8m,
        });

        // Básicos: cuadrilla (jor), mortero y concreto. El concreto lleva la cuadrilla dentro.
        Compuesto(40, "BAS-CUA1", "Cuadrilla: 1 oficial albañil + 1 peón", "jor", TipoInsumo.BAS, 0m, 0m,
            (21, 1m, null, 0m), (20, 1m, null, 0m));
        Compuesto(41, "BAS-MOR14", "Mortero cemento-arena 1:4", "m3", TipoInsumo.BAS, 0.03m, 0m,
            (1, 0.35m, null, 0.02m), (2, 1.15m, null, 0m), (4, 0.25m, null, 0m), (20, 0m, 2.5m, 0m));
        Compuesto(42, "BAS-CON150", "Concreto f'c=150 kg/cm² hecho en obra", "m3", TipoInsumo.BAS, 0.03m, 0m,
            (1, 0.29m, null, 0.02m), (2, 0.53m, null, 0m), (3, 0.70m, null, 0m), (4, 0.22m, null, 0m),
            (30, 0m, 4m, 0m), (40, 0m, 5m, 0m));

        // Conceptos de obra: el muro usa el mortero; el firme usa el concreto (que usa la cuadrilla).
        Compuesto(50, "CON-FIR10", "Firme de concreto f'c=150 de 10 cm", "m2", TipoInsumo.CON, 0.03m, 0.02m,
            (42, 0.10m, null, 0.03m), (40, 0m, 25m, 0m));
        Compuesto(51, "CON-MUR14", "Muro de tabique rojo 14 cm asentado con mortero 1:4", "m2", TipoInsumo.CON, 0.03m, 0.02m,
            (5, 54m, null, 0.03m), (41, 0.028m, null, 0.05m), (40, 0m, 8m, 0m));
        Compuesto(52, "CON-APL", "Aplanado de mortero 1:4 en muros, 2 cm", "m2", TipoInsumo.CON, 0.03m, 0.02m,
            (41, 0.02m, null, 0.05m), (40, 0m, 12m, 0m));
        return c;
    }

    public static Presupuesto CrearPresupuesto(CatalogoInsumos catalogo)
    {
        var p = new Presupuesto(1, "VIV-01", "Casa habitación tipo", Sobrecosto);
        p.Agregar(new() { Id = 1, Tipo = TipoPartida.Capitulo, Clave = "01", Descripcion = "Cimentación", Orden = 1 }, catalogo);
        p.Agregar(new() { Id = 2, PadreId = 1, Tipo = TipoPartida.Concepto, Clave = "01.01", Orden = 1, InsumoId = 50, Cantidad = 85m, Descripcion = "Firme" }, catalogo);
        p.Agregar(new() { Id = 3, Tipo = TipoPartida.Capitulo, Clave = "02", Descripcion = "Albañilería", Orden = 2 }, catalogo);
        p.Agregar(new() { Id = 4, PadreId = 3, Tipo = TipoPartida.Subcapitulo, Clave = "02.01", Descripcion = "Muros", Orden = 1 }, catalogo);
        p.Agregar(new() { Id = 5, PadreId = 4, Tipo = TipoPartida.Concepto, Clave = "02.01.01", Orden = 1, InsumoId = 51, Cantidad = 210m, Descripcion = "Muros" }, catalogo);
        p.Agregar(new() { Id = 6, PadreId = 3, Tipo = TipoPartida.Subcapitulo, Clave = "02.02", Descripcion = "Acabados", Orden = 2 }, catalogo);
        p.Agregar(new() { Id = 7, PadreId = 6, Tipo = TipoPartida.Concepto, Clave = "02.02.01", Orden = 1, InsumoId = 52, Cantidad = 420m, Descripcion = "Aplanados" }, catalogo);
        return p;
    }

    /// <summary>
    /// Avance de obra de ejemplo (mismo contenido que db/05_control_obra.sql):
    /// el firme terminó con sobrecosto, el muro va bien al 67 % y el aplanado se pasó del alcance.
    /// </summary>
    public static DatosControl CrearControl() => new(
        [
            new AvanceConcepto(2, 85m, 24_500m),     // firme 100 %
            new AvanceConcepto(5, 140m, 66_000m),    // muros 67 %
            new AvanceConcepto(7, 460m, 92_000m),    // aplanado 110 %: 40 m² fuera de alcance
        ],
        [
            new ConsumoMaterial(1, 8.10m),     // cemento
            new ConsumoMaterial(2, 19.80m),    // arena
            new ConsumoMaterial(3, 6.20m),     // grava
            new ConsumoMaterial(4, 5.60m),     // agua
            new ConsumoMaterial(5, 8_350m),    // tabique
        ]);
}
