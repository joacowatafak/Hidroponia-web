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
const pumpOnMinutesEl = document.getElementById('pumpOnMinutes');
const pumpOffMinutesEl = document.getElementById('pumpOffMinutes');
const mqttHostEl = document.getElementById('mqttHost');
const mqttPortEl = document.getElementById('mqttPort');
const mqttUserEl = document.getElementById('mqttUser');
const mqttPasswordEl = document.getElementById('mqttPassword');
const connectBrokerBtn = document.getElementById('connectBroker');
const disconnectBrokerBtn = document.getElementById('disconnectBroker');
const mqttStatusEl = document.getElementById('mqttStatus');
const saveParamsBtn = document.getElementById('saveParams');

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
  pumpOnMinutes: localStorage.getItem('pumpOnMinutes') || localStorage.getItem('pumpInterval') || '2',
  pumpOffMinutes: localStorage.getItem('pumpOffMinutes') || '10'
};

let mqttClient = null;
let mqttConnected = false;
let lastTelemetry = null;
let settingsSyncChannel = null;
let settingsSyncStorageKey = 'hidroponia:settings-sync';
let settingsSyncId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let currentLuzState = null;
let currentBombaState = null;
let lastPumpRunAt = null;
let pumpCycleTimer = null;
let pumpCycleActive = false;

const autoLogic = window.AutoLogic;

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn(`No se pudo guardar ${key} en ${storage === window.sessionStorage ? 'sessionStorage' : 'localStorage'}:`, err);
  }
}

function initSettingsSync() {
  if (typeof window.BroadcastChannel !== 'undefined') {
    settingsSyncChannel = new window.BroadcastChannel('hidroponia-settings');
    settingsSyncChannel.onmessage = (event) => {
      if (event.data?.type === 'settings-updated' && event.data?.source !== settingsSyncId) {
        window.location.reload();
      }
    };
  }

  window.addEventListener('storage', (event) => {
    if (event.key === settingsSyncStorageKey && event.newValue) {
      try {
        const payload = JSON.parse(event.newValue);
        if (payload?.type === 'settings-updated' && payload?.source !== settingsSyncId) {
          window.location.reload();
        }
      } catch (err) {
        console.warn('No se pudo procesar el mensaje de sincronización:', err);
      }
    }
  });
}

function broadcastSettingsUpdate() {
  const payload = {
    type: 'settings-updated',
    source: settingsSyncId,
    timestamp: Date.now(),
    settings: { ...settings }
  };

  try {
    if (settingsSyncChannel) {
      settingsSyncChannel.postMessage(payload);
    }
  } catch (err) {
    console.warn('No se pudo publicar por BroadcastChannel:', err);
  }

  try {
    safeStorageSet(window.sessionStorage, settingsSyncStorageKey, JSON.stringify(payload));
  } catch (err) {
    console.warn('No se pudo escribir la sincronización en sessionStorage:', err);
  }

  if (mqttClient && mqttClient.isConnected()) {
    try {
      mqttClient.send('hidroponia/settings/sync', JSON.stringify(payload));
    } catch (err) {
      console.warn('No se pudo publicar por MQTT:', err);
    }
  }
}

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

function getSeasonPresetSchedule(epoca) {
  switch (epoca) {
    case 'primavera':
      return { start: '08:00', end: '20:00' };
    case 'verano':
      return { start: '06:30', end: '21:00' };
    case 'otonio':
      return { start: '08:30', end: '19:00' };
    case 'invierno':
      return { start: '09:30', end: '17:30' };
    default:
      return null;
  }
}

function applySeasonScheduleToInputs() {
  if (!epocaSelect || !lightsStartEl || !lightsEndEl) return;
  if (epocaSelect.value === 'personalizado') return;
  const preset = getSeasonPresetSchedule(epocaSelect.value);
  if (preset) {
    lightsStartEl.value = preset.start;
    lightsEndEl.value = preset.end;
  }
}

