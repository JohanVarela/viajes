// La «prueba» de la clave para el buzón de pedidos.
//
// Sirve para que escribir en el buzón exija la misma clave que abre el viaje,
// SIN que la clave viaje nunca por internet y SIN que el Worker pueda leer nada
// del viaje con lo que recibe.
//
// Cómo: de la clave se deriva otra cosa con PBKDF2-SHA-256 y muchas vueltas, con
// una sal fija. Lo que se manda es ese resultado (64 caracteres hexadecimales),
// no la clave. Al revés es imposible: de la prueba no se vuelve a la clave, y
// probar claves a la fuerza cuesta 310.000 vueltas por intento.
//
// Este archivo corre igual en el teléfono y en Node: usa WebCrypto, que está en
// los dos lados, y no importa nada más.

export const SAL_BUZON = 'buzon-viajes-v1';
export const ITERACIONES_BUZON = 310000;
export const LARGO_PRUEBA = 64;

export async function derivarPrueba(clave) {
  const codificador = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw',
    codificador.encode(String(clave || '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: codificador.encode(SAL_BUZON),
      iterations: ITERACIONES_BUZON,
      hash: 'SHA-256',
    },
    base,
    256
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compara sin cortar en el primer carácter distinto. La copia que usa el Worker
// está en worker/buzon.mjs, que se puede pegar a mano en Cloudflare; la prueba
// automática comprueba que las dos comparan igual.
export function mismaPrueba(uno, otro) {
  const a = String(uno || '').toLowerCase();
  const b = String(otro || '').toLowerCase();
  if (a.length !== LARGO_PRUEBA || b.length !== LARGO_PRUEBA) return false;
  let distinto = 0;
  for (let i = 0; i < LARGO_PRUEBA; i += 1) distinto |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return distinto === 0;
}

export function parecePrueba(valor) {
  return typeof valor === 'string' && /^[0-9a-f]{64}$/i.test(valor.trim());
}
