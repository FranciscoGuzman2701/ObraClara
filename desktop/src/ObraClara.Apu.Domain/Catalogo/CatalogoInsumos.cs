namespace ObraClara.Apu.Domain.Catalogo;

/// <summary>
/// Catálogo maestro (raíz de agregado): garantiza claves únicas, tipos válidos en las
/// matrices y ausencia de referencias circulares en cada modificación.
/// </summary>
public sealed class CatalogoInsumos
{
    private readonly Dictionary<int, Insumo> _porId = [];
    private readonly Dictionary<string, Insumo> _porClave = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, ParametrosFsr> _fsr = [];

    public IReadOnlyCollection<Insumo> Insumos => _porId.Values;
    public IReadOnlyDictionary<int, ParametrosFsr> ParametrosFsr => _fsr;

    public Insumo this[int id] => _porId.TryGetValue(id, out var i) ? i : throw new ReglaDeNegocioException($"Insumo {id} inexistente");
    public Insumo? PorClave(string clave) => _porClave.GetValueOrDefault(clave.Trim());
    public bool Contiene(int id) => _porId.ContainsKey(id);

    public void AgregarParametrosFsr(ParametrosFsr p)
    {
        p.Validar();
        _fsr[p.Id] = p;
    }

    public Insumo Agregar(Insumo insumo)
    {
        if (_porId.ContainsKey(insumo.Id)) throw new ReglaDeNegocioException($"Id {insumo.Id} duplicado");
        if (_porClave.ContainsKey(insumo.Clave)) throw new ReglaDeNegocioException($"La clave {insumo.Clave} ya existe");
        _porId.Add(insumo.Id, insumo);
        _porClave.Add(insumo.Clave, insumo);
        return insumo;
    }

    public void AgregarComponente(int padreId, ComponenteApu componente)
    {
        var (padre, hijo) = (this[padreId], this[componente.HijoId]);
        ValidarArista(padre, hijo);
        padre.AgregarComponenteSinValidarGrafo(componente);
    }

    public void ModificarComponente(int padreId, ComponenteApu componente) => this[padreId].ReemplazarComponente(componente);

    public bool QuitarComponente(int padreId, int hijoId) => this[padreId].QuitarComponente(hijoId);

    private void ValidarArista(Insumo padre, Insumo hijo)
    {
        if (!padre.Tipo.EsCompuesto()) throw new ReglaDeNegocioException($"{padre.Clave}: sólo los compuestos tienen matriz");
        if (hijo.Tipo == TipoInsumo.CON)
            throw new ReglaDeNegocioException($"{hijo.Clave}: un concepto de obra no puede ser componente; conviértalo en básico");
        // ¿el hijo llega al padre? entonces la nueva arista cerraría un ciclo
        var ruta = BuscarRuta(hijo.Id, padre.Id);
        if (ruta is not null || padre.Id == hijo.Id)
            throw new ReferenciaCircularException([padre.Clave, .. (ruta ?? [hijo.Id]).Select(id => this[id].Clave)]);
    }

    /// <summary>Ruta de dependencias de <paramref name="desde"/> a <paramref name="hasta"/> (BFS), o null.</summary>
    private List<int>? BuscarRuta(int desde, int hasta)
    {
        var previo = new Dictionary<int, int> { [desde] = desde };
        var cola = new Queue<int>([desde]);
        while (cola.Count > 0)
        {
            var actual = cola.Dequeue();
            if (actual == hasta)
            {
                var ruta = new List<int> { actual };
                while (actual != desde) ruta.Add(actual = previo[actual]);
                ruta.Reverse();
                return ruta;
            }
            foreach (var d in this[actual].Dependencias())
                if (previo.TryAdd(d, actual)) cola.Enqueue(d);
        }
        return null;
    }
}