function applySettingsToUI() {
  if (espIpEl) espIpEl.value = settings.espIp;
  if (mqttHostEl) mqttHostEl.value = settings.mqttHost;
  if (mqttPortEl) mqttPortEl.value = settings.mqttPort;
  if (mqttUserEl) mqttUserEl.value = settings.mqttUser;
  if (mqttPasswordEl) mqttPasswordEl.value = settings.mqttPassword;
  if (modoAutoEl) modoAutoEl.checked = settings.modoAuto;
  if (epocaSelect) epocaSelect.value = settings.epoca || 'personalizado';
  if (humThresholdEl) humThresholdEl.value = settings.humThreshold;
  if (lightsStartEl) lightsStartEl.value = settings.lightsStart || '08:00';
  if (lightsEndEl) lightsEndEl.value = settings.lightsEnd || '20:00';
  if (pumpOnMinutesEl) pumpOnMinutesEl.value = settings.pumpOnMinutes || '2';
  if (pumpOffMinutesEl) pumpOffMinutesEl.value = settings.pumpOffMinutes || '10';
  if (epocaSelect && epocaSelect.value !== 'personalizado') {
    applySeasonScheduleToInputs();
  }
}

function syncSettingsFromInputs() {
  if (espIpEl) settings.espIp = espIpEl.value.trim();
  if (mqttHostEl) settings.mqttHost = mqttHostEl.value.trim();
  if (mqttPortEl) settings.mqttPort = mqttPortEl.value.trim();
  if (mqttUserEl) settings.mqttUser = mqttUserEl.value.trim();
  if (mqttPasswordEl) settings.mqttPassword = mqttPasswordEl.value.trim();
  if (modoAutoEl) settings.modoAuto = modoAutoEl.checked;
  if (epocaSelect) settings.epoca = epocaSelect.value;
  if (humThresholdEl) settings.humThreshold = humThresholdEl.value;
  if (lightsStartEl) settings.lightsStart = lightsStartEl.value;
  if (lightsEndEl) settings.lightsEnd = lightsEndEl.value;
  if (pumpOnMinutesEl) settings.pumpOnMinutes = pumpOnMinutesEl.value;
  if (pumpOffMinutesEl) settings.pumpOffMinutes = pumpOffMinutesEl.value;

  safeStorageSet(window.localStorage, 'espIp', settings.espIp);
  safeStorageSet(window.localStorage, 'mqttHost', settings.mqttHost);
  safeStorageSet(window.localStorage, 'mqttPort', settings.mqttPort);
  safeStorageSet(window.localStorage, 'mqttUser', settings.mqttUser);
  safeStorageSet(window.localStorage, 'mqttPassword', settings.mqttPassword);
  safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
  safeStorageSet(window.localStorage, 'epoca', settings.epoca);
  safeStorageSet(window.localStorage, 'humThreshold', settings.humThreshold);
  safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
  safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
  safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
  safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
  safeStorageSet(window.localStorage, 'pumpInterval', settings.pumpOnMinutes);
}

async function sendSettingsToEsp() {
  const argentinaTime = getCurrentArgentinaTime();
  const params = new URLSearchParams({
    mode: settings.modoAuto ? '1' : '0',
    lightsStart: settings.lightsStart || '08:00',
    lightsEnd: settings.lightsEnd || '20:00',
    humThreshold: String(settings.humThreshold || 60),
    pumpOnMinutes: String(settings.pumpOnMinutes || 2),
    pumpOffMinutes: String(settings.pumpOffMinutes || 10),
    epoca: settings.epoca || 'personalizado',
    currentTime: `${String(argentinaTime.hh).padStart(2, '0')}:${String(argentinaTime.mm).padStart(2, '0')}`
  });

  const candidates = getConfigUrlCandidates();
  if (candidates.length === 0) {
    if (connStatusEl) connStatusEl.textContent = 'Ingresa la IP del ESP8266';
    return;
  }

  let lastError = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store'
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.serverTime) {
        if (connStatusEl) connStatusEl.textContent = `ESP actualizado: ${data.serverTime}`;
      }
      return;
    } catch (err) {
      lastError = err;
      console.warn(`No se pudo enviar a ${url}:`, err);
    }
  }

  if (connStatusEl) connStatusEl.textContent = 'No se pudo enviar la configuración al ESP';
  console.warn('Error enviando configuración al ESP:', lastError);
}

