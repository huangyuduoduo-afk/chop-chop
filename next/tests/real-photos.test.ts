/* Opt-in: REAL_GH_TOKEN=… npx vitest run tests/real-photos.test.ts — put/get/remove one tiny synthetic file in the private photos repo. */
import { PhotoRepo } from '../src/core/photos';

const TOKEN = process.env.REAL_GH_TOKEN || '';

describe.skipIf(!TOKEN)('real private photo repo', () => {
  it('uploads, reads back through the API, rejects anonymous access, and deletes', async () => {
    const repo = new PhotoRepo(TOKEN);
    const path = `_test/synthetic-${Date.now()}.txt`;
    await repo.put(path, new Blob(['合成测试图片内容']));
    await repo.put(path, new Blob(['合成测试图片内容'])); // idempotent retry
    expect(await (await repo.get(path)).text()).toBe('合成测试图片内容');
    const owner = await repo.owner();
    const anon = await fetch(`https://api.github.com/repos/${owner}/chopchop-photos/contents/${path}`);
    expect(anon.status).toBe(404); // private: invisible without the token
    await repo.remove(path);
    await expect(repo.get(path)).rejects.toThrow();
  }, 60_000);
});
