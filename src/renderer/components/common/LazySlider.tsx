import { Slider, type SliderProps } from '@mantine/core'
import { type FC, useCallback, useState } from 'react'

export type LazySliderProps = SliderProps

export const LazySlider: FC<LazySliderProps> = ({ value, onChange, ...otherProps }) => {
  const [tempSliderValue, setTempSliderValue] = useState<number>()

  const handleSliderChange = useCallback((v: number) => {
    setTempSliderValue(v)
  }, [])
  const handleSliderChangeEnd = useCallback((v: number) => {
    setTempSliderValue(undefined)
    onChange?.(v)
  }, [])

  return (
    <Slider
      {...otherProps}
      value={tempSliderValue ?? value}
      onChange={handleSliderChange}
      onChangeEnd={handleSliderChangeEnd}
    />
  )
}

export default LazySlider
