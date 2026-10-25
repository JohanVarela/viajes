// La app: pide los datos al servidor y los dibuja en pantalla.
// No usa ninguna librería.

const $ = (id) => document.getElementById(id);

const vistas = {
  lista: $('vista-lista'),
  informe: $('vista-informe'),
  pedido: $('vista-pedido'),
  viaje: $('vista-viaje'),
};

let informes = [];
let viajes = [];
let viajeAbierto = null;

// ---------- De dónde salen los datos ----------
// Con el servidor encendido se piden a /api/... . Publicada como sitio estático
// (sin servidor) todo viene ya calculado en UN archivo, data/caja.json: la lista
// de informes, la de viajes y el contenido completo de cada uno.
// Lo dice el propio HTML con data-modo="estatico", que lo pone el exportador.
const ESTATICO = document.documentElement.dataset.modo === 'estatico';

const direccion = {
  informes: () => '/api/informes',
  viajes: () => '/api/viajes',
  informe: (slug) => `/api/informe/${encodeURIComponent(slug)}`,
  viaje: (id) => `/api/viaje/${encodeURIComponent(id)}`,
};

// ---------- El candado ----------
// caja.json puede estar cifrado (candado: 1). Si lo está, la app no muestra
// nada hasta que se escriba la clave, y la clave NO se guarda en el teléfono:
// vive solo en esta pantalla. Al cerrar la app hay que escribirla otra vez.
// Es a propósito: una clave guardada es una clave que se encuentra si el
// teléfono se pierde. Por eso tampoco se usa localStorage ni sessionStorage.
let paquete = null;
// La clave abierta vive SOLO en memoria mientras la app está abierta. Sirve para
// dos cosas: abrir el viaje y firmar el pedido que se manda al buzón. No se
// guarda en el teléfono (ni en localStorage ni en sessionStorage).
let claveEnMemoria = null;

async function abrirDatos() {
  const respuesta = await fetch('data/caja.json', { cache: 'no-store' });
  if (!respuesta.ok) throw new Error('No pude leer los datos del sitio.');
  const sobre = await respuesta.json();
  if (sobre.candado !== 1) {
    // Si el archivo llegara SIN cifrar a un sitio publicado, la app no lo muestra:
    // mejor una pantalla que lo explique que el viaje a la vista de cualquiera.
    // En la computadora (localhost) sí se deja, para revisar antes de publicar.
    if (!esMiComputadora()) {
      throw new Error(
        'Este sitio quedó publicado sin cifrar. Por seguridad la app no muestra el viaje así: hay que volver a publicarlo bajo llave.'
      );
    }
    return sobre.datos || {};
  }
  return pedirClave(sobre);
}

function esMiComputadora() {
  return (
    location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname)
  );
}

// Pide la clave y devuelve los datos ya abiertos. No hay límite de intentos,
// pero tampoco se dice si la clave «existe»: solo se prueba y se ve.
async function pedirClave(sobre) {
  // El candado se carga aparte para que la portada abra rápido cuando no hace falta.
  let descifrar;
  try {
    ({ descifrar } = await import('./candado.mjs'));
  } catch {
    throw new Error('No pude cargar el candado del sitio.');
  }

  return new Promise((resolver, rechazar) => {
    const capa = document.createElement('div');
    capa.className = 'capa-clave';
    capa.innerHTML = `
      <form class="caja-clave" novalidate autocomplete="off">
        <h2>Este viaje está bajo llave</h2>
        <p class="nota">Escribí la clave que elegiste. No se guarda en este teléfono: se pide cada vez que abrís la app.</p>
        <label for="clave-viaje">Clave</label>
        <input id="clave-viaje" name="clave-viaje" type="password" autocomplete="off"
               autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" data-lpignore="true">
        <button class="principal" type="submit">Abrir</button>
        <p class="aviso" role="alert"></p>
        <button class="sin-caja" type="button" data-accion="rendirse">No la tengo</button>
      </form>`;
    document.body.appendChild(capa);

    const formulario = capa.querySelector('form');
    const campo = capa.querySelector('input');
    const boton = capa.querySelector('button.principal');
    const aviso = capa.querySelector('[role="alert"]');
    campo.focus();

    capa.querySelector('[data-accion="rendirse"]').addEventListener('click', () => {
      capa.remove();
      rechazar(new Error('El viaje está bajo llave. Escribí la clave para abrirlo.'));
    });

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const clave = campo.value;
      if (!clave) {
        aviso.textContent = 'Escribí la clave.';
        return;
      }
      boton.disabled = true;
      aviso.textContent = 'Abriendo…';
      try {
        const datos = await descifrar(clave, sobre);
        claveEnMemoria = clave;
        capa.remove();
        resolver(datos);
      } catch (error) {
        // El mensaje del candado ya viene en castellano y sin tecnicismos.
        aviso.textContent = error.message;
        campo.value = '';
        boton.disabled = false;
        campo.focus();
      }
    });
  });
}

