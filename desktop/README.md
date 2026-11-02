# ObraClara Precios Unitarios (escritorio)

Presupuestación con análisis de precios unitarios para Windows: catálogo de insumos (MAT, MO, EQ, básicos y conceptos), FSR, costo horario, matrices anidadas con recálculo en cascada, pie de precio, presupuesto jerárquico y explosión de insumos.

**Stack:** C# .NET 8 · Avalonia 11 (MVVM) · SQL Server 2019+ · Clean Architecture.
Diseño completo, fórmulas y decisiones: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
Análisis de obra (dónde gana y pierde, alcance, desperdicio), PDF/CSV y conexión de departamentos: [`docs/ANALISIS_Y_DEPARTAMENTOS.md`](docs/ANALISIS_Y_DEPARTAMENTOS.md).

```
src/
  ObraClara.Apu.Domain          reglas y fórmulas (sin dependencias)
  ObraClara.Apu.Application     casos de uso, puertos, catálogo de ejemplo
  ObraClara.Apu.Infrastructure  repositorio SQL Server (Dapper)
  ObraClara.Apu.Desktop         interfaz Avalonia (ejecutable ObraClaraPU.exe)
db/                             01 esquema · 02 procedimientos · 03 datos de ejemplo · 04 prueba de carga · 05 control de obra
tests/                          dominio · SQL Server · interfaz sin pantalla
```

## Probarla en Windows

1. Instale el **SDK de .NET 8**: `winget install Microsoft.DotNet.SDK.8`.
2. Sin base de datos (catálogo de ejemplo en memoria):
   ```powershell
   cd desktop
   dotnet run --project src/ObraClara.Apu.Desktop
   ```
3. Con SQL Server (Express o LocalDB sirven):
   ```powershell
   sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "CREATE DATABASE ObraClaraApu COLLATE Modern_Spanish_CI_AS"
   sqlcmd -S "(localdb)\MSSQLLocalDB" -d ObraClaraApu -f 65001 -i db\01_esquema.sql
   sqlcmd -S "(localdb)\MSSQLLocalDB" -d ObraClaraApu -f 65001 -i db\02_programabilidad.sql
   sqlcmd -S "(localdb)\MSSQLLocalDB" -d ObraClaraApu -f 65001 -i db\03_datos_ejemplo.sql
   sqlcmd -S "(localdb)\MSSQLLocalDB" -d ObraClaraApu -f 65001 -i db\05_control_obra.sql
   dotnet run --project src/ObraClara.Apu.Desktop -- --sql "Server=(localdb)\MSSQLLocalDB;Database=ObraClaraApu;Trusted_Connection=True;TrustServerCertificate=True"
   ```
   También puede definir la variable `OBRACLARA_PU_SQLSERVER` con la cadena de conexión.
4. Ejecutable de un solo archivo:
   ```powershell
   dotnet publish src/ObraClara.Apu.Desktop -c Release -r win-x64 -p:PublishSingleFile=true -p:SelfContained=true -p:IncludeNativeLibrariesForSelfExtract=true -o publicar
   ```

## Pruebas

```bash
dotnet test                       # dominio + interfaz; las de SQL Server se omiten sin servidor
APU_SQLSERVER="Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=True" dotnet test
```

Las pruebas de SQL Server crean y borran su propia base temporal.
