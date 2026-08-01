// Content script: Inject "Follow Favorites" button on Flickr photo/profile pages
(function(){
  function waitFor(selector, timeout=5000){
    return new Promise((resolve,reject)=>{
      const start = Date.now();
      const iv = setInterval(()=>{
        const el = document.querySelector(selector);
        if(el){ clearInterval(iv); resolve(el); }
        if(Date.now()-start>timeout){ clearInterval(iv); reject(new Error('timeout')); }
      }, 300);
    });
  }

  async function getProfileUsername(){
    // try meta or link patterns
    const el = document.querySelector('a.owner-name, a.title, a[href*="/photos/"]');
    if(el) {
      const href = el.getAttribute('href');
      if(href){
        const m = href.match(/\/photos\/([^\/]+)/);
        if(m) return m[1];
      }
      return el.textContent.trim();
    }
    // fallback to global username var
    if(window._model && window._model.person && window._model.person.username) return window._model.person.username._content;
    return null;
  }

  async function ensureButton(){
    try{
      const followContainer = await waitFor('button.follow, .follow-bundle, .profile-follow');
      // create our button
      if(document.getElementById('ff-follow-favs-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'ff-follow-favs-btn';
      btn.style.marginLeft = '8px';
      btn.textContent = 'Follow Favorites';
      btn.className = 'ff-follow-favs';
      followContainer.parentNode.insertBefore(btn, followContainer.nextSibling);

      let username = await getProfileUsername();
      if(!username) username = '';

      async function refreshState(){
        chrome.storage.sync.get(['followed_users'], items=>{
          const list = items.followed_users || [];
          const found = list.find(u=>u.username === username);
          if(found) btn.textContent = 'Unfollow Favorites'; else btn.textContent = 'Follow Favorites';
        });
      }

      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        chrome.storage.sync.get(['followed_users'], async items=>{
          const list = items.followed_users || [];
          const found = list.find(u=>u.username === username);
          if(found){
            const next = list.filter(u=>u.username !== username);
            chrome.storage.sync.set({followed_users: next}, ()=>{ btn.disabled=false; refreshState(); });
          }else{
            // resolve username -> nsid via background
            const resp = await new Promise(r=>chrome.runtime.sendMessage({action:'resolveUsername', username}, r));
            if(resp && resp.nsid){
              list.push({nsid: resp.nsid, username, realname: username});
              chrome.storage.sync.set({followed_users: list}, ()=>{ btn.disabled=false; refreshState(); });
            }else{
              btn.disabled=false; refreshState();
            }
          }
        });
      });

      refreshState();
      // react to external changes
      chrome.storage.onChanged.addListener(changes=>{ if(changes.followed_users) refreshState(); });
    }catch(e){ /* ignore */ }
  }

  // kick off
  ensureButton();
  // also try again on navigation
  document.addEventListener('pjax:end', ensureButton, true);
})();
