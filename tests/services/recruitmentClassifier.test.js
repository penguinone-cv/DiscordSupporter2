import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import config from '../../src/config/configLoader.js';
import openaiService from '../../src/services/openaiService.js';
import { classifyRecruitment } from '../../src/services/recruitmentClassifier.js';
vi.mock('../../src/services/openaiService.js', () => ({ default: { chatJSON: vi.fn() } }));
const examples = [{ message: '一緒に遊ぼう', is_recruitment: 'true', reason: '呼びかけ' }];
beforeEach(() => { config.config = { jev: { apiKey: 'test-key', threshold: 0.7 } }; });
afterEach(() => { vi.unstubAllGlobals(); config.config = null; });
const respond = (answer) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'jev-test', answers: { recruitment: answer } }) }));
describe('Recruitment classifier', () => {
    it('uses the evaluated default threshold when config omits it', async () => {
        delete config.config.jev.threshold;
        respond({ type: 'noul', noul: 0.71 });
        expect((await classifyRecruitment('jev', '引用だけ', [])).isRecruitment).toBe(false);
        respond({ type: 'noul', noul: 0.8 });
        expect((await classifyRecruitment('jev', '参加者募集', [])).isRecruitment).toBe(true);
    });
    it.each([[0, false], [0.69, false], [0.7, true], [1, true]])('Jev probability %s => %s and empty reason', async (noul, expected) => {
        respond({ type: 'noul', noul });
        const result = await classifyRecruitment('jev', '今夜いかが？', examples);
        expect(result).toMatchObject({ isRecruitment: expected, reason: '', probability: noul });
        expect(openaiService.chatJSON).not.toHaveBeenCalled();
        const [url, options] = fetch.mock.calls[0];
        expect(url).toBe('https://api.typesafe.ai/v1/systemone');
        expect(options.headers.Authorization).toBe('Bearer test-key');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.redirect).toBe('error');
        const body = JSON.parse(options.body);
        expect(body.model).toBe('jev-latest');
        expect(body.state.targetMessage).toBe('今夜いかが？');
        expect(body.state.referenceExamples[0].isRecruitment).toBe(true);
        expect(body.questions.recruitment.type).toBe('noul');
    });
    it.each([null, {}, { type: 'choice', noul: 1 }, { type: 'noul', noul: '1' }, { type: 'noul', noul: -1 }, { type: 'noul', noul: 1.01 }, { type: 'noul', noul: NaN }])('rejects invalid response %j', async answer => {
        respond(answer);
        await expect(classifyRecruitment('jev', 'x', [])).rejects.toThrow('invalid');
    });
    it.each([401, 422, 429, 529])('does not fallback or expose response body on HTTP %s', async status => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: vi.fn() }));
        await expect(classifyRecruitment('jev', 'x', [])).rejects.toThrow(`Jev HTTP ${status}`);
        expect(openaiService.chatJSON).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('propagates timeout and invalid JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
        await expect(classifyRecruitment('jev', 'x', [])).rejects.toThrow('timeout');
        fetch.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('json'); } });
        await expect(classifyRecruitment('jev', 'x', [])).rejects.toThrow('json');
    });
    it('aborts a stalled request at the configured deadline', async () => {
        config.config.jev.timeoutMs = 100;
        vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        })));
        await expect(classifyRecruitment('jev', 'x', [])).rejects.toMatchObject({ name: 'TimeoutError' });
        expect(openaiService.chatJSON).not.toHaveBeenCalled();
    });
    it('separates OpenAI instructions from data and validates boolean', async () => {
        openaiService.chatJSON.mockResolvedValue({ isRecruitment: false, reason: '募集終了' });
        await expect(classifyRecruitment('openai', '終了', examples)).resolves.toEqual({ isRecruitment: false, reason: '募集終了' });
        const messages = openaiService.chatJSON.mock.calls[0][0];
        expect(JSON.parse(messages[1].content).targetMessage).toBe('終了');
        expect(messages[0].content).not.toContain(examples[0].message);
        openaiService.chatJSON.mockResolvedValue({ isRecruitment: 'false', reason: '' });
        await expect(classifyRecruitment('openai', 'x', [])).rejects.toThrow('invalid');
    });
});
