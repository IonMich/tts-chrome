// Text splitting utility for hybrid TTS playback
export function getWords(text: string): string[] {
  return text.trim().split(/\s+/)
}

export function extractPageText(): string {
  // Priority selectors for main content
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

  // Elements to exclude
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

  // First, try to collect title from common heading selectors
  let title = '';
  const titleSelectors = ['h1', 'h2', 'h3', '.title', '.post-title', '.entry-title', '.article-title', '.entry-header h1', '.entry-header h2'];

  for (const selector of titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement && !isElementExcluded(titleElement, excludeSelectors)) {
      const titleText = titleElement.textContent?.trim();
      if (titleText && titleText.length > 3 && titleText.length < 200) {
        title = titleText;
        break;
      }
    }
  }

  // Fallback: try document.title if no heading found
  if (!title && document.title) {
    const docTitle = document.title.trim();
    if (docTitle.length > 3 && docTitle.length < 200) {
      title = docTitle;
    }
  }

  // Try to find main content using priority selectors
  let mainContent = '';
  for (const selector of mainContentSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = extractTextFromElement(element, excludeSelectors);
      if (text.trim().length > 100) { // Only use if substantial content
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
        // Skip if parent element matches exclude selectors
        let parent = node.parentElement;
        while (parent) {
          if (excludeSelectors.some(selector => parent?.matches(selector))) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }

        // Skip empty or whitespace-only text
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

export function splitTextForHybrid(
  fullText: string,
  targetWordsInFirstSegment = 30,
  overlapWords = 3,
  searchWindow = 10 // How many words back from targetWordsInFirstSegment to search for a preferred split
): { firstSegment: string; secondSegment: string } {
  const words = getWords(fullText)

  if (words.length <= targetWordsInFirstSegment) {
    return { firstSegment: fullText, secondSegment: '' }
  }

  let splitPoint = targetWordsInFirstSegment // Default split point

  // Search for a preferred split point (comma or period)
  // Search backwards from the end of the potential first segment
  const searchStart = Math.max(0, targetWordsInFirstSegment - searchWindow)
  for (let i = targetWordsInFirstSegment - 1; i >= searchStart; i--) {
    if (i < 0 || i >= words.length) continue // Boundary check for i
    const currentWord = words[i]
    const nextWord = i + 1 < words.length ? words[i + 1] : null

    // Prefer splitting at a period if it's likely a sentence end
    if (currentWord.endsWith('.')) {
      let isProtectedAbbreviation = false
      // Avoid splitting U.S.A., U.K. (e.g., "U.S.A.")
      if (currentWord.match(/^([A-Z]\.)+[A-Z]?\.?$/)) {
        isProtectedAbbreviation = true
      }
      // Avoid splitting e.g., i.e. (e.g., "e.g.")
      else if (currentWord.match(/^[a-z]\.[a-z]\.?$/)) {
        isProtectedAbbreviation = true
      }
      // Avoid common titles like Mr., Mrs., Dr.
      else if (
        [
          'Mr.',
          'Mrs.',
          'Ms.',
          'Dr.',
          'Prof.',
          'Rev.',
          'Hon.',
          'St.',
          'Gen.',
          'Sen.',
          'Rep.',
        ].includes(currentWord)
      ) {
        isProtectedAbbreviation = true
      }
      // Avoid splitting single capital letter followed by period if next word starts with capital (e.g., "A. Lincoln")
      // or if it's a known sequence like "Ph.D."
      else if (currentWord.match(/^[A-Z]\.$/)) {
        if (nextWord && nextWord.match(/^[A-Z]/)) {
          // A. Lincoln
          isProtectedAbbreviation = true
        } else if (
          i > 0 &&
          words[i - 1].endsWith('.') &&
          words[i - 1].match(/^[A-Z]/)
        ) {
          // Ph.D. -> D. is currentWord, Ph. is words[i-1]
          isProtectedAbbreviation = true
        }
      }

      if (!isProtectedAbbreviation) {
        splitPoint = i + 1 // Split after this word
        break
      }
    }

    // Split at a comma
    if (currentWord.endsWith(',')) {
      splitPoint = i + 1 // Split after this word
      break
    }
  }

  const firstSegmentWords = words.slice(0, splitPoint)
  let finalSecondSegmentWords = words.slice(splitPoint)

  // Apply original overlap logic:
  // This de-duplicates if the second segment naively starts with the overlap words from the first segment.
  if (
    overlapWords > 0 &&
    finalSecondSegmentWords.length >= overlapWords &&
    firstSegmentWords.length >= overlapWords
  ) {
    const overlapToCompare = firstSegmentWords.slice(-overlapWords)
    if (
      finalSecondSegmentWords.slice(0, overlapWords).join(' ') ===
      overlapToCompare.join(' ')
    ) {
      finalSecondSegmentWords = finalSecondSegmentWords.slice(overlapWords)
    }
  }
  console.log(
    `Splitting text at word ${splitPoint} (${firstSegmentWords.length} words in first segment, ${finalSecondSegmentWords.length} words in second segment)`
  )
  console.log(
    `First segment: "${firstSegmentWords.join(' ')}"`
  )
  console.log(
    `Second segment: "${finalSecondSegmentWords.join(' ')}"`
  )
  return {
    firstSegment: firstSegmentWords.join(' '),
    secondSegment: finalSecondSegmentWords.join(' '),
  }
}