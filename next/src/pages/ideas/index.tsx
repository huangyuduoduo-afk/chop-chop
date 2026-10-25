/* 消息盒子: one card per idea; #/ideas/<id> = that idea's full timeline; #/ideas/new = new idea. */
import { useEffect, useState } from 'preact/hooks';
import { navigate, route } from '../../app/router';
import { snapshot } from '../../app/state';
import { Markdown } from '../../domain/markdown';
import { excerptText, fmtDT } from '../../domain/refs';
import {
  contentTime, findIdea, ideaHits, ideaLinks, ideaTitle, listIdeas, logRecord, readIdeas, recordTasks,
  type IdeaFilter,
} from '../../domain/ideas';
import { dayKey } from '../../core/util';
import type { Idea } from '../../core/types';
import { Button, Empty } from '../../ui/kit';
import { Icon } from '../../ui/icons';
import { Composer, EditRecordSheet } from '../record/Composer';
import { RecordMenu, TagChips, TaskList } from '../record/RecordParts';
import { IdeaIcon } from './IdeaIcon';
import { IdeaMenu } from './IdeaMenu';
import { readPrefs, writePrefs, type ViewPrefs } from './prefs';
import './ideas.css';
import { RecordPhotos } from '../record/photos/RecordPhotos';
import { StarButton } from '../record/calendar/StarButton';

let listScroll = 0;

const ORDERS: { v: ViewPrefs['order']; label: string }[] = [
  { v: 'recent', label: '最近更新' }, { v: 'oldest-update', label: '最早更新' },
  { v: 'created-new', label: '新建在前' }, { v: 'created-old', label: '最早建立' },
];
const FILTERS: { v: IdeaFilter; label: string }[] = [{ v: 'all', label: '全部' }, { v: 'open', label: '未完成' }, { v: 'completed', label: '已完成' }];

export default function IdeasPage() {
  const [id, recordId] = route.value.params;
  if (id === 'new') return <NewIdea />;
  if (id) return <IdeaDetail ideaId={id} jumpTo={recordId} />;
  return <IdeaList />;
}

/* ---------------- list ---------------- */

