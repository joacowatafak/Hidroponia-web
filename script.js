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
const modeSelectEl = document.getElementById('modeSelect');
const modeManualBtn = document.getElementById('modeManualBtn');
const modeAutoBtn = document.getElementById('modeAutoBtn');
const modoAutoEl = document.getElementById('modoAuto');
const epocaSelect = document.getElementById('epocaSelect');
const espIpEl = document.getElementById('espIp');
const saveSettingsBtn = document.getElementById('saveSettings');
const connStatusEl = document.getElementById('connStatus');
const tempEl = document.getElementById('temp');
const humEl = document.getElementById('hum');
const phEl = document.getElementById('ph');
const phRangeStatusEl = document.getElementById('phRangeStatus');
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
const appUserEl = document.getElementById('appUser');
const appPasswordEl = document.getElementById('appPassword');
const deviceIdInputEl = document.getElementById('deviceId');
const createBoardUserBtn = document.getElementById('createBoardUser');
const loginBoardBtn = document.getElementById('loginBoard');
const authStatusEl = document.getElementById('authStatus');
const deviceIdDisplayEl = document.getElementById('deviceIdDisplay');
const saveParamsBtn = document.getElementById('saveParams');
const clearParamsBtn = document.getElementById('clearParams');
const systemStateBadgeEl = document.getElementById('systemStateBadge');
const lastUpdateElapsedEl = document.getElementById('lastUpdateElapsed');
const telemetrySourceEl = document.getElementById('telemetrySource');
const summaryModeEl = document.getElementById('summaryMode');
const summaryLightsEl = document.getElementById('summaryLights');
const summaryPumpEl = document.getElementById('summaryPump');
const summaryLuzStateEl = document.getElementById('summaryLuzState');
const summaryBombaStateEl = document.getElementById('summaryBombaState');
const manualControlButtons = [luzOnBtn, luzOffBtn, bombaOnBtn, bombaOffBtn].filter(Boolean);
const autoConfigActionButtons = [saveParamsBtn, clearParamsBtn].filter(Boolean);
const STATUS_REQUEST_FALLBACK_MS = 800;
const STATUS_POLL_INTERVAL_ACTIVE_MS = 1000;
const STATUS_POLL_INTERVAL_HIDDEN_MS = 5000;
const STATUS_MIN_REQUEST_GAP_MS = 200;
const TELEMETRY_FRESH_MS = 30000;
const SERVER_TIME_SYNC_INTERVAL_MS = 15000;
const COMMAND_ACK_TIMEOUT_MS = 3500;
const FIXED_MQTT_HOST = 'af728765e4064e5780c59ff3b8cb9509.s1.eu.hivemq.cloud';
const FIXED_MQTT_PORT = '8884';
const FIXED_MQTT_USER = 'hidroweb';
const FIXED_MQTT_PASSWORD = 'Frajoafed1377';
const isGithubHosted = /github\.io$/i.test(window.location.hostname || '');
const isHttpsPage = window.location.protocol === 'https:';
const PH_SAFE_MIN = 5.8;
const PH_SAFE_MAX = 6.2;

let settings = {
  espIp: localStorage.getItem('espIp') || '',
  mqttHost: FIXED_MQTT_HOST,
  mqttPort: FIXED_MQTT_PORT,
  mqttUser: FIXED_MQTT_USER,
  mqttPassword: FIXED_MQTT_PASSWORD,
  appUser: localStorage.getItem('appUser') || '',
  appPassword: localStorage.getItem('appPassword') || '',
  deviceId: localStorage.getItem('deviceId') || '',
  modoAuto: localStorage.getItem('modoAuto') === 'true',
  epoca: localStorage.getItem('epoca') || 'primavera',
  lightsStart: localStorage.getItem('lightsStart') || '',
  lightsEnd: localStorage.getItem('lightsEnd') || '',
  pumpOnMinutes: localStorage.getItem('pumpOnMinutes') || localStorage.getItem('pumpInterval') || '2',
  pumpOffMinutes: localStorage.getItem('pumpOffMinutes') || '10'
};

const queryParams = new URLSearchParams(window.location.search || '');
if (queryParams.get('mqttHost')) settings.mqttHost = queryParams.get('mqttHost');
if (queryParams.get('mqttPort')) settings.mqttPort = queryParams.get('mqttPort');
if (queryParams.get('mqttUser')) settings.mqttUser = queryParams.get('mqttUser');
if (queryParams.get('mqttPassword')) settings.mqttPassword = queryParams.get('mqttPassword');
if (queryParams.get('appUser')) settings.appUser = queryParams.get('appUser');
if (queryParams.get('appPassword')) settings.appPassword = queryParams.get('appPassword');
if (queryParams.get('deviceId')) settings.deviceId = queryParams.get('deviceId');

let mqttClient = null;
let mqttConnected = false;
let lastTelemetry = null;
let lastTelemetryAt = 0;
let settingsSyncChannel = null;
let settingsSyncStorageKey = 'hidroponia:settings-sync';
let settingsSyncId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let currentLuzState = null;
let currentBombaState = null;
let lastPumpRunAt = null;
let pumpCycleTimer = null;
let pumpCycleActive = false;
let actionToastTimer = null;
let statusFallbackTimer = null;
let lastTelemetrySource = '--';
let statusPollingTimer = null;
let statusRequestInFlight = false;
let lastStatusRequestAt = 0;
let pendingCommandAckTimer = null;

const autoLogic = window.AutoLogic;

function enforceFixedMqttSettings() {
  if (!settings.mqttHost) settings.mqttHost = FIXED_MQTT_HOST;
  if (!settings.mqttPort) settings.mqttPort = FIXED_MQTT_PORT;
  if (!settings.mqttUser) settings.mqttUser = FIXED_MQTT_USER;
  if (!settings.mqttPassword) settings.mqttPassword = FIXED_MQTT_PASSWORD;
}

function activeDeviceId() {
  return (settings.deviceId || '').trim().toLowerCase();
}

function mqttTopic(suffix) {
  const deviceId = activeDeviceId();
  if (!deviceId) return null;
  return `hidroponia/${deviceId}/${suffix}`;
}

function mqttWildcardTopic(suffix) {
  return `hidroponia/+/${suffix}`;
}

function extractDeviceIdFromTopic(topic) {
  if (typeof topic !== 'string') return null;
  const parts = topic.split('/');
  if (parts.length >= 2 && parts[0] === 'hidroponia' && parts[1]) {
    return String(parts[1]).toLowerCase();
  }
  return null;
}

function modeScheduleTopic() {
  return mqttTopic('ui/mode-schedule');
}

function configTopic() {
  return mqttTopic('config');
}

function statusRequestTopic() {
  return mqttTopic('status/request');
}

