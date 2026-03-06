export function getDeviceId() {
  let deviceId = localStorage.getItem('speeldit_device_id');

  if (!deviceId) {
    deviceId =
      'device_' +
      Math.random().toString(36).substring(2, 11) +
      '_' +
      Date.now();
    localStorage.setItem('speeldit_device_id', deviceId);
  }

  return deviceId;
}
