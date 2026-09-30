import HqDisableChat from '../wsMessageTypes/HqDisableChat';

function constructDisableChat(chatDisabled: number) {
    return {
        type: 'disableChat',
        disabled: !!chatDisabled
    } as HqDisableChat;
}

export default constructDisableChat;
