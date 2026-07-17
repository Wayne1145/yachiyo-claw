/**
 * Simple Preview for ModelSelector
 * A standalone preview that doesn't require complex mocking
 */

import { Badge, Box, Button, Container, Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'

// Import the actual ModelSelector component
import { ModelSelector } from './index'

export function SimplePreview() {
  const [selectedModel, setSelectedModel] = useState({
    provider: 'openai',
    model: 'gpt-4-turbo',
  })

  return (
    <Box
      style={{
        width: '100%',
        minHeight: '100%',
        padding: '2rem',
      }}
    >
      <Container size="md">
        <Stack gap="xl">
          {/* Header */}
          <Paper shadow="sm" p="lg" radius="md">
            <Group justify="space-between">
              <div>
                <Title order={2}>ModelSelector Preview</Title>
                <Text c="dimmed" size="sm">
                  Live component preview
                </Text>
              </div>
              <Badge color="green" size="lg">
                Live
              </Badge>
            </Group>
          </Paper>

          {/* Current Selection Display */}
          <Paper shadow="sm" p="lg" radius="md">
            <Title order={4} mb="md">
              Current Selection
            </Title>
            <Group>
              <Text size="sm" fw={500}>
                Provider:
              </Text>
              <Text size="sm">{selectedModel.provider || 'None'}</Text>
            </Group>
            <Group>
              <Text size="sm" fw={500}>
                Model:
              </Text>
              <Text size="sm">{selectedModel.model || 'None'}</Text>
            </Group>
          </Paper>

          {/* Live Components */}
          <Paper shadow="sm" p="lg" radius="md">
            <Title order={4} mb="md">
              Try the Component
            </Title>
            <Text size="sm" c="dimmed" mb="lg">
              Click the buttons below to open the model selector
            </Text>

            <Stack gap="lg">
              {/* Example 1: Default Configuration */}
              <div>
                <Text size="sm" fw={500} mb="xs">
                  Default Configuration
                </Text>
                <ModelSelector
                  showAuto={true}
                  autoText="Auto (Recommended)"
                  selectedProviderId={selectedModel.provider}
                  selectedModelId={selectedModel.model}
                  onSelect={(provider, model) => {
                    setSelectedModel({ provider, model })
                  }}
                >
                  <Button variant="default" fullWidth justify="space-between">
                    <Text span size="sm">
                      {selectedModel.provider && selectedModel.model
                        ? `${selectedModel.provider}/${selectedModel.model}`
                        : 'Select a model...'}
                    </Text>
                    <Text span size="xs" c="dimmed">
                      ▼
                    </Text>
                  </Button>
                </ModelSelector>
              </div>

              <Divider />

              {/* Example 2: Search at Top */}
              <div>
                <Text size="sm" fw={500} mb="xs">
                  Search Position: Top
                </Text>
                <ModelSelector showAuto={true} searchPosition="top" onSelect={(provider, model) => {}}>
                  <Button
                    variant="light"
                    fullWidth
                    rightSection={
                      <Text size="xs" c="dimmed">
                        ▼
                      </Text>
                    }
                  >
                    Select Model (Search Top)
                  </Button>
                </ModelSelector>
              </div>

              <Divider />

              {/* Example 3: No Auto Option */}
              <div>
                <Text size="sm" fw={500} mb="xs">
                  Without Auto Option
                </Text>
                <ModelSelector showAuto={false} searchPosition="bottom" onSelect={(provider, model) => {}}>
                  <Button
                    variant="light"
                    fullWidth
                    rightSection={
                      <Text size="xs" c="dimmed">
                        ▼
                      </Text>
                    }
                  >
                    Select Model (No Auto)
                  </Button>
                </ModelSelector>
              </div>

              <Divider />

              {/* Example 4: Custom Button Style */}
              <div>
                <Text size="sm" fw={500} mb="xs">
                  Custom Button Style
                </Text>
                <ModelSelector showAuto={true} onSelect={(provider, model) => {}}>
                  <Button
                    variant="gradient"
                    gradient={{ from: 'blue', to: 'cyan' }}
                    fullWidth
                    rightSection={<Text size="xs">▼</Text>}
                  >
                    Select AI Model
                  </Button>
                </ModelSelector>
              </div>
            </Stack>
          </Paper>

          {/* Instructions */}
          <Paper shadow="sm" p="lg" radius="md">
            <Title order={4} mb="md">
              How to Test
            </Title>
            <Stack gap="xs">
              <Text size="sm">1. Click any button to open the model selector</Text>
              <Text size="sm">2. Try searching for models</Text>
              <Text size="sm">3. Switch between "All" and "Favorite" tabs</Text>
              <Text size="sm">4. Click on a model to select it</Text>
              <Text size="sm">5. Try collapsing/expanding provider groups</Text>
              <Text size="sm">6. Test the favorite star icon (hover and click)</Text>
            </Stack>
          </Paper>

          {/* Notes */}
          <Paper shadow="sm" p="lg" radius="md" className="bg-blue-50 dark:bg-blue-950/20">
            <Title order={4} mb="md">
              📝 Notes
            </Title>
            <Stack gap="xs">
              <Text size="sm">
                • The component will automatically switch between desktop (dropdown) and mobile (drawer) based on screen
                size
              </Text>
              <Text size="sm">• In desktop mode, you'll see a dropdown with sticky headers</Text>
              <Text size="sm">• In mobile mode, you'll see a bottom drawer</Text>
              <Text size="sm">• The component uses the actual providers configured in your application</Text>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  )
}

export default SimplePreview
