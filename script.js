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
const clearParamsBtn = document.getElementById('clearParams');
const manualControlButtons = [luzOnBtn, luzOffBtn, bombaOnBtn, bombaOffBtn].filter(Boolean);
const autoConfigActionButtons = [saveParamsBtn, clearParamsBtn].filter(Boolean);
const MODE_SCHEDULE_SYNC_TOPIC = 'hidroponia/ui/mode-schedule';
const ESP_CONFIG_TOPIC = 'hidroponia/config';
const isGithubHosted = /github\.io$/i.test(window.location.hostname || '');
const isHttpsPage = window.location.protocol === 'https:';

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

const autoLogic = window.AutoLogic;

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn(`No se pudo guardar ${key} en ${storage === window.sessionStorage ? 'sessionStorage' : 'localStorage'}:`, err);
  }
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
      pumpOffMinutes: settings.pumpOffMinutes,
      humThreshold: settings.humThreshold
    }
  };

  try {
    mqttClient.send(MODE_SCHEDULE_SYNC_TOPIC, JSON.stringify(payload));
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
  if (espIpEl) espIpEl.value = settings.espIp;
  if (mqttHostEl) mqttHostEl.value = settings.mqttHost;
  if (mqttPortEl) mqttPortEl.value = settings.mqttPort;
  if (mqttUserEl) mqttUserEl.value = settings.mqttUser;
  if (mqttPasswordEl) mqttPasswordEl.value = settings.mqttPassword;
  if (modeSelectEl) modeSelectEl.value = settings.modoAuto ? 'auto' : 'manual';
  if (modoAutoEl) modoAutoEl.checked = settings.modoAuto;
  if (epocaSelect) epocaSelect.value = settings.epoca || 'personalizado';
  if (humThresholdEl) humThresholdEl.value = settings.humThreshold;
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
}

