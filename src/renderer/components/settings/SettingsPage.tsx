import { type ReactNode, useId } from 'react'
import './settings.css'

/** Shared settings layout; persistence and validation stay with each owning page. */
export function SettingsPage({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <main className={`settings-page settings-surface ${className}`} aria-labelledby={id}>
      <header className="settings-page-heading">
        <div>
          <h1 id={id}>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="settings-actions">{actions}</div>}
      </header>
      {children}
    </main>
  )
}

export function SettingsSection({
  title,
  description,
  children,
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <section className={`settings-section ${className}`} aria-labelledby={title ? id : undefined}>
      {title && (
        <header className="settings-section-heading">
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </header>
      )}
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="settings-actions settings-save-actions">{children}</div>
}
