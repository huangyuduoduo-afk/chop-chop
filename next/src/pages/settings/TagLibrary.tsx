import { useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import { commit, getApp, snapshot } from '../../app/state';
import {
  allTagPaths, deleteTag, descendantTagIds, migrateTag, tagById, tagGoalRows, tagPath, tagRecordRows, tagTree, tagUsage,
  targetInsideSource, type TagNode, type TagSort,
} from '../../domain/tags';
import { normalizeTagPath } from '../../domain/shared';
import { Card, Chip, Empty, IconButton, Menu, ask, confirmAsk, toast } from '../../ui/kit';
import './settings.css';

const SORTS: { id: TagSort; label: string }[] = [
  { id: 'recent', label: '最近使用' }, { id: 'count', label: '使用次数' }, { id: 'created', label: '创建时间' },
];
const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString('zh-CN') : '还没有记录');
const fmtDT = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function SubHead({ title, sub, back, backLabel, children }: { title: string; sub?: string; back: () => void; backLabel: string; children?: preact.ComponentChildren }) {
  return (
    <div class="subhead">
      <IconButton icon="back" label={backLabel} onClick={back} />
      <div class="page-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children}
    </div>
  );
}

export function TagLibrary() {
  const { store } = getApp();
  const [sort, setSort] = useState<TagSort>('recent');
  const [open, setOpen] = useState<Set<string>>(() => new Set(store.get<string[]>('qyx_tag_tree_open', [])));
  const tree = tagTree(snapshot.value, sort);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
    store.setRaw('qyx_tag_tree_open', [...next]);
  };

  const branch = (nodes: TagNode[], depth: number): preact.JSX.Element[] => nodes.map((x) => {
    const isOpen = open.has(x.tag.id);
    return (
      <div class="tag-node" style={{ '--depth': depth }}>
        <div class="tag-row">
          {x.children.length
            ? <button type="button" class="tag-toggle" aria-label={isOpen ? '收起' : '展开'} aria-expanded={isOpen} onClick={() => toggle(x.tag.id)}>{isOpen ? '▾' : '▸'}</button>
            : <span class="tag-toggle spacer" />}
          <button type="button" class="tag-main" onClick={() => navigate('settings', 'tags', x.tag.id)}>
            <b>#{x.tag.name}</b>
            <span>{x.count} 条记录</span>
            <small>最近使用：{fmtDate(x.recent)}</small>
          </button>
        </div>
        {x.children.length > 0 && isOpen && <div class="tag-children">{branch(x.children, depth + 1)}</div>}
      </div>
    );
  });

  return (
    <div class="settings">
      <SubHead title="标签库" sub="这些路径都来自你亲手写下的 #标签。" back={() => navigate('settings')} backLabel="返回设置" />
      <div class="chips" role="group" aria-label="排序">
        {SORTS.map((o) => <Chip active={sort === o.id} onClick={() => setSort(o.id)}>{o.label}</Chip>)}
      </div>
      <Card>
        {tree.length ? branch(tree, 0) : <Empty>还没有标签。在记录里写下 #标签，就会出现在这里。</Empty>}
      </Card>
    </div>
  );
}

export function TagDetail({ tagId }: { tagId: string }) {
  const s = snapshot.value;
  const tag = tagById(s, tagId);
  const toLibrary = () => navigate('settings', 'tags');
  if (!tag) {
    return (
      <div class="settings">
        <SubHead title="标签库" back={toLibrary} backLabel="返回标签库" />
        <Empty>这个标签已经不在了。</Empty>
      </div>
    );
  }
  const path = tagPath(s, tagId);
  const use = tagUsage(s, tagId);
  const rows = tagRecordRows(s, tagId);
  const goals = tagGoalRows(s, tagId);

  function move(target: string, doneText: string) {
    const norm = normalizeTagPath(target);
    if (!norm || norm === path) return;
    if (targetInsideSource(snapshot.value, tagId, norm)) {
      toast(doneText === '标签已经合并。' ? '不能合并到自己的子标签。' : '新标签不能放进自己的子层级。', 3500);
      return;
    }
    const id = commit((d, c) => migrateTag(d, tagId, norm, c));
    toast(doneText);
    if (id) navigate('settings', 'tags', id);
  }

  async function rename() {
    const v = await ask({ title: '修改标签名称', text: '填写完整标签路径。', input: 'line', value: '#' + path, ok: '好' });
    if (v !== null) move(v, '标签和历史关联都迁移好了。');
  }

  async function merge() {
    const blocked = new Set(descendantTagIds(s, tagId));
    const choices = [{ label: '＋ 手写一个路径', value: '\u0000manual' }]
      .concat(allTagPaths(s).filter((x) => !blocked.has(x.id)).map((x) => ({ label: '#' + x.path, value: x.path })));
    const picked = await ask({ title: '合并标签', text: `把 #${path} 合并到哪一个标签？`, choices });
    if (picked === null) return;
    const target = picked === '\u0000manual'
      ? await ask({ title: '合并标签', text: '填写要合并到的完整标签路径。', input: 'line', placeholder: '#个人洞察/新想法' })
      : picked;
    if (target !== null) move(target, '标签已经合并。');
  }

  async function remove() {
    if (!(await confirmAsk('删除标签关系？', `删除 #${path} 及其子标签的关联？原记录不会删除。`, true))) return;
    commit((d, c) => deleteTag(d, tagId, c));
    toast('只删了标签关系，原记录还在。');
    toLibrary();
  }

  return (
    <div class="settings">
      <SubHead title={'#' + path} sub={`${use.count} 条记录 · 首次 ${fmtDate(use.first)} · 最近 ${fmtDate(use.recent)}`} back={toLibrary} backLabel="返回标签库">
        <Menu label="标签操作" items={[
          { label: '修改名称', onSelect: rename },
          { label: '合并标签', onSelect: merge },
          { label: '删除标签', danger: true, icon: 'trash', onSelect: remove },
        ]} />
      </SubHead>
      <Card title="关联记录">
        {rows.length ? rows.map((e) => (
          <article class="related"><time>{fmtDT(e.t)}</time><p>{e.text}</p></article>
        )) : <Empty>还没有关联记录。</Empty>}
      </Card>
      <Card title="相关目标">
        {goals.length ? goals.map((g) => (
          <article class="related"><time>{g.ym}</time><p>{g.text}</p></article>
        )) : <Empty>还没有关联目标。</Empty>}
      </Card>
    </div>
  );
}
