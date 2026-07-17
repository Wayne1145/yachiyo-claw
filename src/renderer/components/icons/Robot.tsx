import type { IconProps } from '@tabler/icons-react';

export default function Robot(props: IconProps) {
  const { size, stroke = 1.5, title, ...others } = props;

  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-label={title}
      {...others}
    >
      <path
        d="M10.6667 4C11.7712 4 12.6667 4.89543 12.6667 6V6.26628L13.1623 6.46471C13.6683 6.66731 14 7.15747 14 7.70251V10.2971C14 10.8423 13.668 11.3326 13.1618 11.5351L12.6667 11.7331V12C12.6667 13.1046 11.7712 14 10.6667 14H5.33333C4.22876 14 3.33333 13.1046 3.33333 12V11.7331L2.83825 11.5351C2.33198 11.3326 2 10.8423 2 10.2971V7.70251C2 7.15747 2.33174 6.66731 2.83773 6.46471L3.33333 6.26628V6C3.33333 4.89543 4.22876 4 5.33333 4H10.6667Z"
        stroke='currentColor'
        strokeWidth={stroke}
      />
      <path
        d="M8 4V2"
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
      />
      <path
        d="M6.33331 8.3335L6.33331 7.3335"
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
      />
      <path
        d="M6.33335 11H9.66669"
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
      />
      <path
        d="M9.66669 8.3335L9.66669 7.3335"
        stroke='currentColor'
        strokeWidth={stroke}
        strokeLinecap='round'
      />
    </svg>
  );
}
