// Grok Spirit - Content Script
console.log('Grok Spirit content script loaded');

let currentUrl = window.location.href;
let cachedVideoData = null;
let resultPanel = null;
let isProcessing = false;
let processingStatus = null;
let processingStartTime = null; // Record processing start time
let cachedIconUrl = null; // Cache icon URL

// Field type configuration for different input types
const FIELD_TYPES = {
  // Simple toggle buttons for limited options
  TOGGLE: 'toggle',
  // Dropdown with custom input for complex options
  DROPDOWN: 'dropdown',
  // Regular text input
  TEXT: 'text',
  // Structured dialogue
  DIALOGUE: 'dialogue',
  // Read-only list for objects, positioning, text_elements
  READONLY_LIST: 'readonly_list'
};

// Field configuration mapping
const FIELD_CONFIG = {
  'shot.motion_level': {
    type: FIELD_TYPES.TOGGLE,
    options: ['low', 'medium', 'high']
  },
  'shot.camera_depth': {
    type: FIELD_TYPES.DROPDOWN,
    options: ['medium shot', 'full shot', 'wide shot', 'close-up'],
    customKey: 'custom_camera_depth',
    maxSystemParsed: 5
  },
  'shot.camera_movement': {
    type: FIELD_TYPES.DROPDOWN,
    options: ['static shot', 'pan', 'tilt', 'zoom', 'dolly', 'tracking shot','Crane Shot','Orbit', 'Handheld'],
    customKey: 'custom_camera_movement',
    maxSystemParsed: 5
  },
  'cinematography.lighting': {
    type: FIELD_TYPES.DROPDOWN,
    options: ['natural daylight', 'artificial lighting', 'mixed lighting'],
    customKey: 'custom_lighting',
    maxSystemParsed: 3
  },
  'dialogue': {
    type: FIELD_TYPES.DIALOGUE
  },
  'visual_details.objects': {
    type: FIELD_TYPES.READONLY_LIST
  },
  'visual_details.positioning': {
    type: FIELD_TYPES.READONLY_LIST
  },
  'visual_details.text_elements': {
    type: FIELD_TYPES.READONLY_LIST
  }
};

// Initialize on page load
function initializeWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlugin);
  } else {
    // DOM is already ready, but wait a bit for dynamic content
    setTimeout(initializePlugin, 100);
  }
}

initializeWhenReady();

function initializePlugin() {
  console.log('Initializing Grok Spirit on:', currentUrl);

  // Check if this is a grok.com page
  if (!currentUrl.includes('grok.com/imagine')) {
    return;
  }

  // Check URL cache immediately
  checkUrlCache();

  // Also check cache after a delay in case page is still loading
  setTimeout(() => {
    if (!cachedVideoData) {
      checkUrlCache();
    }
  }, 1000);

  // Monitor URL changes
  monitorUrlChanges();
}

// Get normalized URL for caching (remove query params and hash)
function getNormalizedUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  } catch (e) {
    console.error('Failed to normalize URL:', e);
    return url;
  }
}

// Check if URL has cached video data
function checkUrlCache() {
  const normalizedUrl = getNormalizedUrl(currentUrl);
  const urlKey = `grok_video_${normalizedUrl}`;

  let cached = localStorage.getItem(urlKey);

  if (cached) {
    try {
      cachedVideoData = JSON.parse(cached);
      console.log('Loaded cached video data for URL:', currentUrl, cachedVideoData);
      showResultPanel();
    } catch (e) {
      console.error('Failed to parse cached data:', e);
    }
  }
}

// Monitor URL changes
function monitorUrlChanges() {
  let lastUrl = currentUrl;

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      currentUrl = lastUrl;
      console.log('URL changed to:', currentUrl);

      // Hide current panel
      if (resultPanel) {
        resultPanel.remove();
        resultPanel = null;
      }

      // Check new URL cache
      checkUrlCache();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);

  switch (request.action) {
    case 'videoDetected':
      handleVideoDetected(request.videoInfo);
      sendResponse({ success: true });
      break;
    case 'videoProcessing':
      handleVideoProcessing(request.status);
      sendResponse({ success: true });
      break;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// Handle detected video
function handleVideoDetected(videoInfo) {
  console.log('[DEBUG] handleVideoDetected called with videoInfo:', videoInfo);

  // Extract original prompt from the response
  const originalPrompt = extractOriginalPrompt(videoInfo);
  videoInfo.originalPrompt = originalPrompt;

  // Parse system options from original prompt
  parseSystemOptionsFromPrompt(originalPrompt);

  // Save processing start time to videoInfo
  if (processingStartTime) {
    videoInfo.processingStartTime = processingStartTime.toISOString();
  }

  // Cache the video data
  const normalizedUrl = getNormalizedUrl(currentUrl);
  const urlKey = `grok_video_${normalizedUrl}`;

  localStorage.setItem(urlKey, JSON.stringify(videoInfo));
  cachedVideoData = videoInfo;

  // Update processing status
  processingStatus = 'completed';
  isProcessing = false; // Processing completed, reset state

  // Show or update result panel
  showResultPanel();
}

// Parse system options from original prompt
function parseSystemOptionsFromPrompt(originalPrompt) {
  if (!originalPrompt) return;

  try {
    const promptData = JSON.parse(originalPrompt);

    // Extract values for each field configuration
    Object.keys(FIELD_CONFIG).forEach(path => {
      const config = FIELD_CONFIG[path];
      if (config.customKey && config.type === FIELD_TYPES.DROPDOWN) {
        const currentValue = getNestedValue(promptData, path);
        if (currentValue && typeof currentValue === 'string') {
          // System parsing conditions:
          // 1. Not a preset option
          // 2. Not a user custom option
          // 3. This key doesn't exist in original prompt (system completely independent addition)
          if (!config.options.includes(currentValue) &&
              !isValueInCustomOptions(config.customKey, currentValue) &&
              !isKeyInOriginalPrompt(originalPrompt, path)) {
            saveParsedOptions(config.customKey, currentValue, path);
          }
        }
      }
    });
  } catch (e) {
    // If it's not JSON, it's plain text prompt - all current values are system parsed
    console.log('Original prompt is plain text, treating all current values as system parsed');

    // For plain text prompts, we need to get the current structured data
    if (cachedVideoData && cachedVideoData.videoPrompt) {
      try {
        const currentData = JSON.parse(cachedVideoData.videoPrompt);

        Object.keys(FIELD_CONFIG).forEach(path => {
          const config = FIELD_CONFIG[path];
          if (config.customKey && config.type === FIELD_TYPES.DROPDOWN) {
            const currentValue = getNestedValue(currentData, path);
            if (currentValue && typeof currentValue === 'string') {
              // For plain text prompts, all non-preset values are system parsed
              if (!config.options.includes(currentValue) &&
                  !isValueInCustomOptions(config.customKey, currentValue)) {
                saveParsedOptions(config.customKey, currentValue, path);
              }
            }
          }
        });
      } catch (parseError) {
        console.error('Failed to parse current video prompt:', parseError);
      }
    }
  }
}

// Check if a key exists in the original prompt
function isKeyInOriginalPrompt(originalPrompt, path) {
  try {
    const promptData = JSON.parse(originalPrompt);
    const originalValue = getNestedValue(promptData, path);
    return originalValue !== undefined && originalValue !== null;
  } catch (e) {
    return false;
  }
}

// Check if a value exists in custom options
function isValueInCustomOptions(customKey, value) {
  const customOptions = getCustomOptions(customKey);
  return customOptions.includes(value);
}

// Extract original prompt from video info
function extractOriginalPrompt(videoInfo) {
  // Original prompt is now directly passed from background script
  if (videoInfo.hasOwnProperty('originalPrompt')) {
    const originalPromptRaw = videoInfo.originalPrompt;

    // Safe parse helpers
    const safeParseJson = (val) => {
      if (!val || typeof val !== 'string') return null;
      try { return JSON.parse(val); } catch (e) { return null; }
    };

    // Parse original (may be JSON string or plain text)
    const parsedOriginal = typeof originalPromptRaw === 'object' && originalPromptRaw !== null
      ? originalPromptRaw
      : safeParseJson(originalPromptRaw);

    // Parse generated prompt from progress 100 response
    // Prefer new field generated_prompt; fallback to legacy videoPrompt
    const parsedGenerated = safeParseJson(videoInfo.generated_prompt || videoInfo.videoPrompt);

    const hasStructuredData = !!(parsedOriginal && typeof parsedOriginal === 'object' &&
      (parsedOriginal.shot || parsedOriginal.scene || parsedOriginal.cinematography || parsedOriginal.visual_details));

    if (hasStructuredData) {
      // Case 1 & 2: Structured prompt injection
      try {
        const finalPrompt = parsedGenerated;
        if (!finalPrompt || typeof finalPrompt !== 'object') {
          return parsedOriginal;
        }

        // Deep comparison of objects (ignoring formatting differences)
        const isConsistent = deepEqual(parsedOriginal, finalPrompt);

        if (isConsistent) {
          return "Injection completely consistent";
        } else {
          // Case 2: Partial injection - show original prompt
          return parsedOriginal;
        }
      } catch (e) {
        // If parsing fails, fall back to showing original prompt
        return parsedOriginal || originalPromptRaw;
      }
    } else {
      // Case 3: Plain text prompt - show extracted original prompt
      return originalPromptRaw;
    }
  }

  return null;
}

// Format original prompt for display
function formatOriginalPromptForDisplay(originalPrompt) {
  if (!originalPrompt) return '';

  // If it's a string, return as is (no truncation)
  if (typeof originalPrompt === 'string') {
    return originalPrompt;
  }

  // If it's an object, format it nicely
  if (typeof originalPrompt === 'object') {
    try {
      const formatted = JSON.stringify(originalPrompt, null, 2);
      return formatted;
    } catch (e) {
      return '[Object - formatting failed]';
    }
  }

  return String(originalPrompt);
}

// Deep equality comparison for objects
function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;

  if (obj1 == null || obj2 == null) return obj1 === obj2;

  if (typeof obj1 !== typeof obj2) return false;

  if (typeof obj1 !== 'object') return obj1 === obj2;

  if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

  if (Array.isArray(obj1)) {
    if (obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i])) return false;
    }
    return true;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (let key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }

  return true;
}

