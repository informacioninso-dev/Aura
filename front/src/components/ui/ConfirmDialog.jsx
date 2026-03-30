import { AlertTriangle } from 'lucide-react'

import Modal from './Modal'

export default function ConfirmDialog({
  open,
  title = 'Confirmar accion',
  message = 'Esta accion no se puede deshacer.',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  onClose,
  loading = false,
}) {
  return (
    <Modal open={open} onClose={loading ? undefined : onClose} title={title}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: -8, marginBottom: 20 }}>
        <AlertTriangle size={18} style={{ color: '#F87171', flexShrink: 0, marginTop: 1 }} />
        <p style={{ color: 'rgba(255,255,255,0.68)', fontSize: 14, lineHeight: 1.45 }}>
          {message}
        </p>
      </div>

      <div className="form-modal-actions">
        <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={loading}>
          {cancelText}
        </button>
        <button
          type="button"
          className="btn-modal-danger"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Procesando...' : confirmText}
        </button>
      </div>
    </Modal>
  )
}
