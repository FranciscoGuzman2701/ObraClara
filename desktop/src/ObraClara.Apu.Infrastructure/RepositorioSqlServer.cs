using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using ObraClara.Apu.Application;
using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Infrastructure;

/// <summary>
/// Repositorio sobre SQL Server. Lee el catálogo completo en una sola ida (varios
/// result sets) y delega la cascada y los totales a los procedimientos almacenados,
/// que son transaccionales. Los errores de regla (THROW 5000x) llegan como
/// <see cref="ReglaDeNegocioException"/>.
/// </summary>
public sealed class RepositorioSqlServer(string cadenaConexion) : IRepositorioApu
{
    private async Task<SqlConnection> AbrirAsync(CancellationToken ct)
    {
        var cn = new SqlConnection(cadenaConexion);
        await cn.OpenAsync(ct);
        return cn;
    }

    public async Task<CatalogoInsumos> CargarCatalogoAsync(CancellationToken ct = default)
    {
        await using var cn = await AbrirAsync(ct);
        await using var grid = await cn.QueryMultipleAsync(new CommandDefinition("""
            SELECT ParametrosFsrId, Nombre, DiasCalendario, DiasAguinaldo, DiasVacaciones, TasaPrimaVacacional, Uma, TopeSbcEnUmas FROM apu.ParametrosFsr;
            SELECT ParametrosFsrId, Concepto, Dias FROM apu.ParametrosFsr_DiasNoLaborados;
            SELECT ParametrosFsrId, Concepto, BaseCalculo, Tasa FROM apu.ParametrosFsr_Cuotas;
            SELECT i.InsumoId, i.Clave, i.Descripcion, u.Clave AS Unidad, i.TipoInsumoId, i.PrecioBase, i.TasaHerramienta, i.TasaEquipoSeguridad
              FROM apu.Insumos i JOIN apu.UnidadesMedida u ON u.UnidadId = i.UnidadId;
            SELECT InsumoId, ParametrosFsrId, SalarioNominal FROM apu.Insumos_FSR_Detalle;
            SELECT * FROM apu.Insumos_CostoHorario_Detalle;
            SELECT PadreId, HijoId, Cantidad, Rendimiento, TasaMerma, Orden FROM apu.APU_Detalle;
            """, cancellationToken: ct));

        var fsr = (await grid.ReadAsync<FilaFsr>()).ToList();
        var dias = (await grid.ReadAsync<(int ParametrosFsrId, string Concepto, decimal Dias)>()).ToLookup(d => d.ParametrosFsrId);
        var cuotas = (await grid.ReadAsync<(int ParametrosFsrId, string Concepto, byte BaseCalculo, decimal Tasa)>()).ToLookup(c => c.ParametrosFsrId);
        var insumos = await grid.ReadAsync<FilaInsumo>();
        var mo = await grid.ReadAsync<(int InsumoId, int ParametrosFsrId, decimal SalarioNominal)>();
        var maquinas = await grid.ReadAsync<FilaCostoHorario>();
        var apu = await grid.ReadAsync<FilaApu>();

        var catalogo = new CatalogoInsumos();
        foreach (var f in fsr)
            catalogo.AgregarParametrosFsr(new ParametrosFsr
            {
                Id = f.ParametrosFsrId, Nombre = f.Nombre, DiasCalendario = f.DiasCalendario, DiasAguinaldo = f.DiasAguinaldo,
                DiasVacaciones = f.DiasVacaciones, TasaPrimaVacacional = f.TasaPrimaVacacional, Uma = f.Uma, TopeSbcEnUmas = f.TopeSbcEnUmas,
                DiasNoLaborados = dias[f.ParametrosFsrId].Select(d => new DiasNoLaborados(d.Concepto, d.Dias)).ToList(),
                Cuotas = cuotas[f.ParametrosFsrId].Select(c => new CuotaPatronal(c.Concepto, (BaseCuota)c.BaseCalculo, c.Tasa)).ToList(),
            });

        foreach (var f in insumos)
        {
            var i = catalogo.Agregar(new Insumo(f.InsumoId, f.Clave, f.Descripcion, f.Unidad, (TipoInsumo)f.TipoInsumoId));
            if (i.Tipo.EsCompuesto()) i.FijarCargosSobreManoObra(f.TasaHerramienta, f.TasaEquipoSeguridad);
            else i.FijarPrecioBase(f.PrecioBase);
        }
        foreach (var m in mo) catalogo[m.InsumoId].FijarManoObra(new DatosManoObra(m.SalarioNominal, m.ParametrosFsrId));
        foreach (var m in maquinas) catalogo[m.InsumoId].FijarMaquinaria(m.ADominio());
        // de arriba hacia abajo por padre: la validación de ciclos se hace igual, pero ya no puede fallar
        foreach (var a in apu.OrderBy(a => a.PadreId).ThenBy(a => a.Orden))
            catalogo.AgregarComponente(a.PadreId, new ComponenteApu
            {
                HijoId = a.HijoId, Cantidad = a.Cantidad, Rendimiento = a.Rendimiento, TasaMerma = a.TasaMerma, Orden = a.Orden,
            });
        return catalogo;
    }

