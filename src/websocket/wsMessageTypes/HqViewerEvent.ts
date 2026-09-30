type HqViewerEvent = {
    type: 'viewerEvent';
    userId: number;
    eventType: 'joined' | 'eliminated';
    message: string;
    localeKey: string;
    localeArgs: string[];
}

export default HqViewerEvent;