function commandTopic(device) {
  return mqttTopic(`commands/${device}`);
}

function telemetryTopic() {
  return mqttTopic('telemetry');
}

function withAuthUrl(url) {
  if (!settings.appUser || !settings.appPassword) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}user=${encodeURIComponent(settings.appUser)}&pass=${encodeURIComponent(settings.appPassword)}`;
}

function updatePhDisplay(phValue) {
  if (!phEl || !phRangeStatusEl) return;

  const numericPh = Number(phValue);
  const hasValidPh = Number.isFinite(numericPh);

  phRangeStatusEl.classList.remove('safe', 'alert');
  phRangeStatusEl.classList.add('neutral');

  if (!hasValidPh) {
    phEl.textContent = 'SIN DATOS';
    phRangeStatusEl.textContent = 'Rango seguro 5.8 - 6.2';
    return;
  }

  phEl.textContent = numericPh.toFixed(2);

  if (numericPh >= PH_SAFE_MIN && numericPh <= PH_SAFE_MAX) {
    phRangeStatusEl.textContent = 'Dentro de rango';
    phRangeStatusEl.classList.remove('neutral');
    phRangeStatusEl.classList.add('safe');
  } else {
    phRangeStatusEl.textContent = 'Peligroso: fuera de rango';
    phRangeStatusEl.classList.remove('neutral');
    phRangeStatusEl.classList.add('alert');
  }
}

function setSystemBadge(text, tone = 'neutral') {
  if (!systemStateBadgeEl) return;
  systemStateBadgeEl.textContent = text;
  systemStateBadgeEl.classList.remove('ok', 'warn', 'error', 'neutral');
  systemStateBadgeEl.classList.add(tone);
}

function updateConnectionIndicators() {
  const ageMs = lastTelemetryAt ? Date.now() - lastTelemetryAt : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(ageMs)) {
    setSystemBadge('Sin datos', 'warn');
  } else if (ageMs <= 3000) {
    setSystemBadge('En linea', 'ok');
  } else if (ageMs <= 12000) {
    setSystemBadge('Degradado', 'warn');
  } else {
    setSystemBadge('Sin conexion', 'error');
  }

  if (telemetrySourceEl) {
    telemetrySourceEl.textContent = lastTelemetrySource;
  }
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms)) return '--';
  const sec = Math.floor(ms / 1000);
  if (sec < 1) return '<1s';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function updateLastUpdateElapsed() {
  if (!lastUpdateElapsedEl) return;

  if (!lastTelemetryAt) {
    lastUpdateElapsedEl.textContent = '--';
    updateConnectionIndicators();
    return;
  }

  const ageMs = Date.now() - lastTelemetryAt;
  lastUpdateElapsedEl.textContent = formatElapsed(ageMs);
  updateConnectionIndicators();
}

function setDeviceStateClass(element, state) {
  if (!element) return;
  element.classList.remove('on', 'off', 'pending', 'unknown');

  if (state === true) {
    element.classList.add('on');
    return;
  }

  if (state === false) {
    element.classList.add('off');
    return;
  }

  if (state === 'pending') {
    element.classList.add('pending');
    return;
  }

  element.classList.add('unknown');
}

function updateAutoConfigSummary() {
  const luzState = currentLuzState !== null ? currentLuzState : normalizeBoolean(lastTelemetry?.luz);
  const bombaState = currentBombaState !== null ? currentBombaState : normalizeBoolean(lastTelemetry?.bomba);

  if (summaryModeEl) {
    summaryModeEl.textContent = settings.modoAuto ? 'Automatico' : 'Manual';
  }
  if (summaryLightsEl) {
    summaryLightsEl.textContent = `${settings.lightsStart || '--:--'} -> ${settings.lightsEnd || '--:--'}`;
  }
  if (summaryPumpEl) {
    summaryPumpEl.textContent = `${settings.pumpOnMinutes || '--'}m ON / ${settings.pumpOffMinutes || '--'}m OFF`;
  }
  if (summaryLuzStateEl) {
    summaryLuzStateEl.textContent = luzState === null ? 'SIN DATOS' : (luzState ? 'ON' : 'OFF');
  }
  if (summaryBombaStateEl) {
    summaryBombaStateEl.textContent = bombaState === null ? 'SIN DATOS' : (bombaState ? 'ON' : 'OFF');
  }
}

function updateAuthUi() {
  if (appUserEl) appUserEl.value = settings.appUser;
  if (appPasswordEl) appPasswordEl.value = settings.appPassword;
  if (deviceIdInputEl) deviceIdInputEl.value = settings.deviceId;
  if (deviceIdDisplayEl) deviceIdDisplayEl.textContent = activeDeviceId() || '--';

  if (authStatusEl && !authStatusEl.dataset.userOverride) {
    authStatusEl.textContent = activeDeviceId()
      ? `Placa registrada: ${activeDeviceId()}`
      : 'Sin autenticar';
  }
}

function isTelemetryFresh(maxAgeMs = TELEMETRY_FRESH_MS) {
  return Boolean(lastTelemetry) && (Date.now() - lastTelemetryAt) <= maxAgeMs;
}

function currentStatusPollIntervalMs() {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (hidden) return STATUS_POLL_INTERVAL_HIDDEN_MS;
  return STATUS_POLL_INTERVAL_ACTIVE_MS;
}

function scheduleStatusPolling() {
  if (statusPollingTimer) {
    clearTimeout(statusPollingTimer);
  }

  statusPollingTimer = setTimeout(() => {
    requestStatusSnapshot();
    scheduleStatusPolling();
  }, currentStatusPollIntervalMs());
}

async function discoverBoardFromEsp() {
  const base = getBaseUrl();
  if (!base) {
    if (authStatusEl) authStatusEl.textContent = 'Ingresa la IP de la placa';
    return false;
  }

  const url = withAuthUrl(`${base}/auth/login`);

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (response.ok && data?.ok && data?.deviceId) {
      settings.deviceId = String(data.deviceId).trim().toLowerCase();
      safeStorageSet(window.localStorage, 'deviceId', settings.deviceId);
      updateAuthUi();
      if (authStatusEl) authStatusEl.textContent = `Placa encontrada: ${settings.deviceId}`;
      if (connStatusEl) connStatusEl.textContent = 'Placa encontrada por HTTP';
      return true;
    }
  } catch (error) {
    console.warn('No se pudo contactar a la placa por HTTP:', error);
  }

  return false;
}

async function loginBoardAccount() {
  syncSettingsFromInputs();

  if (!settings.appUser || !settings.appPassword) {
    if (authStatusEl) authStatusEl.textContent = 'Completa usuario y contraseña';
    return;
  }

  const candidates = getEspBaseCandidates();
  if (!candidates.length && !activeDeviceId()) {
    if (authStatusEl) authStatusEl.textContent = 'Ingresa IP local o ID de placa para vincular';
    return;
  }

  if (authStatusEl) authStatusEl.textContent = 'Verificando usuario contra la placa...';
  let authenticated = false;
  let authError = null;

  for (const base of candidates) {
    try {
      const body = new URLSearchParams({
        user: settings.appUser,
        pass: settings.appPassword
      });

      const response = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok || !data?.deviceId) {
        throw new Error(data?.message || `HTTP ${response.status}`);
      }

      const detectedDeviceId = String(data.deviceId).trim().toLowerCase();
      const normalizedUser = String(settings.appUser || '').trim().toLowerCase();
      const registry = getBoardUserRegistry();
      const registeredDeviceId = registry[normalizedUser];

      if (registeredDeviceId && registeredDeviceId !== detectedDeviceId) {
        throw new Error(`El usuario ${normalizedUser} ya esta vinculado a la placa ${registeredDeviceId}`);
      }

      registry[normalizedUser] = detectedDeviceId;
      saveBoardUserRegistry(registry);

      settings.deviceId = detectedDeviceId;
      safeStorageSet(window.localStorage, 'deviceId', settings.deviceId);
      updateAuthUi();
      if (authStatusEl) authStatusEl.textContent = `Usuario validado en placa: ${settings.deviceId}`;
      if (connStatusEl) connStatusEl.textContent = 'Autenticado por HTTP con ESP';
      authenticated = true;
      break;
    } catch (error) {
      authError = error;
      console.warn(`Fallo autenticacion HTTP en ${base}:`, error);
    }
  }

  if (!authenticated) {
    if (!activeDeviceId()) {
      if (authStatusEl) authStatusEl.textContent = `No coincide usuario/clave con el ESP (${authError?.message || 'sin respuesta'})`;
      return;
    }
    if (authStatusEl) authStatusEl.textContent = `Sin acceso HTTP. Vinculando por MQTT con ID ${activeDeviceId()}...`;
  }

  if (!window.Paho) {
    if (authStatusEl) authStatusEl.textContent = 'La librería MQTT no está cargada';
    return;
  }

  if (authStatusEl) authStatusEl.textContent = 'Conectando por MQTT...';
  connectToBroker();
}

async function createBoardUserAccount() {
  syncSettingsFromInputs();

  if (!settings.appUser || !settings.appPassword) {
    if (authStatusEl) authStatusEl.textContent = 'Completa usuario y contraseña para crear el usuario';
    return;
  }

  const candidates = getEspBaseCandidates();
  if (!candidates.length) {
    if (authStatusEl) authStatusEl.textContent = 'Ingresa la IP del ESP8266';
    return;
  }

  if (authStatusEl) authStatusEl.textContent = 'Creando usuario en la placa...';

  let setupError = null;
  for (const base of candidates) {
    try {
      const body = new URLSearchParams({
        user: settings.appUser,
        pass: settings.appPassword
      });

      const response = await fetch(`${base}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok || !data?.deviceId) {
        throw new Error(data?.message || `HTTP ${response.status}`);
      }

      settings.deviceId = String(data.deviceId).trim().toLowerCase();
      safeStorageSet(window.localStorage, 'deviceId', settings.deviceId);

      const normalizedUser = String(settings.appUser || '').trim().toLowerCase();
      const registry = getBoardUserRegistry();
      registry[normalizedUser] = settings.deviceId;
      saveBoardUserRegistry(registry);

      updateAuthUi();
      if (authStatusEl) authStatusEl.textContent = `Usuario creado en placa: ${settings.deviceId}`;
      if (connStatusEl) connStatusEl.textContent = 'Usuario creado en ESP';
      return;
    } catch (error) {
      setupError = error;
      console.warn(`No se pudo crear usuario en ${base}:`, error);
    }
  }

  if (authStatusEl) authStatusEl.textContent = `No se pudo crear usuario (${setupError?.message || 'sin respuesta'})`;
}