function IdeaList() {
  const s = snapshot.value;
  const [prefs, setPrefs] = useState(readPrefs);
  const [filter, setFilter] = useState<IdeaFilter>('all');
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => window.scrollTo(0, listScroll), 0); return () => clearTimeout(t); }, []);

  const list = listIdeas(s, { filter, query, order: prefs.order });
  const open = (idea: Idea, rec?: string) => { listScroll = window.scrollY; navigate('ideas', idea.id, ...(rec ? [rec] : [])); };

  return (
    <div class="ideas-page">
      <div class="ideas-head">
        <div>
          <small>一点一点，接着写</small>
          <h1>消息盒子</h1>
        </div>
        <Button variant="primary" icon="plus" onClick={() => navigate('ideas', 'new')}>记个想法</Button>
      </div>

      <div class="ideas-tools">
        <button type="button" class={`tool ${search ? 'on' : ''}`} aria-expanded={search} aria-label="搜索想法"
          onClick={() => { setSearch(!search); if (search) setQuery(''); }}><Icon name="search" size={16} /> 搜索</button>
        <label class="sort">排序
          <select value={prefs.order} onChange={(e) => setPrefs(writePrefs({ order: e.currentTarget.value as ViewPrefs['order'] }))}>
            {ORDERS.map((o) => <option value={o.v}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {search && (
        <input class="input" type="search" autoFocus aria-label="搜索想法" placeholder="标题、最初的念头、后来的补充" value={query}
          onInput={(e) => setQuery(e.currentTarget.value)} />
      )}
      <div class="pills" role="group" aria-label="筛选">
        {FILTERS.map((f) => (
          <button type="button" class={filter === f.v ? 'on' : ''} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>{f.label}</button>
        ))}
      </div>

      {list.length === 0 && (
        <Empty>{query || filter !== 'all' ? '没有匹配的想法。' : <>给一个想法留个位置。<br />以后想到什么，还能回来接着写。</>}</Empty>
      )}
      {list.map((i) => {
        const links = ideaLinks(s, i.id);
        const rows = links.map((l) => logRecord(s, l.recordId)).filter((r): r is NonNullable<typeof r> => !!r)
          .sort((a, b) => (b.updatedAt || b.t) - (a.updatedAt || a.t));
        const first = rows[0];
        const excerpt = excerptText(first?.text || (first && recordTasks(s, first.id).map((t) => t.text).join('、')) || '原始记录已移除，其他补充仍保留');
        const hits = ideaHits(s, i, query).slice(0, 3);
        return (
          <article class={`idea-card ${i.status === 'completed' ? 'done' : ''}`} key={i.id}>
            <button type="button" class="idea-main" onClick={() => open(i)}>
              <span class="idea-icon"><IdeaIcon name={i.icon} /></span>
              <span class="idea-text">
                <strong>{ideaTitle(s, i)}</strong>
                <span class="idea-excerpt">{excerpt}</span>
                <small>
                  内容更新 {fmtDT(contentTime(s, i))}{i.status === 'completed' ? ' · 已完成' : ''} · {links.filter((l) => l.role !== 'root').length} 次补充
                  {i.scheduledDate && <span class="chip tone-star date-chip">安排到 {i.scheduledDate}</span>}
                </small>
              </span>
            </button>
            <IdeaMenu idea={i} />
            {hits.length > 0 && (
              <div class="idea-hits">
                {hits.map((r) => <button type="button" onClick={() => open(i, r.id)}>{fmtDT(r.t)} · {excerptText(r.text || '').slice(0, 70)}</button>)}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ---------------- new idea ---------------- */

function NewIdea() {
  return (
    <div class="ideas-page">
      <button type="button" class="back-btn" onClick={() => navigate('ideas')}><Icon name="back" size={18} /> 消息盒子</button>
      <h1 class="detail-title">记个想法</h1>
      <section class="card">
        <Composer mode="new-idea" context="new-idea" autoFocus />
      </section>
    </div>
  );
}

/* ---------------- detail ---------------- */

function IdeaDetail({ ideaId, jumpTo }: { ideaId: string; jumpTo?: string }) {
  const s = snapshot.value;
  const idea = findIdea(s, ideaId);
  const [prefs, setPrefs] = useState(readPrefs);
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const set = (p: Partial<ViewPrefs>) => setPrefs(writePrefs(p));

  useEffect(() => {
    if (!jumpTo) return;
    setFlash(jumpTo);
    const t1 = setTimeout(() => document.getElementById('idea-rec-' + jumpTo)?.scrollIntoView({ block: 'center' }), 60);
    const t2 = setTimeout(() => setFlash(null), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [jumpTo, ideaId]);

  if (!idea) {
    return (
      <div class="ideas-page">
        <button type="button" class="back-btn" onClick={() => navigate('ideas')}><Icon name="back" size={18} /> 消息盒子</button>
        <Empty>这条想法不在消息盒子里了。</Empty>
      </div>
    );
  }

  const log = s.qyx_log || [];
  const all = ideaLinks(s, ideaId).sort((a, b) => (logRecord(s, a.recordId)?.t || a.linkedAt) - (logRecord(s, b.recordId)?.t || b.linkedAt) || a.id.localeCompare(b.id));
  const filtered = all.filter((l) => {
    const r = logRecord(s, l.recordId);
    const plain = !prefs.detailFrom && !prefs.detailTo && prefs.detailKind === 'all';
    if (!r) return plain;
    const day = dayKey(r.t);
    if ((prefs.detailFrom && day < prefs.detailFrom) || (prefs.detailTo && day > prefs.detailTo)) return false;
    if (prefs.detailKind === 'plan' && !recordTasks(s, r.id).length && !/^\s*[-*]\s+\[[ xX]\]/m.test(r.text)) return false;
    return true;
  });
  // opened on a specific record: relax filters (v5 behaviour)
  const relaxed = !!jumpTo && !filtered.some((l) => l.recordId === jumpTo);
  const shown = relaxed ? all.filter((l) => l.recordId === jumpTo || filtered.includes(l)) : filtered;
  if (prefs.detailOrder === 'newest') shown.reverse();
  const events = readIdeas(s).events.filter((e) => e.ideaId === ideaId).sort((a, b) => a.t - b.t);
  const filterActive = !!(prefs.detailFrom || prefs.detailTo || prefs.detailKind !== 'all');
  let prevDay = '';

  return (
    <div class="ideas-page idea-detail">
      <button type="button" class="back-btn" onClick={() => navigate('ideas')}><Icon name="back" size={18} /> 消息盒子</button>
      <div class="detail-head">
        <span class="idea-icon big"><IdeaIcon name={idea.icon} size={26} /></span>
        <h1 class="detail-title">{ideaTitle(s, idea)}</h1>
        <IdeaMenu idea={idea} detail />
      </div>
      <p class="detail-status">
        {idea.status === 'completed' && <span>已完成 · 仍然可以接着写</span>}
        {idea.scheduledDate && <span class="chip tone-star">安排到 {idea.scheduledDate}</span>}
      </p>

      <details class="detail-tools" open={filterActive}>
        <summary>筛选与排序{filterActive ? ' · 已筛选' : ''}</summary>
        <div class="tools-grid">
          <label>顺序
            <select value={prefs.detailOrder} onChange={(e) => set({ detailOrder: e.currentTarget.value as ViewPrefs['detailOrder'] })}>
              <option value="oldest">从旧到新</option><option value="newest">最新在前</option>
            </select>
          </label>
          <label>从 <input type="date" value={prefs.detailFrom} onChange={(e) => set({ detailFrom: e.currentTarget.value })} /></label>
          <label>到 <input type="date" value={prefs.detailTo} onChange={(e) => set({ detailTo: e.currentTarget.value })} /></label>
          <label>内容
            <select value={prefs.detailKind} onChange={(e) => set({ detailKind: e.currentTarget.value as ViewPrefs['detailKind'] })}>
              <option value="all">全部内容</option><option value="plan">含计划</option>
            </select>
          </label>
          <Button small variant="soft" onClick={() => set({ detailFrom: '', detailTo: '', detailKind: 'all' })}>全部过程</Button>
        </div>
      </details>
      {relaxed && <p class="hint">已定位到搜索结果；本次暂时放宽了筛选。</p>}

      <div class="timeline">
        {shown.length === 0 && <Empty>当前条件下没有匹配内容。可以点「全部过程」回来看看。</Empty>}
        {shown.map((l) => {
          const r = logRecord(s, l.recordId);
          const day = r ? dayKey(r.t) : '';
          const marker = day && day !== prevDay ? <h3 class="day-marker">{day}</h3> : null;
          prevDay = day || prevDay;
          return (
            <>
              {marker}
              <article class={`tl-item ${flash === l.recordId ? 'ref-hit' : ''}`} id={'idea-rec-' + l.recordId} key={l.id}>
                <header>
                  <small>{l.role === 'root' ? '最初写下' : '接着写'} · {r ? fmtDT(r.t) : '记录已删除'}{r && r.updatedAt && r.updatedAt > r.t + 1000 ? ' · 编辑过' : ''}</small>
                  {r && <StarButton record={r} />}
                  {r && <RecordMenu recordId={r.id} type={r.type} onEdit={setEditing} insideIdea={ideaId} />}
                </header>
                {r ? (
                  <>
                    {r.text && <Markdown text={r.text} log={log} onGo={(t) => navigate('record', t.id)} />}
                    <RecordPhotos record={r} />
                    <TaskList recordId={r.id} />
                    <TagChips recordId={r.id} />
                  </>
                ) : <p class="faint">这条记录已从说说中删除。其余补充仍然保留。</p>}
              </article>
            </>
          );
        })}
      </div>

      {events.length > 0 && (
        <div class="events">{events.map((e) => <small>{fmtDT(e.t)} · {e.event === 'completed' ? '标记完成' : '重新打开'}</small>)}</div>
      )}

      <section class="card append-card">
        <h2>接着写</h2>
        <Composer key={ideaId} mode="append" context={'idea:' + ideaId} ideaId={ideaId} />
      </section>
      {editing && <EditRecordSheet recordId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