// Un informe o un viaje, venga del paquete o del servidor.
async function pedirDato(cual, valor) {
  if (paquete) {
    const dato = paquete.contenidos?.[`${cual}:${valor}`];
    if (!dato) throw new Error(cual === 'informe' ? 'No encontré ese informe' : 'No pude abrir el viaje');
    return dato;
  }
  const respuesta = await fetch(direccion[cual](valor));
  let datos = {};
  try {
    datos = await respuesta.json();
  } catch {
    datos = {};
  }
  if (!respuesta.ok) {
    throw new Error(datos.error || (cual === 'informe' ? 'No encontré ese informe' : 'No pude abrir el viaje'));
  }
  return datos;
}

function mostrar(cual) {
  for (const [nombre, nodo] of Object.entries(vistas)) {
    nodo.hidden = nombre !== cual;
  }
  $('volver').hidden = cual === 'lista';
  // El cartel de «Instalar» va pegado abajo y tapaba el botón de guardar el
  // pedido. Mientras se está pidiendo un viaje, no se muestra (el CSS lo esconde).
  document.body.classList.toggle('pidiendo', cual === 'pedido');
  $('titulo-barra').textContent =
    cual === 'lista' ? 'Viajes' : cual === 'pedido' ? 'Pedir un destino' : $('titulo-barra').textContent;
  window.scrollTo(0, 0);
}

// Números con el mismo formato que los informes (12.345 / 1.234,50): punto para
// los miles y coma para los centavos. Se hace a mano porque el formato español
// no separa los miles de cuatro cifras (escribiría 1234,56) y los informes sí.
function formatear(n, decimales = 2) {
  const numero = Number(n);
  // Si el dato no es un número, no se dibuja un cero engañoso: se marca el hueco.
  if (!Number.isFinite(numero)) return '—';
  const negativo = numero < 0;
  const [entero, frac] = Math.abs(numero).toFixed(decimales).split('.');
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negativo ? '-' : '') + conPuntos + (decimales ? ',' + frac : '');
}
const dinero = (n) => formatear(n, 2);
const entero = (n) => formatear(n, 0);

// ---------- Convertir el texto del informe en algo bonito ----------