async function saveSettings() {
  syncSettingsFromInputs();
  if (connStatusEl) connStatusEl.textContent = 'Guardando en ESP...';
  if (mqttStatusEl) mqttStatusEl.textContent = 'Guardando en ESP...';
  await sendSettingsToEsp();
  broadcastSettingsUpdate();
  if (connStatusEl) connStatusEl.textContent = 'Ajustes guardados';
  if (mqttStatusEl) mqttStatusEl.textContent = 'Ajustes guardados';
}

function baseUrl() {
  if (settings.espIp) {
    if (settings.espIp.startsWith('http')) return settings.espIp;
    return `http://${settings.espIp}`;
  }

  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0') {
    return `http://${host}`;
  }

  return null;
}

function getTimeUrlCandidates() {
  const candidates = [];
  const currentOrigin = window.location.origin;

  if (currentOrigin && currentOrigin !== 'null') {
    candidates.push(`${currentOrigin}/time`);
  }

  const currentHost = window.location.hostname;
  if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    candidates.push(`http://${currentHost}/time`);
  }

  const espBase = baseUrl();
  if (espBase) {
    candidates.push(`${espBase}/time`);
  }

  if (settings.espIp) {
    candidates.push(`http://${settings.espIp}/time`);
  }

  return [...new Set(candidates)];
}

function getConfigUrlCandidates() {
  const candidates = [];
  const currentOrigin = window.location.origin;

  if (currentOrigin && currentOrigin !== 'null') {
    candidates.push(`${currentOrigin}/config`);
  }

  const currentHost = window.location.hostname;
  if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1' && currentHost !== '0.0.0.0') {
    candidates.push(`http://${currentHost}/config`);
  }

  const espBase = baseUrl();
  if (espBase) {
    candidates.push(`${espBase}/config`);
  }

  if (settings.espIp) {
    candidates.push(`http://${settings.espIp}/config`);
  }

  candidates.push('http://esp8266.local/config');
  return [...new Set(candidates)];
}

async function fetchServerTime() {
  for (const url of getTimeUrlCandidates()) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;

      const data = await res.json();
      if (data.serverTime && data.serverTime !== 'sin-hora') {
        return data.serverTime;
      }
    } catch (err) {
      // Intenta con la siguiente URL
    }
  }

  return null;
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
    if (estadoLuzEl) estadoLuzEl.textContent = normalized ? 'ON' : 'OFF';
    return;
  }

  currentBombaState = normalized;
  if (estadoBombaEl) estadoBombaEl.textContent = normalized ? 'ON' : 'OFF';
}

function connectToBroker() {
  if (!settings.mqttHost) {
    if (mqttStatusEl) mqttStatusEl.textContent = 'Ingresa el broker MQTT';
    return;
  }

  if (!window.Paho) {
    if (mqttStatusEl) mqttStatusEl.textContent = 'La librería MQTT no está cargada';
    return;
  }

  if (mqttClient && mqttClient.isConnected()) {
    if (mqttStatusEl) mqttStatusEl.textContent = 'Ya estás conectado';
    return;
  }

  if (mqttStatusEl) mqttStatusEl.textContent = 'Conectando al broker...';
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
  if (mqttStatusEl) mqttStatusEl.textContent = 'Desconectado';
}

function onConnectSuccess() {
  mqttConnected = true;
  if (mqttStatusEl) mqttStatusEl.textContent = 'Conectado al broker';
  if (connStatusEl) connStatusEl.textContent = 'Conectado por MQTT';
  mqttClient.subscribe('hidroponia/telemetry');
  mqttClient.subscribe('hidroponia/commands/luz');
  mqttClient.subscribe('hidroponia/commands/bomba');
  mqttClient.subscribe('hidroponia/settings/sync');
}

