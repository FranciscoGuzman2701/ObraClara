using ObraClara.Apu.Desktop.ViewModels;

namespace ObraClara.Apu.Desktop.Tests;

public class TableroTests
{
    private static MainWindowViewModel Crear() => App.CrearViewModelAsync(null).GetAwaiter().GetResult();

    [Fact]
    public void El_tablero_muestra_donde_gana_y_donde_pierde()
    {
        var vm = Crear();
        Assert.True(vm.HayAvances);
        Assert.Equal(["02.02.01", "01.01", "02.01.01"], vm.BarrasConceptos.Select(b => b.Clave));   // de la peor a la mejor
        Assert.True(vm.BarrasConceptos[0].Negativa);
        Assert.Equal(Tablero.AnchoMaximo, vm.BarrasConceptos[0].AnchoPx);                         // la mayor pérdida, barra completa
        Assert.False(vm.BarrasConceptos[^1].Negativa);
        Assert.Equal("MAT-TAB", vm.BarrasDesperdicio[0].Clave);
        Assert.True(vm.Analisis!.Variacion < 0);
    }

    [Fact]
    public void Exporta_pdf_y_csv()
    {
        var vm = Crear();
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(vm.Exportar(TipoExportacion.ReportePdf), 0, 4));
        foreach (var t in new[] { TipoExportacion.PresupuestoCsv, TipoExportacion.ExplosionCsv, TipoExportacion.AnalisisCsv, TipoExportacion.DesperdicioCsv })
        {
            var csv = System.Text.Encoding.UTF8.GetString(vm.Exportar(t)[3..]);
            Assert.True(csv.Split('\n').Length > 3, t.ToString());
        }
        Assert.Equal("VIV-01-reporte.pdf", MainWindowViewModel.NombreSugerido(TipoExportacion.ReportePdf, vm.ClaveObra));
    }

    [Fact]
    public async Task Importar_un_avance_actualiza_el_tablero()
    {
        var vm = Crear();
        var antes = vm.Analisis!.PctAvance;
        await vm.ImportarCsvAsync("fecha,partida,cantidad,costo_real\n2026-10-30,02.01.01,70,30000\n", "obra.csv");
        Assert.Null(vm.Error);
        Assert.Contains("1 avance", vm.Mensaje);
        Assert.True(vm.Analisis!.PctAvance > antes);
        Assert.Equal(1m, vm.AlcanceConceptos.Single(c => c.Clave == "02.01.01").PctAvance);

        await vm.ImportarCsvAsync("fecha,insumo,cantidad\n2026-10-30,MO-PEON,1\n", "almacen.csv");
        Assert.Contains("no es un material", vm.Error);
    }
}