function escapar(texto) {
  // También las comillas: hay trozos de texto que terminan dentro de un atributo
  // (href="...") y una comilla suelta rompería el HTML.
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function enLinea(texto) {
  return escapar(texto)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

function esTabla(linea) {
  return /^\s*\|.*\|\s*$/.test(linea);
}

function dibujarTabla(lineas) {
  const filas = lineas.map((l) =>
    l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  );
  const esSeparador = (fila) => fila.every((c) => /^:?-{2,}:?$/.test(c));
  const cuerpo = filas.filter((f) => !esSeparador(f));
  if (!cuerpo.length) return '';
  const [cabecera, ...resto] = cuerpo;
  let html = '<div class="tabla-envoltura"><table><thead><tr>';
  for (const c of cabecera) html += `<th>${enLinea(c)}</th>`;
  html += '</tr></thead><tbody>';
  for (const fila of resto) {
    html += '<tr>';
    for (const c of fila) html += `<td>${enLinea(c)}</td>`;
    html += '</tr>';
  }
  return html + '</tbody></table></div>';
}

function dibujarMarkdown(texto) {
  const lineas = texto.split('\n');
  const salida = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    if (!linea.trim()) { i++; continue; }

    if (/^---+$/.test(linea.trim())) { salida.push('<hr>'); i++; continue; }

    if (esTabla(linea)) {
      const bloque = [];
      while (i < lineas.length && esTabla(lineas[i])) bloque.push(lineas[i++]);
      salida.push(dibujarTabla(bloque));
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(linea)) {
      const ordenada = /^\s*\d+\./.test(linea);
      const items = [];
      while (i < lineas.length && /^\s*([-*]|\d+\.)\s+/.test(lineas[i])) {
        items.push(lineas[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
        // líneas de continuación con sangría
        while (i < lineas.length && /^\s{2,}\S/.test(lineas[i]) &&
               !/^\s*([-*]|\d+\.)\s+/.test(lineas[i])) {
          items[items.length - 1] += ' ' + lineas[i].trim();
          i++;
        }
      }
      const etiqueta = ordenada ? 'ol' : 'ul';
      salida.push(`<${etiqueta}>${items.map((t) => `<li>${enLinea(t)}</li>`).join('')}</${etiqueta}>`);
      continue;
    }

    if (/^###\s+/.test(linea) || /^####\s+/.test(linea)) {
      salida.push(`<h3>${enLinea(linea.replace(/^#+\s+/, ''))}</h3>`);
      i++;
      continue;
    }

    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() &&
           !esTabla(lineas[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lineas[i]) &&
           !/^#{3,4}\s+/.test(lineas[i]) && !/^---+$/.test(lineas[i].trim())) {
      parrafo.push(lineas[i].trim());
      i++;
    }
    salida.push(`<p>${enLinea(parrafo.join(' '))}</p>`);
  }

  return salida.join('\n');
}

// ---------- Pantalla: lista ----------

function dibujarLista(filtro = '') {
  const texto = filtro.trim().toLowerCase();
  const visibles = informes.filter((i) =>
    !texto || i.titulo.toLowerCase().includes(texto) || i.slug.includes(texto)
  );
  const caja = $('lista');

  if (!informes.length) {
    caja.innerHTML = '<p class="vacio">Todavía no hay informes. Pulsa «Pedir un destino» y el agente lo prepara.</p>';
    return;
  }
  if (!visibles.length) {
    caja.innerHTML = '<p class="vacio">Ningún informe coincide con esa búsqueda.</p>';
    return;
  }

  caja.innerHTML = '';
  for (const informe of visibles) {
    const boton = document.createElement('button');
    boton.className = 'tarjeta';
    boton.innerHTML = `
      <span class="nombre">${escapar(informe.titulo)}</span>
      <span class="detalle">${escapar(informe.fecha || 'sin fecha')} · ${informe.secciones.length} secciones</span>`;
    boton.addEventListener('click', () => abrirInforme(informe.slug, informe.titulo));
    caja.appendChild(boton);
  }
}

// ---------- Pantalla: un informe ----------

async function abrirInforme(slug, titulo) {
  $('titulo-barra').textContent = titulo;
  $('informe-meta').textContent = 'Cargando…';
  $('informe-cuerpo').innerHTML = '';
  mostrar('informe');

  try {
    const informe = await pedirDato('informe', slug);

    $('informe-meta').textContent =
      `Consultado el ${informe.fecha || 'sin fecha'} · Estado: ${informe.estado}`;

    const caja = $('informe-cuerpo');
    caja.innerHTML = '';
    for (const [indice, seccion] of informe.secciones.entries()) {
      const detalle = document.createElement('details');
      detalle.className = 'seccion';
      if (indice < 2) detalle.open = true; // las dos primeras abiertas
      const resumen = document.createElement('summary');
      resumen.textContent = seccion.titulo;
      const cuerpo = document.createElement('div');
      cuerpo.className = 'cuerpo';
      cuerpo.innerHTML = dibujarMarkdown(seccion.texto);
      detalle.append(resumen, cuerpo);
      caja.appendChild(detalle);
    }
  } catch (error) {
    $('informe-meta').textContent = '';
    $('informe-cuerpo').innerHTML = `<p class="aviso">${escapar(error.message)}</p>`;
  }
}

// ---------- Pantalla: mi viaje ----------
// Todo lo que se ve aquí sale ya calculado por el motor del servidor
// (src/modelo-viaje.mjs): la app no hace cuentas propias de dinero.

const NOMBRE_FORMA = {
  efectivo: 'Pagar en efectivo',
  millas: 'Canje total con millas',
  'millas+efectivo': 'Millas + efectivo',
};

const chip = (estado) => `<span class="chip ${estado}">${estado}</span>`;

async function abrirViaje(id) {
  $('titulo-barra').textContent = 'Mi viaje';
  $('viaje-cabeza').innerHTML = '<p class="meta">Cargando…</p>';
  for (const caja of ['viaje-semaforo', 'viaje-cuentas', 'viaje-rubros', 'viaje-vuelo', 'viaje-bases', 'viaje-pendientes']) {
    $(caja).innerHTML = '';
  }
  mostrar('viaje');

  let viaje;
  try {
    viaje = await pedirDato('viaje', id);
  } catch (error) {
    $('viaje-cabeza').innerHTML = `<p class="aviso">${escapar(error.message)}</p>`;
    return;
  }

  viajeAbierto = viaje;
  $('titulo-barra').textContent = viaje.destino;
  dibujarViaje(viaje);
}

function dibujarViaje(v) {
  const d = v.dinero;
  const anio = (v.fechas.vuelta || '').slice(0, 4);

  $('viaje-cabeza').innerHTML = `
    <p class="meta">${escapar(v.fechas.salidaTexto)} → ${escapar(v.fechas.vueltaTexto)} de ${escapar(anio)}</p>
    <p class="meta">${v.noches} ${v.noches === 1 ? 'noche' : 'noches'} · ${v.dias} días · ${v.personas} personas${v.motivo ? ' · ' + escapar(v.motivo) : ''}</p>`;

  const textos = { verde: 'Todo en orden', amarillo: 'Falta confirmar cosas', rojo: 'No alcanza' };
  $('viaje-semaforo').innerHTML = `
    <div class="semaforo ${v.semaforo.color}">
      <span class="titulo-semaforo">${textos[v.semaforo.color] || ''}</span>
      <ul>${v.semaforo.motivos.map((m) => `<li>${escapar(m)}</li>`).join('')}</ul>
    </div>`;

  // Cuentas grandes: primero lo que cuesta, después el techo.
  const porcentaje = Math.max(2, Math.min(100, Math.round((d.total / d.techo) * 100)));
  $('viaje-cuentas').innerHTML = `
    <div class="cifra-grande">
      <span class="rotulo">Lo que cuesta el viaje</span>
      <span class="valor">${dinero(d.total)} USD</span>
      <span class="rotulo">${
        d.cabe
          ? `Tu presupuesto es ${dinero(d.techo)} USD: sobran ${dinero(d.diferencia)}`
          : `Tu presupuesto es ${dinero(d.techo)} USD: faltan ${dinero(Math.abs(d.diferencia))}`
      }</span>
      <div class="avance${d.cabe ? '' : ' lleno'}"><span style="width:${porcentaje}%"></span></div>
    </div>
    <div class="mini-cifras">
      <div class="mini"><span class="valor">${dinero(d.porNoche)}</span><span class="rotulo">por noche</span></div>
      <div class="mini"><span class="valor">${dinero(d.porDia)}</span><span class="rotulo">por día los dos</span></div>
      <div class="mini"><span class="valor">${dinero(d.porPersonaDia)}</span><span class="rotulo">por persona y día</span></div>
    </div>
    <p class="nota">Subtotal ${dinero(d.subtotal)} + colchón ${d.colchonPct} % (${dinero(d.colchon)}) = ${dinero(d.total)} USD.</p>`;

  $('viaje-rubros').innerHTML = v.porRubro
    .map(
      (r) => `
      <div class="rubro">
        <div class="fila"><span class="nom">${escapar(r.nombre)}</span><span class="monto">${dinero(r.usd)} USD</span></div>
        <div class="fila">${chip(r.estado)}${
          r.moneda !== 'USD' ? `<span class="nota">${entero(r.monto)} ${escapar(r.moneda)}</span>` : '<span></span>'
        }</div>
        ${r.nota ? `<p class="nota">${escapar(r.nota)}</p>` : ''}
      </div>`
    )
    .join('');

  $('viaje-vuelo').innerHTML = (v.vuelo || [])
    .map(
      (o) => `
      <div class="vuelo-opcion">
        <div class="fila">
          <span class="nom">${escapar(NOMBRE_FORMA[o.forma] || o.forma)}</span>
          <span class="monto">${
            o.millas ? `${entero(o.millas)} millas + ${dinero(o.costoReal)} USD` : `${dinero(o.costoReal)} USD`
          }</span>
        </div>
        <div class="fila"><span class="chip ${o.viable ? 'verificado' : 'falta'}">${
          o.viable ? 'sirve' : 'no sirve'
        }</span>${chip(o.estado)}</div>
        ${o.motivos.length ? `<p class="nota">${escapar(o.motivos.join('; '))}</p>` : ''}
        ${o.detalle ? `<p class="nota">${escapar(o.detalle)}</p>` : ''}
      </div>`
    )
    .join('');

  $('viaje-bases').innerHTML = (v.bases || [])
    .map(
      (b) => `
      <div class="base">
        <div class="fila"><span class="nom">${escapar(b.nombre)}</span>${chip(b.estado || 'falta')}</div>
        <p class="nota">${escapar(b.municipio || '')} · ${escapar(b.desde)} → ${escapar(b.hasta)} · ${
          b.noches === 1 ? '1 noche' : `${b.noches} noches`
        }</p>
        ${b.nota ? `<p class="nota">${escapar(b.nota)}</p>` : ''}
      </div>`
    )
    .join('');

  $('viaje-pendientes').innerHTML = v.pendientes
    .map(
      (p) => `
      <div class="pendiente">
        <span class="marca">${p.critico ? '!' : '·'}</span>
        <div>
          <span>${escapar(p.que)}</span>
          ${p.donde ? `<p class="nota donde">${escapar(p.donde)}</p>` : ''}
        </div>
      </div>`
    )
    .join('');

  const boton = $('viaje-informe');
  boton.hidden = !v.informe;
  boton.onclick = () => abrirInforme(v.informe, v.destino);

  $('viaje-pie').textContent = v.actualizado
    ? `Datos revisados el ${v.actualizado}. Los precios son de esa fecha y pueden cambiar; lo que dice «estimado» es un cálculo, no un precio visto.`
    : 'Los precios pueden cambiar; lo que dice «estimado» es un cálculo, no un precio visto.';
}

// ---------- Tarjeta del viaje en la pantalla de inicio ----------

function dibujarDestacado() {
  const caja = $('viaje-destacado');
  caja.innerHTML = '';
  for (const v of viajes) {
    if (!v || v.error) continue;
    const pastilla = !v.cabe ? 'no cabe' : v.semaforo?.color === 'verde' ? 'listo' : 'faltan datos';
    const boton = document.createElement('button');
    boton.className = 'destacado';
    boton.innerHTML = `
      <span class="arriba">
        <span class="nombredestacado">${escapar(v.destino)}</span>
        <span class="pastilla">${pastilla}</span>
      </span>
      <span class="detalledestacado">${v.noches} noches · ${dinero(v.total)} de ${dinero(v.techo)} USD${
        v.criticos ? ` · ${v.criticos} por confirmar` : ''
      }</span>`;
    boton.addEventListener('click', () => abrirViaje(v.id));
    caja.appendChild(boton);
  }
}

// ---------- Pantalla: pedir ----------

// Noches entre dos días, para mostrarlas mientras se escriben las fechas.
// La cuenta de verdad la hace el servidor; esto es solo un eco en pantalla.
function nochesEntre(desde, hasta) {
  if (!desde || !hasta) return null;
  const a = Date.parse(desde + 'T00:00:00Z');
  const b = Date.parse(hasta + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function actualizarNoches() {
  const salida = $('form-pedido').elements.salidaISO.value;
  const vuelta = $('form-pedido').elements.vueltaISO.value;
  const aviso = $('noches-calculadas');
  const noches = nochesEntre(salida, vuelta);
  if (noches === null) {
    aviso.textContent = 'Con los dos días exactos la app calcula las noches y cuánto te toca por noche.';
  } else if (noches <= 0) {
    aviso.textContent = 'La vuelta tiene que ser después de la salida.';
  } else {
    aviso.textContent = `${noches} ${noches === 1 ? 'noche' : 'noches'} · ${noches + 1} días de viaje.`;
  }
}

// Dibuja el plan que devuelve el servidor: cuánto toca por noche y qué averiguar.
function dibujarPlan(plan) {
  const caja = $('plan-resultado');
  caja.hidden = false;

  const titulos = {
    papeles: 'Papeles y visados',
    vuelos: 'Vuelos',
    alojamiento: 'Alojamiento',
    transporte: 'Transporte',
    dinero: 'Dinero',
    comida: 'Comida',
    salud: 'Salud',
    temporada: 'Fechas y clima',
  };
  const grupos = {};
  for (const item of plan.checklist) (grupos[item.grupo] = grupos[item.grupo] || []).push(item);

  let html = '<div class="plan"><h3>Tu plan</h3>';
  if (plan.fechas) {
    html += `<p class="nota">${escapar(plan.fechas.salida.texto)} → ${escapar(plan.fechas.vuelta.texto)}: ${
      plan.fechas.dias
    } días y ${plan.fechas.noches} noches fuera de casa.</p>`;
    html += `<p><strong>Con ${dinero(plan.techo)} USD te toca ${dinero(
      plan.porNoche
    )} por noche para todo</strong> (avión, hotel y comida), o ${dinero(plan.porPersonaDia)} por persona y día.</p>`;
  } else {
    // Si eligió un mes pero no los días, no se inventa nada: se pide el dato.
    html += '<p class="nota">Para decirte cuánto te toca por noche necesito los dos días exactos: elegilos en el calendario de arriba.</p>';
  }
  html += `<p class="nota">${escapar(plan.aviso)}</p>`;
  for (const supuesto of plan.supuestos || []) {
    html += `<p class="nota">Ojo: tuve que suponer ${escapar(supuesto)}.</p>`;
  }
  for (const [grupo, items] of Object.entries(grupos)) {
    html += `<span class="grupo">${escapar(titulos[grupo] || grupo)}</span><ul>`;
    for (const item of items) {
      html += `<li>${escapar(item.que)}<br><span class="nota">dónde: ${escapar(item.donde)}</span></li>`;
    }
    html += '</ul>';
  }
  html += '</div>';
  caja.innerHTML = html;
}

// Guarda el pedido en el propio teléfono. Se usa solo cuando la app está
// publicada sin servidor: ahí no hay dónde escribir un archivo.
function guardarPedidoLocal(datos) {
  const clave = 'viajes-pedidos';
  let lista = [];
  try {
    lista = JSON.parse(localStorage.getItem(clave) || '[]');
  } catch {
    lista = [];
  }
  if (!Array.isArray(lista)) lista = [];
  const pedido = { ...datos, creado: new Date().toISOString() };
  lista.unshift(pedido);
  try {
    localStorage.setItem(clave, JSON.stringify(lista.slice(0, 30)));
  } catch {
    // Sin espacio o en modo privado: el pedido igual sigue en pantalla.
  }
  return pedido;
}

// Botón para copiar el pedido y pegarlo en el chat con el agente.
function agregarBotonCopiar(datos) {
  const caja = $('plan-resultado');
  caja.hidden = false;
  const texto = [
    'Pedido de viaje',
    `Destino: ${datos.destino || ''}`,
    `Fechas: ${datos.fechas || ''} (${datos.salidaISO || '?'} → ${datos.vueltaISO || '?'})`,
    `Sale de: ${datos.salida || ''}`,
    `Personas: ${datos.personas || ''}`,
    `Presupuesto: ${datos.presupuesto || ''} USD`,
    `Notas: ${datos.notas || ''}`,
  ].join('\n');

  const boton = document.createElement('button');
  boton.className = 'secundario';
  boton.textContent = 'Copiar el pedido';
  boton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      boton.textContent = 'Copiado';
    } catch {
      // Sin permiso o sin https: se muestra el texto para copiarlo a mano.
      const area = document.createElement('textarea');
      area.value = texto;
      area.rows = 7;
      caja.prepend(area);
      boton.textContent = 'Copia el texto de arriba';
    }
  });
  caja.prepend(boton);
}

// ---------- El buzón de pedidos ----------
// Publicada como sitio estático, la app no puede escribir archivos. Por eso el
// pedido se manda a un Worker de Cloudflare (worker/buzon.mjs).
// Para que solo él y su pareja puedan escribir ahí, la app manda una «prueba»
// calculada con la MISMA clave que abre el viaje: la clave no sale del teléfono
// y con la prueba no se puede leer nada del viaje.
// Si no hay buzón configurado, o no hay clave abierta, se sigue guardando en el
// teléfono como antes, con el botón de copiar.
let urlBuzon = null;
let buzonLeido = false;
let pruebaEnMemoria = null;

async function leerDireccionBuzon() {
  if (buzonLeido) return urlBuzon;
  buzonLeido = true;
  try {
    const respuesta = await fetch('data/buzon.json', { cache: 'no-store' });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    const url = String(datos.url || '').trim().replace(/\/+$/, '');
    urlBuzon = /^https?:\/\//.test(url) ? url : null;
  } catch {
    urlBuzon = null;
  }
  return urlBuzon;
}

async function enviarAlBuzon(datos) {
  const url = await leerDireccionBuzon();
  if (!url) return { enviado: false, motivo: 'sin-buzon' };
  if (!claveEnMemoria) return { enviado: false, motivo: 'sin-clave' };
  let derivarPrueba;
  try {
    ({ derivarPrueba } = await import('./buzon-clave.mjs'));
  } catch {
    return { enviado: false, motivo: 'sin-clave' };
  }
  // La prueba se calcula una vez por sesión: cuesta un par de segundos.
  if (!pruebaEnMemoria) pruebaEnMemoria = await derivarPrueba(claveEnMemoria);

  // Sin límite de tiempo, un buzón que no contesta dejaría la pantalla en
  // «Enviando…» para siempre.
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 20000);
  try {
    const respuesta = await fetch(url + '/pedido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prueba: pruebaEnMemoria, pedido: datos }),
      signal: control.signal,
    });
    let resultado = {};
    try {
      resultado = await respuesta.json();
    } catch {
      resultado = {};
    }
    if (!respuesta.ok) throw new Error(resultado.error || `el buzón contestó ${respuesta.status}`);
    return { enviado: true, id: resultado.id };
  } finally {
    clearTimeout(reloj);
  }
}

