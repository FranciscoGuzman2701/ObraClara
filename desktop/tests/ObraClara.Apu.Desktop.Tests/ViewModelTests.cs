using ObraClara.Apu.Desktop.ViewModels;
using ObraClara.Apu.Domain.Calculo;

namespace ObraClara.Apu.Desktop.Tests;

public class ViewModelTests
{
    private static MainWindowViewModel Crear() => App.CrearViewModelAsync(null).GetAwaiter().GetResult();
    private static InsumoFilaViewModel Fila(MainWindowViewModel vm, string clave) => vm.Insumos.Single(f => f.Clave == clave);

    [Fact]
    public void Cambiar_un_precio_recalcula_en_cascada_hasta_el_presupuesto()
    {
        var vm = Crear();
        var (mortero, muro, total) = (Fila(vm, "BAS-MOR14").CostoDirecto, Fila(vm, "CON-MUR14").CostoDirecto, vm.TotalPresupuesto);
        var avisos = new List<string?>();
        Fila(vm, "CON-MUR14").PropertyChanged += (_, e) => avisos.Add(e.PropertyName);

        Fila(vm, "MAT-CEM").Precio = 4_000m;

        Assert.True(Fila(vm, "BAS-MOR14").CostoDirecto > mortero);
        Assert.True(Fila(vm, "CON-MUR14").CostoDirecto > muro);
        Assert.True(vm.TotalPresupuesto > total);
        Assert.Contains("", avisos);                 // la fila del muro avisó a la grilla
        Assert.Null(vm.Error);
        Assert.Contains("MAT-CEM", vm.Mensaje);
    }

    [Fact]
    public void Editar_la_matriz_actualiza_el_costo_del_compuesto()
    {
        var vm = Crear();
        vm.Seleccionado = Fila(vm, "BAS-MOR14");
        var cemento = vm.Componentes.Single(c => c.Clave == "MAT-CEM");

        cemento.Cantidad = 0.40m;

        var esperado = MotorCostos.CalcularTodo(vm.Sesion.Catalogo).CostoDirecto(41);
        Assert.Equal(esperado, vm.Seleccionado.CostoDirecto);
        Assert.Equal(0.40m * 1.02m * 3_200m, cemento.Importe);
    }

    [Fact]
    public void Un_renglon_nuevo_se_crea_al_capturar_una_clave_valida()
    {
        var vm = Crear();
        vm.Seleccionado = Fila(vm, "CON-APL");
        var antes = vm.Seleccionado.CostoDirecto;
        vm.AgregarComponenteCommand.Execute(null);
        var nuevo = vm.Componentes.Last();
        Assert.True(nuevo.EsNuevo);

        nuevo.Clave = "zz-no-existe";
        Assert.Contains("No existe", vm.Error);

        nuevo.Clave = "mat-agu";                      // sin distinguir mayúsculas
        Assert.False(nuevo.EsNuevo);
        Assert.Equal(1m, nuevo.Cantidad);
        Assert.Equal(antes + 35m, vm.Seleccionado.CostoDirecto);
    }

    [Fact]
    public void Una_referencia_circular_se_rechaza_y_la_matriz_queda_intacta()
    {
        var vm = Crear();
        vm.Seleccionado = Fila(vm, "BAS-CUA1");        // la cuadrilla está dentro del concreto
        vm.AgregarComponenteCommand.Execute(null);

        vm.Componentes.Last().Clave = "BAS-CON150";

        Assert.Contains("Referencia circular", vm.Error);
        Assert.Equal(2, vm.Componentes.Count);
        Assert.Equal(2, vm.Sesion.Catalogo[40].Componentes.Count);
    }

    [Fact]
    public void No_se_edita_el_resultado_de_un_insumo_calculado()
    {
        var vm = Crear();
        var peon = Fila(vm, "MO-PEON");
        var costo = peon.CostoDirecto;
        peon.Precio = 1m;
        Assert.Contains("FSR", vm.Error);
        Assert.Equal(costo, peon.CostoDirecto);
    }

    [Fact]
    public void Herramienta_en_porcentaje_desde_la_vista()
    {
        var vm = Crear();
        vm.Seleccionado = Fila(vm, "CON-MUR14");
        var antes = vm.Seleccionado.Herramienta;
        vm.HerramientaPorcentaje = 5m;
        Assert.Equal(0.05m, vm.Sesion.Catalogo[51].TasaHerramienta);
        Assert.True(vm.Seleccionado.Herramienta > antes);
    }
}