function onConnectFailure(error) {
  mqttConnected = false;
  if (mqttStatusEl) mqttStatusEl.textContent = `Error al conectar: ${error.errorMessage || 'desconocido'}`;
}

function onConnectionLost(responseObject) {
  mqttConnected = false;
  if (mqttStatusEl) mqttStatusEl.textContent = 'Se perdió la conexión';
  if (connStatusEl) connStatusEl.textContent = 'Sin conexión';
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

    if (topic === 'hidroponia/settings/sync') {
      try {
        const payloadData = JSON.parse(payload);
        if (payloadData?.type === 'settings-updated' && payloadData?.source !== settingsSyncId) {
          window.location.reload();
        }
      } catch (error) {
        console.warn('Mensaje de sincronización MQTT inválido:', error);
      }
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

if (luzOnBtn) {
  luzOnBtn.addEventListener('click', () => {
    if (estadoLuzEl) estadoLuzEl.textContent = 'ON';
    sendCommand('luz', 'on');
  });
}

if (luzOffBtn) {
  luzOffBtn.addEventListener('click', () => {
    if (estadoLuzEl) estadoLuzEl.textContent = 'OFF';
    sendCommand('luz', 'off');
  });
}

if (bombaOnBtn) {
  bombaOnBtn.addEventListener('click', () => {
    if (estadoBombaEl) estadoBombaEl.textContent = 'ON';
    sendCommand('bomba', 'on');
  });
}

if (bombaOffBtn) {
  bombaOffBtn.addEventListener('click', () => {
    if (estadoBombaEl) estadoBombaEl.textContent = 'OFF';
    sendCommand('bomba', 'off');
  });
}

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

  const onMinutes = Math.max(1, Number(settings.pumpOnMinutes) || 1);
  const offMinutes = Math.max(1, Number(settings.pumpOffMinutes) || 1);
  const onMs = onMinutes * 60 * 1000;
  const offMs = offMinutes * 60 * 1000;
  const canRunPump = !lastPumpRunAt || (Date.now() - lastPumpRunAt) >= offMs;

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
  }, onMs);
}

applySettingsToUI();

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    void saveSettings();
    if (settings.mqttHost) {
      connectToBroker();
    }
  });
}

if (saveParamsBtn) {
  saveParamsBtn.addEventListener('click', () => {
    void saveSettings();
  });
}

if (connectBrokerBtn) {
  connectBrokerBtn.addEventListener('click', connectToBroker);
}

if (disconnectBrokerBtn) {
  disconnectBrokerBtn.addEventListener('click', disconnectBroker);
}

if (modoAutoEl) {
  modoAutoEl.addEventListener('change', () => {
    syncSettingsFromInputs();
    if (settings.modoAuto) {
      void automaticControl();
    }
  });
}

if (epocaSelect) {
  epocaSelect.addEventListener('change', () => {
    if (epocaSelect.value !== 'personalizado') {
      applySeasonScheduleToInputs();
    }
    syncSettingsFromInputs();
  });
}

const autoSettingsInputs = [espIpEl, mqttHostEl, mqttPortEl, mqttUserEl, mqttPasswordEl, epocaSelect, humThresholdEl, lightsStartEl, lightsEndEl, pumpOnMinutesEl, pumpOffMinutesEl].filter(Boolean);
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

initSettingsSync();

setInterval(fetchStatus, 5000);
setInterval(automaticControl, 15000);
setInterval(async () => {
  try {
    const serverTime = await fetchServerTime();
    if (serverTime) {
      serverTimeEl.textContent = serverTime;
    } else {
      const now = new Date();
      serverTimeEl.textContent = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  } catch (err) {
    const now = new Date();
    serverTimeEl.textContent = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}, 1000);

fetchStatus();
if (settings.mqttHost) {
  connectToBroker();
}