async function enviarPedido(datos) {
  // Primero se guarda en el teléfono, pase lo que pase: si el envío falla, el
  // pedido no se pierde y se puede copiar a mano.
  if (!ESTATICO) {
    const respuesta = await fetch('/api/pedido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    // Se revisa la respuesta ANTES de leerla como JSON: si algo contesta algo
    // que no es JSON, el aviso debe ser claro y no un error raro del navegador.
    let resultado = {};
    try {
      resultado = await respuesta.json();
    } catch {
      resultado = {};
    }
    if (!respuesta.ok) throw new Error(resultado.error || 'No se pudo guardar el pedido');
    return resultado;
  }

  const pedido = guardarPedidoLocal(datos);
  try {
    const envio = await enviarAlBuzon(datos);
    return envio.enviado
      ? { pedido, enviado: true, id: envio.id }
      : { pedido, local: true, motivo: envio.motivo };
  } catch (error) {
    return { pedido, local: true, motivo: 'no-se-pudo', error: error.message };
  }
}

$('form-pedido').elements.salidaISO.addEventListener('input', actualizarNoches);
$('form-pedido').elements.vueltaISO.addEventListener('input', actualizarNoches);

// ---------- Listas que se tocan y también aceptan lo escrito ----------
// Cada campo es un <select>: se toca y se ve la lista completa. La última opción
// es «Otro», que pide escribirlo a mano y guarda lo escrito arriba en la lista y
// en el teléfono, para la próxima vez.
const OTRO = '__otro';

function opcionPropia(select, valor) {
  const yaEsta = [...select.options].find((o) => o.value.toLowerCase() === valor.toLowerCase());
  if (yaEsta) return yaEsta;
  const nueva = document.createElement('option');
  nueva.value = valor;
  nueva.textContent = valor;
  nueva.dataset.propio = '1';
  const otro = [...select.options].find((o) => o.value === OTRO);
  select.insertBefore(nueva, otro || null);
  return nueva;
}

function propias(select) {
  return [...select.options].filter((o) => o.dataset.propio === '1').map((o) => o.value);
}

function listaConOtro(select, pregunta, memoria) {
  if (!select) return;
  // «Otro» siempre queda al final, después de los meses o de lo escrito antes.
  const ultima = [...select.options].find((o) => o.value === OTRO);
  if (ultima) select.appendChild(ultima);
  try {
    for (const guardada of JSON.parse(localStorage.getItem(memoria) || '[]')) opcionPropia(select, guardada);
  } catch {
    /* si lo guardado está roto, se empieza de cero */
  }
  select.dataset.antes = select.value;
  select.addEventListener('change', () => {
    const antes = select.dataset.antes || '';
    if (select.value === OTRO) {
      const escrito = (window.prompt(pregunta) || '').trim();
      if (!escrito) {
        select.value = antes;
        return;
      }
      opcionPropia(select, escrito);
      select.value = escrito;
    }
    select.dataset.antes = select.value;
    localStorage.setItem(memoria, JSON.stringify(propias(select)));
  });
}

(function prepararListas() {
  const formulario = $('form-pedido');
  if (!formulario) return;

  // Los meses, del mes que viene en adelante, armados al vuelo para que no
  // queden viejos si la app se usa mucho tiempo después.
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const cuando = $('sel-fechas');
  if (cuando) {
    const hoy = new Date();
    for (let i = 1; i <= 18; i += 1) {
      const mes = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
      const opcion = document.createElement('option');
      opcion.value = `${meses[mes.getMonth()]} ${mes.getFullYear()}`;
      opcion.textContent = opcion.value;
      cuando.appendChild(opcion);
    }
  }

  listaConOtro($('sel-destino'), 'Escribí el destino o la zona que tenés en mente:', 'viajes-destinos');
  listaConOtro(cuando, 'Escribí cuándo querés viajar (por ejemplo: la semana después de Semana Santa):', 'viajes-fechas');
  listaConOtro($('sel-salida'), 'Escribí tu ciudad o el código del aeropuerto:', 'viajes-aeropuertos');

  // El aeropuerto que usó la vez pasada queda elegido, y se puede cambiar.
  const salida = $('sel-salida');
  const recordado = localStorage.getItem('viajes-origen') || '';
  if (salida && recordado) {
    opcionPropia(salida, recordado);
    salida.value = recordado;
    salida.dataset.antes = recordado;
  }
  if (salida) {
    salida.addEventListener('change', () => {
      const valor = salida.value.trim();
      if (valor && valor !== OTRO) localStorage.setItem('viajes-origen', valor);
    });
  }
})();

$('form-pedido').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const estado = $('pedido-estado');
  const datos = Object.fromEntries(new FormData(evento.target).entries());
  estado.className = 'aviso';
  estado.textContent = 'Guardando…';

  try {
    const resultado = await enviarPedido(datos);

    estado.className = 'aviso bien';
    if (resultado.enviado) {
      estado.textContent =
        'Enviado. Ya está en mi buzón: cuando abra mi sesión lo leo y te preparo el informe. Queda una copia en este teléfono.';
    } else if (resultado.motivo === 'no-se-pudo') {
      estado.textContent = `No pude mandarlo al buzón (${resultado.error}). Quedó guardado en este teléfono: toca «Copiar el pedido» y pásamelo en el chat.`;
    } else if (resultado.local) {
      estado.textContent =
        'Guardado en este teléfono. Toca «Copiar el pedido» y pásamelo en el chat: yo lo investigo.';
    } else {
      estado.textContent = `Guardado. Dile al agente: «ya pedí ${resultado.pedido.destino} en la app» y lo investiga.`;
    }
    evento.target.reset();
    actualizarNoches();

    // El plan se pide aparte: si falta el presupuesto o las fechas, el pedido
    // ya quedó guardado y solo se avisa qué falta para poder calcular.
    await pedirPlan(datos);
    if (resultado.local) agregarBotonCopiar(datos);
  } catch (error) {
    estado.className = 'aviso';
    estado.textContent = /fetch|network|conexi/i.test(error.message)
      ? 'No hay conexión con la app. Revisa el WiFi y vuelve a intentar.'
      : error.message;
  }
});

