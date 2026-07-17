import type { IconProps } from '@tabler/icons-react';

export default function Broom(props: IconProps) {
  const { size, stroke, title, ...others } = props;

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
      <path
        d='M7.70645 13.5434C8.64996 10.9436 10.9734 9 13.7391 9V9C16.2165 9 18.3751 10.7902 18.4797 13.2653C18.5126 14.0442 18.5096 14.8236 18.4403 15.5C18.1575 18.2585 17.4848 19.828 17.0944 20.5366C16.9293 20.8364 16.5944 20.9749 16.2545 20.9335L6.09365 19.6943C5.35876 19.6047 4.96691 18.7727 5.3513 18.14C6.00064 17.0711 6.86657 15.5722 7.37006 14.4C7.48471 14.1331 7.59731 13.8441 7.70645 13.5434Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M18 13.5L9 12.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M8.5 20C8.5 20 10.2 17.7222 11 15.5'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M12.5 20.5C12.5 20.5 14 18.5 14.5 16'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14.5 8.5L16 3.5'
        stroke='currentColor'
        strokeWidth='3'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
