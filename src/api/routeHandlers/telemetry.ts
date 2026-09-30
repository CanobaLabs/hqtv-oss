import logger from '../../common/logger';

export async function logTelemetryEvent(body: any, userId?: number) {
	body.forEach((error: { message: string | string[]; severity: any; tags: any }) => {
        if (['interstitial', 'whistler', 'offair', 'load native ad'].some(v => JSON.stringify(error).toLowerCase().includes(v))) return;

        logger.error(new Error(error.tags?.toString() ?? 'Tags Unavailable'), `[${error.severity}](${userId}) ${error.message}`);
    });
    return {};
}
