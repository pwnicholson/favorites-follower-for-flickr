// New Tab feed logic: fetch aggregated favorites, sort, paginate, and render
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

  async function getAuthStatus(){
    const resp = await new Promise(r=>chrome.runtime.sendMessage({action:'getAuthStatus'}, r));
    return resp && resp.authorized;
  }

  async function ensureUI(){
    const authorized = await getAuthStatus();
    if(!authorized) authBanner.classList.remove('hidden'); else authBanner.classList.add('hidden');
  }

  authBtn && authBtn.addEventListener('click', async ()=>{
    const res = await new Promise(r=>chrome.runtime.sendMessage({action:'startAuth'}, r));
    if(res && res.success) {
      showToast('Authorization successful');
      ensureUI();
    }else{
      showToast('Authorization failed');
    }
  });

  function showToast(msg){
    const t = document.createElement('div'); t.textContent = msg; t.style.position='fixed'; t.style.right='12px'; t.style.bottom='12px'; t.style.background='#222'; t.style.color='#fff'; t.style.padding='8px'; t.style.borderRadius='6px'; document.body.appendChild(t);
    setTimeout(()=>t.remove(),2500);
  }

  async function loadAndRender(){
    feedEl.innerHTML = '<div>Loading…</div>';
    chrome.storage.sync.get(['followed_users','preferences'], async items=>{
      const users = items.followed_users || [];
      const prefs = items.preferences || {};
      const resp = await new Promise(r=>chrome.runtime.sendMessage({action:'fetchAggregatedFavorites', users, per_user:200}, r));
      photos = (resp && resp.photos) || [];
      applySort(prefs.sortBy || 'faved');
      currentPage = 1;
      totalPages = Math.max(1, Math.ceil(photos.length / PER_PAGE));
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
    const pagePhotos = photos.slice(start, start+PER_PAGE);
    pagePhotos.forEach(p=>{
      const card = document.createElement('div'); card.className='card';
      const img = document.createElement('img'); img.src = p.url_m || p.url_l || p.url_sq || '';
      const title = document.createElement('div'); title.textContent = p.title || '';
      card.appendChild(img); card.appendChild(title);
      feedEl.appendChild(card);
    });
    pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  prevBtn.addEventListener('click', ()=>{ if(currentPage>1){currentPage--; renderPage();} });
  nextBtn.addEventListener('click', ()=>{ if(currentPage<totalPages){currentPage++; renderPage();} });

  manageBtn.addEventListener('click', async ()=>{
    modal.classList.remove('hidden');
    chrome.storage.sync.get(['followed_users'], items=>{
      const users = items.followed_users || [];
      followingList.innerHTML = '';
      users.forEach(u=>{
        const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.justifyContent='space-between'; row.style.padding='6px 0';
        const left = document.createElement('div'); left.textContent = (u.realname||u.username);
        const btn = document.createElement('button'); btn.textContent='Unfollow'; btn.addEventListener('click', ()=>{
          const next = users.filter(x=>x.nsid!==u.nsid);
          chrome.storage.sync.set({followed_users: next}, ()=>{ loadAndRender(); modal.classList.add('hidden'); });
        });
        row.appendChild(left); row.appendChild(btn); followingList.appendChild(row);
      });
    });
  });

  document.getElementById('closeModal').addEventListener('click', ()=>modal.classList.add('hidden'));

  // init
  ensureUI();
  loadAndRender();
})();
