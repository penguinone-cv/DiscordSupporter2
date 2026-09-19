export function getRecruitmentProvider(config) {
    const configured = config.get('features.recruitmentDetection.provider');
    const provider = configured === undefined ? 'openai' : configured;
    if (!['openai', 'jev'].includes(provider)) {
        throw new Error('"features.recruitmentDetection.provider" は openai / jev を指定してください');
    }
    return provider;
}

export function getJevSettings(config) {
    const setting = (name, fallback) => config.get(`jev.${name}`) === undefined ? fallback : config.get(`jev.${name}`);
    const apiKey = config.get('jev.apiKey') || process.env.TYPESAFE_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.includes('YOUR_')) {
        throw new Error('"jev.apiKey" または TYPESAFE_API_KEY を設定してください');
    }
    const model = setting('model', 'jev-latest');
    if (typeof model !== 'string' || !model.trim()) throw new Error('"jev.model" は空でない文字列です');
    const threshold = setting('threshold', 0.8);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        throw new Error('"jev.threshold" は 0 より大きく 1 以下の数値です');
    }
    const timeoutMs = setting('timeoutMs', 10000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
        throw new Error('"jev.timeoutMs" は 100 以上 60000 以下の整数です');
    }
    return { apiKey, model, threshold, timeoutMs };
}
