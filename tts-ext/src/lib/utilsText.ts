// Text splitting utility for hybrid TTS playback
export function getWords(text: string): string[] {
  return text.trim().split(/\s+/)
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