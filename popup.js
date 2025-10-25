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
    document.getElementById('version-number').textContent = version;

    // Initialize defense mode toggle
    initializeDefenseModeToggle();

    // Initialize smart content display
    initializeSmartContentDisplay();
}

function initializeSmartContentDisplay() {
    // Hide technical note after user has opened popup 5+ times
    chrome.storage.local.get('popupOpenCount', (data) => {
        const openCount = (data.popupOpenCount || 0) + 1;
        chrome.storage.local.set({ popupOpenCount: openCount });

        if (openCount > 5) {
            const technicalNote = document.getElementById('technical-note');
            if (technicalNote) {
                technicalNote.style.display = 'none';
            }
        }
    });
}

function initializeDefenseModeToggle() {
    const defenseToggle = document.getElementById('defense-mode-toggle');

    // Load current state from storage
    chrome.storage.local.get('isFilenameDefenseEnabled', (data) => {
        defenseToggle.checked = !!data.isFilenameDefenseEnabled;
    });

    // Handle toggle changes
    defenseToggle.addEventListener('change', async () => {
        const isEnabled = defenseToggle.checked;

        try {
            // Save to storage
            await chrome.storage.local.set({ isFilenameDefenseEnabled: isEnabled });

            // Notify background script
            await chrome.runtime.sendMessage({
                action: 'setFilenameDefense',
                enabled: isEnabled
            });
        } catch (error) {
            console.error('[Popup] Failed to update defense mode:', error);
            // Revert checkbox state on error
            defenseToggle.checked = !isEnabled;
        }
    });
}

// Listen for messages from content script (if needed in future)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Future message handling can be added here
});

// Error handling
window.addEventListener('error', (event) => {
    console.error('Popup script error:', event.error);
});
