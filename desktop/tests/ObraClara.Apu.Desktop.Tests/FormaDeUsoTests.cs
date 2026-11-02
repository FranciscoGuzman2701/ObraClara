using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using ObraClara.Apu.Desktop.ViewModels;
using ObraClara.Apu.Desktop.Views;

namespace ObraClara.Apu.Desktop.Tests;

/// <summary>Navegación entre matrices y teclas de función (F3, F4, Esc, F9).</summary>
public class FormaDeUsoTests
{
    private static MainWindowViewModel Crear(string clave)
    {
        var vm = App.CrearViewModelAsync(null).GetAwaiter().GetResult();
        vm.Seleccionado = vm.Insumos.Single(f => f.Clave == clave);
        return vm;
    }

    [Fact]
    public void F4_entra_a_las_matrices_anidadas_y_Esc_regresa_por_la_misma_ruta()
    {
        var vm = Crear("CON-FIR10");
        vm.AbrirMatrizCommand.Execute(vm.Componentes.Single(c => c.Clave == "BAS-CON150"));
        vm.AbrirMatrizCommand.Execute(vm.Componentes.Single(c => c.Clave == "BAS-CUA1"));
        Assert.Equal("BAS-CUA1", vm.Seleccionado!.Clave);
        Assert.Equal("CON-FIR10  ›  BAS-CON150  ›  BAS-CUA1", vm.Ruta);

        vm.AbrirMatrizCommand.Execute(vm.Componentes.Single(c => c.Clave == "MO-PEON"));   // elemental: no abre
        Assert.Equal("BAS-CUA1", vm.Seleccionado.Clave);
        Assert.Contains("no tiene matriz", vm.Mensaje);

        vm.RegresarCommand.Execute(null);
        Assert.Equal("BAS-CON150", vm.Seleccionado.Clave);
        vm.RegresarCommand.Execute(null);
        Assert.Equal("CON-FIR10", vm.Seleccionado.Clave);
        Assert.False(vm.PuedeRegresar);
    }

    [Fact]
    public void Elegir_en_el_catalogo_reinicia_la_ruta()
    {
        var vm = Crear("CON-MUR14");
        vm.AbrirMatrizCommand.Execute(vm.Componentes.Single(c => c.Clave == "BAS-MOR14"));
        Assert.True(vm.PuedeRegresar);
        vm.Seleccionado = vm.Insumos.Single(f => f.Clave == "CON-APL");
        Assert.False(vm.PuedeRegresar);
        Assert.Equal("CON-APL", vm.Ruta);
    }

    [Fact]
    public void Desde_el_presupuesto_F4_abre_la_matriz_del_concepto()
    {
        var vm = Crear("MAT-CEM");
        vm.PestanaActiva = 1;
        vm.AbrirConceptoCommand.Execute(vm.Partidas.Single(p => p.Clave == "02.01.01"));
        Assert.Equal(0, vm.PestanaActiva);
        Assert.Equal("CON-MUR14", vm.Seleccionado!.Clave);
        Assert.NotNull(vm.PrecioVentaSeleccionado);
    }

    [Fact]
    public void El_buscador_filtra_sin_conceptos_ni_el_propio_y_agrega_el_elegido()
    {
        var vm = Crear("CON-APL");
        var antes = vm.Seleccionado!.CostoDirecto;
        vm.AbrirBuscadorCommand.Execute(null);
        Assert.True(vm.BuscadorVisible);
        Assert.DoesNotContain(vm.ResultadosBuscador, r => r.Tipo == Domain.Catalogo.TipoInsumo.CON);

        vm.TextoBuscador = "tabique";
        var tabique = Assert.Single(vm.ResultadosBuscador);
        Assert.Same(tabique, vm.ResultadoSeleccionado);
        vm.ElegirInsumoCommand.Execute(null);

        Assert.False(vm.BuscadorVisible);
        Assert.Contains(vm.Componentes, c => c.Clave == "MAT-TAB" && c.Cantidad == 1m);
        Assert.Equal(antes + 3.80m, vm.Seleccionado.CostoDirecto);

        vm.AbrirBuscadorCommand.Execute(null);                         // repetido: no duplica
        vm.TextoBuscador = "MAT-TAB";
        vm.ElegirInsumoCommand.Execute(null);
        Assert.Single(vm.Componentes, c => c.Clave == "MAT-TAB");
        Assert.Contains("ya está", vm.Mensaje);
    }

    [AvaloniaFact]
    public void Teclas_de_funcion_en_la_ventana()
    {
        var vm = Crear("CON-FIR10");
        var v = new MainWindow { DataContext = vm };
        v.Show();
        v.UpdateLayout();
        var grid = v.FindControl<DataGrid>("GridComponentes")!;
        vm.ComponenteEnfocado = vm.Componentes.Single(c => c.Clave == "BAS-CON150");
        grid.Focus();
        Dispatcher.UIThread.RunJobs();

        void Tecla(Key k) { v.KeyPress(k, RawInputModifiers.None, PhysicalKey.None, null); v.KeyRelease(k, RawInputModifiers.None, PhysicalKey.None, null); Dispatcher.UIThread.RunJobs(); v.UpdateLayout(); }

        Tecla(Key.F4);
        Assert.Equal("BAS-CON150", vm.Seleccionado!.Clave);
        Tecla(Key.Escape);
        Assert.Equal("CON-FIR10", vm.Seleccionado.Clave);

        Tecla(Key.F3);
        Assert.True(vm.BuscadorVisible);
        v.KeyTextInput("grava");
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("grava", vm.TextoBuscador);
        Tecla(Key.Enter);
        Assert.False(vm.BuscadorVisible);
        Assert.Contains(vm.Componentes, c => c.Clave == "MAT-GRA");

        Tecla(Key.F1);
        Assert.True(vm.AtajosVisibles);
        Tecla(Key.Escape);
        Assert.False(vm.AtajosVisibles);

        Tecla(Key.F9);
        Assert.Contains("recalculado", vm.Mensaje);
    }
}
