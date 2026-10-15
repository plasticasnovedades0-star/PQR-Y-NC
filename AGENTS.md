# AGENTS.md — Instrucciones para instalar, ejecutar y dejar funcionando la app

Estas instrucciones son para **humanos o agentes de IA** que reciban este proyecto y deban
dejarlo operativo desde cero. Síguelas en orden. No inventes pasos fuera de esta lista.

---

## 1. Qué es la app

**Gestión NC / PQR** — aplicación web para gestionar *novedades de producto no conforme*
(NC) y PQR, con tratamiento/cierre, fotos de evidencia, indicadores, exportación a Excel con
fotos embebidas y generación de un memorando en Word.

- **Backend**: Node.js + Express + SQLite (`better-sqlite3`), todo en un solo proceso.
- **Frontend**: HTML/CSS/JS vanilla servido desde `public/` (sin build ni framework).
- **Base de datos**: `data/app.db` (se crea sola en el primer arranque).
- **Fotos**: `data/uploads/` (se crea sola).
- **Puerto**: `3000` (o `PORT` si la variable de entorno existe).

## 2. Requisitos previos (qué instalar)

1. **Node.js >= 20** (verificar con `node --version`). Es lo único obligatorio.
2. **npm** (viene con Node).
3. `better-sqlite3` es una librería nativa: en Windows requiere **Visual C++ Build Tools**
   solo si no hay binario precompilado. Si `npm install` falla ahí, instala
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   con el workload "C++ build tools" y repite `npm install`.
4. Opcional: **Git** para clonar el repositorio.

No requiere: base de datos externa, Docker, Python, ni servicios en la nube.

## 3. Puesta en marcha (de cero)

```bash
# 1. Ir a la carpeta del proyecto
cd ruta/al/proyecto

# 2. Instalar dependencias
npm install

# 3. Arrancar
npm start
# (en desarrollo: npm run dev — reinicia solo al guardar)
```

**Novedades ya registradas**: el repositorio incluye la carpeta `seed/`
(`novedades.json` + `fotos.zip`) con las novedades del histórico. En una instalación
**nueva** (base de datos vacía) se cargan **automáticamente al arrancar**. Para
recargarlas a mano:

```bash
npm run seed
```

Esto inserta las novedades (sin duplicar), registra sus fotos en la BD y extrae las
imágenes a `data/uploads/<id>/`. Si la BD ya tiene novedades, `npm run seed` solo
agrega las que falten.

Verificar que funciona:

1. `http://localhost:3000/api/health` debe responder `{"ok":true,...}`.
2. Abrir `http://localhost:3000` → debe mostrarse la pantalla de login.
3. Iniciar sesión con las credenciales de abajo y comprobar que carga el panel.

**Windows (opcional alternativa al terminal):** doble clic en `GestionNC.exe` — consola con
logs + navegador. Equivalente a `npm start`.

**Si el puerto 3000 está ocupado** por otra instancia, máatala antes de arrancar
(proceso `node server.js` o `GestionNC.exe`) o define otro puerto: `$env:PORT=3001; npm start`.

## 4. Usuarios y contraseñas

Cuentas **sembradas** (el servidor las recrea automáticamente si faltan):

| Usuario  | Contraseña    | Rol     | Módulo        |
|----------|---------------|---------|---------------|
| `gestion`| `Gestion2026` | Gestión | NC y PQR      |
| `reporte`| `Reporte2026` | Reporte | NC y PQR      |

- **Reporte**: crea/edita novedades, fotos, indicadores, exporta.
- **Gestión**: todo lo anterior + cierra/elimina novedades, aprueba usuarios, catálogos,
  operarios, conexión con Elemental/API, accesos.
- Existe además un usuario `wilson` / `123456` (Gestión, módulo NC) si la base de datos
  incluida lo conserva.
- Cuentas nuevas creadas desde la UI quedan **pendientes de aprobación** y no pueden
  entrar hasta que un usuario de Gestión las apruebe.
- Tras 5 intentos fallidos la IP queda bloqueada 5 minutos (el bloqueo vive en memoria:
  reiniciar el servidor lo limpia).

**Los módulos NC y PQR son independientes**: mismo usuario puede existir en ambos, pero la
sesión de un módulo no sirve para el otro (tokens separados en `localStorage`).

## 5. Cómo debe funcionar la app (comportamiento esperado)

### Flujo principal (NC)

1. **Login** (`#/login`): usuario + contraseña; pantalla inicial permite elegir módulo
   (R = Reporte / G = Gestión) y listar usuarios de cada tipo o registrar uno nuevo.
2. **Novedades**: el rol Reporte crea novedades con: fecha, área que reporta, tipo de
   hallazgo, color de parte con error, referencia, orden de fabricación, turno, cantidad,
   operarios (búsqueda por código/nombre contra Elemental o manual) y descripción.
3. **Validaciones obligatorias**: mínimo **3 fotos de evidencia** (máx. 10 por sección),
   campos requeridos marcados con `*`.
4. **Tratamiento y cierre** (sección 4): tratamiento implementado, verificación de
   eficacia, responsable y fecha de cierre; con sus fotos de tratamiento (3–10).
5. **Memorando Word**: botón "📄 Memorando (Word)" en el detalle → modal con datos
   prellenados → descarga `Memorando-<id>.docx` desde la plantilla `Base memorando.docx`.
6. **Ventana de 20 minutos**: solo la propia novedad puede editarse/borrarse durante
   20 min; después solo rol Gestión puede modificarla.
