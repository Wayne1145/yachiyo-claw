import type { IconProps } from '@tabler/icons-react';

export default function LayoutShrink(props: IconProps) {
  const { size, stroke = 2, title, ...others } = props;

  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-label={title}
      {...others}
    >
      <rect
        x='9.5'
        y='5'
        width='5'
        height='14'
        fill='currentColor'
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <rect
        x='3'
        y='5'
        width='18'
        height='14'
        rx='2'
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
