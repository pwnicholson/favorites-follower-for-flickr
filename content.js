// Content script: Inject "Follow Favorites" button on Flickr photo/profile pages
(function(){
  let injectedPageKey = '';

  function getProfileUsername(){
    const pathMatch = window.location.pathname.match(/^\/(?:people|photos)\/([^/]+)/);
    if(pathMatch) return decodeURIComponent(pathMatch[1]);

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
    return '';
  }

  function ensureButton(){
    try{
      const followSelector = [
        '.action-button-text.follow',
        '.action-button-text.following',
        '.action-button-text.unfollow',
        'button.follow',
        '.follow-bundle',
        '.profile-follow',
        '.follow-button',
        '.follow-button-container',
        '[data-testid="follow-button"]',
        '[data-testid*="follow"]',
        'button[aria-label*="Follow"]',
        'button[title*="Follow"]'
      ].join(', ');
      const pageKey = `${window.location.pathname}${window.location.search}`;
      const existingButton = document.getElementById('ff-follow-favs-btn');
      if(existingButton && injectedPageKey === pageKey) return;
      if(existingButton) existingButton.remove();
      const existingFeedLink = document.getElementById('ff-favorites-feed-link');
      if(existingFeedLink) existingFeedLink.remove();
      const followText = document.querySelector(followSelector);
      const followContainer = followText && (followText.closest('button, a, [role="button"]') || followText);
      const insertionParent = followContainer && followContainer.parentNode;
      const username = getProfileUsername();
      if(!username){
        console.error('Unable to determine Flickr username from URL:', window.location.pathname);
        return;
      }
      injectedPageKey = pageKey;

      const btn = document.createElement('button');
      btn.id = 'ff-follow-favs-btn';
      btn.type = 'button';
      btn.style.marginLeft = '8px';
      btn.className = 'action-button-text ff-follow-favs';
      if(insertionParent) insertionParent.insertBefore(btn, followContainer.nextSibling);
      else document.body.appendChild(btn);

      const feedLink = document.createElement('a');
      feedLink.href = chrome.runtime.getURL('feed/feed.html');
      feedLink.target = '_blank';
      feedLink.rel = 'noopener noreferrer';
      feedLink.textContent = 'Favorites Feed';
      feedLink.style.marginLeft = '8px';
      feedLink.id = 'ff-favorites-feed-link';
      btn.insertAdjacentElement('afterend', feedLink);

      let followingFavorites = false;

      async function refreshState(){
        chrome.storage.sync.get(['followed_users'], items=>{
          const list = items.followed_users || [];
          followingFavorites = !!list.find(u=>u.username === username || u.nsid === username);
          btn.classList.remove('follow', 'following', 'unfollow');
          btn.classList.add(followingFavorites ? 'following' : 'follow');
          btn.textContent = followingFavorites ? 'Following Favorites' : 'Follow Favorites';
        });
      }

      btn.addEventListener('mouseenter', ()=>{
        if(followingFavorites){
          btn.classList.remove('following');
          btn.classList.add('unfollow');
          btn.textContent = 'Unfollow Favorites';
        }
      });
      btn.addEventListener('mouseleave', ()=>{
        if(followingFavorites){
          btn.classList.remove('unfollow');
          btn.classList.add('following');
          btn.textContent = 'Following Favorites';
        }
      });

      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          const items = await new Promise((resolve, reject)=>{
            chrome.storage.sync.get(['followed_users'], result=>{
              if(chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(result);
            });
          });
          const list = items.followed_users || [];
          const found = list.find(u=>u.username === username || u.nsid === username);
          let next;
          if(found){
            next = list.filter(u=>u.username !== username && u.nsid !== username);
          }else{
            const resp = await new Promise((resolve, reject)=>{
              chrome.runtime.sendMessage({action:'resolveUsername', username}, result=>{
                if(chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result);
              });
            });
            if(!resp || !resp.nsid) throw new Error(resp && resp.error || 'Could not resolve Flickr username to an NSID');
            next = [...list, {nsid: resp.nsid, username, realname: username}];
          }

          await new Promise((resolve, reject)=>{
            chrome.storage.sync.set({followed_users: next}, ()=>{
              if(chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve();
            });
          });
          refreshState();
        }catch(error){
          console.error('Unable to update followed Flickr users:', error);
        }finally{
          btn.disabled = false;
        }
      });

      refreshState();
      // react to external changes
      chrome.storage.onChanged.addListener(changes=>{ if(changes.followed_users) refreshState(); });
    }catch(e){
      console.error('Unable to add Follow Favorites control:', e);
    }
  }

  // kick off
  ensureButton();

  let scheduled = false;
  function scheduleEnsureButton(){
    if(scheduled) return;
    scheduled = true;
    setTimeout(()=>{
      scheduled = false;
      ensureButton();
    }, 0);
  }

  const originalPushState = history.pushState;
  history.pushState = function(){
    const result = originalPushState.apply(this, arguments);
    scheduleEnsureButton();
    return result;
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function(){
    const result = originalReplaceState.apply(this, arguments);
    scheduleEnsureButton();
    return result;
  };
  window.addEventListener('popstate', scheduleEnsureButton);
  document.addEventListener('pjax:end', scheduleEnsureButton, true);

  const observer = new MutationObserver(scheduleEnsureButton);
  observer.observe(document.documentElement, {childList:true, subtree:true});
})();
