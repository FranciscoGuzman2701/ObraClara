# ObraClara

Control de obra para constructoras pequeñas y medianas: **reconciliación continua entre lo presupuestado, lo ejecutado físicamente y lo pagado**.

La propuesta técnica completa (arquitectura, roles, modelo de datos, reglas de negocio y hoja de ruta) está en [`docs/PROPUESTA.md`](docs/PROPUESTA.md).

## Estructura

```
apps/
  api/      API REST (NestJS) — auth, presupuesto, requisiciones, avances, sync offline, evidencias
  web/      Panel de oficina (Next.js) — obras, KPIs, presupuesto con saldos, aprobación de requisiciones
  field/    App de campo (Expo / React Native) — avances con foto y requisiciones sin señal
packages/
  db/         Migraciones SQL (esquema, triggers, vistas KPI, RLS), datos de desarrollo y prueba de reglas
  contracts/  Esquemas zod y tipos compartidos; semáforo del lado cliente
docs/
  PROPUESTA.md                       Propuesta técnica
  importacion/plantilla_presupuesto.csv
```

## Arranque local

Requisitos: Node 22, pnpm 10, Docker (o PostgreSQL 16 propio).

```bash
cp .env.example .env               # ajuste si es necesario
docker compose up -d               # PostgreSQL, Redis, MinIO
pnpm install
set -a; source .env; set +a
pnpm db:migrate                    # aplica packages/db/migrations
pnpm db:seed                       # Constructora Demo, obra OB-01 con presupuesto autorizado
pnpm build
pnpm dev                           # API :3001, web :3000, Expo (app de campo)
```

Usuarios de prueba (login de desarrollo, sin contraseña): `director@demo.mx`, `residente@demo.mx`, `compras@demo.mx`, `finanzas@demo.mx`, `cabo@demo.mx`.

App de campo: `pnpm --filter @obraclara/field dev` y abrir con Expo Go o un *development build*. En un teléfono físico, `EXPO_PUBLIC_API_URL` debe apuntar a la IP de su máquina, no a `localhost`.

> El usuario de base de datos que corre las migraciones necesita `CREATEROLE` (crea el rol `oc_app`). Con el `docker compose` incluido ya lo tiene.

## Pruebas

```bash
pnpm turbo run test --concurrency=1
```

| Paquete | Qué verifica |
|---|---|
| `@obraclara/db` | Migraciones sobre base vacía + 27 verificaciones de reglas de negocio en SQL (`demo_flujo.sql`) |
| `@obraclara/api` | 15 pruebas de integración contra PostgreSQL real: RLS entre empresas, permisos por rol, semáforo VERDE/AMARILLO/ROJO, excepciones, sync idempotente, evidencias, KPIs |
| `@obraclara/contracts` | Semáforo del lado cliente con los mismos casos que el SQL |
| `@obraclara/field` | Bandeja de salida offline: lotes, rechazos, caída de red a mitad del envío y reintento |

## Cómo está construido

- **Las reglas viven en la base de datos.** Ningún gasto existe sin línea de control (FKs compuestas), el presupuesto autorizado se congela, el libro mayor (`mov_presupuestales`) es append‑only y los triggers aplican el semáforo, la conciliación de 3 vías y las estimaciones de destajo. La API traduce esos errores a respuestas HTTP 422 legibles.
- **Multi‑empresa con Row Level Security.** Cada transacción de la API hace `SET LOCAL ROLE oc_app` y fija `oc.empresa_id`; las vistas usan `security_invoker` para respetar el RLS.
- **Offline por comandos.** La app no edita registros compartidos: encola comandos con `client_uuid` en SQLite y los envía a `POST /v1/sync/push` cuando hay señal. Reenviar es seguro. Las fotos suben directo al bucket con URL prefirmada y se ligan al registro con `POST /v1/archivos/confirmar`.
- **Acceso a datos con `pg` y SQL explícito** (no ORM) por ahora: las consultas se apoyan en vistas y triggers del esquema. Si crece la superficie CRUD, Drizzle o Kysely pueden convivir con las migraciones SQL existentes.

## API (resumen)

| Método | Ruta | Uso |
|---|---|---|
| POST | `/v1/auth/dev-login` | Token de desarrollo por correo (deshabilitado en producción) |
| GET | `/v1/obras` · `/v1/obras/:id/presupuesto` · `/v1/obras/:id/kpis` | Obras del usuario, presupuesto con saldos, indicadores |
| POST | `/v1/requisiciones/validar` | Semáforo de una línea sin crear nada |
| POST | `/v1/requisiciones` · `/:id/enviar` · `/:id/excepciones` · `/:id/aprobar` · `/:id/devolver` | Flujo de requisiciones |
| GET | `/v1/obras/:id/requisiciones` · `/v1/requisiciones/:id` | Bandeja y detalle |
| POST/GET | `/v1/obras/:id/avances` · `/v1/avances/:id/validar` · `/rechazar` | Avance físico |
| POST | `/v1/sync/push` · GET `/v1/sync/pull/:obraId` | Sincronización de la app de campo |
| POST | `/v1/archivos/prefirmar` · `/v1/archivos/confirmar` | Evidencias en S3/R2/MinIO |

## Pendiente para el MVP

Siguiendo la hoja de ruta de la propuesta: importador de presupuestos (Excel/CSV), órdenes de compra y recepciones en API/web, contratos y estimaciones de destajo en API/web (las reglas ya están en SQL), facturas y pagos, alertas programadas, autenticación por OTP y despliegue.
