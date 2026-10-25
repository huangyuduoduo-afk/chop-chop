/*
 * Basic voice input (Web Speech API). No audio is stored. The live transcript is written into the
 * textarea (and so the draft) as it arrives, so nothing is lost if the page dies.
 *   start -> listening <-> paused (暂停/继续) -> finish (keep text) | cancel (restore text from before)
 * The textarea is read-only while listening and editable again after pause/finish.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

type Phase = 'idle' | 'starting' | 'listening' | 'paused';

const ERRORS: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置里允许',
  'service-not-allowed': '麦克风权限被拒绝，请在浏览器设置里允许',
  'no-speech': '没有听到声音',
  'audio-capture': '没有找到麦克风',
  network: '语音识别需要联网',
};

const getSR = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

export function useVoice(getEl: () => HTMLTextAreaElement | null, write: (value: string) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [time, setTime] = useState('00:00');
  const st = useRef({ rec: null as any, original: '', base: '', started: 0, elapsed: 0, phase: 'idle' as Phase, error: '' });
  const SR = getSR();

  const go = (p: Phase) => { st.current.phase = p; setPhase(p); };

  useEffect(() => {
    const timer = setInterval(() => {
      const s = st.current;
      setTime(mmss(s.elapsed + (s.phase === 'listening' ? Date.now() - s.started : 0)));
    }, 400);
    const hidden = () => { if (document.hidden) pause('页面已进入后台，识别已暂停'); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      try { st.current.rec?.abort(); } catch { /* ignore */ }
    };
  }, []);

  function segment() {
    const s = st.current;
    const el = getEl();
    if (!SR || !el) return;
    s.base = el.value && !el.value.endsWith('\n') ? el.value + '\n' : el.value;
    s.error = '';
    const rec = new SR();
    s.rec = rec;
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    go('starting');
    setMessage('正在请求麦克风权限…');
    rec.onstart = () => {
      if (s.rec !== rec) return;
      s.started = Date.now();
      go('listening');
      setMessage('正在听…');
    };
    rec.onresult = (e: any) => {
      if (s.rec !== rec) return;
      const text = Array.from(e.results as ArrayLike<any>).map((r) => r[0]?.transcript || '').join('');
      if (text) write(s.base + text);
    };
    rec.onerror = (e: any) => {
      if (s.rec !== rec) return;
      s.error = (ERRORS[e.error] || '语音识别出错了') + '。已识别的文字会保留。';
    };
    rec.onend = () => {
      if (s.rec !== rec) return;
      if (s.phase === 'listening') s.elapsed += Date.now() - s.started;
      s.rec = null;
      if (s.phase !== 'idle') {
        go('paused');
        setMessage(s.error || '已暂停，可继续或完成');
      }
    };
    try { rec.start(); } catch (err) {
      s.rec = null;
      go('paused');
      setMessage('语音启动失败，可以重试：' + (err instanceof Error ? err.message : ''));
    }
  }

  function pause(msg = '已暂停，可继续或完成') {
    const s = st.current;
    if (s.phase !== 'listening' && s.phase !== 'starting') return;
    if (s.phase === 'listening') s.elapsed += Date.now() - s.started;
    go('paused');
    setMessage(msg);
    try { s.rec?.stop(); } catch { /* ignore */ }
  }

  return {
    supported: !!SR,
    phase,
    message,
    time,
    start() {
      const el = getEl();
      if (!SR || !el || st.current.phase !== 'idle') return;
      st.current.original = el.value;
      st.current.elapsed = 0;
      segment();
    },
    toggle() {
      const s = st.current;
      if (s.phase === 'paused' && !s.rec) segment();
      else pause();
    },
    finish() {
      const s = st.current;
      if (s.phase === 'listening') s.elapsed += Date.now() - s.started;
      go('idle');
      try { s.rec?.stop(); } catch { /* ignore */ } // keep s.rec: the last words arrive before onend
      getEl()?.focus();
    },
    cancel() {
      const s = st.current;
      go('idle');
      try { s.rec?.abort(); } catch { /* ignore */ }
      s.rec = null;
      write(s.original);
      getEl()?.focus();
    },
  };
}