function syncSettingsFromInputs() {
  if (espIpEl) settings.espIp = espIpEl.value.trim();
  if (mqttHostEl) settings.mqttHost = mqttHostEl.value.trim();
  if (mqttPortEl) settings.mqttPort = mqttPortEl.value.trim();
  if (mqttUserEl) settings.mqttUser = mqttUserEl.value.trim();
  if (mqttPasswordEl) settings.mqttPassword = mqttPasswordEl.value.trim();
  if (modeSelectEl) {
    settings.modoAuto = modeSelectEl.value === 'auto';
  } else if (modeManualBtn && modeAutoBtn) {
    settings.modoAuto = modeAutoBtn.classList.contains('is-selected');
  } else if (modoAutoEl) {
    settings.modoAuto = modoAutoEl.checked;
  }
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

  updateModeButtonsVisualState();
  updateManualControlsAvailability();
  updateAutoConfigButtonsAvailability();
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
  settings.humThreshold = '60';
  settings.lightsStart = '08:00';
  settings.lightsEnd = '20:00';
  settings.pumpOnMinutes = '2';
  settings.pumpOffMinutes = '10';

  safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
  safeStorageSet(window.localStorage, 'epoca', settings.epoca);
  safeStorageSet(window.localStorage, 'humThreshold', settings.humThreshold);
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
    params.set('humThreshold', String(settings.humThreshold || 60));
    params.set('pumpOnMinutes', String(settings.pumpOnMinutes || 2));
    params.set('pumpOffMinutes', String(settings.pumpOffMinutes || 10));
    params.set('epoca', settings.epoca || 'personalizado');
    params.set('currentTime', `${String(argentinaTime.hh).padStart(2, '0')}:${String(argentinaTime.mm).padStart(2, '0')}`);
  }

  const serializedParams = params.toString();
  let mqttDispatched = false;

  if (serializedParams && mqttConnected && mqttClient) {
    try {
      mqttClient.send(ESP_CONFIG_TOPIC, serializedParams);
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
        const fallbackRes = await fetch(fallbackUrl, {
          method: 'GET',
          cache: 'no-store'
        });

        if (!fallbackRes.ok) {
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

function getTimeUrlCandidates() {
  const candidates = [];
  const currentOrigin = window.location.origin;

  if (!isGithubHosted && currentOrigin && currentOrigin !== 'null') {
    candidates.push(`${currentOrigin}/time`);
  }

  const currentHost = window.location.hostname;
  if (!isGithubHosted && currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
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

  const espBase = baseUrl();
  if (espBase) {
    candidates.push(`${espBase}/config`);
  }

  const directBase = getBaseUrl();
  if (directBase) {
    candidates.push(`${directBase}/config`);
  }

  if (settings.espIp) {
    const normalizedIp = settings.espIp.replace(/^https?:\/\//, '').replace(/\/$/, '');
    candidates.push(`http://${normalizedIp}/config`);
  }

  const currentOrigin = window.location.origin;
  if (!isGithubHosted && currentOrigin && currentOrigin !== 'null') {
    candidates.push(`${currentOrigin}/config`);
  }

  const currentHost = window.location.hostname;
  if (!isGithubHosted && currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1' && currentHost !== '0.0.0.0') {
    candidates.push(`http://${currentHost}/config`);
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
      setDeviceState('luz', luzState);
    } else if (estadoLuzEl) {
      estadoLuzEl.textContent = String(data.luz).toUpperCase();
    }
  }

  if (data.bomba !== undefined) {
    const bombaState = normalizeBoolean(data.bomba);
    if (bombaState !== null) {
      setDeviceState('bomba', bombaState);
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

  if (data.humThreshold !== undefined) {
    const thresholdValue = String(data.humThreshold);
    if (settings.humThreshold !== thresholdValue) {
      settings.humThreshold = thresholdValue;
      safeStorageSet(window.localStorage, 'humThreshold', settings.humThreshold);
      changed = true;
    }
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
  mqttClient.subscribe(MODE_SCHEDULE_SYNC_TOPIC);

  // Fuerza un snapshot inicial para evitar mostrar OFF por defecto tras recargar.
  void fetchStatus(true);
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
      lastTelemetryAt = Date.now();
      applyAutoSettingsFromStatus(data);
      if (data.temp !== null && data.temp !== undefined) {
        tempEl.textContent = `${data.temp}°C`;
      }
      if (data.hum !== null && data.hum !== undefined) {
        humEl.textContent = `${data.hum}%`;
      }
      applyActuatorStatesFromPayload(data);
      mqttStatusEl.textContent = 'Datos recibidos del broker';
      connStatusEl.textContent = 'Conectado por MQTT';
      return;
    }

    if (topic === 'hidroponia/commands/luz') {
      const luzState = normalizeBoolean(payload);
      if (luzState !== null) {
        setDeviceState('luz', luzState);
      } else {
        estadoLuzEl.textContent = payload.toUpperCase();
      }
    }

    if (topic === 'hidroponia/commands/bomba') {
      const bombaState = normalizeBoolean(payload);
      if (bombaState !== null) {
        setDeviceState('bomba', bombaState);
      } else {
        estadoBombaEl.textContent = payload.toUpperCase();
      }
    }

    if (topic === MODE_SCHEDULE_SYNC_TOPIC) {
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
      if (data.humThreshold !== undefined) settings.humThreshold = String(data.humThreshold);

      safeStorageSet(window.localStorage, 'modoAuto', String(settings.modoAuto));
      safeStorageSet(window.localStorage, 'epoca', settings.epoca);
      safeStorageSet(window.localStorage, 'lightsStart', settings.lightsStart);
      safeStorageSet(window.localStorage, 'lightsEnd', settings.lightsEnd);
      safeStorageSet(window.localStorage, 'pumpOnMinutes', settings.pumpOnMinutes);
      safeStorageSet(window.localStorage, 'pumpOffMinutes', settings.pumpOffMinutes);
      safeStorageSet(window.localStorage, 'humThreshold', settings.humThreshold);
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
    const topic = device === 'luz' ? 'hidroponia/commands/luz' : 'hidroponia/commands/bomba';
    try {
      mqttClient.send(topic, normalizedAction);
      mqttSent = true;
      mqttStatusEl.textContent = `Comando enviado: ${device} ${normalizedAction}`;
      connStatusEl.textContent = 'Comando enviado por MQTT';
      setDeviceState(device, shouldTurnOn);
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

  const url = `${base}/${device}/${normalizedAction.toLowerCase()}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('error en petición');
    connStatusEl.textContent = mqttSent
      ? `OK local: ${device} ${normalizedAction.toLowerCase()}`
      : `OK: ${device} ${normalizedAction.toLowerCase()}`;
    setDeviceState(device, shouldTurnOn);
    await fetchStatus();
  } catch (err) {
    if (!mqttSent) {
      connStatusEl.textContent = 'Error conectando al ESP';
    }
  }
}

if (luzOnBtn) {
  luzOnBtn.addEventListener('click', () => {
    if (estadoLuzEl) estadoLuzEl.textContent = 'ON';
    void sendManualCommand('luz', 'on');
  });
}

if (luzOffBtn) {
  luzOffBtn.addEventListener('click', () => {
    if (estadoLuzEl) estadoLuzEl.textContent = 'OFF';
    void sendManualCommand('luz', 'off');
  });
}

if (bombaOnBtn) {
  bombaOnBtn.addEventListener('click', () => {
    if (estadoBombaEl) estadoBombaEl.textContent = 'ON';
    void sendManualCommand('bomba', 'on');
  });
}

if (bombaOffBtn) {
  bombaOffBtn.addEventListener('click', () => {
    if (estadoBombaEl) estadoBombaEl.textContent = 'OFF';
    void sendManualCommand('bomba', 'off');
  });
}

async function fetchStatus(forceHttp = false) {
  if (mqttConnected && !forceHttp) {
    const telemetryFresh = Boolean(lastTelemetry) && (Date.now() - lastTelemetryAt) <= 15000;
    if (telemetryFresh) {
      applyActuatorStatesFromPayload(lastTelemetry);
      connStatusEl.textContent = 'Conectado por MQTT';
      return lastTelemetry;
    }
  }

  const base = baseUrl();
  if (!base) return null;

  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) throw new Error('no status');
    const data = await res.json();
    lastTelemetry = data;
    lastTelemetryAt = Date.now();
    if (data.serverTime) {
      serverTimeEl.textContent = data.serverTime;
    }
    applyAutoSettingsFromStatus(data);
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
    applyActuatorStatesFromPayload(data);
    connStatusEl.textContent = `Conectado (${data.serverTime || 'sin hora'})`;
    return data;
  } catch (err) {
    try {
      const res = await fetch(`${base}/sensor`);
      if (!res.ok) throw new Error('no sensor');
      const data = await res.json();
      lastTelemetry = data;
      lastTelemetryAt = Date.now();
      if (data.serverTime) {
        serverTimeEl.textContent = data.serverTime;
      }
      applyAutoSettingsFromStatus(data);
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
      applyActuatorStatesFromPayload(data);
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
  // El control automático lo resuelve el ESP8266.
  // La web solo configura parámetros y envía comandos manuales.
  return;

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

const autoSettingsInputs = [espIpEl, mqttHostEl, mqttPortEl, mqttUserEl, mqttPasswordEl, epocaSelect, humThresholdEl, lightsStartEl, lightsEndEl, pumpOnMinutesEl, pumpOffMinutesEl].filter(Boolean);
autoSettingsInputs.forEach((element) => {
  element.addEventListener('input', () => {
    syncSettingsFromInputs();
  });
  element.addEventListener('change', () => {
    syncSettingsFromInputs();
  });
});

initSettingsSync();

setInterval(fetchStatus, 5000);
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
