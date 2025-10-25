// Grok Spirit - Background Service Worker
console.log('Grok Spirit background script started');

// 统一时间格式化函数
function formatTime(date = new Date()) {
  return date.toLocaleTimeString(undefined, {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

// 本地完整时间（YYYY/MM/DD HH:mm:ss），与前端一致
function formatFullDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
}

let attachedTabs = {};
const targetUrl = "https://grok.com/rest/app-chat/conversations/new";
// 防御模式开关：默认关闭，避免与其他扩展冲突
let isFilenameDefenseEnabled = false;
let filenameDeterminerHandler = null; // 动态监听器引用
// 文件名映射：仅在防御模式开启时使用
const pendingFilenames = {}; // url -> desired filename
const desiredFilenameQueue = []; // fallback queue if URL changes after redirect
const videoProcessingTabs = {}; // tabId -> { isProcessing: boolean, completed: boolean }

// Plugin installation handler
chrome.runtime.onInstalled.addListener(async (details) => {
  // Load defense mode setting on startup
  const data = await chrome.storage.local.get('isFilenameDefenseEnabled');
  isFilenameDefenseEnabled = !!data.isFilenameDefenseEnabled;

  // 根据设置动态注册/注销监听器
  updateFilenameDeterminerListener();
});

// Auto-attach debugger to grok.com tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('grok.com/imagine')) {
      console.log('Grok.com tab loaded, auto-attaching debugger:', tab.url);
      attachDebugger(tabId);
    } else if (attachedTabs[tabId]) {
      // If tab is no longer on grok.com, check if video processing is complete before detaching
      const processingState = videoProcessingTabs[tabId];
      if (processingState && processingState.isProcessing && !processingState.completed) {
        console.log(`Tab ${tabId} left grok.com but video processing in progress - keeping debugger attached`);
        return;
      }

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

    // Check if any tabs are currently processing video
    const processingTabs = Object.keys(videoProcessingTabs).filter(tabId => {
      const state = videoProcessingTabs[tabId];
      return state && state.isProcessing && !state.completed;
    });

    if (processingTabs.length > 0) {
      console.log('Video processing in progress on tabs:', processingTabs, '- skipping debugger detach');
    } else {
      // Detach all debuggers only if no video processing is happening
      detachAllDebuggers();
    }

    // If the activated tab is grok.com, attach debugger
    if (tab.url && tab.url.includes('grok.com/imagine')) {
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

      case 'setFilenameDefense':
        isFilenameDefenseEnabled = request.enabled;
        // 动态更新监听器状态
        updateFilenameDeterminerListener();
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
// 动态注册/注销文件名控制监听器
function updateFilenameDeterminerListener() {
  // 先移除现有监听器（如果存在）
  if (filenameDeterminerHandler) {
    chrome.downloads.onDeterminingFilename.removeListener(filenameDeterminerHandler);
    filenameDeterminerHandler = null;
  }

  // 如果防御模式开启，注册新的监听器
  if (isFilenameDefenseEnabled) {
    filenameDeterminerHandler = (downloadItem, suggest) => {
      try {
        // 只处理本扩展发起的下载
        if (downloadItem.byExtensionId !== chrome.runtime.id) {
          return;
        }

        // 使用原有的文件名控制逻辑
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
    };

    chrome.downloads.onDeterminingFilename.addListener(filenameDeterminerHandler);
  }
}


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

  // Check if this tab is currently processing video
  const processingState = videoProcessingTabs[tabId];
  if (processingState && processingState.isProcessing && !processingState.completed) {
    console.log(`Debugger detach blocked for tab ${tabId} - video processing in progress`);
    return;
  }

  chrome.debugger.detach({ tabId: tabId }, () => {
    // Always clean up state regardless of error
    delete attachedTabs[tabId];
    // Clean up video processing state when detaching
    delete videoProcessingTabs[tabId];
    console.log(`Debugger detached from tab ${tabId}`);
  });
}

// Detach all debuggers
function detachAllDebuggers() {
  const tabIds = Object.keys(attachedTabs);
  console.log('Detaching all debuggers from tabs:', tabIds);

  tabIds.forEach(tabId => {
    const processingState = videoProcessingTabs[tabId];
    if (processingState && processingState.isProcessing && !processingState.completed) {
      console.log(`Skipping detach for tab ${tabId} - video processing in progress`);
      return;
    }
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
            if (tab && tab.url && tab.url.includes('grok.com/imagine')) {
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
    // console.log(`[${formatTime()}] Network request detected:`, request.method, request.url);

    if (request.method === 'POST' && request.url.includes('grok.com/rest/app-chat/conversations')) {
      // console.log(`[${formatTime()}] POST request to conversations endpoint detected`);

      // Check if request body contains videoGen
      if (request.postData) {
        console.log(`[${formatTime()}] Request has postData, checking for videoGen...`);
        try {
          // postData can be string or object
          const postDataStr = typeof request.postData === 'string' ? request.postData : request.postData.text || JSON.stringify(request.postData);
          const requestBody = JSON.parse(postDataStr);
          console.log(`[${formatTime()}] Parsed request body:`, requestBody);

          if (requestBody.toolOverrides && requestBody.toolOverrides.videoGen === true) {
            console.log(`[${formatTime()}] Video generation request detected!`);

            // Mark this tab as processing video
            videoProcessingTabs[source.tabId] = {
              isProcessing: true,
              completed: false
            };

            // Get referer from request headers
            console.log(`[${formatTime()}] Request headers:`, request.headers);
            const referer = request.headers.Referer || request.headers.referer;
            console.log(`[${formatTime()}] Tab ${source.tabId} started video processing`);
            console.log(`[${formatTime()}] Tab ${source.tabId} referer:`, referer);

            chrome.tabs.sendMessage(source.tabId, {
              action: 'videoProcessing',
              status: 'processing',
              referer: referer
            }).catch(err => console.log(`[${formatTime()}] [BG] Failed to send initial processing status:`, err));
          } else {
            console.log(`[${formatTime()}] No videoGen in toolOverrides:`, requestBody.toolOverrides);
          }
        } catch (e) {
          console.log(`[${formatTime()}] Error parsing request body:`, e);
        }
      } else {
        console.log(`[${formatTime()}] No postData in request`);
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
          let sentFailure = false;

          let fullResponseData = null;
          let videoInfo = null;
          let originalPrompt = null;

          lines.forEach(line => {
            if (line.trim() === '') return;

            const data = JSON.parse(line);

            // Handle error payloads like {"error":{"code":8,"message":"Too many requests","details":[]}}
            if (!sentFailure && data && data.error) {
              sentFailure = true;
              if (videoProcessingTabs[source.tabId]) {
                videoProcessingTabs[source.tabId].completed = true;
                console.log(`Tab ${source.tabId} video processing failed (error payload)`);
              }

              chrome.tabs.sendMessage(source.tabId, {
                action: 'videoProcessing',
                status: 'failed',
                error: {
                  code: data.error.code,
                  message: data.error.message
                },
                ts: formatTime()
              }).catch(err => console.log('Failed to send failed status:', err));
              return;
            }

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

                  // Mark video processing as completed
                  if (videoProcessingTabs[source.tabId]) {
                    videoProcessingTabs[source.tabId].completed = true;
                    console.log(`Tab ${source.tabId} video processing completed`);
                  }

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
                  // Mark video processing as completed (even if failed)
                  if (videoProcessingTabs[source.tabId]) {
                    videoProcessingTabs[source.tabId].completed = true;
                    console.log(`Tab ${source.tabId} video processing failed but marked as completed`);
                  }

                  chrome.tabs.sendMessage(source.tabId, {
                    action: 'videoProcessing',
                    status: 'failed'
                  }).catch(err => console.log('Failed to send failed status:', err));
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

// Construct HD video URL from normal video URL
function constructHdUrl(videoUrl) {
  if (!videoUrl) return null;

  // Handle both relative and absolute URLs
  if (videoUrl.startsWith('http')) {
    // Absolute URL: replace .mp4 with _hd.mp4
    return videoUrl.replace('.mp4', '_hd.mp4');
  } else {
    // Relative URL: add _hd before .mp4
    return videoUrl.replace('.mp4', '_hd.mp4');
  }
}

// Check if URL exists using HEAD request
async function checkUrlExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    console.log('URL check failed:', error);
    return false;
  }
}

// Request HD video generation via POST
async function requestHdGeneration(videoId) {
  try {
    const payload = { videoId: videoId };
    console.log('Sending HD generation request with payload:', JSON.stringify(payload));

    const response = await fetch('https://grok.com/rest/media/video/upscale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      return data.hdMediaUrl || null;
    } else {
      console.log('HD generation request failed:', response.status, response.statusText);
      return null;
    }
  } catch (error) {
    console.log('HD generation request error:', error);
    return null;
  }
}

// Download video with metadata
async function downloadVideoWithMeta(videoInfo) {
  try {
    const videoId = videoInfo.videoId;
    const relativeVideoPath = videoInfo.videoUrl || '';
    const normalVideoUrl = relativeVideoPath.startsWith('http')
      ? relativeVideoPath
      : `https://assets.grok.com/${relativeVideoPath}?cache=1`;

    let finalVideoUrl = null;
    let isHd = false;
    let videoQuality = 'normal';

    // Step 1: Try to download HD version directly (check if HD URL exists)
    const hdUrl = constructHdUrl(normalVideoUrl);
    if (hdUrl) {
      console.log('Checking if HD video exists:', hdUrl);
      const hdExists = await checkUrlExists(hdUrl);

      if (hdExists) {
        finalVideoUrl = hdUrl;
        isHd = true;
        videoQuality = 'hd';
        console.log('HD video found, will download HD version');
      }
    }

    // Step 2: If HD doesn't exist, try to trigger HD generation
    if (!finalVideoUrl) {
      console.log('HD video not found, attempting to trigger HD generation...');
      const hdGeneratedUrl = await requestHdGeneration(videoId);

      if (hdGeneratedUrl) {
        finalVideoUrl = hdGeneratedUrl;
        isHd = true;
        videoQuality = 'hd';
        console.log('HD video generation successful, will download HD version');
      }
    }

    // Step 3: Fallback to normal version
    if (!finalVideoUrl) {
      finalVideoUrl = normalVideoUrl;
      isHd = false;
      videoQuality = 'normal';
      console.log('Using normal video version');
    }

    // 1) Download metadata JSON first (consistent with frontend "Download JSON" structure, named with Video ID)
    const downloadData = {
      structured_prompt: videoInfo.structuredData || {},
      original_prompt: videoInfo.originalPrompt || null,
      metadata: {
        video_id: videoId,
        progress: videoInfo.progress,
        download_time: formatFullDateTime(new Date()),
        url: videoInfo.pageUrl,
        video_url: relativeVideoPath,
        video_quality: videoQuality,
        is_hd: isHd
      }
    };

    // MV3 Service Worker doesn't support URL.createObjectURL, use data:URL instead
    const metaDataStr = JSON.stringify(downloadData, null, 2);
    const metaUrl = `data:application/json;charset=utf-8,${encodeURIComponent(metaDataStr)}`;

    const jsonFilename = `grok_video_${videoId}.json`;
    // 防御模式开启时，使用文件名控制；否则依赖 downloads.download 的 filename 参数
    if (isFilenameDefenseEnabled) {
      pendingFilenames[metaUrl] = jsonFilename;
      desiredFilenameQueue.push(jsonFilename);
    }
    await chrome.downloads.download({ url: metaUrl, filename: jsonFilename, conflictAction: 'uniquify', saveAs: false });

    // 2) Download video file, ensure custom filename with quality indicator
    // const videoFilename = isHd ? `grok_video_${videoId}_hd.mp4` : `grok_video_${videoId}.mp4`;
    const videoFilename = `grok_video_${videoId}.mp4`;
    if (isFilenameDefenseEnabled) {
      pendingFilenames[finalVideoUrl] = videoFilename;
      desiredFilenameQueue.push(videoFilename);
    }
    await chrome.downloads.download({ url: finalVideoUrl, filename: videoFilename, conflictAction: 'uniquify', saveAs: false });

    console.log(`Download completed: ${videoQuality} version of video ${videoId}`);
  } catch (error) {
    console.error('Download failed:', error);
  }
}

// Download metadata file only
async function downloadMetaFile(metaData, filename) {
  try {
    const metaDataStr = JSON.stringify(metaData, null, 2);
    const metaUrl = `data:application/json;charset=utf-8,${encodeURIComponent(metaDataStr)}`;

    // 防御模式开启时，使用文件名控制
    if (isFilenameDefenseEnabled) {
      pendingFilenames[metaUrl] = filename;
      desiredFilenameQueue.push(filename);
    }

    await chrome.downloads.download({
      url: metaUrl,
      filename: filename,
      conflictAction: 'uniquify',
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
