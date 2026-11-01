using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Calculo;

/// <summary>Costos vigentes del catálogo, por insumo.</summary>
public sealed class ResultadoCostos
{
    private readonly Dictionary<int, Desglose> _desgloses = [];
    private readonly Dictionary<int, ResultadoFsr> _fsr = [];
    private readonly Dictionary<int, ResultadoCostoHorario> _horario = [];

    public IReadOnlyDictionary<int, Desglose> Desgloses => _desgloses;
    public IReadOnlyDictionary<int, ResultadoFsr> Fsr => _fsr;
    public IReadOnlyDictionary<int, ResultadoCostoHorario> CostoHorario => _horario;

    public decimal CostoDirecto(int insumoId) =>
        _desgloses.TryGetValue(insumoId, out var d) ? d.CostoDirecto
            : throw new ReglaDeNegocioException($"El insumo {insumoId} no se ha calculado");

    public Desglose Desglose(int insumoId) => _desgloses[insumoId];

    internal void Fijar(int id, Desglose d) => _desgloses[id] = d;
    internal void FijarFsr(int id, ResultadoFsr r) => _fsr[id] = r;
    internal void FijarHorario(int id, ResultadoCostoHorario r) => _horario[id] = r;
}

/// <summary>
/// Motor de costo directo. Resuelve el grafo de dependencias (matrices dentro de matrices,
/// maquinaria que depende de combustible y operador) de abajo hacia arriba.
/// <list type="number">
///   <item>Detecta ciclos antes de calcular (DFS iterativo: no desborda la pila en árboles profundos).</item>
///   <item>Ordena topológicamente: cada insumo se calcula después de todo aquello de lo que depende.</item>
///   <item>En recálculo incremental sólo procesa los insumos cambiados y sus ancestros.</item>
/// </list>
/// </summary>
public static class MotorCostos
{
    /// <summary>Calcula todo el catálogo.</summary>
    public static ResultadoCostos CalcularTodo(CatalogoInsumos catalogo)
    {
        var resultado = new ResultadoCostos();
        foreach (var id in OrdenTopologico(catalogo, catalogo.Insumos.Select(i => i.Id)))
            Evaluar(catalogo, resultado, catalogo[id]);
        return resultado;
    }

    /// <summary>
    /// Recalcula en cascada sólo lo afectado por un cambio en <paramref name="cambiados"/>
    /// (precio de un material, salario, una matriz…). Devuelve los ids recalculados en orden.
    /// </summary>
    public static IReadOnlyList<int> Recalcular(CatalogoInsumos catalogo, ResultadoCostos resultado, IEnumerable<int> cambiados)
    {
        var afectados = Ancestros(catalogo, cambiados);
        var orden = OrdenTopologico(catalogo, afectados).Where(afectados.Contains).ToList();
        foreach (var id in orden) Evaluar(catalogo, resultado, catalogo[id]);
        return orden;
    }

    private static void Evaluar(CatalogoInsumos catalogo, ResultadoCostos r, Insumo insumo)
    {
        switch (insumo.Tipo)
        {
            case TipoInsumo.MAT:
                r.Fijar(insumo.Id, Desglose.DeElemental(TipoInsumo.MAT, insumo.PrecioBase));
                break;

            case TipoInsumo.MO:
                var salario = insumo.PrecioBase;
                if (insumo.ManoObra is { } mo)
                {
                    if (!catalogo.ParametrosFsr.TryGetValue(mo.ParametrosFsrId, out var p))
                        throw new ReglaDeNegocioException($"{insumo.Clave}: parámetros de FSR {mo.ParametrosFsrId} inexistentes");
                    var fsr = CalculadoraFsr.Calcular(mo.SalarioNominal, p);
                    r.FijarFsr(insumo.Id, fsr);
                    salario = fsr.SalarioReal;
                }
                r.Fijar(insumo.Id, Desglose.DeElemental(TipoInsumo.MO, salario));
                break;

            case TipoInsumo.EQ:
                var costo = insumo.PrecioBase;
                if (insumo.Maquinaria is { } maq)
                {
                    var ch = CalculadoraCostoHorario.Calcular(maq, r.CostoDirecto);
                    r.FijarHorario(insumo.Id, ch);
                    costo = ch.CostoHorario;
                }
                r.Fijar(insumo.Id, Desglose.DeElemental(TipoInsumo.EQ, costo));
                break;

            default:
                r.Fijar(insumo.Id, EvaluarMatriz(insumo, r));
                break;
        }
    }

