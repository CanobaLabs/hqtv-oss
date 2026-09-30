type HqShowToast = {
    type: 'showToast';
    durationMs: number;
    iconUrl: string;
    message: string;
    reason: string;
    backgroundColor: string;
    textColor: string;
    priority: number;
}

export default HqShowToast;
