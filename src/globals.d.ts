// iOS Safari extensions
interface DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

// DeviceOrientationEvent.requestPermission (iOS Safari)
interface DeviceOrientationEventWithPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}
