import { describe, expect, it, vi } from 'vitest'
import {
  HuggingFaceModelCatalogAdapter,
  ModelCatalogController,
  ModelCatalogError,
  type ModelCatalogFetch,
  ModelCompatibilityEngine,
  ModelScopeModelCatalogAdapter,
  type RemoteModel,
} from './model-catalog'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createFetch(responses: Array<Response | ((url: string, init?: RequestInit) => Response)>): ModelCatalogFetch {
  let index = 0
  return vi.fn((input, init) => {
    const response = responses[Math.min(index++, responses.length - 1)]
    return Promise.resolve(typeof response === 'function' ? response(String(input), init) : response)
  }) as unknown as ModelCatalogFetch
}

describe('HuggingFaceModelCatalogAdapter', () => {
  it('normalizes official model metadata and pinned file hashes', async () => {
    const fetch = createFetch([
      jsonResponse([
        {
          id: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
          sha: '0123456789abcdef0123456789abcdef01234567',
          gated: false,
          tags: ['gguf', 'license:apache-2.0', 'text-generation'],
          pipeline_tag: 'text-generation',
          config: { architectures: ['Qwen2ForCausalLM'] },
          cardData: { license: 'apache-2.0', summary: 'Small local model' },
          siblings: [
            {
              rfilename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
              size: 900_000_000,
              lfs: { oid: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
            },
            { rfilename: 'README.md' },
          ],
        },
      ]),
    ])
    const adapter = new HuggingFaceModelCatalogAdapter({ fetch, baseUrl: 'https://hf.test' })

    const [model] = await adapter.search({ query: 'Qwen', limit: 1 })

    expect(model).toMatchObject({
      id: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
      source: 'huggingface',
      revision: '0123456789abcdef0123456789abcdef01234567',
      revisionPinned: true,
      license: 'apache-2.0',
      architecture: ['Qwen2ForCausalLM'],
    })
    expect(model.formats).toContain('gguf')
    expect(model.runtimeCandidates).toEqual(['llama.cpp'])
    expect(model.artifacts[0]).toMatchObject({
      format: 'gguf',
      runtime: 'llama.cpp',
      sizeBytes: 900_000_000,
      sha256: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      url: 'https://hf.test/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/0123456789abcdef0123456789abcdef01234567/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://hf.test/api/models?search=Qwen&limit=1&full=true&config=true',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('uses the official tree endpoint for artifact metadata', async () => {
    const fetch = createFetch([
      jsonResponse([
        {
          type: 'file',
          path: 'model.litertlm',
          size: 1234,
          lfs: { oid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
        },
      ]),
    ])
    const adapter = new HuggingFaceModelCatalogAdapter({ fetch, baseUrl: 'https://hf.test' })

    const artifacts = await adapter.listArtifacts('owner/model', '0123456789abcdef0123456789abcdef01234567')

    expect(artifacts[0]).toMatchObject({ format: 'litertlm', runtime: 'litert-lm', sizeBytes: 1234 })
    expect(fetch).toHaveBeenCalledWith(
      'https://hf.test/api/models/owner/model/tree/0123456789abcdef0123456789abcdef01234567?recursive=true&expand=true',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('rejects malformed upstream entries instead of guessing an id', async () => {
    const adapter = new HuggingFaceModelCatalogAdapter({
      fetch: createFetch([jsonResponse([{ sha: '0123456789abcdef0123456789abcdef01234567' }])]),
    })

    await expect(adapter.search()).rejects.toMatchObject({ code: 'schema' })
  })
})

describe('ModelScopeModelCatalogAdapter', () => {
  it('normalizes the Code/Data detail envelope and ModelInfos files', async () => {
    const fetch = createFetch([
      jsonResponse({
        Code: 200,
        Success: true,
        Data: {
          Path: 'Qwen',
          Name: 'Qwen2.5-1.5B-Instruct',
          Revision: 'master',
          Description: 'ModelScope model',
          Architectures: ['Qwen2ForCausalLM'],
          License: 'apache-2.0',
          Downloads: 42,
          ModelInfos: {
            gguf: {
              files: [
                {
                  name: 'qwen-q4.gguf',
                  size: 1_000_000,
                  sha256: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
                },
              ],
            },
          },
        },
      }),
    ])
    const adapter = new ModelScopeModelCatalogAdapter({ fetch, baseUrl: 'https://ms.test' })

    const model = await adapter.getModel('Qwen/Qwen2.5-1.5B-Instruct')

    expect(model).toMatchObject({
      id: 'Qwen/Qwen2.5-1.5B-Instruct',
      source: 'modelscope',
      revision: 'master',
      revisionPinned: true,
      architecture: ['Qwen2ForCausalLM'],
      license: 'apache-2.0',
    })
    expect(model.artifacts[0]).toMatchObject({
      format: 'gguf',
      runtime: 'llama.cpp',
      sha256: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      url: 'https://ms.test/api/v1/models/Qwen/Qwen2.5-1.5B-Instruct/repo?Revision=master&FilePath=qwen-q4.gguf',
    })
  })

  it('accepts a normalized search result envelope', async () => {
    const fetch = createFetch([
      jsonResponse({ Code: 200, Data: { Models: [{ Id: 'owner/model', Name: 'model', Revision: 'master' }] } }),
    ])
    const adapter = new ModelScopeModelCatalogAdapter({ fetch, baseUrl: 'https://ms.test' })

    const models = await adapter.search('owner', { limit: 5 })

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'owner/model', source: 'modelscope', revision: 'master' })
    expect(fetch).toHaveBeenCalledWith(
      'https://ms.test/api/v1/models?PageNumber=1&PageSize=5&Name=owner',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

function createCompatibilityModel(overrides: Partial<RemoteModel> = {}): RemoteModel {
  const artifact = {
    id: 'artifact',
    modelId: 'owner/model',
    source: 'huggingface' as const,
    path: 'model-q4.gguf',
    filename: 'model-q4.gguf',
    url: 'https://hf.test/model-q4.gguf',
    downloadUrl: 'https://hf.test/model-q4.gguf',
    revision: '0123456789abcdef0123456789abcdef01234567',
    sha256: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    hash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    sizeBytes: 1_000_000_000,
    size: 1_000_000_000,
    format: 'gguf' as const,
    runtime: 'llama.cpp' as const,
    required: true,
    companion: false,
  }
  return {
    id: 'owner/model',
    modelId: 'owner/model',
    source: 'huggingface',
    repository: 'owner/model',
    name: 'model',
    revision: '0123456789abcdef0123456789abcdef01234567',
    revisionPinned: true,
    gated: false,
    architecture: ['LlamaForCausalLM'],
    tags: ['gguf'],
    formats: ['gguf'],
    runtimeCandidates: ['llama.cpp'],
    artifacts: [artifact],
    ...overrides,
  }
}

describe('ModelCompatibilityEngine', () => {
  it('reports a supported model when API, ABI, runtime, RAM and storage fit', () => {
    const model = createCompatibilityModel()
    const report = new ModelCompatibilityEngine().check(model, {
      androidApi: 34,
      abi: 'arm64-v8a',
      availableRamBytes: 2_000_000_000,
      availableStorageBytes: 2_000_000_000,
      supportedRuntimes: ['llama.cpp'],
      supportedFormats: ['gguf'],
    })

    expect(report.status).toBe('supported')
    expect(report.runtime).toBe('llama.cpp')
    expect(report.checks).toEqual({
      androidApi: 'pass',
      abi: 'pass',
      ram: 'pass',
      storage: 'pass',
      format: 'pass',
      runtime: 'pass',
    })
  })

  it('reports hard incompatibilities with stable issue codes', () => {
    const model = createCompatibilityModel({ minimumAndroidApi: 33, supportedAbis: ['arm64-v8a'] })
    const report = new ModelCompatibilityEngine().check(model, {
      androidApi: 30,
      abi: 'x86',
      availableRamBytes: 100,
      availableStorageBytes: 100,
      supportedRuntimes: ['litert-lm'],
    })

    expect(report.status).toBe('unsupported')
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'android_api_too_low',
        'abi_not_supported',
        'runtime_unavailable',
        'insufficient_ram',
        'insufficient_storage',
      ])
    )
  })
})

describe('ModelCatalogController', () => {
  it('queues a hash-verified job and exposes native-friendly lifecycle transitions', async () => {
    const model = createCompatibilityModel()
    const enqueue = vi.fn()
    const controller = new ModelCatalogController({
      sink: { enqueue, pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() },
      createId: () => 'job-1',
      now: () => 100,
    })

    const job = await controller.createDownloadJob({ model, maxConcurrentSegments: 8 })
    expect(job).toMatchObject({ id: 'job-1', status: 'queued', bytesTotal: 1_000_000_000, maxConcurrentSegments: 4 })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'queued' }))
    expect((await controller.pauseDownload('job-1')).status).toBe('paused')
    expect((await controller.resumeDownload('job-1')).status).toBe('downloading')
    expect((await controller.cancelDownload('job-1')).status).toBe('cancelled')
  })

  it('does not queue an unpinned or incomplete artifact by default', async () => {
    const model = createCompatibilityModel({ revisionPinned: false })
    const controller = new ModelCatalogController({ createId: () => 'job-1' })

    await expect(controller.createDownloadJob({ model })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(
      controller.createDownloadJob({
        model: createCompatibilityModel({ artifacts: [{ ...model.artifacts[0], sha256: undefined, hash: undefined }] }),
      })
    ).rejects.toBeInstanceOf(ModelCatalogError)
  })
})

