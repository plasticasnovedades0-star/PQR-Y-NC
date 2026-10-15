# Gestión NC — Novedades de Producto No Conforme

App web para gestionar novedades de producto no conforme con trazabilidad completa:
fecha, área, orden de fabricación, operarios implicados (según código), unidades,
tratamiento, cierre e indicadores. Todo se exporta a un **archivo Excel (.xlsx) con las
fotos embebidas** para guardarlo en tu PC o OneDrive.

## Usuarios iniciales

| Usuario  | Contraseña    | Rol     |
|----------|---------------|---------|
| `gestion`| `Gestion2026` | Gestión |
| `reporte`| `Reporte2026` | Reporte |

- **Reporte**: crea novedades, adjunta hasta 10 fotos, consulta OF, ve indicadores y exporta.
- **Gestión**: todo lo anterior + cierra/elimina novedades, administra usuarios, operarios,
  catálogos y la conexión con la REST API.

Cambie las contraseñas desde el botón "Cambiar contraseña" tras el primer ingreso.

## Correr en su PC

**Opción 1 (recomendada):** doble clic en **`GestionNC.exe`** (dentro de la carpeta del proyecto).
Abre una consola con los logs, inicia el servidor y lanza el navegador. Cierra la ventana
para detener la app. Si la app ya está corriendo, solo abre el navegador.

**Opción 2 (terminal):**

```bash
npm install
npm start
# abrir http://localhost:3000
```

Los datos quedan en la carpeta `data/` (base SQLite `app.db` + carpeta `uploads/` con las fotos).

> **Novedades precargadas:** la carpeta `seed/` incluye las 45 novedades históricas con sus
> 54 fotos. En una instalación nueva (base vacía) se cargan solas al arrancar; para forzarlo:
> `npm run seed`.

**Acceso desde otros dispositivos de la red:** `http://<IP-de-este-PC>:3000`
(ej. `http://192.168.2.41:3000`). Requiere la regla de firewall "Gestion NC (TCP 3000)"
y que la red esté en perfil Privado (ya configuradas en esta máquina).

## Importar el CSV actual de gestión

La app ya incluye sus 43 registros históricos. Para reimportar o importar otro archivo:

```bash
node scripts/import-csv.js "C:\ruta\del\archivo.csv"
```

Los registros se insertan sin duplicar (respetan el ID original).

## Cargar las fotos de SharePoint a los reportes existentes

> **Estado:** los 43 registros históricos **ya tienen sus fotos importadas** (48 fotos).
> Estos pasos solo hacen falta si se repite el proceso para traer fotos nuevas.

**1. Descargar los adjuntos desde el navegador** (método que funciona sin permisos de TI):

1. Abra la lista "REPORTE Y SEGUIMIENTO DE HALLAZGOS" en SharePoint.
2. Presione **F12** → pestaña **Consola** (si el navegador avisa al pegar, escriba `allow pasting`).
3. Pegue todo el contenido de `scripts/download-attachments-browser.js` y pulse Enter.
4. Acepte "permitir múltiples descargas". Espera el mensaje verde **LISTO**.

Los archivos caen en la carpeta indicada con nombre `ID_Nombre.jpg` (el ID es el del reporte).

> Alternativa oficial `scripts/download-sharepoint-attachments.ps1` (PowerShell + PnP): requiere
> una aplicación de Entra ID aprobada por el administrador de Microsoft 365 (aprobación pendiente:
> app "Gestion NC PnP Edicion", Client ID `18a65534-4645-423c-a635-df72d5e1542a`).

**2. Revisar qué se importaría** (no escribe nada):

```bash
npm run import-photos -- "C:\ruta\con\las\fotos" --dry-run
```

**3. Importar:**

```bash
npm run import-photos -- "C:\ruta\con\las\fotos"
```

La importación respeta el límite de 10 fotos por reporte, omite archivos duplicados
(por contenido) y se puede repetir cuantas veces quiera sin dañar lo ya importado.
También acepta subcarpetas por ID (`45/foto.jpg`) o archivos sueltos `45_foto.jpg`.
Solo admite imágenes (JPG/PNG/GIF/BMP); los PDF se ignoran.

## Conectar la REST API de operarios por OF

Cuando tenga la API, entre a **Gestión → API de operarios** y configure:

- **URL base** (ej. `https://su-erp.com/api`) y **Ruta** con los comodines `{orden}` y `{fecha}`
  (ej. `/ordenes/{orden}`).
- **Headers** en JSON si requiere autenticación:
  `{"Authorization": "Bearer SU-TOKEN"}`
- **Mapa de campos**: dónde está el arreglo de operarios y los campos de código y nombre
  (ej. raíz `data`, operarios `operarios`, código `codigo`, nombre `nombre`).