async function pedirPlan(datos) {
  const caja = $('plan-resultado');
  try {
    let plan;
    if (ESTATICO) {
      // El mismo cálculo que hace el servidor, pero acá mismo en el teléfono.
      const { armarPlan } = await import('./plan.mjs');
      plan = armarPlan(datos);
    } else {
      const respuesta = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      plan = await respuesta.json();
      if (!respuesta.ok && plan.ok !== false) plan = { ok: false, problemas: [plan.error || 'no se pudo calcular'] };
    }
    if (!plan.ok) {
      caja.hidden = false;
      caja.innerHTML = `<p class="aviso">Para calcular el plan falta: ${escapar(
        (plan.problemas || ['el destino y el presupuesto']).join(', ')
      )}. El pedido ya quedó guardado.</p>`;
      return;
    }
    dibujarPlan(plan.plan);
  } catch {
    caja.hidden = false;
    caja.innerHTML = '<p class="aviso">El pedido se guardó, pero no pude calcular el plan. Revisa la conexión.</p>';
  }
}

// ---------- Navegación ----------

$('volver').addEventListener('click', () => {
  $('titulo-barra').textContent = 'Viajes';
  mostrar('lista');
});

$('btn-pedir').addEventListener('click', () => {
  $('pedido-estado').textContent = '';
  $('plan-resultado').hidden = true;
  $('plan-resultado').innerHTML = '';
  mostrar('pedido');
});

