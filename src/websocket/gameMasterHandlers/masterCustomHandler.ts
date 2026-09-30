import HqError from '../../common/hqError';
import CrossServer from '../helpers/CrossServer';

async function masterCustomHandler(_: unknown, broadcastId: number, body: Record<string, unknown>) {
    if (!body) throw new HqError('Body missing', 0, 400);
    await CrossServer.sendAllServers('custom', broadcastId, { payload: body });
}

export default masterCustomHandler;
