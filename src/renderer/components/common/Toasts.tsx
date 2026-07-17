import { Snackbar } from '@mui/material'
import {} from 'react'
import { useStore } from 'zustand'
import { uiStore } from '@/stores/uiStore'
import * as toastActions from '../../stores/toastActions'

function Toasts() {
  const toasts = useStore(uiStore, (state) => state.toasts)
  return (
    <>
      {toasts.map((toast) => (
        <Snackbar
          className="Snackbar"
          key={toast.id}
          open
          onClose={() => toastActions.remove(toast.id)}
          message={toast.content}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          autoHideDuration={toast.duration ?? 3000}
        />
      ))}
    </>
  )
}

export default Toasts