function setActuatorStatePending() {
  if (currentLuzState === null && estadoLuzEl) {
    estadoLuzEl.textContent = '...';
    setDeviceStateClass(estadoLuzEl, 'pending');
  }
  if (currentBombaState === null && estadoBombaEl) {
    estadoBombaEl.textContent = '...';
    setDeviceStateClass(estadoBombaEl, 'pending');
  }
}

function setActuatorStateUnavailable() {
  if (currentLuzState === null && estadoLuzEl) {
    estadoLuzEl.textContent = 'SIN DATOS';
    setDeviceStateClass(estadoLuzEl, null);
  }
  if (currentBombaState === null && estadoBombaEl) {
    estadoBombaEl.textContent = 'SIN DATOS';
    setDeviceStateClass(estadoBombaEl, null);
  }
}

function clearPendingCommandAck() {
  if (pendingCommandAckTimer) {
    clearTimeout(pendingCommandAckTimer);
    pendingCommandAckTimer = null;
  }
}

function schedulePendingCommandAck() {
  clearPendingCommandAck();
  const sentAt = Date.now();
  pendingCommandAckTimer = setTimeout(() => {
    const hasFreshTelemetryAfterSend = lastTelemetryAt && lastTelemetryAt >= sentAt;
    if (!hasFreshTelemetryAfterSend && connStatusEl) {
      connStatusEl.textContent = 'Sin respuesta de la placa. Revisa ID, usuario y contraseña';
    }
    pendingCommandAckTimer = null;
  }, COMMAND_ACK_TIMEOUT_MS);
}

async function initialStatusBootstrap() {
  setActuatorStatePending();

  if (settings.mqttHost) {
    requestStatusSnapshot();
    return;
  }

  setActuatorStateUnavailable();
}

function scheduleStatusHttpFallback() {
  if (statusFallbackTimer) {
    clearTimeout(statusFallbackTimer);
  }

  statusFallbackTimer = setTimeout(() => {
    const telemetryFresh = isTelemetryFresh(STATUS_REQUEST_FALLBACK_MS);
    if (!telemetryFresh) {
      void fetchStatus(true).finally(() => {
        statusRequestInFlight = false;
      });
    } else {
      statusRequestInFlight = false;
    }
  }, STATUS_REQUEST_FALLBACK_MS);
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn(`No se pudo guardar ${key} en ${storage === window.sessionStorage ? 'sessionStorage' : 'localStorage'}:`, err);
  }
}

function getBoardUserRegistry() {
  try {
    const raw = window.localStorage.getItem('boardUserRegistry');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('No se pudo leer boardUserRegistry:', err);
    return {};
  }
}

