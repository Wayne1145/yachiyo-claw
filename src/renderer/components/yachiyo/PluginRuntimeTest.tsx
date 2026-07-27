import { ActionIcon, Badge, Button, Code, Group, Stack, Text, Title } from '@mantine/core'
import { IconArrowLeft, IconPlayerPlay } from '@tabler/icons-react'
import { useState } from 'react'
import { createBlobWorkerRuntime } from '@/plugins/blob-worker-runtime'
import type { PluginRuntime } from '@/plugins/plugin-runtime'
import { router } from '@/router'
import { useInAndroidAppShell } from './AndroidAppShellContext'

/**
 * Dev-only test harness for the plugin runtime (platform-21).
 *
 * Loads a hardcoded test plugin into a real Blob Worker and verifies:
 * - Worker bootstrap runs (new Function in CSP works)
 * - Plugin entry evaluates and registers tools
 * - Tool invocation round-trips through the RPC protocol
 * - Host calls are authorized/denied correctly
 *
 * This is a developer-only smoke test for the same isolate used by installed plugins.
 */

const TEST_PLUGIN_ENTRY = `
yachiyo.registerTool('test_echo', function(args) {
  return { echoed: args, timestamp: Date.now() };
});
yachiyo.registerTool('test_host_call', async function(args) {
  try {
    var result = await yachiyo.host.call('storage.get', { key: 'test' });
    return { hostResult: result };
  } catch (e) {
    return { hostError: e.message };
  }
});
yachiyo.registerTool('test_globals', async function() {
  function recover(name) {
    var current = self;
    while (current) {
      try {
        var descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor) {
          if ('value' in descriptor && descriptor.value !== undefined) return descriptor.value;
          if (descriptor.get) return descriptor.get.call(self);
        }
      } catch (error) {}
      current = Object.getPrototypeOf(current);
    }
  }
  var database = recover('indexedDB');
  var directFetch = recover('fetch');
  var indexedDBOpen = 'unavailable';
  var fetchAttempt = 'unavailable';
  var importAttempt = 'unavailable';
  var storageAttempt = 'unavailable';
  var escaped = new Function('return this')();
  try {
    var request = database.open('yachiyo-plugin-isolation-probe');
    indexedDBOpen = await new Promise(function(resolve) {
      request.onsuccess = function() { request.result.close(); resolve('opened'); };
      request.onerror = function() { resolve(request.error && request.error.name || 'error'); };
      request.onblocked = function() { resolve('blocked'); };
    });
  } catch (error) { indexedDBOpen = error && error.name || String(error); }
  try {
    await directFetch.call(self, 'data:text/plain,blocked');
    fetchAttempt = 'allowed';
  } catch (error) { fetchAttempt = error && error.name || String(error); }
  try {
    recover('importScripts').call(self, 'data:text/javascript,void 0');
    importAttempt = 'allowed';
  } catch (error) { importAttempt = error && error.name || String(error); }
  try {
    storageAttempt = String(recover('localStorage').getItem('yachiyo-agent-full-access-v1'));
  } catch (error) { storageAttempt = error && error.name || String(error); }
  return {
    origin: self.location.origin,
    indexedDBOpen: indexedDBOpen,
    fetchAttempt: fetchAttempt,
    importAttempt: importAttempt,
    storageAttempt: storageAttempt,
    capacitor: typeof escaped.Capacitor,
    xhr: typeof recover('XMLHttpRequest'),
    websocket: typeof recover('WebSocket'),
    nestedWorker: typeof recover('Worker'),
    caches: typeof recover('caches')
  };
});
yachiyo.registerTool('test_denied_host', async function() {
  var results = {};
  for (var method of ['__proto__', 'constructor', 'device.tap', 'storage.clearAll']) {
    try {
      await yachiyo.host.call(method, {});
      results[method] = 'allowed';
    } catch (error) {
      results[method] = error && error.message || String(error);
    }
  }
  return results;
});
`

interface TestResult {
  step: string
  ok: boolean
  detail: string
}

