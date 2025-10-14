// Grok Spirit - Background Service Worker
console.log('Grok Spirit background script started');

let attachedTabs = {};
const targetUrl = "https://grok.com/rest/app-chat/conversations/new";
const pendingFilenames = {}; // url -> desired filename
const desiredFilenameQueue = []; // fallback queue if URL changes after redirect

// Plugin installation handler
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Grok Spirit installed/updated:', details.reason);
});

// Auto-attach debugger to grok.com tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('grok.com')) {
      console.log('Grok.com tab loaded, auto-attaching debugger:', tab.url);
      attachDebugger(tabId);
    } else if (attachedTabs[tabId]) {
      // If tab is no longer on grok.com, detach debugger
      console.log('Tab left grok.com, detaching debugger:', tab.url);
      detachDebugger(tabId);
    }
  }
});

// Handle tab activation (switching between tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('Tab activated:', activeInfo.tabId);

  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to get tab info:', chrome.runtime.lastError);
      return;
    }

    // Detach all debuggers first
    detachAllDebuggers();

    // If the activated tab is grok.com, attach debugger
    if (tab.url && tab.url.includes('grok.com')) {
      console.log('Activated tab is grok.com, attaching debugger');
      setTimeout(() => {
        attachDebugger(activeInfo.tabId);
      }, 100);
    }
  });
});

// Message handler from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'downloadVideo':
        downloadVideoWithMeta(request.videoInfo);
        sendResponse({ success: true });
        return true;

      case 'downloadMetaOnly':
        downloadMetaFile(request.metaData, request.filename);
        sendResponse({ success: true });
        return true;

      default:
        console.warn('Unknown action:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
        return true;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
    return true;
  }
});
// Ensure final filename via onDeterminingFilename
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  try {
    const desired = pendingFilenames[downloadItem.url];
    if (desired) {
      delete pendingFilenames[downloadItem.url];
      suggest({ filename: desired, conflictAction: 'uniquify' });
      return;
    }
    if (desiredFilenameQueue.length > 0) {
      const fallback = desiredFilenameQueue.shift();
      if (fallback && typeof fallback === 'string') {
        suggest({ filename: fallback, conflictAction: 'uniquify' });
        return;
      }
    }
  } catch (e) {
    // ignore
  }
  suggest();
});


// Attach debugger to tab
function attachDebugger(tabId) {
  // Check if already attached
  if (attachedTabs[tabId]) {
    return;
  }

  chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
    if (chrome.runtime.lastError) {
      // If already attached, mark as attached
      if (chrome.runtime.lastError.message.includes('Another debugger is already attached')) {
        attachedTabs[tabId] = true;
        return;
      }
      return;
    }

    attachedTabs[tabId] = true;
    console.log(`Debugger attached to tab ${tabId}`);

    // Enable network monitoring
    chrome.debugger.sendCommand({ tabId: tabId }, "Network.enable", {}, () => {
      if (chrome.runtime.lastError) {
        console.error('Network enable failed:', chrome.runtime.lastError);
      }
    });
  });
}

// Detach debugger from tab
function detachDebugger(tabId) {
  if (!attachedTabs[tabId]) {
    return; // Already detached
  }

  chrome.debugger.detach({ tabId: tabId }, () => {
    // Always clean up state regardless of error
    delete attachedTabs[tabId];
    console.log(`Debugger detached from tab ${tabId}`);
  });
}

// Detach all debuggers
function detachAllDebuggers() {
  const tabIds = Object.keys(attachedTabs);
  console.log('Detaching all debuggers from tabs:', tabIds);

  tabIds.forEach(tabId => {
    detachDebugger(parseInt(tabId));
  });
}

