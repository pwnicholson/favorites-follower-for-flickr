// Favorites feed logic: fetch aggregated favorites, sort, paginate, and render
(function(){
  const PER_PAGE = 50;
  let photos = [];
  let currentPage = 1;
  let totalPages = 1;
  const feedEl = document.getElementById('feed');
  const pageLabel = document.getElementById('pageLabel');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const authBanner = document.getElementById('authBanner');
  const authBtn = document.getElementById('authBtn');
  const manageBtn = document.getElementById('manageFollowing');
  const modal = document.getElementById('modal');
  const followingList = document.getElementById('followingList');
  const sizeSelect = document.getElementById('sizeSelect');
  const themeSelect = document.getElementById('themeSelect');
  const sortSelect = document.getElementById('sortSelect');
  const root = document.documentElement;
  let displaySize = sizeSelect.value;
  let theme = themeSelect.value;
  let sortBy = sortSelect.value;

  async function getAuthStatus(){
    const resp = await new Promise(r=>chrome.runtime.sendMessage({action:'getAuthStatus'}, r));
    return resp && resp.authorized;
  }

  async function ensureUI(){
    const oauthToken = await new Promise(resolve=>{
      chrome.storage.sync.get(['oauth_token'], items=>resolve(items.oauth_token));
    });
    const authorized = !!oauthToken;
    if(!authBanner){
      console.error('Authorization banner element #authBanner was not found');
      return;
    }
    if(authorized){
      authBanner.style.display = 'none';
      authBanner.classList.add('hidden');
      console.assert(authBanner.style.display === 'none', 'Authorization banner display was not set to none');
      console.assert(authBanner.classList.contains('hidden'), 'Authorization banner hidden class was not added');
    }else{
      authBanner.classList.remove('hidden');
      authBanner.style.display = '';
    }
  }

  authBtn && authBtn.addEventListener('click', async ()=>{
    const res = await new Promise(r=>chrome.runtime.sendMessage({action:'startAuth'}, r));
    if(res && res.success) { showToast('Authorization successful'); await ensureUI(); }
    else showToast(res && res.error ? res.error : 'Authorization failed');
  });

  chrome.storage.onChanged.addListener((changes, areaName)=>{
    if(areaName === 'sync' && changes.oauth_token) ensureUI();
  });

  function showToast(msg){
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:12px;bottom:12px;background:#222;color:#fff;padding:8px;border-radius:6px';
    document.body.appendChild(t);
    setTimeout(()=>t.remove(),2500);
  }

  function showDebugStatus(){
    chrome.storage.sync.get(['debug_status'], items=>{
      if(items.debug_status) showToast(items.debug_status);
    });
  }

  function applyPreferences(){
    feedEl.dataset.size = displaySize;
    if(theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = theme;
    sizeSelect.value = displaySize;
    themeSelect.value = theme;
    sortSelect.value = sortBy;
  }

  function savePreferences(){
    chrome.storage.sync.set({preferences:{size:displaySize, theme, sortBy}});
  }

  sizeSelect.addEventListener('change', ()=>{
    displaySize = sizeSelect.value;
    applyPreferences();
    savePreferences();
    renderPage();
  });
  themeSelect.addEventListener('change', ()=>{
    theme = themeSelect.value;
    applyPreferences();
    savePreferences();
  });
  sortSelect.addEventListener('change', ()=>{
    sortBy = sortSelect.value;
    applyPreferences();
    savePreferences();
    applySort(sortBy);
    renderPage();
  });

  function fetchFavoritesForUser(user){
    return new Promise((resolve, reject)=>{
      chrome.runtime.sendMessage({action:'fetchAggregatedFavorites', users:[user], per_user:200}, response=>{
        if(chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else if(!response || response.error) reject(new Error(response && response.error || 'Could not fetch favorites'));
        else if(response.errors && response.errors.length) reject(new Error(response.errors.join('; ')));
        else resolve(response.photos || []);
      });
    });
  }

  async function loadAndRender(){
    feedEl.innerHTML = '<div>Loading...</div>';
    chrome.storage.sync.get(['followed_users','preferences'], async items=>{
      const users = items.followed_users || [];
      const prefs = items.preferences || {};
      displaySize = prefs.size || displaySize;
      theme = prefs.theme || theme;
      sortBy = prefs.sortBy || sortBy;
      applyPreferences();
      const results = await Promise.allSettled(users.map(fetchFavoritesForUser));
      const allPhotos = results.flatMap(result=>result.status === 'fulfilled' ? result.value : []);
      const photoMap = new Map();
      allPhotos.forEach(photo=>{ if(photo && photo.id) photoMap.set(photo.id, photo); });
      photos = Array.from(photoMap.values());
      const failedUsers = results.filter(result=>result.status === 'rejected');
      failedUsers.forEach(result=>console.warn('Could not load one followed user:', result.reason));
      if(failedUsers.length) showToast(`Could not load ${failedUsers.length} followed user${failedUsers.length === 1 ? '' : 's'}`);
      applySort(sortBy);
      currentPage = 1;
      renderPage();
    });
  }

  function applySort(sortBy){
    if(sortBy === 'uploaded') photos.sort((a,b)=> (b.dateupload||0) - (a.dateupload||0));
    else if(sortBy === 'taken') photos.sort((a,b)=> new Date(b.datetaken).getTime() - new Date(a.datetaken).getTime());
    else photos.sort((a,b)=> (b.date_faved||0) - (a.date_faved||0));
  }

  function renderPage(){
    feedEl.innerHTML = '';
    totalPages = Math.max(1, Math.ceil(photos.length / PER_PAGE));
    const start = (currentPage-1)*PER_PAGE;
    photos.slice(start, start+PER_PAGE).forEach(p=>{
      const card = document.createElement('div'); card.className='card';
      const img = document.createElement('img'); img.src = p.url_m || p.url_l || p.url_sq || '';
      const title = document.createElement('div'); title.textContent = p.title || '';
      card.appendChild(img); card.appendChild(title); feedEl.appendChild(card);
    });
    pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  prevBtn.addEventListener('click', ()=>{ if(currentPage>1){currentPage--; renderPage();} });
  nextBtn.addEventListener('click', ()=>{ if(currentPage<totalPages){currentPage++; renderPage();} });
  manageBtn.addEventListener('click', ()=>{
    modal.classList.remove('hidden');
    chrome.storage.sync.get(['followed_users'], items=>{
      const users = items.followed_users || [];
      followingList.innerHTML = '';
      users.forEach(u=>{
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0';
        const left = document.createElement('div'); left.textContent = u.realname || u.username;
        const btn = document.createElement('button'); btn.textContent = 'Unfollow';
        btn.addEventListener('click', ()=>{
          const next = users.filter(x=>x.nsid!==u.nsid && x.username!==u.username);
          chrome.storage.sync.set({followed_users: next}, ()=>{ loadAndRender(); modal.classList.add('hidden'); });
        });
        row.appendChild(left); row.appendChild(btn); followingList.appendChild(row);
      });
    });
  });
  document.getElementById('closeModal').addEventListener('click', ()=>modal.classList.add('hidden'));
  showDebugStatus();
  ensureUI();
  loadAndRender();
})();