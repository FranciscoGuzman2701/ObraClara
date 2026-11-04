# Checador

Checador digital de asistencia para un grupo de empresas (P3 y las otras cuatro). Cada empresa lleva su propio registro y la dirección del grupo puede ver las cinco juntas.

Es una app independiente: tiene su propia base de datos, su servidor y su web. No depende de ObraClara.

| Quién | Dónde | Qué hace |
|---|---|---|
| Trabajador | Celular (se instala como app) | Registra entrada, descanso, regreso y salida con un toque, incluso sin señal. Revisa sus horas de cada periodo y las acepta u objeta. |
| Tableta compartida | Kiosco | El trabajador teclea su número y su PIN. |
| Supervisor | Panel | Ve en vivo cómo va el equipo y qué necesita atención. |
| RH | Panel | Lo del supervisor, más correcciones, trabajadores, centros, kioscos, accesos y cierre de periodos (con CSV para nómina). |
| Administrador / dueño | Panel | Todo lo anterior, la configuración de la empresa y la vista del **grupo** (las 5 empresas lado a lado). |

## Arranque

Requisitos: Node 22, pnpm 10 y PostgreSQL 16 (o Docker).

```bash
cd checador
docker compose up -d          # PostgreSQL en el puerto 5433
cp .env.example .env
pnpm install
set -a; source .env; set +a
pnpm db:reset                 # crea el esquema y carga los datos de ejemplo
pnpm dev                      # API :3100 y web :5173 (abra http://localhost:5173)
```

Para producción: `pnpm build && pnpm start`. Un solo proceso en el puerto 3100 sirve el API y la web compilada. Se necesita HTTPS para que el celular permita usar el GPS y para instalar la app.

### Cuentas de ejemplo (contraseña `demo1234`)

| Cuenta | Para probar |
|---|---|
| `dueno@grupo.mx` | Administrador de las 5 empresas: menú **Grupo** y selector de empresa |
| `rh@p3.mx` | RH de P3: tablero, correcciones, periodos, altas |
| `supervisor@p3.mx` | Supervisor de P3: solo consulta |
| `ana@p3.mx`, `diego@p3.mx`, `sofia@p3.mx` | Trabajadores de P3 que checan desde su celular |
| `rh@e2.mx` | RH de la Empresa 2, para comprobar que no ve nada de P3 |

**Kiosco:** abra `http://localhost:5173/#/kiosco` y use el código `demo-kiosco-centro` o `demo-kiosco-norte`. Los PIN son: 014 → 1234, 015 → 2345, 016 → 3456.

Los datos de ejemplo incluyen una semana de asistencia, un periodo cerrado (Ana aceptó y Sofía objetó) y checadas de hoy con un fuera de zona y alguien que no ha llegado.

Las empresas E2 a E5 traen nombres genéricos. Se cambian en **Ajustes** con la cuenta del administrador.

## Cómo se lleva el registro por empresa

- **Una base, separada por empresa con Row Level Security.** Cada tabla de negocio tiene `empresa_id`. El servidor abre cada transacción con el rol `checador_app`, que no puede saltarse RLS, y fija la empresa de la sesión. Si una consulta olvida filtrar, PostgreSQL aun así no devuelve filas de otra empresa. Esto se verifica en `server/test/base.test.ts`.
- **Llaves compuestas `(empresa_id, …)`.** Una checada de P3 no puede apuntar a un trabajador ni a un centro de E2.
- **Por empresa** son la numeración de trabajadores, los centros, los kioscos, la tolerancia de retardo, la zona horaria y los periodos. Cerrar la quincena de P3 no afecta a E2.
- **Una cuenta por persona y una membresía por empresa.** La misma persona puede ser ADMIN en P3 y SUPERVISOR en E4. Cambia de empresa desde el panel sin volver a escribir su contraseña.
- **Vista del grupo.** Recorre cada empresa con la sesión de *esa* empresa (con RLS) y junta los resúmenes. Solo aparecen las empresas donde la persona es supervisor o más.
- **Contraseñas aisladas.** El rol de aplicación no puede leer la tabla `cuentas`. Las altas de usuarios pasan por dos funciones `SECURITY DEFINER` acotadas.

## Reglas (viven en PostgreSQL)

Aplican igual desde el celular, el kiosco, la cola sin señal o un script:

- **Geocerca** (modalidad *lugar fijo*). Fuera del radio, la checada **se registra y queda marcada** `FUERA_DE_ZONA`, con la distancia. Se tolera la imprecisión del GPS (hasta 100 m).
- **Secuencia** entrada → descanso → regreso → salida. Lo que no sigue el orden queda marcado `SECUENCIA`. Pasadas 16 h sin movimiento empieza otra jornada.
- **Retardo:** primera entrada del día después de la hora de entrada más la tolerancia de la empresa. El tablero avisa además de quien **no ha llegado**.
- **Rechazos:** doble toque (el mismo tipo en menos de 2 min), hora en el futuro, más de 7 días de antigüedad (eso lo captura RH), una modalidad no habilitada o un periodo cerrado.
- **Libro inmutable.** Las checadas no se editan ni se borran. RH corrige con una checada de supervisor (con motivo obligatorio) o anula con motivo. Todo queda a la vista.
- **Cierre de periodo.** Congela por trabajador las horas, los días, los retardos, las incidencias, las correcciones y las jornadas sin salida. Desde ese momento nadie checa ni corrige dentro del periodo. Cada trabajador responde una sola vez; si objeta, debe explicar el motivo.
- **Kiosco.** Usa un token propio por tableta (RH lo genera y lo puede desactivar). El PIN se guarda con bcrypt y se bloquea 15 min después de 5 intentos fallidos.

## Sin señal

La app del trabajador guarda cada checada en el teléfono con su hora real y un `client_uuid`, y la envía en lote (`/api/yo/checadas/lote`) en cuanto hay conexión. Reenviar no duplica. Un service worker permite abrir la app sin red. El kiosco, en cambio, sí requiere conexión: el PIN se valida en el servidor y no se guarda en la tableta.

## Estructura

```
server/
  db/migrations/   esquema, reglas, RLS (001) y funciones de cuentas (002)
  db/seed.sql      datos de ejemplo (grupo con 5 empresas)
  src/             Fastify: sesion.ts (JWT, permisos, kiosco), servicios.ts, rutas/
  test/            API completo y garantías de la base contra PostgreSQL real
web/
  src/pantallas/   Checar (celular), Kiosco, Equipo, Trabajadores, Centros, Kioscos, Usuarios, Periodos, Grupo, Ajustes
  src/cola.ts      cola sin señal
  src/jornada.ts   reglas y textos que la app necesita sin conexión
```

## Pruebas

```bash
pnpm typecheck && pnpm test     # API, base de datos, cola sin señal y reglas de jornada
```

Las pruebas usan `TEST_DATABASE_URL`: la base se borra y se vuelve a crear en cada corrida.

## Pendiente

- Inicio de sesión por código SMS/WhatsApp para trabajadores sin correo.
- Horarios por día de la semana y turnos nocturnos (hoy hay una sola hora de entrada por trabajador).
- Notificaciones push a RH (fuera de zona, no ha llegado).
- Formato del CSV adaptado al sistema de nómina de cada empresa.
