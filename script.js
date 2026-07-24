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
const serverTimeEl = document.getElementById('serverTime');
const lightsStartEl = document.getElementById('lightsStart');
const lightsEndEl = document.getElementById('lightsEnd');
const pumpIntervalEl = document.getElementById('pumpInterval');
const mqttHostEl = document.getElementById('mqttHost');
const mqttPortEl = document.getElementById('mqttPort');
const mqttUserEl = document.getElementById('mqttUser');
const mqttPasswordEl = document.getElementById('mqttPassword');
const connectBrokerBtn = document.getElementById('connectBroker');
const disconnectBrokerBtn = document.getElementById('disconnectBroker');
const mqttStatusEl = document.getElementById('mqttStatus');

let settings = {
  espIp: localStorage.getItem('espIp') || '',
  mqttHost: localStorage.getItem('mqttHost') || 'af728765e4064e5780c59ff3b8cb9509.s1.eu.hivemq.cloud',
  mqttPort: localStorage.getItem('mqttPort') || '8884',
  mqttUser: localStorage.getItem('mqttUser') || '',
  mqttPassword: localStorage.getItem('mqttPassword') || '',
  modoAuto: localStorage.getItem('modoAuto') === 'true',
  epoca: localStorage.getItem('epoca') || 'primavera',
  humThreshold: localStorage.getItem('humThreshold') || '60',
  lightsStart: localStorage.getItem('lightsStart') || '',
  lightsEnd: localStorage.getItem('lightsEnd') || '',
  pumpInterval: localStorage.getItem('pumpInterval') || '30'
};

let mqttClient = null;
let mqttConnected = false;
let lastTelemetry = null;
let currentLuzState = null;
let currentBombaState = null;
let lastPumpRunAt = null;
let pumpCycleTimer = null;
let pumpCycleActive = false;

const autoLogic = window.AutoLogic;

function getCurrentArgentinaTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((part) => part.type === 'hour');
  const minutePart = parts.find((part) => part.type === 'minute');

  return {
    hh: Number(hourPart?.value || 0),
    mm: Number(minutePart?.value || 0)
  };
}

function applySettingsToUI() {
  espIpEl.value = settings.espIp;
  mqttHostEl.value = settings.mqttHost;
  mqttPortEl.value = settings.mqttPort;
  mqttUserEl.value = settings.mqttUser;
  mqttPasswordEl.value = settings.mqttPassword;
  modoAutoEl.checked = settings.modoAuto;
  epocaSelect.value = settings.epoca;
  humThresholdEl.value = settings.humThreshold;
  lightsStartEl.value = settings.lightsStart;
  lightsEndEl.value = settings.lightsEnd;
  pumpIntervalEl.value = settings.pumpInterval;
}

function syncSettingsFromInputs() {
  settings.espIp = espIpEl.value.trim();
  settings.mqttHost = mqttHostEl.value.trim();
  settings.mqttPort = mqttPortEl.value.trim();
  settings.mqttUser = mqttUserEl.value.trim();
  settings.mqttPassword = mqttPasswordEl.value.trim();
  settings.modoAuto = modoAutoEl.checked;
  settings.epoca = epocaSelect.value;
  settings.humThreshold = humThresholdEl.value;
  settings.lightsStart = lightsStartEl.value;
  settings.lightsEnd = lightsEndEl.value;
  settings.pumpInterval = pumpIntervalEl.value;

  localStorage.setItem('espIp', settings.espIp);
  localStorage.setItem('mqttHost', settings.mqttHost);
  localStorage.setItem('mqttPort', settings.mqttPort);
  localStorage.setItem('mqttUser', settings.mqttUser);
  localStorage.setItem('mqttPassword', settings.mqttPassword);
  localStorage.setItem('modoAuto', settings.modoAuto);
  localStorage.setItem('epoca', settings.epoca);
  localStorage.setItem('humThreshold', settings.humThreshold);
  localStorage.setItem('lightsStart', settings.lightsStart);
  localStorage.setItem('lightsEnd', settings.lightsEnd);
  localStorage.setItem('pumpInterval', settings.pumpInterval);
}

