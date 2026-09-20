import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { getVoiceCatalog } from '@/lib/readerClient';
import { macVoiceId, macVoiceValue, voiceLabel, VOICES, type VoiceCatalog } from '@/lib/readerProtocol';
import { VoiceAvatar } from './VoiceAvatar';

interface VoicePickerProps {
  value: string;
  onChange: (voice: string) => void | Promise<unknown>;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  active?: boolean;
}

const identity = (voice: string) => macVoiceId(voice)
  ? ['Mac voice', 'Start Speaking']
  : voiceLabel(voice).split(' · ');

export function VoicePicker({ value, onChange, disabled = false, compact = false, label = 'Voice', active = false }: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<VoiceCatalog>();
  const [focusedVoice, setFocusedVoice] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef(new Map<string, HTMLButtonElement>());
  const typeahead = useRef({ text: '', time: 0 });
  const restoreTrigger = useRef(false);
  const restoreOption = useRef<string | undefined>(undefined);
  const id = useId();
  const [name, detail] = identity(value);
  const nativeVoice = macVoiceValue('macos-start-speaking');
  const macAvailable = !!catalog?.macVoices.some(voice => macVoiceValue(voice.id) === nativeVoice);
  const locked = disabled || pending;

  useEffect(() => {
    if (locked) return;
    if (!open && restoreTrigger.current) { restoreTrigger.current = false; trigger.current?.focus(); }
    if (open && restoreOption.current) { options.current.get(restoreOption.current)?.focus(); restoreOption.current = undefined; }
  }, [locked, open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void getVoiceCatalog().then(result => { if (current) setCatalog(result); }).catch(() => {
      if (current) setCatalog({ macVoices: [], macError: 'Mac voice unavailable' });
    });
    const selected = options.current.get(value);
    (selected && !selected.disabled ? selected : [...options.current.values()].find(option => !option.disabled))?.focus();
    const outside = (event: PointerEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => { current = false; document.removeEventListener('pointerdown', outside, true); };
  }, [open]);

  const close = () => { restoreTrigger.current = true; setOpen(false); };
  const choose = async (voice: string) => {
    if (locked) return;
    if (voice === value) { close(); return; }
    setPending(true); setError('');
    try { await onChange(voice); close(); }
    catch (failure) { restoreOption.current = voice; setError(failure instanceof Error ? failure.message : 'Could not change the voice. Try again.'); }
    finally { setPending(false); }
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const enabled = [...options.current.values()].filter(option => !option.disabled);
    const current = enabled.indexOf(event.target as HTMLButtonElement);
    let next: number | undefined;
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (current + 1) % enabled.length;
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (current - 1 + enabled.length) % enabled.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    if (next !== undefined) { event.preventDefault(); enabled[next]?.focus(); return; }
    if (event.key.length === 1 && /[a-z]/i.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - typeahead.current.time < 700 ? typeahead.current.text : '') + event.key.toLowerCase();
      typeahead.current = { text, time: now };
      enabled.find(option => option.getAttribute('aria-label')?.toLowerCase().startsWith(text))?.focus();
    }
  };
  const option = (voice: string, unavailable = false) => {
    const [optionName, optionDetail] = identity(voice);
    return <button key={voice} type="button" role="option" aria-label={voiceLabel(voice)} aria-selected={voice === value}
      className="reader-voice-picker__option" disabled={locked || unavailable} tabIndex={voice === focusedVoice ? 0 : -1}
      onFocus={() => setFocusedVoice(voice)}
      ref={element => { if (element) options.current.set(voice, element); else options.current.delete(voice); }}
      onClick={() => void choose(voice)}>
      <VoiceAvatar voice={voice} size={30} />
      <span className="reader-voice-picker__option-copy"><strong>{optionName}</strong><span>{unavailable ? catalog ? 'Unavailable' : 'Checking…' : optionDetail}</span></span>
      {voice === value && <Check size={14} className="reader-voice-picker__check" aria-hidden="true" />}
    </button>;
  };

  return <div ref={root} className={`reader-voice-picker${compact ? ' reader-voice-picker--compact' : ''}`}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" className="reader-voice-picker__trigger" aria-label={`${label}: ${voiceLabel(value)}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={locked}
      onClick={() => { setError(''); setOpen(current => !current); }}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setError(''); setOpen(true); } }}>
      <VoiceAvatar voice={value} size={compact ? 28 : 34} />
      <span className="reader-voice-picker__identity"><strong>{name}</strong><span>{detail}</span></span>
      {pending ? <LoaderCircle className="reader-spin reader-voice-picker__chevron" size={15} aria-hidden="true" /> : <ChevronDown className="reader-voice-picker__chevron" size={15} aria-hidden="true" />}
    </button>
    {open && <div id={id} className="reader-voice-picker__panel" role="dialog" aria-label="Choose voice" aria-busy={pending} onKeyDown={navigate}>
      <div className="reader-voice-picker__heading">Choose voice</div>
      <div className="reader-voice-picker__list" role="listbox" aria-label="Voices">
        <div role="group" aria-label="American voices"><div className="reader-voice-picker__group" aria-hidden="true">American</div><div className="reader-voice-picker__grid">{VOICES.filter(voice => voice[0] === 'a').map(voice => option(voice))}</div></div>
        <div role="group" aria-label="British voices"><div className="reader-voice-picker__group" aria-hidden="true">British</div><div className="reader-voice-picker__grid">{VOICES.filter(voice => voice[0] === 'b').map(voice => option(voice))}</div></div>
        <div role="group" aria-label="Mac voice"><div className="reader-voice-picker__group" aria-hidden="true">System</div>{option(nativeVoice, !macAvailable)}</div>
      </div>
      {active && <p className="reader-voice-picker__note">{macVoiceId(value) ? 'Switching from Mac voice restarts the passage.' : 'Continues from the current sentence.'}</p>}
      {pending && <p role="status" className="reader-voice-picker__note">Changing voice…</p>}
      {error && <p role="alert" className="reader-voice-picker__error">{error}</p>}
    </div>}
  </div>;
}
