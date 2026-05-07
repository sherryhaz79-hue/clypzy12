import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { campaignsAPI, clipsAPI, usersAPI, paymentsAPI } from '../services/api'
import { useAuth } from './AuthContext'

const CampaignContext = createContext(null)

// Map backend campaign to frontend shape
// function mapCampaign(c) {
//   return {
//     id: c.campaignId || c._id,
//     name: c.title,
//     avatar: null,
//     time: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
//     type: 'Per view',
//     title: c.title,
//     socials: (c.platforms || ['Instagram', 'TikTok', 'YouTube', 'X']).map(p => p),
//     pay: `$${c.CPM ? (c.CPM * 1000).toFixed(0) : '0'}`,
//     cpm: c.CPM || 0,
//     budget: c.deposit || 0,
//     endsIn: c.status === 'completed' ? 'Ended' : 'Active',
//     language: 'English',
//     platforms: c.platforms || ['Instagram', 'TikTok', 'YouTube', 'X'],
//     description: c.description || '',
//     rules: c.rules || '',
//     minViews: c.minViewsForPayout || 0,
//     goalViews: c.goalViews || 0,
//     status: c.status === 'live' ? 'Active' : c.status === 'pending' ? 'Pending' : c.status === 'completed' ? 'Completed' : c.status,
//     paidOutPercent: 0,
//     sourceVideos: c.sourceVideos || [],
//     brandId: c.brandId,
//     createdAt: c.createdAt,
//   }
// }

function mapCampaign(c, userRole) {
  return {
    id: c.campaignId || c._id,
    name: c.title,
    avatar: null,
    time: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
    type: 'Per view',
    title: c.title,
    socials: (c.platforms || ['Instagram', 'TikTok', 'YouTube', 'X']).map(p => p),
    pay: `$${c.CPM ? (c.CPM * 1000).toFixed(0) : '0'}`,
    cpm: c.CPM || 0,
    budget: userRole === 'creator'
      ? (Number.isFinite(Number(c.availableBudget)) ? Number(c.availableBudget) : (c.deposit || 0))
      : (c.deposit || 0),
    totalBudget: c.deposit || 0,
    endsIn: c.status === 'completed' ? 'Ended' : 'Active',
    language: 'English',
    platforms: c.platforms || ['Instagram', 'TikTok', 'YouTube', 'X'],
    description: c.description || '',
    rules: c.rules || '',
    minViews: c.minViewsForPayout || 0,
    goalViews: c.goalViews || 0,
    status: c.status === 'live' ? 'Active' : c.status === 'pending' ? 'Pending' : c.status === 'completed' ? 'Completed' : c.status,
    paidOutPercent: 0,
    sourceVideos: c.sourceVideos || [],
    brandId: c.brandId,
    brandLogo: c.brandLogo || null,               // ✅ always public
    currency: userRole === 'admin' ? c.currency : undefined, // only admin can see
    createdAt: c.createdAt,
  }
}


// Map backend clip to frontend shape
// function mapClip(c) {
//   return {
//     id: c.clipId || c._id,
//     campaignId: c.campaignId,
//     link: c.clipLink,
//     platform: detectPlatform(c.clipLink || ''),
//     submittedAt: new Date(c.submittedAt || c.createdAt).getTime(),
//     views: c.views || 0,
//     earnings: c.earnings || 0,
//     status: c.status === 'approved' ? 'approved' : c.status === 'flagged' ? 'rejected' : 'pending',
//   }
// }
//mapclip to show creator description
function mapClip(c) {
  const resolvedViews = Number.isFinite(Number(c.views))
    ? Number(c.views)
    : Number.isFinite(Number(c.youtubeViewCount))
      ? Number(c.youtubeViewCount)
      : Number.isFinite(Number(c.instagramVideoPlayCount))
        ? Number(c.instagramVideoPlayCount)
        : 0

  return {
    id: c.clipId || c._id,
    campaignId: c.campaignId,
    link: c.clipLink,
    creatorMessage: c.creatorMessage || '',
    platform: detectPlatform(c.clipLink || ''),
    submittedAt: new Date(c.submittedAt || c.createdAt).getTime(),
    views: resolvedViews,
    thumbnailUrl: c.youtubeThumbnailUrl || c.instagramThumbnailUrl || null,
    instagramVideoPlayCount: Number.isFinite(Number(c.instagramVideoPlayCount)) ? Number(c.instagramVideoPlayCount) : null,
    youtubeViewCount: Number.isFinite(Number(c.youtubeViewCount)) ? Number(c.youtubeViewCount) : null,
    earnings: c.earnings || 0,
    status: c.status === 'approved' ? 'approved' : c.status === 'flagged' ? 'rejected' : 'pending',
  }
}