async function sendSettingsToEsp() {
  const base = baseUrl();
  if (!base) return;

  const params = new URLSearchParams({
    mode: settings.modoAuto ? '1' : '0',
    lightsStart: settings.lightsStart || '08:00',
    lightsEnd: settings.lightsEnd || '20:00',
    humThreshold: String(settings.humThreshold || 60),
    pumpInterval: String(settings.pumpInterval || 30)
  });

  try {
    const res = await fetch(`${base}/config?${params.toString()}`);
    if (!res.ok) throw new Error('config error');
    const data = await res.json();
    if (data.serverTime) {
      connStatusEl.textContent = `ESP actualizado: ${data.serverTime}`;
    }
  } catch (err) {
    connStatusEl.textContent = 'No se pudo enviar la configuración al ESP';
  }
}

async function saveSettings() {
  syncSettingsFromInputs();
  connStatusEl.textContent = 'Guardando en ESP...';
  mqttStatusEl.textContent = 'Guardando en ESP...';
  await sendSettingsToEsp();
  connStatusEl.textContent = 'Ajustes guardados';
  mqttStatusEl.textContent = 'Ajustes guardados';
}

function baseUrl() {
  if (!settings.espIp) return null;
  if (settings.espIp.startsWith('http')) return settings.espIp;
  return `http://${settings.espIp}`;
}

function normalizeBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const text = String(value).trim().toLowerCase();
  if (['on', 'true', '1', 'si', 'sí'].includes(text)) return true;
  if (['off', 'false', '0', 'no'].includes(text)) return false;
  return null;
}

function setDeviceState(device, state) {
  const normalized = normalizeBoolean(state);
  if (normalized === null) return;

  if (device === 'luz') {
    currentLuzState = normalized;
    estadoLuzEl.textContent = normalized ? 'ON' : 'OFF';
    return;
  }

  currentBombaState = normalized;
  estadoBombaEl.textContent = normalized ? 'ON' : 'OFF';
}

function connectToBroker() {
  if (!settings.mqttHost) {
    mqttStatusEl.textContent = 'Ingresa el broker MQTT';
    return;
  }

  if (!window.Paho) {
    mqttStatusEl.textContent = 'La librería MQTT no está cargada';
    return;
  }

  if (mqttClient && mqttClient.isConnected()) {
    mqttStatusEl.textContent = 'Ya estás conectado';
    return;
  }

  mqttStatusEl.textContent = 'Conectando al broker...';
  const clientId = `hidro-web-${Math.floor(Math.random() * 999999999)}`;
  mqttClient = new window.Paho.Client(settings.mqttHost, Number(settings.mqttPort || 8884), "/mqtt", clientId);
  mqttClient.onConnectionLost = onConnectionLost;
  mqttClient.onMessageArrived = onMessageArrived;

  const options = {
    userName: settings.mqttUser || undefined,
    password: settings.mqttPassword || undefined,
    useSSL: true,
    cleanSession: true,
    keepAliveInterval: 60,
    timeout: 30,
    reconnect: true,
    onSuccess: onConnectSuccess,
    onFailure: onConnectFailure
  };

  mqttClient.connect(options);
}

function disconnectBroker() {
  if (mqttClient && mqttClient.isConnected()) {
    mqttClient.disconnect();
  }
  mqttConnected = false;
  mqttStatusEl.textContent = 'Desconectado';
}

function onConnectSuccess() {
  mqttConnected = true;
  mqttStatusEl.textContent = 'Conectado al broker';
  connStatusEl.textContent = 'Conectado por MQTT';
  mqttClient.subscribe('hidroponia/telemetry');
  mqttClient.subscribe('hidroponia/commands/luz');
  mqttClient.subscribe('hidroponia/commands/bomba');
}

function onConnectFailure(error) {
  mqttConnected = false;
  mqttStatusEl.textContent = `Error al conectar: ${error.errorMessage || 'desconocido'}`;
}

function onConnectionLost(responseObject) {
  mqttConnected = false;
  mqttStatusEl.textContent = 'Se perdió la conexión';
  connStatusEl.textContent = 'Sin conexión';
  if (responseObject.errorCode !== 0) {
    console.warn('Conexión MQTT perdida:', responseObject.errorMessage);
  }
}

