using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Presupuestos;

public enum TipoPartida : byte { Capitulo = 1, Subcapitulo = 2, Concepto = 3 }

public sealed record PartidaPresupuesto
{
    public required int Id { get; init; }
    public int? PadreId { get; init; }
    public required TipoPartida Tipo { get; init; }
    public required string Clave { get; init; }
    public string Descripcion { get; init; } = "";
    public int Orden { get; init; }
    /// <summary>Concepto de obra del catálogo (sólo en partidas tipo Concepto).</summary>
    public int? InsumoId { get; init; }
    /// <summary>Volumen de obra (sólo en partidas tipo Concepto).</summary>
    public decimal Cantidad { get; init; }
}

/// <summary>Árbol Capítulo → Subcapítulo → Concepto de un presupuesto.</summary>
public sealed class Presupuesto
{
    private readonly Dictionary<int, PartidaPresupuesto> _partidas = [];

    public Presupuesto(int id, string clave, string nombre, ParametrosSobrecosto sobrecosto)
    {
        sobrecosto.Validar();
        (Id, Clave, Nombre, Sobrecosto) = (id, clave, nombre, sobrecosto);
    }

    public int Id { get; }
    public string Clave { get; }
    public string Nombre { get; }
    public ParametrosSobrecosto Sobrecosto { get; }
    public IReadOnlyCollection<PartidaPresupuesto> Partidas => _partidas.Values;

    public void Agregar(PartidaPresupuesto p, CatalogoInsumos catalogo)
    {
        if (_partidas.ContainsKey(p.Id)) throw new ReglaDeNegocioException($"Partida {p.Id} duplicada");
        if (p.PadreId is { } padreId)
        {
            if (!_partidas.TryGetValue(padreId, out var padre)) throw new ReglaDeNegocioException($"{p.Clave}: la partida padre no existe");
            if (padre.Tipo == TipoPartida.Concepto) throw new ReglaDeNegocioException($"{p.Clave}: un concepto no puede tener partidas hijas");
            if (p.Tipo == TipoPartida.Capitulo && padre.Tipo != TipoPartida.Capitulo)
                throw new ReglaDeNegocioException($"{p.Clave}: un capítulo sólo puede colgar de otro capítulo");
        }
        else if (p.Tipo != TipoPartida.Capitulo)
            throw new ReglaDeNegocioException($"{p.Clave}: el primer nivel del presupuesto son capítulos");

        if (p.Tipo == TipoPartida.Concepto)
        {
            if (p.InsumoId is not { } insumoId || catalogo[insumoId].Tipo != TipoInsumo.CON)
                throw new ReglaDeNegocioException($"{p.Clave}: la partida debe apuntar a un concepto de obra del catálogo");
            if (p.Cantidad < 0) throw new ReglaDeNegocioException($"{p.Clave}: la cantidad no puede ser negativa");
        }
        else if (p.InsumoId is not null)
            throw new ReglaDeNegocioException($"{p.Clave}: capítulos y subcapítulos no llevan concepto");
        _partidas.Add(p.Id, p);
    }

    public IEnumerable<PartidaPresupuesto> Hijas(int? padreId) =>
        _partidas.Values.Where(p => p.PadreId == padreId).OrderBy(p => p.Orden).ThenBy(p => p.Id);

    public IEnumerable<PartidaPresupuesto> Conceptos => _partidas.Values.Where(p => p.Tipo == TipoPartida.Concepto);
}
