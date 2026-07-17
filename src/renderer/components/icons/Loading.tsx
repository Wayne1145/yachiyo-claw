import * as React from 'react'

function Loading(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg height="1em" viewBox="0 0 52 24" {...props}>
      <circle cx={7.062} cy={15.89} r={2} fill="currentColor">
        <animate attributeName="cy" values="15.89;9.8;15.89" keyTimes="0;0.2;1" dur="1.25s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.2;1" keyTimes="0;0.2;1" dur="1.25s" repeatCount="indefinite" />
        <animate attributeName="r" values="2;3.6;2" keyTimes="0;0.2;1" dur="1.25s" repeatCount="indefinite" />
      </circle>
      <circle cx={19.062} cy={15.89} r={2} fill="currentColor">
        <animate
          attributeName="cy"
          values="15.89;9.8;15.89"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="1;0.2;1"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="r"
          values="2;3.6;2"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={31.062} cy={15.89} r={2} fill="currentColor">
        <animate
          attributeName="cy"
          values="15.89;9.8;15.89"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.4s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="1;0.2;1"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.4s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="r"
          values="2;3.6;2"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.4s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={43.062} cy={15.89} r={2} fill="currentColor">
        <animate
          attributeName="cy"
          values="15.89;9.8;15.89"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="1;0.2;1"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="r"
          values="2;3.6;2"
          keyTimes="0;0.2;1"
          dur="1.25s"
          begin="0.6s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  )
}

export default React.memo(Loading)
