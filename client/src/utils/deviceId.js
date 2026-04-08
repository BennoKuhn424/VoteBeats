export function getDeviceId() {
  let deviceId = localStorage.getItem('speeldit_device_id');

  if (!deviceId) {
    // crypto.randomUUID() is available in all modern browsers (Chrome 92+, Safari 15.4+, Firefox 95+)
    // and is cryptographically secure — unlike Math.random() which is not.
    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    deviceId = `device_${uuid}`;
    localStorage.setItem('speeldit_device_id', deviceId);
  }

  return deviceId;
}
