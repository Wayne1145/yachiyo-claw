import type { ModalProps as MantineModalProps } from '@mantine/core'
import { Button, type ButtonProps, Flex, Stack, Text } from '@mantine/core'
import { motion, useReducedMotion } from 'framer-motion'
import { Children, type HTMLAttributes, isValidElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useAdaptiveControlDensity } from '@/components/yachiyo/useAdaptiveControlDensity'
import { useAndroidPagerGestureLock } from '@/components/yachiyo/android-pager-gesture-lock'
import { Modal } from '../layout/Overlay'
import '../yachiyo/adaptive-action-cluster.css'

export interface AdaptiveModalProps extends Omit<MantineModalProps, 'opened' | 'onClose'> {
  opened: boolean
  onClose: () => void
}

export function AdaptiveModal({ opened, onClose, children, title, className, ...props }: AdaptiveModalProps) {
  const isSmallScreen = useIsSmallScreen()
  useAndroidPagerGestureLock(opened)

  if (isSmallScreen) {
    return (
      <Drawer.Root
        open={opened}
        onOpenChange={(open) => !open && onClose()}
        noBodyStyles
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="yachiyo-adaptive-overlay fixed inset-0 bg-chatbox-background-mask-overlay" />
          <Drawer.Content
            className={`yachiyo-adaptive-surface yachiyo-adaptive-sheet flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none bg-chatbox-background-primary rounded-t-lg ${className ?? ''}`}
            data-yachiyo-tab-swipe="block"
          >
            <Drawer.Handle className="yachiyo-adaptive-handle" />
            <Stack gap="md" p="sm" className="yachiyo-adaptive-scroll max-h-[85vh] overflow-y-auto">
              {title && typeof title === 'string' && (
                <Text size="md" fw={600} className="text-center">
                  {title}
                </Text>
              )}
              {title && typeof title !== 'string' && <div>{title}</div>}
              {children}
            </Stack>
            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} className={className} {...props}>
      {children}
    </Modal>
  )
}

function AdaptiveModalActions({ children }: { children: ReactNode }) {
  const isSmallScreen = useIsSmallScreen()
  const inAndroidAppShell = useInAndroidAppShell()

  if (inAndroidAppShell) {
    return <AndroidAdaptiveModalActions>{children}</AndroidAdaptiveModalActions>
  }

  if (isSmallScreen) {
    return (
      <Stack gap="xs" mt="md" className="flex-col-reverse">
        {children}
      </Stack>
    )
  }

  return (
    <Flex gap="md" mt="md" justify="flex-end" align="center">
      {children}
    </Flex>
  )
}

function getModalActionLayoutKey(children: ReactNode): string {
  return Children.toArray(children)
    .map((child, index) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return `${index}:${child}`
      }
      if (!isValidElement<{ children?: ReactNode }>(child)) {
        return `${index}:${typeof child}`
      }

      const type = child.type as unknown
      let typeName = typeof type === 'string' ? type : 'component'
      if ((typeof type === 'function' || typeof type === 'object') && type !== null) {
        const namedType = type as { displayName?: unknown; name?: unknown }
        if (typeof namedType.displayName === 'string') typeName = namedType.displayName
        else if (typeof namedType.name === 'string') typeName = namedType.name
      }
      const nestedChildren = child.props.children as unknown
      const nestedKey =
        typeof nestedChildren === 'function'
          ? 'render-function'
          : getModalActionLayoutKey(nestedChildren as ReactNode)
      return `${String(child.key ?? index)}:${typeName}:${nestedKey}`
    })
    .join('|')
}

function AndroidAdaptiveModalActions({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  const actionChildren = Children.toArray(children)
  const contentKey = getModalActionLayoutKey(actionChildren)
  const { containerRef, density, pointerHandlers } = useAdaptiveControlDensity<HTMLDivElement>({ contentKey })
  return (
    <motion.div
      ref={containerRef}
      layout={reduceMotion ? false : true}
      transition={reduceMotion ? { duration: 0.18, ease: 'easeOut' } : { type: 'spring', stiffness: 480, damping: 42 }}
      className="yachiyo-adaptive-modal-actions"
      data-density={density}
      data-yachiyo-tab-swipe="block"
      {...pointerHandlers}
    >
      {actionChildren.map((child, index) => (
        <motion.div
          key={isValidElement(child) && child.key !== null ? child.key : `modal-action-${index}`}
          layout={reduceMotion ? false : 'position'}
          transition={
            reduceMotion ? { duration: 0.18, ease: 'easeOut' } : { type: 'spring', stiffness: 480, damping: 42 }
          }
          className="yachiyo-adaptive-modal-action"
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  )
}

AdaptiveModal.Actions = AdaptiveModalActions

function AdaptiveModalCloseButton(props: ButtonProps & HTMLAttributes<HTMLButtonElement>) {
  const isSmallScreen = useIsSmallScreen()
  const { t } = useTranslation()
  if (isSmallScreen) {
    return null
  }

  return (
    <Button color="chatbox-gray" variant="light" {...props}>
      {props.children || t('Cancel')}
    </Button>
  )
}

AdaptiveModal.CloseButton = AdaptiveModalCloseButton
