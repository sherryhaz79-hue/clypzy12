import { useState } from 'react'
import { Link } from 'react-router-dom'
import DashNav from '../components/DashNav'
import { useCampaigns } from '../context/CampaignContext'
import { useAuth } from '../context/AuthContext'
import { usersAPI } from '../services/api'
import { FiMessageCircle, FiPlusCircle, FiBriefcase, FiX, FiCheck, FiPlus } from 'react-icons/fi'
import { SiInstagram, SiTiktok, SiYoutube } from 'react-icons/si'
import './Dashboard.css'

const PLATFORM_CONFIG = [
  { key: 'instagram', label: 'Instagram', icon: SiInstagram },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok },
  { key: 'youtube', label: 'YouTube', icon: SiYoutube },
]

const PLATFORM_ICON_MAP = {
  Instagram: SiInstagram,
  TikTok: SiTiktok,
  YouTube: SiYoutube,
}

function Dashboard() {
  const {
    campaigns, joinedCampaigns, joinCampaign, clips,
  } = useCampaigns()
  const { user, updateUser } = useAuth()


  console.log("Active Campaigns : ", campaigns)
  // Derive connected accounts from user.socialAccounts (backend)
  const socialAccounts = user?.socialAccounts || {}
  const connectedAccounts = PLATFORM_CONFIG
    .filter(p => socialAccounts[p.key] && socialAccounts[p.key] !== '')
    .map(p => p.key)

  // Social connect state
  const [connectingPlatform, setConnectingPlatform] = useState(null)
  const [socialInput, setSocialInput] = useState('')
  const [socialSaving, setSocialSaving] = useState(false)
  const [socialError, setSocialError] = useState('')

  const connectAccount = async (platform) => {
    if (!socialInput.trim()) return
    setSocialSaving(true)
    setSocialError('')
    try {
      const data = await usersAPI.linkSocial(platform, socialInput.trim())
      updateUser({ socialAccounts: data.user.socialAccounts })
    } catch (err) {
      setSocialError(err.message || 'Failed to connect account')
    }
    setSocialSaving(false)
    setConnectingPlatform(null)
    setSocialInput('')
  }

  const disconnectAccount = async (platform) => {
    setSocialSaving(true)
    setSocialError('')
    try {
      const data = await usersAPI.linkSocial(platform, '')
      updateUser({ socialAccounts: data.user.socialAccounts })
    } catch (err) {
      setSocialError(err.message || 'Failed to disconnect account')
    }
    setSocialSaving(false)
  }

  const [selected, setSelected] = useState(null)
  const [showConnect, setShowConnect] = useState(false)

  const totalViews = clips.reduce((s, c) => s + c.views, 0)
  const totalPosts = clips.length
  const avgViews = totalPosts ? Math.round(totalViews / totalPosts) : 0

  const topClips = [...clips]
    .filter(c => c.status === 'approved')
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)

  return (
    <div className="dash">
      <DashNav active="home" />
      <main className="dash-main">
        <div className="dash-actions">
          <Link to="/add-clips" className="action-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="action-icon"><FiPlusCircle size={24} /></div>
            <h3 className="action-title">Submit clips</h3>
            <p className="action-desc">Add clips to campaigns you've joined.</p>
          </Link>
          <Link to="/earnings" className="action-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="action-icon"><FiBriefcase size={24} /></div>
            <h3 className="action-title">Manage earnings</h3>
            <p className="action-desc">Set up your wallet and cash out earnings.</p>
          </Link>
          <div className="action-card" onClick={() => setShowConnect(true)}>
            <div className="action-icon"><FiMessageCircle size={24} /></div>
            <h3 className="action-title">Connect accounts</h3>
            <p className="action-desc">Link your socials to start submitting clips.</p>
          </div>
        </div>

        <div className="dash-campaigns">
          <h2 className="campaigns-heading">Active campaigns</h2>
          <p className="campaigns-sub">Select a campaign to see details and start clipping</p>
          <div className="campaigns-grid">
            {campaigns.map((c) => (
              
              <div className="campaign-card-dash" key={c.id} onClick={() => setSelected(c)}>
                <div className="camp-top">
                  {/* <div className="camp-avatar-placeholder">{c.name?.charAt(0).toUpperCase() || 'C'}</div> */}
                  <div className="camp-avatar-wrapper">
                    {c.brandLogo && c.brandLogo.startsWith("https://res.cloudinary") ? (
                      <img
                        src={c.brandLogo}
                        alt={c.title}
                        className="camp-logo"
                        onError={(e) => { e.target.style.display = "none" }}
                      />
                    ) : (
                      <div className="camp-avatar-placeholder">
                        {c.title?.charAt(0).toUpperCase() || "C"}
                      </div>
                    )}
                  </div>



                  <div className="camp-info">
                    <span className="camp-name">{c.name} <span className="camp-verified"><FiCheck size={10} /></span></span>
                    <span className="camp-meta">{c.time} · {c.type}</span>
                  </div>
                  {joinedCampaigns.includes(c.id) && <span className="camp-joined-badge">Joined</span>}
                </div>
                <p className="camp-title">{c.title}</p>
                <div className="camp-bottom">
                  <div className="camp-socials">
                    {c.platforms.map((p) => {
                      const Icon = PLATFORM_ICON_MAP[p]
                      return Icon ? <span className="camp-social" key={p}><Icon size={14} /></span> : null
                    })}
                  </div>
                  <div className="camp-pay">
                    <span className="camp-amount">{c.pay}</span>
                    <span className="camp-per">PER 1M VIEWS</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-stats-section">
          <div className="stats-header">
            <div>
              <h2 className="stats-heading">My stats</h2>
              <p className="stats-sub">Post clips and watch your stats grow</p>
            </div>
            <button className="connect-btn" onClick={() => setShowConnect(true)}>Connect accounts</button>
          </div>
          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-box-label">Profiles</span>
              <span className="stat-box-value">{connectedAccounts.length}</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">Posts</span>
              <span className="stat-box-value">{totalPosts}</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">Views</span>
              <span className="stat-box-value">{totalViews.toLocaleString()}</span>
            </div>
            <div className="stat-box">
              <span className="stat-box-label">Avg views</span>
              <span className="stat-box-value">{avgViews.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="dash-topclips">
          <h2 className="stats-heading">Top clips</h2>
          <p className="stats-sub">Your most viewed Clypzy clips</p>
          <div className="topclips-grid">
            {topClips.map(clip => {
              const camp = campaigns.find(c => c.id === clip.campaignId)
              return (
                <div
                  className="topclip-card"
                  key={clip.id}
                  style={clip.thumbnailUrl ? {
                    backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.7)), url(${clip.thumbnailUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  } : undefined}
                >
                  <div className="topclip-views">{clip.views.toLocaleString()} views</div>
                  <div className="topclip-name">{camp?.name}</div>
                </div>
              )
            })}
            <Link to="/add-clips" className="topclip-add" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="topclip-add-icon"><FiPlusCircle /></span>
              <span className="topclip-add-label">Add</span>
            </Link>
          </div>
        </div>
      </main>

      {/* ===== Campaign Detail Modal ===== */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}><FiX /></button>
            <div className="cd-header">
              <div className="camp-avatar-placeholder lg">{selected.name?.charAt(0).toUpperCase() || 'C'}</div>
              <div className="cd-header-info">
                <div className="cd-name-row">
                  <span className="cd-name">{selected.name} <span className="camp-verified"><FiCheck size={10} /></span></span>
                  <span className="cd-status">{selected.status}</span>
                </div>
                <span className="cd-time">{selected.time}</span>
                <span className="cd-title">{selected.title}</span>
              </div>
            </div>

            <div className="cd-info-bar">
              <div className="cd-info-item">
                <span className="cd-info-label">Status</span>
                <span className="cd-info-value">{selected.endsIn}</span>
              </div>
              <div className="cd-info-item">
                <span className="cd-info-label">Language</span>
                <span className="cd-info-value">{selected.language}</span>
              </div>
              <div className="cd-info-item">
                <span className="cd-info-label">Platforms</span>
                <div className="cd-platforms">
                  {selected.platforms.map(p => {
                    const Icon = PLATFORM_ICON_MAP[p]
                    return (
                      <span key={p} className="cd-platform-icon" title={p}>
                        {Icon ? <Icon size={16} /> : p}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="cd-info-item">
                <span className="cd-info-label">Pay Type</span>
                <span className="cd-info-value">{selected.type}</span>
              </div>
              <div className="cd-info-item">
                <span className="cd-info-label">Payout</span>
                <span className="cd-info-value">${selected.cpm.toFixed(2)} cpm</span>
              </div>
            </div>

            <div className="cd-details">
              <h3>Details</h3>
              <p>{selected.description}</p>
              {selected.rules && (
                <>
                  <h4>Rules</h4>
                  <p className="cd-rules">{selected.rules}</p>
                </>
              )}
            </div>

            {joinedCampaigns.includes(selected.id) ? (
              <div className="cd-joined-msg"><FiCheck /> You've joined this campaign</div>
            ) : (
              <button className="cd-join-btn" onClick={() => joinCampaign(selected.id)}>
                Join campaign
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== Connect Accounts Modal ===== */}
      {showConnect && (
        <div className="modal-overlay" onClick={() => { setShowConnect(false); setConnectingPlatform(null); setSocialInput(''); setSocialError('') }}>
          <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowConnect(false); setConnectingPlatform(null); setSocialInput(''); setSocialError('') }}><FiX /></button>
            <h2 className="modal-title">Connect accounts</h2>
            <p className="modal-desc">Link the social media accounts where you post content.</p>
            {socialError && <p style={{ color: '#e53e3e', fontSize: '0.82rem', margin: '8px 0' }}>{socialError}</p>}
            <div className="connect-list">
              {PLATFORM_CONFIG.map(p => {
                const Icon = p.icon
                const isConnected = connectedAccounts.includes(p.key)
                return (
                  <div className="connect-row" key={p.key}>
                    <span className="connect-icon"><Icon size={18} /></span>
                    <span className="connect-platform">
                      {isConnected ? `${p.label}: @${socialAccounts[p.key]}` : `Connect ${p.label}`}
                    </span>
                    {connectingPlatform === p.key ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #333', background: '#1a1a2e', color: '#fff', fontSize: '0.85rem', width: 120 }}
                          placeholder="username"
                          value={socialInput}
                          onChange={e => setSocialInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && connectAccount(p.key)}
                          autoFocus
                        />
                        <button className="connect-toggle connected" onClick={() => connectAccount(p.key)} disabled={socialSaving}><FiCheck size={14} /></button>
                        <button className="connect-toggle" onClick={() => { setConnectingPlatform(null); setSocialInput('') }}><FiX size={14} /></button>
                      </div>
                    ) : isConnected ? (
                      <button className="connect-toggle connected" onClick={() => disconnectAccount(p.key)} disabled={socialSaving}><FiCheck size={16} /></button>
                    ) : (
                      <button className="connect-toggle" onClick={() => { setConnectingPlatform(p.key); setSocialError('') }}><FiPlus size={16} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
