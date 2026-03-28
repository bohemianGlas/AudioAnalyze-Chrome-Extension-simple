// background.js
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  
  try {
    // まずcontent scriptが注入されているか確認
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    // 既に注入されている場合はトグル
    chrome.tabs.sendMessage(tab.id, { action: 'toggleAnalyzer' });
  } catch (error) {
    // content scriptが注入されていない場合は注入する
    console.log('Injecting content script...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      // スクリプト注入後、少し待ってからメッセージを送信
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleAnalyzer' })
          .catch(err => console.error('Error after injection:', err));
      }, 100);
    } catch (injectionError) {
      console.error('Failed to inject content script:', injectionError);
    }
  }
});

// タブキャプチャ用のメッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStreamId' && sender.tab) {
    chrome.tabCapture.getMediaStreamId({
      targetTabId: sender.tab.id
    }, (streamId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ streamId: streamId });
      }
    });
    return true; // 非同期レスポンス
  }
});
