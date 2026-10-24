'use strict';

/* ==========================================================================
   MODULO DE INTELIGENCIA Y PERFILADO OSINT 3.0 (PAIS + REGION + CIUDAD + UTC)
   Archivo: modulos/modulo_osint.js
   ========================================================================== */

const crypto = require('crypto');
const database = require('../database.js');

const MAX_COLA_OSINT = 500;
const MAX_REINTENTOS_DB = 5;
const DISCORD_EPOCH_MS = 1420070400000n;

const LISTA_NEGACIONES = [
    'no soy', 'no me llamo', 'no vivo en', 'nunca fui', 'imagina que',
    'broma', 'sarcasmo', 'mentira', 'ni que fuera', 'no tengo', 'ojala tener'
];

// 1. DICCIONARIO DE CIUDADES Y REGIONES EXPLICITAS -> PAIS Y REGION EXACTA (100% ASCII SAFE)
const GAZETTEER_CIUDADES_REGIONES = {
    'cdmx': { pais: 'M\u00e9xico', region: 'Centro / Valle de M\u00e9xico (UTC-6)' },
    'df': { pais: 'M\u00e9xico', region: 'Centro / Valle de M\u00e9xico (UTC-6)' },
    'edomex': { pais: 'M\u00e9xico', region: 'Centro / Valle de M\u00e9xico (UTC-6)' },
    'puebla': { pais: 'M\u00e9xico', region: 'Centro-Sur (UTC-6)' },
    'queretaro': { pais: 'M\u00e9xico', region: 'Baj\u00edo / Centro (UTC-6)' },
    'leon': { pais: 'M\u00e9xico', region: 'Baj\u00edo / Guanajuato (UTC-6)' },
    'guanajuato': { pais: 'M\u00e9xico', region: 'Baj\u00edo (UTC-6)' },
    'guadalajara': { pais: 'M\u00e9xico', region: 'Occidente / Jalisco (UTC-6)' },
    'jalisco': { pais: 'M\u00e9xico', region: 'Occidente / Jalisco (UTC-6)' },
    'monterrey': { pais: 'M\u00e9xico', region: 'Noreste / Nuevo Le\u00f3n (UTC-6)' },
    'nuevo leon': { pais: 'M\u00e9xico', region: 'Noreste / Nuevo Le\u00f3n (UTC-6)' },
    'tamaulipas': { pais: 'M\u00e9xico', region: 'Noreste / Frontera (UTC-6)' },
    'coahuila': { pais: 'M\u00e9xico', region: 'Norte (UTC-6)' },
    'chihuahua': { pais: 'M\u00e9xico', region: 'Norte (UTC-6)' },
    'juarez': { pais: 'M\u00e9xico', region: 'Frontera Norte / Chihuahua (UTC-6)' },
    'sinaloa': { pais: 'M\u00e9xico', region: 'Noroeste / Pac\u00edfico (UTC-7)' },
    'culiacan': { pais: 'M\u00e9xico', region: 'Noroeste / Sinaloa (UTC-7)' },
    'mazatlan': { pais: 'M\u00e9xico', region: 'Noroeste / Sinaloa (UTC-7)' },
    'sonora': { pais: 'M\u00e9xico', region: 'Noroeste / Pac\u00edfico (UTC-7)' },
    'hermosillo': { pais: 'M\u00e9xico', region: 'Noroeste / Sonora (UTC-7)' },
    'tijuana': { pais: 'M\u00e9xico', region: 'Noroeste Extremo / Baja California (UTC-8)' },
    'mexicali': { pais: 'M\u00e9xico', region: 'Noroeste Extremo / Baja California (UTC-8)' },
    'veracruz': { pais: 'M\u00e9xico', region: 'Golfo / Oriente (UTC-6)' },
    'merida': { pais: 'M\u00e9xico', region: 'Pen\u00ednsula de Yucat\u00e1n (UTC-6)' },
    'yucatan': { pais: 'M\u00e9xico', region: 'Pen\u00ednsula de Yucat\u00e1n (UTC-6)' },
    'cancun': { pais: 'M\u00e9xico', region: 'Sureste / Quintana Roo (UTC-5)' },

    'madrid': { pais: 'Espa\u00f1a', region: 'Comunidad de Madrid / Centro (CET)' },
    'barcelona': { pais: 'Espa\u00f1a', region: 'Catalu\u00f1a / Noreste (CET)' },
    'cataluna': { pais: 'Espa\u00f1a', region: 'Catalu\u00f1a / Noreste (CET)' },
    'valencia': { pais: 'Espa\u00f1a', region: 'Comunidad Valenciana / Levante (CET)' },
    'alicante': { pais: 'Espa\u00f1a', region: 'Comunidad Valenciana / Levante (CET)' },
    'sevilla': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Sur (CET)' },
    'malaga': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Costa del Sol (CET)' },
    'cadiz': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Sur (CET)' },
    'granada': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda Oriental (CET)' },
    'andalucia': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Sur (CET)' },
    'bilbao': { pais: 'Espa\u00f1a', region: 'Pa\u00eds Vasco / Norte (CET)' },
    'galicia': { pais: 'Espa\u00f1a', region: 'Galicia / Noroeste (CET)' },
    'vigo': { pais: 'Espa\u00f1a', region: 'Galicia / Noroeste (CET)' },
    'asturias': { pais: 'Espa\u00f1a', region: 'Asturias / Norte (CET)' },
    'zaragoza': { pais: 'Espa\u00f1a', region: 'Arag\u00f3n (CET)' },
    'murcia': { pais: 'Espa\u00f1a', region: 'Regi\u00f3n de Murcia / Sureste (CET)' },
    'canarias': { pais: 'Espa\u00f1a', region: 'Islas Canarias (WET / UTC+0)' },
    'tenerife': { pais: 'Espa\u00f1a', region: 'Islas Canarias / Tenerife (WET / UTC+0)' },
    'las palmas': { pais: 'Espa\u00f1a', region: 'Islas Canarias / Gran Canaria (WET / UTC+0)' },

    'buenos aires': { pais: 'Argentina', region: 'AMBA / Provincia de Buenos Aires (UTC-3)' },
    'baires': { pais: 'Argentina', region: 'AMBA / Buenos Aires (UTC-3)' },
    'caba': { pais: 'Argentina', region: 'Capital Federal / CABA (UTC-3)' },
    'cordoba': { pais: 'Argentina', region: 'Regi\u00f3n Centro / C\u00f3rdoba (UTC-3)' },
    'rosario': { pais: 'Argentina', region: 'Santa Fe / Litoral (UTC-3)' },
    'santa fe': { pais: 'Argentina', region: 'Litoral / Santa Fe (UTC-3)' },
    'mendoza': { pais: 'Argentina', region: 'Cuyo / Mendoza (UTC-3)' },
    'tucuman': { pais: 'Argentina', region: 'Noroeste / Tucum\u00e1n (UTC-3)' },
    'salta': { pais: 'Argentina', region: 'Noroeste / Salta (UTC-3)' },
    'mar del plata': { pais: 'Argentina', region: 'Costa Atl\u00e1ntica / PBA (UTC-3)' },
    'montevideo': { pais: 'Uruguay', region: 'Montevideo / Sur (UTC-3)' },

    'bogota': { pais: 'Colombia', region: 'Cundinamarca / Altiplano Andino (UTC-5)' },
    'medellin': { pais: 'Colombia', region: 'Antioquia / Regi\u00f3n Paisa (UTC-5)' },
    'antioquia': { pais: 'Colombia', region: 'Antioquia / Regi\u00f3n Paisa (UTC-5)' },
    'cali': { pais: 'Colombia', region: 'Valle del Cauca / Pac\u00edfico (UTC-5)' },
    'barranquilla': { pais: 'Colombia', region: 'Costa Caribe / Atl\u00e1ntico (UTC-5)' },
    'cartagena': { pais: 'Colombia', region: 'Costa Caribe / Bol\u00edvar (UTC-5)' },
    'bucaramanga': { pais: 'Colombia', region: 'Santander / Oriente (UTC-5)' },

    'santiago': { pais: 'Chile', region: 'Regi\u00f3n Metropolitana (UTC-3/UTC-4)' },
    'valparaiso': { pais: 'Chile', region: 'Zona Central / Valpara\u00edso (UTC-3/UTC-4)' },
    'concepcion': { pais: 'Chile', region: 'Zona Centro-Sur / Biob\u00edo (UTC-3/UTC-4)' },
    'lima': { pais: 'Per\u00fa', region: 'Lima Metropolitana / Costa Central (UTC-5)' },
    'arequipa': { pais: 'Per\u00fa', region: 'Sur / Arequipa (UTC-5)' },
    'trujillo': { pais: 'Per\u00fa', region: 'Costa Norte / La Libertad (UTC-5)' },
    'caracas': { pais: 'Venezuela', region: 'Regi\u00f3n Capital (UTC-4)' },
    'maracaibo': { pais: 'Venezuela', region: 'Occidente / Zulia (UTC-4)' }
};

