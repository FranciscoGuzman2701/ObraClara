using ObraClara.Apu.Domain.Contabilidad;

namespace ObraClara.Apu.Application.Contabilidad;

/// <summary>
/// Contabilidad de ejemplo con la estructura del cliente: una sola cuenta por concepto contable
/// (501-01-001 Sueldos y salarios…) y unidades de negocio P3 → zona → obra pública / privada.
/// Mismo contenido que db/06_contabilidad.sql.
/// </summary>
public static class ContabilidadDemo
{
    public static LibroContable Crear()
    {
        var l = new LibroContable();
        foreach (var (clave, nombre, nat, afectable) in new (string, string, Naturaleza, bool)[]
        {
            ("100-000-000", "Activo", Naturaleza.Deudora, false),
            ("102-00-000", "Bancos", Naturaleza.Deudora, false),
            ("102-01-001", "Banco cuenta de cheques", Naturaleza.Deudora, true),
            ("115-00-000", "Inventarios", Naturaleza.Deudora, false),
            ("115-01-001", "Almacén de materiales", Naturaleza.Deudora, true),
            ("200-000-000", "Pasivo", Naturaleza.Acreedora, false),
            ("201-00-000", "Proveedores", Naturaleza.Acreedora, false),
            ("201-01-001", "Proveedores nacionales", Naturaleza.Acreedora, true),
            ("500-000-000", "Costos", Naturaleza.Deudora, false),
            ("501-00-000", "Costos de venta y/o servicio", Naturaleza.Deudora, false),
            ("501-01-000", "C de S SAPAL", Naturaleza.Deudora, false),
            ("501-01-001", "Sueldos y salarios", Naturaleza.Deudora, true),
            ("501-01-002", "Aguinaldo exento", Naturaleza.Deudora, true),
            ("501-01-004", "Vacaciones", Naturaleza.Deudora, true),
            ("501-01-012", "BRATE supervisión de construcción", Naturaleza.Deudora, true),
            ("501-01-013", "Viáticos", Naturaleza.Deudora, true),
            ("501-01-015", "Materiales", Naturaleza.Deudora, true),
            ("501-01-018", "Equipo de seguridad", Naturaleza.Deudora, true),
            ("501-01-019", "Herramienta y equipo menor", Naturaleza.Deudora, true),
            ("501-01-020", "Renta de oficina", Naturaleza.Deudora, true),
            ("501-01-021", "Papelería y art. de oficina", Naturaleza.Deudora, true),
        })
            l.GuardarCuenta(new CuentaContable(clave, nombre, nat, afectable, null, afectable && clave.StartsWith('5')));

        foreach (var (clave, desc) in new[]
        {
            ("100", "P3"), ("100-001", "ZONA CENTRO"), ("100-001-001", "OBRA PUBLICA"), ("100-001-002", "OBRA PRIVADA"),
            ("100-002", "ZONA NORTE"), ("100-002-001", "OBRA PUBLICA"), ("100-002-002", "OBRA PRIVADA"),
            ("100-003", "ZONA SUR"), ("100-003-001", "OBRA PUBLICA"), ("100-003-002", "OBRA PRIVADA"),
        })
            l.GuardarUnidad(new UnidadNegocio(clave, desc));

        l.GuardarProyecto(new Proyecto("VIV-01", "Casa habitación tipo", "100-001-002", PresupuestoId: 1));
        l.GuardarProyecto(new Proyecto("CAR-02", "Carretera Saltillo – Monterrey", "100-002-001"));
        l.GuardarProyecto(new Proyecto("HOS-03", "Hospital regional Mérida", "100-003-001"));
        l.GuardarProyecto(new Proyecto("PLZ-04", "Plaza comercial Sur", "100-003-002"));
        l.GuardarProyecto(new Proyecto("CORP", "Oficina corporativa", "100"));

        var folio = 0;
        void Poliza(string fecha, string concepto, string cuentaContra, params (string Cuenta, string Proyecto, decimal Importe)[] cargos)
        {
            var movs = cargos.Select(c => new Movimiento(c.Cuenta, c.Proyecto, c.Importe, 0, Concepto: concepto)).ToList();
            movs.Add(new Movimiento(cuentaContra, null, 0, cargos.Sum(c => c.Importe), Concepto: concepto));
            l.Registrar(new Poliza($"D-{++folio:000}", DateOnly.Parse(fecha), concepto, movs));
        }
        // nómina: una sola cuenta de sueldos, cada renglón con su proyecto
        Poliza("2026-09-30", "Nómina septiembre", "102-01-001",
            ("501-01-001", "VIV-01", 61_000m), ("501-01-001", "CAR-02", 184_000m), ("501-01-001", "HOS-03", 142_500m),
            ("501-01-001", "PLZ-04", 98_300m), ("501-01-001", "CORP", 120_000m));
        Poliza("2026-10-31", "Nómina octubre", "102-01-001",
            ("501-01-001", "VIV-01", 58_400m), ("501-01-001", "CAR-02", 191_200m), ("501-01-001", "HOS-03", 150_800m),
            ("501-01-001", "PLZ-04", 101_900m), ("501-01-001", "CORP", 120_000m));
        // materiales: salidas de almacén a obra
        Poliza("2026-10-15", "Salidas de almacén octubre", "115-01-001",
            ("501-01-015", "VIV-01", 59_700m), ("501-01-015", "CAR-02", 412_000m), ("501-01-015", "HOS-03", 268_400m),
            ("501-01-015", "PLZ-04", 187_600m));
        Poliza("2026-10-20", "Supervisión, seguridad y herramienta", "201-01-001",
            ("501-01-012", "CAR-02", 48_000m), ("501-01-012", "HOS-03", 36_000m), ("501-01-018", "VIV-01", 4_100m),
            ("501-01-018", "CAR-02", 9_800m), ("501-01-019", "VIV-01", 5_100m), ("501-01-019", "PLZ-04", 6_300m),
            ("501-01-013", "CAR-02", 22_400m));
        Poliza("2026-10-31", "Gastos de oficina", "201-01-001",
            ("501-01-020", "CORP", 45_000m), ("501-01-021", "CORP", 3_800m));
        return l;
    }
}
