/** Both capabilities are exposed only through the principal-bound host API and Tool Broker. */
export const PLUGIN_DEVICE_CAPABILITY_AVAILABLE = true
export const PLUGIN_SANDBOX_CAPABILITY_AVAILABLE = true
export const PLUGIN_LINUX_RUNTIME_CAPABILITY_AVAILABLE = true

export function canGrantPluginDeviceCapability(signatureVerified: boolean): boolean {
  return PLUGIN_DEVICE_CAPABILITY_AVAILABLE && signatureVerified
}

export function isPluginCapabilityImplemented(capability: string): boolean {
  if (capability === 'device') return PLUGIN_DEVICE_CAPABILITY_AVAILABLE
  if (capability === 'sandbox') return PLUGIN_SANDBOX_CAPABILITY_AVAILABLE
  if (capability === 'linux-runtime') return PLUGIN_LINUX_RUNTIME_CAPABILITY_AVAILABLE
  return true
}
