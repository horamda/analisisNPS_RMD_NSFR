# analisisNPS_RMD_NSFR

Dashboard operativo RMD, NPS y NS FR construido con Vite + React.

## Desarrollo local

1. Instala dependencias:

```bash
npm install
```

2. Crea un archivo `.env` con tus keys de IA:

```env
AI_PROVIDER=gemini
AI_FALLBACK_PROVIDER=groq

GEMINI_API_KEY=tu_key_de_gemini
GEMINI_MODEL=gemini-2.5-flash

GROQ_API_KEY=gsk_tu_key_real
GROQ_MODEL=openai/gpt-oss-20b
```

El orden recomendado es Gemini primero y Groq como respaldo. Si Gemini no esta configurado o falla, el proxy intenta Groq automaticamente. Si ambos fallan, el dashboard muestra el respaldo local para FODA e informe ejecutivo.

3. Ejecuta la app:

```bash
npm run dev
```

Abrir en el navegador:

```text
http://127.0.0.1:5173/
```

En Windows tambien podes usar:

```bat
dev.cmd
```

## Build

```bash
npm run build
```

En Windows tambien podes usar:

```bat
build.cmd
```

## Railway

El proyecto ya esta preparado para Railway:

- `railway.json` usa Nixpacks.
- Railway compila con `node node_modules/vite/bin/vite.js build`.
- Railway arranca con `node server.mjs`.
- `server.mjs` sirve la app desde `dist/` usando `process.env.PORT`.
- La IA usa Gemini primero y Groq como fallback.

Variables necesarias en Railway:

```text
AI_PROVIDER=gemini
AI_FALLBACK_PROVIDER=groq
GEMINI_API_KEY=tu_key_de_gemini
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=gsk_tu_key_real
GROQ_MODEL=openai/gpt-oss-20b
```

## Modulo de reclamos

**Regla de SLA para todos los tipos de reclamos:** la contestación debe realizarse dentro de los **3 días corridos desde el ingreso del reclamo**, incluidos sábados, domingos y feriados. El plazo se mide hasta la fecha de contestación (`answered_at`), no hasta el cierre o la resolución. Según el origen, la contestación se registra en `Fecha de contestacion`, `Fecha respuesta` o `FECHA RTA`. Actualmente el indicador lee `Cumplimiento SLA`; esta regla está documentada y visible, pero el plazo no se recalcula automáticamente a partir de esas fechas.

En **Inicio → Cumplimiento de SLA** se muestra el porcentaje por tipo, mes y año, con filtros combinables. Se consideran los reclamos que requieren gestión y se agrupan por su fecha de ingreso (`opened_at`). El cálculo usa el campo `Cumplimiento SLA`: `OK / (OK + NO OK) × 100`. Los valores vacíos o no reconocidos se muestran como **Sin evaluación** y no participan en el denominador. No se infiere el resultado a partir del estado del ticket ni se recalculan plazos. Los registros sin fecha aparecen únicamente sin filtros de mes/año. El porcentaje general se calcula sobre la suma de casos, no promediando porcentajes mensuales.

La app incluye una pestana nueva `Reclamos` para gestionar reclamos importados desde Excel y desde el Google Sheet historico.

Variables necesarias:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=false
JWT_SECRET=un_secreto_largo
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin1234
```

En Railway, `DATABASE_URL` debe venir de Postgres. No hardcodees la URL en el codigo. Si la conexion usa el host interno `postgres.railway.internal`, funciona desde Railway; para desarrollo local puede hacer falta la URL publica del servicio Postgres.

El primer arranque crea las tablas y el usuario admin si no existe. Desde `Reclamos` se puede:

- iniciar sesion;
- crear usuarios con roles `admin`, `user` o `viewer`;
- importar Excel por tipo: `NPS`, `RMD` o `BEES CARE`;
- migrar las pestanas publicadas del Sheet historico;
- gestionar estado, responsable, respuesta y action log sin pisar esos campos en futuras importaciones.

Las importaciones usan claves de deduplicacion por fuente. Cuando un reclamo ya existe, se actualizan solo datos de origen y se preservan los campos de gestion manual.

### Lectura y revisión de reclamos

- El nombre publicado es **Bees Care.**, con punto final. Las conexiones se identifican por `gid`; además, se valida que las columnas correspondan al tipo seleccionado.
- La vista **Bees Care.** muestra comentario, foto, fecha de contestación, quién contestó, respuesta, Action Log, días de resolución y SLA. Fecha y autor de la respuesta se editan en sus campos propios.
- Una respuesta sin estado explícito se importa como **En gestion**, nunca como cierre automático. La fecha de entrega de RMD no se utiliza como fecha de cierre del reclamo.
- Las filas del mismo caso se consolidan conservando comentarios, motivos y todas las filas originales en el detalle. Diferencias de puntaje, estado o SLA se envían a revisión.
- Las filas sin puntaje válido se conservan en el archivo y se contabilizan por motivo en el resultado de la importación. No se asume que sean positivas ni negativas. Los informes quedan disponibles al abrir un archivo conservado.
- El SLA sigue usando exclusivamente **Cumplimiento SLA**; una ausencia se informa como sin evaluación, sin inferir resultados del estado del ticket.
- Las reglas de importación están versionadas. Volver a importar permite recuperar motivos y respuestas faltantes. Los estados manuales se preservan; solo se corrige automáticamente de Nuevo a En gestion cuando hay respuesta de origen y no existe edición manual del estado.

Para subirlo:

1. Subi el repositorio a GitHub.
2. En Railway, crea un proyecto nuevo desde ese repo.
3. Railway detectara la configuracion y desplegara con `node server.mjs`.
