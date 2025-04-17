export function getWords(text) {
  return text.trim().split(/\s+/);
}

export function splitTextForHybrid(fullText, initialWords = 15, overlapWords = 3) {
  const words = getWords(fullText);
  if (words.length <= initialWords) {
    return { firstSegment: fullText, secondSegment: "" };
  }
  const firstSegmentWords = words.slice(0, initialWords);
  let secondSegmentWords = words.slice(initialWords);
  const overlap = firstSegmentWords.slice(-overlapWords);
  if (secondSegmentWords.slice(0, overlapWords).join(" ") === overlap.join(" ")) {
    secondSegmentWords = secondSegmentWords.slice(overlapWords);
  }
  return { 
    firstSegment: firstSegmentWords.join(" "), 
    secondSegment: secondSegmentWords.join(" ") 
  };
}