    public async Task<IReadOnlyList<CostoGuardado>> CargarCostosAsync(CancellationToken ct = default)
    {
        await using var cn = await AbrirAsync(ct);
        var filas = await cn.QueryAsync<CostoGuardado>(new CommandDefinition("""
            SELECT InsumoId, CostoMaterial AS Material, CostoManoObra AS ManoObra, CostoEquipo AS Equipo,
                   CostoHerramienta AS Herramienta, CostoEquipoSeguridad AS EquipoSeguridad, CostoDirecto
              FROM apu.Insumos
            """, cancellationToken: ct));
        return filas.ToList();
    }

    public async Task<Presupuesto> CargarPresupuestoAsync(int presupuestoId, CatalogoInsumos catalogo, CancellationToken ct = default)
    {
        await using var cn = await AbrirAsync(ct);
        await using var grid = await cn.QueryMultipleAsync(new CommandDefinition("""
            SELECT e.PresupuestoId, e.Clave, e.Nombre, s.SobrecostoId, s.Nombre AS SobrecostoNombre, s.TasaIndirectoOficinaCentral,
                   s.TasaIndirectoCampo, s.TasaFinanciamiento, s.TasaUtilidad, s.DecimalesPrecioUnitario
              FROM apu.Presupuesto_Encabezado e JOIN apu.Sobrecostos s ON s.SobrecostoId = e.SobrecostoId
             WHERE e.PresupuestoId = @presupuestoId;
            SELECT c.Concepto, c.Tasa FROM apu.Sobrecostos_CargosAdicionales c
              JOIN apu.Presupuesto_Encabezado e ON e.SobrecostoId = c.SobrecostoId WHERE e.PresupuestoId = @presupuestoId;
            SELECT PartidaId, PadrePartidaId, TipoPartida, Clave, Descripcion, Orden, InsumoId, Cantidad
              FROM apu.Presupuesto_Detalle WHERE PresupuestoId = @presupuestoId;
            """, new { presupuestoId }, cancellationToken: ct));

        var e = await grid.ReadSingleOrDefaultAsync<FilaPresupuesto>()
            ?? throw new ReglaDeNegocioException($"Presupuesto {presupuestoId} inexistente");
        var cargos = await grid.ReadAsync<(string Concepto, decimal Tasa)>();
        var partidas = await grid.ReadAsync<FilaPartida>();

        var sobrecosto = new ParametrosSobrecosto
        {
            Id = e.SobrecostoId, Nombre = e.SobrecostoNombre, TasaIndirectoOficinaCentral = e.TasaIndirectoOficinaCentral,
            TasaIndirectoCampo = e.TasaIndirectoCampo, TasaFinanciamiento = e.TasaFinanciamiento, TasaUtilidad = e.TasaUtilidad,
            DecimalesPrecioUnitario = e.DecimalesPrecioUnitario,
            CargosAdicionales = cargos.Select(c => new CargoAdicional(c.Concepto, c.Tasa)).ToList(),
        };
        var p = new Presupuesto(e.PresupuestoId, e.Clave, e.Nombre, sobrecosto);
        foreach (var f in PadresPrimero(partidas.ToList()))
            p.Agregar(new PartidaPresupuesto
            {
                Id = f.PartidaId, PadreId = f.PadrePartidaId, Tipo = (TipoPartida)f.TipoPartida, Clave = f.Clave,
                Descripcion = f.Descripcion, Orden = f.Orden, InsumoId = f.InsumoId, Cantidad = f.Cantidad ?? 0,
            }, catalogo);
        return p;
    }

