// El motor de un viaje: convierte "destino + fechas + presupuesto" en cuentas
// que se pueden revisar, y en una lista de lo que todavía falta verificar.
//
// Idea central: NINGÚN dato es solo un número. Cada uno lleva su estado:
//   verificado -> lo vi en una fuente (con enlace y fecha)
//   estimado   -> es un cálculo o un precio de referencia, puede cambiar
//   falta      -> todavía no se sabe
// Así la app nunca puede dar por bueno algo que no está comprobado.
//
// Todo el dinero se calcula en centavos (enteros) para que no aparezcan
// errores de decimales (0.1 + 0.2 !== 0.3). Al final se redondea a 2 decimales.
//
// Este archivo no usa ningún paquete: solo JavaScript.

// ---------- Estados y monedas ----------
export const ESTADOS = ['verificado', 'estimado', 'falta'];
const DIA_MS = 86_400_000;

// ---------- Dinero ----------
const aCentavos = (n) => Math.round(Number(n) * 100);
export const aDolares = (c) => Math.round(c) / 100;

function exigirNumero(valor, nombre) {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número (llegó "${valor}")`);
  return n;
}

// Un número de verdad: no vale null, ni "", ni [] (Number() los convierte en 0
// y el rubro quedaría sumando cero sin avisar).
function esNumeroReal(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (typeof valor === 'string') return valor.trim() !== '' && Number.isFinite(Number(valor));
  return false;
}

// ---------- Fechas ----------
export function aFecha(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`fecha inválida "${iso}": se espera AAAA-MM-DD`);
  }
  const [a, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(a, m - 1, d);
  const fecha = new Date(t);
  // Rechaza cosas como 2027-02-30, que Date convertiría en marzo.
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) {
    throw new Error(`esa fecha no existe: ${iso}`);
  }
  return t;
}

export function diasEntre(desde, hasta) {
  return Math.round((aFecha(hasta) - aFecha(desde)) / DIA_MS);
}

const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function diaDeLaSemana(iso) {
  return NOMBRES_DIA[new Date(aFecha(iso)).getUTCDay()];
}

export function fechaLarga(iso) {
  const fecha = new Date(aFecha(iso));
  return `${diaDeLaSemana(iso)} ${fecha.getUTCDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][fecha.getUTCMonth()]}`;
}

// ---------- Validación de la entrada ----------
// Devuelve una lista de problemas. Si hay alguno, el viaje no se puede calcular.
export function validar(viaje) {
  const problemas = [];
  const sumar = (texto) => problemas.push(texto);

  if (!viaje || typeof viaje !== 'object') return ['el viaje no es un objeto'];
  if (!viaje.destino || !String(viaje.destino).trim()) sumar('falta el destino');

  const personas = Number(viaje.personas);
  if (!Number.isInteger(personas) || personas < 1) sumar('personas debe ser un número entero de 1 o más');
  if (personas > 12) sumar('más de 12 personas: este modelo no sirve para grupos');

  const fechas = viaje.fechas || {};
  try {
    aFecha(fechas.salida);
    aFecha(fechas.primeraNoche);
    aFecha(fechas.vuelta);
    if (aFecha(fechas.vuelta) <= aFecha(fechas.salida)) sumar('la vuelta tiene que ser después de la salida');
    if (aFecha(fechas.primeraNoche) < aFecha(fechas.salida)) sumar('no se puede dormir antes de salir de casa');
    if (aFecha(fechas.primeraNoche) >= aFecha(fechas.vuelta)) sumar('la primera noche tiene que ser antes de la vuelta');
    const noches = diasEntre(fechas.primeraNoche, fechas.vuelta);
    if (noches > 60) sumar(`${noches} noches: demasiado largo para un solo viaje`);
  } catch (error) {
    sumar(`fechas: ${error.message}`);
  }

  const presupuesto = Number(viaje.presupuesto?.total);
  if (!Number.isFinite(presupuesto) || presupuesto <= 0) sumar('el presupuesto total tiene que ser mayor que cero');
  const colchon = Number(viaje.presupuesto?.colchonPct ?? 10);
  if (!Number.isFinite(colchon) || colchon < 0 || colchon > 50) sumar('el colchón debe estar entre 0 y 50 %');

  const cambio = viaje.cambio || {};
  for (const rubro of viaje.rubros || []) {
    if (!rubro?.nombre) sumar('un rubro no tiene nombre');
    if (!esNumeroReal(rubro?.monto)) sumar(`el rubro "${rubro?.nombre || '?'}" no tiene monto`);
    const moneda = rubro?.moneda || viaje.monedaBase || 'USD';
    if (moneda !== 'USD') {
      const valor = cambio[`${moneda}_USD`]?.valor;
      if (!esNumeroReal(valor) || Number(valor) <= 0) {
        sumar(`falta el tipo de cambio ${moneda}_USD para el rubro "${rubro?.nombre || '?'}"`);
      }
    }
    if (rubro?.estado && !ESTADOS.includes(rubro.estado)) {
      sumar(`el rubro "${rubro.nombre}" tiene un estado desconocido: ${rubro.estado}`);
    }
    if (rubro?.estado === 'verificado' && !rubro?.fuente) {
      sumar(`el rubro "${rubro.nombre}" dice estar verificado pero no dice de dónde salió`);
    }
  }

  for (const hotel of viaje.hoteles || []) {
    if (!hotel?.nombre) sumar('un hotel no tiene nombre');
    if (hotel?.estado === 'verificado' && !hotel?.fuente) sumar(`el hotel "${hotel?.nombre}" dice estar verificado sin fuente`);
  }

  if (viaje.millas && !esNumeroReal(viaje.millas.saldo)) sumar('el saldo de millas no es un número');
  for (const opcion of viaje.vuelo?.opciones || []) {
    if (!['efectivo', 'millas', 'millas+efectivo'].includes(opcion?.forma)) {
      sumar(`una opción de vuelo tiene forma desconocida: ${opcion?.forma}`);
    }
  }
  return problemas;
}

// ---------- El viaje calculado ----------
export function calcular(viaje) {
  const problemas = validar(viaje);
  if (problemas.length) {
    const error = new Error('El viaje tiene datos que no se pueden usar:\n- ' + problemas.join('\n- '));
    error.problemas = problemas;
    throw error;
  }

  const personas = Number(viaje.personas);
  const cambio = viaje.cambio || {};
  const monedaBase = viaje.monedaBase || 'USD';
  const noches = diasEntre(viaje.fechas.primeraNoche, viaje.fechas.vuelta);
  const dias = diasEntre(viaje.fechas.salida, viaje.fechas.vuelta) + 1;

  // 1. Cada rubro, pasado a dólares.
  const porRubro = (viaje.rubros || []).map((rubro) => {
    const moneda = rubro.moneda || monedaBase;
    const valor = Number(cambio[`${moneda}_USD`]?.valor ?? 1);
    // Se multiplica en centavos y se vuelve a dólares una sola vez.
    const usd = aDolares(Math.round(aCentavos(rubro.monto) * valor));
    return {
      ...rubro,
      moneda,
      usd,
      estado: rubro.estado || 'falta',
    };
  });

  // 2. Sumas. Se acumula en centavos.
  const subtotalCent = porRubro.reduce((total, rubro) => total + aCentavos(rubro.usd), 0);
  const pct = Number(viaje.presupuesto?.colchonPct ?? 10);
  const colchonCent = Math.round((subtotalCent * pct) / 100);
  const totalCent = subtotalCent + colchonCent;

  const subtotal = aDolares(subtotalCent);
  const colchon = aDolares(colchonCent);
  const total = aDolares(totalCent);
  const techo = Number(viaje.presupuesto.total);
  const diferencia = aDolares(aCentavos(techo) - totalCent);

  // 3. Lo que cuesta por noche y por día (útil para comparar viajes distintos).
  const porNoche = aDolares(Math.round(totalCent / noches));
  const porDia = aDolares(Math.round(totalCent / dias));
  const porPersonaTotal = aDolares(Math.round(totalCent / personas));
  const porPersonaDia = aDolares(Math.round(totalCent / dias / personas));

  // 4. Lo que todavía no está firme.
  const sinVerificar = porRubro.filter((rubro) => rubro.estado !== 'verificado');
  const hotelesSinVerificar = (viaje.hoteles || []).filter((hotel) => hotel.estado !== 'verificado');
  const pendientes = [...(viaje.pendientes || [])];
  const yaAnotado = (texto) =>
    pendientes.some((p) => String(p.que || '').toLowerCase().includes(String(texto).toLowerCase()));
  for (const rubro of sinVerificar) {
    pendientes.push({
      id: `rubro-${rubro.id || rubro.nombre}`,
      que: `Confirmar el precio de «${rubro.nombre}» (${rubro.estado === 'falta' ? 'sin dato' : 'provisional'}: ${rubro.usd} USD)`,
      donde: rubro.donde || 'la web oficial del proveedor',
      critico: rubro.estado === 'falta',
      origen: 'rubro',
    });
  }
  for (const hotel of hotelesSinVerificar) {
    // Si ya hay una nota escrita a mano sobre ese hotel, no se repite.
    if (hotel?.nombre && yaAnotado(hotel.nombre)) continue;
    pendientes.push({
      id: `hotel-${hotel.nombre}`,
      que: `Pedir tarifa y confirmar condiciones de ${hotel.nombre}${hotel.noches ? ` (${hotel.noches})` : ''}`,
      donde: hotel.fuente || hotel.web || 'la web del hotel',
      critico: true,
      origen: 'hotel',
    });
  }

  // 5. Semáforo: una sola respuesta que se pueda mirar de un vistazo, con
  // todos los motivos juntos (no solo el primero) y bien escritos en plural.
  let color = 'verde';
  const motivos = [];
  if (total > techo) {
    color = 'rojo';
    motivos.push(`Te pasas del presupuesto por ${Math.abs(diferencia).toFixed(2)} USD`);
  }
  const sinPrecio = porRubro.filter((r) => r.estado === 'falta').length;
  const estimados = porRubro.filter((r) => r.estado === 'estimado').length;
  const manuales = (viaje.pendientes || []).length;
  // Un viaje sin ningún rubro no está "todo verificado": no hay nada que mirar.
  if (!porRubro.length) motivos.push('todavía no hay ningún precio cargado', 'no se puede decir si alcanza el presupuesto');
  if (sinPrecio === 1) motivos.push('1 rubro todavía sin precio');
  if (sinPrecio > 1) motivos.push(`${sinPrecio} rubros todavía sin precio`);
  if (estimados === 1) motivos.push('1 rubro con precio provisional');
  if (estimados > 1) motivos.push(`${estimados} rubros con precio provisional`);
  if (hotelesSinVerificar.length === 1) motivos.push(`1 hotel sin tarifa confirmada (${hotelesSinVerificar[0].nombre})`);
  if (hotelesSinVerificar.length > 1) motivos.push(`${hotelesSinVerificar.length} hoteles sin tarifa confirmada`);
  if (manuales === 1) motivos.push('1 cosa anotada por confirmar');
  if (manuales > 1) motivos.push(`${manuales} cosas anotadas por confirmar`);
  if (color === 'verde' && motivos.length) color = 'amarillo';
  if (!motivos.length) motivos.push('Todo verificado y dentro del presupuesto');

  return {
    id: viaje.id,
    destino: viaje.destino,
    personas,
    noches,
    dias,
    fechas: {
      salida: viaje.fechas.salida,
      primeraNoche: viaje.fechas.primeraNoche,
      vuelta: viaje.fechas.vuelta,
      salidaTexto: fechaLarga(viaje.fechas.salida),
      vueltaTexto: fechaLarga(viaje.fechas.vuelta),
    },
    dinero: {
      subtotal,
      colchonPct: pct,
      colchon,
      total,
      techo,
      diferencia,
      cabe: total <= techo,
      porNoche,
      porDia,
      porPersonaTotal,
      porPersonaDia,
    },
    porRubro,
    semaforo: { color, motivos },
    pendientes,
    vuelo: evaluarVuelo(viaje),
  };
}

// ---------- Las tres formas de pagar un vuelo ----------
// Regla del proyecto: un canje que obliga a pasar por Estados Unidos no sirve,
// porque un pasaporte que no tiene visa no permite ese tránsito.
export function evaluarVuelo(viaje) {
  const saldo = Number(viaje.millas?.saldo ?? 0);
  const personas = Number(viaje.personas ?? 1);
  return (viaje.vuelo?.opciones || []).map((opcion) => {
    const millas = Number(opcion.millas ?? 0);
    const tasas = Number(opcion.tasasUSD ?? 0);
    const efectivo = Number(opcion.efectivoUSD ?? 0);
    // Tres estados: true (sí pasa por EE. UU.), false (no pasa) y sin declarar.
    // Sin declarar NO se puede dar por bueno: puede que el pasaporte no tenga visa.
    const escala = opcion.escalaEEUU;
    const millasFaltantes = Math.max(0, millas - saldo);
    const motivos = [];
    if (escala === true) motivos.push('hace escala en Estados Unidos (hace falta visa)');
    if (escala !== true && escala !== false) motivos.push('falta revisar por dónde pasa la escala');
    if (millasFaltantes > 0) motivos.push(`faltan ${millasFaltantes.toLocaleString('es')} millas`);
    const costoReal = aDolares(aCentavos(tasas) + aCentavos(efectivo));
    return {
      ...opcion,
      persona: personas,
      costoReal,
      millas,
      millasFaltantes,
      escalaEEUU: escala === true,
      viable: motivos.length === 0,
      motivos,
      estado: opcion.estado || 'falta',
    };
  });
}

// ---------- Lista de trabajo para un viaje nuevo ----------
// Lo que hay que averiguar antes de comprar nada, con el sitio donde se mira.
// Sale del método que ya usamos: nunca se da un precio sin fuente.
export function checklistBase(viaje = {}) {
  const destino = viaje.destino || 'el destino';
  const items = [
    // Papeles
    ['papeles', 'Visado y tránsito: confirmar si tu pasaporte necesita visa para el destino y para cada escala', 'https://www.iatatravelcentre.com/ o la embajada del país'],
    ['papeles', 'Pasaporte con al menos 6 meses de vigencia desde la vuelta', 'tu pasaporte, a ojo'],
    ['papeles', 'Seguro de viaje con cobertura médica y de cancelación', 'comparador de seguros; leer las exclusiones'],
    // Vuelos
    ['vuelos', `Cotizar los vuelos a ${destino} en las 3 formas: efectivo, canje total y millas + efectivo`, 'aerolínea y el buscador propio (flight-hunter)'],
    ['vuelos', 'Comprobar que ninguna escala pase por Estados Unidos, México o Canadá si no hay visa de tránsito', 'el itinerario que devuelve el buscador'],
    ['vuelos', 'Revisar el equipaje incluido y el costo de una maleta facturada', 'la tarifa concreta, no la letra chica general'],
    // Alojamiento
    ['alojamiento', 'Elegir hotel que cumpla: desayuno incluido, cancelación gratis, cama doble real, baño privado', 'la web del hotel, no un agregador'],
    ['alojamiento', 'Pedir la tarifa exacta de esas fechas por correo y guardar la respuesta', 'la web o el correo del hotel'],
    ['alojamiento', 'Confirmar cómo se llega desde la estación o el aeropuerto y cuánto cuesta', 'la web del hotel y el transporte local'],
    // Transporte
    ['transporte', 'Ver los horarios de tren y bus de las fechas reales (se publican 3-4 meses antes)', 'la web oficial del tren o del bus'],
    ['transporte', 'Saber cuál es el último bus o tren del día: eso manda el plan', 'el horario oficial, temporada correcta'],
    // Dinero
    ['dinero', 'Anotar el tipo de cambio del día y la comisión de la tarjeta', 'el banco y una casa de cambio'],
    ['dinero', 'Reservar un colchón del 10 % para imprevistos', 'esta misma app'],
    // Comida y salud
    ['comida', 'Calcular la comida por día e identificar un supermercado cerca de cada base', 'el mapa y la web del supermercado'],
    ['salud', 'Revisar vacunas recomendadas y si hay que comprar repelente o protector solar', 'la web de salud de tu país'],
    // Clima
    ['temporada', 'Elegir las fechas por clima y por precio, no solo por precio', 'histórico del clima y calendario de feriados'],
    ['temporada', 'Evitar feriados y eventos grandes del destino (suben los precios)', 'calendario oficial del país'],
  ];
  return items.map(([grupo, que, donde]) => ({ grupo, que, donde, estado: 'falta', critico: grupo === 'papeles' || grupo === 'vuelos' }));
}

// ---------- Esqueleto del informe ----------
// Un borrador con la forma que pide el proyecto, con los huecos marcados.
// Nunca inventa: los lugares vacíos quedan como "FALTA" para que el agente
// los llene con datos verificados.
export function esqueletoMarkdown(viaje) {
  const c = calcular(viaje);
  const falta = (texto) => `> **FALTA:** ${texto}`;
  const lineas = [
    `# ${c.destino} — borrador`,
    '',
    `- estado: pendiente de verificación`,
    `- creado: ${new Date().toISOString().slice(0, 10)}`,
    `- fechas: ${c.fechas.salida} → ${c.fechas.vuelta} (${c.noches} noches, ${c.dias} días)`,
    `- personas: ${c.personas}`,
    `- presupuesto: ${c.dinero.techo} USD`,
    '',
    '## 1. Vuelos',
    '',
    falta(`comparar las 3 formas de pago: ${c.vuelo.length ? 'ver tabla al final' : 'cotizar efectivo, canje total y millas + efectivo'}`),
    '',
    '## 2. Dónde quedarse',
    '',
    falta('una base por tramo, con desayuno incluido y cancelación gratis, y el precio de esas fechas exactas'),
    '',
    '## 3. Cómo moverse',
    '',
    falta('tren y bus oficiales de las fechas, con el último enlace del día'),
    '',
    '## 4. Resumen de ahorro',
    '',
    `Cuenta de esta versión: subtotal ${c.dinero.subtotal} USD + colchón ${c.dinero.colchonPct} % (${c.dinero.colchon} USD) = **${c.dinero.total} USD**.`,
    '',
    '## Antes de comprar',
    '',
    ...c.pendientes.map((p) => `- [ ] ${p.que} → ${p.donde || 'ver fuente'}`),
    '',
    '## Cuentas del viaje',
    '',
    '| Rubro | USD | Estado |',
    '|---|---|---|',
    ...c.porRubro.map((r) => `| ${r.nombre} | ${r.usd} | ${r.estado} |`),
    `| Colchón ${c.dinero.colchonPct} % | ${c.dinero.colchon} | — |`,
    `| **Total** | **${c.dinero.total}** | |`,
    '',
  ];
  if (c.vuelo.length) {
    lineas.push('| Forma de pago | Millas | Tasas y cargos USD | Costo total USD | Sirve | Motivo |', '|---|---|---|---|---|---|');
    for (const opcion of c.vuelo) {
      lineas.push(
        `| ${opcion.forma} | ${opcion.millas || 0} | ${opcion.costoReal} | ${opcion.costoReal} | ${opcion.viable ? 'sí' : 'no'} | ${opcion.motivos.join('; ') || '—'} |`
      );
    }
    lineas.push('');
  }
  return lineas.join('\n');
}
