// Text splitting utility for hybrid TTS playback
export function getWords(text: string): string[] {
  return text.trim().split(/\s+/)
}

export function splitTextForHybrid(
  fullText: string,
  initialWords = 15,
  overlapWords = 3
): { firstSegment: string; secondSegment: string } {
  const words = getWords(fullText)
  if (words.length <= initialWords) {
    return { firstSegment: fullText, secondSegment: '' }
  }
  const firstSegmentWords = words.slice(0, initialWords)
  let secondSegmentWords = words.slice(initialWords)
  const overlap = firstSegmentWords.slice(-overlapWords)
  if (
    secondSegmentWords.slice(0, overlapWords).join(' ') === overlap.join(' ')
  ) {
    secondSegmentWords = secondSegmentWords.slice(overlapWords)
  }
  return {
    firstSegment: firstSegmentWords.join(' '),
    secondSegment: secondSegmentWords.join(' '),
  }
}