    public Task<int> ActualizarPrecioAsync(int insumoId, decimal precio, CancellationToken ct = default) =>
        EjecutarAsync(async cn =>
        {
            var prm = new DynamicParameters(new { InsumoId = insumoId, Precio = precio });
            prm.Add("Recalculados", dbType: DbType.Int32, direction: ParameterDirection.Output);
            await cn.ExecuteAsync(new CommandDefinition("apu.usp_ActualizarPrecioInsumo", prm,
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return prm.Get<int>("Recalculados");
        }, ct);

    public Task GuardarComponenteAsync(int padreId, ComponenteApu c, CancellationToken ct = default) =>
        EjecutarAsync(async cn =>
        {
            c.Validar();
            await using var tx = (SqlTransaction)await cn.BeginTransactionAsync(ct);
            await cn.ExecuteAsync(new CommandDefinition("""
                MERGE apu.APU_Detalle WITH (HOLDLOCK) AS t
                USING (SELECT @padreId AS PadreId, @HijoId AS HijoId) AS s ON t.PadreId = s.PadreId AND t.HijoId = s.HijoId
                WHEN MATCHED THEN UPDATE SET Cantidad = @Cantidad, Rendimiento = @Rendimiento, TasaMerma = @TasaMerma
                WHEN NOT MATCHED THEN INSERT (PadreId, HijoId, Cantidad, Rendimiento, TasaMerma, Orden)
                     VALUES (@padreId, @HijoId, @Cantidad, @Rendimiento, @TasaMerma,
                             ISNULL((SELECT MAX(Orden) FROM apu.APU_Detalle WHERE PadreId = @padreId), 0) + 1);
                """, new { padreId, c.HijoId, c.Cantidad, c.Rendimiento, c.TasaMerma }, tx, cancellationToken: ct));
            await CascadaAsync(cn, tx, padreId, ct);
            await tx.CommitAsync(ct);
            return 0;
        }, ct);

    public Task QuitarComponenteAsync(int padreId, int hijoId, CancellationToken ct = default) =>
        EjecutarAsync(async cn =>
        {
            await using var tx = (SqlTransaction)await cn.BeginTransactionAsync(ct);
            await cn.ExecuteAsync(new CommandDefinition("DELETE apu.APU_Detalle WHERE PadreId = @padreId AND HijoId = @hijoId",
                new { padreId, hijoId }, tx, cancellationToken: ct));
            await CascadaAsync(cn, tx, padreId, ct);
            await tx.CommitAsync(ct);
            return 0;
        }, ct);

    public Task RecalcularTodoAsync(CancellationToken ct = default) =>
        EjecutarAsync(cn => cn.ExecuteAsync(new CommandDefinition("apu.usp_RecalcularTodo",
            commandType: CommandType.StoredProcedure, commandTimeout: 600, cancellationToken: ct)), ct);

    public Task<IReadOnlyList<PartidaCalculada>> CalcularPresupuestoAsync(int presupuestoId, CancellationToken ct = default) =>
        EjecutarAsync<IReadOnlyList<PartidaCalculada>>(async cn =>
        {
            var filas = await cn.QueryAsync<FilaPartidaCalculada>(new CommandDefinition("apu.usp_CalcularPresupuesto",
                new { PresupuestoId = presupuestoId }, commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return filas.Select(f => new PartidaCalculada(f.PartidaId, f.PadrePartidaId, (TipoPartida)f.TipoPartida, f.Clave, f.Descripcion,
                f.ConceptoClave, f.Unidad, f.Cantidad, f.CostoDirectoUnitario, f.PrecioUnitario, f.Importe ?? 0)).ToList();
        }, ct);

    public Task<ResultadoExplosion> ExplosionAsync(int presupuestoId, CancellationToken ct = default) =>
        EjecutarAsync(async cn =>
        {
            await using var grid = await cn.QueryMultipleAsync(new CommandDefinition("apu.usp_ExplosionInsumos",
                new { PresupuestoId = presupuestoId }, commandType: CommandType.StoredProcedure, cancellationToken: ct));
            var insumos = (await grid.ReadAsync<FilaExplosion>())
                .Select(f => new InsumoExplosionado(f.InsumoId, f.Clave, f.Descripcion, f.Unidad, Enum.Parse<TipoInsumo>(f.Tipo.Trim()),
                    f.Cantidad, f.CostoUnitario, f.Importe)).ToList();
            var tot = await grid.ReadSingleAsync<(decimal Herramienta, decimal EquipoSeguridad, decimal? CostoDirectoTotal)>();
            return new ResultadoExplosion(insumos, tot.Herramienta, tot.EquipoSeguridad);
        }, ct);

    /// <summary>Ordena el árbol para que cada partida llegue después de su padre (BFS desde las raíces).</summary>
    private static IEnumerable<FilaPartida> PadresPrimero(List<FilaPartida> filas)
    {
        var hijas = filas.ToLookup(f => f.PadrePartidaId);
        var cola = new Queue<FilaPartida>(hijas[null]);
        while (cola.Count > 0)
        {
            var f = cola.Dequeue();
            yield return f;
            foreach (var h in hijas[f.PartidaId]) cola.Enqueue(h);
        }
    }

    private static Task CascadaAsync(SqlConnection cn, SqlTransaction tx, int insumoId, CancellationToken ct)
    {
        var semillas = new DataTable();
        semillas.Columns.Add("Id", typeof(int));
        semillas.Rows.Add(insumoId);
        return cn.ExecuteAsync(new CommandDefinition("apu.usp_RecalcularCascada",
            new { Semillas = semillas.AsTableValuedParameter("apu.ListaIds") }, tx,
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    /// <summary>Abre conexión y convierte los THROW de reglas (50000–50999) en excepciones de dominio.</summary>
    private async Task<T> EjecutarAsync<T>(Func<SqlConnection, Task<T>> accion, CancellationToken ct)
    {
        await using var cn = await AbrirAsync(ct);
        try
        {
            return await accion(cn);
        }
        catch (SqlException ex) when (ex.Number is >= 50000 and < 51000)
        {
            throw new ReglaDeNegocioException(ex.Message);
        }
    }

    private sealed record FilaFsr(int ParametrosFsrId, string Nombre, decimal DiasCalendario, decimal DiasAguinaldo,
        decimal DiasVacaciones, decimal TasaPrimaVacacional, decimal Uma, decimal TopeSbcEnUmas);
    private sealed record FilaInsumo(int InsumoId, string Clave, string Descripcion, string Unidad, byte TipoInsumoId,
        decimal PrecioBase, decimal TasaHerramienta, decimal TasaEquipoSeguridad);
    private sealed record FilaApu(int PadreId, int HijoId, decimal Cantidad, decimal? Rendimiento, decimal TasaMerma, short Orden);
    private sealed record FilaPresupuesto(int PresupuestoId, string Clave, string Nombre, int SobrecostoId, string SobrecostoNombre,
        decimal TasaIndirectoOficinaCentral, decimal TasaIndirectoCampo, decimal TasaFinanciamiento, decimal TasaUtilidad, byte DecimalesPrecioUnitario);
    private sealed record FilaPartida(int PartidaId, int? PadrePartidaId, byte TipoPartida, string Clave, string Descripcion,
        int Orden, int? InsumoId, decimal? Cantidad);
    private sealed record FilaPartidaCalculada(int PartidaId, int? PadrePartidaId, byte TipoPartida, string Clave, string Descripcion,
        int Orden, int? InsumoId, string? ConceptoClave, string? Unidad, decimal? Cantidad, decimal? CostoDirectoUnitario,
        decimal? PrecioUnitario, decimal? Importe);
    private sealed record FilaExplosion(int InsumoId, string Clave, string Descripcion, string Unidad, string Tipo,
        decimal Cantidad, decimal CostoUnitario, decimal Importe);

    private sealed class FilaCostoHorario
    {
        public int InsumoId { get; init; }
        public decimal PrecioAdquisicion { get; init; }
        public decimal ValorLlantas { get; init; }
        public decimal ValorPiezasEspeciales { get; init; }
        public decimal TasaValorRescate { get; init; }
        public decimal VidaEconomicaHoras { get; init; }
        public decimal HorasEfectivasAnio { get; init; }
        public decimal TasaInteresAnual { get; init; }
        public decimal TasaSeguroAnual { get; init; }
        public decimal CoeficienteMantenimiento { get; init; }
        public decimal PotenciaHp { get; init; }
        public decimal FactorOperacion { get; init; }
        public decimal CoeficienteCombustible { get; init; }
        public int? CombustibleInsumoId { get; init; }
        public decimal CapacidadCarterLitros { get; init; }
        public decimal HorasEntreCambios { get; init; }
        public decimal ConsumoAceiteHora { get; init; }
        public int? LubricanteInsumoId { get; init; }
        public decimal VidaLlantasHoras { get; init; }
        public decimal VidaPiezasHoras { get; init; }
        public int? OperadorInsumoId { get; init; }
        public decimal HorasEfectivasTurno { get; init; }

        public ParametrosCostoHorario ADominio() => new()
        {
            PrecioAdquisicion = PrecioAdquisicion, ValorLlantas = ValorLlantas, ValorPiezasEspeciales = ValorPiezasEspeciales,
            TasaValorRescate = TasaValorRescate, VidaEconomicaHoras = VidaEconomicaHoras, HorasEfectivasAnio = HorasEfectivasAnio,
            TasaInteresAnual = TasaInteresAnual, TasaSeguroAnual = TasaSeguroAnual, CoeficienteMantenimiento = CoeficienteMantenimiento,
            PotenciaHp = PotenciaHp, FactorOperacion = FactorOperacion, CoeficienteCombustible = CoeficienteCombustible,
            CombustibleInsumoId = CombustibleInsumoId, CapacidadCarterLitros = CapacidadCarterLitros, HorasEntreCambios = HorasEntreCambios,
            ConsumoAceiteHora = ConsumoAceiteHora, LubricanteInsumoId = LubricanteInsumoId, VidaLlantasHoras = VidaLlantasHoras,
            VidaPiezasHoras = VidaPiezasHoras, OperadorInsumoId = OperadorInsumoId, HorasEfectivasTurno = HorasEfectivasTurno,
        };
    }
}
