using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Application;

/// <summary>
/// Caso de uso de edición del catálogo para la interfaz. Cada cambio se aplica y
/// recalcula al instante en memoria (sólo los afectados) y, si hay repositorio, se
/// persiste: el servidor repite la cascada con sus procedimientos almacenados.
/// Si el servidor rechaza el cambio, se recarga desde la base para no divergir.
/// </summary>
public sealed class SesionCatalogo
{
    private readonly IRepositorioApu? _repositorio;

    private SesionCatalogo(CatalogoInsumos catalogo, IRepositorioApu? repositorio, Presupuesto? presupuesto)
    {
        Catalogo = catalogo;
        _repositorio = repositorio;
        Presupuesto = presupuesto;
        Costos = MotorCostos.CalcularTodo(catalogo);
    }

    public CatalogoInsumos Catalogo { get; private set; }
    public ResultadoCostos Costos { get; private set; }
    public Presupuesto? Presupuesto { get; private set; }
    public bool Persistente => _repositorio is not null;

    /// <summary>Insumos cuyo costo cambió (en orden de cálculo) tras la última operación.</summary>
    public event Action<IReadOnlyList<int>>? CostosActualizados;
    /// <summary>Se recargó todo (p. ej. tras un rechazo del servidor).</summary>
    public event Action? Recargado;

    public static SesionCatalogo EnMemoria(CatalogoInsumos catalogo, Presupuesto? presupuesto = null) => new(catalogo, null, presupuesto);

    public static async Task<SesionCatalogo> AbrirAsync(IRepositorioApu repositorio, int? presupuestoId, CancellationToken ct = default)
    {
        var catalogo = await repositorio.CargarCatalogoAsync(ct);
        var presupuesto = presupuestoId is { } id ? await repositorio.CargarPresupuestoAsync(id, catalogo, ct) : null;
        return new SesionCatalogo(catalogo, repositorio, presupuesto);
    }

    public Task CambiarPrecioAsync(int insumoId, decimal precio) =>
        AplicarAsync(insumoId, () => Catalogo[insumoId].FijarPrecioBase(precio),
            r => r.ActualizarPrecioAsync(insumoId, precio));

    public Task GuardarComponenteAsync(int padreId, ComponenteApu componente) =>
        AplicarAsync(padreId, () =>
        {
            if (Catalogo[padreId].Componentes.Any(c => c.HijoId == componente.HijoId)) Catalogo.ModificarComponente(padreId, componente);
            else Catalogo.AgregarComponente(padreId, componente);
        }, r => r.GuardarComponenteAsync(padreId, componente));

    public Task QuitarComponenteAsync(int padreId, int hijoId) =>
        AplicarAsync(padreId, () => Catalogo.QuitarComponente(padreId, hijoId),
            r => r.QuitarComponenteAsync(padreId, hijoId));

    public Task CambiarCargosAsync(int compuestoId, decimal herramienta, decimal seguridad) =>
        AplicarAsync(compuestoId, () => Catalogo[compuestoId].FijarCargosSobreManoObra(herramienta, seguridad),
            r => r.ActualizarCargosAsync(compuestoId, herramienta, seguridad));

    /// <summary>Recalcula todo el catálogo (F9): en memoria y, si hay base, también en el servidor.</summary>
    public async Task RecalcularTodoAsync()
    {
        Costos = MotorCostos.CalcularTodo(Catalogo);
        CostosActualizados?.Invoke(Catalogo.Insumos.Select(i => i.Id).ToList());
        if (_repositorio is not null) await _repositorio.RecalcularTodoAsync();
    }

    public ResultadoPresupuesto? CalcularPresupuesto() =>
        Presupuesto is null ? null : CalculadoraPresupuesto.Calcular(Presupuesto, Costos);

    public ResultadoExplosion? Explosionar() =>
        Presupuesto is null ? null : CalculadoraPresupuesto.Explosionar(Presupuesto, Catalogo, Costos);

    private async Task AplicarAsync(int insumoId, Action cambioLocal, Func<IRepositorioApu, Task>? persistir)
    {
        cambioLocal();                                   // valida reglas (tipos, ciclos) y lanza si no procede
        var recalculados = MotorCostos.Recalcular(Catalogo, Costos, [insumoId]);
        CostosActualizados?.Invoke(recalculados);
        if (_repositorio is null || persistir is null) return;
        try
        {
            await persistir(_repositorio);
        }
        catch (ReglaDeNegocioException)
        {
            await RecargarAsync();
            throw;
        }
    }

    public async Task RecargarAsync()
    {
        if (_repositorio is null) return;
        Catalogo = await _repositorio.CargarCatalogoAsync();
        if (Presupuesto is not null) Presupuesto = await _repositorio.CargarPresupuestoAsync(Presupuesto.Id, Catalogo);
        Costos = MotorCostos.CalcularTodo(Catalogo);
        Recargado?.Invoke();
    }
}