- Active el estado a **"Conectada"** y use **"Probar con una OF"**.

Mientras la API esté desactivada, la app funciona en modo manual (el digitador escribe los
operarios o los elige del padrón). Las consultas quedan registradas para trazabilidad.

## Conexión con Elemental Web (operarios y OFs)

La app consulta **Elemental Web** (planta, `http://192.168.2.119`) para traer nombres de
operarios y las fechas de fabricación de las partes de una orden:

- **Credenciales**: `data/elemental-config.json` (fuera del código fuente). Se editan en
  **Gestión → API de operarios → Conexión con Elemental** (la clave nunca se muestra).
- **Operarios, búsqueda por fila**: en el formulario, cada fila de operario tiene su propio
  campo de código; al salir del campo la app busca el nombre en Elemental de forma
  independiente (`GET /api/manage/elemental-operario?codigo=479`).
- **Botón "Agregar operario"**: buscador por código o nombre contra Elemental
  (`GET /api/manage/elemental-operarios?q=...`), con respaldo al padrón local.
- **Botón "Consultar operarios implicados"**: con el N.° de OF trae (a) la OF **padre** y sus
  OFs **hijas** = partes del producto, cada una con su **fecha de fabricación**
  (`GET /api/manage/elemental-of?orden=17779`) y (b) los operarios que registraron producción
  en esa OF, con casillas para aplicarlos como filas nuevas.
- **Detalle de la novedad → "Ver en Elemental"**: muestra las partes y fechas de la OF.
- El listado de órdenes de Elemental (≈11 MB) se guarda en
  `data/workorders-cache.json` y se refresca automáticamente cada `woTtlHours` (12 h).
  **Gestión → API de operarios → "Refrescar órdenes"** lo fuerza.
- Cada consulta de OF queda auditada en la tabla `of_lookups` (fuente `ELEMENTAL`).

Si Elemental no responde, el formulario sigue funcionando manualmente (filas de operario
editables a mano).

## Exportar a Excel

Botón **"Exportar Excel (con fotos)"** en Novedades o en Indicadores. Genera un `.xlsx` con:

- Hoja **NOVEDADES**: todas las columnas del registro + columnas FOTO 1 a FOTO 10 con las
  imágenes embebidas.
- Hoja **INDICADORES**: resumen, totales por tipo/área/turno/estado/mes y top de operarios.
- Hoja **OPERARIOS**: padrón de códigos y nombres.

Se descarga el archivo y usted lo guarda donde quiera (PC, OneDrive, carpeta compartida).
No pide ningún usuario ni login de Microsoft.

## Despliegue en la nube (Render)

1. Suba la carpeta del proyecto a un repositorio de GitHub.
2. En [render.com](https://render.com) → **New → Web Service** → conecte el repositorio.
3. Render detecta el `render.yaml` (o use Dockerfile). Si lo configura a mano:
   - Runtime: **Docker**
   - Build: `npm install --omit=dev`
   - Start: `node server.js`
4. Active el **disco persistente** montado en `/app/data` (plan Starter o superior) para que
   la base de datos y las fotos sobrevivan los despliegues. En el plan gratuito los datos son
   volátiles: exporte el Excel con frecuencia.
5. Abra la URL asignada (ej. `https://gestion-nc.onrender.com`).

**Railway** también funciona: `railway up` con el mismo Dockerfile.

## Estructura

```
server.js              Servidor Express (API + estáticos)
src/db.js              Esquema SQLite y catálogos semilla
src/auth.js            Login JWT (cookie httpOnly) y roles
src/routes/reports.js  CRUD de novedades + fotos (máx. 10)
src/routes/manage.js   Usuarios, operarios, catálogos, config API, lookup OF
src/routes/indicators.js  Indicadores del dashboard
src/routes/export.js   Descarga del Excel
src/services/apiConnector.js  Conector configurable a la REST API
src/services/elemental.js  Conector a Elemental Web (token, empleados, OFs padre/hijos)
src/services/excelExport.js   Generador del .xlsx con fotos embebidas
scripts/import-csv.js  Importación del histórico CSV
scripts/import-photos.js  Importación de fotos por ID de reporte
scripts/download-attachments-browser.js  Descarga de adjuntos desde el navegador
scripts/download-sharepoint-attachments.ps1  Descarga vía PnP (requiere app aprobada)
public/                Interfaz (login, indicadores, novedades, gestión)
data/                  Base de datos, fotos y configuración (no versionar)
```

## Notas de seguridad

- Contraseñas con bcrypt; sesión en cookie httpOnly + JWT de 12 horas.
- Las fotos solo se sirven a usuarios autenticados.
- La configuración de la API (tokens) se guarda en `data/api-config.json` en el servidor,
  nunca en el navegador.
