using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Infrastructure.Tests;

public sealed class CascadaYReglasTests(BaseDePrueba db) : IClassFixture<BaseDePrueba>
{
    private RepositorioSqlServer Repo => new(db.CadenaConexion);

    [SkippableFact]
    public async Task Cambio_de_precio_recalcula_solo_los_ancestros_y_coincide_con_csharp()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var catalogo = await Repo.CargarCatalogoAsync();
        var costos = MotorCostos.CalcularTodo(catalogo);

        // diésel → revolvedora → concreto → firme (4 insumos); el muro no se toca
        var recalculadosSql = await Repo.ActualizarPrecioAsync(6, 31.50m);
        catalogo[6].FijarPrecioBase(31.50m);
        var recalculadosCs = MotorCostos.Recalcular(catalogo, costos, [6]);

        Assert.Equal(4, recalculadosSql);
        Assert.Equal(recalculadosCs.Count, recalculadosSql);
        var sql = (await Repo.CargarCostosAsync()).ToDictionary(c => c.InsumoId);
        foreach (var id in new[] { 6, 30, 42, 50, 51 })
            Assert.True(Math.Abs(costos.CostoDirecto(id) - sql[id].CostoDirecto) < 0.00005m, $"{catalogo[id].Clave}");
    }

    [SkippableFact]
    public async Task El_trigger_rechaza_ciclos_y_conceptos_como_componente()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        // la cuadrilla (40) está dentro del concreto (42): meter el concreto en la cuadrilla cerraría un ciclo
        var ciclo = await Assert.ThrowsAsync<ReglaDeNegocioException>(
            () => Repo.GuardarComponenteAsync(40, new ComponenteApu { HijoId = 42, Cantidad = 1 }));
        Assert.Contains("Referencia circular", ciclo.Message);

        var concepto = await Assert.ThrowsAsync<ReglaDeNegocioException>(
            () => Repo.GuardarComponenteAsync(41, new ComponenteApu { HijoId = 50, Cantidad = 1 }));
        Assert.Contains("concepto de obra", concepto.Message);

        await Assert.ThrowsAsync<ReglaDeNegocioException>(() => Repo.ActualizarPrecioAsync(50, 10m));
    }

    [SkippableFact]
    public async Task Editar_una_matriz_recalcula_en_cascada()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var antes = (await Repo.CargarCostosAsync()).ToDictionary(c => c.InsumoId);

        // más cemento en el mortero: suben mortero, muro y aplanado
        await Repo.GuardarComponenteAsync(41, new ComponenteApu { HijoId = 1, Cantidad = 0.40m, TasaMerma = 0.02m });
        var despues = (await Repo.CargarCostosAsync()).ToDictionary(c => c.InsumoId);
        Assert.True(despues[41].CostoDirecto > antes[41].CostoDirecto);
        Assert.True(despues[51].CostoDirecto > antes[51].CostoDirecto);
        Assert.True(despues[52].CostoDirecto > antes[52].CostoDirecto);
        Assert.Equal(antes[50].CostoDirecto, despues[50].CostoDirecto);

        var catalogo = await Repo.CargarCatalogoAsync();
        Assert.Equal(0.40m, catalogo[41].Componentes.Single(c => c.HijoId == 1).Cantidad);
        Assert.True(Math.Abs(MotorCostos.CalcularTodo(catalogo).CostoDirecto(51) - despues[51].CostoDirecto) < 0.00005m);

        await Repo.QuitarComponenteAsync(41, 4);   // sin agua
        Assert.True((await Repo.CargarCostosAsync()).Single(c => c.InsumoId == 41).CostoDirecto < despues[41].CostoDirecto);
    }

    [SkippableFact]
    public async Task Cambiar_herramienta_recalcula_el_compuesto_y_sus_ancestros()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var antes = (await Repo.CargarCostosAsync()).ToDictionary(c => c.InsumoId);
        await Repo.ActualizarCargosAsync(41, 0.05m, 0m);             // mortero: 3 % → 5 %
        var despues = (await Repo.CargarCostosAsync()).ToDictionary(c => c.InsumoId);
        Assert.True(despues[41].Herramienta > antes[41].Herramienta);
        Assert.True(despues[51].CostoDirecto > antes[51].CostoDirecto);
        var catalogo = await Repo.CargarCatalogoAsync();
        Assert.Equal(0.05m, catalogo[41].TasaHerramienta);
        Assert.True(Math.Abs(MotorCostos.CalcularTodo(catalogo).CostoDirecto(51) - despues[51].CostoDirecto) < 0.00005m);
        await Assert.ThrowsAsync<ReglaDeNegocioException>(() => Repo.ActualizarCargosAsync(1, 0.03m, 0m));
    }
}
