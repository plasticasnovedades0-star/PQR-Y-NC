/*
  Descarga los adjuntos de la lista de SharePoint desde el navegador.
  Uso: abrir la lista en SharePoint -> F12 -> pestaña Consola -> pegar -> Enter.
  Los archivos se guardan en "Descargas" con nombre ID_NombreArchivo.jpg
  (el ID coincide con el ID del reporte en la app).
*/
(async () => {
  const LIST = 'REPORTE Y SEGUIMIENTO DE HALLAZGOS';
  const ORIGIN = location.origin;
  const SITE =
    (window._spPageContextInfo && window._spPageContextInfo.siteAbsoluteUrl) ||
    ORIGIN + ((location.pathname.match(/^\/personal\/[^/]+/) || [''])[0]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sanitize = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_');

  const resp = await fetch(
    SITE +
      "/_api/web/lists/getbytitle('" +
      encodeURIComponent(LIST) +
      "')/items?$select=ID,AttachmentFiles&$expand=AttachmentFiles&$top=5000",
    { headers: { accept: 'application/json;odata=nometadata' } }
  );
  if (!resp.ok) throw new Error('Error leyendo la lista: HTTP ' + resp.status);
  const data = await resp.json();
  const items = data.value || (data.d && data.d.results) || [];

  console.log('%cFilas en la lista: ' + items.length, 'color:blue;font-weight:bold');
  let files = 0;
  let rows = 0;

  for (const item of items) {
    const atts = Array.isArray(item.AttachmentFiles)
      ? item.AttachmentFiles
      : (item.AttachmentFiles && item.AttachmentFiles.results) || [];
    if (!atts.length) continue;
    rows++;
    for (const a of atts) {
      try {
        const r = await fetch(ORIGIN + a.ServerRelativeUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const name = item.ID + '_' + sanitize(a.FileName);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        files++;
        console.log('[' + item.ID + '] ' + a.FileName + ' (' + Math.round(blob.size / 1024) + ' KB)');
        await sleep(400);
      } catch (e) {
        console.warn('[' + item.ID + '] ERROR ' + a.FileName + ': ' + e.message);
      }
    }
  }
  console.log(
    '%cLISTO: ' + files + ' archivos de ' + rows + ' filas. Revise su carpeta de Descargas.',
    'color:green;font-weight:bold;font-size:14px'
  );
})();