// Handle debugger detachment (when user cancels)
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ${source.tabId}, reason: ${reason}`);
  delete attachedTabs[source.tabId];

  // If user cancelled, reattach only if this tab is currently active
  if (reason === 'canceled_by_user') {
    setTimeout(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0 && tabs[0].id === source.tabId) {
          chrome.tabs.get(source.tabId, (tab) => {
            if (tab && tab.url && tab.url.includes('grok.com')) {
              console.log('Reattaching debugger after user cancellation (tab is active)');
              attachDebugger(source.tabId);
            }
          });
        } else {
          console.log('Not reattaching - tab is not active');
        }
      });
    }, 2000);
  }
});

// Debugger event listener
chrome.debugger.onEvent.addListener((source, method, params) => {
  // Detect video generation request
  if (method === "Network.requestWillBeSent") {
    const request = params.request;
    if (request.method === 'POST' && request.url.includes('grok.com/rest/app-chat/conversations')) {
      // Check if request body contains videoGen
      if (request.postData) {
        try {
          // postData can be string or object
          const postDataStr = typeof request.postData === 'string' ? request.postData : request.postData.text || JSON.stringify(request.postData);
          const requestBody = JSON.parse(postDataStr);
          if (requestBody.toolOverrides && requestBody.toolOverrides.videoGen === true) {
            chrome.tabs.sendMessage(source.tabId, {
              action: 'videoProcessing',
              status: 'processing'
            }).catch(err => console.log('[BG] Failed to send initial processing status:', err));
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }

  if (method === "Network.loadingFinished" && params.encodedDataLength > 0) {
    // Get response body for POST requests
    chrome.debugger.sendCommand({ tabId: source.tabId }, "Network.getResponseBody",
      { requestId: params.requestId }, (response) => {
        if (chrome.runtime.lastError || !response || !response.body) {
          return;
        }

        try {
          // Parse streaming response (multiple JSON objects separated by newlines)
          const lines = response.body.split('\n');
          let hasVideoData = false;

          let fullResponseData = null;
          let videoInfo = null;
          let originalPrompt = null;

          lines.forEach(line => {
            if (line.trim() === '') return;

            const data = JSON.parse(line);

            // Store the full response data for potential original prompt extraction
            if (data?.result?.response) {
              fullResponseData = data.result.response;
            }

            const currentVideoInfo = data?.result?.response?.streamingVideoGenerationResponse;

            // Check if this is a video generation response
            if (currentVideoInfo) {
              videoInfo = currentVideoInfo;

              // Capture original prompt from early response (progress < 5)
              if (currentVideoInfo.progress !== undefined && currentVideoInfo.progress < 5 && typeof currentVideoInfo.videoPrompt === 'string') {
                originalPrompt = currentVideoInfo.videoPrompt;
              }

              if (currentVideoInfo.progress === 100) {
                if (currentVideoInfo.videoUrl) {
                  // Successfully completed
                  hasVideoData = true;

                  // Create enhanced video info with full response data and original prompt
                  const enhancedVideoInfo = {
                    ...currentVideoInfo,
                    // New canonical fields per user's naming
                    generated_prompt: currentVideoInfo.videoPrompt, // progress=100 generated prompt
                    originalPrompt: originalPrompt,                 // progress<100 original prompt
                    // Keep backward compatibility
                    fullResponse: fullResponseData
                  };

                  // Send enhanced video info to content script for UI display
                  chrome.tabs.sendMessage(source.tabId, {
                    action: 'videoDetected',
                    videoInfo: enhancedVideoInfo
                  }).catch(err => console.log('Failed to send message to content script:', err));
                } else {
                  // Failed: progress=100 but no videoUrl
                  chrome.tabs.sendMessage(source.tabId, {
                    action: 'videoProcessing',
                    status: 'failed'
                  }).catch(err => console.log('Failed to send failed status:', err));
                }
              } else if (currentVideoInfo.progress !== undefined && currentVideoInfo.progress < 100) {
                // Only send processing status if we haven't sent it yet for this request
                if (!hasVideoData) {
                  chrome.tabs.sendMessage(source.tabId, {
                    action: 'videoProcessing',
                    status: 'processing'
                  }).catch(err => console.log('Failed to send processing status:', err));
                }
              }
            }
          });

          // If no video data found but we're processing, send processing status
          if (!hasVideoData && response.body.includes('streamingVideoGenerationResponse')) {
            // Processing status already sent when request was sent, no need to repeat here
          }
        } catch (e) {
          // JSON parsing failed is normal for streaming responses
          // console.warn("Failed to parse response line:", e);
        }
      });
  }
});

// Download video with metadata
async function downloadVideoWithMeta(videoInfo) {
  try {
    const videoId = videoInfo.videoId;
    const relativeVideoPath = videoInfo.videoUrl || '';
    const absoluteVideoUrl = relativeVideoPath.startsWith('http')
      ? relativeVideoPath
      : `https://assets.grok.com/${relativeVideoPath}?cache=1`;

    // 1) Download metadata JSON first (consistent with frontend "Download JSON" structure, named with Video ID)
    const downloadData = {
      structured_prompt: videoInfo.structuredData || {},
      original_prompt: videoInfo.originalPrompt || null,
      metadata: {
        video_id: videoId,
        progress: videoInfo.progress,
        download_time: new Date().toISOString(),
        url: videoInfo.pageUrl,
        video_url: relativeVideoPath
      }
    };

    // MV3 Service Worker doesn't support URL.createObjectURL, use data:URL instead
    const metaDataStr = JSON.stringify(downloadData, null, 2);
    const metaUrl = `data:application/json;charset=utf-8,${encodeURIComponent(metaDataStr)}`;

    pendingFilenames[metaUrl] = `grok_video_${videoId}.json`;
    desiredFilenameQueue.push(`grok_video_${videoId}.json`);
    await chrome.downloads.download({ url: metaUrl, filename: `grok_video_${videoId}.json`, saveAs: false });

    // 2) Download video file, ensure custom filename
    pendingFilenames[absoluteVideoUrl] = `grok_video_${videoId}.mp4`;
    desiredFilenameQueue.push(`grok_video_${videoId}.mp4`);
    await chrome.downloads.download({ url: absoluteVideoUrl, filename: `grok_video_${videoId}.mp4`, saveAs: false });
  } catch (error) {
    console.error('Download failed:', error);
  }
}

// Download metadata file only
async function downloadMetaFile(metaData, filename) {
  try {
    const metaDataStr = JSON.stringify(metaData, null, 2);
    const metaUrl = `data:application/json;charset=utf-8,${encodeURIComponent(metaDataStr)}`;

    await chrome.downloads.download({
      url: metaUrl,
      filename: filename,
      saveAs: false
    });
  } catch (error) {
    console.error('Metadata download failed:', error);
  }
}

// Cleanup on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs[tabId]) {
    detachDebugger(tabId);
  }
});

// Error handling
self.addEventListener('error', (event) => {
  console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Background script unhandled rejection:', event.reason);
});
