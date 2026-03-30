import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { RefreshCw, ShieldCheck } from 'lucide-react'

import api from '../../api/client'
import { getApiErrorMessage } from '../../api/errors'
import FeedbackAlert from '../../components/ui/FeedbackAlert'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import ListControls from '../../components/ui/ListControls'
import { useAuth } from '../../context/useAuth'
import '../../components/ui/app.css'

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildPlanFeatureDrafts(planList) {
  const next = {}
  planList.forEach((plan) => {
    next[plan.id] = {}
    ;(plan.features || []).forEach((feature) => {
      if (feature.value_type === 'bool') {
        next[plan.id][feature.feature_id] = Boolean(feature.value_bool)
        return
      }
      if (feature.value_type === 'int') {
        next[plan.id][feature.feature_id] = feature.value_int ?? ''
        return
      }
      next[plan.id][feature.feature_id] = feature.value_text ?? ''
    })
  })
  return next
}

function buildUserPlanDrafts(userList) {
  const next = {}
  userList.forEach((item) => {
    next[item.id] = item.plan?.id || ''
  })
  return next
}

const SECTION_OPTIONS = [
  { id: 'overview', label: 'Resumen' },
  { id: 'plans', label: 'Planes' },
  { id: 'email', label: 'Correo' },
  { id: 'users', label: 'Usuarios' },
  { id: 'audit', label: 'Auditoria' },
]

