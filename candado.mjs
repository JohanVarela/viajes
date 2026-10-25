// El candado del viaje.
//
// Cifra y descifra con la clave que elige el viajero. Este archivo corre igual en
// el navegador del teléfono y en Node, así que NO importa nada de Node: usa
// WebCrypto, que está en los dos lados.
//
// Cómo está hecho, para que se pueda revisar sin confiar:
//   · La clave nunca se guarda. Se escribe, se usa y se tira.
//   · De la clave se deriva otra con PBKDF2-SHA-256 y muchas vueltas
//     (ITERACIONES): así probar claves a la fuerza sale carísimo.
//   · El texto se cifra con AES-256-GCM, que además detecta si alguien lo tocó:
//     con la clave equivocada no sale basura, sale un error.
//   · Cada cifrado usa una sal y un vector nuevos al azar.

export const ITERACIONES = 310000;
export const LARGO_MINIMO = 12;

const codificador = new TextEncoder();
const descodificador = new TextDecoder();

function aBase64(bytes) {
  let texto = '';
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto);
}

function deBase64(texto) {
  const crudo = atob(texto);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

async function llaveDeLaClave(clave, salt, iteraciones, uso) {
  const base = await crypto.subtle.importKey('raw', codificador.encode(clave), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iteraciones, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [uso]
  );
}

// Devuelve el sobre cifrado: es lo único que se publica.
export async function cifrar(clave, objeto) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const llave = await llaveDeLaClave(clave, salt, ITERACIONES, 'encrypt');
  const claros = codificador.encode(JSON.stringify(objeto));
  const cifrados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, claros);
  return {
    candado: 1,
    version: 1,
    metodo: 'AES-256-GCM',
    derivacion: 'PBKDF2-SHA-256',
    iteraciones: ITERACIONES,
    salt: aBase64(salt),
    iv: aBase64(iv),
    cifrado: aBase64(new Uint8Array(cifrados)),
    cuando: new Date().toISOString(),
  };
}

// Con la clave equivocada no devuelve basura: corta con un error claro.
export async function descifrar(clave, sobre) {
  if (!sobre || sobre.candado !== 1) throw new Error('Estos datos no están cifrados.');
  if (!sobre.salt || !sobre.iv || !sobre.cifrado) {
    throw new Error('El archivo cifrado está incompleto o dañado.');
  }
  const llave = await llaveDeLaClave(clave, deBase64(sobre.salt), sobre.iteraciones || ITERACIONES, 'decrypt');
  try {
    const claros = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(sobre.iv) },
      llave,
      deBase64(sobre.cifrado)
    );
    return JSON.parse(descodificador.decode(claros));
  } catch {
    throw new Error('La clave no es esa. Fijate las mayúsculas y los acentos, y probá de nuevo.');
  }
}

export function estaCifrado(sobre) {
  return Boolean(sobre) && sobre.candado === 1;
}

// Para avisar antes de que elija una clave demasiado corta.
export function queTanLargaEs(clave) {
  const largo = String(clave || '').length;
  if (largo < LARGO_MINIMO) return { vale: false, motivo: `La clave tiene que tener al menos ${LARGO_MINIMO} caracteres.` };
  if (/^[a-z]+$/.test(clave) || /^\d+$/.test(clave)) {
    return { vale: true, motivo: 'Ojo: solo letras o solo números se adivinan más fácil. Mejor mezclá palabras.' };
  }
  return { vale: true, motivo: '' };
}