function saveBoardUserRegistry(registry) {
  safeStorageSet(window.localStorage, 'boardUserRegistry', JSON.stringify(registry || {}));
}
function showActionFeedback(message, type = 'success') {
  if (!message) return;

  let toast = document.getElementById('actionToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'actionToast';
    toast.className = 'action-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.remove('success', 'error', 'show');
  toast.classList.add(type === 'error' ? 'error' : 'success');

  void toast.offsetWidth;
  toast.classList.add('show');

  if (actionToastTimer) {
    clearTimeout(actionToastTimer);
  }

  actionToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function initSettingsSync() {
  // Mantiene compatibilidad sin recargas automáticas de página.
}

function broadcastSettingsUpdate() {
  if (!mqttClient || !mqttClient.isConnected()) return;

  const topic = modeScheduleTopic();
  if (!topic) return;

  const payload = {
    type: 'mode-schedule-updated',
    source: settingsSyncId,
    timestamp: Date.now(),
    data: {
      modoAuto: settings.modoAuto,
      epoca: settings.epoca,
      lightsStart: settings.lightsStart,
      lightsEnd: settings.lightsEnd,
      pumpOnMinutes: settings.pumpOnMinutes,
      pumpOffMinutes: settings.pumpOffMinutes
    }
  };

  try {
    mqttClient.send(topic, JSON.stringify(payload));
  } catch (err) {
    console.warn('No se pudo sincronizar modo y horarios:', err);
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

function updateManualControlsAvailability() {
  const disableManualControls = settings.modoAuto;
  const disabledTitle = 'Modo automatico activo: cambia a manual para controlar';

  manualControlButtons.forEach((button) => {
    button.disabled = disableManualControls;
    button.title = disableManualControls ? disabledTitle : '';
  });
}

function updateModeButtonsVisualState() {
  if (!modeManualBtn || !modeAutoBtn) return;

  modeManualBtn.classList.toggle('is-selected', !settings.modoAuto);
  modeAutoBtn.classList.toggle('is-selected', settings.modoAuto);
  modeManualBtn.setAttribute('aria-pressed', String(!settings.modoAuto));
  modeAutoBtn.setAttribute('aria-pressed', String(settings.modoAuto));
}

function updateAutoConfigButtonsAvailability() {
  const disableAutoButtons = !settings.modoAuto;
  const disabledTitle = 'Cambia a automatico para guardar o limpiar horarios';

  autoConfigActionButtons.forEach((button) => {
    button.disabled = disableAutoButtons;
    button.title = disableAutoButtons ? disabledTitle : '';
  });
}

function applySettingsToUI() {
  enforceFixedMqttSettings();

  if (espIpEl) espIpEl.value = settings.espIp;
  if (mqttHostEl) mqttHostEl.value = settings.mqttHost;
  if (mqttPortEl) mqttPortEl.value = settings.mqttPort;
  if (mqttUserEl) mqttUserEl.value = settings.mqttUser;
  if (mqttPasswordEl) mqttPasswordEl.value = settings.mqttPassword;
  if (appUserEl) appUserEl.value = settings.appUser;
  if (appPasswordEl) appPasswordEl.value = settings.appPassword;
  if (modeSelectEl) modeSelectEl.value = settings.modoAuto ? 'auto' : 'manual';
  if (modoAutoEl) modoAutoEl.checked = settings.modoAuto;
  if (epocaSelect) epocaSelect.value = settings.epoca || 'personalizado';
  if (lightsStartEl) lightsStartEl.value = settings.lightsStart || '08:00';
  if (lightsEndEl) lightsEndEl.value = settings.lightsEnd || '20:00';
  if (pumpOnMinutesEl) pumpOnMinutesEl.value = settings.pumpOnMinutes || '2';
  if (pumpOffMinutesEl) pumpOffMinutesEl.value = settings.pumpOffMinutes || '10';
  updateModeButtonsVisualState();
  if (epocaSelect && epocaSelect.value !== 'personalizado') {
    applySeasonScheduleToInputs();
  }
  updateManualControlsAvailability();
  updateAutoConfigButtonsAvailability();
  updateAutoConfigSummary();
  updateAuthUi();
}

function syncSettingsFromInputs() {
  enforceFixedMqttSettings();

  if (espIpEl) settings.espIp = espIpEl.value.trim();
  if (appUserEl) settings.appUser = appUserEl.value.trim();
  if (appPasswordEl) settings.appPassword = appPasswordEl.value.trim();
  if (deviceIdInputEl) settings.deviceId = deviceIdInputEl.value.trim().toLowerCase();
  if (modeSelectEl) {
    settings.modoAuto = modeSelectEl.value === 'auto';
  } else if (modeManualBtn && modeAutoBtn) {
    settings.modoAuto = modeAutoBtn.classList.contains('is-selected');
  } else if (modoAutoEl) {
    settings.modoAuto = modoAutoEl.checked;
  }
  if (epocaSelect) settings.epoca = epocaSelect.value;
  if (lightsStartEl) settings.lightsStart = lightsStartEl.value;
  if (lightsEndEl) settings.lightsEnd = lightsEndEl.value;
  if (pumpOnMinutesEl) settings.pumpOnMinutes = pumpOnMinutesEl.value;
  if (pumpOffMinutesEl) settings.pumpOffMinutes = pumpOffMinutesEl.value;

  safeStorageSet(window.localStorage, 'espIp', settings.espIp);
  safeStorageSet(window.localStorage, 'appUser', settings.appUser);
  safeStorageSet(window.localStorage, 'appPassword', settings.appPassword);
  safeStorageSet(window.localStorage, 'deviceId', settings.deviceId);
  safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
  safeStorageSet(window.localStorage, 'epoca', settings.epoca);
  safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
  safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
  safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
  safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
  safeStorageSet(window.localStorage, 'pumpInterval', settings.pumpOnMinutes);

  updateModeButtonsVisualState();
  updateManualControlsAvailability();
  updateAutoConfigButtonsAvailability();
  updateAutoConfigSummary();
}

async function setModeFromButtons(nextModeAuto) {
  const wasAuto = settings.modoAuto;
  settings.modoAuto = Boolean(nextModeAuto);

  if (modeSelectEl) {
    modeSelectEl.value = settings.modoAuto ? 'auto' : 'manual';
  }
  if (modoAutoEl) {
    modoAutoEl.checked = settings.modoAuto;
  }

  updateModeButtonsVisualState();
  syncSettingsFromInputs();

  if (wasAuto && !settings.modoAuto) {
    applyLastKnownActuatorState();
    await clearAutoSettings();
    const statusData = await fetchStatus(true);
    if (!statusData) {
      applyLastKnownActuatorState();
    }
  }
}

function resetAutoSettingsToDefaults() {
  settings.modoAuto = false;
  settings.epoca = 'personalizado';
  settings.lightsStart = '08:00';
  settings.lightsEnd = '20:00';
  settings.pumpOnMinutes = '2';
  settings.pumpOffMinutes = '10';

  safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
  safeStorageSet(window.localStorage, 'epoca', settings.epoca);
  safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
  safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
  safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
  safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
  safeStorageSet(window.localStorage, 'pumpInterval', settings.pumpOnMinutes);

  applySettingsToUI();
}

async function sendSettingsToEsp(includeAutomationSettings = true, resetAuto = false) {
  const params = new URLSearchParams();

  if (resetAuto) {
    const argentinaTime = getCurrentArgentinaTime();
    params.set('resetAuto', '1');
    params.set('currentTime', `${String(argentinaTime.hh).padStart(2, '0')}:${String(argentinaTime.mm).padStart(2, '0')}`);
  }

  if (includeAutomationSettings) {
    const argentinaTime = getCurrentArgentinaTime();
    params.set('mode', settings.modoAuto ? '1' : '0');
    params.set('lightsStart', settings.lightsStart || '08:00');
    params.set('lightsEnd', settings.lightsEnd || '20:00');
    params.set('pumpOnMinutes', String(settings.pumpOnMinutes || 2));
    params.set('pumpOffMinutes', String(settings.pumpOffMinutes || 10));
    params.set('epoca', settings.epoca || 'personalizado');
    params.set('currentTime', `${String(argentinaTime.hh).padStart(2, '0')}:${String(argentinaTime.mm).padStart(2, '0')}`);
  }

  if (settings.appUser && settings.appPassword) {
    params.set('user', settings.appUser);
    params.set('pass', settings.appPassword);
  }

  const serializedParams = params.toString();
  let mqttDispatched = false;

  if (serializedParams && mqttConnected && mqttClient) {
    try {
      const topic = configTopic();
      if (!topic) throw new Error('Falta deviceId para enviar config por MQTT');
      mqttClient.send(topic, serializedParams);
      mqttDispatched = true;
      if (connStatusEl) connStatusEl.textContent = 'Config enviada por MQTT';
      return true;
    } catch (mqttErr) {
      console.warn('Fallo envio por MQTT, intento HTTP:', mqttErr);
    }
  }

  if (isHttpsPage && !settings.espIp) {
    if (connStatusEl) connStatusEl.textContent = 'En GitHub Pages usa MQTT o configura IP del ESP';
    return false;
  }

  const candidates = getConfigUrlCandidates();
  if (candidates.length === 0) {
    if (!mqttDispatched) {
      if (connStatusEl) connStatusEl.textContent = 'Ingresa la IP del ESP8266';
      return false;
    }
    return true;
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
        if (res.status === 401) {
          throw new Error('Credenciales de placa incorrectas');
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      const validEspResponse = Boolean(data && (data.ok === true || typeof data.serverTime === 'string'));
      if (!validEspResponse) {
        throw new Error('Respuesta invalida de /config');
      }

      if (data.serverTime && connStatusEl) {
        connStatusEl.textContent = `ESP actualizado: ${data.serverTime}`;
      }
      return true;
    } catch (err) {
      try {
        const separator = url.includes('?') ? '&' : '?';
        const fallbackUrl = `${url}${separator}${params.toString()}`;
        const fallbackRes = await fetch(withAuthUrl(fallbackUrl), {
          method: 'GET',
          cache: 'no-store'
        });

        if (!fallbackRes.ok) {
          if (fallbackRes.status === 401) {
            throw new Error('Credenciales de placa incorrectas');
          }
          throw new Error(`HTTP ${fallbackRes.status}`);
        }

        const fallbackData = await fallbackRes.json().catch(() => null);
        const validFallbackResponse = Boolean(fallbackData && (fallbackData.ok === true || typeof fallbackData.serverTime === 'string'));
        if (!validFallbackResponse) {
          throw new Error('Respuesta invalida de /config por GET');
        }

        if (fallbackData.serverTime && connStatusEl) {
          connStatusEl.textContent = `ESP actualizado: ${fallbackData.serverTime}`;
        }
        return true;
      } catch (fallbackErr) {
        lastError = fallbackErr;
        console.warn(`No se pudo enviar a ${url} (POST/GET):`, fallbackErr);
      }
    }
  }

  if (connStatusEl) connStatusEl.textContent = 'No se pudo enviar la configuración al ESP (revisa IP/red)';
  if (lastError && /Credenciales de placa incorrectas/i.test(String(lastError.message || ''))) {
    if (connStatusEl) connStatusEl.textContent = 'Usuario o contraseña de la placa incorrectos';
  }
  console.warn('Error enviando configuración al ESP:', lastError);
  return mqttDispatched;
}

async function saveSettings(includeAutomationSettings = true) {
  syncSettingsFromInputs();
  if (includeAutomationSettings) {
    if (connStatusEl) connStatusEl.textContent = 'Guardando en ESP...';
    if (mqttStatusEl) mqttStatusEl.textContent = 'Guardando en ESP...';
    const savedInEsp = await sendSettingsToEsp(true, false);
    if (!savedInEsp) {
      showActionFeedback('No se pudo guardar en el ESP', 'error');
      return;
    }
  } else {
    if (connStatusEl) connStatusEl.textContent = 'Ajustes de conexion guardados';
    if (mqttStatusEl) mqttStatusEl.textContent = 'Ajustes de conexion guardados';
    showActionFeedback('Ajustes de conexion guardados');
  }
  broadcastSettingsUpdate();
  if (includeAutomationSettings) {
    if (connStatusEl) connStatusEl.textContent = 'Ajustes guardados';
    if (mqttStatusEl) mqttStatusEl.textContent = 'Ajustes guardados';
    showActionFeedback('Guardado exitoso');
    requestStatusSnapshot();
  }
}

function forceSaveSettings() {
  void saveSettings(true);
}

async function clearAutoSettings() {
  resetAutoSettingsToDefaults();
  if (connStatusEl) connStatusEl.textContent = 'Limpiando configuracion automatica...';
  if (mqttStatusEl) mqttStatusEl.textContent = 'Limpiando configuracion automatica...';

  const clearedInEsp = await sendSettingsToEsp(false, true);
  if (!clearedInEsp) {
    showActionFeedback('No se pudo limpiar en el ESP', 'error');
    return;
  }

  broadcastSettingsUpdate();

  if (connStatusEl) connStatusEl.textContent = 'Configuracion automatica limpiada';
  if (mqttStatusEl) mqttStatusEl.textContent = 'Configuracion automatica limpiada';
  showActionFeedback('Configuracion automatica limpiada');
  requestStatusSnapshot();
}

function baseUrl() {
  if (settings.espIp) {
    if (settings.espIp.startsWith('http')) return settings.espIp;
    return `http://${settings.espIp}`;
  }

  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0' && !isGithubHosted) {
    return `http://${host}`;
  }

  return null;
}

function getEspBaseCandidates() {
  const candidates = [];
  const currentOrigin = window.location.origin;
  const currentHost = window.location.hostname;

  if (settings.espIp) {
    const normalized = String(settings.espIp).trim();
    if (normalized.startsWith('http')) {
      candidates.push(normalized.replace(/\/$/, ''));
    } else {
      candidates.push(`http://${normalized}`);
    }
  }

  if (!isGithubHosted && currentOrigin && currentOrigin !== 'null') {
    candidates.push(currentOrigin);
  }

  if (!isGithubHosted && currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1' && currentHost !== '0.0.0.0') {
    candidates.push(`http://${currentHost}`);
  }

  candidates.push('http://esp8266.local');
  candidates.push('http://hidro-control.local');

  return [...new Set(candidates.filter(Boolean))];
}

function getTimeUrlCandidates() {
  const candidates = [];
  for (const base of getEspBaseCandidates()) {
    candidates.push(`${base}/time`);
  }
  return [...new Set(candidates)];
}

function getConfigUrlCandidates() {
  const candidates = [];
  for (const base of getEspBaseCandidates()) {
    candidates.push(`${base}/config`);
  }
  return [...new Set(candidates)];
}

function getStatusUrlCandidates() {
  const candidates = [];
  for (const base of getEspBaseCandidates()) {
    candidates.push(`${base}/status`);
    candidates.push(`${base}/sensor`);
  }
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

function extractMqttActionValue(payload) {
  if (payload === null || payload === undefined) return '';

  const text = String(payload);
  if (!text.includes('=')) {
    return text;
  }

  try {
    const params = new URLSearchParams(text);
    return params.get('action') || text;
  } catch (_) {
    return text;
  }
}

function setDeviceState(device, state) {
  const normalized = normalizeBoolean(state);
  if (normalized === null) return;

  if (device === 'luz') {
    currentLuzState = normalized;
    if (estadoLuzEl) {
      estadoLuzEl.textContent = normalized ? 'ON' : 'OFF';
      setDeviceStateClass(estadoLuzEl, normalized);
    }
    updateAutoConfigSummary();
    return;
  }

  currentBombaState = normalized;
  if (estadoBombaEl) {
    estadoBombaEl.textContent = normalized ? 'ON' : 'OFF';
    setDeviceStateClass(estadoBombaEl, normalized);
  }
  updateAutoConfigSummary();
}

function setDeviceStateFromTelemetry(device, state) {
  const normalized = normalizeBoolean(state);
  if (normalized === null) return;

  if (device === 'luz') {
    currentLuzState = normalized;
    if (estadoLuzEl) {
      estadoLuzEl.textContent = normalized ? 'ON' : 'OFF';
      setDeviceStateClass(estadoLuzEl, normalized);
    }
    return;
  }

  currentBombaState = normalized;
  if (estadoBombaEl) {
    estadoBombaEl.textContent = normalized ? 'ON' : 'OFF';
    setDeviceStateClass(estadoBombaEl, normalized);
  }
}

function applyLastKnownActuatorState() {
  const luzFromTelemetry = normalizeBoolean(lastTelemetry?.luz);
  const bombaFromTelemetry = normalizeBoolean(lastTelemetry?.bomba);

  const effectiveLuz = currentLuzState !== null ? currentLuzState : luzFromTelemetry;
  const effectiveBomba = currentBombaState !== null ? currentBombaState : bombaFromTelemetry;

  if (effectiveLuz !== null) {
    setDeviceState('luz', effectiveLuz);
  }

  if (effectiveBomba !== null) {
    setDeviceState('bomba', effectiveBomba);
  }
}

function applyActuatorStatesFromPayload(data) {
  if (!data || typeof data !== 'object') return;

  if (data.luz !== undefined) {
    const luzState = normalizeBoolean(data.luz);
    if (luzState !== null) {
      setDeviceStateFromTelemetry('luz', luzState);
    } else if (estadoLuzEl) {
      estadoLuzEl.textContent = String(data.luz).toUpperCase();
    }
  }

  if (data.bomba !== undefined) {
    const bombaState = normalizeBoolean(data.bomba);
    if (bombaState !== null) {
      setDeviceStateFromTelemetry('bomba', bombaState);
    } else if (estadoBombaEl) {
      estadoBombaEl.textContent = String(data.bomba).toUpperCase();
    }
  }
}

function applyAutoSettingsFromStatus(data) {
  if (!data || typeof data !== 'object') return;

  let changed = false;

  if (data.autoMode !== undefined) {
    const modeState = normalizeBoolean(data.autoMode);
    if (modeState !== null && settings.modoAuto !== modeState) {
      settings.modoAuto = modeState;
      safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
      changed = true;
    }
  }

  if (typeof data.lightsStart === 'string' && data.lightsStart && settings.lightsStart !== data.lightsStart) {
    settings.lightsStart = data.lightsStart;
    safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
    changed = true;
  }

  if (typeof data.lightsEnd === 'string' && data.lightsEnd && settings.lightsEnd !== data.lightsEnd) {
    settings.lightsEnd = data.lightsEnd;
    safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
    changed = true;
  }

  if (data.pumpOnMinutes !== undefined) {
    const onValue = String(data.pumpOnMinutes);
    if (settings.pumpOnMinutes !== onValue) {
      settings.pumpOnMinutes = onValue;
      safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
      safeStorageSet(window.localStorage, 'pumpInterval', settings.pumpOnMinutes);
      changed = true;
    }
  }

  if (data.pumpOffMinutes !== undefined) {
    const offValue = String(data.pumpOffMinutes);
    if (settings.pumpOffMinutes !== offValue) {
      settings.pumpOffMinutes = offValue;
      safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
      changed = true;
    }
  }

  if (changed) {
    applySettingsToUI();
  } else {
    updateAutoConfigSummary();
  }
}

async function sendManualCommand(device, action) {
  if (settings.modoAuto) {
    if (connStatusEl) connStatusEl.textContent = 'Modo automatico activo: cambia a manual para controlar';
    return;
  }

  await sendCommand(device, action);
}

function connectToBroker() {
  enforceFixedMqttSettings();

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
  if (authStatusEl) {
    authStatusEl.dataset.userOverride = '1';
    authStatusEl.textContent = 'Esperando telemetría del tablero...';
  }
  updateConnectionIndicators();
  const telemetry = mqttWildcardTopic('telemetry');
  const luzTopic = mqttWildcardTopic('commands/luz');
  const bombaTopic = mqttWildcardTopic('commands/bomba');
  const authErrorTopic = mqttWildcardTopic('auth/error');
  const syncTopic = mqttWildcardTopic('ui/mode-schedule');
  mqttClient.subscribe('hidroponia/#');
  mqttClient.subscribe('#');
  mqttClient.subscribe(telemetry);
  mqttClient.subscribe(luzTopic);
  mqttClient.subscribe(bombaTopic);
  mqttClient.subscribe(authErrorTopic);
  mqttClient.subscribe(syncTopic);

  requestStatusSnapshot();
}

function onConnectFailure(error) {
  mqttConnected = false;
  if (mqttStatusEl) mqttStatusEl.textContent = `Error al conectar: ${error.errorMessage || 'desconocido'}`;
  updateConnectionIndicators();
}

function onConnectionLost(responseObject) {
  mqttConnected = false;
  if (mqttStatusEl) mqttStatusEl.textContent = 'Se perdió la conexión';
  if (connStatusEl) connStatusEl.textContent = 'Sin conexión';
  updateConnectionIndicators();
  if (responseObject.errorCode !== 0) {
    console.warn('Conexión MQTT perdida:', responseObject.errorMessage);
  }
}

function onMessageArrived(message) {
  try {
    const payload = message.payloadString;
    const topic = message.destinationName;
    console.log('[MQTT]', topic, payload);
    const topicParts = String(topic || '').split('/');
    const topicDeviceId = extractDeviceIdFromTopic(topic);

    if (activeDeviceId() && topicDeviceId && topicDeviceId !== activeDeviceId()) {
      return;
    }

    if (topicDeviceId) {
      if (!activeDeviceId()) {
        settings.deviceId = topicDeviceId;
        safeStorageSet(window.localStorage, 'deviceId', settings.deviceId);
        updateAuthUi();
        if (authStatusEl) {
          authStatusEl.dataset.userOverride = '1';
          authStatusEl.textContent = `Placa detectada: ${settings.deviceId}`;
        }
      }
    }

    if (topicParts[0] !== 'hidroponia') {
      return;
    }

    if (topicParts.length >= 3 && topicParts[2] === 'telemetry') {
      clearPendingCommandAck();
      if (statusFallbackTimer) {
        clearTimeout(statusFallbackTimer);
        statusFallbackTimer = null;
      }

      const data = JSON.parse(payload);
      lastTelemetry = data;
      lastTelemetryAt = Date.now();
      statusRequestInFlight = false;
      lastTelemetrySource = 'MQTT';
      applyAutoSettingsFromStatus(data);
      if (data.temp !== null && data.temp !== undefined) {
        tempEl.textContent = `${data.temp}°C`;
      }
      if (data.hum !== null && data.hum !== undefined) {
        humEl.textContent = `${data.hum}%`;
      }
      updatePhDisplay(data.ph);
      applyActuatorStatesFromPayload(data);
      if (mqttStatusEl) mqttStatusEl.textContent = 'Datos recibidos del broker';
      if (connStatusEl) connStatusEl.textContent = 'Conectado por MQTT';
      if (authStatusEl) {
        authStatusEl.dataset.userOverride = '1';
        authStatusEl.textContent = 'Datos actualizados';
      }
      updateLastUpdateElapsed();
      return;
    }

    if (topicParts.length >= 4 && topicParts[2] === 'auth' && topicParts[3] === 'error') {
      clearPendingCommandAck();
      if (connStatusEl) connStatusEl.textContent = 'Usuario o contraseña incorrectos para esta placa';
      if (mqttStatusEl) mqttStatusEl.textContent = 'Comando rechazado por autenticación';
      return;
    }

    if (topicParts.length >= 4 && topicParts[2] === 'commands' && topicParts[3] === 'luz') {
      clearPendingCommandAck();
      const actionValue = extractMqttActionValue(payload);
      const luzState = normalizeBoolean(actionValue);
      if (luzState !== null) {
        setDeviceStateFromTelemetry('luz', luzState);
      } else {
        estadoLuzEl.textContent = actionValue.toUpperCase();
      }
      return;
    }

    if (topicParts.length >= 4 && topicParts[2] === 'commands' && topicParts[3] === 'bomba') {
      clearPendingCommandAck();
      const actionValue = extractMqttActionValue(payload);
      const bombaState = normalizeBoolean(actionValue);
      if (bombaState !== null) {
        setDeviceStateFromTelemetry('bomba', bombaState);
      } else {
        estadoBombaEl.textContent = actionValue.toUpperCase();
      }
      return;
    }

    if (topicParts.length >= 3 && topicParts[2] === 'ui' && topicParts[3] === 'mode-schedule') {
      const syncPayload = JSON.parse(payload);
      if (syncPayload?.type !== 'mode-schedule-updated' || syncPayload?.source === settingsSyncId) {
        return;
      }

      const data = syncPayload.data || {};
      if (typeof data.modoAuto === 'boolean') settings.modoAuto = data.modoAuto;
      if (typeof data.epoca === 'string') settings.epoca = data.epoca;
      if (typeof data.lightsStart === 'string') settings.lightsStart = data.lightsStart;
      if (typeof data.lightsEnd === 'string') settings.lightsEnd = data.lightsEnd;
      if (data.pumpOnMinutes !== undefined) settings.pumpOnMinutes = String(data.pumpOnMinutes);
      if (data.pumpOffMinutes !== undefined) settings.pumpOffMinutes = String(data.pumpOffMinutes);

      safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
      safeStorageSet(window.localStorage, 'epoca', settings.epoca);
      safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
      safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
      safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
      safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
      safeStorageSet(window.localStorage, 'pumpInterval', settings.pumpOnMinutes);

      applySettingsToUI();
      if (mqttStatusEl) mqttStatusEl.textContent = 'Modo y horarios sincronizados';
    }

  } catch (error) {
    console.warn('Mensaje MQTT inválido:', error);
  }
}

async function sendCommand(device, action) {
  const normalizedAction = String(action).toUpperCase();
  const shouldTurnOn = normalizedAction === 'ON';
  const base = baseUrl();

  let mqttSent = false;

  if (mqttConnected && mqttClient) {
    const topic = commandTopic(device);
    try {
      if (!topic) throw new Error('Falta deviceId para comando MQTT');
      const mqttCommandPayload = new URLSearchParams({ action: normalizedAction });
      if (settings.appUser) mqttCommandPayload.set('user', settings.appUser);
      if (settings.appPassword) mqttCommandPayload.set('pass', settings.appPassword);
      mqttClient.send(topic, mqttCommandPayload.toString());
      mqttSent = true;
      mqttStatusEl.textContent = `Comando enviado: ${device} ${normalizedAction}`;
      connStatusEl.textContent = 'Comando enviado por MQTT, esperando respuesta...';
      schedulePendingCommandAck();
      requestStatusSnapshot();
    } catch (err) {
      console.warn('Error enviando comando por MQTT:', err);
    }
  }

  if (!base && !mqttSent) {
    connStatusEl.textContent = 'IP ESP no configurada';
    return;
  }

  if (!base) {
    return;
  }

  const url = withAuthUrl(`${base}/${device}/${normalizedAction.toLowerCase()}`);
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401) throw new Error('auth');
      throw new Error('error en petición');
    }
    connStatusEl.textContent = mqttSent
      ? `OK local: ${device} ${normalizedAction.toLowerCase()}`
      : `OK: ${device} ${normalizedAction.toLowerCase()}`;
    setDeviceState(device, shouldTurnOn);
    await fetchStatus();
  } catch (err) {
    if (!mqttSent) {
      connStatusEl.textContent = (String(err?.message || '') === 'auth')
        ? 'Usuario o contraseña de la placa incorrectos'
        : 'Error conectando al ESP';
    }
  }
}

if (luzOnBtn) {
  luzOnBtn.addEventListener('click', () => {
    void sendManualCommand('luz', 'on');
  });
}

if (luzOffBtn) {
  luzOffBtn.addEventListener('click', () => {
    void sendManualCommand('luz', 'off');
  });
}

if (bombaOnBtn) {
  bombaOnBtn.addEventListener('click', () => {
    void sendManualCommand('bomba', 'on');
  });
}

if (bombaOffBtn) {
  bombaOffBtn.addEventListener('click', () => {
    void sendManualCommand('bomba', 'off');
  });
}

async function fetchStatus(forceHttp = false) {
  if (mqttConnected && !forceHttp) {
    const telemetryFresh = isTelemetryFresh(15000);
    if (telemetryFresh) {
      applyActuatorStatesFromPayload(lastTelemetry);
      if (connStatusEl) connStatusEl.textContent = 'Conectado por MQTT';
      return lastTelemetry;
    }
  }

  if (connStatusEl) {
    connStatusEl.textContent = 'Esperando datos por MQTT';
  }
  if (tempEl) tempEl.textContent = 'Error de datos';
  if (humEl) humEl.textContent = 'Error de datos';
  updatePhDisplay(null);
  statusRequestInFlight = false;
  updateLastUpdateElapsed();
  return null;
}

function requestStatusSnapshot() {
  const now = Date.now();
  if (statusRequestInFlight) return;
  if (now - lastStatusRequestAt < STATUS_MIN_REQUEST_GAP_MS) return;
  if (mqttConnected && isTelemetryFresh()) return;

  lastStatusRequestAt = now;
  statusRequestInFlight = true;

  if (mqttConnected && mqttClient) {
    try {
      const topic = statusRequestTopic();
      if (!topic) {
        statusRequestInFlight = false;
        if (connStatusEl) connStatusEl.textContent = 'Esperando descubrir la placa por MQTT';
        return;
      }
      const statusPayload = new URLSearchParams({ request: 'now' });
      if (settings.appUser) statusPayload.set('user', settings.appUser);
      if (settings.appPassword) statusPayload.set('pass', settings.appPassword);
      mqttClient.send(topic, statusPayload.toString());
      return;
    } catch (err) {
      console.warn('No se pudo solicitar estado por MQTT:', err);
    }
  }

  statusRequestInFlight = false;
}

async function automaticControl() {
  // El control automático lo resuelve el ESP8266.
  // La web solo configura parámetros y envía comandos manuales.
  return;

  if (!settings.modoAuto) return;

  const data = mqttConnected ? lastTelemetry : await fetchStatus();
  if (!data) return;

  const argentinaTime = getCurrentArgentinaTime();
  const scheduleNow = {
    getHours: () => argentinaTime.hh,
    getMinutes: () => argentinaTime.mm
  };
  const shouldPump = true;
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
setActuatorStatePending();
updateLastUpdateElapsed();

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    void saveSettings(false);
    if (settings.mqttHost) {
      connectToBroker();
    }
  });
}

