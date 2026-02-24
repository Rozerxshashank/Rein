import en from '../locales/en.json';


export const t = (path: string, vars?: Record<string, string | number>): string => {
    const keys = path.split('.');
    let value: any = en;

    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = (value as any)[key];
        } else {
            return path;
        }
    }

    if (typeof value !== 'string') return path;

    if (vars) {
        let result = value;
        for (const [k, v] of Object.entries(vars)) {
            result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
    }

    return value;
};