export function PluginRuntimeTest() {
  const inAndroidAppShell = useInAndroidAppShell()
  const [results, setResults] = useState<TestResult[]>([])
  const [running, setRunning] = useState(false)

  const addResult = (step: string, ok: boolean, detail: string) => {
    setResults((prev) => [...prev, { step, ok, detail }])
  }

  const runTests = async () => {
    setResults([])
    setRunning(true)
    let runtime: PluginRuntime | null = null

    try {
      // Test 1: Create runtime
      try {
        runtime = createBlobWorkerRuntime({
          hostApi: {
            'storage.get': (args) => ({ value: `mock-value-for-${(args as { key?: string }).key}` }),
          },
          authorize: (method) =>
            method === 'storage.get' ? { allowed: true } : { allowed: false, reason: 'capability_denied' },
          defaultTimeoutMs: 5000,
        })
        addResult('创建 Blob Worker 运行时', true, 'createBlobWorkerRuntime 成功')
      } catch (e) {
        addResult('创建 Blob Worker 运行时', false, `${e}`)
        return
      }

      // Test 2: Load plugin
      let tools: { name: string }[] = []
      try {
        tools = await runtime.load('test-plugin', TEST_PLUGIN_ENTRY)
        addResult('加载测试插件', true, `注册工具: ${tools.map((t) => t.name).join(', ')}`)
      } catch (e) {
        addResult('加载测试插件', false, `${e}`)
        return
      }

      // Test 3: Invoke echo tool
      try {
        const echoResult = await runtime.invokeTool('test_echo', { msg: 'hello' })
        const echoed = echoResult as { echoed?: { msg?: string }; timestamp?: number }
        if (echoed.echoed?.msg === 'hello' && typeof echoed.timestamp === 'number') {
          addResult('调用 test_echo', true, JSON.stringify(echoResult))
        } else {
          addResult('调用 test_echo', false, `意外返回: ${JSON.stringify(echoResult)}`)
        }
      } catch (e) {
        addResult('调用 test_echo', false, `${e}`)
      }

      // Test 4: Authorized host call
      try {
        const hostResult = await runtime.invokeTool('test_host_call', {})
        const result = hostResult as { hostResult?: { value?: string }; hostError?: string }
        if (result.hostResult?.value === 'mock-value-for-test') {
          addResult('授权的 host.call (storage.get)', true, JSON.stringify(hostResult))
        } else if (result.hostError) {
          addResult('授权的 host.call (storage.get)', false, `Host 错误: ${result.hostError}`)
        } else {
          addResult('授权的 host.call (storage.get)', false, `意外返回: ${JSON.stringify(hostResult)}`)
        }
      } catch (e) {
        addResult('授权的 host.call (storage.get)', false, `${e}`)
      }

      // Test 5: Unknown tool rejection
      try {
        await runtime.invokeTool('nonexistent_tool', {})
        addResult('未知工具拒绝', false, '应该抛出错误但没有')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('tool_not_found')) {
          addResult('未知工具拒绝', true, `正确拒绝: ${msg}`)
        } else {
          addResult('未知工具拒绝', false, `意外错误: ${msg}`)
        }
      }

      // Test 6: host method names remain default-deny, including prototype-shaped names.
      try {
        const denied = (await runtime.invokeTool('test_denied_host', {})) as Record<string, string>
        const blocked = Object.values(denied).every((value) => value !== 'allowed')
        addResult('宿主 API 白名单', blocked, JSON.stringify(denied))
      } catch (e) {
        addResult('宿主 API 白名单', false, `${e}`)
      }

      // Test 7: recover inherited APIs like hostile code would, then verify browser-enforced isolation.
      try {
        const globals = (await runtime.invokeTool('test_globals', {})) as Record<string, string>
        const blocked =
          globals.origin === 'null' &&
          globals.indexedDBOpen !== 'opened' &&
          globals.fetchAttempt !== 'allowed' &&
          globals.importAttempt !== 'allowed' &&
          globals.storageAttempt !== 'true' &&
          globals.capacitor === 'undefined' &&
          globals.xhr === 'undefined' &&
          globals.websocket === 'undefined' &&
          globals.nestedWorker === 'undefined' &&
          globals.caches === 'undefined'
        addResult('Worker 隔离', blocked, JSON.stringify(globals))
      } catch (e) {
        addResult('Worker 隔离', false, `${e}`)
      }
    } finally {
      runtime?.dispose()
      setRunning(false)
    }
  }

  return (
    <main className="local-model-center local-model-download-queue">
      <header className="local-model-queue-heading">
        <Group gap="sm">
          {!inAndroidAppShell && (
            <ActionIcon variant="subtle" aria-label="返回设置" onClick={() => void router.navigate({ to: '/settings' })}>
              <IconArrowLeft />
            </ActionIcon>
          )}
          <div>
            <Title order={2}>插件运行时测试</Title>
            <Text size="sm" c="dimmed">
              开发者工具：验证 Blob Worker 隔离与 RPC 协议
            </Text>
          </div>
        </Group>
      </header>

      <section className="local-model-queue-row">
        <Stack gap="md">
          <Text size="sm">
            此页面用于测试插件隔离运行时。点击下方按钮将创建一个真实的 Blob Worker，加载测试插件，并验证 RPC
            往返与能力授权。
          </Text>
          <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => void runTests()} loading={running}>
            运行测试
          </Button>
        </Stack>
      </section>

      {results.length > 0 && (
        <section className="local-model-queue-row">
          <Stack gap="xs">
            <Text fw={650}>测试结果</Text>
            {results.map((r, i) => (
              <Group key={i} gap="sm" align="flex-start">
                <Badge color={r.ok ? 'green' : 'red'} size="sm">
                  {r.ok ? '通过' : '失败'}
                </Badge>
                <div>
                  <Text size="sm" fw={500}>
                    {r.step}
                  </Text>
                  <Code block style={{ maxWidth: '100%', overflow: 'auto' }}>
                    {r.detail}
                  </Code>
                </div>
              </Group>
            ))}
          </Stack>
        </section>
      )}
    </main>
  )
}
