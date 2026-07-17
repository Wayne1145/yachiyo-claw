import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import { Chip } from '@mui/material'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { currentSessionIdAtom } from '@/stores/atoms'
import type { SponsorAd } from '../../shared/types'
import platform from '../platform'

export default function SponsorChip(props: {}) {
  const currrentSessionId = useAtomValue(currentSessionIdAtom)
  const [showSponsorAD, setShowSponsorAD] = useState(true)
  const [sponsorAD, setSponsorAD] = useState<SponsorAd | null>(null)
  // useEffect(() => {
  //     ;(async () => {
  //         const ad = await remote.getSponsorAd()
  //         if (ad) {
  //             setSponsorAD(ad)
  //         }
  //     })()
  // }, [currrentSessionId])
  if (!showSponsorAD || !sponsorAD) {
    return <></>
  }
  return (
    <Chip
      size="small"
      sx={{
        maxWidth: '400px',
        height: 'auto',
        '& .MuiChip-label': {
          display: 'block',
          whiteSpace: 'normal',
        },
        borderRadius: '8px',
        marginRight: '25px',
        opacity: 0.6,
      }}
      icon={<CampaignOutlinedIcon />}
      deleteIcon={<CancelOutlinedIcon />}
      onDelete={() => setShowSponsorAD(false)}
      onClick={() => platform.openLink(sponsorAD.url)}
      label={sponsorAD.text}
    />
  )
}
