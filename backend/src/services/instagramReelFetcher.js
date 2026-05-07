const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const INSTAGRAM_GRAPH_ENDPOINT = 'https://www.instagram.com/graphql/query';

const DEFAULT_COOKIES = {
  csrftoken: 'qxCkg1SOfEha3lstZYN8Rm',
  datr: 'w7iUaXzv011Wk5zblavaTM_6',
  dpr: '1.8000000715255737',
  ds_user_id: '53677633120',
  ig_did: '35792142-3753-4B5E-BFEF-32A2F56451B9',
  ig_nrcb: '1',
  mid: 'aZS4wwAEAAFDvJVVJwMiFQ7HZT3y',
  ps_l: '1',
  ps_n: '1',
  rur: '"LDC\\05453677633120\\0541804637046:01fe6135c4bdc84f4d58491d8d3d260116ed9a55d02efc930f5ed3db715a2ba9924eb484"',
  sessionid: '53677633120%3AfHoZn4kh9GaSlw%3A15%3AAYigopy0tpYaC6uvY1YokbQKg0uFw4l64ZH5eH8Pozs',
  wd: '2135x1036'
};

const ensureCookiesDir = (cookiesFile) => {
  const directory = path.dirname(cookiesFile);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const saveCookies = (cookies, cookiesFile) => {
  ensureCookiesDir(cookiesFile);
  fs.writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
};

const loadCookies = (cookiesFile) => {
  try {
    if (fs.existsSync(cookiesFile)) {
      const content = fs.readFileSync(cookiesFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Fall back to default cookies below.
  }

  const defaults = { ...DEFAULT_COOKIES };
  saveCookies(defaults, cookiesFile);
  return defaults;
};

const buildCookieString = (cookies) => Object.entries(cookies)
  .map(([key, value]) => `${key}=${value}`)
  .join('; ');

const syncCookies = (cookies, cookiesFile, setCookieHeaders) => {
  const cookieHeaders = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders].filter(Boolean);
  if (cookieHeaders.length === 0) return;

  let changed = false;
  for (const raw of cookieHeaders) {
    const [pair] = String(raw).split(';');
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    const lowerRaw = String(raw).toLowerCase();
    if (!value || lowerRaw.includes('01-jan-1970') || lowerRaw.includes('max-age=0')) {
      continue;
    }

    if (cookies[key] !== value) {
      cookies[key] = value;
      changed = true;
    }
  }

  if (changed) {
    saveCookies(cookies, cookiesFile);
  }
};

const extractMediaNode = (payload = {}) => (
  payload?.data?.xdt_shortcode_media ||
  payload?.data?.shortcode_media ||
  payload?.graphql?.shortcode_media ||
  payload?.node ||
  null
);

const toFiniteNumberOrNull = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

const getReelInfo = async (shortcode) => {
  if (!shortcode || typeof shortcode !== 'string') {
    throw new Error('Instagram shortcode is required');
  }

  const cookiesFile = config.instagramGraph.cookiesFile;
  const cookies = loadCookies(cookiesFile);

  const response = await axios.get(INSTAGRAM_GRAPH_ENDPOINT, {
    maxBodyLength: Infinity,
    params: {
      variables: JSON.stringify({ shortcode }),
      doc_id: config.instagramGraph.docId,
      server_timestamps: 'true'
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.8',
      Host: 'www.instagram.com',
      Origin: 'https://www.instagram.com/',
      Referer: 'https://www.instagram.com/',
      'X-Instagram-AJAX': '1',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': cookies.csrftoken,
      authority: 'www.instagram.com',
      scheme: 'https',
      Cookie: buildCookieString(cookies)
    },
    timeout: config.instagramGraph.requestTimeoutMs
  });

  syncCookies(cookies, cookiesFile, response.headers['set-cookie']);
  return response.data;
};

const fetchInstagramMetricsByShortcode = async (shortcode) => {
  const payload = await getReelInfo(shortcode);
  const media = extractMediaNode(payload);
  if (!media) {
    throw new Error('Instagram response did not include media node');
  }

  return {
    thumbnailUrl: media.thumbnail_src || media.display_url || null,
    videoPlayCount: toFiniteNumberOrNull(media.video_play_count ?? media.video_view_count)
  };
};

module.exports = {
  fetchInstagramMetricsByShortcode
};
