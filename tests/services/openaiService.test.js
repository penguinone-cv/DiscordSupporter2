import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, configGet } = vi.hoisted(() => ({
    create: vi.fn(),
    configGet: vi.fn()
}));

vi.mock('openai', () => ({
    default: class MockOpenAI {
        constructor() {
            this.chat = { completions: { create } };
        }
    }
}));
vi.mock('../../src/config/configLoader.js', () => ({
    default: { get: configGet }
}));
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import openaiService from '../../src/services/openaiService.js';

describe('openaiService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configGet.mockImplementation(path => ({
            'openai.apiKey': 'test-key',
            'openai.model': undefined,
            'openai.reasoningEffort': undefined
        })[path]);
    });

    it('既定でgpt-5.6-lunaとreasoning noneを使用する', () => {
        openaiService.initialize();

        expect(openaiService.model).toBe('gpt-5.6-luna');
        expect(openaiService.reasoningEffort).toBe('none');
    });

    it('JSON解析のChat Completionsリクエストへreasoning_effortを指定する', async () => {
        openaiService.initialize();
        create.mockResolvedValue({
            choices: [{ message: { content: '{"matched":true}' } }]
        });

        const result = await openaiService.chatJSON([
            { role: 'user', content: '判定してください' }
        ]);

        expect(result).toEqual({ matched: true });
        expect(create).toHaveBeenCalledWith({
            model: 'gpt-5.6-luna',
            messages: [{ role: 'user', content: '判定してください' }],
            reasoning_effort: 'none',
            response_format: { type: 'json_object' }
        });
    });
});
