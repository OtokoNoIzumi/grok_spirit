// Grok Spirit - Popup Script
console.log('Grok Spirit popup script loaded');

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    initializePopup();
});

function initializePopup() {
    // Get version from manifest
    const manifestData = chrome.runtime.getManifest();
    const version = manifestData.version || '1.0.4';

    // Update version display
    document.getElementById('version-info').textContent = `v${version}`;
    document.getElementById('version-number').textContent = version;
}

// Listen for messages from content script (if needed in future)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Future message handling can be added here
});

// Error handling
window.addEventListener('error', (event) => {
    console.error('Popup script error:', event.error);
});