$('buscar').addEventListener('input', (evento) => dibujarLista(evento.target.value));

// ---------- Arranque ----------

(async function iniciar() {
  // Se anota si la lista se pudo leer, para no confundir «no hay ninguno» con
  // «no se pudo cargar». Son dos cosas distintas y se explican distinto.
  let listaLeida = false;

  if (ESTATICO) {
    // Un solo archivo, y puede pedir la clave antes de seguir.
    try {
      paquete = await abrirDatos();
      informes = Array.isArray(paquete.informes) ? paquete.informes : [];
      viajes = Array.isArray(paquete.viajes) ? paquete.viajes : [];
      listaLeida = true;
    } catch (error) {
      $('lista').innerHTML = `<p class="aviso">${escapar(error.message)}</p>`;
      return;
    }
  } else {
    // Con el servidor encendido, los viajes y los informes se piden a la vez.
    const [resInformes, resViajes] = await Promise.allSettled([
      fetch(direccion.informes()),
      fetch(direccion.viajes()),
    ]);

    if (resInformes.status === 'fulfilled' && resInformes.value.ok) {
      try {
        const datos = await resInformes.value.json();
        informes = Array.isArray(datos.informes) ? datos.informes : [];
        listaLeida = true;
      } catch {
        informes = [];
      }
    }

    if (resViajes.status === 'fulfilled' && resViajes.value.ok) {
      try {
        const datos = await resViajes.value.json();
        viajes = Array.isArray(datos.viajes) ? datos.viajes : [];
      } catch {
        viajes = [];
      }
    }
  }

  dibujarDestacado();

  if (!informes.length) {
    // Si la lista se leyó bien y está vacía, no es un error: está vacía.
    $('lista').innerHTML = listaLeida
      ? '<p class="vacio">Todavía no hay informes. Pulsa «Pedir un destino» y el agente lo prepara.</p>'
      : navigator.onLine
        ? '<p class="aviso">No pude cargar los informes. Revisa que el servidor esté encendido.</p>'
        : '<p class="aviso">Sin internet y esta lista no se había guardado todavía. Ábrela una vez con señal y después funcionará sin red.</p>';
    return;
  }
  dibujarLista();
})();

