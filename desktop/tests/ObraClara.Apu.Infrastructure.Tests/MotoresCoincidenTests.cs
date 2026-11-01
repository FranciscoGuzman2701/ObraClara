using ObraClara.Apu.Application;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Infrastructure.Tests;

/// <summary>
/// Los procedimientos almacenados y el dominio C# implementan las mismas fórmulas:
/// aquí se exige que den el mismo resultado sobre los datos de ejemplo.
/// </summary>
public sealed class MotoresCoincidenTests(BaseDePrueba db) : IClassFixture<BaseDePrueba>
{
    // SQL Server guarda el desglose con 6 decimales en cada nivel; C# usa decimal de 28 dígitos.
    private const decimal Tolerancia = 0.0005m;
    private RepositorioSqlServer Repo => new(db.CadenaConexion);

    [SkippableFact]
    public async Task Costos_de_sql_server_coinciden_con_el_motor_csharp()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var catalogo = await Repo.CargarCatalogoAsync();
        var csharp = MotorCostos.CalcularTodo(catalogo);

        var sql = await Repo.CargarCostosAsync();
        Assert.Equal(catalogo.Insumos.Count, sql.Count);
        foreach (var s in sql)
        {
            var d = csharp.Desglose(s.InsumoId);
            var clave = catalogo[s.InsumoId].Clave;
            Assert.True(Math.Abs(d.CostoDirecto - s.CostoDirecto) < Tolerancia, $"{clave}: C# {d.CostoDirecto} vs SQL {s.CostoDirecto}");
            Assert.True(Math.Abs(d.Herramienta - s.Herramienta) < Tolerancia, $"{clave}: herramienta");
            Assert.True(Math.Abs(d.EquipoSeguridad - s.EquipoSeguridad) < Tolerancia, $"{clave}: seguridad");
            Assert.True(Math.Abs(d.ManoObra - s.ManoObra) < Tolerancia, $"{clave}: mano de obra");
        }
    }

    [SkippableFact]
    public async Task Script_de_datos_y_catalogo_demo_son_el_mismo_catalogo()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var demo = MotorCostos.CalcularTodo(CatalogoDemo.Crear());
        var deSql = await Repo.CargarCatalogoAsync();
        Assert.Equal(CatalogoDemo.Crear().Insumos.Select(i => i.Clave).Order(), deSql.Insumos.Select(i => i.Clave).Order());
        var costosSql = MotorCostos.CalcularTodo(deSql);
        foreach (var i in deSql.Insumos)
            Assert.Equal(demo.CostoDirecto(i.Id), costosSql.CostoDirecto(i.Id));
    }

    [SkippableFact]
    public async Task Presupuesto_y_explosion_coinciden()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var catalogo = await Repo.CargarCatalogoAsync();
        var costos = MotorCostos.CalcularTodo(catalogo);
        var presupuesto = await Repo.CargarPresupuestoAsync(1, catalogo);

        var csharp = CalculadoraPresupuesto.Calcular(presupuesto, costos);
        var sql = await Repo.CalcularPresupuestoAsync(1);
        foreach (var fila in sql)
        {
            var c = csharp.Partidas[fila.PartidaId];
            Assert.Equal(c.Importe, fila.Importe);
            if (fila.Tipo == TipoPartida.Concepto) Assert.Equal(c.PrecioUnitario, fila.PrecioUnitario);
        }
        Assert.Equal(csharp.Total, sql.Where(f => f.PadreId is null).Sum(f => f.Importe));

        var expCs = CalculadoraPresupuesto.Explosionar(presupuesto, catalogo, costos);
        var expSql = await Repo.ExplosionAsync(1);
        Assert.Equal(expCs.Insumos.Select(i => i.Clave), expSql.Insumos.Select(i => i.Clave));
        foreach (var (a, b) in expCs.Insumos.Zip(expSql.Insumos))
            Assert.True(Math.Abs(a.Cantidad - b.Cantidad) < Tolerancia, $"{a.Clave}: {a.Cantidad} vs {b.Cantidad}");
        Assert.True(Math.Abs(expCs.CostoDirectoTotal - expSql.CostoDirectoTotal) < 0.05m,
            $"CD total {expCs.CostoDirectoTotal} vs {expSql.CostoDirectoTotal}");
    }
}
