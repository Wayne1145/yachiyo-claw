import { Flex } from '@mantine/core'

export function LoadingShimmer() {
  return (
    <>
      <Flex justify="center">
        <div
          className="relative rounded-xl overflow-hidden bg-[var(--chatbox-background-tertiary)]"
          style={{ width: 320, height: 320 }}
        >
          <div
            className="absolute"
            style={{
              top: '-50%',
              left: '-50%',
              width: '200%',
              height: '200%',
              background:
                'linear-gradient(135deg, transparent 0%, transparent 35%, var(--chatbox-background-secondary) 50%, transparent 65%, transparent 100%)',
              animation: 'shimmer-diagonal 3s ease-in-out infinite',
            }}
          />
        </div>
      </Flex>
      <style>{`
        @keyframes shimmer-diagonal {
          0%, 15% { transform: translate(-35%, -35%); }
          60%, 100% { transform: translate(35%, 35%); }
        }
      `}</style>
    </>
  )
}
