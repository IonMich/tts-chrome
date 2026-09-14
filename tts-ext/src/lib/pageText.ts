/** Self-contained: Chrome serializes this function into the requested page. */
export function extractReadableText(onlySelection: boolean): string {
  if (onlySelection) return window.getSelection()?.toString().trim() || '';
  const root = document.querySelector('article') ?? document.querySelector('main, [role="main"]') ?? document.body;
  const skip = 'nav,aside,footer,script,style,noscript,button,input,textarea,[hidden],[aria-hidden="true"],tts-overlay';
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof Element) || node.matches(skip) || (root === document.body && node.tagName === 'HEADER')) return '';
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    if (node.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes, read).join('');
    const inline = style.display === 'inline' || style.display === 'contents' || style.display.startsWith('inline-');
    return inline ? text : '\n' + text + '\n';
  };
  return read(root).replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
}
