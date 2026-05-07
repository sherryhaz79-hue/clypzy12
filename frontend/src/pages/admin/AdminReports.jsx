import { useState, useEffect } from 'react'
import { clipsAPI, usersAPI, campaignsAPI } from '../../services/api'
import AdminLayout from './AdminLayout'
import './Admin.css'

function AdminReports() {
  const [tab, setTab] = useState('pending')
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      clipsAPI.list().catch(() => ({ clips: [] })),
      usersAPI.listUsers({ role: 'creator' }).catch(() => ({ users: [] })),
      campaignsAPI.list().catch(() => ({ campaigns: [] }))
    ])
      .then(([clipsData, usersData, campaignsData]) => {
        // Create lookup maps
        const userMap = {}
        ;(usersData.users || []).forEach(u => {
          userMap[u.userId] = u.name
        })

        const campaignMap = {}
        ;(campaignsData.campaigns || []).forEach(c => {
          campaignMap[c.campaignId] = c.title
        })

        // Map clips with creator names and campaign titles
        const mappedClips = (clipsData.clips || []).map(c => ({
          id: c.clipId || c._id,
          campaignId: c.campaignId,
          campaign: campaignMap[c.campaignId] || 'Unknown Campaign',
          creatorId: c.creatorId,
          creator: userMap[c.creatorId] || 'Unknown Creator',
          clipLink: c.clipLink || '',
          views: Number.isFinite(Number(c.views))
            ? Number(c.views)
            : Number.isFinite(Number(c.youtubeViewCount))
              ? Number(c.youtubeViewCount)
              : Number.isFinite(Number(c.instagramVideoPlayCount))
                ? Number(c.instagramVideoPlayCount)
                : 0,
          thumbnailUrl: c.youtubeThumbnailUrl || c.instagramThumbnailUrl || null,
          earnings: c.earnings || 0,
          date: new Date(c.submittedAt || c.createdAt).toLocaleDateString('en-CA'),
          status: c.status === 'pending' ? 'Pending' : c.status === 'approved' ? 'Approved' : c.status === 'flagged' ? 'Flagged' : c.status,
        }))

        setClips(mappedClips)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const updateClipStatus = async (id, newStatus) => {
    const backendStatus = newStatus.toLowerCase()
    try {
      await clipsAPI.updateStatus(id, backendStatus)
      setClips(prev => prev.map(c => c.id === id ? { ...c, status: newStatus.charAt(0).toUpperCase() + newStatus.slice(1) } : c))
    } catch (err) {
      console.error('Failed to update clip status:', err)
      alert(err.message || 'Failed to update clip status')
    }
  }

  const pendingClips = clips.filter(c => c.status === 'Pending')
  const flaggedClips = clips.filter(c => c.status === 'Flagged')
  const approvedClips = clips.filter(c => c.status === 'Approved')

  const displayClips = tab === 'pending' ? pendingClips : tab === 'flagged' ? flaggedClips : approvedClips

  const statusKey = (s) => s.toLowerCase()

  return (
    <AdminLayout title="Reports & Monitoring">
      <div className="admin-stats" style={{ marginBottom: 24 }}>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Total Clips</span>
          <span className="admin-stat-value">{clips.length}</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Pending Review</span>
          <span className="admin-stat-value" style={{ color: '#f59e0b' }}>{pendingClips.length}</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Flagged</span>
          <span className="admin-stat-value" style={{ color: '#ef4444' }}>{flaggedClips.length}</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Approved</span>
          <span className="admin-stat-value" style={{ color: '#10b981' }}>{approvedClips.length}</span>
        </div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          Pending Review ({pendingClips.length})
        </button>
        <button className={`admin-tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged ({flaggedClips.length})
        </button>
        <button className={`admin-tab ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}>
          Approved ({approvedClips.length})
        </button>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              {tab === 'pending' ? 'Clips Pending Review' : tab === 'flagged' ? 'Flagged Clips' : 'Approved Clips'}
            </h2>
            <p className="admin-card-desc">
              {tab === 'pending' ? 'Review and approve or flag submitted clips' : tab === 'flagged' ? 'Review flagged content and take action' : 'All approved clips'}
            </p>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9aa3ae' }}>Loading clips...</div>
        ) : displayClips.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9aa3ae' }}>
            {tab === 'pending' ? 'No clips pending review' : tab === 'flagged' ? 'No flagged clips' : 'No approved clips yet'}
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Thumbnail</th>
                <th>Creator</th>
                <th>Campaign</th>
                <th>Clip Link</th>
                <th>Views</th>
                <th>Earnings</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayClips.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.thumbnailUrl ? (
                      <img src={c.thumbnailUrl} alt="clip thumbnail" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: '#9aa3ae', fontSize: '0.85rem' }}>No image</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.creator}</td>
                  <td style={{ fontSize: '0.9rem', color: '#6b7685' }}>{c.campaign}</td>
                  <td>
                    <a href={c.clipLink} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', fontSize: '0.85rem', textDecoration: 'none' }}>
                      View Clip ↗
                    </a>
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.views.toLocaleString()}</td>
                  <td style={{ fontWeight: 600, color: '#10b981' }}>${c.earnings.toFixed(2)}</td>
                  <td style={{ color: '#9aa3ae' }}>{c.date}</td>
                  <td><span className={`status-badge status-${statusKey(c.status)}`}>{c.status}</span></td>
                  <td>
                    <div className="admin-actions-cell">
                      {c.status === 'Pending' && (
                        <>
                          <button className="admin-action-btn success" onClick={() => updateClipStatus(c.id, 'approved')}>Approve</button>
                          <button className="admin-action-btn danger" onClick={() => updateClipStatus(c.id, 'flagged')}>Flag</button>
                        </>
                      )}
                      {c.status === 'Flagged' && (
                        <>
                          <button className="admin-action-btn success" onClick={() => updateClipStatus(c.id, 'approved')}>Approve</button>
                          <button className="admin-action-btn" onClick={() => updateClipStatus(c.id, 'pending')}>Reset</button>
                        </>
                      )}
                      {c.status === 'Approved' && (
                        <button className="admin-action-btn danger" onClick={() => updateClipStatus(c.id, 'flagged')}>Flag</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  )
}

export default AdminReports
