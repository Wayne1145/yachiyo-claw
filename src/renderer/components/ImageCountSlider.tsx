import { TextField, Slider, Typography, Box } from '@mui/material'
import { useTranslation } from 'react-i18next'

export interface Props {
  value: number
  onChange(value: number): void
  className?: string
}

export default function ImageCountSlider(props: Props) {
  const { t } = useTranslation()
  return (
    <Box sx={{ margin: '10px' }} className={props.className}>
      <Box>
        <Typography gutterBottom>{t('Number of Images per Reply')}</Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          margin: '0 auto',
        }}
      >
        <Box sx={{ width: '92%' }}>
          <Slider
            value={props.value}
            onChange={(_event, value) => {
              const v = Array.isArray(value) ? value[0] : value
              props.onChange(v)
            }}
            aria-labelledby="discrete-slider"
            valueLabelDisplay="auto"
            step={1}
            min={1}
            max={10}
            marks
          />
        </Box>
        <TextField
          sx={{ marginLeft: 2, width: '100px' }}
          value={props.value.toString()}
          onChange={(event) => {
            const s = event.target.value.trim()
            const v = parseInt(s)
            if (isNaN(v)) {
              return
            }
            if (v < 0) {
              return
            }
            props.onChange(v)
          }}
          type="text"
          size="small"
          variant="outlined"
        />
      </Box>
    </Box>
  )
}
