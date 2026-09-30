import UrlPattern from 'url-pattern';

function parseBroadcastId(originalUrl?: string): number | null {
    const parsedUrl = (originalUrl ?? '/').split('?')[0];
    const params: { broadcastId: string } | null = new UrlPattern('/ws/:broadcastId').match(parsedUrl);
    if (params?.broadcastId != null && !isNaN(+params.broadcastId)) {
        return +params.broadcastId
    } else {
        return null;
    }
}

export default parseBroadcastId;
