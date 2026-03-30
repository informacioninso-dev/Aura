import './brand.css'

export default function BrandMark({ className = '' }) {
  const classes = ['brand-mark', className].filter(Boolean).join(' ')

  return (
    <span className={classes} aria-hidden="true">
      <img src="/logo.png" alt="" className="brand-mark-image" />
    </span>
  )
}