7. **Indicadores**: unidades, tipos, áreas, turnos, estados, top operarios (gráficas
   Chart.js). **Exportar Excel (.xlsx)** con fotos embebidas en el archivo.

### Roles en detalle

- Reporte **no** puede cerrar/eliminar novedades ajenas ni aprobar usuarios.
- Gestión puede aprobar/eliminar usuarios, administrar catálogos y ver la pestaña
  **Gestión → Accesos** (log de accesos).

### Integración Elemental (solo lectura)

- Servidor interno `http://192.168.2.119` para nombres de operarios y OFs.
- Credenciales en `data/elemental-config.json` (fuera del código).
- **Solo GET**: nunca modificar ni borrar nada en Elemental.
- Si Elemental no responde, la app debe seguir funcionando en modo manual (no romper).
- Caché de órdenes: `data/workorders-cache.json` (TTL 12 h).

## 6. Estructura del código

```
server.js                 Servidor Express: monta routers, sirve public/, /api/health
src/db.js                 Esquema SQLite + migraciones + catálogos semilla (exports: db, DATA_DIR)
src/auth.js               Login JWT, roles, app por módulo (exports: router, requireAuth,
                          requireRole, requireApp)
src/routes/reports.js     CRUD novedades + fotos + POST /:id/memorando (Word)
src/routes/manage.js      Usuarios, catálogos, operarios, Elemental, accesos
src/routes/indicators.js  Indicadores (requiere sesión NC)
src/routes/export.js      Excel con fotos
src/services/elemental.js Cliente Elemental Web (token + endpoints)
src/services/apiConnector.js  Conector REST configurable de operarios por OF
src/services/excelExport.js   Generador del .xlsx
public/app.js             Toda la interfaz SPA (login, listado, detalle, indicadores,
                          gestión, usuarios, memorando)
public/styles.css         Estilos (incluye responsive móvil con .card-rows)
public/index.html         Shell de la app + plantillas
scripts/load-seed.js      Carga seed/novedades.json + seed/fotos.zip (npm run seed);
                          server.js la ejecuta solo si la BD está vacía
seed/novedades.json       45 novedades + metadatos de 54 fotos (para precargar)
seed/fotos.zip            54 fotos organizadas en subcarpetas <report_id>/
Base memorando.docx       PLANTILLA del memorando — NO borrar ni renombrar
GestionNC.exe             Lanzador opcional de Windows (inicia server.js + navegador)
```

### Convenciones

- Idioma de la interfaz y de los mensajes: **español**.
- Endpoints bajo `/api/...`; respuestas JSON con `{ error: "..." }` en fallos.
- Migraciones de BD: agregar `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` en `src/db.js`
  (el esquema se aplica al arrancar; **nunca** editar datos existentes a mano).
- Los archivos en `data/` **nunca** se versionan (`.gitignore` ya lo excluye).

## 7. Verificación final (checklist antes de dar por terminado)

- [ ] `npm install` sin errores.
- [ ] `node --check server.js` y `node --check` de cualquier archivo modificado.
- [ ] `GET http://localhost:3000/api/health` → `{"ok":true}`.
- [ ] **Novedades precargadas**: en instalación nueva, el listado debe mostrar las 45
      novedades con sus fotos (si está vacía, ejecutar `npm run seed` y revisar el log).
- [ ] Login con `gestion/Gestion2026` y con `reporte/Reporte2026` → OK.
- [ ] Crear una novedad de prueba con ≥3 fotos → aparece en el listado.
- [ ] Descargar el memorando Word desde el detalle → se abre en Word.
- [ ] Exportar Excel → el `.xlsx` descarga y abre.
- [ ] Acceso LAN: `http://192.168.2.41:3000` desde otro equipo (si aplica).

## 8. Errores comunes y solución

| Síntoma | Causa probable | Solución |
|---|---|---|
| `npm install` falla en `better-sqlite3` | Falta compilador C++ | Instalar VS Build Tools (ver §2.3) |
| EADDRINUSE en 3000 | Otra instancia corriendo | Matar proceso `node server.js` / `GestionNC.exe` |
| Login "cuenta pendiente" | Usuario recién registrado | Aprobarlo con un usuario de Gestión |
| "Demasiados intentos" | 5 logins fallidos | Esperar 5 min o reiniciar el servidor |
| Fotos no suben | Límite de ~10 MB por multipart | Comprimir imágenes; máx. 10 por sección |
| Elemental responde 403/timeout | Credenciales o red de planta | Revisar `data/elemental-config.json`; la app sigue manual |
| Cambios en BD no aplican | Migración no ejecutada | Reiniciar el servidor (aplica `src/db.js` al arrancar) |
| Memoria apagada sin cerrar | Proceso fantasma en puerto | Matar `node.exe` con CommandLine `server.js` |

## 9. Reglas de seguridad

- **No** subir a Git: `data/` (BD, fotos, credenciales), `.env`, `*.log`.
- **Nunca** imprimir ni exponer contraseñas/tokens en logs o respuestas API.
- Elemental: **solo lectura**.
- Roles: nunca conceder permisos de Gestión a cuentas de Reporte.

## 10. Despliegue (opcional)

- **Local/LAN**: `npm start` + regla de firewall TCP 3000 (ya existe en la máquina actual).
- **Nube**: `Dockerfile` y `render.yaml` incluidos → Render/Railway. Montar disco
  persistente en `/app/data` o los datos se pierden en cada despliegue.
- Repo GitHub remoto: `https://github.com/plasticasnovedades0-star/PQR-Y-NC.git`
  (rama `master`).
