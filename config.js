// Optional default keys. If empty, extension will use values from chrome.storage.sync
const CONFIG = {
  FLICKR_API_KEY: "",
  FLICKR_API_SECRET: ""
};

// keep file simple and static so it can be loaded by the service worker via fetch
// Local Configuration for API Credentials
// Keep this file in .gitignore for public repos.
// Build step for Web Store compilation will populate these fields directly.
const CONFIG = {
  FLICKR_API_KEY: "",
  FLICKR_API_SECRET: ""
};

export default CONFIG;