export default function SuperAdmin() {
  const { user, fetchPerfil } = useAuth()
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [confirmState, setConfirmState] = useState({
    open: false,
    title: '',
    message: '',
    action: null,
  })
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [temporaryPasswordInfo, setTemporaryPasswordInfo] = useState(null)
  const [activeSection, setActiveSection] = useState('overview')
  const [expandedPlanId, setExpandedPlanId] = useState(null)

  const [dashboard, setDashboard] = useState(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [refreshingAll, setRefreshingAll] = useState(false)

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [userActiveFilter, setUserActiveFilter] = useState('')
  const [userStaffFilter, setUserStaffFilter] = useState('')
  const [userSuperFilter, setUserSuperFilter] = useState('')
  const [usersPage, setUsersPage] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(20)
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPageCount, setUsersPageCount] = useState(1)

  const [auditItems, setAuditItems] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditQuery, setAuditQuery] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(20)
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPageCount, setAuditPageCount] = useState(1)

  const [emailConfig, setEmailConfig] = useState(null)
  const [emailConfigLoading, setEmailConfigLoading] = useState(false)
  const [savingEmailConfig, setSavingEmailConfig] = useState(false)
  const [sendingTestEmail, setSendingTestEmail] = useState(false)
  const [clearStoredPassword, setClearStoredPassword] = useState(false)
  const [features, setFeatures] = useState([])
  const [featuresLoading, setFeaturesLoading] = useState(false)
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [planForm, setPlanForm] = useState({
    slug: '',
    name: '',
    description: '',
    sort_order: 30,
    is_active: true,
    is_default: false,
  })
  const [planFeatureDrafts, setPlanFeatureDrafts] = useState({})
  const [savingPlanFeatureId, setSavingPlanFeatureId] = useState(null)
  const [userPlanDrafts, setUserPlanDrafts] = useState({})
  const [savingUserPlanId, setSavingUserPlanId] = useState(null)
  const [emailConfigForm, setEmailConfigForm] = useState({
    active: false,
    backend: 'django.core.mail.backends.smtp.EmailBackend',
    host: '',
    port: 587,
    host_user: '',
    host_password: '',
    use_tls: true,
    use_ssl: false,
    timeout: 20,
    from_email: '',
    test_recipient_email: '',
  })
  const [testEmailForm, setTestEmailForm] = useState({
    to_email: '',
    subject: 'Prueba de correo - Aura',
    message: 'Mensaje de prueba enviado desde Aura.',
    use_custom_config: true,
  })

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingDashboard(true)
    try {
      const { data } = await api.get('/usuarios/superadmin/dashboard/')
      setDashboard(data)
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo cargar el dashboard administrativo.'),
      })
    } finally {
      if (!silent) setLoadingDashboard(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const params = {
        page: usersPage,
        page_size: usersPageSize,
      }
      const query = userQuery.trim()
      if (query) params.q = query
      if (userActiveFilter !== '') params.is_active = userActiveFilter
      if (userStaffFilter !== '') params.is_staff = userStaffFilter
      if (userSuperFilter !== '') params.is_superuser = userSuperFilter

      const { data } = await api.get('/usuarios/superadmin/usuarios/', { params })
      setUsers(data.results || [])
      setUserPlanDrafts(buildUserPlanDrafts(data.results || []))
      setUsersTotal(data.total || 0)
      setUsersPage(data.page || 1)
      setUsersPageCount(data.page_count || 1)
      setUsersPageSize(data.page_size || usersPageSize)
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo cargar la lista de usuarios.'),
      })
    } finally {
      setUsersLoading(false)
    }
  }, [userActiveFilter, userQuery, userStaffFilter, userSuperFilter, usersPage, usersPageSize])

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const params = {
        page: auditPage,
        page_size: auditPageSize,
      }
      const query = auditQuery.trim()
      if (query) params.q = query
      if (auditAction) params.action = auditAction

      const { data } = await api.get('/usuarios/superadmin/auditoria/', { params })
      setAuditItems(data.results || [])
      setAuditTotal(data.total || 0)
      setAuditPage(data.page || 1)
      setAuditPageCount(data.page_count || 1)
      setAuditPageSize(data.page_size || auditPageSize)
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo cargar la auditoria.'),
      })
    } finally {
      setAuditLoading(false)
    }
  }, [auditAction, auditPage, auditPageSize, auditQuery])

  const loadEmailConfig = useCallback(async () => {
    setEmailConfigLoading(true)
    try {
      const { data } = await api.get('/usuarios/superadmin/email/config/')
      setEmailConfig(data)
      setEmailConfigForm({
        active: Boolean(data.active),
        backend: data.backend || 'django.core.mail.backends.smtp.EmailBackend',
        host: data.host || '',
        port: data.port || 587,
        host_user: data.host_user || '',
        host_password: '',
        use_tls: Boolean(data.use_tls),
        use_ssl: Boolean(data.use_ssl),
        timeout: data.timeout || 20,
        from_email: data.from_email || '',
        test_recipient_email: data.test_recipient_email || '',
      })
      setTestEmailForm((prev) => ({
        ...prev,
        to_email: data.test_recipient_email || prev.to_email || '',
      }))
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo cargar la configuracion de correo.'),
      })
    } finally {
      setEmailConfigLoading(false)
    }
  }, [])

  const loadFeatures = useCallback(async () => {
    setFeaturesLoading(true)
    try {
      const { data } = await api.get('/usuarios/superadmin/features/')
      setFeatures(data || [])
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo cargar el catalogo de features.'),
      })
    } finally {
      setFeaturesLoading(false)
    }
  }, [])

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    try {
      const { data } = await api.get('/usuarios/superadmin/planes/')
      setPlans(data || [])
      setPlanFeatureDrafts(buildPlanFeatureDrafts(data || []))
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudieron cargar los planes.'),
      })
    } finally {
      setPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    loadAudit()
  }, [loadAudit])

  useEffect(() => {
    loadEmailConfig()
  }, [loadEmailConfig])

  useEffect(() => {
    loadFeatures()
  }, [loadFeatures])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  if (!user) return null
  if (!user.is_superuser) return <Navigate to="/dashboard" replace />

  async function refreshAll() {
    setRefreshingAll(true)
    setFeedback({ type: '', message: '' })
    try {
      await Promise.all([
        loadDashboard({ silent: true }),
        loadUsers(),
        loadAudit(),
        loadEmailConfig(),
        loadFeatures(),
        loadPlans(),
      ])
    } catch {
      // already handled in each request
    } finally {
      setRefreshingAll(false)
    }
  }

  function openConfirm({ title, message, action }) {
    setConfirmState({
      open: true,
      title,
      message,
      action,
    })
  }

  function closeConfirm() {
    if (confirmLoading) return
    setConfirmState({
      open: false,
      title: '',
      message: '',
      action: null,
    })
  }

  async function runConfirmAction() {
    if (!confirmState.action) return
    setConfirmLoading(true)
    try {
      await confirmState.action()
      closeConfirm()
    } finally {
      setConfirmLoading(false)
    }
  }

  function askToggleActive(target) {
    const nextValue = !target.is_active
    openConfirm({
      title: nextValue ? 'Activar usuario' : 'Desactivar usuario',
      message: nextValue
        ? `Se activara la cuenta ${target.email}.`
        : `Se desactivara la cuenta ${target.email}. El usuario no podra iniciar sesion.`,
      action: async () => {
        try {
          await api.patch(
            `/usuarios/superadmin/usuarios/${target.id}/estado/`,
            { is_active: nextValue },
          )
          setFeedback({
            type: 'success',
            message: `Estado actualizado para ${target.email}.`,
          })
          await Promise.all([
            loadUsers(),
            loadDashboard({ silent: true }),
            loadAudit(),
          ])
        } catch (error) {
          setFeedback({
            type: 'error',
            message: getApiErrorMessage(error, 'No se pudo actualizar el estado del usuario.'),
          })
        }
      },
    })
  }

  function askToggleStaff(target) {
    const nextValue = !target.is_staff
    openConfirm({
      title: nextValue ? 'Dar permisos de staff' : 'Quitar permisos de staff',
      message: nextValue
        ? `${target.email} recibira acceso de staff.`
        : `${target.email} perdera acceso de staff.`,
      action: async () => {
        try {
          await api.patch(
            `/usuarios/superadmin/usuarios/${target.id}/estado/`,
            { is_staff: nextValue },
          )
          setFeedback({
            type: 'success',
            message: `Permisos de staff actualizados para ${target.email}.`,
          })
          await Promise.all([
            loadUsers(),
            loadDashboard({ silent: true }),
            loadAudit(),
          ])
        } catch (error) {
          setFeedback({
            type: 'error',
            message: getApiErrorMessage(error, 'No se pudo actualizar el rol de staff.'),
          })
        }
      },
    })
  }

  function askResetPassword(target) {
    openConfirm({
      title: 'Restablecer clave',
      message: `Se generara una clave temporal para ${target.email}.`,
      action: async () => {
        try {
          const { data } = await api.post(
            `/usuarios/superadmin/usuarios/${target.id}/reset-password/`,
            {},
          )
          setTemporaryPasswordInfo(
            data.temporary_password
              ? { email: target.email, password: data.temporary_password }
              : null,
          )
          setFeedback({
            type: 'success',
            message: `Clave restablecida para ${target.email}.`,
          })
          await Promise.all([
            loadDashboard({ silent: true }),
            loadAudit(),
          ])
        } catch (error) {
          setFeedback({
            type: 'error',
            message: getApiErrorMessage(error, 'No se pudo restablecer la clave.'),
          })
        }
      },
    })
  }

  function updateEmailConfigField(field, value) {
    setEmailConfigForm((prev) => ({ ...prev, [field]: value }))
  }

  function updateTestEmailField(field, value) {
    setTestEmailForm((prev) => ({ ...prev, [field]: value }))
  }

  function updatePlanForm(field, value) {
    setPlanForm((prev) => ({ ...prev, [field]: value }))
  }

  function updatePlanFeatureDraft(planId, featureId, value) {
    setPlanFeatureDrafts((prev) => ({
      ...prev,
      [planId]: {
        ...(prev[planId] || {}),
        [featureId]: value,
      },
    }))
  }

  function updateUserPlanDraft(userId, planId) {
    setUserPlanDrafts((prev) => ({
      ...prev,
      [userId]: planId,
    }))
  }

  async function createPlan() {
    if (!planForm.slug.trim() || !planForm.name.trim()) {
      setFeedback({ type: 'error', message: 'Ingresa slug y nombre para el plan.' })
      return
    }

    setCreatingPlan(true)
    setFeedback({ type: '', message: '' })
    try {
      await api.post('/usuarios/superadmin/planes/', {
        slug: planForm.slug.trim(),
        name: planForm.name.trim(),
        description: planForm.description.trim(),
        sort_order: Number(planForm.sort_order || 0),
        is_active: planForm.is_active,
        is_default: planForm.is_default,
      })
      setPlanForm({
        slug: '',
        name: '',
        description: '',
        sort_order: 30,
        is_active: true,
        is_default: false,
      })
      setFeedback({ type: 'success', message: 'Plan creado correctamente.' })
      await Promise.all([loadPlans(), loadAudit(), loadDashboard({ silent: true })])
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo crear el plan.'),
      })
    } finally {
      setCreatingPlan(false)
    }
  }

  async function savePlanFeatures(plan) {
    setSavingPlanFeatureId(plan.id)
    setFeedback({ type: '', message: '' })
    try {
      const featuresPayload = (plan.features || []).map((feature) => {
        const draftValue = planFeatureDrafts[plan.id]?.[feature.feature_id]
        if (feature.value_type === 'bool') {
          return { feature_id: feature.feature_id, value_bool: Boolean(draftValue) }
        }
        if (feature.value_type === 'int') {
          return {
            feature_id: feature.feature_id,
            value_int: draftValue === '' || draftValue === null || draftValue === undefined ? null : Number(draftValue),
          }
        }
        return {
          feature_id: feature.feature_id,
          value_text: String(draftValue ?? ''),
        }
      })

      await api.patch(`/usuarios/superadmin/planes/${plan.id}/features/`, { features: featuresPayload })
      setFeedback({ type: 'success', message: `Capacidades actualizadas para ${plan.name}.` })
      await Promise.all([loadPlans(), loadUsers(), loadAudit()])
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudieron guardar las capacidades del plan.'),
      })
    } finally {
      setSavingPlanFeatureId(null)
    }
  }

  async function saveUserPlan(target) {
    const planId = Number(userPlanDrafts[target.id] || 0)
    if (!planId) {
      setFeedback({ type: 'error', message: 'Selecciona un plan valido para asignar.' })
      return
    }

    setSavingUserPlanId(target.id)
    setFeedback({ type: '', message: '' })
    try {
      await api.post(`/usuarios/superadmin/usuarios/${target.id}/plan/`, {
        plan_id: planId,
      })
      setFeedback({ type: 'success', message: `Plan actualizado para ${target.email}.` })
      await Promise.all([loadUsers(), loadAudit(), loadDashboard({ silent: true })])
      if (target.id === user.id) {
        await fetchPerfil()
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo actualizar el plan del usuario.'),
      })
    } finally {
      setSavingUserPlanId(null)
    }
  }

  async function saveEmailConfig() {
    setSavingEmailConfig(true)
    setFeedback({ type: '', message: '' })
    try {
      const payload = {
        active: emailConfigForm.active,
        backend: emailConfigForm.backend,
        host: emailConfigForm.host.trim(),
        port: Number(emailConfigForm.port || 0),
        host_user: emailConfigForm.host_user.trim(),
        use_tls: emailConfigForm.use_tls,
        use_ssl: emailConfigForm.use_ssl,
        timeout: Number(emailConfigForm.timeout || 0),
        from_email: emailConfigForm.from_email.trim(),
        test_recipient_email: emailConfigForm.test_recipient_email.trim(),
      }

      const passwordValue = emailConfigForm.host_password.trim()
      if (passwordValue) {
        payload.host_password = passwordValue
      }
      if (clearStoredPassword) {
        payload.clear_password = true
      }

      const { data } = await api.patch('/usuarios/superadmin/email/config/', payload)
      setEmailConfig(data)
      setEmailConfigForm((prev) => ({ ...prev, host_password: '' }))
      setClearStoredPassword(false)
      setFeedback({ type: 'success', message: 'Configuracion de correo actualizada.' })
      await Promise.all([
        loadDashboard({ silent: true }),
        loadAudit(),
      ])
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo guardar la configuracion de correo.'),
      })
    } finally {
      setSavingEmailConfig(false)
    }
  }

  async function sendTestEmail() {
    if (!testEmailForm.to_email.trim()) {
      setFeedback({ type: 'error', message: 'Ingresa un correo destino para la prueba.' })
      return
    }

    setSendingTestEmail(true)
    setFeedback({ type: '', message: '' })
    try {
      const { data } = await api.post('/usuarios/superadmin/email/test/', {
        to_email: testEmailForm.to_email.trim(),
        subject: testEmailForm.subject.trim(),
        message: testEmailForm.message.trim(),
        from_email: emailConfigForm.from_email.trim(),
        use_custom_config: testEmailForm.use_custom_config,
      })
      setFeedback({
        type: 'success',
        message: `${data.detail} Fuente: ${data.source}.`,
      })
      await Promise.all([
        loadDashboard({ silent: true }),
        loadAudit(),
      ])
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getApiErrorMessage(error, 'No se pudo enviar el correo de prueba.'),
      })
    } finally {
      setSendingTestEmail(false)
    }
  }

  const kpis = dashboard?.kpis || {}
  const health = dashboard?.health || {}
  const movements = dashboard?.movement_summary || {}
  const currencyDistribution = dashboard?.currency_distribution || []
  const planDistribution = dashboard?.plan_distribution || []

  return (
    <div>
      <div className="page-header page-header-actions superadmin-header">
        <div className="page-header-main">
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={24} />
            Super Admin
          </h1>
          <p className="page-subtitle">Monitoreo operativo y gestion de usuarios en tiempo real.</p>
        </div>
        <button
          type="button"
          className="btn-add page-primary-action superadmin-refresh"
          onClick={refreshAll}
          disabled={refreshingAll}
        >
          <RefreshCw size={16} style={{ animation: refreshingAll ? 'spin 1s linear infinite' : 'none' }} />
          {refreshingAll ? 'Actualizando...' : 'Actualizar todo'}
        </button>
      </div>

      <FeedbackAlert type={feedback.type || 'error'} message={feedback.message} />

      {temporaryPasswordInfo && (
        <div
          style={{
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.30)',
            color: '#FCD34D',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Clave temporal para {temporaryPasswordInfo.email}: <strong>{temporaryPasswordInfo.password}</strong>
        </div>
      )}

      <div className="superadmin-tabs">
        {SECTION_OPTIONS.map((section) => {
          const active = activeSection === section.id
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`superadmin-tab ${active ? 'is-active' : ''}`}
            >
              {section.label}
            </button>
          )
        })}
      </div>

      {activeSection === 'overview' && (
        <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Usuarios totales</div>
          <div className="stat-value">{loadingDashboard ? '-' : (kpis.total_users || 0)}</div>
          <div className="stat-sub">Activos: {loadingDashboard ? '-' : (kpis.active_users || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Registros recientes</div>
          <div className="stat-value lila">{loadingDashboard ? '-' : (kpis.new_users_7d || 0)}</div>
          <div className="stat-sub">Ultimos 30 dias: {loadingDashboard ? '-' : (kpis.new_users_30d || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Actividad admin hoy</div>
          <div className="stat-value green">{loadingDashboard ? '-' : (kpis.admin_actions_today || 0)}</div>
          <div className="stat-sub">Staff: {loadingDashboard ? '-' : (kpis.staff_users || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Estado de BD</div>
          <div className={`stat-value ${health?.database?.ok ? 'green' : 'red'}`}>
            {loadingDashboard ? '-' : (health?.database?.ok ? 'OK' : 'ERROR')}
          </div>
          <div className="stat-sub">{health.server_time ? formatDateTime(health.server_time) : '-'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Resumen operativo</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Ingresos registrados</td><td>{movements.ingresos || 0}</td></tr>
              <tr><td>Gastos corrientes</td><td>{movements.gastos_corrientes || 0}</td></tr>
              <tr><td>Gastos no corrientes</td><td>{movements.gastos_no_corrientes || 0}</td></tr>
              <tr><td>Diferidos</td><td>{movements.diferidos || 0}</td></tr>
              <tr><td>Simulaciones</td><td>{movements.simulaciones || 0}</td></tr>
              <tr><td>Notificaciones sin leer</td><td>{movements.notificaciones_no_leidas || 0}</td></tr>
            </tbody>
          </table>
        </div>

        {currencyDistribution.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Monedas preferidas</div>
            <div className="superadmin-badge-cluster">
              {currencyDistribution.map((item) => (
                <span key={item.moneda_preferida || 'NA'} className="badge badge-lila">
                  {(item.moneda_preferida || 'N/A')} - {item.total}
                </span>
              ))}
            </div>
          </div>
        )}

        {planDistribution.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Distribucion por plan</div>
            <div className="superadmin-badge-cluster">
              {planDistribution.map((item) => (
                <span key={item.slug || item.id} className="badge badge-lila">
                  {item.name} - {item.total}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {activeSection === 'plans' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Planes y funciones destacadas</h2>
        </div>

        <div className="superadmin-note">
          Aqui configuras el plan, eliges sus capacidades y luego lo asignas manualmente a cada usuario.
          La edicion de features vive por plan para que el panel se mantenga compacto y rapido de entender.
        </div>

        <div className="superadmin-plans-grid">
          <div className="superadmin-column">
            <div className="superadmin-panel">
              <div className="card-title" style={{ marginBottom: 12 }}>Nuevo plan</div>
              <div className="form-modal-group">
                <label className="form-modal-label">Slug</label>
                <input
                  className="form-modal-input"
                  value={planForm.slug}
                  onChange={(event) => updatePlanForm('slug', event.target.value)}
                  placeholder="enterprise"
                />
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Nombre</label>
                <input
                  className="form-modal-input"
                  value={planForm.name}
                  onChange={(event) => updatePlanForm('name', event.target.value)}
                  placeholder="Enterprise"
                />
              </div>
              <div className="form-modal-group">
                <label className="form-modal-label">Descripcion</label>
                <textarea
                  className="form-modal-input"
                  value={planForm.description}
                  onChange={(event) => updatePlanForm('description', event.target.value)}
                  rows={3}
                  placeholder="Define el alcance de este plan."
                />
              </div>
              <div className="form-modal-row">
                <div className="form-modal-group">
                  <label className="form-modal-label">Orden</label>
                  <input
                    className="form-modal-input"
                    type="number"
                    value={planForm.sort_order}
                    onChange={(event) => updatePlanForm('sort_order', event.target.value)}
                  />
                </div>
              </div>
              <div className="form-modal-row">
                <label className="form-modal-check" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={planForm.is_active}
                    onChange={(event) => updatePlanForm('is_active', event.target.checked)}
                  />
                  <span>Activo</span>
                </label>
                <label className="form-modal-check" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={planForm.is_default}
                    onChange={(event) => updatePlanForm('is_default', event.target.checked)}
                  />
                  <span>Plan por defecto</span>
                </label>
              </div>
              <div className="form-modal-actions">
                <button type="button" className="btn-modal-save" onClick={createPlan} disabled={creatingPlan}>
                  {creatingPlan ? 'Creando...' : 'Crear plan'}
                </button>
              </div>
            </div>
          </div>

          <div className="superadmin-column">
            <div className="superadmin-panel">
              <div className="card-title" style={{ marginBottom: 12 }}>Catalogo de features</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 12 }}>
                Las features se definen por codigo y aqui solo se muestran para poder incluirlas dentro de los planes.
              </div>
              <div className="superadmin-feature-catalog">
                {!featuresLoading && features.length === 0 && (
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    No hay features registradas todavia.
                  </span>
                )}
                {features.map((feature) => (
                  <div
                    key={feature.id}
                    className="superadmin-feature-card"
                  >
                    <div className="superadmin-feature-card-head">
                      <strong style={{ fontSize: 13 }}>{feature.name}</strong>
                      <span className={`badge ${feature.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {feature.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                      {feature.is_highlighted && <span className="badge badge-lila">Destacada</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{feature.code}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{feature.description || 'Sin descripcion.'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="superadmin-panel">
              <div className="card-title" style={{ marginBottom: 12 }}>Capacidades por plan</div>
              <div className="superadmin-plan-list">
                {!plansLoading && plans.length === 0 && (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    No hay planes configurados todavia.
                  </div>
                )}
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    className="superadmin-plan-card"
                  >
                    <div className="superadmin-plan-head" style={{ marginBottom: expandedPlanId === plan.id ? 12 : 0 }}>
                      <div className="superadmin-plan-summary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 16 }}>{plan.name}</strong>
                          <span className="badge badge-gray">{plan.slug}</span>
                          {plan.is_default && <span className="badge badge-lila">Default</span>}
                          <span className={`badge ${plan.is_active ? 'badge-green' : 'badge-red'}`}>
                            {plan.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                          {plan.description || 'Sin descripcion.'}
                        </div>
                      </div>
                      <div className="superadmin-plan-actions">
                        <button
                          type="button"
                          className="btn-modal-cancel"
                          onClick={() => setExpandedPlanId((current) => current === plan.id ? null : plan.id)}
                        >
                          {expandedPlanId === plan.id ? 'Ocultar detalle' : 'Editar capacidades'}
                        </button>
                        {expandedPlanId === plan.id && (
                          <button
                            type="button"
                            className="btn-modal-save"
                            onClick={() => savePlanFeatures(plan)}
                            disabled={savingPlanFeatureId === plan.id}
                          >
                            {savingPlanFeatureId === plan.id ? 'Guardando...' : 'Guardar'}
                          </button>
                        )}
                      </div>
                    </div>

                    {expandedPlanId === plan.id && (
                    <div className="superadmin-plan-feature-list">
                      {(plan.features || []).map((feature) => (
                        <div
                          key={`${plan.id}-${feature.feature_id}`}
                          className="superadmin-plan-feature-row"
                        >
                          <div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>{feature.name}</span>
                              <span className="badge badge-gray">{feature.value_type}</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                              {feature.description || feature.code}
                            </div>
                          </div>

                          {feature.value_type === 'bool' ? (
                            <label className="form-modal-check" style={{ marginBottom: 0 }}>
                              <input
                                type="checkbox"
                                checked={Boolean(planFeatureDrafts[plan.id]?.[feature.feature_id])}
                                onChange={(event) => updatePlanFeatureDraft(plan.id, feature.feature_id, event.target.checked)}
                              />
                              <span>Habilitada</span>
                            </label>
                          ) : (
                            <input
                              className="form-modal-input"
                              type={feature.value_type === 'int' ? 'number' : 'text'}
                              value={planFeatureDrafts[plan.id]?.[feature.feature_id] ?? ''}
                              onChange={(event) => updatePlanFeatureDraft(plan.id, feature.feature_id, event.target.value)}
                              placeholder={feature.value_type === 'int' ? '0' : 'Valor de la feature'}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {activeSection === 'email' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Configuracion de correo (SMTP)</h2>
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
          <label className="form-modal-check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={emailConfigForm.active}
              onChange={(event) => updateEmailConfigField('active', event.target.checked)}
            />
            <span>Activar configuracion SMTP personalizada</span>
          </label>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Backend</label>
              <input
                className="form-modal-input"
                value={emailConfigForm.backend}
                onChange={(event) => updateEmailConfigField('backend', event.target.value)}
                placeholder="django.core.mail.backends.smtp.EmailBackend"
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Correo emisor</label>
              <input
                className="form-modal-input"
                type="email"
                value={emailConfigForm.from_email}
                onChange={(event) => updateEmailConfigField('from_email', event.target.value)}
                placeholder="no-reply@tu-dominio.com"
              />
            </div>
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Host SMTP</label>
              <input
                className="form-modal-input"
                value={emailConfigForm.host}
                onChange={(event) => updateEmailConfigField('host', event.target.value)}
                placeholder="smtp.tu-proveedor.com"
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Puerto</label>
              <input
                className="form-modal-input"
                type="number"
                value={emailConfigForm.port}
                onChange={(event) => updateEmailConfigField('port', event.target.value)}
                placeholder="587"
              />
            </div>
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Usuario SMTP</label>
              <input
                className="form-modal-input"
                value={emailConfigForm.host_user}
                onChange={(event) => updateEmailConfigField('host_user', event.target.value)}
                placeholder="usuario SMTP"
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">
                Clave SMTP
                {emailConfig?.has_password ? ' (ya existe una guardada)' : ''}
              </label>
              <input
                className="form-modal-input"
                type="password"
                value={emailConfigForm.host_password}
                onChange={(event) => updateEmailConfigField('host_password', event.target.value)}
                placeholder="Deja vacio para conservar"
              />
            </div>
          </div>

          <div className="form-modal-row">
            <label className="form-modal-check" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={emailConfigForm.use_tls}
                onChange={(event) => updateEmailConfigField('use_tls', event.target.checked)}
              />
              <span>Usar TLS</span>
            </label>
            <label className="form-modal-check" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={emailConfigForm.use_ssl}
                onChange={(event) => updateEmailConfigField('use_ssl', event.target.checked)}
              />
              <span>Usar SSL</span>
            </label>
          </div>

          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Timeout (segundos)</label>
              <input
                className="form-modal-input"
                type="number"
                value={emailConfigForm.timeout}
                onChange={(event) => updateEmailConfigField('timeout', event.target.value)}
                placeholder="20"
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Correo para pruebas</label>
              <input
                className="form-modal-input"
                type="email"
                value={emailConfigForm.test_recipient_email}
                onChange={(event) => {
                  updateEmailConfigField('test_recipient_email', event.target.value)
                  updateTestEmailField('to_email', event.target.value)
                }}
                placeholder="qa@tu-dominio.com"
              />
            </div>
          </div>

          <label className="form-modal-check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={clearStoredPassword}
              onChange={(event) => setClearStoredPassword(event.target.checked)}
            />
            <span>Eliminar clave SMTP guardada (opcional)</span>
          </label>
        </div>

        <div className="form-modal-actions" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="btn-modal-save"
            onClick={saveEmailConfig}
            disabled={savingEmailConfig || emailConfigLoading}
          >
            {savingEmailConfig ? 'Guardando...' : 'Guardar configuracion SMTP'}
          </button>
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Enviar correo de prueba</div>
          <div className="form-modal-row">
            <div className="form-modal-group">
              <label className="form-modal-label">Destino</label>
              <input
                className="form-modal-input"
                type="email"
                value={testEmailForm.to_email}
                onChange={(event) => updateTestEmailField('to_email', event.target.value)}
                placeholder="correo@destino.com"
              />
            </div>
            <div className="form-modal-group">
              <label className="form-modal-label">Asunto</label>
              <input
                className="form-modal-input"
                value={testEmailForm.subject}
                onChange={(event) => updateTestEmailField('subject', event.target.value)}
                placeholder="Prueba de correo - Aura"
              />
            </div>
          </div>
          <div className="form-modal-group">
            <label className="form-modal-label">Mensaje</label>
            <textarea
              className="form-modal-input"
              value={testEmailForm.message}
              onChange={(event) => updateTestEmailField('message', event.target.value)}
              rows={4}
            />
          </div>
          <label className="form-modal-check" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={testEmailForm.use_custom_config}
              onChange={(event) => updateTestEmailField('use_custom_config', event.target.checked)}
            />
            <span>Usar configuracion SMTP personalizada (si esta activa)</span>
          </label>
          <button
            type="button"
            className="btn-modal-danger"
            onClick={sendTestEmail}
            disabled={sendingTestEmail}
          >
            {sendingTestEmail ? 'Enviando...' : 'Enviar correo de prueba'}
          </button>
        </div>
      </div>
      )}

      {activeSection === 'users' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gestion de usuarios</h2>
        </div>

        <div className="superadmin-user-filters">
          <select
            className="form-modal-select"
            value={userActiveFilter}
            onChange={(event) => {
              setUsersPage(1)
              setUserActiveFilter(event.target.value)
            }}
          >
            <option value="">Estado: todos</option>
            <option value="true">Solo activos</option>
            <option value="false">Solo inactivos</option>
          </select>
          <select
            className="form-modal-select"
            value={userStaffFilter}
            onChange={(event) => {
              setUsersPage(1)
              setUserStaffFilter(event.target.value)
            }}
          >
            <option value="">Staff: todos</option>
            <option value="true">Solo staff</option>
            <option value="false">No staff</option>
          </select>
          <select
            className="form-modal-select"
            value={userSuperFilter}
            onChange={(event) => {
              setUsersPage(1)
              setUserSuperFilter(event.target.value)
            }}
          >
            <option value="">Superadmin: todos</option>
            <option value="true">Solo superadmin</option>
            <option value="false">No superadmin</option>
          </select>
        </div>

        <ListControls
          query={userQuery}
          onQueryChange={(value) => {
            setUsersPage(1)
            setUserQuery(value)
          }}
          placeholder="Buscar por correo o usuario..."
          page={usersPage}
          pageCount={usersPageCount}
          onPrevPage={() => setUsersPage((page) => Math.max(1, page - 1))}
          onNextPage={() => setUsersPage((page) => Math.min(usersPageCount, page + 1))}
          pageSize={usersPageSize}
          onPageSizeChange={(size) => {
            setUsersPage(1)
            setUsersPageSize(size)
          }}
          totalItems={usersTotal}
          filteredItems={users.length}
        />

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Usuario</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>Staff</th>
                <th>Superadmin</th>
                <th>Ultimo login</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!usersLoading && users.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state" style={{ padding: 20 }}>
                      <div className="empty-text">No se encontraron usuarios.</div>
                    </div>
                  </td>
                </tr>
              )}
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.username || '-'}</td>
                  <td>
                    <div className="superadmin-user-plan-stack">
                      <span className={`badge ${item.plan?.slug === 'pro' ? 'badge-lila' : 'badge-gray'}`}>
                        {item.plan?.name || 'Sin plan'}
                      </span>
                      <div className="superadmin-user-plan-controls">
                        <select
                          className="form-modal-select superadmin-user-plan-select"
                          value={userPlanDrafts[item.id] || ''}
                          onChange={(event) => updateUserPlanDraft(item.id, event.target.value)}
                        >
                          <option value="">Seleccionar</option>
                          {plans.filter((plan) => plan.is_active).map((plan) => (
                            <option key={plan.id} value={plan.id}>{plan.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-modal-cancel superadmin-inline-button"
                          onClick={() => saveUserPlan(item)}
                          disabled={savingUserPlanId === item.id || !userPlanDrafts[item.id]}
                        >
                          {savingUserPlanId === item.id ? 'Guardando...' : 'Asignar'}
                        </button>
                      </div>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                        Import max rows: {item.feature_access?.import_max_rows ?? '-'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${item.is_active ? 'badge-green' : 'badge-red'}`}>
                      {item.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${item.is_staff ? 'badge-lila' : 'badge-gray'}`}>
                      {item.is_staff ? 'Si' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${item.is_superuser ? 'badge-yellow' : 'badge-gray'}`}>
                      {item.is_superuser ? 'Si' : 'No'}
                    </span>
                  </td>
                  <td>{formatDateTime(item.last_login)}</td>
                  <td>
                    <div className="superadmin-user-actions">
                      <button type="button" className="btn-modal-cancel superadmin-inline-button" onClick={() => askToggleActive(item)}>
                        {item.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button type="button" className="btn-modal-cancel superadmin-inline-button" onClick={() => askToggleStaff(item)}>
                        {item.is_staff ? 'Quitar staff' : 'Dar staff'}
                      </button>
                      <button type="button" className="btn-modal-danger superadmin-inline-button" onClick={() => askResetPassword(item)}>
                        Reset clave
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeSection === 'audit' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Auditoria de acciones</h2>
        </div>

        <div className="superadmin-audit-toolbar">
          <input
            className="form-modal-input superadmin-audit-search"
            value={auditQuery}
            onChange={(event) => {
              setAuditPage(1)
              setAuditQuery(event.target.value)
            }}
            placeholder="Buscar por accion o correo..."
          />
          <input
            className="form-modal-input superadmin-audit-filter"
            value={auditAction}
            onChange={(event) => {
              setAuditPage(1)
              setAuditAction(event.target.value)
            }}
            placeholder="Filtro exacto de accion"
          />
          <select
            className="form-modal-select superadmin-audit-pagesize"
            value={auditPageSize}
            onChange={(event) => {
              setAuditPage(1)
              setAuditPageSize(Number(event.target.value))
            }}
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>{size}/pag</option>
            ))}
          </select>
          <button type="button" className="btn-modal-cancel" onClick={() => setAuditPage((page) => Math.max(1, page - 1))} disabled={auditPage <= 1}>
            Anterior
          </button>
          <span className="superadmin-audit-page">
            {auditPage}/{auditPageCount}
          </span>
          <button type="button" className="btn-modal-cancel" onClick={() => setAuditPage((page) => Math.min(auditPageCount, page + 1))} disabled={auditPage >= auditPageCount}>
            Siguiente
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Actor</th>
                <th>Accion</th>
                <th>Objetivo</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {!auditLoading && auditItems.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state" style={{ padding: 20 }}>
                      <div className="empty-text">No hay eventos de auditoria.</div>
                    </div>
                  </td>
                </tr>
              )}
              {auditItems.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.created_at)}</td>
                  <td>{item.actor_email || '-'}</td>
                  <td>{item.action || '-'}</td>
                  <td>{item.target_email || '-'}</td>
                  <td>{item.ip_address || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
          {auditItems.length} de {auditTotal} eventos.
        </div>
      </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText="Confirmar"
        cancelText="Cancelar"
        onConfirm={runConfirmAction}
        onClose={closeConfirm}
        loading={confirmLoading}
      />
    </div>
  )
}
