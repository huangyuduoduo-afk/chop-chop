/* Photo storage status and token help in settings. Never shows the token. */
import { useState } from 'preact/hooks';
import { drainPhotos, photoStatus } from '../../app/photos';
import { PHOTO_REPO_NAME } from '../../core/photos';
import { needsPermissionHelp, pendingPhotos } from '../record/photos/photoLogic';
import { Button, Card, toast } from '../../ui/kit';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function PhotoSettings() {
  const { pending, lastError } = photoStatus.value;
  const [busy, setBusy] = useState(false);
  const count = pendingPhotos(pending);

  async function upload() {
    if (busy) return;
    setBusy(true);
    try {
      await drainPhotos();
      const after = photoStatus.value;
      toast(after.pending ? '还有图片没传上去。' : '图片都传好了。', 2200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="图片" icon="inbox" sub={`图片存在你自己的私有仓库 ${PHOTO_REPO_NAME}，不会发给 AI。`}>
      <p class={`status ${lastError ? 'error' : ''}`} role="status" aria-live="polite">
        {count > 0 ? `待上传 ${count} 张` : '没有待上传的图片'}
        {lastError ? ` · ${lastError}` : ''}
      </p>
      <div class="row">
        <Button small variant="soft" disabled={busy || (count === 0 && !lastError)} aria-busy={busy} onClick={upload}>
          {busy ? '上传中…' : '立即上传'}
        </Button>
      </div>
      <p class="note">
        记下带图片的记录时，图片先存在这台设备上，再慢慢传到 {PHOTO_REPO_NAME}（需要先在 GitHub 里建好这个私有仓库）。换设备后，传好的图片会自动取回来。
      </p>
      {needsPermissionHelp(lastError) && (
        <div class="note" role="note">
          <p>令牌需要能读写这个仓库。请新建一个细粒度令牌（fine-grained token）：</p>
          <ul>
            <li>Repository access：只选 {PHOTO_REPO_NAME}</li>
            <li>Repository permissions → Contents：Read and write</li>
            <li>Account permissions → Gists：Read and write（云同步需要）</li>
          </ul>
          <a class="link" href={TOKEN_URL} target="_blank" rel="noopener noreferrer">去 GitHub 新建令牌 ↗</a>
        </div>
      )}
    </Card>
  );
}
