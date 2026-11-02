using ObraClara.Apu.Application;
using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Domain.Tests;

public class AnalisisObraTests
{
    /// <summary>
    /// Concepto de CD $10 (sin sobrecostos: PU $10): 1 kg de cemento ($6) + 0.5 m³ de mortero
    /// (cemento 0.4 kg con merma 2 % … ) para números verificables a mano.
    /// </summary>
    private static (CatalogoInsumos, Presupuesto) Escenario(decimal cantidad = 100m)
    {
        var c = new CatalogoInsumos();
        c.Agregar(new Insumo(1, "CEM", "Cemento", "kg", TipoInsumo.MAT)).FijarPrecioBase(5m);
        c.Agregar(new Insumo(2, "MOR", "Mortero", "m3", TipoInsumo.BAS));
        c.AgregarComponente(2, new() { HijoId = 1, Cantidad = 2m, TasaMerma = 0.05m });   // 2.1 kg → $10.50/m3
        c.Agregar(new Insumo(3, "MURO", "Muro", "m2", TipoInsumo.CON));
        c.AgregarComponente(3, new() { HijoId = 2, Cantidad = 0.5m, TasaMerma = 0.10m }); // 0.55 m3 → $5.775
        c.AgregarComponente(3, new() { HijoId = 1, Cantidad = 0.845m });                  // $4.225 → CD $10.00
        var p = new Presupuesto(1, "P", "p", new ParametrosSobrecosto { Id = 1, Nombre = "sin" });
        p.Agregar(new() { Id = 1, Tipo = TipoPartida.Capitulo, Clave = "1" }, c);
        p.Agregar(new() { Id = 2, PadreId = 1, Tipo = TipoPartida.Concepto, Clave = "1.1", InsumoId = 3, Cantidad = cantidad }, c);
        return (c, p);
    }

    [Fact]
    public void Proyecta_el_costo_final_con_el_rendimiento_real_y_dice_cuanto_se_pierde()
    {
        var (c, p) = Escenario();
        var costos = MotorCostos.CalcularTodo(c);
        Assert.Equal(10m, costos.CostoDirecto(3));

        var r = AnalizadorObra.Analizar(p, c, costos, new DatosControl([new AvanceConcepto(2, 40m, 500m)], []));
        var muro = Assert.Single(r.Conceptos);

        Assert.Equal(0.40m, muro.PctAvance);
        Assert.Equal(400m, muro.ValorGanado);                 // 40 × $10
        Assert.Equal(0.8m, muro.Cpi);                         // 400 / 500
        Assert.Equal(1_250m, muro.CostoProyectado);           // 500 + 60 × 10 / 0.8
        Assert.Equal(1_000m, muro.Venta);
        Assert.Equal(0m, muro.MargenPresupuestado);
        Assert.Equal(-250m, muro.Variacion);                  // pierde $250 si sigue así
        Assert.Equal(-250m, r.Variacion);
    }

    [Fact]
    public void Lo_ejecutado_de_mas_es_fuera_de_alcance()
    {
        var (c, p) = Escenario();
        var r = AnalizadorObra.Analizar(p, c, MotorCostos.CalcularTodo(c), new DatosControl([new AvanceConcepto(2, 120m, 1_150m)], []));
        var muro = r.Conceptos[0];
        Assert.Equal(20m, muro.CantidadFueraDeAlcance);
        Assert.Equal(200m, muro.ImporteFueraDeAlcance);       // 20 × PU $10
        Assert.Equal(1_000m, muro.ValorGanado);               // sólo cuenta lo presupuestado
        Assert.Equal(1_150m, muro.CostoProyectado);           // ya no queda nada por ejecutar
    }

    [Fact]
    public void Desperdicio_real_contra_merma_permitida()
    {
        var (c, p) = Escenario();
        // 10 m² ejecutados: cemento teórico = 10 × (0.5 × 2 + 0.845) = 18.45 kg
        //                    permitido     = 10 × (0.55 × 2.1 + 0.845) = 20.00 kg
        var r = AnalizadorObra.Analizar(p, c, MotorCostos.CalcularTodo(c),
            new DatosControl([new AvanceConcepto(2, 10m, 100m)], [new ConsumoMaterial(1, 23m)]));
        var cemento = Assert.Single(r.Desperdicio);
        Assert.Equal(18.45m, cemento.TeoricoSinMerma);
        Assert.Equal(20m, cemento.PermitidoConMerma);
        Assert.Equal(1.55m, cemento.MermaPermitida);
        Assert.Equal(3m, cemento.Excedente);
        Assert.Equal(15m, cemento.ImporteExcedente);          // 3 kg × $5
        Assert.Equal(15m, r.ImporteDesperdicio);
    }

    [Fact]
    public void Sin_avances_la_proyeccion_es_el_presupuesto()
    {
        var (c, p) = Escenario();
        var r = AnalizadorObra.Analizar(p, c, MotorCostos.CalcularTodo(c), DatosControl.Vacio);
        Assert.Equal(r.CostoPresupuestado, r.CostoProyectado);
        Assert.Equal(0m, r.Variacion);
        Assert.Empty(r.Desperdicio);
    }

    [Fact]
    public void Obra_de_ejemplo_detecta_donde_gana_y_donde_pierde()
    {
        var catalogo = CatalogoDemo.Crear();
        var r = AnalizadorObra.Analizar(CatalogoDemo.CrearPresupuesto(catalogo), catalogo,
            MotorCostos.CalcularTodo(catalogo), CatalogoDemo.CrearControl());

        Assert.True(r.Conceptos.Single(x => x.Clave == "01.01").Variacion < 0);      // firme con sobrecosto
        Assert.True(r.Conceptos.Single(x => x.Clave == "02.01.01").Variacion > 0);   // muro por debajo del costo
        Assert.Equal(40m, r.Conceptos.Single(x => x.Clave == "02.02.01").CantidadFueraDeAlcance);
        Assert.Contains(r.Desperdicio, d => d.Clave == "MAT-CEM" && d.Excedente > 0);
    }
}
