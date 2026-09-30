import HqShowToast from '../wsMessageTypes/HqShowToast';

function constructShowToast(message: string, iconUrl: string) {
    return {
        type: 'showToast',
        durationMs: 7500,
        iconUrl: iconUrl,
        message: message,
        reason: 'alert',
        backgroundColor: '#FFFFFF',
        textColor: '#000000',
        priority: 1
    } as HqShowToast;
}

export default constructShowToast;
