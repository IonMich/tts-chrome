export default defineBackground(() => {
  // Create context menu item on install
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "readText",
      title: "Read Text",
      contexts: ["selection"],
    });
  });

  // Handle context menu click
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "readText" && info.selectionText) {
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          const target = tabs[0];
          if (target && target.id != null) {
            chrome.storage.sync
              .get(["voice", "speed"])
              .then(({ voice, speed }) => {
                const v = voice || "af_sarah";
                const sp = speed ?? 1.0;
                chrome.tabs.sendMessage(target.id!, {
                  action: "readText",
                  text: info.selectionText,
                  voice: v,
                  speed: sp,
                });
              });
          }
        })
        .catch((err) =>
          console.error(
            "[Background] Error processing context menu click:",
            err
          )
        );
    }
  });

  // Handle keyboard command
  chrome.commands.onCommand.addListener((command) => {
    if (command === "trigger_tts") {
      console.log("[Background] 'trigger_tts' command received.");
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          const target = tabs[0];
          if (target && target.id != null) {
            chrome.scripting
              .executeScript({
                target: { tabId: target.id },
                func: () => window.getSelection()?.toString() || "",
              })
              .then((results) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "[Background] Error executing script to get selection:",
                    chrome.runtime.lastError.message
                  );
                  return;
                }
                const selected = results && (results[0]?.result as string);
                if (selected && selected.trim()) {
                  chrome.storage.sync
                    .get(["voice", "speed"])
                    .then(({ voice, speed }) => {
                      const v = voice || "af_sarah";
                      const sp = speed ?? 1.0;
                      chrome.tabs.sendMessage(target.id!, {
                        action: "readText",
                        text: selected,
                        voice: v,
                        speed: sp,
                      });
                    });
                }
              })
              .catch((err) =>
                console.error("[Background] Error processing command:", err)
              );
          }
        })
        .catch((err) =>
          console.error("[Background] Error querying tabs for command:", err)
        );
    } else if (command === "trigger_page_tts") {
      console.log("[Background] 'trigger_page_tts' command received.");
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          const target = tabs[0];
          if (target && target.id != null) {
            chrome.scripting
              .executeScript({
                target: { tabId: target.id },
                func: () => {
                  // Inline the page text extraction function
                  function extractPageText(): string {
                    const mainContentSelectors = [
                      'article',
                      'main',
                      '[role="main"]',
                      '.content',
                      '#content',
                      '.post-content',
                      '.entry-content',
                      '.article-content',
                      '.page-content'
                    ];

                    const excludeSelectors = [
                      'nav',
                      'header',
                      'footer',
                      'aside',
                      '.sidebar',
                      '.advertisement',
                      '.ads',
                      '.social',
                      '.share',
                      '.comments',
                      '.related',
                      '.navigation',
                      'script',
                      'style',
                      'noscript'
                    ];

                    function isElementExcluded(element: Element, excludeSelectors: string[]): boolean {
                      let parent = element;
                      while (parent) {
                        if (excludeSelectors.some(selector => parent.matches(selector))) {
                          return true;
                        }
                        parent = parent.parentElement as Element;
                      }
                      return false;
                    }

                    function extractTextFromElement(element: Element, excludeSelectors: string[]): string {
                      const walker = document.createTreeWalker(
                        element,
                        NodeFilter.SHOW_TEXT,
                        {
                          acceptNode(node) {
                            let parent = node.parentElement;
                            while (parent) {
                              if (excludeSelectors.some(selector => parent?.matches(selector))) {
                                return NodeFilter.FILTER_REJECT;
                              }
                              parent = parent.parentElement;
                            }

                            const text = node.textContent?.trim();
                            if (!text || text.length < 3) {
                              return NodeFilter.FILTER_REJECT;
                            }

                            return NodeFilter.FILTER_ACCEPT;
                          }
                        }
                      );

                      const textParts: string[] = [];
                      let node;

                      while (node = walker.nextNode()) {
                        const text = node.textContent?.trim();
                        if (text) {
                          textParts.push(text);
                        }
                      }

                      return textParts.join(' ').replace(/\s+/g, ' ').trim();
                    }

                    // First, try to collect title from common heading selectors
                    let title = '';
                    const titleSelectors = ['h1', 'h2', 'h3', '.title', '.post-title', '.entry-title', '.article-title', '.entry-header h1', '.entry-header h2'];

                    // Debug: log what elements we find
                    console.log('[Debug] Looking for title elements...');
                    for (const selector of titleSelectors) {
                      const titleElement = document.querySelector(selector);
                      if (titleElement) {
                        const titleText = titleElement.textContent?.trim();
                        console.log(`[Debug] Found ${selector}: "${titleText}" (excluded: ${isElementExcluded(titleElement, excludeSelectors)})`);
                        if (!isElementExcluded(titleElement, excludeSelectors) && titleText && titleText.length > 3 && titleText.length < 200) {
                          title = titleText;
                          console.log(`[Debug] Using title: "${title}"`);
                          break;
                        }
                      }
                    }

                    // Fallback: try document.title if no heading found
                    if (!title && document.title) {
                      const docTitle = document.title.trim();
                      if (docTitle.length > 3 && docTitle.length < 200) {
                        title = docTitle;
                        console.log(`[Debug] Using document.title: "${title}"`);
                      }
                    }

                    // Try to find main content using priority selectors
                    let mainContent = '';
                    for (const selector of mainContentSelectors) {
                      const element = document.querySelector(selector);
                      if (element) {
                        const text = extractTextFromElement(element, excludeSelectors);
                        if (text.trim().length > 100) {
                          mainContent = text;
                          break;
                        }
                      }
                    }

                    // If no main content found, fallback to body
                    if (!mainContent) {
                      mainContent = extractTextFromElement(document.body, excludeSelectors);
                    }

                    // Combine title and content, avoiding duplication
                    if (title && mainContent) {
                      // Check if title is already at the beginning of main content
                      if (mainContent.toLowerCase().startsWith(title.toLowerCase())) {
                        return mainContent;
                      } else {
                        return `${title}. ${mainContent}`;
                      }
                    }

                    return mainContent || title;
                  }

                  return extractPageText();
                },
              })
              .then((results) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "[Background] Error executing script to get page text:",
                    chrome.runtime.lastError.message
                  );
                  return;
                }
                const pageText = results && (results[0]?.result as string);
                if (pageText && pageText.trim()) {
                  console.log(`[Background] Extracted ${pageText.length} characters from page`);
                  chrome.storage.sync
                    .get(["voice", "speed"])
                    .then(({ voice, speed }) => {
                      const v = voice || "af_sarah";
                      const sp = speed ?? 1.0;
                      chrome.tabs.sendMessage(target.id!, {
                        action: "readText",
                        text: pageText,
                        voice: v,
                        speed: sp,
                      });
                    });
                } else {
                  console.log("[Background] No substantial text found on page");
                }
              })
              .catch((err) =>
                console.error("[Background] Error processing page TTS command:", err)
              );
          }
        })
        .catch((err) =>
          console.error("[Background] Error querying tabs for page TTS command:", err)
        );
    }
  });
});
