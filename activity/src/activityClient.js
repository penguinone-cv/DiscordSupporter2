const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discordから起動してください。接続できない場合はActivityを開き直してください。')), 15000); })]); }
    finally { clearTimeout(timer); }
};

export async function connectActivity({ api, sdkFactory, onLayout }) {
    const bootstrap = await api.request('/bootstrap', { authenticate: false });
    if (!bootstrap.enabled) throw new Error('カレンダーは準備中です。メンバーパネルの週表示をご利用ください。');
    let sdk;
    try { sdk = sdkFactory(bootstrap.clientId); }
    catch { throw new Error('Discordから起動してください。サーバーのメンバーパネルから開けます。'); }
    await bounded(sdk.ready());
    if (!sdk.guildId || !sdk.instanceId) throw new Error('サーバーのメンバーパネルから起動してください。DMでは利用できません。');
    const authenticate = async () => {
        const { code } = await bounded(sdk.commands.authorize({ client_id: bootstrap.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] }));
        const result = await api.request('/session', { method: 'POST', body: { code, instanceId: sdk.instanceId }, authenticate: false });
        const auth = await bounded(sdk.commands.authenticate({ access_token: result.accessToken }));
        if (!auth) throw new Error('Discordの認証に失敗しました。Activityを開き直してください。');
        api.setToken(result.sessionToken);
    };
    await authenticate();
    api.setReauthenticate(authenticate);
    await bounded(sdk.commands.setConfig({ use_interactive_pip: false })).catch(() => {});
    // Launches start focused, while Discord only reports later layout transitions.
    onLayout(0);
    const layout = update => onLayout(update.layout_mode);
    let cleanup;
    if (typeof sdk.subscribeToLayoutModeUpdatesCompat === 'function') {
        await bounded(sdk.subscribeToLayoutModeUpdatesCompat(layout));
        cleanup = () => sdk.unsubscribeFromLayoutModeUpdatesCompat(layout);
    } else {
        // SDK 2.x does not expose the compatibility helper yet.
        try {
            await bounded(sdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', layout));
            cleanup = () => sdk.unsubscribe('ACTIVITY_LAYOUT_MODE_UPDATE', layout);
        } catch {
            throw new Error('画面モードを確認できませんでした。Discordを更新してActivityを開き直してください。');
        }
    }
    return { sdk, disconnect: cleanup };
}
