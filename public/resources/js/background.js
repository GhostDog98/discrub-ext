/* eslint-disable no-undef */
/*global chrome*/
import * as module from "./sw.js";

chrome.action.onClicked.addListener((tab) => {
  if (chrome && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { message: "INJECT_DIALOG" },
          () => {}
        );
      }
    });
  }
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (chrome && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { message: "INJECT_BUTTON" },
          () => {}
        );
      }
    });
  }
});

// Handle file download requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadFile") {
    fetch(request.url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        // Convert blob to base64 for sending via message
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({
            success: true,
            data: reader.result,
            type: blob.type,
          });
        };
        reader.readAsArrayBuffer(blob);
      })
      .catch((error) => {
        console.error("Download error:", error);
        sendResponse({
          success: false,
          error: error.message,
        });
      });
    return true; // Keep the message channel open for async response
  }
});
