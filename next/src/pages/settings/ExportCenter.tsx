import { useState } from 'preact/hooks';
import { navigate } from '../../app/router';
import { APP_VERSION, getApp, snapshot, today } from '../../app/state';
import {
  EXPORT_PARTS, buildExportBundle, buildExportMarkdown, exportFileName, exportJson, exportPrintHtml, exportRange,
  type ExportPart, type RangeMode,
} from '../../domain/export';
import { Button, Card, Chip, IconButton, toast } from '../../ui/kit';
import { downloadImage, downloadText, printHtml } from './io';
import './settings.css';

const MODES: { id: RangeMode; label: string }[] = [
  { id: 'day', label: '某一天' }, { id: 'week', label: '某一周' }, { id: 'month', label: '某一个月' }, { id: 'custom', label: '自定义日期' },
];
type Format = 'markdown' | 'pdf' | 'json' | 'image';

export default function ExportCenter({ presetDay }: { presetDay?: string }) {
  const { clock } = getApp();
  const start = presetDay && /^\d{4}-\d{2}-\d{2}$/.test(presetDay) ? presetDay : today.value;
  const [mode, setMode] = useState<RangeMode>('day');
  const [anchor, setAnchor] = useState(start);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(start);
  const [parts, setParts] = useState<Set<ExportPart>>(new Set(EXPORT_PARTS.map((p) => p.id)));
  const [hint, setHint] = useState('');

  const togglePart = (id: ExportPart) => {
    const next = new Set(parts);
    if (next.has(id)) next.delete(id); else next.add(id);
    setParts(next);
  };

  function run(format: Format) {
    try {
      const range = exportRange(mode, anchor, from, to, clock.now());
      const bundle = buildExportBundle(snapshot.value, range, parts, { version: APP_VERSION, exportedAt: clock.now() });
      if (format === 'markdown') downloadText(exportFileName(bundle, 'md'), buildExportMarkdown(bundle), 'text/markdown;charset=utf-8');
      if (format === 'json') downloadText(exportFileName(bundle, 'json'), exportJson(bundle), 'application/json;charset=utf-8');
      if (format === 'pdf') printHtml(exportPrintHtml(bundle));
      if (format === 'image') downloadImage(exportFileName(bundle, 'png'), buildExportMarkdown(bundle), bundle.meta.from + ' 至 ' + bundle.meta.to);
      const ext = format === 'json' ? 'json' : format === 'image' ? 'png' : 'md';
      setHint(format === 'pdf' ? '打印窗口已打开，请在其中选择“存储为 PDF”。'
        : '已请求下载 ' + exportFileName(bundle, ext) + '；若未看到文件，请检查浏览器下载列表。');
      toast(format === 'pdf' ? '请在打印窗口存为 PDF' : '已请求下载，请查看下载列表');
    } catch (e) {
      const message = (e as Error).message || '导出失败，请重试。';
      setHint(message);
      toast('导出失败：' + message, 3500);
    }
  }

  return (
    <div class="settings">
      <div class="subhead">
        <IconButton icon="back" label="返回设置" onClick={() => navigate('settings')} />
        <div class="page-title"><h1>导出中心</h1><p>选好时间和内容后，直接点击下方的格式按钮下载。</p></div>
      </div>
      <Card title="时间范围" icon="calendar">
        <div class="chips" role="group" aria-label="时间范围">
          {MODES.map((m) => <Chip active={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</Chip>)}
        </div>
        {mode !== 'custom' ? (
          <label class="field"><span>选择日期</span><input class="input" type="date" value={anchor} onInput={(e) => setAnchor(e.currentTarget.value)} /></label>
        ) : (
          <div class="two">
            <label class="field"><span>开始</span><input class="input" type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
            <label class="field"><span>结束</span><input class="input" type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} /></label>
          </div>
        )}
      </Card>
      <Card title="导出内容" icon="list">
        <div class="checks">
          {EXPORT_PARTS.map((p) => (
            <label class="switch"><input type="checkbox" checked={parts.has(p.id)} onChange={() => togglePart(p.id)} /><span>{p.label}</span></label>
          ))}
        </div>
      </Card>
      <Card title="点击格式即可导出" icon="export">
        <div class="row wrap">
          <Button variant="primary" onClick={() => run('markdown')}>下载 Markdown</Button>
          <Button variant="soft" onClick={() => run('pdf')}>打印 / 存为 PDF</Button>
          <Button variant="soft" onClick={() => run('json')}>下载 JSON</Button>
          <Button variant="soft" onClick={() => run('image')}>下载图片长图</Button>
        </div>
        <p class="status" aria-live="polite">{hint}</p>
      </Card>
    </div>
  );
}
