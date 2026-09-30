import HqViewerEvent from '../wsMessageTypes/HqViewerEvent';

function constructViewerEvent(message: string, eventType?: 'joined' | 'eliminated' | 'usedExtraLife', usernames: string[] = [], userId?: number) {
    return {
        type: 'viewerEvent',
        userId: userId,
        eventType: eventType,
        message: message,
        localeKey: (eventType == 'usedExtraLife') ? 'MESSAGE_USED_EXTRA_LIFE' : '',
        localeArgs: usernames
    } as HqViewerEvent;
}

export default constructViewerEvent;
