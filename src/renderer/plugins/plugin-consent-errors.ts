/** Host authorization outcomes are actionable by the user and do not indicate a broken plugin. */
export function isPluginUserDenial(code: string): boolean {
  return ['ubuntu_user_denied', 'plugin_sandbox_user_denied', 'plugin_device_user_denied', 'plugin_network_user_denied'].includes(code)
}
