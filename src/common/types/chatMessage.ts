export interface BaseChatMessage {
    messageId?: string;
    employeeId: string;
    employeeName: string;
    avatarUrl: string;
    message: string;
    edited?: boolean;
    editedBy?: string;
    editedAt?: string;
    originalMessageId?: string;
    [key: string]: unknown;
}