// Handle video processing status
function handleVideoProcessing(status) {
  processingStatus = status;

  if (status === 'failed') {
    // Failed status doesn't set isProcessing to true, doesn't record time
  } else {
    isProcessing = true;

    // If starting processing, record start time
    if (status === 'processing' && !processingStartTime) {
      processingStartTime = new Date();
    }
  }

  // Update panel if it exists
  if (resultPanel) {
    updateProcessingStatus(status);
  }
}

// Show result panel
function showResultPanel(retryCount = 0) {
  if (!cachedVideoData) {
    return;
  }

  // Remove existing panel
  if (resultPanel) {
    resultPanel.remove();
    resultPanel = null;
  }

  // Find target container and operation box
  const targetContainer = findTargetContainer();
  const operationBox = findOperationBox(targetContainer);

  if (!targetContainer || !operationBox) {
    // Retry up to 5 times with increasing delay
    if (retryCount < 5) {
      setTimeout(() => {
        showResultPanel(retryCount + 1);
      }, 500 * (retryCount + 1));
    }
    return;
  }

  // Create result panel
  resultPanel = createResultPanel();

  // Insert after the operation box
  operationBox.parentNode.insertBefore(resultPanel, operationBox.nextSibling);

  // Add event listeners
  addPanelEventListeners();
}

// Find the target container (基于video元素)
function findTargetContainer() {
  // 1. 找video元素（视频页面的核心标识）
  const video = document.querySelector('video');
  if (!video) return null;

  // 2. 找到video的父容器（article）
  const container = video.closest('article');
  return container;
}

// Find the operation box (支持传参避免重复查找)
function findOperationBox(targetContainer = null) {
  // 如果没有传入容器，则查找
  if (!targetContainer) {
    const video = document.querySelector('video');
    if (!video) return null;
    targetContainer = video.closest('article');
  }

  // 在容器内找操作区域
  const operationBox = targetContainer.querySelector('.flex.justify-between.gap-5');
  return operationBox;
}