// ---------- Instalarla en el celular y usarla sin internet ----------

// El service worker es lo que permite abrirla sin señal. Solo se puede usar
// si la página viene de localhost o de una dirección segura (https).
if ('serviceWorker' in navigator) {
  // Si ya había una versión guardada, cuando la nueva tome el mando hay que
  // recargar una vez: los archivos fijos se sirven del teléfono antes que de la
  // red, y sin recargar se seguía viendo la versión vieja.
  const yaHabia = Boolean(navigator.serviceWorker.controller);
  let recargado = false;

  window.addEventListener('load', () => {
    // Dirección relativa a propósito: así funciona igual si el sitio se publica
    // dentro de una subcarpeta (por ejemplo usuario.github.io/viajes/).
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registro) => {
        // Sin esto el navegador busca la versión nueva cada muchas horas (o al
        // día siguiente), y el teléfono se queda con la vieja sin avisar. Se pide
        // a mano en cada apertura; si no hay nada nuevo, no cuesta nada.
        registro.update().catch(() => {});
      })
      .catch(() => {
        // Sin service worker la app sigue funcionando, solo que con internet.
      });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!yaHabia || recargado) return;
    recargado = true;
    location.reload();
  });
}

// La versión que está corriendo, escrita chiquita al pie de la lista. Sirve para
// responder sin dudas «¿qué versión tenés?» cuando algo no se actualiza.
(function mostrarVersion() {
  const donde = $('version-app');
  if (!donde) return;
  fetch('./sw.js', { cache: 'no-store' })
    .then((respuesta) => (respuesta.ok ? respuesta.text() : ''))
    .then((texto) => {
      const cual = /const VERSION = '([^']+)'/.exec(texto || '');
      if (cual) donde.textContent = `Versión ${cual[1]}`;
    })
    .catch(() => {});
})();