function detectPlatform(link) {
  if (link.includes('instagram')) return 'Instagram'
  if (link.includes('tiktok')) return 'TikTok'
  if (link.includes('youtube') || link.includes('youtu.be')) return 'YouTube'
  if (link.includes('x.com') || link.includes('twitter')) return 'X'
  return 'Other'
}

export function CampaignProvider({ children }) {
  const { user } = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [clips, setClips] = useState([])
  const [wallet, setWallet] = useState({ available: 0, pending: 0, paidOut: 0, lifetime: 0 })
  const [payouts, setPayouts] = useState([])
  const [joinedCampaigns, setJoinedCampaigns] = useState(() => {
    try { const s = localStorage.getItem('diro_joined'); return s ? JSON.parse(s) : [] }
    catch { return [] }
  })

  // Persist client-side UX state
  useEffect(() => { localStorage.setItem('diro_joined', JSON.stringify(joinedCampaigns)) }, [joinedCampaigns])

  // Load campaigns from API
  useEffect(() => {
    if (!user) return
    // campaignsAPI.list()
    //   .then((data) => {
    //     const mapped = (data.campaigns || []).map(mapCampaign)
    //     setCampaigns(mapped)
    //   })
    //   .catch(() => {})
    campaignsAPI.list()
      .then((data) => {
        const mapped = (data.campaigns || []).map(c => mapCampaign(c, user?.role))
        setCampaigns(mapped)
      })
      .catch(() => { })

  }, [user])

  // Load clips from API
  useEffect(() => {
    if (!user) return
    clipsAPI.list()
      .then((data) => {
        const mapped = (data.clips || []).map(mapClip)
        setClips(mapped)
      })
      .catch(() => {})
  }, [user])

  // Load wallet from API
  useEffect(() => {
    if (!user || user.role === 'admin') return
    usersAPI.getWallet()
      .then((data) => {
        const w = data.wallet || {}
        setWallet({
          available: w.withdrawableBalance || 0,
          pending: w.pendingBalance || 0,
          paidOut: w.withdrawableBalance !== undefined ? (w.availableBalance || 0) - (w.withdrawableBalance || 0) : 0,
          lifetime: (w.availableBalance || 0) + (w.pendingBalance || 0),
        })
      })
      .catch(() => {})
  }, [user])

  // Load payouts from API (for paidout tab)
  useEffect(() => {
    if (!user || user.role === 'admin') return
    paymentsAPI.list({ type: 'payout' })
      .then((data) => {
        setPayouts((data.payments || []).map(p => ({
          id: p.paymentId || p._id,
          amount: p.amount || 0,
          status: p.status,
          date: new Date(p.createdAt).getTime(),
          campaignId: p.campaignId,
        })))
      })
      .catch(() => {})
  }, [user])

  // ===== Actions =====
  const joinCampaign = useCallback((id) => {
    setJoinedCampaigns(prev => prev.includes(id) ? prev : [...prev, id])
  }, [])

  const leaveCampaign = useCallback((id) => {
    setJoinedCampaigns(prev => prev.filter(x => x !== id))
  }, [])

  // const submitClip = useCallback(async (campaignId, link) => {
  //   const data = await clipsAPI.submit({ campaignId, clipLink: link })
  //   setClips(prev => [...prev, mapClip(data.clip)])
  // }, [])

  const submitClip = useCallback(async (campaignId, link, creatorMessage) => {
    if (!user || user.role !== 'creator') {
      throw new Error('Only creator accounts can submit reels.')
    }

    const data = await clipsAPI.submit({
      campaignId,
      clipLink: link,
      creatorMessage
    })

    setClips(prev => [...prev, mapClip(data.clip)])
  }, [user])


  const refreshClips = useCallback(async () => {
    try {
      const data = await clipsAPI.list()
      setClips((data.clips || []).map(mapClip))
    } catch {}
  }, [])

  const refreshWallet = useCallback(async () => {
    try {
      const data = await usersAPI.getWallet()
      const w = data.wallet || {}
      setWallet({
        available: w.withdrawableBalance || 0,
        pending: w.pendingBalance || 0,
        paidOut: w.withdrawableBalance !== undefined ? (w.availableBalance || 0) - (w.withdrawableBalance || 0) : 0,
        lifetime: (w.availableBalance || 0) + (w.pendingBalance || 0),
      })
    } catch {}
  }, [])

  const cashOut = useCallback(async (amount) => {
    // Request payout via API
    await paymentsAPI.payout({ amount, method: 'stripe' })
    // Refresh wallet from backend
    await refreshWallet()
  }, [refreshWallet])

  return (
    <CampaignContext.Provider value={{
      campaigns,
      joinedCampaigns,
      clips,
      wallet,
      payouts,
      joinCampaign,
      leaveCampaign,
      submitClip,
      refreshClips,
      refreshWallet,
      cashOut,
    }}>
      {children}
    </CampaignContext.Provider>
  )
}

export function useCampaigns() {
  return useContext(CampaignContext)
}
