document.addEventListener('DOMContentLoaded', ()=>{
  const keyEl = document.getElementById('api_key');
  const secretEl = document.getElementById('api_secret');
  const saveBtn = document.getElementById('save');
  const clearBtn = document.getElementById('clearTokens');
  const status = document.getElementById('status');

  chrome.storage.sync.get(['api_key','api_secret','oauth_token'], items=>{
    if(items.api_key) keyEl.value = items.api_key;
    if(items.api_secret) secretEl.value = items.api_secret;
    status.textContent = items.oauth_token? 'Authorized' : 'Not authorized';
  });

  saveBtn.addEventListener('click', ()=>{
    chrome.storage.sync.set({api_key: keyEl.value.trim(), api_secret: secretEl.value.trim()}, ()=>{
      status.textContent = 'Saved';
      setTimeout(()=>status.textContent = '', 2000);
    });
  });

  clearBtn.addEventListener('click', ()=>{
    chrome.runtime.sendMessage({action:'clearTokens'}, resp=>{
      status.textContent = resp && resp.cleared? 'Tokens cleared':'Error';
      setTimeout(()=>status.textContent = '',2000);
    });
  });
});
