import { WebSocket } from 'ws';
import { BaseChatMessage } from '../../../common/types/chatMessage';

export interface OutlineCollaborationWebSocket extends WebSocket {
    userId?: string;
    employeeId?: string;
    gameId?: number;
    userName?: string;
    canView?: boolean;  // Has outline.view permission
    canEdit?: boolean;  // Has outline.edit permission
    sendJson: (data: unknown) => void;
}

export type OutlineEditOperation = 
    | { type: 'add'; item: OutlineItem; index: number }
    | { type: 'update'; itemId: number; changes: Partial<OutlineItem> }
    | { type: 'delete'; itemId: number }
    | { type: 'reorder'; itemId: number; newIndex: number }
    | { type: 'updateField'; itemId: number; field: string; value: unknown };

export interface OutlineItem {
    itemType: string;
    id: number;
    created?: Date;
    createdBy?: string;
    updated?: Date;
    updatedBy?: string;
    [key: string]: unknown;
}

export interface OutlineEditMessage {
    type: 'outline_edit';
    gameId: number;
    operation: OutlineEditOperation;
    timestamp: number;
    clientId: string;
}

export interface OutlineSubscribeMessage {
    type: 'outline_subscribe';
    gameId: number;
}

export interface OutlineUnsubscribeMessage {
    type: 'outline_unsubscribe';
    gameId: number;
}

export interface OutlineSyncMessage {
    type: 'outline_sync';
    gameId: number;
    outline: OutlineItem[];
    version: number;
    isLive?: boolean;  // Whether the game is currently live (has active broadcast)
}

export interface OutlineEditBroadcast {
    type: 'outline_edit_broadcast';
    gameId: number;
    operation: OutlineEditOperation;
    userId: string;
    userName: string;
    timestamp: number;
}

export interface OutlineEditorInfo {
    userId: string;
    userName: string;
    editingItemId?: number;
}

export interface OutlineEditorsBroadcast {
    type: 'outline_editors';
    gameId: number;
    editors: OutlineEditorInfo[];
}

export interface OutlineChatMessage extends BaseChatMessage {
    type: 'producerChat';
}

export interface OutlineChatSendMessage {
    type: 'producerChat';
    metadata: {
        message: string;
    };
}

export interface OutlineChatTypingMessage {
    type: 'outline_chat_typing';
    isTyping: boolean;
}

export interface OutlineChatTypingBroadcast {
    type: 'outline_chat_typing';
    gameId: number;
    employeeId: string;
    employeeName: string;
    isTyping: boolean;
}