// Create the result panel
function createResultPanel() {
  const panel = document.createElement('div');
  panel.id = 'grok-spirit-result-panel';
  panel.style.cssText = `
    display: block;
    width: 100%;
    margin-top: 4px;
    margin-bottom: 20px;
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 12px;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    clear: both;
    position: relative;
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  panel.innerHTML = createPanelContent();

  return panel;
}

// Create panel content
function createPanelContent() {
  const videoData = cachedVideoData;
  const promptObj = JSON.parse(videoData.videoPrompt);

  // Cache icon URL to avoid reloading
  if (!cachedIconUrl) {
    cachedIconUrl = 'https://otokonoizumi.github.io/grok_spirit.png';
  }

  // Get saved time from videoData, if not available use current processingStartTime or current time
  let displayTime;
  if (videoData.processingStartTime) {
    displayTime = new Date(videoData.processingStartTime).toLocaleTimeString();
  } else if (processingStartTime) {
    displayTime = processingStartTime.toLocaleTimeString();
  } else {
    displayTime = new Date().toLocaleTimeString();
  }

  return `
    <div class="grok-spirit-chat">
      <div class="grok-spirit-message">
        <div class="grok-spirit-header-row">
          <div class="grok-spirit-avatar">
            <img src="${cachedIconUrl}" alt="Izumi" style="width: 32px; height: 32px; border-radius: 50%;">
          </div>
          <div class="grok-spirit-header-info">
            <span class="grok-spirit-name">Izumi the spirit</span>
            <span class="grok-spirit-time">${displayTime}</span>
          </div>
          ${createProcessingStatus()}
        </div>
        <div class="grok-spirit-content">
          <div class="grok-spirit-body">
            <div class="grok-spirit-scrollable">
              ${createHierarchicalParams(promptObj)}
            </div>
            ${createJsonEditor(promptObj)}
          </div>
        </div>
      </div>
    </div>
  `;
}

// Create processing status
function createProcessingStatus() {
  let statusHtml = '';

  if (processingStatus) {
    const statusText = {
      'processing': 'Processing new video...',
      'failed': 'New video processing failed',
      'completed': 'New video processing completed'
    };

    const statusClass = {
      'processing': 'status-processing',
      'failed': 'status-failed',
      'completed': 'status-completed'
    };

    statusHtml = `
      <div class="grok-spirit-status ${statusClass[processingStatus]}">
        ${statusText[processingStatus]}
      </div>
    `;
  }

  // Add download button if we have videoUrl (either from processing or cached data)
  const hasVideoUrl = cachedVideoData && cachedVideoData.videoUrl;
  if (hasVideoUrl) {
    statusHtml += `
      <div class="grok-spirit-download-section">
        <button class="grok-spirit-btn grok-spirit-btn-download-video" title="Download Video & Meta Info">🎬 Download Video & Meta</button>
      </div>
    `;
  }

  return statusHtml;
}

// Create hierarchical parameters display
function createHierarchicalParams(promptObj) {
  const sections = [
    {
      title: 'Basic Info',
      items: [
        { key: 'Video ID', value: cachedVideoData.videoId, path: 'videoId' },
        { key: 'Progress', value: `${cachedVideoData.progress}%`, path: 'progress' },
        ...(shouldShowOriginalPrompt(promptObj) ? [{ key: 'Original Prompt', value: formatOriginalPromptForDisplay(cachedVideoData.originalPrompt), path: 'originalPrompt' }] : [])
      ],
      collapsible: true,
      defaultCollapsed: true  // Basic Info collapsed by default
    },
    {
      title: 'Shot',
      items: [
        { key: 'motion_level', value: promptObj.shot?.motion_level || '', path: 'shot.motion_level' },
        { key: 'camera_depth', value: promptObj.shot?.camera_depth || '', path: 'shot.camera_depth' },
        { key: 'camera_view', value: promptObj.shot?.camera_view || '', path: 'shot.camera_view' },
        { key: 'camera_movement', value: promptObj.shot?.camera_movement || '', path: 'shot.camera_movement' }
      ],
      collapsible: true,
      defaultCollapsed: false  // Others expanded by default
    },
    {
      title: 'Scene',
      items: [
        { key: 'location', value: promptObj.scene?.location || '', path: 'scene.location' },
        { key: 'environment', value: promptObj.scene?.environment || '', path: 'scene.environment' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Cinematography',
      items: [
        { key: 'lighting', value: promptObj.cinematography?.lighting || '', path: 'cinematography.lighting' },
        { key: 'style', value: promptObj.cinematography?.style || '', path: 'cinematography.style' },
        { key: 'texture', value: promptObj.cinematography?.texture || '', path: 'cinematography.texture' },
        { key: 'depth_of_field', value: promptObj.cinematography?.depth_of_field || '', path: 'cinematography.depth_of_field' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Visual Details',
      items: [
        { key: 'objects', value: promptObj.visual_details?.objects || [], path: 'visual_details.objects' },
        { key: 'positioning', value: promptObj.visual_details?.positioning || [], path: 'visual_details.positioning' },
        { key: 'text_elements', value: promptObj.visual_details?.text_elements || [], path: 'visual_details.text_elements' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Motion',
      items: [
        { key: 'motion', value: promptObj.motion || '', path: 'motion' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Audio',
      items: [
        { key: 'music', value: promptObj.audio?.music || '', path: 'audio.music' },
        { key: 'ambient', value: promptObj.audio?.ambient || '', path: 'audio.ambient' },
        { key: 'sound_effect', value: promptObj.audio?.sound_effect || '', path: 'audio.sound_effect' },
        { key: 'mix_level', value: promptObj.audio?.mix_level || '', path: 'audio.mix_level' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Dialogue',
      items: [
        { key: 'dialogue', value: promptObj.dialogue || [], path: 'dialogue' }
      ],
      collapsible: true,
      defaultCollapsed: false
    },
    {
      title: 'Tags',
      items: [
        { key: 'tags', value: Array.isArray(promptObj.tags) ? promptObj.tags.join(', ') : (promptObj.tags || ''), path: 'tags' }
      ],
      collapsible: true,
      defaultCollapsed: false
    }
  ];

  return sections.map(section => `
    <div class="grok-spirit-section">
      <div class="grok-spirit-section-header" data-collapsible="${section.collapsible}">
        <h4 class="grok-spirit-section-title">${section.title}</h4>
        ${section.collapsible ? '<span class="grok-spirit-toggle">' + (section.defaultCollapsed ? '▶' : '▼') + '</span>' : ''}
      </div>
      <div class="grok-spirit-section-content" ${section.collapsible && section.defaultCollapsed ? 'style="display: none;"' : ''}>
        ${section.items.map(item => createFieldInput(item, promptObj)).join('')}
      </div>
    </div>
  `).join('');
}

// Create field input based on configuration
function createFieldInput(item, promptObj) {
  const config = FIELD_CONFIG[item.path];
  const fieldType = config?.type || FIELD_TYPES.TEXT;

  // Special handling for Original Prompt to support HTML content
  if (item.path === 'originalPrompt') {
    return createOriginalPromptInput(item);
  }

  switch (fieldType) {
    case FIELD_TYPES.TOGGLE:
      return createToggleInput(item, config);
    case FIELD_TYPES.DROPDOWN:
      return createDropdownInput(item, config);
    case FIELD_TYPES.DIALOGUE:
      return createDialogueInput(item, promptObj);
    case FIELD_TYPES.READONLY_LIST:
      return createReadonlyListInput(item);
    default:
      return createTextInput(item);
  }
}

// Create original prompt input with HTML support
function createOriginalPromptInput(item) {
  const displayValue = item.value || '';

  return `
    <div class="grok-spirit-pair">
      <label class="grok-spirit-key">${item.key}:</label>
      <div class="grok-spirit-field-container">
        <div class="grok-spirit-original-prompt" data-path="${item.path}">${displayValue}
        </div>
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
      </div>
    </div>
  `;
}

// Create toggle button input
function createToggleInput(item, config) {
  const currentValue = item.value;
  return `
    <div class="grok-spirit-pair">
      <label class="grok-spirit-key">${item.key}:</label>
      <div class="grok-spirit-field-container">
        <div class="grok-spirit-toggle-group" data-path="${item.path}">
          ${config.options.map(option => `
            <button type="button" class="grok-spirit-toggle-btn ${option === currentValue ? 'active' : ''}"
                    data-value="${option}" data-original="${currentValue}">${option}</button>
          `).join('')}
        </div>
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
      </div>
    </div>
  `;
}

// Create dropdown with custom input
function createDropdownInput(item, config) {
  const currentValue = item.value;
  const customOptions = getCustomOptions(config.customKey) || [];

  // Deduplication: merge options and remove duplicates
  const allOptions = [...new Set([...config.options, ...customOptions])];

  // Categorize options
  const presetOptions = config.options;
  const parsedOptions = getParsedOptions(config.customKey) || [];
  const userCustomOptions = customOptions.filter(opt => !presetOptions.includes(opt) && !parsedOptions.includes(opt));

  return `
    <div class="grok-spirit-pair">
      <label class="grok-spirit-key">${item.key}:</label>
      <div class="grok-spirit-field-container">
        <div class="grok-spirit-dropdown-group" data-path="${item.path}" data-custom-key="${config.customKey}">
          <div style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="grok-spirit-clear-custom" title="Clear user custom options" style="display: ${userCustomOptions.length > 0 ? 'inline-block' : 'none'};">🗑️</button>
            <select class="grok-spirit-dropdown" data-original="${currentValue}" style="flex: 1;">
              <option value="">Select or type custom...</option>
              ${presetOptions.length > 0 ? `<optgroup label="Plugin Presets">${presetOptions.map(option => `
                <option value="${option}" ${option === currentValue ? 'selected' : ''} class="preset-option">${option}</option>
              `).join('')}</optgroup>` : ''}
              ${parsedOptions.length > 0 ? `<optgroup label="System Parsed">${parsedOptions.map(option => `
                <option value="${option}" ${option === currentValue ? 'selected' : ''} class="parsed-option">${option}</option>
              `).join('')}</optgroup>` : ''}
              ${userCustomOptions.length > 0 ? `<optgroup label="User Custom">${userCustomOptions.map(option => `
                <option value="${option}" ${option === currentValue ? 'selected' : ''} class="custom-option">${option}</option>
              `).join('')}</optgroup>` : ''}
            </select>
          </div>
          <input type="text" class="grok-spirit-custom-input" value="${currentValue}"
                 placeholder="Or enter custom value..." style="display: ${allOptions.includes(currentValue) ? 'none' : 'block'};" data-original="${currentValue}">
        </div>
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
      </div>
    </div>
  `;
}

// Create dialogue input
function createDialogueInput(item, promptObj) {
  const dialogues = Array.isArray(item.value) ? item.value : [];
  const defaultCharacter = getDefaultCharacter(promptObj);

  return `
    <div class="grok-spirit-dialogue-group" data-path="${item.path}">
      <div class="grok-spirit-dialogue-header">
        <label class="grok-spirit-key">${item.key}:</label>
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
        <button type="button" class="grok-spirit-btn grok-spirit-btn-add-dialogue">+ Add Dialogue</button>
      </div>
      <div class="grok-spirit-dialogue-list">
        ${dialogues.map((dialogue, index) => createDialogueItem(dialogue, index, defaultCharacter)).join('')}
        ${dialogues.length === 0 ? '<div class="grok-spirit-no-dialogue">No dialogue entries</div>' : ''}
      </div>
    </div>
  `;
}

// Create individual dialogue item
function createDialogueItem(dialogue, index, defaultCharacter) {
  return `
    <div class="grok-spirit-dialogue-item" data-index="${index}">
      <div class="grok-spirit-dialogue-controls">
        <button type="button" class="grok-spirit-btn grok-spirit-btn-remove-dialogue" title="Remove">×</button>
      </div>
      <div class="grok-spirit-dialogue-fields">
        <div class="grok-spirit-dialogue-field">
          <label>Character:</label>
          <input type="text" class="grok-spirit-dialogue-character" value="${dialogue.characters || defaultCharacter}"
                 data-field="characters" placeholder="Character name">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Content:</label>
          <textarea class="grok-spirit-dialogue-content" data-field="content"
                    placeholder="What they say...">${dialogue.content || ''}</textarea>
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Start Time:</label>
          <input type="text" class="grok-spirit-dialogue-time" value="${dialogue.start_time || '00:00:00.000'}"
                 data-field="start_time" placeholder="00:00:00.000">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>End Time:</label>
          <input type="text" class="grok-spirit-dialogue-time" value="${dialogue.end_time || '00:00:01.000'}"
                 data-field="end_time" placeholder="00:00:01.000">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Emotion:</label>
          <input type="text" class="grok-spirit-dialogue-emotion" value="${dialogue.emotion || 'neutral'}"
                 data-field="emotion" placeholder="emotion">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Accent:</label>
          <input type="text" class="grok-spirit-dialogue-accent" value="${dialogue.accent || 'Neutral with a soft, melodic inflection'}"
                 data-field="accent" placeholder="accent description">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Language:</label>
          <input type="text" class="grok-spirit-dialogue-language" value="${dialogue.language || 'English'}"
                 data-field="language" placeholder="language">
        </div>
        <div class="grok-spirit-dialogue-field">
          <label>Type:</label>
          <select class="grok-spirit-dialogue-type" data-field="type">
            <option value="spoken" ${dialogue.type === 'spoken' ? 'selected' : ''}>spoken</option>
            <option value="whispered" ${dialogue.type === 'whispered' ? 'selected' : ''}>whispered</option>
            <option value="shouted" ${dialogue.type === 'shouted' ? 'selected' : ''}>shouted</option>
            <option value="narrated" ${dialogue.type === 'narrated' ? 'selected' : ''}>narrated</option>
          </select>
        </div>
        <div class="grok-spirit-dialogue-field grok-spirit-dialogue-field-checkbox">
          <label>Subtitles:</label>
          <input type="checkbox" class="grok-spirit-dialogue-subtitles" ${dialogue.subtitles ? 'checked' : ''}
                 data-field="subtitles">
        </div>
      </div>
    </div>
  `;
}

// Create regular text input
// Create text input
function createTextInput(item) {
  // Handle array fields specially
  let displayValue = item.value;
  let originalValue = item.value;

  if (Array.isArray(item.value)) {
    if (item.path === 'tags') {
      // For tags, display as comma-separated string
      displayValue = item.value.join(', ');
      originalValue = item.value.join(', ');
    } else {
      // For other arrays, display as comma-separated string for better readability
      displayValue = item.value.join(', ');
      originalValue = item.value.join(', ');
    }
  }

  return `
    <div class="grok-spirit-pair">
      <label class="grok-spirit-key">${item.key}:</label>
      <div class="grok-spirit-field-container">
        <input type="text" class="grok-spirit-value" value="${escapeHtml(displayValue)}"
               data-original="${escapeHtml(originalValue)}" data-path="${item.path}">
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
      </div>
    </div>
  `;
}

// Create readonly list input for objects, positioning, text_elements
function createReadonlyListInput(item) {
  const items = Array.isArray(item.value) ? item.value : [];

  return `
    <div class="grok-spirit-readonly-list-group" data-path="${item.path}">
      <div class="grok-spirit-readonly-list-header">
        <label class="grok-spirit-key">${item.key}:</label>
        <div class="grok-spirit-field-status" data-path="${item.path}">
          <span class="grok-spirit-status-indicator grok-spirit-status-unchanged" title="Unchanged">●</span>
          <button class="grok-spirit-field-undo" title="Undo this field" style="display: none;">↶</button>
        </div>
      </div>
      <div class="grok-spirit-readonly-list-content">
        ${items.map((listItem, index) => createReadonlyListItem(listItem, index, item.path)).join('')}
        ${items.length === 0 ? '<div class="grok-spirit-no-readonly-list">No items</div>' : ''}
      </div>
    </div>
  `;
}

// Create individual readonly list item
function createReadonlyListItem(listItem, index, path) {
  return `
    <div class="grok-spirit-readonly-list-item" data-index="${index}">
      <textarea class="grok-spirit-readonly-list-content-text" data-path="${path}" data-index="${index}">${escapeHtml(listItem)}</textarea>
    </div>
  `;
}

// Check if original prompt should be shown (deduplication logic)
function shouldShowOriginalPrompt(promptObj) {
  if (!cachedVideoData.hasOwnProperty('originalPrompt')) {
    return false;
  }

  // Convert structured prompt to a simplified text for comparison
  const structuredText = convertStructuredPromptToText(promptObj);

  // Simple comparison - if they're very similar, don't show original
  if (structuredText && cachedVideoData.hasOwnProperty('originalPrompt')) {
    const originalPromptText = typeof cachedVideoData.originalPrompt === 'string'
      ? cachedVideoData.originalPrompt
      : JSON.stringify(cachedVideoData.originalPrompt);
    const similarity = calculateSimilarity(structuredText.toLowerCase(), originalPromptText.toLowerCase());
    return similarity < 0.8; // Show original if similarity is less than 80%
  }

  return true;
}

// Convert structured prompt to text for comparison
function convertStructuredPromptToText(promptObj) {
  const parts = [];

  if (promptObj.motion) {
    parts.push(promptObj.motion);
  }

  if (promptObj.scene?.location) {
    parts.push(promptObj.scene.location);
  }

  if (promptObj.visual_details?.objects && Array.isArray(promptObj.visual_details.objects)) {
    parts.push(promptObj.visual_details.objects.join(', '));
  }

  return parts.join(' ');
}

// Simple similarity calculation
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) {
    return 1.0;
  }

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance calculation
function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

// Get default character from visual_details.objects
function getDefaultCharacter(promptObj) {
  const objects = promptObj.visual_details?.objects;
  if (Array.isArray(objects) && objects.length > 0) {
    const firstObject = objects[0];
    // Extract character name from object description
    const match = firstObject.match(/^([^:]+):/);
    return match ? match[1].trim() : firstObject;
  }
  return 'Character';
}

// Get custom options from localStorage
function getCustomOptions(key) {
  try {
    const stored = localStorage.getItem(`grok_custom_${key}`);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Get parsed options from localStorage (from system original prompts)
function getParsedOptions(key) {
  try {
    const stored = localStorage.getItem(`grok_parsed_${key}`);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Save custom options to localStorage
function saveCustomOptions(key, value) {
  try {
    const existing = getCustomOptions(key);
    if (!existing.includes(value)) {
      existing.push(value);
      localStorage.setItem(`grok_custom_${key}`, JSON.stringify(existing));
    }
  } catch (e) {
    console.error('Failed to save custom options:', e);
  }
}

// Save parsed options to localStorage (from system original prompts)
function saveParsedOptions(key, value, fieldPath) {
  try {
    const existing = getParsedOptions(key);
    if (!existing.includes(value)) {
      existing.push(value);

      // Apply truncation if maxSystemParsed is configured
      const config = FIELD_CONFIG[fieldPath];
      if (config && config.maxSystemParsed && existing.length > config.maxSystemParsed) {
        // Keep only the most recent results (remove oldest)
        existing.splice(0, existing.length - config.maxSystemParsed);
      }

      localStorage.setItem(`grok_parsed_${key}`, JSON.stringify(existing));
    }
  } catch (e) {
    console.error('Failed to save parsed options:', e);
  }
}

// Clear user custom options for a specific key
function clearCustomOptions(key) {
  try {
    localStorage.removeItem(`grok_custom_${key}`);
    console.log(`Cleared custom options for key: ${key}`);
  } catch (e) {
    console.error('Failed to clear custom options:', e);
  }
}


// Toggle section visibility
function toggleSection(header) {
  const content = header.nextElementSibling;
  const toggle = header.querySelector('.grok-spirit-toggle');

  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    content.style.display = 'none';
    toggle.textContent = '▶';
  }
}

// Create JSON editor
function createJsonEditor(promptObj) {
  return `
    <div class="grok-spirit-json">
      <div class="grok-spirit-json-header">
        <h4 style="margin: 0; color: #495057; font-size: 14px; font-weight: 600;">Structured Data</h4>
        <div class="grok-spirit-json-actions">
          <button class="grok-spirit-btn grok-spirit-btn-undo" title="Undo changes" style="display: none;">↶ Undo</button>
          <button class="grok-spirit-btn grok-spirit-btn-fill" title="Fill to input">📝 Fill</button>
          <button class="grok-spirit-btn grok-spirit-btn-copy" title="Copy JSON">📋 Copy</button>
          <button class="grok-spirit-btn grok-spirit-btn-download" title="Download JSON">💾 Download</button>
        </div>
      </div>
      <textarea class="grok-spirit-json-text" readonly>${JSON.stringify(promptObj, null, 2)}</textarea>
    </div>
  `;
}

// Update processing status
function updateProcessingStatus(status) {
  const statusElement = resultPanel.querySelector('.grok-spirit-status');
  if (statusElement) {
    // If status element exists, update directly
    const statusText = {
      'processing': 'Processing new video...',
      'failed': 'New video processing failed',
      'completed': 'New video processing completed'
    };

    const statusClass = {
      'processing': 'status-processing',
      'failed': 'status-failed',
      'completed': 'status-completed'
    };

    statusElement.textContent = statusText[status];
    statusElement.className = `grok-spirit-status ${statusClass[status]}`;
  } else {
    // If status element doesn't exist, recreate entire panel content
    resultPanel.innerHTML = createPanelContent();
  }
}

// Add event listeners to the panel
function addPanelEventListeners() {
  if (!resultPanel) return;

  // Key-value input changes
  const valueInputs = resultPanel.querySelectorAll('.grok-spirit-value');
  valueInputs.forEach(input => {
    input.addEventListener('input', handleValueChange);
  });

  // Toggle button clicks
  const toggleButtons = resultPanel.querySelectorAll('.grok-spirit-toggle-btn');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', handleToggleClick);
  });

  // Dropdown changes
  const dropdowns = resultPanel.querySelectorAll('.grok-spirit-dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.addEventListener('change', handleDropdownChange);
  });

  // Custom input changes
  const customInputs = resultPanel.querySelectorAll('.grok-spirit-custom-input');
  customInputs.forEach(input => {
    input.addEventListener('input', handleCustomInputChange);
  });

  // Dialogue controls
  const addDialogueBtns = resultPanel.querySelectorAll('.grok-spirit-btn-add-dialogue');
  addDialogueBtns.forEach(btn => {
    btn.addEventListener('click', handleAddDialogue);
  });

  const removeDialogueBtns = resultPanel.querySelectorAll('.grok-spirit-btn-remove-dialogue');
  removeDialogueBtns.forEach(btn => {
    btn.addEventListener('click', handleRemoveDialogue);
  });

  // Dialogue field changes
  const dialogueInputs = resultPanel.querySelectorAll('.grok-spirit-dialogue-character, .grok-spirit-dialogue-content, .grok-spirit-dialogue-time, .grok-spirit-dialogue-emotion, .grok-spirit-dialogue-accent, .grok-spirit-dialogue-language, .grok-spirit-dialogue-type, .grok-spirit-dialogue-subtitles');
  dialogueInputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.addEventListener('change', handleDialogueChange);
    } else {
      input.addEventListener('input', handleDialogueChange);
    }
  });

  // Individual field undo buttons
  const fieldUndoButtons = resultPanel.querySelectorAll('.grok-spirit-field-undo');
  fieldUndoButtons.forEach(button => {
    button.addEventListener('click', handleFieldUndo);
  });

  // Clear custom options buttons
  const clearCustomButtons = resultPanel.querySelectorAll('.grok-spirit-clear-custom');
  clearCustomButtons.forEach(button => {
    button.addEventListener('click', handleClearCustomOptions);
  });

  // Readonly list content changes
  const readonlyListInputs = resultPanel.querySelectorAll('.grok-spirit-readonly-list-content-text');
  readonlyListInputs.forEach(input => {
    input.addEventListener('input', handleReadonlyListChange);
  });

  // Collapsible section headers
  const sectionHeaders = resultPanel.querySelectorAll('.grok-spirit-section-header[data-collapsible="true"]');
  sectionHeaders.forEach(header => {
    header.addEventListener('click', () => toggleSection(header));
  });

  // JSON editor buttons
  const fillBtn = resultPanel.querySelector('.grok-spirit-btn-fill');
  const copyBtn = resultPanel.querySelector('.grok-spirit-btn-copy');
  const downloadBtn = resultPanel.querySelector('.grok-spirit-btn-download');
  const undoBtn = resultPanel.querySelector('.grok-spirit-btn-undo');

  if (fillBtn) {
    fillBtn.addEventListener('click', handleFill);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', handleCopy);
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownload);
  }

  if (undoBtn) {
    undoBtn.addEventListener('click', handleUndo);
  }

  // Download video and meta button
  const downloadVideoBtn = resultPanel.querySelector('.grok-spirit-btn-download-video');
  if (downloadVideoBtn) {
    downloadVideoBtn.addEventListener('click', handleDownloadVideoAndMeta);
  }
}

// Handle value changes
function handleValueChange(event) {
  const input = event.target;
  const originalValue = input.getAttribute('data-original');
  const currentValue = input.value;
  const path = input.getAttribute('data-path');

  // Skip metadata fields that should not be in the structured data
  const metadataFields = ['videoId', 'progress', 'originalPrompt'];
  if (metadataFields.includes(path)) {
    return;
  }

  // Update field status
  updateFieldStatus(path, originalValue, currentValue);

  // Show/hide undo button
  const undoBtn = resultPanel.querySelector('.grok-spirit-btn-undo');
  if (undoBtn) {
    const hasChanges = Array.from(resultPanel.querySelectorAll('.grok-spirit-value')).some(inp => inp.value !== inp.getAttribute('data-original'));
    undoBtn.style.display = hasChanges ? 'inline-block' : 'none';
  }

  // Update JSON textarea
  updateJsonFromKeyValue();
}

// Handle toggle button clicks
function handleToggleClick(event) {
  const button = event.target;
  const group = button.closest('.grok-spirit-toggle-group');
  const path = group.getAttribute('data-path');
  const originalValue = button.getAttribute('data-original');
  const currentValue = button.getAttribute('data-value');

  // Remove active class from all buttons in group
  group.querySelectorAll('.grok-spirit-toggle-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Add active class to clicked button
  button.classList.add('active');

  // Update field status
  updateFieldStatus(path, originalValue, currentValue);

  // Update JSON
  updateJsonFromPath(path, currentValue);
}

// Handle dropdown changes
function handleDropdownChange(event) {
  const dropdown = event.target;
  const group = dropdown.closest('.grok-spirit-dropdown-group');
  const path = group.getAttribute('data-path');
  const customInput = group.querySelector('.grok-spirit-custom-input');
  const originalValue = dropdown.getAttribute('data-original');

  const selectedValue = dropdown.value;

  if (selectedValue) {
    // Hide custom input, show dropdown value
    customInput.style.display = 'none';
    customInput.value = selectedValue;
  } else {
    // Show custom input
    customInput.style.display = 'block';
  }

  // Update field status
  updateFieldStatus(path, originalValue, selectedValue || customInput.value);

  updateJsonFromPath(path, selectedValue || customInput.value);
}

// Handle custom input changes
function handleCustomInputChange(event) {
  const input = event.target;
  const group = input.closest('.grok-spirit-dropdown-group');
  const path = group.getAttribute('data-path');
  const customKey = group.getAttribute('data-custom-key');
  const originalValue = input.getAttribute('data-original');

  const value = input.value.trim();

  // Update field status
  updateFieldStatus(path, originalValue, value);

  // Don't save here, only save when applying
  updateJsonFromPath(path, value);
}

// Update field status indicator
function updateFieldStatus(path, originalValue, currentValue) {
  // Skip metadata fields that should not be in the structured data
  const metadataFields = ['videoId', 'progress', 'originalPrompt'];
  if (metadataFields.includes(path)) {
    return;
  }

  const statusElement = resultPanel.querySelector(`.grok-spirit-field-status[data-path="${path}"]`);
  if (!statusElement) return;

  const indicator = statusElement.querySelector('.grok-spirit-status-indicator');
  const undoButton = statusElement.querySelector('.grok-spirit-field-undo');

  const hasChanged = originalValue !== currentValue;

  if (hasChanged) {
    indicator.className = 'grok-spirit-status-indicator grok-spirit-status-changed';
    indicator.title = 'Changed';
    undoButton.style.display = 'inline-block';
  } else {
    indicator.className = 'grok-spirit-status-indicator grok-spirit-status-unchanged';
    indicator.title = 'Unchanged';
    undoButton.style.display = 'none';
  }
}

// Handle individual field undo
function handleFieldUndo(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.target;
  const statusElement = button.closest('.grok-spirit-field-status');
  const path = statusElement.getAttribute('data-path');

  // Skip metadata fields that should not be in the structured data
  const metadataFields = ['videoId', 'progress', 'originalPrompt'];
  if (metadataFields.includes(path)) {
    return;
  }

  // Get original data
  const originalData = JSON.parse(cachedVideoData.videoPrompt);
  const originalValue = getNestedValue(originalData, path);

  // Find the field container
  const fieldContainer = statusElement.closest('.grok-spirit-field-container');
  const readonlyListGroup = statusElement.closest('.grok-spirit-readonly-list-group');

  if (!fieldContainer && !readonlyListGroup) {
    return;
  }

  // Reset based on field type
  const textInput = fieldContainer?.querySelector('.grok-spirit-value');
  const toggleGroup = fieldContainer?.querySelector('.grok-spirit-toggle-group');
  const dropdownGroup = fieldContainer?.querySelector('.grok-spirit-dropdown-group');

  if (textInput) {
    // Handle tags field specially
    let displayValue = originalValue;
    if (path === 'tags' && Array.isArray(originalValue)) {
      displayValue = originalValue.join(', ');
    }
    textInput.value = displayValue;
    updateFieldStatus(path, originalValue, originalValue);
    updateJsonFromKeyValue();
  } else if (readonlyListGroup) {
    // Handle readonly list fields
    const originalArray = Array.isArray(originalValue) ? originalValue : [];
    const readonlyListItems = readonlyListGroup.querySelectorAll('.grok-spirit-readonly-list-item');

    readonlyListItems.forEach((item, index) => {
      const textarea = item.querySelector('.grok-spirit-readonly-list-content-text');
      if (textarea && originalArray[index] !== undefined) {
        textarea.value = originalArray[index];
      }
    });

    updateFieldStatus(path, JSON.stringify(originalArray), JSON.stringify(originalArray));
    updateReadonlyListData(path);
  } else if (toggleGroup) {
    toggleGroup.querySelectorAll('.grok-spirit-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-value') === originalValue);
    });
    updateFieldStatus(path, originalValue, originalValue);
    updateJsonFromPath(path, originalValue);
  } else if (dropdownGroup) {
    const dropdown = dropdownGroup.querySelector('.grok-spirit-dropdown');
    const customInput = dropdownGroup.querySelector('.grok-spirit-custom-input');

    if (dropdown.options[Array.from(dropdown.options).findIndex(opt => opt.value === originalValue)] >= 0) {
      dropdown.value = originalValue;
      customInput.style.display = 'none';
    } else {
      dropdown.value = '';
      customInput.value = originalValue;
      customInput.style.display = 'block';
    }
    updateFieldStatus(path, originalValue, originalValue);
    updateJsonFromPath(path, originalValue);
  }
}

// Handle clear custom options button click
function handleClearCustomOptions(event) {
  event.preventDefault();
  event.stopPropagation();

  const button = event.target;
  const group = button.closest('.grok-spirit-dropdown-group');
  const customKey = group.getAttribute('data-custom-key');

  if (!customKey) {
    console.error('No custom key found for clear button');
    return;
  }

  // Confirm action
  if (confirm(`Are you sure you want to clear all user custom options for "${customKey}"?`)) {
    // Clear custom options from localStorage
    clearCustomOptions(customKey);

    // Refresh the panel to update the dropdown
    if (resultPanel) {
      resultPanel.innerHTML = createPanelContent();
      addPanelEventListeners();
    }

    console.log(`Cleared custom options for: ${customKey}`);
  }
}

// Get current dialogue data from UI
function getCurrentDialogueData() {
  const dialogueGroup = resultPanel.querySelector('.grok-spirit-dialogue-group');
  if (!dialogueGroup) return [];

  const dialogueItems = dialogueGroup.querySelectorAll('.grok-spirit-dialogue-item');
  const dialogues = [];

  dialogueItems.forEach((item, index) => {
    const character = item.querySelector('.grok-spirit-dialogue-character')?.value || '';
    const content = item.querySelector('.grok-spirit-dialogue-content')?.value || '';
    const startTime = item.querySelector('.grok-spirit-dialogue-time')?.value || '';
    const emotion = item.querySelector('.grok-spirit-dialogue-emotion')?.value || '';
    const accent = item.querySelector('.grok-spirit-dialogue-accent')?.value || '';
    const language = item.querySelector('.grok-spirit-dialogue-language')?.value || '';
    const type = item.querySelector('.grok-spirit-dialogue-type')?.value || '';
    const subtitles = item.querySelector('.grok-spirit-dialogue-subtitles')?.checked || false;

    dialogues.push({
      characters: character,
      content: content,
      start_time: startTime,
      end_time: '', // This would need to be calculated or set separately
      emotion: emotion,
      accent: accent,
      language: language,
      type: type,
      subtitles: subtitles
    });
  });

  return dialogues;
}

// Handle readonly list changes
function handleReadonlyListChange(event) {
  const input = event.target;
  const path = input.getAttribute('data-path');

  // Update readonly list field status
  const group = input.closest('.grok-spirit-readonly-list-group');
  const originalData = JSON.parse(cachedVideoData.videoPrompt);
  const originalArray = getNestedValue(originalData, path) || [];
  const currentArray = getCurrentReadonlyListData(path);

  updateFieldStatus(path, JSON.stringify(originalArray), JSON.stringify(currentArray));

  // Update JSON data
  updateReadonlyListData(path);
}

// Get current readonly list data from UI
function getCurrentReadonlyListData(path) {
  const group = resultPanel.querySelector(`.grok-spirit-readonly-list-group[data-path="${path}"]`);
  if (!group) return [];

  const readonlyListItems = group.querySelectorAll('.grok-spirit-readonly-list-item');
  const items = [];

  readonlyListItems.forEach((item, index) => {
    const content = item.querySelector('.grok-spirit-readonly-list-content-text')?.value || '';
    items.push(content);
  });

  return items;
}

// Update readonly list data
function updateReadonlyListData(path) {
  const currentArray = getCurrentReadonlyListData(path);

  updateJsonFromPath(path, currentArray);
}

// Handle dialogue changes
function handleDialogueChange(event) {
  // Prevent this from triggering handleValueChange
  event.stopPropagation();

  // Update dialogue field status
  const dialogueGroup = resultPanel.querySelector('.grok-spirit-dialogue-group');
  if (dialogueGroup) {
    const path = dialogueGroup.getAttribute('data-path');
    const originalData = JSON.parse(cachedVideoData.videoPrompt);
    const originalDialogues = originalData.dialogue || [];
    const currentDialogues = getCurrentDialogueData();

    // Compare dialogues
    const hasChanged = JSON.stringify(originalDialogues) !== JSON.stringify(currentDialogues);
    updateFieldStatus(path, JSON.stringify(originalDialogues), JSON.stringify(currentDialogues));
  }

  updateDialogueData();
}

// Handle add dialogue
function handleAddDialogue(event) {
  const group = event.target.closest('.grok-spirit-dialogue-group');
  const list = group.querySelector('.grok-spirit-dialogue-list');
  const noDialogue = list.querySelector('.grok-spirit-no-dialogue');

  if (noDialogue) {
    noDialogue.remove();
  }

  const newIndex = list.querySelectorAll('.grok-spirit-dialogue-item').length;
  const originalData = JSON.parse(cachedVideoData.videoPrompt);
  const defaultCharacter = getDefaultCharacter(originalData);

  // Create empty dialogue with default values
  const emptyDialogue = {
    characters: defaultCharacter,
    content: '',
    start_time: '00:00:00.000',
    end_time: '00:00:01.000',
    emotion: 'neutral',
    accent: 'Neutral with a soft, melodic inflection',
    language: 'English',
    type: 'spoken',
    subtitles: false
  };

  const newDialogueItem = document.createElement('div');
  newDialogueItem.className = 'grok-spirit-dialogue-item';
  newDialogueItem.setAttribute('data-index', newIndex);
  newDialogueItem.innerHTML = createDialogueItem(emptyDialogue, newIndex, defaultCharacter);

  list.appendChild(newDialogueItem);

  // Add event listeners to new elements
  addDialogueItemListeners(newDialogueItem);

  // Update JSON immediately to reflect the new empty dialogue
  updateDialogueData();

  // Update dialogue field status
  const path = group.getAttribute('data-path');
  const originalDialogues = JSON.parse(cachedVideoData.videoPrompt).dialogue || [];
  const currentDialogues = getCurrentDialogueData();

  // Compare dialogues
  updateFieldStatus(path, JSON.stringify(originalDialogues), JSON.stringify(currentDialogues));
}

// Handle remove dialogue
function handleRemoveDialogue(event) {
  const item = event.target.closest('.grok-spirit-dialogue-item');
  const list = item.closest('.grok-spirit-dialogue-list');

  item.remove();

  // Update indices
  const items = list.querySelectorAll('.grok-spirit-dialogue-item');
  items.forEach((item, index) => {
    item.setAttribute('data-index', index);
  });

  // Show no dialogue message if empty
  if (items.length === 0) {
    const noDialogue = document.createElement('div');
    noDialogue.className = 'grok-spirit-no-dialogue';
    noDialogue.textContent = 'No dialogue entries';
    list.appendChild(noDialogue);
  }

  updateDialogueData();

  // Update dialogue field status
  const dialogueGroup = item.closest('.grok-spirit-dialogue-group');
  const path = dialogueGroup.getAttribute('data-path');
  const originalDialogues = JSON.parse(cachedVideoData.videoPrompt).dialogue || [];
  const currentDialogues = getCurrentDialogueData();

  // Compare dialogues
  updateFieldStatus(path, JSON.stringify(originalDialogues), JSON.stringify(currentDialogues));
}

// Add event listeners to dialogue item
function addDialogueItemListeners(item) {
  const removeBtn = item.querySelector('.grok-spirit-btn-remove-dialogue');
  const inputs = item.querySelectorAll('.grok-spirit-dialogue-character, .grok-spirit-dialogue-content, .grok-spirit-dialogue-time, .grok-spirit-dialogue-emotion, .grok-spirit-dialogue-accent, .grok-spirit-dialogue-language, .grok-spirit-dialogue-type, .grok-spirit-dialogue-subtitles');

  if (removeBtn) {
    removeBtn.addEventListener('click', handleRemoveDialogue);
  }

  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      input.addEventListener('change', handleDialogueChange);
    } else {
      input.addEventListener('input', handleDialogueChange);
    }
  });
}

// Update dialogue data
function updateDialogueData() {
  const dialogueItems = resultPanel.querySelectorAll('.grok-spirit-dialogue-item');
  const dialogues = [];

  dialogueItems.forEach(item => {
    const characterEl = item.querySelector('.grok-spirit-dialogue-character');
    const contentEl = item.querySelector('.grok-spirit-dialogue-content');
    const startTimeEl = item.querySelector('.grok-spirit-dialogue-time[data-field="start_time"]');
    const endTimeEl = item.querySelector('.grok-spirit-dialogue-time[data-field="end_time"]');
    const emotionEl = item.querySelector('.grok-spirit-dialogue-emotion');
    const accentEl = item.querySelector('.grok-spirit-dialogue-accent');
    const languageEl = item.querySelector('.grok-spirit-dialogue-language');
    const typeEl = item.querySelector('.grok-spirit-dialogue-type');
    const subtitlesEl = item.querySelector('.grok-spirit-dialogue-subtitles');

    // Create dialogue object with default values if elements are missing
    const dialogue = {
      characters: characterEl ? characterEl.value : '',
      content: contentEl ? contentEl.value : '',
      start_time: startTimeEl ? startTimeEl.value : '00:00:00.000',
      end_time: endTimeEl ? endTimeEl.value : '00:00:01.000',
      emotion: emotionEl ? emotionEl.value : 'neutral',
      accent: accentEl ? accentEl.value : "Neutral with a soft, melodic inflection",
      language: languageEl ? languageEl.value : "English",
      type: typeEl ? typeEl.value : "spoken",
      subtitles: subtitlesEl ? subtitlesEl.checked : false
    };

    // Add dialogue even if some fields are empty (user might be editing)
    dialogues.push(dialogue);
  });

  updateJsonFromPath('dialogue', dialogues);
}

// Update JSON from path
function updateJsonFromPath(path, value) {
  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (!jsonTextarea) return;

  try {
    const originalData = JSON.parse(jsonTextarea.textContent);
    setNestedValue(originalData, path, value);
    jsonTextarea.textContent = JSON.stringify(originalData, null, 2);

    // Show undo button
    const undoBtn = resultPanel.querySelector('.grok-spirit-btn-undo');
    if (undoBtn) {
      undoBtn.style.display = 'inline-block';
    }
  } catch (e) {
    console.error('Failed to update JSON:', e);
  }
}

// Update JSON from key-value changes
function updateJsonFromKeyValue() {
  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (!jsonTextarea) return;

  try {
    const originalData = JSON.parse(jsonTextarea.textContent);
    const pairs = resultPanel.querySelectorAll('.grok-spirit-pair');

    // Update the data structure based on input changes
    pairs.forEach(pair => {
      const keyEl = pair.querySelector('.grok-spirit-key');
      const valueEl = pair.querySelector('.grok-spirit-value');

      // Skip if elements don't exist (e.g., in dialogue structure)
      if (!keyEl || !valueEl) return;

      const key = keyEl.textContent.replace(':', '');
      const value = valueEl.value;
      const path = valueEl.getAttribute('data-path');

      // Skip metadata fields that should not be in the structured data
      const metadataFields = ['videoId', 'progress', 'originalPrompt'];
      if (metadataFields.includes(path)) {
        return;
      }

      // Handle special cases for array fields
      let processedValue = value;
      if (path === 'tags') {
        // Convert comma-separated string back to array for tags only
        processedValue = value.split(',').map(item => item.trim()).filter(item => item.length > 0);
      }

      // Update data using path
      setNestedValue(originalData, path, processedValue);
    });

    jsonTextarea.textContent = JSON.stringify(originalData, null, 2);
  } catch (e) {
    console.error('Failed to update JSON:', e);
  }
}

// Set nested value in object using dot notation path
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

// Get nested value from object using dot notation path
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

// Save custom options from current UI state
function saveCustomOptionsFromUI() {
  const customInputs = resultPanel.querySelectorAll('.grok-spirit-custom-input');
  customInputs.forEach(input => {
    const group = input.closest('.grok-spirit-dropdown-group');
    const path = group.getAttribute('data-path');
    const customKey = group.getAttribute('data-custom-key');
    const value = input.value.trim();

    if (value && customKey) {
      const config = FIELD_CONFIG[path];
      if (config && !config.options.includes(value)) {
        saveCustomOptions(customKey, value);
      }
    }
  });
}

// Handle fill button
function handleFill() {
  // Save custom options before applying
  saveCustomOptionsFromUI();

  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (!jsonTextarea) return;

  const textarea = document.querySelector('textarea[aria-label="Make a video"]');
  if (textarea) {
    textarea.value = jsonTextarea.textContent;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('JSON filled to input textarea');
  } else {
    console.log('Input textarea not found');
  }
}

// Handle download button
function handleDownload() {
  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (!jsonTextarea) return;

  try {
    const jsonData = jsonTextarea.textContent;
    const structuredData = JSON.parse(jsonData);

    // Create download data with original prompt in separate field
    const downloadData = {
      structured_prompt: structuredData,
      original_prompt: cachedVideoData.originalPrompt || null,
      metadata: {
        video_id: cachedVideoData.videoId,
        progress: cachedVideoData.progress,
        download_time: new Date().toISOString(),
        url: currentUrl
      }
    };

    const blob = new Blob([JSON.stringify(downloadData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Use page URL as filename
    const filename = `grok_video_${window.location.pathname.split('/').pop() || 'data'}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Download failed:', e);
  }
}

