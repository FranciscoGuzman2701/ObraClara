using System.Diagnostics;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Tests;

public class RendimientoTests
{
    /// <summary>
    /// Catálogo sintético de 40,000 insumos: 20,000 elementales,
    /// 8,000 básicos en 4 niveles y 12,000 conceptos de 6–10 renglones cada uno.
    /// </summary>
    private static CatalogoInsumos CatalogoGrande()
    {
        var azar = new Random(7);
        var c = new CatalogoInsumos();
        var id = 0;
        var elementales = Enumerable.Range(0, 20_000).Select(i =>
        {
            var tipo = (TipoInsumo)(i % 3 + 1);
            var ins = c.Agregar(new Insumo(++id, $"E{id}", "elemental", "pza", tipo));
            ins.FijarPrecioBase(azar.Next(1, 5_000));
            return ins.Id;
        }).ToList();
        var porNivel = new List<List<int>> { elementales };
        for (var nivel = 1; nivel <= 4; nivel++)
        {
            var actuales = new List<int>();
            for (var k = 0; k < 2_000; k++)
            {
                var b = c.Agregar(new Insumo(++id, $"B{id}", "básico", "m3", TipoInsumo.BAS));
                b.FijarCargosSobreManoObra(0.03m, 0);
                foreach (var hijo in porNivel[nivel - 1].OrderBy(_ => azar.Next()).Take(5))
                    c.AgregarComponente(b.Id, new ComponenteApu { HijoId = hijo, Cantidad = azar.Next(1, 100) / 10m });
                actuales.Add(b.Id);
            }
            porNivel.Add(actuales);
        }
        var candidatos = porNivel.SelectMany(x => x).ToList();
        for (var k = 0; k < 12_000; k++)
        {
            var con = c.Agregar(new Insumo(++id, $"C{id}", "concepto", "m2", TipoInsumo.CON));
            con.FijarCargosSobreManoObra(0.03m, 0.02m);
            foreach (var hijo in Enumerable.Range(0, azar.Next(6, 11)).Select(_ => candidatos[azar.Next(candidatos.Count)]).Distinct())
                c.AgregarComponente(con.Id, new ComponenteApu { HijoId = hijo, Cantidad = azar.Next(1, 50) / 100m });
        }
        return c;
    }

    [Fact]
    public void Recalculo_completo_y_en_cascada_de_un_catalogo_grande()
    {
        var c = CatalogoGrande();
        var reloj = Stopwatch.StartNew();
        var r = MotorCostos.CalcularTodo(c);
        var completo = reloj.Elapsed;

        // cambiar el precio de un material muy usado recalcula sólo sus ancestros
        var usos = c.Insumos.SelectMany(p => p.Componentes).GroupBy(x => x.HijoId).ToDictionary(g => g.Key, g => g.Count());
        var material = c.Insumos.Where(i => i.Tipo == TipoInsumo.MAT).MaxBy(i => usos.GetValueOrDefault(i.Id))!;
        material.FijarPrecioBase(material.PrecioBase * 1.1m);
        reloj.Restart();
        var afectados = MotorCostos.Recalcular(c, r, [material.Id]);
        var cascada = reloj.Elapsed;

        Assert.Equal(40_000, c.Insumos.Count);
        Assert.True(completo < TimeSpan.FromSeconds(5), $"cálculo completo: {completo}");
        Assert.True(cascada < TimeSpan.FromSeconds(1), $"cascada de {afectados.Count}: {cascada}");
        Assert.InRange(afectados.Count, 2, c.Insumos.Count - 1);
        var desdeCero = MotorCostos.CalcularTodo(c);
        Assert.All(afectados, a => Assert.Equal(desdeCero.CostoDirecto(a), r.CostoDirecto(a)));
        Console.WriteLine($"[rendimiento] completo {completo.TotalMilliseconds:N0} ms; cascada de {afectados.Count:N0} insumos {cascada.TotalMilliseconds:N0} ms");
    }
}
