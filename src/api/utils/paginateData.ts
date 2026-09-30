import { Request } from 'express';

function paginateData(req: Request, data: Record<string, unknown>[]) {
    const { originalUrl, query } = req;
    const [baseUrl] = originalUrl.split('?'); // omit query
    
    const queryWithoutOffsets = { ...query };
    delete queryWithoutOffsets.after;
    delete queryWithoutOffsets.before;

    let nextPath: string | null = null;
    if (data.length >= 20) {
        const next = (req.offset + data.length).toString();
        const nextParams = { ...queryWithoutOffsets, after: next };
        nextPath = baseUrl + '?' + new URLSearchParams(nextParams);
    }

    let prevPath: string | null = null;
    if (req.offset >= 20) {
        const prev = (req.offset + 1).toString();
        const prevParams = { ...queryWithoutOffsets, before: prev };
        prevPath = baseUrl + '?' + new URLSearchParams(prevParams);
    }

    return {
        data,
        links: {
            next: nextPath,
            prev: prevPath,
            self: originalUrl
        }
    }
}

export default paginateData;