// Handle download video and meta info (delegate to background for reliable filename)
function handleDownloadVideoAndMeta() {
  if (!cachedVideoData || !cachedVideoData.videoUrl) {
    console.error('No video URL available for download');
    return;
  }

  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (!jsonTextarea) return;

  let structuredData = {};
  try {
    structuredData = JSON.parse(jsonTextarea.textContent || '{}');
  } catch (e) {
    structuredData = {};
  }

  const payload = {
    action: 'downloadVideo',
    videoInfo: {
      videoId: cachedVideoData.videoId,
      videoUrl: cachedVideoData.videoUrl,
      videoPrompt: cachedVideoData.videoPrompt,
      originalPrompt: cachedVideoData.originalPrompt || null,
      progress: cachedVideoData.progress,
      pageUrl: currentUrl,
      structuredData: structuredData
    }
  };

  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Background message failed:', chrome.runtime.lastError);
      return;
    }
    if (!response || !response.success) {
      console.error('Background download failed:', response && response.error);
      return;
    }
  });
}

// Handle undo
function handleUndo() {
  // Get original data from cache, not from current JSON
  const originalData = JSON.parse(cachedVideoData.videoPrompt);

  // Reset text inputs
  const valueInputs = resultPanel.querySelectorAll('.grok-spirit-value');
  valueInputs.forEach(input => {
    const originalValue = input.getAttribute('data-original');
    const path = input.getAttribute('data-path');

    // Handle tags field specially
    let displayValue = originalValue;
    if (path === 'tags') {
      // originalValue is already a comma-separated string from data-original attribute
      displayValue = originalValue;
    }

    input.value = displayValue;
  });

  // Reset readonly list fields
  const readonlyListGroups = resultPanel.querySelectorAll('.grok-spirit-readonly-list-group');
  readonlyListGroups.forEach(group => {
    const path = group.getAttribute('data-path');
    const originalArray = getNestedValue(originalData, path) || [];

    const readonlyListItems = group.querySelectorAll('.grok-spirit-readonly-list-item');
    readonlyListItems.forEach((item, index) => {
      const textarea = item.querySelector('.grok-spirit-readonly-list-content-text');
      if (textarea && originalArray[index] !== undefined) {
        textarea.value = originalArray[index];
      }
    });
  });

  // Reset toggle buttons
  const toggleGroups = resultPanel.querySelectorAll('.grok-spirit-toggle-group');
  toggleGroups.forEach(group => {
    const path = group.getAttribute('data-path');
    const originalValue = getNestedValue(originalData, path);

    group.querySelectorAll('.grok-spirit-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-value') === originalValue);
    });
  });

  // Reset dropdowns
  const dropdownGroups = resultPanel.querySelectorAll('.grok-spirit-dropdown-group');
  dropdownGroups.forEach(group => {
    const path = group.getAttribute('data-path');
    const originalValue = getNestedValue(originalData, path);

    const dropdown = group.querySelector('.grok-spirit-dropdown');
    const customInput = group.querySelector('.grok-spirit-custom-input');

    if (dropdown.options[Array.from(dropdown.options).findIndex(opt => opt.value === originalValue)] >= 0) {
      dropdown.value = originalValue;
      customInput.style.display = 'none';
    } else {
      dropdown.value = '';
      customInput.value = originalValue;
      customInput.style.display = 'block';
    }
  });

  // Reset dialogue
  const dialogueGroup = resultPanel.querySelector('.grok-spirit-dialogue-group');
  if (dialogueGroup) {
    const originalDialogues = originalData.dialogue || [];

    const list = dialogueGroup.querySelector('.grok-spirit-dialogue-list');
    list.innerHTML = '';

    if (originalDialogues.length === 0) {
      const noDialogue = document.createElement('div');
      noDialogue.className = 'grok-spirit-no-dialogue';
      noDialogue.textContent = 'No dialogue entries';
      list.appendChild(noDialogue);
    } else {
      const defaultCharacter = getDefaultCharacter(originalData);
      originalDialogues.forEach((dialogue, index) => {
        const dialogueItem = document.createElement('div');
        dialogueItem.className = 'grok-spirit-dialogue-item';
        dialogueItem.setAttribute('data-index', index);
        dialogueItem.innerHTML = createDialogueItem(dialogue, index, defaultCharacter);
        list.appendChild(dialogueItem);
        addDialogueItemListeners(dialogueItem);
      });
    }
  }

  // Reset all field status indicators
  const fieldStatusElements = resultPanel.querySelectorAll('.grok-spirit-field-status');
  fieldStatusElements.forEach(statusElement => {
    const path = statusElement.getAttribute('data-path');
    const originalValue = getNestedValue(originalData, path);
    updateFieldStatus(path, originalValue, originalValue);
  });

  // Hide undo button
  const undoBtn = resultPanel.querySelector('.grok-spirit-btn-undo');
  if (undoBtn) {
    undoBtn.style.display = 'none';
  }

  // Restore original JSON
  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (jsonTextarea) {
    jsonTextarea.textContent = JSON.stringify(originalData, null, 2);
  }
}