// Aviso abajo para ponerla en la pantalla de inicio.
(function avisoInstalar() {
  const caja = $('instalar');
  if (!caja) return;

  const yaInstalada =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const dichoQueNo = localStorage.getItem('viajes-instalar-oculto') === 'si';
  if (yaInstalada || dichoQueNo) return;

  let eventoInstalar = null;
  let mostrado = false;

  const mostrar = () => {
    if (mostrado) return;
    mostrado = true;
    caja.hidden = false;
    document.body.classList.add('con-instalar');
  };

  const cerrar = () => {
    caja.hidden = true;
    document.body.classList.remove('con-instalar');
    localStorage.setItem('viajes-instalar-oculto', 'si');
  };

  // Android y computadora: el navegador avisa que se puede instalar.
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    eventoInstalar = evento;
    mostrar();
  });

  // Por WiFi (http://192.168...) los navegadores no dejan instalar ni guardar
  // para usar sin internet: eso solo pasa por localhost o por https.
  const hayQueExplicar = !window.isSecureContext;
  if (hayQueExplicar) {
    $('instalar-texto').textContent =
      'Abierta por WiFi se puede usar, pero todavía no instalar. Para tenerla con ícono y sin internet hay que publicarla con https.';
    $('instalar-si').hidden = true;
    $('instalar-no').textContent = 'Entendido';
    mostrar();
  }

  // iPhone y iPad no tienen ese aviso: hay que explicar los dos toques.
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (esIOS && !hayQueExplicar) {
    $('instalar-texto').textContent =
      'Toca el botón Compartir (el cuadrito con la flecha) y elige «Añadir a pantalla de inicio». Así la abres como una app.';
    $('instalar-si').hidden = true;
    $('instalar-no').textContent = 'Entendido';
    mostrar();
  }

  $('instalar-si').addEventListener('click', async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    caja.hidden = true;
    document.body.classList.remove('con-instalar');
  });
  $('instalar-no').addEventListener('click', cerrar);

  // Si la instala, no volver a preguntar.
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('viajes-instalar-oculto', 'si');
    caja.hidden = true;
    document.body.classList.remove('con-instalar');
  });
})();

// Aviso cuando se queda sin señal (los informes ya leídos siguen abriendo).
(function avisoSinRed() {
  const barra = document.createElement('div');
  barra.className = 'sin-red';
  barra.textContent = 'Sin internet. Lo que ya abriste sigue funcionando.';
  barra.hidden = true;
  const barraArriba = document.querySelector('.barra');
  if (barraArriba) barraArriba.after(barra);

  const actualizar = () => {
    barra.hidden = navigator.onLine;
  };
  window.addEventListener('online', actualizar);
  window.addEventListener('offline', actualizar);
  actualizar();
})();
