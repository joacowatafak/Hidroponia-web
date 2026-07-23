const espIpInput = document.getElementById("espIp");

function getBaseUrl() {
  const ip = (espIpInput?.value || "").trim();
  const host = window.location.hostname;

  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}`;
  }

  if (ip) {
    return `http://${ip}`;
  }

  return "";
}

function sendCommand(endpoint) {
  const base = getBaseUrl();
  if (!base) {
    alert("Ingresá la IP del ESP8266");
    return;
  }

  fetch(`${base}/${endpoint}`, { method: "GET" })
    .catch(err => console.error("Error al enviar comando:", err));
}// Script básico para HydroControl

const estadoLuzEl = document.getElementById('estadoLuz');
const estadoBombaEl = document.getElementById('estadoBomba');
const luzOnBtn = document.getElementById('luzOn');
const luzOffBtn = document.getElementById('luzOff');
const bombaOnBtn = document.getElementById('bombaOn');
const bombaOffBtn = document.getElementById('bombaOff');
const modoAutoEl = document.getElementById('modoAuto');
const epocaSelect = document.getElementById('epocaSelect');
const humThresholdEl = document.getElementById('humThreshold');
const espIpEl = document.getElementById('espIp');
const saveSettingsBtn = document.getElementById('saveSettings');
const connStatusEl = document.getElementById('connStatus');
const tempEl = document.getElementById('temp');
const humEl = document.getElementById('hum');
const lightsStartEl = document.getElementById('lightsStart');
const lightsEndEl = document.getElementById('lightsEnd');
const pumpIntervalEl = document.getElementById('pumpInterval');

let settings = {
  espIp: localStorage.getItem('espIp') || '',
  modoAuto: localStorage.getItem('modoAuto') === 'true',
  epoca: localStorage.getItem('epoca') || 'primavera',
  humThreshold: localStorage.getItem('humThreshold') || '60',
  lightsStart: localStorage.getItem('lightsStart') || '',
  lightsEnd: localStorage.getItem('lightsEnd') || '',
  pumpInterval: localStorage.getItem('pumpInterval') || '30'
};

function applySettingsToUI() {
  espIpEl.value = settings.espIp;
  modoAutoEl.checked = settings.modoAuto;
  epocaSelect.value = settings.epoca;
  humThresholdEl.value = settings.humThreshold;
  lightsStartEl.value = settings.lightsStart;
  lightsEndEl.value = settings.lightsEnd;
  pumpIntervalEl.value = settings.pumpInterval;
}

applySettingsToUI();

saveSettingsBtn.addEventListener('click', () => {
  settings.espIp = espIpEl.value.trim();
  settings.modoAuto = modoAutoEl.checked;
  settings.epoca = epocaSelect.value;
  settings.humThreshold = humThresholdEl.value;
  settings.lightsStart = lightsStartEl.value;
  settings.lightsEnd = lightsEndEl.value;
  settings.pumpInterval = pumpIntervalEl.value;
  localStorage.setItem('espIp', settings.espIp);
  localStorage.setItem('modoAuto', settings.modoAuto);
  localStorage.setItem('epoca', settings.epoca);
  localStorage.setItem('humThreshold', settings.humThreshold);
  localStorage.setItem('lightsStart', settings.lightsStart);
  localStorage.setItem('lightsEnd', settings.lightsEnd);
  localStorage.setItem('pumpInterval', settings.pumpInterval);
  connStatusEl.textContent = 'Ajustes guardados';
});

function baseUrl() {
  if (!settings.espIp) return null;
  if (settings.espIp.startsWith('http')) return settings.espIp;
  return `http://${settings.espIp}`;
}

async function sendCommand(device, action) {
  const base = baseUrl();
  if (!base) {
    connStatusEl.textContent = 'IP ESP no configurada';
    return;
  }
  const url = `${base}/${device}/${action}`; // e.g. http://ip/luz/on
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('error en petición');
    connStatusEl.textContent = `OK: ${device} ${action}`;
    // actualiza estado visible leyendo /status si existe
    await fetchStatus();
  } catch (err) {
    connStatusEl.textContent = 'Error conectando al ESP';
  }
}