// Handle copy
function handleCopy() {
  // Save custom options before applying
  saveCustomOptionsFromUI();

  const jsonTextarea = resultPanel.querySelector('.grok-spirit-json-text');
  if (jsonTextarea) {
    navigator.clipboard.writeText(jsonTextarea.textContent).then(() => {
      console.log('JSON copied to clipboard');
    });
  }
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add CSS styles
function addStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .grok-spirit-chat {
      display: flex;
      flex-direction: column;
    }

    .grok-spirit-message {
      display: flex;
      flex-direction: column;
    }

    .grok-spirit-header-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .grok-spirit-avatar {
      flex-shrink: 0;
    }

    .grok-spirit-header-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .grok-spirit-name {
      font-weight: 600;
      color: #495057;
      font-size: 14px;
    }

    .grok-spirit-time {
      font-size: 12px;
      color: #6c757d;
    }

    .grok-spirit-content {
      width: 100%;
    }

    .grok-spirit-scrollable {
      max-height: 300px;
      overflow-y: auto;
      margin-bottom: 16px;
      padding-right: 8px;
    }

    .grok-spirit-scrollable::-webkit-scrollbar {
      width: 6px;
    }

    .grok-spirit-scrollable::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 3px;
    }

    .grok-spirit-scrollable::-webkit-scrollbar-thumb {
      background: #c1c1c1;
      border-radius: 3px;
    }

    .grok-spirit-scrollable::-webkit-scrollbar-thumb:hover {
      background: #a8a8a8;
    }

    .grok-spirit-section {
      margin-bottom: 12px;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      overflow: hidden;
    }

    .grok-spirit-section-header {
      background: #f8f9fa;
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e9ecef;
    }

    .grok-spirit-section-header:hover {
      background: #e9ecef;
    }

    .grok-spirit-section-title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: #495057;
    }

    .grok-spirit-toggle {
      font-size: 12px;
      color: #6c757d;
      transition: transform 0.2s;
    }

    .grok-spirit-section-content {
      padding: 8px 12px;
      background: white;
    }

    .grok-spirit-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .grok-spirit-name {
      font-weight: 600;
      color: #495057;
      font-size: 14px;
    }

    .grok-spirit-time {
      font-size: 12px;
      color: #6c757d;
    }

    .grok-spirit-status {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      margin-right: 8px;
      flex-shrink: 0;
    }

    .status-processing {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    .status-failed {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    .status-completed {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .grok-spirit-keyvalue {
      margin-bottom: 16px;
    }

    .grok-spirit-pair {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      gap: 8px;
    }

    .grok-spirit-field-container {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .grok-spirit-field-status {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .grok-spirit-status-indicator {
      font-size: 12px;
      font-weight: bold;
      transition: color 0.2s;
    }

    .grok-spirit-status-unchanged {
      color: #6c757d;
    }

    .grok-spirit-status-changed {
      color: #dc3545;
    }

    .grok-spirit-field-undo {
      padding: 2px 6px;
      border: 1px solid #ced4da;
      background: white;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      color: #6c757d;
      transition: all 0.2s;
    }

    .grok-spirit-field-undo:hover {
      background: #f8f9fa;
      border-color: #dc3545;
      color: #dc3545;
    }

    .grok-spirit-key {
      font-weight: 500;
      color: #495057;
      min-width: 120px;
      font-size: 13px;
    }

    .grok-spirit-value {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 13px;
      background: white;
    }

    .grok-spirit-value:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
    }

    .grok-spirit-original-prompt {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 13px;
      background: white;
      min-height: 20px;
      max-height: 200px;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: monospace;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .grok-spirit-json {
      border-top: 1px solid #e9ecef;
      padding-top: 12px;
    }

    .grok-spirit-json-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .grok-spirit-json-actions {
      display: flex;
      gap: 4px;
    }

    .grok-spirit-btn {
      padding: 4px 8px;
      border: 1px solid #ced4da;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .grok-spirit-btn:hover {
      background: #f8f9fa;
      border-color: #007bff;
    }

    .grok-spirit-btn-fill {
      background: #28a745;
      color: white;
      border-color: #28a745;
    }

    .grok-spirit-btn-fill:hover {
      background: #218838;
      border-color: #1e7e34;
    }

    .grok-spirit-btn-copy {
      background: #17a2b8;
      color: white;
      border-color: #17a2b8;
    }

    .grok-spirit-btn-copy:hover {
      background: #138496;
      border-color: #117a8b;
    }

    .grok-spirit-btn-download {
      background: #6f42c1;
      color: white;
      border-color: #6f42c1;
    }

    .grok-spirit-btn-download:hover {
      background: #5a32a3;
      border-color: #4c2d85;
    }

    .grok-spirit-btn-download-video {
      background: #28a745;
      color: white;
      border-color: #28a745;
    }

    .grok-spirit-btn-download-video:hover {
      background: #218838;
      border-color: #1e7e34;
    }

    .grok-spirit-download-section {
      display: inline-block;
      margin-left: 8px;
    }

    .grok-spirit-json-text {
      width: 100%;
      height: 180px;
      padding: 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 12px;
      background: #f8f9fa;
      resize: vertical;
    }

    /* Toggle button styles */
    .grok-spirit-toggle-group {
      display: flex;
      gap: 4px;
    }

    .grok-spirit-toggle-btn {
      padding: 6px 12px;
      border: 1px solid #ced4da;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .grok-spirit-toggle-btn:hover {
      background: #f8f9fa;
      border-color: #007bff;
    }

    .grok-spirit-toggle-btn.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }

    /* Dropdown styles */
    .grok-spirit-dropdown-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .grok-spirit-dropdown {
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 13px;
      background: white;
    }

    .grok-spirit-custom-input {
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 13px;
      background: white;
    }

    /* Clear custom button */
    .grok-spirit-clear-custom {
      background: #dc3545;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 12px;
      cursor: pointer;
      margin-right: 4px;
      flex-shrink: 0;
    }

    .grok-spirit-clear-custom:hover {
      background: #c82333;
    }

    /* Dropdown option group styles */
    .grok-spirit-dropdown optgroup {
      font-weight: bold;
      font-size: 12px;
      color: #495057;
      background: #f8f9fa;
    }

    .grok-spirit-dropdown optgroup[label="Plugin Presets"] {
      color: #28a745;
    }

    .grok-spirit-dropdown optgroup[label="System Parsed"] {
      color: #007bff;
    }

    .grok-spirit-dropdown optgroup[label="User Custom"] {
      color: #ffc107;
    }

    /* Option styles */
    .grok-spirit-dropdown option.preset-option {
      color: #28a745;
      font-weight: 500;
    }

    .grok-spirit-dropdown option.parsed-option {
      color: #007bff;
      font-weight: 500;
    }

    .grok-spirit-dropdown option.custom-option {
      color: #856404;
      font-style: italic;
    }

    /* Dialogue styles */
    .grok-spirit-dialogue-group {
      margin-bottom: 16px;
    }

    .grok-spirit-dialogue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .grok-spirit-dialogue-header .grok-spirit-field-status {
      margin-left: auto;
      margin-right: 8px;
    }

    .grok-spirit-dialogue-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Readonly list styles */
    .grok-spirit-readonly-list-group {
      margin-bottom: 16px;
    }

    .grok-spirit-readonly-list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .grok-spirit-readonly-list-header .grok-spirit-field-status {
      margin-left: auto;
      margin-right: 8px;
    }

    .grok-spirit-readonly-list-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .grok-spirit-readonly-list-item {
      border: 1px solid #e9ecef;
      border-radius: 6px;
      padding: 8px;
      background: #f8f9fa;
    }

    .grok-spirit-readonly-list-content-text {
      width: 100%;
      padding: 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 12px;
      background: white;
      min-height: 60px;
      resize: vertical;
      font-family: inherit;
    }

    .grok-spirit-readonly-list-content-text:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
    }

    .grok-spirit-no-readonly-list {
      text-align: center;
      color: #6c757d;
      font-style: italic;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 4px;
    }

    .grok-spirit-dialogue-item {
      border: 1px solid #e9ecef;
      border-radius: 6px;
      padding: 12px;
      background: #f8f9fa;
      position: relative;
    }

    .grok-spirit-dialogue-controls {
      position: absolute;
      top: 8px;
      right: 8px;
    }

    .grok-spirit-btn-remove-dialogue {
      background: #dc3545;
      color: white;
      border: none;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .grok-spirit-btn-remove-dialogue:hover {
      background: #c82333;
    }

    .grok-spirit-dialogue-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
    }

    .grok-spirit-dialogue-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .grok-spirit-dialogue-field label {
      font-size: 11px;
      font-weight: 500;
      color: #495057;
    }

    .grok-spirit-dialogue-character,
    .grok-spirit-dialogue-time,
    .grok-spirit-dialogue-emotion,
    .grok-spirit-dialogue-accent,
    .grok-spirit-dialogue-language {
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 12px;
      background: white;
    }

    .grok-spirit-dialogue-type {
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 12px;
      background: white;
    }

    .grok-spirit-dialogue-field-checkbox {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      gap: 8px !important;
    }

    .grok-spirit-dialogue-field-checkbox label {
      margin: 0 !important;
      flex-shrink: 0;
    }

    .grok-spirit-dialogue-subtitles {
      margin: 0;
      transform: scale(1.2);
    }

    .grok-spirit-dialogue-content {
      grid-column: 1 / -1;
      padding: 4px 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 12px;
      background: white;
      min-height: 40px;
      resize: vertical;
    }

    .grok-spirit-no-dialogue {
      text-align: center;
      color: #6c757d;
      font-style: italic;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 4px;
    }

    .grok-spirit-btn-add-dialogue {
      background: #28a745;
      color: white;
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    }

    .grok-spirit-btn-add-dialogue:hover {
      background: #218838;
    }

    /* Ensure panel takes full width and new line */
    #grok-spirit-result-panel {
      flex: 1 1 100% !important;
      min-width: 100% !important;
      max-width: 100% !important;
      order: 999 !important;
      z-index: 10 !important;
      position: relative !important;
    }

    /* Add bottom padding to prevent overlay issues */
    #grok-spirit-result-panel .grok-spirit-body {
      padding-bottom: 10px;
    }

    /* Ensure JSON editor has enough space */
    #grok-spirit-result-panel .grok-spirit-json {
      margin-bottom: 10px;
    }
  `;

  document.head.appendChild(style);
}

// Initialize styles
addStyles();

// Error handling
window.addEventListener('error', (event) => {
  console.error('Grok Spirit content script error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Grok Spirit content script unhandled rejection:', event.reason);
});