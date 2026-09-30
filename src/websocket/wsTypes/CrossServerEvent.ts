import gameSubHandlers from './gameSubHandlersMap';

type CrossServerEvent = {
	event: keyof typeof gameSubHandlers;
	broadcastId: number;
	serverId: string;
	metadata: any;
}

export default CrossServerEvent;