function onMessageArrived(message) {
  try {
    const payload = message.payloadString;
    const topic = message.destinationName;

    if (topic === 'hidroponia/telemetry') {
      const data = JSON.parse(payload);
      lastTelemetry = data;
      if (data.temp !== null && data.temp !== undefined) {
        tempEl.textContent = `${data.temp}°C`;
      }
      if (data.hum !== null && data.hum !== undefined) {
        humEl.textContent = `${data.hum}%`;
      }
      if (data.luz !== undefined) {
        const luzState = normalizeBoolean(data.luz);
        if (luzState !== null) {
          setDeviceState('luz', luzState);
        } else {
          estadoLuzEl.textContent = String(data.luz).toUpperCase();
        }
      }
      if (data.bomba !== undefined) {
        const bombaState = normalizeBoolean(data.bomba);
        if (bombaState !== null) {
          setDeviceState('bomba', bombaState);
        } else {
          estadoBombaEl.textContent = String(data.bomba).toUpperCase();
        }
      }
      mqttStatusEl.textContent = 'Datos recibidos del broker';
      connStatusEl.textContent = 'Conectado por MQTT';
      return;
    }

    if (topic === 'hidroponia/commands/luz') {
      estadoLuzEl.textContent = payload.toUpperCase();
    }

    if (topic === 'hidroponia/commands/bomba') {
      estadoBombaEl.textContent = payload.toUpperCase();
    }
  } catch (error) {
    console.warn('Mensaje MQTT inválido:', error);
  }
}

