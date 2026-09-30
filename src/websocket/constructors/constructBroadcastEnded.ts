import HqBroadcastEnded from '../wsMessageTypes/HqBroadcastEnded';

function constructBroadcastEnded(reason?: string) {
    return {
        type: 'broadcastEnded',
        reason: reason
    } as HqBroadcastEnded;
}

export default constructBroadcastEnded;