    /// <summary>
    /// CD = Σ cantidad efectiva × costo del componente
    ///    + herramienta menor (tasa × MO pendiente) + equipo de seguridad (tasa × MO pendiente).
    /// </summary>
    public static Desglose EvaluarMatriz(Insumo compuesto, ResultadoCostos r)
    {
        var suma = new Desglose();
        foreach (var c in compuesto.Componentes)
            suma += r.Desglose(c.HijoId).Escalar(c.CantidadEfectiva);

        var herramienta = suma.ManoObraPendienteHerramienta * compuesto.TasaHerramienta;
        var seguridad = suma.ManoObraPendienteSeguridad * compuesto.TasaEquipoSeguridad;
        return suma with
        {
            Herramienta = suma.Herramienta + herramienta,
            EquipoSeguridad = suma.EquipoSeguridad + seguridad,
            ManoObraPendienteHerramienta = compuesto.TasaHerramienta > 0 ? 0m : suma.ManoObraPendienteHerramienta,
            ManoObraPendienteSeguridad = compuesto.TasaEquipoSeguridad > 0 ? 0m : suma.ManoObraPendienteSeguridad,
            HerramientaPropia = herramienta,
            EquipoSeguridadPropio = seguridad,
        };
    }

    /// <summary>
    /// Orden en que se deben calcular <paramref name="ids"/> y todas sus dependencias
    /// (post-orden de un DFS iterativo). Lanza <see cref="ReferenciaCircularException"/> con la ruta del ciclo.
    /// </summary>
    public static List<int> OrdenTopologico(CatalogoInsumos catalogo, IEnumerable<int> ids)
    {
        const byte enProceso = 1, terminado = 2;
        var estado = new Dictionary<int, byte>();
        var orden = new List<int>();
        foreach (var raiz in ids)
        {
            if (estado.ContainsKey(raiz)) continue;
            // pila de (nodo, enumerador de dependencias) para no usar recursión
            var pila = new Stack<(int Id, IEnumerator<int> Deps)>();
            pila.Push((raiz, catalogo[raiz].Dependencias().GetEnumerator()));
            estado[raiz] = enProceso;
            while (pila.Count > 0)
            {
                var (id, deps) = pila.Peek();
                if (deps.MoveNext())
                {
                    var hijo = deps.Current;
                    if (!catalogo.Contiene(hijo))
                        throw new ReglaDeNegocioException($"{catalogo[id].Clave}: referencia a insumo inexistente {hijo}");
                    switch (estado.GetValueOrDefault(hijo))
                    {
                        case 0:
                            estado[hijo] = enProceso;
                            pila.Push((hijo, catalogo[hijo].Dependencias().GetEnumerator()));
                            break;
                        case enProceso:
                            var ciclo = pila.Select(x => x.Id).Reverse().SkipWhile(x => x != hijo).Append(hijo);
                            throw new ReferenciaCircularException(ciclo.Select(x => catalogo[x].Clave).ToList());
                    }
                }
                else
                {
                    pila.Pop();
                    estado[id] = terminado;
                    orden.Add(id);
                }
            }
        }
        return orden;
    }

    /// <summary>Los insumos dados más todos los que dependen de ellos, directa o indirectamente.</summary>
    public static HashSet<int> Ancestros(CatalogoInsumos catalogo, IEnumerable<int> semillas)
    {
        var dependientes = new Dictionary<int, List<int>>();
        foreach (var i in catalogo.Insumos)
            foreach (var d in i.Dependencias())
                (dependientes.TryGetValue(d, out var l) ? l : dependientes[d] = []).Add(i.Id);

        var visto = new HashSet<int>(semillas);
        var cola = new Queue<int>(visto);
        while (cola.Count > 0)
            foreach (var p in dependientes.GetValueOrDefault(cola.Dequeue()) ?? [])
                if (visto.Add(p)) cola.Enqueue(p);
        return visto;
    }
}