luzOnBtn.addEventListener('click', () => {
  // actualización optimista de la UI
  estadoLuzEl.textContent = 'ON';
  sendCommand('luz', 'on');
});

luzOffBtn.addEventListener('click', () => {
  estadoLuzEl.textContent = 'OFF';
  sendCommand('luz', 'off');
});

bombaOnBtn.addEventListener('click', () => {
  estadoBombaEl.textContent = 'ON';
  sendCommand('bomba', 'on');
});

bombaOffBtn.addEventListener('click', () => {
  estadoBombaEl.textContent = 'OFF';
  sendCommand('bomba', 'off');
});

async function fetchStatus() {
  const base = baseUrl();
  if (!base) return;
  try {
    const res = await fetch(`${base}/sensor`);
    if (!res.ok) throw new Error('no sensor');
    const data = await res.json();
    // Espera { temp: number, hum: number, luz: 'ON'|'OFF', bomba: 'ON'|'OFF' }
    // Mostrar error si sensor no responde (null/undefined)
    if (data.temp === null || data.temp === undefined) {
      tempEl.textContent = 'Error de datos';
    } else {
      tempEl.textContent = `${data.temp}°C`;
    }
    if (data.hum === null || data.hum === undefined) {
      humEl.textContent = 'Error de datos';
    } else {
      humEl.textContent = `${data.hum}%`;
    }
    estadoLuzEl.textContent = data.luz || estadoLuzEl.textContent;
    estadoBombaEl.textContent = data.bomba || estadoBombaEl.textContent;
    connStatusEl.textContent = 'Conectado';
    return data;
  } catch (err) {
    connStatusEl.textContent = 'No responde el ESP (sensor)';
    // indicar error de datos en la UI si no hay respuesta
    tempEl.textContent = 'Error de datos';
    humEl.textContent = 'Error de datos';
    return null;
  }
}

// Lógica básica modo automático
async function automaticControl() {
  if (!settings.modoAuto) return;
  const data = await fetchStatus();
  if (!data) return;
  const hum = Number(data.hum);
  const threshold = Number(settings.humThreshold);
  if (isNaN(hum)) return;
  if (hum < threshold) {
    // activar bomba por un corto periodo
    await sendCommand('bomba', 'on');
    // apagar después de 10 segundos localmente (el ESP idealmente manejaría esto)
    setTimeout(() => sendCommand('bomba', 'off'), 10000);
  }
  // Control horario de luces por épocas (ejemplo simple)
  if (settings.lightsStart && settings.lightsEnd) {
    const now = new Date();
    const start = parseTime(settings.lightsStart);
    const end = parseTime(settings.lightsEnd);
    const inRange = isTimeInRange(now, start, end);
    if (inRange && estadoLuzEl.textContent !== 'ON') await sendCommand('luz', 'on');
    if (!inRange && estadoLuzEl.textContent === 'ON') await sendCommand('luz', 'off');
  }
}

function parseTime(hhmm) {
  const [hh, mm] = hhmm.split(':').map(n => parseInt(n, 10));
  return { hh, mm };
}

function isTimeInRange(now, start, end) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = start.hh * 60 + start.mm;
  const minutesEnd = end.hh * 60 + end.mm;
  if (minutesStart <= minutesEnd) return minutesNow >= minutesStart && minutesNow <= minutesEnd;
  // rango pasa por la medianoche
  return minutesNow >= minutesStart || minutesNow <= minutesEnd;
}

// Polling periódico
setInterval(fetchStatus, 5000);
setInterval(automaticControl, 15000);

// Inicializa UI
fetchStatus();

// Mantener settings sincronizados cuando el usuario cambie el checkbox
modoAutoEl.addEventListener('change', () => {
  settings.modoAuto = modoAutoEl.checked;
  localStorage.setItem('modoAuto', settings.modoAuto);
});

// Nota: este script asume que el firmware del ESP expone endpoints simples:
// GET /sensor -> JSON { temp, hum, luz, bomba }
// GET /luz/on , /luz/off , /bomba/on , /bomba/off
// Si tu firmware usa rutas distintas, dime cuáles y ajusto el script.
