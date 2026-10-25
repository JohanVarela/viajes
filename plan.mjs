// El plan de un viaje que todavía no existe: destino + fechas + presupuesto.
//
// IMPORTANTE: este archivo no importa nada propio de Node a propósito. Lo usan
// el servidor y también el navegador cuando la app se publica como sitio
// estático (sin servidor). Si acá se importara algo de Node, la app publicada
// dejaría de poder calcular el plan.

import { checklistBase, diasEntre, fechaLarga } from './modelo-viaje.mjs?v=6aa86e7e';

export function limpiar(valor, maximo = 200) {
  return String(valor ?? '').trim().slice(0, maximo);
}

export function aNumero(valor, porDefecto = NaN) {
  // El signo se conserva solo para poder rechazarlo: un presupuesto negativo no
  // se convierte en positivo a escondidas ("-500" no son 500 dólares).
  const limpio = String(valor ?? '').replace(/[^\d.,-]/g, '');
  if (!limpio || limpio.includes('-')) return porDefecto;
  const punto = limpio.lastIndexOf('.');
  const coma = limpio.lastIndexOf(',');
  let numero;
  if (punto >= 0 && coma >= 0) {
    // Hay de los dos separadores: el último es el de los centavos.
    // "2.400,50" (español) o "2,400.50" (inglés).
    numero = coma > punto ? Number(limpio.replace(/\./g, '').replace(/,/g, '.')) : Number(limpio.replace(/,/g, ''));
  } else if (coma >= 0) {
    const partes = limpio.split(',');
    // Con coma de miles al estilo latinoamericano: "5,014" son cinco mil catorce,
// pero "2400,50" son con cincuenta.
    numero =
      partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3
        ? Number(limpio.replace(/,/g, ''))
        : Number(limpio.replace(/,/g, '.'));
  } else if (punto >= 0) {
    // "2.400" son dos mil cuatrocientos, no dos coma cuatro.
    numero = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? Number(limpio.replace(/\./g, '')) : Number(limpio);
  } else {
    numero = Number(limpio);
  }
  return Number.isFinite(numero) ? numero : porDefecto;
}

export function esFechaValida(iso) {
  try {
    fechaLarga(iso);
    return true;
  } catch {
    return false;
  }
}

export function armarPlan(datos) {
  const problemas = [];
  const destino = limpiar(datos.destino, 120);
  if (!destino) problemas.push('Falta el destino');

  const supuestos = [];
  let personas = Math.round(aNumero(datos.personas, NaN));
  if (!Number.isFinite(personas) || personas < 1) {
    personas = 2;
    supuestos.push('cuántos viajan: usé 2 (una pareja), porque no me lo dijiste');
  }
  if (personas > 12) problemas.push('Más de 12 personas: pide el plan a mano');

  const techo = Math.round(aNumero(datos.presupuesto, 0) * 100) / 100;
  if (!techo) problemas.push('Falta el presupuesto total en dólares');

  const salida = String(datos.salidaISO || '').trim();
  const vuelta = String(datos.vueltaISO || '').trim();
  let fechas = null;
  if (salida || vuelta) {
    if (!esFechaValida(salida) || !esFechaValida(vuelta)) {
      problemas.push('Las fechas no son válidas');
    } else if (diasEntre(salida, vuelta) <= 0) {
      problemas.push('La vuelta tiene que ser después de la salida');
    } else {
      const dias = diasEntre(salida, vuelta) + 1;
      const noches = dias - 1;
      fechas = {
        salida: { iso: salida, texto: fechaLarga(salida) },
        vuelta: { iso: vuelta, texto: fechaLarga(vuelta) },
        dias,
        noches,
        nochesFueraDeCasa: noches,
        nota: 'Noches fuera de casa. Si la primera la pasas en el avión, duermes una menos.',
      };
    }
  }

  if (problemas.length) return { ok: false, problemas };

  const plan = {
    destino,
    personas,
    supuestos,
    techo,
    fechas,
    porNoche: fechas ? Math.round((techo / fechas.noches) * 100) / 100 : null,
    porPersonaDia: fechas ? Math.round((techo / fechas.dias / personas) * 100) / 100 : null,
    checklist: checklistBase({ destino }),
    aviso:
      'Esto no es un precio: es el plan de lo que hay que averiguar. Los precios se ponen cuando se ven en la fuente, y cada uno queda marcado como verificado o estimado.',
  };
  return { ok: true, plan };
}