if (saveParamsBtn) {
  saveParamsBtn.addEventListener('click', () => {
    forceSaveSettings();
  });
}

if (clearParamsBtn) {
  clearParamsBtn.addEventListener('click', () => {
    void clearAutoSettings();
  });
}

if (connectBrokerBtn) {
  connectBrokerBtn.addEventListener('click', connectToBroker);
}

if (disconnectBrokerBtn) {
  disconnectBrokerBtn.addEventListener('click', disconnectBroker);
}

if (loginBoardBtn) {
  loginBoardBtn.addEventListener('click', () => {
    void loginBoardAccount();
  });
}

if (createBoardUserBtn) {
  createBoardUserBtn.addEventListener('click', () => {
    void createBoardUserAccount();
  });
}

if (modeSelectEl) {
  modeSelectEl.addEventListener('change', async () => {
    const wasAuto = settings.modoAuto;
    syncSettingsFromInputs();

    if (wasAuto && !settings.modoAuto) {
      applyLastKnownActuatorState();
      await clearAutoSettings();
      const statusData = await fetchStatus(true);
      if (!statusData) {
        applyLastKnownActuatorState();
      }
    }
  });
}

if (modeManualBtn) {
  modeManualBtn.addEventListener('click', () => {
    void setModeFromButtons(false);
  });
}

