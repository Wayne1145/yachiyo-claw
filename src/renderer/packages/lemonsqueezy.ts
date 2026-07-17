import { ofetch } from 'ofetch'
import * as remote from './remote'

type ActivateResponse =
  | {
      activated: true
      instance: { id: string }
      meta: {
        product_id: number
      }
    }
  | {
      activated: false
      error: string
      license_key?: {
        id: number
        status: string
        key: string
        activation_limit: number
        activation_usage: number
        created_at: string
        expires_at: any
      }
    }

export async function activateLicense(
  key: string,
  instanceName: string
): Promise<{
  valid: boolean
  instanceId: string
  error?: 'reached_activation_limit' | 'expired' | 'not_found'
}> {
  const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      license_key: key,
      instance_name: instanceName,
    }),
  })
  const json: ActivateResponse = await res.json()
  if (!json.activated) {
    if (json.error.includes('This license key has reached the activation limit') && json.license_key) {
      return { valid: false, instanceId: '', error: 'reached_activation_limit' }
    } else if (json.error.includes('This license key is expired.')) {
      return { valid: false, instanceId: '', error: 'expired' }
    } else if (json.error.includes('license_key not found')) {
      return { valid: false, instanceId: '', error: 'not_found' }
    } else {
      throw new Error(json.error)
    }
  }
  const remoteConfig = await remote.getRemoteConfig('product_ids')
  if (!remoteConfig.product_ids.includes(json.meta.product_id)) {
    throw new Error('Unmatching product')
  }
  return { valid: true, instanceId: json.instance.id }
}

export async function deactivateLicense(key: string, instanceId: string) {
  await ofetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
    method: 'POST',
    retry: 5,
    body: {
      license_key: key,
      instance_id: instanceId,
    },
  })
}

type ValidateLicenseKeyResponse = {
  valid: boolean
}

export async function validateLicense(key: string, instanceId: string): Promise<ValidateLicenseKeyResponse> {
  const resp = await ofetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    retry: 5,
    body: {
      license_key: key,
      instance_id: instanceId,
    },
  })
  return { valid: resp.valid }
}
