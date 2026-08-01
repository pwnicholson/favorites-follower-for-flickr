// Background service worker: OAuth1.0a helpers, Flickr API calls, message handlers
(async function(){
  // util helpers
  function pctEnc(s){
    return encodeURIComponent(s).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase());
  }

  function genNonce(len=32){
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out='';
    for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
    return out;
  }

  async function hmacSha1(key, msg){
    const enc = new TextEncoder();
    const keyData = enc.encode(key);
    const algo = {name: 'HMAC', hash: 'SHA-1'};
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, algo, false, ['sign']);
    const sig = await crypto.subtle.sign(algo.name, cryptoKey, enc.encode(msg));
    const bytes = new Uint8Array(sig);
    let binary = '';
    for (let i=0;i<bytes.byteLength;i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function loadConfig(){
    try{
      const res = await fetch(chrome.runtime.getURL('config.js'));
      const txt = await res.text();
      // evaluate to get CONFIG
      const fn = new Function(txt + '\nreturn CONFIG;');
      const cfg = fn();
      return cfg || {FLICKR_API_KEY:'',FLICKR_API_SECRET:''};
    }catch(e){
      return {FLICKR_API_KEY:'',FLICKR_API_SECRET:''};
    }
  }

  async function getApiKeys(){
    const cfg = await loadConfig();
    return new Promise(resolve => {
      chrome.storage.sync.get(['api_key','api_secret'], items => {
        resolve({
          key: (cfg.FLICKR_API_KEY && cfg.FLICKR_API_KEY.length)?cfg.FLICKR_API_KEY:(items.api_key||''),
          secret: (cfg.FLICKR_API_SECRET && cfg.FLICKR_API_SECRET.length)?cfg.FLICKR_API_SECRET:(items.api_secret||'')
        });
      });
    });
  }

  function normalizeParams(obj){
    const s = [];
    Object.keys(obj).sort().forEach(k=>{
      s.push(pctEnc(k) + '=' + pctEnc(obj[k]));
    });
    return s.join('&');
  }

  async function oauthSign(method, url, params, consumerSecret, tokenSecret=''){
    const baseParams = normalizeParams(params);
    const baseString = [method.toUpperCase(), pctEnc(url), pctEnc(baseParams)].join('&');
    const signingKey = pctEnc(consumerSecret) + '&' + (tokenSecret?pctEnc(tokenSecret):'');
    const signature = await hmacSha1(signingKey, baseString);
    return signature;
  }

  async function buildAuthHeader(params){
    const header = 'OAuth ' + Object.keys(params).sort().map(k=>`${pctEnc(k)}="${pctEnc(params[k])}"`).join(', ');
    return header;
  }

  async function getRequestToken(){
    const {key, secret} = await getApiKeys();
    if(!key || !secret) throw new Error('API key/secret missing');
    const requestUrl = 'https://www.flickr.com/services/oauth/request_token';
    const oauth = {
      oauth_consumer_key: key,
      oauth_nonce: genNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now()/1000).toString(),
      oauth_version: '1.0',
      oauth_callback: chrome.identity.getRedirectURL()
    };
    const sig = await oauthSign('POST', requestUrl, oauth, secret);
    oauth.oauth_signature = sig;
    const headers = { 'Authorization': await buildAuthHeader(oauth) };
    const resp = await fetch(requestUrl, {method:'POST', headers});
    const text = await resp.text();
    const parsed = Object.fromEntries(text.split('&').map(p=>p.split('=')));
    return parsed; // oauth_token, oauth_token_secret, ...
  }

  async function launchAuth(){
    const req = await getRequestToken();
    if(!req.oauth_token) throw new Error('Failed to get request token');
    const authUrl = `https://www.flickr.com/services/oauth/authorize?oauth_token=${req.oauth_token}&perms=read`;
    return new Promise((resolve,reject)=>{
      chrome.identity.launchWebAuthFlow({url: authUrl, interactive: true}, async redirectUrl => {
        if(chrome.runtime.lastError || !redirectUrl) return reject(chrome.runtime.lastError || new Error('Auth cancelled'));
        const u = new URL(redirectUrl);
        const oauth_token = u.searchParams.get('oauth_token');
        const oauth_verifier = u.searchParams.get('oauth_verifier');
        try{
          const tokens = await getAccessToken(oauth_token, oauth_verifier);
          chrome.storage.sync.set({oauth_token: tokens.oauth_token, oauth_token_secret: tokens.oauth_token_secret}, ()=>resolve(tokens));
        }catch(e){reject(e)}
      });
    });
  }

  async function getAccessToken(oauth_token, oauth_verifier){
    const {key, secret} = await getApiKeys();
    const url = 'https://www.flickr.com/services/oauth/access_token';
    const oauth = {
      oauth_consumer_key: key,
      oauth_nonce: genNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now()/1000).toString(),
      oauth_version: '1.0',
      oauth_token: oauth_token,
      oauth_verifier: oauth_verifier
    };
    const sig = await oauthSign('POST', url, oauth, secret);
    oauth.oauth_signature = sig;
    const headers = { 'Authorization': await buildAuthHeader(oauth) };
    const resp = await fetch(url, {method:'POST', headers});
    const text = await resp.text();
    const parsed = Object.fromEntries(text.split('&').map(p=>p.split('=')));
    return parsed; // oauth_token, oauth_token_secret, user_nsid, username, fullname
  }

  async function signedFlickrCall(method, params={}, useAuth=true){
    const {key, secret} = await getApiKeys();
    if(!key) throw new Error('API key missing');
    const baseUrl = 'https://api.flickr.com/services/rest';
    const common = {
      method,
      format: 'json',
      nojsoncallback: '1',
      api_key: key,
      ...params
    };
    // read token from storage
    const items = await new Promise(r=>chrome.storage.sync.get(['oauth_token','oauth_token_secret'], r));
    let oauth = null;
    if(useAuth && items.oauth_token && items.oauth_token_secret){
      oauth = {
        oauth_consumer_key: key,
        oauth_nonce: genNonce(),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now()/1000).toString(),
        oauth_version: '1.0',
        oauth_token: items.oauth_token
      };
    }
    if(oauth){
      // sign oauth with all parameters (common + oauth)
      const all = {...common, ...oauth};
      const sig = await oauthSign('GET', baseUrl, all, secret, items.oauth_token_secret);
      oauth.oauth_signature = sig;
      const authHeader = await buildAuthHeader(oauth);
      const url = baseUrl + '?' + Object.keys(common).map(k=>`${pctEnc(k)}=${pctEnc(common[k])}`).join('&');
      const resp = await fetch(url, {method:'GET', headers:{Authorization: authHeader}});
      return resp.json();
    }else{
      // unsigned call with api_key only
      const url = baseUrl + '?' + Object.keys(common).map(k=>`${pctEnc(k)}=${pctEnc(common[k])}`).join('&');
      const resp = await fetch(url);
      return resp.json();
    }
  }

  // resolve username -> nsid
  async function resolveUsername(username){
    const res = await signedFlickrCall('flickr.people.findByUsername',{username});
    if(res && res.user && res.user.nsid) return res.user.nsid;
    throw new Error('Could not resolve username');
  }

  // fetch favorites for a single user (first page up to per_page)
  async function fetchFavoritesForUser(nsid, per_page=500, safeSearch='all'){
    const extras = 'date_upload,date_taken,url_sq,url_m,url_l,owner_name,icon_server,date_faved';
    const safe_map = {all:'1',safe:'1'}; // placeholder; Flickr uses safe_search param on search not favorites API
    const params = {user_id: nsid, per_page: per_page.toString(), extras};
    const res = await signedFlickrCall('flickr.favorites.getPublicList', params, false);
    if(res && res.photos && res.photos.photo) return res.photos.photo;
    return [];
  }

  // message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async ()=>{
      try{
        if(msg.action === 'startAuth'){
          const tokens = await launchAuth();
          sendResponse({success:true, tokens});
        }else if(msg.action === 'resolveUsername'){
          const nsid = await resolveUsername(msg.username);
          sendResponse({nsid});
        }else if(msg.action === 'fetchAggregatedFavorites'){
          const users = msg.users || [];
          const per_user = msg.per_user || 200;
          const all = [];
          for(const u of users){
            try{
              const photos = await fetchFavoritesForUser(u.nsid, per_user);
              photos.forEach(p=>{
                p._from_nsid = u.nsid;
                all.push(p);
              });
            }catch(e){/* ignore per-user failures */}
          }
          // dedupe by id
          const map = new Map();
          for(const p of all) map.set(p.id, p);
          const dedup = Array.from(map.values());
          sendResponse({photos: dedup});
        }else if(msg.action === 'getAuthStatus'){
          chrome.storage.sync.get(['oauth_token'], items => sendResponse({authorized: !!items.oauth_token}));
          return;
        }else if(msg.action === 'clearTokens'){
          chrome.storage.sync.remove(['oauth_token','oauth_token_secret'], ()=>sendResponse({cleared:true}));
          return;
        }else{
          sendResponse({error:'unknown action'});
        }
      }catch(err){
        sendResponse({error:err.message});
      }
    })();
    return true; // keep channel open
  });

})();
