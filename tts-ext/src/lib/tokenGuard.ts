export class SegmentTooLong extends Error { constructor(public tokenCount: number) { super('Speech segment exceeds 512 tokens.'); } }
export function guardTokenizer<T extends (...args: any[]) => any>(tokenizer: T): T {
  return new Proxy(tokenizer, { apply(target, receiver, args) {
    const result = Reflect.apply(target, receiver, [args[0], { ...args[1], truncation: false }]);
    const count = result.input_ids.dims.at(-1);
    if (!Number.isInteger(count) || count < 2) throw new Error('Invalid speech tokens.');
    if (count > 512) throw new SegmentTooLong(count);
    return result;
  } });
}
export function splitOversized(text: string): [string,string] {
  if (text.length < 2) throw new Error('This text cannot be pronounced within the voice token limit.');
  const mid = Math.floor(text.length / 2), space = text.lastIndexOf(' ',mid);
  const at = space > text.length / 4 ? space + 1 : mid;
  return [text.slice(0,at),text.slice(at)]; // exact coverage; no omitted suffix
}
