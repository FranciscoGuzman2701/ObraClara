using ObraClara.Apu.Application;
using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Tests;

public class MotorCostosTests
{
    /// <summary>Cemento $100, peón $200; mortero con herramienta 3 %; muro con herramienta 3 % y seguridad 2 %.</summary>
    private static CatalogoInsumos CatalogoChico()
    {
        var c = new CatalogoInsumos();
        c.Agregar(new Insumo(1, "CEM", "Cemento", "kg", TipoInsumo.MAT)).FijarPrecioBase(100m);
        c.Agregar(new Insumo(2, "PEON", "Peón", "jor", TipoInsumo.MO)).FijarPrecioBase(200m);
        c.Agregar(new Insumo(3, "MOR", "Mortero", "m3", TipoInsumo.BAS)).FijarCargosSobreManoObra(0.03m, 0m);
        c.AgregarComponente(3, new() { HijoId = 1, Cantidad = 1m });
        c.AgregarComponente(3, new() { HijoId = 2, Rendimiento = 2m });           // 0.5 jor/m3
        c.Agregar(new Insumo(4, "MURO", "Muro", "m2", TipoInsumo.CON)).FijarCargosSobreManoObra(0.03m, 0.02m);
        c.AgregarComponente(4, new() { HijoId = 3, Cantidad = 2m });
        c.AgregarComponente(4, new() { HijoId = 2, Cantidad = 0.25m });
        c.Agregar(new Insumo(5, "PISO", "Piso", "m2", TipoInsumo.CON));
        c.AgregarComponente(5, new() { HijoId = 2, Cantidad = 1m });
        return c;
    }

    [Fact]
    public void Matriz_anidada_no_cobra_dos_veces_la_herramienta()
    {
        var r = MotorCostos.CalcularTodo(CatalogoChico());

        var mortero = r.Desglose(3);
        Assert.Equal(100m, mortero.Materiales);
        Assert.Equal(100m, mortero.ManoObra);
        Assert.Equal(3m, mortero.Herramienta);
        Assert.Equal(203m, mortero.CostoDirecto);

        var muro = r.Desglose(4);
        Assert.Equal(200m, muro.Materiales);            // 2 × 100
        Assert.Equal(250m, muro.ManoObra);              // 2 × 100 + 0.25 × 200
        Assert.Equal(7.5m, muro.Herramienta);           // 2 × 3 heredada + 3 % de los 50 propios (no de los 250)
        Assert.Equal(1.5m, muro.HerramientaPropia);
        Assert.Equal(5m, muro.EquipoSeguridad);         // 2 % de 250: el mortero no la cobró
        Assert.Equal(462.5m, muro.CostoDirecto);
    }

    [Fact]
    public void Cascada_recalcula_solo_lo_afectado_en_orden()
    {
        var c = CatalogoChico();
        var r = MotorCostos.CalcularTodo(c);
        c[1].FijarPrecioBase(150m);

        var recalculados = MotorCostos.Recalcular(c, r, [1]);

        Assert.Equal([1, 3, 4], recalculados);          // el piso no usa cemento
        Assert.Equal(253m, r.CostoDirecto(3));
        Assert.Equal(562.5m, r.CostoDirecto(4));
        Assert.Equal(MotorCostos.CalcularTodo(c).CostoDirecto(4), r.CostoDirecto(4));
    }

    [Fact]
    public void Impide_referencias_circulares_al_editar_la_matriz()
    {
        var c = new CatalogoInsumos();
        foreach (var (id, clave) in new[] { (1, "A"), (2, "B"), (3, "C") })
            c.Agregar(new Insumo(id, clave, clave, "m3", TipoInsumo.BAS));
        c.AgregarComponente(1, new() { HijoId = 2, Cantidad = 1 });
        c.AgregarComponente(2, new() { HijoId = 3, Cantidad = 1 });

        var ex = Assert.Throws<ReferenciaCircularException>(() => c.AgregarComponente(3, new() { HijoId = 1, Cantidad = 1 }));
        Assert.Equal(["C", "A", "B", "C"], ex.Ruta);
        Assert.Throws<ReferenciaCircularException>(() => c.AgregarComponente(1, new() { HijoId = 1, Cantidad = 1 }));
    }

    [Fact]
    public void Reglas_de_tipo_en_la_matriz()
    {
        var c = CatalogoChico();
        // un concepto no puede ser componente; un elemental no tiene matriz
        Assert.Throws<ReglaDeNegocioException>(() => c.AgregarComponente(4, new() { HijoId = 5, Cantidad = 1 }));
        Assert.Throws<ReglaDeNegocioException>(() => c.AgregarComponente(1, new() { HijoId = 2, Cantidad = 1 }));
        Assert.Throws<ReglaDeNegocioException>(() => c.AgregarComponente(4, new() { HijoId = 2, Cantidad = 1 }));   // duplicado
        Assert.Throws<ReglaDeNegocioException>(() => c.AgregarComponente(5, new() { HijoId = 1, Cantidad = 0 }));
    }

    [Fact]
    public void Maquinaria_depende_de_combustible_y_operador_en_la_cascada()
    {
        var c = CatalogoDemo.Crear();
        var r = MotorCostos.CalcularTodo(c);
        var antes = (Revolvedora: r.CostoDirecto(30), Concreto: r.CostoDirecto(42), Firme: r.CostoDirecto(50));

        c[6].FijarPrecioBase(30m);                       // sube el diésel
        var recalculados = MotorCostos.Recalcular(c, r, [6]);

        Assert.Equal([6, 30, 42, 50], recalculados);
        Assert.True(r.CostoDirecto(30) > antes.Revolvedora);
        Assert.True(r.CostoDirecto(42) > antes.Concreto);
        Assert.True(r.CostoDirecto(50) > antes.Firme);
        Assert.Equal(MotorCostos.CalcularTodo(c).CostoDirecto(50), r.CostoDirecto(50));
    }

    [Fact]
    public void Arbol_profundo_no_desborda_la_pila()
    {
        var c = new CatalogoInsumos();
        c.Agregar(new Insumo(1, "BASE", "base", "pza", TipoInsumo.MAT)).FijarPrecioBase(1m);
        const int niveles = 20_000;
        for (var i = 2; i <= niveles; i++) c.Agregar(new Insumo(i, $"N{i}", "nivel", "pza", TipoInsumo.BAS));
        // de arriba hacia abajo: así la validación de ciclos de cada arista no recorre toda la cadena
        for (var i = niveles; i >= 2; i--) c.AgregarComponente(i, new() { HijoId = i - 1, Cantidad = 1m });
        Assert.Equal(1m, MotorCostos.CalcularTodo(c).CostoDirecto(niveles));
    }
}
