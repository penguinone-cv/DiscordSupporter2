import { describe, expect, it, vi } from 'vitest';
import { connectActivity } from '../../activity/src/activityClient.js';

describe('Activity initialization', () => {
    function setup() {
        const sdk = {
            ready: vi.fn().mockResolvedValue(), guildId: 'guild', instanceId: 'instance',
            commands: { authorize: vi.fn().mockResolvedValue({ code: 'code' }), authenticate: vi.fn().mockResolvedValue({ user: { id: 'self' } }), setConfig: vi.fn().mockResolvedValue() },
            subscribe: vi.fn().mockResolvedValue(), unsubscribe: vi.fn().mockResolvedValue()
        };
        const api = { request: vi.fn().mockResolvedValueOnce({ enabled: true, clientId: 'app' }).mockResolvedValue({ accessToken: 'access', sessionToken: 'session' }), setToken: vi.fn(), setReauthenticate: vi.fn() };
        return { sdk, api, sdkFactory: () => sdk };
    }
    it('ready→identify認可→server検証→authenticateの順で接続する', async () => {
        const options = setup();
        await connectActivity({ ...options, onLayout: vi.fn() });
        expect(options.sdk.commands.authorize).toHaveBeenCalledWith(expect.objectContaining({ scope: ['identify'] }));
        expect(options.api.request).toHaveBeenCalledWith('/session', { method: 'POST', body: { code: 'code', instanceId: 'instance' }, authenticate: false });
        expect(options.sdk.commands.authenticate).toHaveBeenCalledWith({ access_token: 'access' });
        expect(options.api.setToken).toHaveBeenCalledWith('session');
    });
    it('初回通知がなくてもFocusedで開始し、その後のlayout更新を反映する', async () => {
        const options = setup();
        const onLayout = vi.fn();
        await connectActivity({ ...options, onLayout });

        expect(onLayout).toHaveBeenCalledWith(0);
        const listener = options.sdk.subscribe.mock.calls[0][1];
        listener({ layout_mode: 1 });
        expect(onLayout).toHaveBeenLastCalledWith(1);
    });
    it('通常ブラウザ・guildなしでは予定もsessionも取得しない', async () => {
        const options = setup();
        options.sdk.guildId = null;
        await expect(connectActivity({ ...options, onLayout: vi.fn() })).rejects.toThrow('メンバーパネル');
        expect(options.api.request).toHaveBeenCalledTimes(1);
    });
    it('layout購読が未対応なら無反応画面にせず更新案内を返す', async () => {
        const options = setup();
        options.sdk.subscribe.mockRejectedValue(new Error('unsupported'));
        await expect(connectActivity({ ...options, onLayout: vi.fn() })).rejects.toThrow('Discordを更新');
        expect(options.sdk.subscribe).toHaveBeenCalledTimes(1);
    });
});
