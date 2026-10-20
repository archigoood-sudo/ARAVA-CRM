import { expect, it } from 'vitest';
import { IntegrationApiClient } from './integration-service';

it('advertises VK support only through the updated chat transport', async () => {
  let calls = 0;
  const api = new IntegrationApiClient((url, init) => {
    calls++;
    expect(url).toContain('/api/integration/v1/chats');
    expect(new Headers(init.headers).get('X-ARAVA-Chat-Channels')).toBe('vk');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer device-test-token');
    return Promise.resolve(
      Response.json({
        conversations: [],
        totalUnread: 0,
        serverTimestamp: '2026-10-20T12:00:00.000Z',
      }),
    );
  });
  await expect(
    api.listChats(
      'https://arava.example',
      'device-test',
      'device-test-token',
      { userId: 'owner', role: 'OWNER', name: 'Владелец', branchIds: [] },
      {},
    ),
  ).resolves.toMatchObject({ conversations: [], totalUnread: 0 });
  expect(calls).toBe(1);
});
