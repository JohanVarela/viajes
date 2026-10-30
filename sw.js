// Service worker: guarda la app en el celular para que abra sin internet.
// Reglas simples y a propósito conservadoras:
//   1. Solo toca pedidos GET del mismo sitio. Los POST nunca se guardan.
//   2. Las páginas (navegación) van primero a la red: si cambiaste algo, lo ves.
//   3. Los archivos fijos (CSS, JS, íconos) se sirven del guardado y se
//      actualizan de fondo, así no te quedas con una versión vieja para siempre.
//   4. Los informes (/api/...) se piden a la red y se guardan: leídos una vez,
//      quedan disponibles sin señal.
//
// IMPORTANTE: al cambiar archivos de la app, sube el número de VERSION.
// Si no, el celular sigue mostrando la copia vieja.

const VERSION = 'web-2026-10-30-88d8a78b';
const CASCARA = `viajes-cascara-${VERSION}`;
// Los informes guardados NO llevan número de versión, y es a propósito:
// si lo llevaran, cada vez que se cambie algo de la app se borrarían y te
// quedarías sin poder leerlos en el viaje, justo cuando no hay señal.
const DATOS = 'viajes-datos';

// Lo mínimo para que la app abra aunque no haya red.
const ARCHIVOS = [
  './',
  './index.html',
  './style.css?v=c916271d',
  './app.js?v=c916271d',
  './plan.mjs?v=c916271d',
  './modelo-viaje.mjs?v=c916271d',
  './candado.mjs?v=c916271d',
  './buzon-clave.mjs?v=c916271d',
  './app.js',
  './style.css',
  './plan.mjs',
  './modelo-viaje.mjs',
  './manifest.webmanifest',
  './icono-180.png',
  './icono-192.png',
  './icono-512.png',
  './icono.svg',
  './candado.mjs',
  './buzon-clave.mjs',
  './data/caja.json',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CASCARA);
      // addAll falla entero si un archivo falla: se guardan uno por uno.
      await Promise.all(
        ARCHIVOS.map((ruta) =>
          cache.add(new Request(new URL(ruta, self.registration.scope).href, { cache: 'reload' })).catch(() => {
            // un archivo que no existe no debe impedir la instalación
          })
        )
      );
      // Los informes viven en su propio cajón (el que no se borra al actualizar
      // la app). Si están en la lista de arriba, se guardan también ahí: sin
      // esto, la primera vez que se abre sin internet la app no encuentra los
      // datos y se queda en «No pude leer los datos del sitio».
      const datos = await caches.open(DATOS);
      await Promise.all(
        ARCHIVOS.filter((ruta) => ruta.includes('/data/')).map((ruta) =>
          datos
            .add(new Request(new URL(ruta, self.registration.scope).href, { cache: 'reload' }))
            .catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          // Se borran las copias viejas de la app, pero NUNCA el cajón de los
          // informes: esos tienen que seguir ahí aunque se actualice la app.
          .filter((nombre) => nombre.startsWith('viajes-') && nombre !== CASCARA && nombre !== DATOS)
          .map((nombre) => caches.delete(nombre))
      );
      await self.clients.claim();
    })()
  );
});

// Devuelve el guardado (si hay) y refresca de fondo.
async function redPrimero(pedido, cacheNombre, evento) {
  const cache = await caches.open(cacheNombre);
  try {
    const respuesta = await fetch(pedido);
    // Solo se guarda una respuesta completa y correcta: nunca un 404, un 500
    // ni un trozo (206), que después se serviría como si fuera el archivo entero.
    if (respuesta && respuesta.status === 200) {
      const guardar = cache.put(pedido, respuesta.clone()).catch(() => {});
      // waitUntil mantiene vivo al trabajador hasta que termina de guardar.
      if (evento) evento.waitUntil(guardar);
      else await guardar;
    }
    return respuesta;
  } catch {
    const guardado = await cache.match(pedido);
    if (guardado) return guardado;
    throw new Error('sin red y sin copia guardada');
  }
}

// Sirve del guardado y actualiza en segundo plano.
async function guardadoYRefresco(pedido, cacheNombre, evento) {
  const cache = await caches.open(cacheNombre);
  const guardado = await cache.match(pedido);
  const red = fetch(pedido)
    .then((respuesta) => {
      if (respuesta && respuesta.status === 200) {
        const guardar = cache.put(pedido, respuesta.clone()).catch(() => {});
        if (evento) evento.waitUntil(guardar);
        return guardar.then(() => respuesta);
      }
      return respuesta;
    })
    .catch(() => null);
  if (evento) evento.waitUntil(red);
  if (guardado) return guardado; // la respuesta sale ya; la red sigue por detrás
  const respuesta = await red;
  if (respuesta) return respuesta;
  throw new Error('sin red y sin copia guardada');
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;

  // Solo GET del mismo sitio.
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  // Informes: red primero, copia después (para leerlos de viaje).
  if ((url.pathname.includes('/api/') || url.pathname.includes('/data/'))) {
    evento.respondWith(
      redPrimero(pedido, DATOS, evento).catch(
        () =>
          new Response(JSON.stringify({ error: 'Sin internet y este informe no está guardado' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          })
      )
    );
    return;
  }

  // Cambiar de pantalla dentro de la app: red primero, si no hay, la portada guardada.
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      redPrimero(pedido, CASCARA, evento).catch(async () => {
        const cache = await caches.open(CASCARA);
        return (
          (await cache.match('./index.html')) ||
          new Response('<h1>Sin internet</h1><p>Abre la app cuando tengas señal al menos una vez.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      })
    );
    return;
  }

  // Todo lo demás (CSS, JS, íconos): guardado primero, refresco de fondo.
  evento.respondWith(guardadoYRefresco(pedido, CASCARA, evento));
});