async function sendCommand(device, action) {
  const normalizedAction = String(action).toUpperCase();
  const shouldTurnOn = normalizedAction === 'ON';

  if (mqttConnected && mqttClient) {
    const topic = device === 'luz' ? 'hidroponia/commands/luz' : 'hidroponia/commands/bomba';
    mqttClient.send(topic, normalizedAction);
    mqttStatusEl.textContent = `Comando enviado: ${device} ${normalizedAction}`;
    connStatusEl.textContent = 'Comando enviado por MQTT';
    setDeviceState(device, shouldTurnOn);
    return;
  }

  const base = baseUrl();
  if (!base) {
    connStatusEl.textContent = 'IP ESP no configurada';
    return;
  }

  const url = `${base}/${device}/${normalizedAction.toLowerCase()}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('error en petición');
    connStatusEl.textContent = `OK: ${device} ${normalizedAction.toLowerCase()}`;
    setDeviceState(device, shouldTurnOn);
    await fetchStatus();
  } catch (err) {
    connStatusEl.textContent = 'Error conectando al ESP';
  }
}

luzOnBtn.addEventListener('click', () => {
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
  if (mqttConnected) {
    connStatusEl.textContent = 'Conectado por MQTT';
    return lastTelemetry;
  }

  const base = baseUrl();
  if (!base) return null;

  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) throw new Error('no status');
    const data = await res.json();
    if (data.serverTime) {
      serverTimeEl.textContent = data.serverTime;
    }
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
    if (data.luz !== undefined) {
      const luzState = normalizeBoolean(data.luz);
      if (luzState !== null) {
        setDeviceState('luz', luzState);
      } else {
        estadoLuzEl.textContent = String(data.luz).toUpperCase();
      }
    }
    if (data.bomba !== undefined) {
      const bombaState = normalizeBoolean(data.bomba);
      if (bombaState !== null) {
        setDeviceState('bomba', bombaState);
      } else {
        estadoBombaEl.textContent = String(data.bomba).toUpperCase();
      }
    }
    connStatusEl.textContent = `Conectado (${data.serverTime || 'sin hora'})`;
    return data;
  } catch (err) {
    try {
      const res = await fetch(`${base}/sensor`);
      if (!res.ok) throw new Error('no sensor');
      const data = await res.json();
      if (data.serverTime) {
        serverTimeEl.textContent = data.serverTime;
      }
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
      if (data.luz !== undefined) {
        const luzState = normalizeBoolean(data.luz);
        if (luzState !== null) {
          setDeviceState('luz', luzState);
        } else {
          estadoLuzEl.textContent = String(data.luz).toUpperCase();
        }
      }
      if (data.bomba !== undefined) {
        const bombaState = normalizeBoolean(data.bomba);
        if (bombaState !== null) {
          setDeviceState('bomba', bombaState);
        } else {
          estadoBombaEl.textContent = String(data.bomba).toUpperCase();
        }
      }
      connStatusEl.textContent = 'Conectado';
      return data;
    } catch (fallbackError) {
      connStatusEl.textContent = 'No responde el ESP (sensor)';
      tempEl.textContent = 'Error de datos';
      humEl.textContent = 'Error de datos';
      return null;
    }
  }
}

async function automaticControl() {
  if (!settings.modoAuto) return;

  const data = mqttConnected ? lastTelemetry : await fetchStatus();
  if (!data) return;

  const hum = Number(data.hum);
  const threshold = Number(settings.humThreshold);
  const argentinaTime = getCurrentArgentinaTime();
  const scheduleNow = {
    getHours: () => argentinaTime.hh,
    getMinutes: () => argentinaTime.mm
  };
  const shouldPump = Number.isFinite(hum) && Number.isFinite(threshold) && hum < threshold;
  const shouldLightsBeOn = autoLogic?.shouldTurnLightsOn(scheduleNow, settings.lightsStart, settings.lightsEnd) || false;

  if (settings.lightsStart && settings.lightsEnd) {
    const currentLuz = currentLuzState !== null ? currentLuzState : normalizeBoolean(data.luz);
    if (shouldLightsBeOn && currentLuz !== true) {
      await sendCommand('luz', 'on');
    } else if (!shouldLightsBeOn && currentLuz !== false) {
      await sendCommand('luz', 'off');
    }
  }

  if (!shouldPump) {
    if (pumpCycleActive) {
      clearTimeout(pumpCycleTimer);
      pumpCycleTimer = null;
      pumpCycleActive = false;
    }
    if (currentBombaState === true) {
      await sendCommand('bomba', 'off');
    }
    return;
  }

  const intervalMinutes = Math.max(1, Number(settings.pumpInterval) || 1);
  const intervalMs = intervalMinutes * 60 * 1000;
  const canRunPump = !lastPumpRunAt || (Date.now() - lastPumpRunAt) >= intervalMs;

  if (!canRunPump || pumpCycleActive) {
    return;
  }

  lastPumpRunAt = Date.now();
  pumpCycleActive = true;
  await sendCommand('bomba', 'on');

  pumpCycleTimer = setTimeout(async () => {
    pumpCycleActive = false;
    pumpCycleTimer = null;
    await sendCommand('bomba', 'off');
  }, 10000);
}

applySettingsToUI();

saveSettingsBtn.addEventListener('click', () => {
  saveSettings();
  if (settings.mqttHost) {
    connectToBroker();
  }
});

connectBrokerBtn.addEventListener('click', connectToBroker);
disconnectBrokerBtn.addEventListener('click', disconnectBroker);

modoAutoEl.addEventListener('change', () => {
  syncSettingsFromInputs();
  if (settings.modoAuto) {
    void automaticControl();
  }
});

const autoSettingsInputs = [espIpEl, mqttHostEl, mqttPortEl, mqttUserEl, mqttPasswordEl, epocaSelect, humThresholdEl, lightsStartEl, lightsEndEl, pumpIntervalEl];
autoSettingsInputs.forEach((element) => {
  element.addEventListener('input', () => {
    syncSettingsFromInputs();
    if (settings.modoAuto) {
      void automaticControl();
    }
  });
  element.addEventListener('change', () => {
    syncSettingsFromInputs();
    if (settings.modoAuto) {
      void automaticControl();
    }
  });
});

setInterval(fetchStatus, 5000);
setInterval(automaticControl, 15000);
setInterval(async () => {
  try {
    const base = baseUrl();
    if (!base) return;
    const res = await fetch(`${base}/time`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.serverTime) {
      serverTimeEl.textContent = data.serverTime;
    }
  } catch (err) {
    serverTimeEl.textContent = 'Sin hora';
  }
}, 10000);

fetchStatus();
if (settings.mqttHost) {
  connectToBroker();
}
