import { Flex, Text } from '@mantine/core'
import type { FC } from 'react'

export type CustomProviderIconProps = {
  providerId: string
  providerName: string
  size?: number
}

const BG_COLORS = [
  '#1ABC9C', // 活力绿
  '#3498DB', // 明亮蓝
  '#9B59B6', // 紫色
  '#E67E22', // 橙色
  '#E74C3C', // 鲜红
  '#2ECC71', // 草绿
  '#34495E', // 深蓝灰
  '#F1C40F', // 明黄
  '#F39C12', // 橙黄
  '#16A085', // 墨绿
  '#2980B9', // 深蓝
  '#8E44AD', // 深紫
  '#2C3E50', // 暗靛
  '#C0392B', // 深红
  '#27AE60', // 洋绿
  '#7F8C8D', // 高级灰
]

const DEFAULT_SIZE = 32

export const CustomProviderIcon: FC<CustomProviderIconProps> = ({ providerId, providerName, size = DEFAULT_SIZE }) => {
  const char = providerName.slice(0, 1).toUpperCase() || 'X'
  const color = BG_COLORS[providerId.split('').reduce((sum, cur) => sum + cur.charCodeAt(0), 0) % BG_COLORS.length]
  const textScale = size / DEFAULT_SIZE
  return (
    <Flex w={size} h={size} bg={color} align="center" justify="center" className="rounded-full overflow-hidden">
      <Text span c="white" fz={16} fw="500" lh={1} style={{ transform: `scale(${textScale})` }}>
        {char}
      </Text>
    </Flex>
  )
}

export default CustomProviderIcon
