import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 节日主题接口
 * GET /api/holiday/current
 */

function mountGamificationRoutes(app: Application, _ctx: AdminContext): void {
    app.get('/api/holiday/current', (_req: Request, res: Response) => {
        try {
            const holiday = getCurrentHoliday();
            res.json({ ok: true, data: holiday });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message || 'Internal Error' });
        }
    });
}

interface HolidayInfo {
    name: string;
    theme: string;
    icon: string;
    greeting: string;
    from: string;  // YYYY-MM-DD
    to: string;    // YYYY-MM-DD
    decoration: string;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function md(date: Date): string {
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getCurrentHoliday(): HolidayInfo | null {
    const now = new Date();
    const year = now.getFullYear();
    const todayMd = md(now);

    // 春节: 除夕 ~ 初七 (2 月范围,日期动态, 简化为 2-1 ~ 2-15)
    if (todayMd >= '02-01' && todayMd <= '02-15') {
        return {
            name: '春节',
            theme: 'spring-festival',
            icon: '🧧',
            greeting: '新春快乐,五谷丰登!',
            from: `${year}-02-01`,
            to: `${year}-02-15`,
            decoration: '春节限定',
        };
    }
    // 端午: 5-25 ~ 6-5
    if (todayMd >= '05-25' && todayMd <= '06-05') {
        return {
            name: '端午',
            theme: 'spring-festival',
            icon: '🐉',
            greeting: '端午安康!',
            from: `${year}-05-25`,
            to: `${year}-06-05`,
            decoration: '端午限定',
        };
    }
    // 中秋: 9-15 ~ 9-25
    if (todayMd >= '09-15' && todayMd <= '09-25') {
        return {
            name: '中秋',
            theme: 'mid-autumn',
            icon: '🌕',
            greeting: '中秋团圆,共赏明月!',
            from: `${year}-09-15`,
            to: `${year}-09-25`,
            decoration: '中秋限定',
        };
    }
    // 国庆: 10-1 ~ 10-7
    if (todayMd >= '10-01' && todayMd <= '10-07') {
        return {
            name: '国庆',
            theme: 'autumn-harvest',
            icon: '🇨🇳',
            greeting: '国庆快乐!',
            from: `${year}-10-01`,
            to: `${year}-10-07`,
            decoration: '国庆限定',
        };
    }
    // 双11: 11-10 ~ 11-12
    if (todayMd >= '11-10' && todayMd <= '11-12') {
        return {
            name: '双十一',
            theme: 'double-eleven',
            icon: '🛒',
            greeting: '双十一大丰收!',
            from: `${year}-11-10`,
            to: `${year}-11-12`,
            decoration: '双11限定',
        };
    }
    // 双12: 12-11 ~ 12-13
    if (todayMd >= '12-11' && todayMd <= '12-13') {
        return {
            name: '双十二',
            theme: 'double-twelve',
            icon: '🎁',
            greeting: '双十二收菜节!',
            from: `${year}-12-11`,
            to: `${year}-12-13`,
            decoration: '双12限定',
        };
    }
    // 圣诞: 12-24 ~ 12-26
    if (todayMd >= '12-24' && todayMd <= '12-26') {
        return {
            name: '圣诞',
            theme: 'winter-snow',
            icon: '🎄',
            greeting: '圣诞快乐!',
            from: `${year}-12-24`,
            to: `${year}-12-26`,
            decoration: '圣诞限定',
        };
    }
    return null;
}

module.exports = {
    mountGamificationRoutes,
    getCurrentHoliday,
};