if (modeAutoBtn) {
  modeAutoBtn.addEventListener('click', () => {
    void setModeFromButtons(true);
  });
}

if (modoAutoEl) {
  modoAutoEl.addEventListener('change', async () => {
    const wasAuto = settings.modoAuto;
    syncSettingsFromInputs();

    if (wasAuto && !settings.modoAuto) {
      applyLastKnownActuatorState();
      await clearAutoSettings();
      const statusData = await fetchStatus(true);
      if (!statusData) {
        applyLastKnownActuatorState();
      }
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

const autoSettingsInputs = [espIpEl, appUserEl, appPasswordEl, epocaSelect, lightsStartEl, lightsEndEl, pumpOnMinutesEl, pumpOffMinutesEl].filter(Boolean);
autoSettingsInputs.forEach((element) => {
  element.addEventListener('input', () => {
    syncSettingsFromInputs();
  });
  element.addEventListener('change', () => {
    syncSettingsFromInputs();
  });
});

initSettingsSync();

scheduleStatusPolling();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    scheduleStatusPolling();
  });
}

setInterval(updateLastUpdateElapsed, 1000);
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
}, SERVER_TIME_SYNC_INTERVAL_MS);

void initialStatusBootstrap();
if (settings.mqttHost) {
  connectToBroker();
}
