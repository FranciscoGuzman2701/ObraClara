# Checador digital para el grupo (P3 + 4 empresas)

Control de asistencia con el flujo que se ve en el video de referencia: **registra → donde sea → supervisa → cierra**. Está hecho para cinco empresas, no solo para P3. Cada empresa lleva su propio registro y la dirección del grupo puede ver las cinco a la vez.

## 1. Cómo se lleva el registro por empresa

### Decisión: una sola base, separada por `empresa_id` con Row Level Security

| Opción | Ventajas | Desventajas |
|---|---|---|
| **Una base, `empresa_id` + RLS** (la que se eligió) | Un solo despliegue y una sola migración para las 5. El consolidado del grupo es una consulta. Es el modelo que ObraClara ya usa en obras, requisiciones y pagos. | Hay que asegurar que ninguna consulta se salte el filtro. Por eso el filtro lo pone PostgreSQL (RLS) y no el código. |
| Una base por empresa | Aislamiento físico. Es lo que hace la contabilidad de escritorio (SQL Server). | Hay que migrar y respaldar 5 bases, y el consolidado obliga a consultar 5 servidores. Dar de alta una sexta empresa es un proyecto. |
| Una tabla con columna "empresa" sin RLS | Es lo más simple. | Basta un `WHERE` olvidado para que una empresa vea los datos de otra. |

Cómo queda en la práctica:

- Todas las tablas del checador tienen `empresa_id` y una política RLS: `empresa_id = current_setting('oc.empresa_id')`. La API abre cada transacción con el rol `oc_app` (que no puede saltarse RLS) y fija la empresa del token. Aunque una consulta olvide filtrar, PostgreSQL no devuelve filas de otra empresa.
- `empresas` también tiene RLS. Una empresa no ve ni el nombre de las demás.
- Las llaves foráneas son compuestas (`(empresa_id, trabajador_id)`, `(empresa_id, centro_id)`, `(empresa_id, usuario_id)`), así que una checada de P3 no puede apuntar a un trabajador o a un centro de E2.
- La numeración es por empresa: el trabajador "001" de P3 y el "001" de E2 son personas distintas.
- Los periodos (quincenas) también son por empresa. Cerrar la quincena de P3 no bloquea a E2.

### Personas que trabajan con varias empresas

Una persona (por ejemplo, la dirección del grupo) tiene **un usuario por empresa con el mismo correo**, cada uno con sus propios roles. Así puede ser DIRECTOR en P3 y solo RH en E4.

- `GET /v1/auth/empresas` lista las empresas a las que puede entrar con su correo.
- `POST /v1/auth/cambiar-empresa` emite un token para otra de sus empresas sin pedir de nuevo la contraseña. En la web es el selector de la barra superior.
- `GET /v1/grupo/asistencia` arma el consolidado. Recorre cada empresa **con la sesión de esa empresa**, de modo que el RLS se sigue aplicando, y devuelve una fila por empresa. Solo aparecen las empresas donde la persona es DIRECTOR, ADMIN o RH.

## 2. Qué hace (mapeo con el video)

| En el video | En ObraClara |
|---|---|
| "Un toque y listo": entrada, descanso, salida | `POST /v1/checador/checadas` con `ENTRADA · INICIO_DESCANSO · FIN_DESCANSO · SALIDA`. `GET /v1/checador/mi-dia` dice qué botón mostrar y regresa la bitácora del día. |
| "Incluso sin señal" | La app guarda la checada con su hora real y un `client_uuid` y la envía después a `POST /v1/checador/checadas/lote`. Reenviar el mismo lote es seguro: la segunda vez regresa `DUPLICADO`. |
| Lugar fijo con geocerca ("Solo dentro de la zona") | Modalidad `LUGAR_FIJO` contra `centros_trabajo` (lat, lng, radio). Si la checada cae fuera, **se registra y queda marcada** como `FUERA_DE_ZONA`, con la distancia en metros. |
| Desde casa / móvil (visitas a cliente) | Modalidades `DESDE_CASA` (sin geocerca) y `MOVIL` (guarda la ubicación sin restringirla). Cada trabajador tiene habilitadas solo las suyas. |
| Kiosco compartido (número + PIN) | Una tableta con un usuario de rol `KIOSCO` llama a `POST /v1/checador/kiosco` con `{numero, pin}`. Si no se manda el tipo, el sistema lo deduce (entrada → salida). El PIN se guarda con bcrypt y se bloquea 15 min después de 5 intentos fallidos. |
| "Ve lo que necesita atención" (tablero en vivo) | `GET /v1/checador/tablero` y la página `/checador`: cuántos están trabajando, en descanso, salieron o no han checado, más las incidencias del día. |
| "Sofía checó fuera de la zona" | Incidencias `FUERA_DE_ZONA`, `SIN_UBICACION` y `SECUENCIA` (por ejemplo, una salida sin entrada). |
| "1 corrección" | `POST /v1/checador/correcciones`: RH captura la checada con motivo obligatorio. `POST /v1/checador/checadas/:id/anular` anula con motivo. Nada se borra. |
| "Quincena del 1 al 15 · corte automático · Periodo cerrado" | `POST /v1/checador/periodos` y `/:id/cerrar`. Al cerrar se congelan por trabajador las horas, los días, las incidencias, las correcciones y las jornadas sin salida. Desde ese momento ya no se puede checar, corregir ni anular dentro del periodo. |
| "Cada quien acepta. Tú quedas respaldado" | `POST /v1/checador/periodos/:id/respuesta` con `{acepta: true}` u objeción con comentario. Solo se puede responder una vez. |

