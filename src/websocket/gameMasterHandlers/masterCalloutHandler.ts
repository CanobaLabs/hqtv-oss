import HqError from '../../common/hqError';
import CrossServer from '../helpers/CrossServer';
import WsGameInfo from '../wsTypes/WsGameInfo';
import constructIapProductsCallout from '../constructors/constructIapProductsCallout';

async function masterCalloutHandler(_: WsGameInfo, broadcastId: number, body: { calloutType?: string }) {
	if (!body || !body.calloutType) {
		throw new HqError('calloutType is required', 0, 400);
	}

	if (body.calloutType !== 'extraLives' && body.calloutType !== 'erasers') {
		throw new HqError('calloutType must be "extraLives" or "erasers"', 0, 400);
	}

	const payload = constructIapProductsCallout(body.calloutType);
	await CrossServer.sendAllServers('callout', broadcastId, { payload });
}

export default masterCalloutHandler;
