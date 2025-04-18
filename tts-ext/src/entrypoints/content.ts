export default defineContentScript({
  matches: ['*://*.google.com/*', '*://google.com/*'],
  main() {
    console.log('Hello content.');
    const banner = document.createElement('div');
    banner.textContent = '🟢 Hello content script is active!';
    Object.assign(banner.style, {
      position: 'fixed', bottom: '10px', right: '10px',
      backgroundColor: 'rgba(0,128,0,0.9)', color: 'white',
      padding: '6px 10px', borderRadius: '4px', zIndex: '999999'
    });
    document.body.appendChild(banner);
  },
});