## 3. Reglas (viven en PostgreSQL)

Las reglas están en la base de datos y no en la app, para que valgan igual desde el celular, el kiosco, la sincronización sin señal o un script.

- **Inmutable:** `oc_app` solo puede hacer `SELECT` e `INSERT` sobre `checadas`. Una checada mal hecha se anula en `checadas_anuladas`, una tabla de solo inserción con motivo.
- **Horas trabajadas:** cuentan los tramos de `ENTRADA`/`FIN_DESCANSO` a la siguiente `INICIO_DESCANSO`/`SALIDA`, de máximo 16 h (`v_tramos_trabajo`). El descanso no cuenta. Una entrada sin salida no suma horas y aparece en `jornadas_abiertas`.
- **Día de la checada:** se calcula con la zona horaria de cada empresa (`empresas.zona_horaria`) y se guarda en `checadas.fecha`.
- **Rechazos:** una checada con hora en el futuro, una con más de 7 días de antigüedad (esa la debe capturar RH), una modalidad no habilitada, un doble toque del mismo tipo en menos de 2 min o una checada dentro de un periodo cerrado.
- **Periodos:** no se pueden traslapar dentro de la misma empresa y no se cierran antes de terminar.

## 4. Roles

| Rol (alcance empresa) | Puede |
|---|---|
| Trabajador (usuario ligado en `trabajadores.usuario_id`) | Checar desde su celular, ver su día, aceptar u objetar sus periodos |
| `KIOSCO` | Registrar checadas por número + PIN |
| `RH` | Tablero, alta de trabajadores y centros, correcciones, anulaciones, periodos |
| `DIRECTOR` / `ADMIN` | Todo lo anterior, y aparecen en el consolidado del grupo |
| `GERENTE_OBRA` | Consultar el tablero |

Un trabajador **no necesita ser usuario**: el que solo checa en kiosco existe únicamente como número + PIN.

## 5. Archivos

| Capa | Archivo |
|---|---|
| Esquema, reglas y RLS | `packages/db/migrations/0004_checador_multiempresa.sql` |
| Pruebas SQL de las reglas | `packages/db/demo_checador.sql` (se corre con `pnpm --filter @obraclara/db test`) |
| Datos de ejemplo (5 empresas) | `packages/db/seed_dev.sql` |
| Contratos (zod + tipos) | `packages/contracts/src/checador.ts` |
| API | `apps/api/src/checador/` y `apps/api/src/auth/auth.controller.ts` (empresas / cambiar-empresa) |
| Pruebas API | `apps/api/test/checador.e2e.test.ts` |
| Web | `apps/web/app/checador/`, `apps/web/app/grupo/`, selector de empresa en `Barra.tsx` |

## 6. Probarlo en local

```bash
pnpm db:migrate && pnpm db:seed
pnpm build && pnpm dev
```

Usuarios de prueba (login sin contraseña):

- `dueno@grupo.mx`: dirección con acceso a las 5 empresas. Abra **Grupo** o use el selector de la barra.
- `rh@p3.mx`: RH de P3 (tablero, periodos).
- `kiosco@p3.mx`: tableta de P3. Trabajadores `014` y `003` con PIN `1234`; el `002` también, indicando `centro_id`.
- `ana@p3.mx`: trabajadora que checa desde su celular.
- `rh@e2.mx`: RH de la Empresa 2, para comprobar que no ve nada de P3.

Las empresas `E2…E5` traen nombres genéricos. Renómbrelas con las reales:

```sql
UPDATE oc.empresas SET nombre = 'Nombre real', clave = 'XX', rfc = '…' WHERE clave = 'E2';
```

## 7. Siguientes pasos

1. **Pantalla "Checar" en la app de campo** (Expo). El API ya está listo (`mi-dia`, `checadas`, `checadas/lote`). Falta la pantalla con el botón grande y la reutilización de la bandeja SQLite que ya existe para avances, con un tipo de comando para checadas.
2. **Modo kiosco** en la app: pantalla fija con teclado numérico para número + PIN. La tableta se configura con su `centro_id`.
3. **Exportar a nómina:** CSV del periodo cerrado (horas por trabajador) con el formato que use cada empresa.
4. **Alertas:** aviso a RH cuando alguien cheque fuera de zona o no haya checado a su hora de entrada (horarios por trabajador).
5. **Producción:** login por OTP o proveedor de identidad (hoy es por correo y solo en desarrollo), alta de usuarios por empresa desde la web y, si hace falta, horarios y tolerancias por empresa en `empresas.config`.
