import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Activity page integration', () => {
    it('既存ダッシュボードからActivity案内とリマインド予定を区別する', () => {
        const html = read('../../public/index.html');
        expect(html).toContain('href="schedule/"');
        expect(html).toContain('月間予定（Activity）');
        expect(html).toContain('リマインド予定');
    });
    it('mobile safe area、7列、下部sheet、viewportを定義する', () => {
        const html = read('../../activity/index.html');
        const css = read('../../activity/src/styles.css');
        expect(html).toContain('viewport-fit=cover');
        expect(css).toContain('repeat(7, minmax(0, 1fr))');
        expect(css).toContain('--discord-safe-area-inset-bottom');
        expect(css).toContain('@media (max-width: 768px)');
        expect(css).toContain('align-items: flex-end');
    });
});
