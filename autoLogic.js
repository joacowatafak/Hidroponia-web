(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.AutoLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parseTime(hhmm) {
    if (!hhmm) return { hh: 0, mm: 0 };
    const [hh, mm] = String(hhmm).split(':').map((part) => parseInt(part, 10));
    return {
      hh: Number.isFinite(hh) ? hh : 0,
      mm: Number.isFinite(mm) ? mm : 0
    };
  }

  function isTimeInRange(now, start, end) {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const minutesStart = start.hh * 60 + start.mm;
    const minutesEnd = end.hh * 60 + end.mm;

    if (minutesStart <= minutesEnd) {
      return minutesNow >= minutesStart && minutesNow <= minutesEnd;
    }

    return minutesNow >= minutesStart || minutesNow <= minutesEnd;
  }

  function normalizeState(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const text = String(value).trim().toLowerCase();
    if (['on', 'true', '1', 'si', 'sí'].includes(text)) return true;
    if (['off', 'false', '0', 'no'].includes(text)) return false;
    return null;
  }

  function shouldRunPump(humidity, threshold) {
    const hum = Number(humidity);
    const minThreshold = Number(threshold);
    if (!Number.isFinite(hum) || !Number.isFinite(minThreshold)) return false;
    return hum < minThreshold;
  }

  function shouldTurnLightsOn(now, startTime, endTime) {
    if (!startTime || !endTime) return false;
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    return isTimeInRange(now, start, end);
  }

  return {
    parseTime,
    isTimeInRange,
    normalizeState,
    shouldRunPump,
    shouldTurnLightsOn
  };
});
