using ObraClara.Apu.Application;
using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Domain.Tests;

public class SobrecostoPresupuestoTests
{
    [Fact]
    public void Cascada_de_sobrecostos_verificada_a_mano()
    {
        var pie = CalculadoraPrecioVenta.Calcular(100m, CatalogoDemo.Sobrecosto);

        Assert.Equal(12m, pie.Indirectos);                          // 100 × (8 % + 4 %)
        Assert.Equal(1.344m, pie.Financiamiento);                   // 112 × 1.2 %
        Assert.Equal(11.3344m, pie.Utilidad);                       // 113.344 × 10 %
        // (124.6784) / (1 − 0.007)
        Assert.Equal(Math.Round(124.6784m / 0.993m, 10), Math.Round(pie.PrecioUnitarioSinRedondear, 10));
        Assert.Equal(125.56m, pie.PrecioUnitario);
        Assert.Equal(pie.PrecioUnitarioSinRedondear * 0.007m, pie.CargosAdicionales.Sum(c => c.Importe));
    }

    [Fact]
    public void Utilidad_bruta_desde_la_neta()
    {
        Assert.Equal(Math.Round(0.10m / 0.60m, 12), Math.Round(CalculadoraUtilidad.TasaBruta(0.10m, 0.30m, 0.10m), 12));
    }

    [Fact]
    public void Financiamiento_solo_cobra_intereses_con_saldo_negativo()
    {
        var r = CalculadoraFinanciamiento.Calcular(
            [new(100m, 30m), new(100m, 50m), new(100m, 220m)], 0.01m);
        Assert.Equal([-70m, -120m, 0m], r.Periodos.Select(p => p.Saldo));
        Assert.Equal(1.9m, r.Intereses);
        Assert.Equal(1.9m / 300m, r.Tasa);
    }

    [Fact]
    public void Indirectos_como_porcentaje_del_costo_directo()
    {
        var (oc, campo) = CalculadoraIndirectos.Calcular(
            [new("Gerencia", 60_000m, true), new("Residente", 30_000m, false), new("Bodega", 10_000m, false)], 1_000_000m);
        Assert.Equal(0.06m, oc);
        Assert.Equal(0.04m, campo);
    }

    [Fact]
    public void Presupuesto_suma_por_capitulo_y_la_explosion_cuadra_con_el_costo_directo()
    {
        var catalogo = CatalogoDemo.Crear();
        var costos = MotorCostos.CalcularTodo(catalogo);
        var presupuesto = CatalogoDemo.CrearPresupuesto(catalogo);

        var r = CalculadoraPresupuesto.Calcular(presupuesto, costos);
        Assert.Equal(r.Partidas[1].Importe + r.Partidas[3].Importe, r.Total);
        Assert.Equal(r.Partidas[4].Importe + r.Partidas[6].Importe, r.Partidas[3].Importe);
        var muro = r.Partidas[5];
        Assert.Equal(Math.Round(210m * muro.PrecioUnitario, 2), muro.Importe);

        var explosion = CalculadoraPresupuesto.Explosionar(presupuesto, catalogo, costos);
        var cdObra = presupuesto.Conceptos.Sum(p => p.Cantidad * costos.CostoDirecto(p.InsumoId!.Value));
        Assert.Equal(Math.Round(cdObra, 8), Math.Round(explosion.CostoDirectoTotal, 8));
        // sólo elementales; el cemento aparece una vez aunque venga del mortero y del concreto
        Assert.All(explosion.Insumos, i => Assert.True(i.Tipo is Catalogo.TipoInsumo.MAT or Catalogo.TipoInsumo.MO or Catalogo.TipoInsumo.EQ));
        Assert.Single(explosion.Insumos, i => i.Clave == "MAT-CEM");
    }

    [Fact]
    public void Presupuesto_valida_su_jerarquia()
    {
        var catalogo = CatalogoDemo.Crear();
        var p = new Presupuesto(9, "X", "x", CatalogoDemo.Sobrecosto);
        Assert.Throws<ReglaDeNegocioException>(() => p.Agregar(new() { Id = 1, Tipo = TipoPartida.Concepto, Clave = "1", InsumoId = 50 }, catalogo));
        p.Agregar(new() { Id = 1, Tipo = TipoPartida.Capitulo, Clave = "1" }, catalogo);
        Assert.Throws<ReglaDeNegocioException>(() => p.Agregar(new() { Id = 2, PadreId = 1, Tipo = TipoPartida.Concepto, Clave = "1.1", InsumoId = 41 }, catalogo));
        p.Agregar(new() { Id = 2, PadreId = 1, Tipo = TipoPartida.Concepto, Clave = "1.1", InsumoId = 50, Cantidad = 1 }, catalogo);
        Assert.Throws<ReglaDeNegocioException>(() => p.Agregar(new() { Id = 3, PadreId = 2, Tipo = TipoPartida.Concepto, Clave = "1.1.1", InsumoId = 50 }, catalogo));
    }
}
