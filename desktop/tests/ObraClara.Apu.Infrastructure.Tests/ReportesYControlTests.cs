using ObraClara.Apu.Application;
using ObraClara.Apu.Application.Reportes;
using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Presupuestos;
using ObraClara.Apu.Infrastructure.Reportes;
using QuestPDF.Fluent;

namespace ObraClara.Apu.Infrastructure.Tests;

public sealed class ReportesYControlTests(BaseDePrueba db) : IClassFixture<BaseDePrueba>
{
    private static (SesionCatalogo Sesion, ReportePdf.Datos Datos) Demo()
    {
        var c = CatalogoDemo.Crear();
        var s = SesionCatalogo.EnMemoria(c, CatalogoDemo.CrearPresupuesto(c), CatalogoDemo.CrearControl());
        return (s, new ReportePdf.Datos(s.Presupuesto!, c, s.CalcularPresupuesto()!, s.Explosionar()!, s.Analizar(), new DateTime(2026, 11, 2)));
    }

    [Fact]
    public void Genera_el_pdf_con_analisis_presupuesto_y_explosion()
    {
        var (_, datos) = Demo();
        var pdf = ReportePdf.Generar(datos);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
        Assert.True(pdf.Length > 10_000);
        var ruta = Environment.GetEnvironmentVariable("APU_CAPTURAS");
        if (ruta is not null) File.WriteAllBytes(Path.Combine(ruta, "reporte-obra.pdf"), pdf);
    }

    [Fact]
    public void Csv_de_presupuesto_y_analisis_se_leen_de_vuelta()
    {
        var (s, _) = Demo();
        var (enc, filas) = Csv.Leer(ExportadorCsv.Presupuesto(s.Presupuesto!, s.Catalogo, s.CalcularPresupuesto()!));
        Assert.Contains("precio_unitario", enc);
        Assert.Equal(7, filas.Count);
        var muro = filas.Single(f => f[1] == "02.01.01");
        Assert.Equal("619.75", muro[Array.IndexOf(enc, "precio_unitario")]);
        Assert.Contains(",", filas.Single(f => f[1] == "02.02.01")[5]);          // descripción con coma, entre comillas

        var (encA, filasA) = Csv.Leer(ExportadorCsv.AnalisisConceptos(s.Analizar()!));
        Assert.Equal(3, filasA.Count);
        Assert.Equal("40", filasA.Single(f => f[0] == "02.02.01")[Array.IndexOf(encA, "cantidad_fuera_de_alcance")]);
        Assert.StartsWith("clave,", ExportadorCsv.Desperdicio(s.Analizar()!));
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, Csv.ABytes("x")[..3]);       // BOM para Excel
    }

    [Fact]
    public async Task Importar_csv_valida_cada_linea_y_no_importa_nada_si_hay_errores()
    {
        var (s, _) = Demo();
        var malo = "fecha,partida,cantidad,costo_real\n2026-10-20,02.01.01,10,4800\n2026-13-01,02.01.01,5,10\n2026-10-20,99.99,1,1\n";
        var r = await s.ImportarControlAsync(malo);
        Assert.Equal(2, r.Errores.Count);
        Assert.Contains("Línea 3", r.Errores[0]);
        Assert.Contains("99.99", r.Errores[1]);
        var antes = s.Analizar()!.Conceptos.Single(c => c.Clave == "02.01.01").CantidadEjecutada;
        Assert.Equal(140m, antes);

        var bueno = "fecha;insumo;cantidad;referencia\n2026-10-21;MAT-CEM;0.5;VS-130\n";        // separador ; también
        var ok = await s.ImportarControlAsync(bueno);
        Assert.Empty(ok.Errores);
        Assert.Equal(8.6m, s.Control.Consumos.Where(c => c.InsumoId == 1).Sum(c => c.CantidadReal));
    }

    [SkippableFact]
    public async Task Sql_server_y_csharp_dan_el_mismo_analisis_y_se_registran_capturas()
    {
        Skip.IfNot(db.Disponible, $"Defina {BaseDePrueba.Variable}");
        var repo = new RepositorioSqlServer(db.CadenaConexion);
        await repo.CalcularPresupuestoAsync(1);
        var sesion = await SesionCatalogo.AbrirAsync(repo, 1);
        var csharp = sesion.Analizar()!;
        var demo = Demo().Sesion.Analizar()!;
        Assert.Equal(demo.Variacion, csharp.Variacion);                   // los datos de SQL son los del ejemplo

        var conceptos = await Consultar("SELECT PartidaId, Variacion, CostoProyectado, ImporteFueraDeAlcance FROM apu.fn_AnalisisConceptos(1)");
        foreach (var f in conceptos)
        {
            var c = csharp.Conceptos.Single(x => x.PartidaId == (int)f[0]);
            Assert.True(Math.Abs(c.Variacion - (decimal)f[1]) < 0.01m, $"{c.Clave}: {c.Variacion} vs {f[1]}");
            Assert.True(Math.Abs(c.ImporteFueraDeAlcance - (decimal)f[3]) < 0.01m);
        }
        var desperdicio = await Consultar("SELECT InsumoId, Excedente, ImporteExcedente FROM apu.fn_AnalisisDesperdicio(1)");
        Assert.Equal(csharp.Desperdicio.Count, desperdicio.Count);
        foreach (var f in desperdicio)
        {
            var d = csharp.Desperdicio.Single(x => x.InsumoId == (int)f[0]);
            Assert.True(Math.Abs(d.Excedente - (decimal)f[1]) < 0.0001m, $"{d.Clave}");
        }

        // almacén registra un vale: entra a la base con su departamento y cambia el análisis
        var r = await sesion.ImportarControlAsync("fecha,insumo,cantidad,referencia\n2026-10-28,MAT-TAB,200,VS-140\n");
        Assert.Empty(r.Errores);
        Assert.Equal(8_550m, sesion.Control.Consumos.Single(c => c.InsumoId == 5).CantidadReal);
        var bitacora = await Consultar("SELECT Departamento FROM apu.vw_BI_Capturas WHERE Tipo = N'Consumo' AND Fecha = '2026-10-28'");
        Assert.Equal("Almacén", (string)bitacora.Single()[0]);
    }

    private async Task<List<object[]>> Consultar(string sql)
    {
        await using var cn = new Microsoft.Data.SqlClient.SqlConnection(db.CadenaConexion);
        await cn.OpenAsync();
        await using var cmd = new Microsoft.Data.SqlClient.SqlCommand(sql, cn);
        await using var rd = await cmd.ExecuteReaderAsync();
        var filas = new List<object[]>();
        while (await rd.ReadAsync())
        {
            var f = new object[rd.FieldCount];
            rd.GetValues(f);
            filas.Add(f);
        }
        return filas;
    }
}