// 2. MATRIZ DIALECTAL CON SUB-REGIONES Y CORRELACION HORARIA UTC
const DICCIONARIO_DIALECTOS = [
    {
        pais: 'M\u00e9xico',
        husosEsperados: [0, 1, 2, 3, 4, 5, 6, 19, 20, 21, 22, 23],
        regex: /\b(wey|weyes|nmms|no mames|chido|alv|neta|carnal|morro|morra|feria|chamba|jalar|pedo|pinche|vato|banda|ahorita|simon|nel|chale|valedor|chilango|plebe|plebes|fierro|machin|huerco|raza|cura)\b/gi,
        subregiones: [
            { nombre: 'Noroeste / Pac\u00edfico (Sinaloa, Sonora, BC)', regex: /\b(plebe|plebes|fierro|machin|bato|cura)\b/i },
            { nombre: 'Norte / Noreste (Monterrey, Nuevo Le\u00f3n)', regex: /\b(huerco|huerca|raza|chiriwillo|compare)\b/i },
            { nombre: 'Centro / Valle de M\u00e9xico (CDMX, Edomex)', regex: /\b(chale|valedor|chilango|carnal|banda|camara)\b/i }
        ]
    },
    {
        pais: 'Espa\u00f1a',
        husosEsperados: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(chaval|chavales|ostia|hostia|currar|curro|colega|flipar|flipas|mola|mogollon|gilipollas|capullo|pavo|pavos|guay|pillar|tio|tia|quillo|illo|pisha|miarma|guagua|chacho|muyayo|mazo|renta|tronco|tete|nano)\b/gi,
        subregiones: [
            { nombre: 'Andaluc\u00eda / Sur', regex: /\b(quillo|illo|pisha|miarma|coraje|malaje)\b/i },
            { nombre: 'Islas Canarias (UTC+0)', regex: /\b(guagua|chacho|muyayo|fleje|baifo)\b/i },
            { nombre: 'Comunidad de Madrid / Centro', regex: /\b(mazo|renta|tronco|cani)\b/i },
            { nombre: 'Levante / Catalu\u00f1a (Valencia, Barcelona)', regex: /\b(tete|nano|nen|apa)\b/i }
        ]
    },
    {
        pais: 'Argentina / Uruguay',
        husosEsperados: [0, 1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(boludo|boluda|pelotudo|quilombo|laburo|laburar|bondi|pibe|piba|chabon|guita|morfar|re piola|mal ahi|posta|chamuyo|birra|culiau|culiado|nero|guri|ta luego|bo)\b/gi,
        subregiones: [
            { nombre: 'C\u00f3rdoba / Regi\u00f3n Centro (Argentina)', regex: /\b(culiau|culiado|nero|fernet)\b/i },
            { nombre: 'Uruguay / Litoral', regex: /\b(guri|gurises|salado|championes)\b/i },
            { nombre: 'AMBA / Buenos Aires (Argentina)', regex: /\b(bondi|chabon|guita|morfar|quilombo)\b/i }
        ]
    },
    {
        pais: 'Chile',
        husosEsperados: [0, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(weon|weona|wn|qlo|culiao|cachai|fome|pololo|polola|cuatico|bacan|altiro|caleta|paco|filete|piola)\b/gi,
        subregiones: []
    },
    {
        pais: 'Colombia',
        husosEsperados: [0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(parce|parcero|gonorrea|chimba|bacano|marica|mk|camello|camellar|pola|rumbear|vaina|pelao|berraco|ome|sisas|paila|rola|eche|monda|cule)\b/gi,
        subregiones: [
            { nombre: 'Antioquia / Medell\u00edn (Regi\u00f3n Paisa)', regex: /\b(ome|parce|parcero|sisas|chimba)\b/i },
            { nombre: 'Costa Caribe (Barranquilla, Cartagena)', regex: /\b(eche|monda|cule|cuadros)\b/i },
            { nombre: 'Bogot\u00e1 / Altiplano Cundiboyacense', regex: /\b(paila|rola|rolo|chino|sumerce)\b/i }
        ]
    },
    {
        pais: 'Per\u00fa',
        husosEsperados: [0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(causa|causita|pata|jato|chibolo|chibola|palta|que palta|asado|bravazo|chevere|fercho|jerma|oe|pe)\b/gi,
        subregiones: []
    },
    {
        pais: 'Venezuela',
        husosEsperados: [0, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(chamo|chama|marico|arrecho|burda|coroto|ladilla|pajuo|beta|pana|mamaguevo|mmg|verga|mardicion)\b/gi,
        subregiones: [
            { nombre: 'Occidente / Zulia (Maracaibo)', regex: /\b(verga|mardicion|molleja|trimardito)\b/i }
        ]
    }
];

const REGLAS_PII_AVANZADAS = [
    {
        etiqueta: 'DEMOGRAFIA_EDAD',
        regex: /(?:^|\s)(?:tengo|cumplo|cumpli|cumpl\u00ed|voy a cumplir)\s+(1[1-9]|[2-5][0-9])\s*(?:a\u00f1os|a\u00f1itos|anos|anitos)?(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'DEMOGRAFIA_NACIMIENTO',
        regex: /(?:^|\s)(?:soy del|naci en el|nac\u00ed en el|naci en|nac\u00ed en)\s+(200[0-9]|201[0-4]|199[0-9]|0[2-9]|1[0-3])(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'GEOLOCALIZACION_DECLARADA',
        regex: /(?:^|\s)(?:soy de|vivo en|aca en|ac\u00e1 en|aqui en|aqu\u00ed en|mi pais es|mi pa\u00eds es|mi ciudad es)\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{3,18}(?:\s+[a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{2,18})?)(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'GENTILICIO_ORIGEN',
        regex: /\b(?:soy|nosotros somos)\s+(mexican[oa]|espa\u00f1ol[a]?|espanol[a]?|argentin[oa]|chilen[oa]|colombian[oa]|peruan[oa]|venezolan[oa]|uruguay[oa]|ecuatorian[oa]|bolivian[oa]|paraguay[oa]|dominican[oa]|regi[oa]|tapat[i\u00ed][oa]|chilang[oa]|paisa|coste\u00f1[oa]|porte\u00f1[oa]|cordob[\u00e9e]s[a]?|andaluz[a]?|canari[oa]|catal[\u00e1a]n[a]?)\b/gi
    },
    {
        etiqueta: 'IDENTIDAD_NOMBRE_REAL',
        regex: /(?:^|\s)(?:me llamo|mi nombre es|mi verdadero nombre es|llamenme|ll\u00e1menme|diganme|d\u00edganme)\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{3,16})(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'VINCULACION_REDES',
        regex: /(?:(?:mi\s+)?(?:ig|insta|instagram|tiktok|tt|twitter|x|tg|telegram|github|steam|roblox)\s*(?:es|:)\s*@?([a-zA-Z0-9_.]{3,24})|s[\u00edi]ganme\s+en\s+@([a-zA-Z0-9_.]{3,24}))/gi
    }
];

const MAPA_GENTILICIOS = {
    'regio': { pais: 'M\u00e9xico', region: 'Noreste / Monterrey (Nuevo Le\u00f3n)' },
    'regia': { pais: 'M\u00e9xico', region: 'Noreste / Monterrey (Nuevo Le\u00f3n)' },
    'tapatio': { pais: 'M\u00e9xico', region: 'Occidente / Guadalajara (Jalisco)' },
    'tapatia': { pais: 'M\u00e9xico', region: 'Occidente / Guadalajara (Jalisco)' },
    'chilango': { pais: 'M\u00e9xico', region: 'Centro / CDMX' },
    'chilanga': { pais: 'M\u00e9xico', region: 'Centro / CDMX' },
    'paisa': { pais: 'Colombia', region: 'Antioquia / Medell\u00edn' },
    'porteno': { pais: 'Argentina', region: 'AMBA / Buenos Aires' },
    'portena': { pais: 'Argentina', region: 'AMBA / Buenos Aires' },
    'cordobes': { pais: 'Argentina', region: 'C\u00f3rdoba' },
    'andaluz': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Sur' },
    'andaluza': { pais: 'Espa\u00f1a', region: 'Andaluc\u00eda / Sur' },
    'canario': { pais: 'Espa\u00f1a', region: 'Islas Canarias (UTC+0)' },
    'canaria': { pais: 'Espa\u00f1a', region: 'Islas Canarias (UTC+0)' },
    'catalan': { pais: 'Espa\u00f1a', region: 'Catalu\u00f1a' }
};

const PALABRAS_EXCLUIDAS_LUGAR_O_NOMBRE = new Set([
    'aqui', 'aca', 'alla', 'alli', 'casa', 'nadie', 'alguien', 'todos', 'broma',
    'verdad', 'mentira', 'server', 'discord', 'clan', 'squad', 'raid', 'mejor',
    'peor', 'nuevo', 'viejo', 'loco', 'poco', 'mucho', 'todo', 'nada', 'eso', 'esto'
]);

const colaTrabajosOSINT = [];
let procesandoCola = false;
const memoriaHuellaReciente = new Map();

function normalizarSinTildes(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function estimarRegionPorCurvaHoraria(pais, horasActivas = [], horaActualUtc = 18) {
    const muestra = Array.isArray(horasActivas) && horasActivas.length > 0 ? horasActivas : [horaActualUtc];
    const tieneActividadMadrugadaTardia = muestra.some(h => h >= 6 && h <= 9);

    if (pais === 'M\u00e9xico') {
        if (tieneActividadMadrugadaTardia && !muestra.some(h => h >= 12 && h <= 15)) {
            return 'Huso Pac\u00edfico / Noroeste (Sinaloa, Sonora, BC - UTC-7/UTC-8)';
        }
        return 'Huso Centro / Golfo (CDMX, Monterrey, Guadalajara - UTC-6)';
    }
    if (pais === 'Espa\u00f1a') {
        const trasnochaUtc = muestra.some(h => h === 2 || h === 3);
        if (trasnochaUtc) return 'Horario Atl\u00e1ntico / Canarias o Nocturno Peninsular (WET/CET)';
        return 'Huso Peninsular (Madrid, Barcelona, Andaluc\u00eda - CET)';
    }
    return null;
}

async function procesarColaOSINT() {
    if (procesandoCola || colaTrabajosOSINT.length === 0) return;
    procesandoCola = true;

    while (colaTrabajosOSINT.length > 0) {
        const trabajo = colaTrabajosOSINT[0];
        try {
            const respuestaBD = await database.ficharInfractor(
                trabajo.authorId,
                trabajo.authorTag,
                trabajo.accionContexto,
                trabajo.casoId,
                trabajo.evidenciaHTML,
                trabajo.servidorOrigen,
                true
            );

            if (trabajo.perfilEstructurado) {
                await database.guardarPerfilOsintEstructurado(
                    trabajo.authorId,
                    trabajo.authorTag,
                    trabajo.perfilEstructurado
                );
            }

            if (respuestaBD === 'BD Inactiva' || respuestaBD.startsWith('Error de escritura')) {
                throw new Error(respuestaBD);
            }
            colaTrabajosOSINT.shift();
        } catch (error) {
            trabajo.reintentos++;
            if (trabajo.reintentos > MAX_REINTENTOS_DB) {
                colaTrabajosOSINT.shift();
            } else {
                const esperaMs = Math.min(30000, Math.pow(2, trabajo.reintentos) * 1000);
                await new Promise(resolve => setTimeout(resolve, esperaMs));
            }
        }
    }

    procesandoCola = false;
}

function escaparHTML(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function limpiarRuido(textoCrudo) {
    if (typeof textoCrudo !== 'string') return '';
    return textoCrudo
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/^>.*$/gm, ' ')
        .trim();
}

function evaluarContextoLexico(mensajeMinusculas, coincidenciaMinusculas) {
    const index = mensajeMinusculas.indexOf(coincidenciaMinusculas);
    if (index === -1) return true;
    const ventanaInicio = Math.max(0, index - 40);
    const ventanaFin = Math.min(mensajeMinusculas.length, index + coincidenciaMinusculas.length + 40);
    const proximidad = mensajeMinusculas.slice(ventanaInicio, ventanaFin);

    for (const negacion of LISTA_NEGACIONES) {
        if (proximidad.includes(negacion)) return false;
    }
    return true;
}

function analizarAntiguedadSnowflake(userId) {
    try {
        const cleanId = String(userId || '').replace(/\D/g, '');
        if (cleanId.length < 17) return null;
        const timestampMs = Number((BigInt(cleanId) >> 22n) + DISCORD_EPOCH_MS);
        const diasAntiguedad = Math.floor((Date.now() - timestampMs) / 86400000);
        const fechaCreacion = new Date(timestampMs).toISOString().slice(0, 10);
        return {
            fechaCreacion,
            diasAntiguedad,
            esBurner: diasAntiguedad <= 21
        };
    } catch (_) {
        return null;
    }
}

function sanitizarPII(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g, '[CORREO_OCULTO]')
        .replace(/\+?\d{1,3}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[TELEFONO_OCULTO]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_OCULTA]');
}

function extraerPatronVida(timestamp) {
    const fecha = new Date(timestamp || Date.now());
    const hora = fecha.getUTCHours();
    let ciclo = 'Actividad de Madrugada (UTC) - Latam Nocturno';
    if (hora >= 6 && hora < 12) ciclo = 'Actividad Matutina (UTC) - Europa Manana';
    else if (hora >= 12 && hora < 18) ciclo = 'Actividad Diurna (UTC) - Europa Tarde / Latam Manana';
    else if (hora >= 18 && hora < 24) ciclo = 'Actividad Vespertina/Nocturna (UTC) - Hora Punta Global';
    return { hora, texto: `Hora UTC: ${String(hora).padStart(2, '0')}:00 - ${ciclo}` };
}

function empaquetarEvidenciaEstructurada(authorTag, authorId, apodoServidor, infoSnowflake, perfilEstructurado, vectores, entidades, contextoSaneado, metadataVida) {
    const tagSeguro = escaparHTML(authorTag);
    const idSeguro = escaparHTML(authorId);
    const apodoSeguro = escaparHTML(apodoServidor || 'Sin apodo local');
    const vectoresSeguros = vectores.map(escaparHTML).join(' | ');
    const metadataSegura = escaparHTML(metadataVida);
    const contextoHTMLSeguro = escaparHTML(contextoSaneado);

    const textoBurner = infoSnowflake
        ? `${infoSnowflake.fechaCreacion} (${infoSnowflake.diasAntiguedad} dias) ${infoSnowflake.esBurner ? '[!] ALERTA CUENTA BURNER RECIENTE' : ''}`
        : 'Desconocida';

    const geoResumen = [
        perfilEstructurado.pais ? `Pais: ${perfilEstructurado.pais}` : null,
        perfilEstructurado.region ? `Region: ${perfilEstructurado.region}` : null,
        perfilEstructurado.ciudadDeclarada ? `Localidad: ${perfilEstructurado.ciudadDeclarada}` : null
    ].filter(Boolean).join(' // ') || 'En analisis';

    let paqueteHTML = `<div style="font-family: var(--font-mono); font-size: 0.84rem; line-height: 1.45;">`;
    paqueteHTML += `<div style="color: var(--accent-rz); font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">[ DOSSIER DE PERFILADO OSINT 3.0 // GEOLOCALIZACION REGIONAL ]</div>`;
    paqueteHTML += `<div style="color: var(--text-main); margin-bottom: 0.9rem;">`;
    paqueteHTML += `<strong>Sujeto:</strong> ${tagSeguro} <span style="color: var(--text-muted);">(${idSeguro})</span><br>`;
    paqueteHTML += `<strong>Apodo en Servidor:</strong> <span style="color: var(--text-secondary);">${apodoSeguro}</span><br>`;
    paqueteHTML += `<strong>Ubicacion Deducida:</strong> <span style="color: #00f0ff; font-weight: bold;">${escaparHTML(geoResumen)}</span><br>`;
    paqueteHTML += `<strong>Creacion de Cuenta (Snowflake):</strong> <span style="color: ${infoSnowflake?.esBurner ? 'var(--accent-red)' : 'var(--accent-green)'};">${escaparHTML(textoBurner)}</span><br>`;
    paqueteHTML += `<strong>Vectores Detectados:</strong> <span style="color: var(--accent-amber);">${vectoresSeguros}</span><br>`;
    paqueteHTML += `<strong>Patron Cronobiologico:</strong> <span style="color: var(--accent-info);">${metadataSegura}</span><br>`;
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="border-left: 2px solid var(--accent-green); padding-left: 0.8rem; margin-bottom: 0.9rem; background: rgba(16, 185, 129, 0.06);">`;
    paqueteHTML += `<div style="color: var(--accent-green); font-weight: bold; margin-bottom: 0.3rem;">INTELIGENCIA Y ENTIDADES EXTRAIDAS:</div>`;

    for (const ent of entidades) {
        const colorConfianza = ent.confianza >= 85
            ? 'var(--accent-green)'
            : (ent.confianza >= 65 ? 'var(--accent-amber)' : 'var(--accent-red)');
        paqueteHTML += `<div style="margin-bottom: 0.25rem;">&#9679; <strong>${escaparHTML(ent.etiqueta)}:</strong> ${escaparHTML(ent.valorNormalizado)} <span style="color: ${colorConfianza}; font-size: 0.74rem;">[Fiabilidad: ${ent.confianza}%]</span></div>`;
    }
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="color: var(--text-muted); margin-bottom: 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.25rem;">SEGMENTO DE CHAT CAPTURADO:</div>`;
    paqueteHTML += `<div style="white-space: pre-wrap; color: #dbdee1;">${contextoHTMLSeguro}</div>`;
    paqueteHTML += `</div>`;

    return paqueteHTML;
}

async function ejecutar(message, contextoCache, horasActivasUsuario = []) {
    if (!message?.content) return null;

    const contenidoSinRuido = limpiarRuido(message.content);
    if (contenidoSinRuido.length < 3) return null;

    const contenidoMinusculas = contenidoSinRuido.toLowerCase();
    const patronVida = extraerPatronVida(message.createdTimestamp);
    const etiquetasDisparadas = new Set();
    const entidadesProcesadas = [];

    const perfilEstructurado = {
        pais: null,
        region: null,
        ciudadDeclarada: null,
        husoEstimado: null,
        edad: null,
        nombreReal: null,
        gentilicio: null,
        modismos: [],
        redes: []
    };

    for (const regla of REGLAS_PII_AVANZADAS) {
        const regex = new RegExp(regla.regex.source, 'gi');
        let match;
        while ((match = regex.exec(contenidoSinRuido)) !== null) {
            const fullMatch = String(match[0] || '').trim();
            const capturado = String(match[1] || match[2] || '').trim();
            if (!capturado) continue;
            if (!evaluarContextoLexico(contenidoMinusculas, fullMatch.toLowerCase())) continue;

            const capNorm = normalizarSinTildes(capturado);
            if (PALABRAS_EXCLUIDAS_LUGAR_O_NOMBRE.has(capNorm)) continue;

            const dedupKey = `${message.author.id}:${regla.etiqueta}:${capNorm}`;
            if (memoriaHuellaReciente.has(dedupKey)) continue;
            memoriaHuellaReciente.set(dedupKey, Date.now());

            if (regla.etiqueta === 'GEOLOCALIZACION_DECLARADA') {
                perfilEstructurado.ciudadDeclarada = capturado;
                if (GAZETTEER_CIUDADES_REGIONES[capNorm]) {
                    perfilEstructurado.pais = GAZETTEER_CIUDADES_REGIONES[capNorm].pais;
                    perfilEstructurado.region = GAZETTEER_CIUDADES_REGIONES[capNorm].region;
                }
            } else if (regla.etiqueta === 'GENTILICIO_ORIGEN') {
                perfilEstructurado.gentilicio = capturado;
                if (MAPA_GENTILICIOS[capNorm]) {
                    perfilEstructurado.pais = MAPA_GENTILICIOS[capNorm].pais;
                    perfilEstructurado.region = MAPA_GENTILICIOS[capNorm].region;
                }
            } else if (regla.etiqueta === 'DEMOGRAFIA_EDAD') {
                perfilEstructurado.edad = `${capturado} a\u00f1os`;
            } else if (regla.etiqueta === 'IDENTIDAD_NOMBRE_REAL') {
                perfilEstructurado.nombreReal = capturado;
            } else if (regla.etiqueta === 'VINCULACION_REDES') {
                perfilEstructurado.redes.push(fullMatch);
            }

            etiquetasDisparadas.add(regla.etiqueta);
            entidadesProcesadas.push({
                etiqueta: regla.etiqueta,
                valorNormalizado: `${capturado} (en "${fullMatch}")`,
                confianza: 92
            });
        }
    }

    for (const dialecto of DICCIONARIO_DIALECTOS) {
        const regex = new RegExp(dialecto.regex.source, 'gi');
        const matches = contenidoSinRuido.match(regex);
        if (matches && matches.length > 0) {
            const unicos = [...new Set(matches.map(m => m.toLowerCase()))];
            const horarioCoherente = dialecto.husosEsperados.includes(patronVida.hora);

            let subregionDetectada = null;
            for (const sub of (dialecto.subregiones || [])) {
                if (sub.regex.test(contenidoSinRuido)) {
                    subregionDetectada = sub.nombre;
                    break;
                }
            }

            if (unicos.length >= 2 || subregionDetectada || (unicos.length === 1 && horarioCoherente)) {
                const dedupKey = `${message.author.id}:DIALECTO:${dialecto.pais}:${subregionDetectada || 'GEN'}`;
                const ultimoRegistro = memoriaHuellaReciente.get(dedupKey) || 0;

                if (Date.now() - ultimoRegistro > 21600000) {
                    memoriaHuellaReciente.set(dedupKey, Date.now());
                    const regionPorCurva = estimarRegionPorCurvaHoraria(dialecto.pais, horasActivasUsuario, patronVida.hora);
                    const regionFinal = subregionDetectada || regionPorCurva || 'Huso Compatible UTC';

                    perfilEstructurado.pais = perfilEstructurado.pais || dialecto.pais;
                    perfilEstructurado.region = perfilEstructurado.region || regionFinal;
                    perfilEstructurado.modismos.push(...unicos);

                    etiquetasDisparadas.add('HUELLA_REGIONAL_UTC');
                    entidadesProcesadas.push({
                        etiqueta: 'HUELLA_REGIONAL_UTC',
                        valorNormalizado: `${dialecto.pais} - ${regionFinal} (Modismos: ${unicos.join(', ')})`,
                        confianza: subregionDetectada && horarioCoherente ? 95 : (unicos.length >= 2 && horarioCoherente ? 90 : 78)
                    });
                }
            }
        }
    }

    if (etiquetasDisparadas.size === 0 || entidadesProcesadas.length === 0) {
        return null;
    }

    if (memoriaHuellaReciente.size > 4000) {
        memoriaHuellaReciente.clear();
    }

    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const apodoServidor = message.member?.nickname || message.author.globalName || message.author.username || '';
    const infoSnowflake = analizarAntiguedadSnowflake(message.author.id);
    const casoIdGenerado = `PRFL_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    let lineasContexto = [];
    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const horaStr = new Date(msg.createdTimestamp || Date.now()).toISOString().split('T')[1].slice(0, 8);
            const indicador = (msg.authorId === message.author.id && msg.content === message.content)
                ? ' (<<< OBJETIVO)'
                : '';
            lineasContexto.push(`[${horaStr}] ${msg.authorTag}: ${msg.content}${indicador}`);
        }
    } else {
        lineasContexto.push(`[CAPTURA] ${message.author.tag}: ${message.content}`);
    }

    const contextoSaneado = sanitizarPII(lineasContexto.join('\n'));
    const listaEtiquetas = Array.from(etiquetasDisparadas);

    const evidenciaHTML = empaquetarEvidenciaEstructurada(
        message.author.tag,
        message.author.id,
        apodoServidor,
        infoSnowflake,
        perfilEstructurado,
        listaEtiquetas,
        entidadesProcesadas,
        contextoSaneado,
        patronVida.texto
    );

    if (colaTrabajosOSINT.length >= MAX_COLA_OSINT) {
        colaTrabajosOSINT.shift();
    }

    colaTrabajosOSINT.push({
        authorId: message.author.id,
        authorTag: message.author.tag,
        accionContexto: `Perfilado OSINT 3.0 [${listaEtiquetas.join(', ')}]`,
        casoId: casoIdGenerado,
        evidenciaHTML,
        servidorOrigen,
        perfilEstructurado,
        reintentos: 0
    });

    procesarColaOSINT();
    return perfilEstructurado;
}

module.exports = { ejecutar, analizarAntiguedadSnowflake };
