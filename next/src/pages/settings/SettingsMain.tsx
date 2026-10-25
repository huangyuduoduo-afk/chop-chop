import { useState } from 'preact/hooks';
import { normalizeProvider } from '../../core/ai';
import { GistClient } from '../../core/gist';
import { Button, Card, Menu, Sheet, confirmAsk, toast } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { navigate } from '../../app/router';
import { APP_VERSION, commit, dirty, getApp, snapshot, syncMessage, syncNow, syncStatus } from '../../app/state';
import {
  buildFullBackup, collectLocalRecovery, currentDicePool, fullBackupFileName, mergeInto, normalizeImport,
  parsePoolText, restorableRecovery, saveSettings, validateImport,
} from '../../domain/settings';
import { downloadText } from './io';
import './settings.css';
import { PhotoSettings } from './PhotoSettings';

const PROVIDERS = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（更强，稍慢）' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（快，日常）' },
  { value: 'anthropic', label: 'Claude（Anthropic）' },
];

const fmtLast = (t: number) => (t ? '上次同步：' + new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function nudgeRatio(raw: any, nowMs: number): string {
  const cutoff = nowMs - 14 * 864e5;
  let shown = 0, acted = 0;
  Object.entries(raw?.days || {}).forEach(([key, v]: [string, any]) => {
    if (new Date(key + 'T12:00:00').getTime() >= cutoff) { shown += v.shown || 0; acted += v.acted || 0; }
  });
  return shown ? `开屏提醒响应：${acted}/${shown}（${Math.round((acted / shown) * 100)}%）` : '开屏提醒响应：尚无数据';
}

const fmtRev = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface History { open: boolean; loading: boolean; error: string; gistId: string; items: { version: string; committed_at: string }[]; busy: string }

export default function SettingsMain() {
  const { store, clock } = getApp();
  const snap = snapshot.value;
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const [tokenInput, setTokenInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [provider, setProvider] = useState(() => normalizeProvider(snap.qyx_provider ?? store.get<string>('qyx_provider', '')));
  const [sit, setSit] = useState(() => (typeof snap.qyx_sit_reminder === 'string' ? snap.qyx_sit_reminder : '站起来走走'));
  const [pool, setPool] = useState(() => currentDicePool(snap).join('\n'));
  const [reviewHint, setReviewHint] = useState(() => store.get<number>('qyx_review_hint', 1) !== 0);
  const [motion, setMotion] = useState(() => store.get<boolean>('qyx_v5_motion', true) !== false);
  const [importStatus, setImportStatus] = useState('');
  const [hist, setHist] = useState<History>({ open: false, loading: false, error: '', gistId: '', items: [], busy: '' });

  const hasToken = !!store.token;
  const hasKey = !!store.get<string>('qyx_key', '');
  const st = syncStatus.value;
  const statusLine = st === 'busy' ? '正在同步…' : st === 'error' ? '同步失败：' + syncMessage.value
    : st === 'ok' ? syncMessage.value : fmtLast(store.lastBackup);

  async function connect() {
    if (syncStatus.value === 'busy') return;
    const v = tokenInput.trim();
    if (v) { store.token = v; setTokenInput(''); }
    if (!store.token) { toast('先填 GitHub token'); return; }
    refresh();
    const out = await syncNow({ full: true });
    toast(out.ok ? '同步好了。' : '同步失败：' + out.message, out.ok ? 1800 : 4000);
  }

  async function removeToken() {
    if (!(await confirmAsk('移除 GitHub token？', '只影响这台设备，云端数据不动；之后不再自动同步。', true))) return;
    store.token = '';
    refresh();
    toast('已移除。');
  }

  function save() {
    if (keyInput.trim()) { store.setRaw('qyx_key', keyInput.trim()); setKeyInput(''); }
    store.setRaw('qyx_review_hint', reviewHint ? 1 : 0);
    commit((d, c) => saveSettings(d, { provider, sitReminder: sit, dicePool: parsePoolText(pool) }, c));
    setPool(currentDicePool(snapshot.value).join('\n'));
    refresh();
    toast('保存了。');
  }

  async function removeKey() {
    if (!(await confirmAsk('移除 AI key？', '只影响这台设备。', true))) return;
    store.setRaw('qyx_key', '');
    refresh();
    toast('已移除。');
  }

  function setMotionPref(on: boolean) {
    setMotion(on);
    store.setRaw('qyx_v5_motion', on);
    document.body.classList.toggle('v5-motion-off', !on);
  }

  function downloadBackup() {
    const b = buildFullBackup(snapshot.value, APP_VERSION, new Date(clock.now()), collectLocalRecovery(localStorage));
    downloadText(fullBackupFileName(clock.now()), JSON.stringify(b, null, 2), 'application/json');
    toast('已请求下载，请查看下载列表');
  }

  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const norm = normalizeImport(JSON.parse(await file.text()));
      validateImport(norm.data);
      // Safety copy of everything on this device first (legacy qyx_preimport_snapshot).
      store.setRaw('qyx_preimport_snapshot', buildFullBackup(snapshot.value, APP_VERSION, new Date(clock.now()), collectLocalRecovery(localStorage)));
      if (norm.rangeSource) { try { store.setRaw('qyx_range_import_v5', norm.rangeSource); } catch { /* local-only copy, optional */ } }
      commit((d, c) => mergeInto(d, norm.data, c));
      for (const [k, v] of Object.entries(restorableRecovery(norm.data))) if (localStorage.getItem(k) === null) store.setRaw(k, v);
      setImportStatus('已合并导入，导入前快照已保留。范围导出只恢复文件实际包含的记录。');
      if (store.token) void syncNow();
    } catch (err) {
      setImportStatus('导入未完成：' + ((err as Error).message || String(err)));
    }
    input.value = '';
  }

  async function openHistory() {
    if (!store.token) { toast('先在上面填 GitHub token'); return; }
    setHist({ open: true, loading: true, error: '', gistId: '', items: [], busy: '' });
    try {
      const client = new GistClient(store.token);
      let id = store.gistId;
      if (!id) id = (await client.listBackupGists())[0] || '';
      if (!id) throw new Error('云端没有备份');
      const items = await client.revisions(id, 20);
      setHist({ open: true, loading: false, error: '', gistId: id, items, busy: '' });
    } catch (err) {
      setHist({ open: true, loading: false, error: (err as Error).message || String(err), gistId: '', items: [], busy: '' });
    }
  }

  async function restore(version: string) {
    setHist((h) => ({ ...h, busy: version, error: '' }));
    try {
      const rev = await new GistClient(store.token).readRevision(hist.gistId, version);
      const changed = commit((d, c) => mergeInto(d, rev, c));
      toast(changed ? '并回来了。' : '这份里没有本机缺的东西。');
      setHist({ open: false, loading: false, error: '', gistId: '', items: [], busy: '' });
      void syncNow();
    } catch (err) {
      setHist((h) => ({ ...h, busy: '', error: '取不到这个版本：' + ((err as Error).message || String(err)) }));
    }
  }

  return (
    <div class="settings">
      <div class="page-title"><h1>设置</h1><p>版本 {APP_VERSION}</p></div>

      <Card title="云同步（GitHub）" icon="sync" sub="本机和云端合并，两边记录取并集，谁也不会覆盖谁。平时不用管，改动后会自动同步。">
        <label class="field">
          <span>GitHub token</span>
          <input class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck={false}
            placeholder={hasToken ? '已保存（不显示）· 留空表示不改' : 'ghp_… 或 github_pat_…'}
            value={tokenInput} onInput={(e) => setTokenInput(e.currentTarget.value)} />
        </label>
        <div class="row">
          <Button variant="primary" icon="sync" onClick={connect}>{hasToken || !tokenInput ? '立即同步' : '保存并同步'}</Button>
          <Button variant="ghost" onClick={openHistory}>历史版本</Button>
          {hasToken && <Menu label="更多同步选项" items={[{ label: '移除 token', danger: true, onSelect: removeToken }]} />}
        </div>
        <p class="status" aria-live="polite">{statusLine}{dirty.value && st !== 'busy' ? '（有改动未同步）' : ''}</p>
      </Card>

      <PhotoSettings />
      <Card title="AI 服务" icon="sparkle">
        <label class="field">
          <span>服务</span>
          <select class="input" value={provider} onChange={(e) => setProvider(e.currentTarget.value)}>
            {PROVIDERS.map((p) => <option value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label class="field">
          <span>API key</span>
          <input class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck={false}
            placeholder={hasKey ? '已保存（不显示）· 留空表示不改' : 'sk-…'} value={keyInput} onInput={(e) => setKeyInput(e.currentTarget.value)} />
        </label>
        <p class="note">key 只存在这台设备的浏览器里。DeepSeek 的 key 记得把上面服务也切过去。{hasKey && <button type="button" class="link" onClick={removeKey}>移除 key</button>}</p>
        <label class="switch"><input type="checkbox" checked={reviewHint} onChange={(e) => setReviewHint(e.currentTarget.checked)} /><span>回望积累了足够材料时，显示一行轻提示</span></label>
      </Card>

      <Card title="久坐提醒与最小动作池" icon="dice">
        <label class="field">
          <span>久坐提醒</span>
          <input class="input" value={sit} placeholder="比如：站起来走走" onInput={(e) => setSit(e.currentTarget.value)} />
        </label>
        <p class="note">记录页底部的小提醒，可以改成你当下最需要的动作。</p>
        <label class="field">
          <span>最小动作池</span>
          <textarea class="textarea" rows={6} value={pool} onInput={(e) => setPool(e.currentTarget.value)} />
        </label>
        <p class="note">一行一个，全是「一点点」级别的动作。本月里拆出来的小选项也会自动混进抽签池。</p>
        <div class="row"><Button variant="primary" onClick={save}>保存</Button></div>
      </Card>

      <Card title="个人数据" icon="export" sub="按日期和内容导出，不影响本机记录。">
        <div class="links">
          <button type="button" class="link-row" onClick={() => navigate('settings', 'export')}><span>打开导出中心</span><Icon name="chevron" size={18} /></button>
          <button type="button" class="link-row" onClick={() => navigate('settings', 'tags')}><span>标签库</span><Icon name="chevron" size={18} /></button>
        </div>
        <p class="note">{nudgeRatio(store.get('qyx_nudge_local', null), clock.now())}</p>
      </Card>

      <Card title="留下与恢复" icon="star">
        <label class="switch"><input type="checkbox" checked={motion} onChange={(e) => setMotionPref(e.currentTarget.checked)} /><span>轻柔动效</span></label>
        <div class="row">
          <Button variant="soft" icon="export" onClick={downloadBackup}>下载完整备份</Button>
          <label class="btn btn-soft file-btn">
            <span>导入备份</span>
            <input type="file" accept=".json,application/json" onChange={importFile} aria-label="导入备份" />
          </label>
        </div>
        <p class="note">导入是合并，不会覆盖或删除本机已有记录；导入前会自动留一份快照。备份文件不含 token 和 key。</p>
        {importStatus && <p class="status" role="status">{importStatus}</p>}
        <a class="link" href="recovery.html">只读恢复页</a>
      </Card>

      <Sheet open={hist.open} onClose={() => setHist({ ...hist, open: false })} title="历史版本">
        {hist.loading && <p class="note">在找…</p>}
        {hist.error && <p class="status error" role="alert">{hist.error}</p>}
        {!hist.loading && hist.items.length > 0 && <>
          <p class="note">点一个时间点，把那份数据并回来（只加不减）：</p>
          <div class="rev-list">
            {hist.items.map((r) => (
              <button type="button" class="choice" disabled={!!hist.busy} onClick={() => restore(r.version)}>
                {fmtRev(r.committed_at)}{hist.busy === r.version ? ' …' : ''}
              </button>
            ))}
          </div>
        </>}
      </Sheet>
    </div>
  );
}
