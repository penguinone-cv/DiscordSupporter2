export function createApi({ fetchFn = globalThis.fetch, basePath = '/api/activity/schedule' } = {}) {
    let token = null;
    let reauthenticate;
    let refreshing;
    async function request(path, { method = 'GET', body, authenticate = true } = {}, canRetry = true) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response, payload;
        try {
            response = await fetchFn(`${basePath}${path}`, {
                method, signal: controller.signal, cache: 'no-store', credentials: 'omit',
                headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authenticate && token ? { Authorization: `Bearer ${token}` } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            payload = await response.json();
        } catch {
            throw new Error('通信できませんでした。接続を確認して再試行してください。');
        } finally { clearTimeout(timer); }
        if (response.status === 401 && authenticate && canRetry && reauthenticate) {
            refreshing ??= Promise.resolve().then(reauthenticate).finally(() => { refreshing = null; });
            await refreshing;
            return request(path, { method, body, authenticate }, false);
        }
        if (!response.ok) throw Object.assign(new Error(payload?.error?.message ?? '予定を取得・保存できませんでした'), { status: response.status, code: payload?.error?.code });
        return payload;
    }
    return { request, setToken: value => { token = value; }, setReauthenticate: fn => { reauthenticate = fn; } };
}
